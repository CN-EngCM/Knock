import { app, BrowserWindow, ipcMain, protocol, session, shell } from "electron";
import { spawn } from "node:child_process";
import { join } from "node:path";
// 纯工具模块（不开库、不触 settings），可在引导前静态 import
import { nativeDialogOpen } from "./server/util/nativeDialog";
import { createTray } from "./tray"; // 纯 electron，不触达 db，可静态加载
import { resolveDataDirOnBoot } from "./dataBoot";

// ── 为什么下面这些模块全是动态 import ──
// server 侧模块与 clipWatch/hotkey/windowState 都经 server/util/settings → db
// 在 import 求值期同步打开 SQLite；而数据目录由默认根下的指针文件决定，
// 开库前可能还要弹首次引导 / 恢复对话框（dataBoot.ts）。因此它们必须推迟到
// whenReady 且数据目录引导完成后才加载；类型用 typeof import 取（编译期擦除，
// 不触发模块求值）。
type ApiModule = typeof import("./server/api");
type PtyModule = typeof import("./server/pty");
type AiModule = typeof import("./server/ai");
type GalleryModule = typeof import("./server/gallery");
type ClipModule = typeof import("./clipWatch");
type HotkeyModule = typeof import("./hotkey");
type WindowStateModule = typeof import("./windowState");

// 引导完成后才赋值；此前没有调用路径能触达它们（相关监听也在引导后才注册）
let apiHandlers: ApiModule["apiHandlers"];
let killAllSessions: PtyModule["killAllSessions"];
let setPtySink: PtyModule["setPtySink"];
let setAiSink: AiModule["setAiSink"];
let serveImage: GalleryModule["serveImage"];
let serveCandidate: GalleryModule["serveCandidate"];
let startClipWatch: ClipModule["startClipWatch"];
let freshClipboardText: ClipModule["freshClipboardText"];
let initHotkey: HotkeyModule["initHotkey"];
let shutdownHotkey: HotkeyModule["shutdownHotkey"];
let unlockForeground: HotkeyModule["unlockForeground"];
let loadWindowState: WindowStateModule["loadWindowState"];
let trackWindowState: WindowStateModule["trackWindowState"];

// ── Electron 主进程入口 ──
// 单实例托盘常驻应用：业务逻辑（server/api.ts 处理器表 + SQLite）跑在本进程内，
// 渲染进程经 preload 白名单 invoke 调用。

// 图库图片按 id 直读（主进程 serveImage 从数据目录取字节），不经 IPC 传字节；
// 注册自定义 scheme 必须赶在 app ready 之前，standard+stream 是 <img> 正常加载的最低要求，
// supportFetchAPI 供查看器「复制到剪贴板」用 fetch 取原图字节
protocol.registerSchemesAsPrivileged([
    { scheme: "mpimg", privileges: { standard: true, stream: true, supportFetchAPI: true } },
]);

// 开发服务器端口由构建工具传入，端口被占用时也能加载实际地址。
const DEV_URL = process.env.ELECTRON_RENDERER_URL;
// 便携版/自启场景：带 --hidden 启动则只进托盘不弹窗
const startHidden = process.argv.includes("--hidden");

let win: BrowserWindow | null = null;
let quitting = false; // 托盘「退出」时置位：此时关闭窗口才真正退出

app.setAppUserModelId("com.knock.app"); // Windows 托盘/任务栏分组标识

