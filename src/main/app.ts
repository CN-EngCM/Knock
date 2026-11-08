import { app, BrowserWindow, ipcMain, protocol, screen, session, shell } from "electron";
import { join } from "node:path";
// 本文件由 index.ts 在数据目录引导完成后才动态 import：下面这些模块经 server/util/settings → db
// 在 import 求值期同步打开 SQLite，所以静态 import 在这里是安全的，而在 index.ts 里不行
// （数据目录由默认根下的指针文件决定，开库前可能还要弹首次引导 / 恢复对话框，见 dataBoot.ts）。
import { nativeDialogOpen } from "./server/util/nativeDialog";
import { getSetting } from "./server/util/settings";
import { apiHandlers } from "./server/api";
import { killAllSessions, setPtySink } from "./server/pty";
import { setAiSink } from "./server/ai";
import { serveCandidate, serveImage } from "./server/gallery";
import { serveNoteImage } from "./server/notes";
import { freshClipboardText, startClipWatch } from "./clipWatch";
import { initHotkey, isBlockedByForeground, shutdownHotkey, unlockForeground } from "./hotkey";
import {
    getExpandedHeight,
    loadWindowState,
    MIN_EXPANDED_HEIGHT,
    MIN_WIDTH,
    TITLEBAR_HEIGHT,
    trackWindowState,
} from "./windowState";
import { initPin, isPinned, isTopmost, setPinned, setTopmost } from "./server/pin";
import { createTray } from "./tray";

// ── 应用主体：窗口 / 托盘 / 热键 / IPC 注册 / mpimg:// 协议 ──
// 单实例托盘常驻应用：业务逻辑（server/api.ts 处理器表 + SQLite）跑在本进程内，
// 渲染进程经 preload 白名单 invoke 调用。入口、单实例锁与 scheme 注册见 index.ts。

// 开发服务器端口由构建工具传入，端口被占用时也能加载实际地址。
const DEV_URL = process.env.ELECTRON_RENDERER_URL;
// 便携版/自启场景：带 --hidden 启动则只进托盘不弹窗
const startHidden = process.argv.includes("--hidden");

let win: BrowserWindow | null = null;
let quitting = false; // 托盘「退出」时置位：此时关闭窗口才真正退出
// 呼出序号：每次 showWindow 自增，过期的 120ms 收尾定时器据此让位（见 showWindow）
let summonSeq = 0;

// ── 界面主题（GaN.UI 深浅双主题）──
// 窗口预绘底色随主题走；渲染端令牌见 src/renderer/src/index.css（同源值）
type Theme = "dark" | "light";
let currentTheme: Theme = "dark";
const THEME_BG: Record<Theme, string> = { dark: "#26272b", light: "#eaeff5" };

/** 数据目录引导完成后由 index.ts 调用：注册 IPC、协议、权限，建窗口、托盘与热键 */
export function startApp(): void {
    // 主题在开窗前读定（settings 表 theme 键，脏值回落深色）：决定窗口预绘底色
    currentTheme = getSetting("theme", "dark") === "light" ? "light" : "dark";
    // 钉住落库、置顶仅内存；启动即读一次，窗口一开就按上次的钉住状态决定失焦是否自动隐藏
    initPin();

    // 首帧前渲染端同步取主题（index.html 内联脚本套 .dark 类防闪色）：
    // sendSync 会阻塞渲染进程，只服务这一个「开窗定色」场景，勿作他用
    ipcMain.on("mp:get-theme-sync", (e) => {
        e.returnValue = currentTheme;
    });

    // 渲染端主题切换的即时同步：只更新窗口底色，
    // 持久化由渲染端走 setTheme RPC（settings 表是唯一权威来源）
    ipcMain.on("mp:set-theme", (_e, v: unknown) => {
        const next = v === "light" ? "light" : "dark";
        if (next === currentTheme) return;
        currentTheme = next;
        if (!win || win.isDestroyed()) return;
        win.setBackgroundColor(THEME_BG[currentTheme]);
    });

    // ── mpimg 协议：mpimg://<orig|thumb>/<id>（库内图）、mpimg://cand/<n>（网址导入候选）
    //    与 mpimg://note/<图片id>（便签图片），图片直读不走 IPC 字节。host 只认四个 kind，path 段必须纯数字，其余一律 404；
    //    必须在数据目录引导完成后注册（serveImage 要读指针目录下的库）──
    // 响应一律带 access-control-allow-origin: *（含 404：CORS 下缺这个头，页面看到的是网络错误而不是 404，
    // 缩略图 Worker 就分不清「还没生成」和「请求失败」）。放 * 是安全的：协议只注册在默认 session，
    // 网址导入的隐藏窗口用的是另一个分区（IMPORT_PARTITION），第三方页面根本碰不到 mpimg://，
    // 能 fetch 它的只有应用自己的页面。
    protocol.handle("mpimg", async (request) => {
        const cors = { "access-control-allow-origin": "*" };
        const { host, pathname } = new URL(request.url);
        const id = pathname.slice(1);
        if ((host !== "orig" && host !== "thumb" && host !== "cand" && host !== "note") || !/^\d+$/.test(id)) {
            return new Response(null, { status: 404, headers: cors });
        }
        const hit =
            host === "cand"
                ? await serveCandidate(Number(id))
                : host === "note"
                  ? await serveNoteImage(Number(id))
                  : await serveImage(host, Number(id));
        if (!hit) return new Response(null, { status: 404, headers: cors });
        return new Response(new Uint8Array(hit.buf), { headers: { ...cors, "content-type": hit.mime } });
    });

    // ── RPC 注册：server/api.ts 的处理器表逐个挂到 ipcMain ──
    // channel 名即方法名（getData / createItem / …），类型契约见 server/api.ts。
    // 参数透传给处理器，由处理器入口的 zod 校验兜底（preload 是通用转发）。
    for (const [channel, handler] of Object.entries(apiHandlers)) {
        // Object.entries 把参数类型抹成 unknown；处理器入口有 zod 校验兜底，此处断回参数元组
        ipcMain.handle(channel, (_e, ...args) => handler(...(args as never[])));
    }

    // 启动成功后渲染进程请求隐藏窗口：窗口生命周期是主进程职责，走 mp:* 事件
    // 命名空间而非 MpApi 业务契约（fire-and-forget，无需返回值）。
    // 这是「打开条目成功」的自动退场；钉住时尊重钉子不藏（钉=工作模式）
    ipcMain.on("mp:hide-window", () => {
        if (!isPinned()) hideMainWindow();
    });

    // 钉住 / 置顶按钮的即时同步（fire-and-forget）：状态归 server/pin.ts，
    // 这里只把「实际生效的置顶」映射到窗口；窗口为空（启动早期/已销毁）时跳过
    ipcMain.on("mp:set-pinned", (_e, v: unknown) => {
        setPinned(v === true);
        if (win && !win.isDestroyed()) win.setAlwaysOnTop(isTopmost());
    });
    ipcMain.on("mp:set-topmost", (_e, v: unknown) => {
        setTopmost(v === true);
        if (win && !win.isDestroyed()) win.setAlwaysOnTop(isTopmost());
    });

    // 窗口形态：渲染端每次「展开与否」或「收起时临时需要的高度」变了就报一次（fire-and-forget）
    ipcMain.on("mp:set-layout", (_e, expanded: unknown, room: unknown) => {
        layout = {
            expanded: expanded === true,
            room: typeof room === "number" && Number.isFinite(room) ? Math.min(Math.max(Math.round(room), 0), 2000) : 0,
        };
        applyLayout();
    });

    // 二次启动唤起已有实例的窗口：引导期间还没有窗口可唤起，引导完成后才挂监听
    app.on("second-instance", () => showWindow());

    // macOS 点 Dock 图标只激活应用不建窗口，窗口藏托盘时必须显式补一次呼出
    app.on("activate", () => showWindow());

    // 只放行两个权限，其余保持拒绝，不开口子（request + check 两个口都要放，缺一个仍会被拒）：
    //   local-fonts：设置页枚举本机字体（queryLocalFonts）；
    //   clipboard-sanitized-write：navigator.clipboard 写文本和写图片都要它，
    //   JSON、二维码、翻译、查看器等工具的复制按钮靠它工作。读剪贴板不放行，仍走主进程。
    // Electron 42 的权限类型联合尚未收录 "local-fonts"，故按字符串比较
    const allowed = (permission: string): boolean =>
        permission === "local-fonts" || permission === "clipboard-sanitized-write";
    session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
        callback(allowed(permission));
    });
    session.defaultSession.setPermissionCheckHandler((_wc, permission) => allowed(permission));
    createWindow();
    // 剪贴板打点：呼出时据此判断最近一次复制是否落在时限内（见 clipWatch.ts）
    startClipWatch();
    // 终端输出流：pty 会话 → 渲染进程（窗口藏到托盘时事件静默丢弃，会话继续活着）
    setPtySink((ev) => win?.webContents.send("mp:pty-event", ev));
    // AI 对话增量流：与 pty 同款出口注入，工具关闭/组件卸载期间事件自然被忽略
    setAiSink((ev) => win?.webContents.send("mp:ai-event", ev));
    createTray(
        () => {
            // 托盘「设置」：唤起窗口并让前端打开设置对话框
            showWindow();
            win?.webContents.send("mp:open-settings");
        },
        toggleWindow,
        showWindow,
    );
    initHotkey(toggleByHotkey);

    app.on("before-quit", () => {
        quitting = true;
        killAllSessions(); // 终端会话随应用退出回收，避免孤儿 shell 进程
        shutdownHotkey(); // 反注册组合键，避免残留系统级注册
    });
}