// ── 单实例锁：二次启动只唤起已有实例的窗口 ──
if (!app.requestSingleInstanceLock()) {
    app.quit();
} else {
    app.whenReady().then(async () => {
        // 1) 开库前先确定数据目录：无指针弹首次引导，指针失效走恢复流程（可能重启/退出）
        await resolveDataDirOnBoot();

        // 2) 目录已定，此刻才加载会开库的模块（见顶部「为什么全是动态 import」）
        ({ apiHandlers } = await import("./server/api"));
        ({ killAllSessions, setPtySink } = await import("./server/pty"));
        ({ setAiSink } = await import("./server/ai"));
        ({ serveImage, serveCandidate } = await import("./server/gallery"));
        ({ startClipWatch, freshClipboardText } = await import("./clipWatch"));
        ({ initHotkey, shutdownHotkey, unlockForeground } = await import("./hotkey"));
        ({ loadWindowState, trackWindowState } = await import("./windowState"));
        // 主题在开窗前读定（settings 表 theme 键，脏值回落深色）：
        // 决定窗口预绘底色与 DWM 系统边线颜色
        const { getSetting } = await import("./server/util/settings");
        currentTheme = getSetting("theme", "dark") === "light" ? "light" : "dark";

        // 首帧前渲染端同步取主题（index.html 内联脚本套 .dark 类防闪色）：
        // sendSync 会阻塞渲染进程，只服务这一个「开窗定色」场景，勿作他用
        ipcMain.on("mp:get-theme-sync", (e) => {
            e.returnValue = currentTheme;
        });

        // 渲染端主题切换的即时同步：只更新窗口外观（底色/系统边线），
        // 持久化由渲染端走 setTheme RPC（settings 表是唯一权威来源）
        ipcMain.on("mp:set-theme", (_e, v: unknown) => {
            const next = v === "light" ? "light" : "dark";
            if (next === currentTheme) return;
            currentTheme = next;
            if (!win || win.isDestroyed()) return;
            win.setBackgroundColor(THEME_BG[currentTheme]);
            tintSystemBorder(win);
        });

        // ── mpimg 协议：mpimg://<orig|thumb>/<id>（库内图）与 mpimg://cand/<n>（网址导入候选），
        //    图片直读不走 IPC 字节。host 只认三个 kind，path 段必须纯数字，其余一律 404；
        //    必须在数据目录引导完成后注册（serveImage 要读指针目录下的库）──
        protocol.handle("mpimg", (request) => {
            const { host, pathname } = new URL(request.url);
            const id = pathname.slice(1);
            if ((host !== "orig" && host !== "thumb" && host !== "cand") || !/^\d+$/.test(id)) {
                return new Response(null, { status: 404 });
            }
            const hit = host === "cand" ? serveCandidate(Number(id)) : serveImage(host as "orig" | "thumb", Number(id));
            if (!hit) return new Response(null, { status: 404 });
            return new Response(new Uint8Array(hit.buf), { headers: { "content-type": hit.mime } });
        });

        // ── RPC 注册：server/api.ts 的处理器表逐个挂到 ipcMain ──
        // channel 名即方法名（getData / createGroup / …），类型契约见 server/api.ts。
        // 参数透传给处理器，由处理器入口的 zod 校验兜底（preload 是通用转发）。
        for (const [channel, handler] of Object.entries(apiHandlers)) {
            // Object.entries 把参数类型抹成 unknown；处理器入口有 zod 校验兜底，此处断回参数元组
            ipcMain.handle(channel, (_e, ...args) => handler(...(args as never[])));
        }

        // 启动成功后渲染进程请求隐藏窗口：窗口生命周期是主进程职责，走 mp:* 事件
        // 命名空间而非 MpApi 业务契约（fire-and-forget，无需返回值）。
        // 这是「打开条目成功」的自动退场，钉住时尊重钉子不藏（用户决策：钉=工作模式）
        ipcMain.on("mp:hide-window", () => {
            if (!pinned) hideMainWindow();
        });

        // 渲染端钉子按钮的状态同步（fire-and-forget；呼出/隐藏时双方各自重置，见下）
        ipcMain.on("mp:set-pinned", (_e, v: unknown) => {
            pinned = v === true;
        });

        // 二次启动唤起已有实例的窗口：引导期间窗口模块未加载，引导完成后才挂监听
        app.on("second-instance", () => showWindow());

        // macOS 点 Dock 图标只激活应用不建窗口，窗口藏托盘时必须显式补一次呼出
        app.on("activate", () => showWindow());

        // 设置页枚举本机字体（queryLocalFonts）需要 local-fonts 权限；仅放行它一个，
        // 其余权限保持拒绝，不开口子（request + check 两个口都要放，缺一个仍会被拒）。
        // Electron 42 的权限类型联合尚未收录 "local-fonts"，故按字符串比较
        session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
            callback((permission as string) === "local-fonts");
        });
        session.defaultSession.setPermissionCheckHandler((_wc, permission) => (permission as string) === "local-fonts");
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
        initHotkey(toggleWindow);
    });

    app.on("before-quit", () => {
        quitting = true;
        killAllSessions?.(); // 终端会话随应用退出回收，避免孤儿 shell 进程
        shutdownHotkey?.(); // 反注册组合键，避免残留系统级注册
    });

    // 窗口被隐藏而非关闭，永远不会全部关闭；不退出（macOS 惯例同样处理）
    app.on("window-all-closed", () => {});
}