function createWindow(): BrowserWindow {
    const st = loadWindowState();
    const w = new BrowserWindow({
        width: st.width,
        // 启动时什么工具都没开：先收成只剩顶栏的一条，展开由渲染端经 mp:set-layout 通知
        height: TITLEBAR_HEIGHT,
        x: st.x,
        y: st.y,
        minWidth: MIN_WIDTH,
        // 窗口高度由内容决定（有工具才展开），最大化与这套形态冲突
        maximizable: false,
        show: !startHidden, // 隐藏启动：首帧就不可见，等热键呼出
        autoHideMenuBar: true,
        frame: false, // 无边框：顶栏空白处可拖动，交互区域由渲染端排除。
        // 预绘帧用应用底色：窗口创建到首帧渲染之间的空窗不闪白，与主题一体
        backgroundColor: THEME_BG[currentTheme],
        webPreferences: {
            preload: join(import.meta.dirname, "../preload/index.cjs"),
            contextIsolation: true, // 隔离：页面拿不到 require/ipcRenderer
            nodeIntegration: false,
            sandbox: true,
        },
    });
    layout = { expanded: false, room: 0 };
    applyLayout(w);
    trackWindowState(w, () => layout.expanded);

    // 显隐通知渲染端：工具的后台存活计时从「窗口藏起来」开始数
    w.on("show", () => {
        if (!w.isDestroyed()) w.webContents.send("mp:window-visible", true);
    });
    w.on("hide", () => {
        if (!w.isDestroyed()) w.webContents.send("mp:window-visible", false);
    });

    // 关闭按钮 = 隐藏（程序继续常驻托盘）；真正的退出只走托盘菜单
    w.on("close", (e) => {
        if (!quitting) {
            e.preventDefault();
            hideMainWindow();
        }
    });

    // 失焦自动隐藏（spotlight 式）：窗口要么藏、要么可见且聚焦，「可见但失焦」
    // 的中间态是旧版「提到前面」激活被拒 bug 的温床，从形态上消灭它。
    // 延迟一拍再判：点自家任务栏图标等瞬态失焦会立刻回焦；期间重聚焦 /
    // 钉住 / 原生对话框在场（弹窗本身必然抢走焦点）都不藏
    w.on("blur", () => {
        setTimeout(() => {
            if (w.isDestroyed() || !w.isVisible() || w.isFocused()) return;
            if (isPinned() || nativeDialogOpen()) return;
            hideMainWindow();
        }, 200);
    });
    w.on("closed", () => {
        win = null;
    });

    // 书签类条目由前端 window.open 打开：一律交给系统默认浏览器
    w.webContents.setWindowOpenHandler(({ url }) => {
        if (/^https?:/i.test(url)) void shell.openExternal(url);
        return { action: "deny" };
    });
    // 渲染进程卡死探测器:input 持续无响应触发 unresponsive,恢复时 responsive。
    // 输出进主进程控制台(pnpm dev 可见),用于定位「设置界面有时点不动」的偶发卡死
    w.webContents.on("unresponsive", () => {
        console.warn("[diag] renderer unresponsive", new Date().toISOString());
    });
    w.webContents.on("responsive", () => {
        console.warn("[diag] renderer responsive", new Date().toISOString());
    });
    // 页面内导航只允许开发服务器自身（生产态 file:// 无外链）
    w.webContents.on("will-navigate", (e, url) => {
        if (!DEV_URL || new URL(url).origin !== new URL(DEV_URL).origin) {
            e.preventDefault();
            if (/^https?:/i.test(url)) void shell.openExternal(url);
        }
    });

    if (!app.isPackaged && DEV_URL) {
        void w.loadURL(DEV_URL);
    } else {
        void w.loadFile(join(import.meta.dirname, "../renderer/index.html"));
    }
    win = w;
    return w;
}