// ── 界面主题（GaN.UI 深浅双主题）──
// 窗口预绘底色与 DWM 边线颜色随主题走；渲染端令牌见 src/renderer/src/index.css（同源值）
type Theme = "dark" | "light";
let currentTheme: Theme = "dark";
const THEME_BG: Record<Theme, string> = { dark: "#26272b", light: "#eeeef1" };
// DWM 边线取 GaN.UI v1.0.0 的 --window-border：深色 #131417；浅色 rgb(20 20 40 / 15%)，
// COLORREF 不支持透明度，按浅色底 #eeeef1 合成出等视觉实色 #cdcdd3
const THEME_BORDER: Record<Theme, string> = { dark: "#131417", light: "#cdcdd3" };

// ── Win11 DWM 系统描边染色 ──
// frame:false + 默认 thickFrame 保留了边缘缩放与系统阴影，但 Win11 会沿窗口边缘
// 自画一条 1px 边线，颜色跟随系统强调色（紫色/蓝色都会与应用中性灰主题打架）。
// DWMWA_BORDER_COLOR 可把它染成任意色：这里染成主题边线色，与窗口融为一体。
// Electron 未暴露该属性，经 PowerShell P/Invoke 一次性设置；该属性跨 hide/show
// 持久（spotlight 式高频呼出不受影响），窗口生命周期内只需按主题调用一次。
// 失败静默：旧系统无此属性只会返回错误 HRESULT，不影响任何功能。
function tintSystemBorder(w: BrowserWindow): void {
    if (process.platform !== "win32") return;
    try {
        const hwnd = w.getNativeWindowHandle().readBigUInt64LE(0);
        const hex = THEME_BORDER[currentTheme].slice(1);
        const colorref = parseInt(hex.slice(4, 6) + hex.slice(2, 4) + hex.slice(0, 2), 16); // COLORREF = 0x00BBGGRR
        // 脚本经 -EncodedCommand 投递（base64 UTF-16LE），免去引号转义地狱
        const script =
            `$h=[IntPtr]([long]${hwnd.toString()});` +
            `Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;` +
            `public class K{[DllImport("dwmapi.dll")]public static extern int DwmSetWindowAttribute(IntPtr h,int a,ref uint v,int s);}';` +
            `$v=[uint32]${colorref};` +
            `[K]::DwmSetWindowAttribute($h,34,[ref]$v,4)|Out-Null`; // 34 = DWMWA_BORDER_COLOR
        const child = spawn(
            "powershell.exe",
            ["-NoProfile", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")],
            { stdio: "ignore", windowsHide: true },
        );
        child.on("error", () => {
            /* 无 PowerShell 或被策略禁用：留着默认边线，无碍 */
        });
    } catch {
        /* 拿不到句柄等意外：静默 */
    }
}

function createWindow(): BrowserWindow {
    const st = loadWindowState();
    const w = new BrowserWindow({
        width: st.width,
        height: st.height,
        x: st.x,
        y: st.y,
        minWidth: 840,
        minHeight: 520,
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
    // 染色时机的三处兜底:创建即染 + ready-to-show 再染一次(创建期 DWM 尚未
    // 完成初始化时可能被覆盖,实测偶发)+ 最大化切换后补染(DWM 会借最大化
    // 重算边框色,实测必现)。hide/show 不重置,无需每次呼出补染
    tintSystemBorder(w);
    w.once("ready-to-show", () => tintSystemBorder(w));
    w.on("maximize", () => tintSystemBorder(w));
    w.on("unmaximize", () => tintSystemBorder(w));
    if (st.maximized) w.maximize();
    trackWindowState(w);

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
            if (pinned || nativeDialogOpen()) return;
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

function showWindow(): void {
    const w = win ?? createWindow();
    if (w.isMinimized()) w.restore();
    // Windows 前台锁：后台进程的 SetForegroundWindow（focus()）会被系统静默拒绝。
    // 破局三步（Windows 启动器类应用的标准配方）：
    //   1) 先瞬置顶：即使激活失败，窗口也压在最前面看得见；
    //   2) show + focus 立刻尝试激活；
    //   3) 置顶必须【延迟】取消——与置顶调用同批次同步连发会被窗口管理器
    //      合并忽略，窗口卡在置顶（表现为点别的软件也盖不住它），
    //      这正是本函数早先版本的 bug。
    w.setAlwaysOnTop(true);
    // show 无条件执行：show 参与激活链，跳过它只剩裸 focus() 时后台进程
    // 硬抢前台必被 Windows 前台锁拒（任务栏按钮闪橙、焦点拿不到）
    w.show();
    // 先武装再取焦点（PowerToys Run 等启动器的标准配方）：被拒的 focus() 会让
    // Electron 自认已聚焦（与 OS 脱同步），之后 focus() 沦为 no-op——与其事后
    // blur() 复位（健康路径也会闪一下），不如让第一次激活就合法、被拒不发生
    unlockForeground();
    w.focus();
    setTimeout(() => {
        if (w.isDestroyed()) return;
        // 窗口已被快速再按热键藏掉也照样清置顶——topmost 残留会带到下次呼出
        w.setAlwaysOnTop(false);
        // 罕见的持续被拒（全屏游戏/高权限进程占前台）再武装重试一次；
        // 仍拿不到焦点时窗口浮着等用户点一下或双击 Ctrl 收掉（二态切换不判焦点）
        if (w.isVisible() && !w.isFocused()) {
            unlockForeground();
            w.focus();
        }
    }, 120);
    // 呼出即聚焦搜索框（spotlight 式：双击完 Ctrl 直接打字即搜）。
    // payload = 时限内的剪贴板素材（null = 超时/关闭/非文本），渲染端以 chip 呈现
    w.webContents.send("mp:focus-search", freshClipboardText());
}

// ── 钉住：失焦自动隐藏的豁免开关 ──
// 钉住 = 失焦不自动藏（挂终端/对照工作的场景）；任何隐藏都清钉（隐藏即取消，
// 不跨呼出记忆）。状态归主进程管（blur 自动藏在此判定），渲染端按钮经
// mp:set-pinned 同步；双方在「呼出 / 隐藏」时各自重置，不另做反向推送。
let pinned = false;

/** 隐藏主窗口的统一入口：唯一会清钉的地方（隐藏即取消） */
function hideMainWindow(): void {
    pinned = false;
    win?.hide();
}

// 二态切换：可见即藏（同时清钉）；藏/最小化则呼出。不判 isFocused——
// 激活被拒的僵死窗口（焦点拿不到的罕见态）也能被双击收掉
function toggleWindow(): void {
    if (win && win.isVisible() && !win.isMinimized()) hideMainWindow();
    else showWindow();
}