// ── 窗口形态：有工具/终端在显示就「展开」，否则收成只剩顶栏的一条 ──
// 窗口无边框、不透明，「只有顶栏」只能靠窗口自己变矮实现。收起时搜索下拉、弹窗、提示需要竖向空间，
// 渲染端把它们要的总高度报成 room，窗口取 max(顶栏高度, room)，东西消失就缩回去。
// 展开时 room 不起作用：下拉和弹窗直接悬浮在工具区上面。
let layout = { expanded: false, room: 0 };

function applyLayout(target: BrowserWindow | null = win): void {
    const w = target;
    if (!w || w.isDestroyed()) return;
    const b = w.getBounds();
    const height = layout.expanded
        ? Math.max(getExpandedHeight(), MIN_EXPANDED_HEIGHT)
        : Math.max(TITLEBAR_HEIGHT, layout.room);
    // 先放开上下限再改尺寸，不然旧的限制会把新尺寸夹回去
    w.setMinimumSize(MIN_WIDTH, 0);
    w.setMaximumSize(0, 0);
    // 窗口往下长，快碰到屏幕底边时整体往上挪（缩回去不挪回，下次长的时候已经放得下了）
    const area = screen.getDisplayMatching(b).workArea;
    const y = Math.max(area.y, Math.min(b.y, area.y + area.height - height));
    if (b.height !== height || b.y !== y) w.setBounds({ x: b.x, y, width: b.width, height });
    if (layout.expanded) {
        w.setMinimumSize(MIN_WIDTH, MIN_EXPANDED_HEIGHT);
    } else {
        // 收起时高度锁死：不能竖着拖；宽度仍可拖
        w.setMinimumSize(MIN_WIDTH, height);
        w.setMaximumSize(10000, height);
    }
}

function showWindow(): void {
    const w = win ?? createWindow();
    if (w.isMinimized()) w.restore();
    // Windows 前台锁：后台进程的 SetForegroundWindow（focus()）会被系统静默拒绝。
    // 破局三步（Windows 启动器类应用的标准配方）：
    //   1) 先瞬置顶：即使激活失败，窗口也压在最前面看得见；
    //   2) show + focus 立刻尝试激活；
    //   3) 临时置顶必须【延迟】收掉——与置顶调用同批次同步连发会被窗口管理器
    //      合并忽略，窗口卡在置顶（表现为点别的软件也盖不住它）。
    //      收尾按 isTopmost() 落定：普通呼出回到不置顶，钉住 + 置顶则保留。
    w.setAlwaysOnTop(true);
    // show 无条件执行：show 参与激活链，跳过它只剩裸 focus() 时后台进程
    // 硬抢前台必被 Windows 前台锁拒（任务栏按钮闪橙、焦点拿不到）
    w.show();
    // 先武装再取焦点（PowerToys Run 等启动器的标准配方）：被拒的 focus() 会让
    // Electron 自认已聚焦（与 OS 脱同步），之后 focus() 沦为 no-op——与其事后
    // blur() 复位（健康路径也会闪一下），不如让第一次激活就合法、被拒不发生
    unlockForeground();
    w.focus();
    // 每次呼出取一个序号：120ms 内又呼出一次时旧定时器直接弃权，
    // 否则它会按旧状态抢先改写置顶（钉住 + 置顶时表现为置顶闪一下就消失）
    const seq = ++summonSeq;
    setTimeout(() => {
        if (w.isDestroyed() || seq !== summonSeq) return;
        // 收掉本次呼出的临时置顶；钉住 + 置顶时改为保留用户要的长置顶
        w.setAlwaysOnTop(isTopmost());
        // 罕见的持续被拒（全屏游戏/高权限进程占前台）再武装重试一次；
        // 仍拿不到焦点时窗口浮着等用户点一下或按热键收掉
        if (w.isVisible() && !w.isFocused()) {
            unlockForeground();
            w.focus();
        }
    }, 120);
    // 呼出即聚焦搜索框（spotlight 式：双击完 Ctrl 直接打字即搜）。
    // payload = 时限内的剪贴板素材（null = 超时/关闭/非文本），渲染端以 chip 呈现
    w.webContents.send("mp:focus-search", freshClipboardText());
}

// ── 钉住 / 置顶 ──
// 状态归 server/pin.ts（钉住落库跨重启，置顶仅内存）；主进程只把状态映射成窗口
// 行为：失焦不藏、热键呼出收尾时保留置顶。渲染端按钮经 mp:set-pinned /
// mp:set-topmost 同步，不做反向推送（界面启动时读一次 getPinState 即可）。

/** 隐藏主窗口的统一入口：只负责隐藏。钉住只由用户点按钮取消，隐藏不连带清掉 */
function hideMainWindow(): void {
    win?.hide();
}

// 显隐切换（热键与托盘共用）：未钉住时可见即藏（不判 isFocused——激活被拒的僵死窗口也能被收掉）；
// 钉住时窗口是工作台，已在最前就不动，藏起/最小化/失焦才呼出。
// summon 是「呼出」动作，由调用方决定要不要加限制，「收起」始终不受限
function toggle(summon: () => void): void {
    if (isPinned()) {
        if (nativeDialogOpen()) return;
        if (win && !win.isDestroyed() && win.isVisible() && !win.isMinimized() && win.isFocused()) return;
        summon();
        return;
    }
    if (win && win.isVisible() && !win.isMinimized()) hideMainWindow();
    else summon();
}

/** 托盘点击：用户主动操作，不受屏蔽名单约束 */
function toggleWindow(): void {
    toggle(showWindow);
}

/** 呼出热键：前台是屏蔽名单里的程序（比如全屏游戏）时，只拦「呼出」，收起照常。
 *  被拦时一声不吭——任何提示都会再盖到游戏上 */
function toggleByHotkey(): void {
    toggle(() => {
        if (!isBlockedByForeground()) showWindow();
    });
}
