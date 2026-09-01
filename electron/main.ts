import { app, BrowserWindow, ipcMain, protocol, session, shell } from "electron";
import { join } from "node:path";
// esbuild 以 ESM 打包本文件，__dirname 由构建脚本注入的 banner 提供
import { createTray } from "./tray"; // 纯 electron，不触达 db，可静态加载
import { resolveDataDirOnBoot } from "./dataBoot";

// ── 为什么下面这些模块全是动态 import ──
// server 侧模块与 clipWatch/hotkey/windowState 都经 server/util/settings → db
// 在 import 求值期同步打开 SQLite；而数据目录由默认根下的指针文件决定，
// 开库前可能还要弹首次引导 / 恢复对话框（dataBoot.ts）。因此它们必须推迟到
// whenReady 且数据目录引导完成后才加载；类型用 typeof import 取（编译期擦除，
// 不触发模块求值）。
type ApiModule = typeof import("../server/api");
type PtyModule = typeof import("../server/pty");
type AiModule = typeof import("../server/ai");
type GalleryModule = typeof import("../server/gallery");
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

// 固定 IPv4：与 vite.config 的 server.host 保持一致（localhost 可能解析成 ::1）
const DEV_URL = "http://127.0.0.1:5173";
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
        ({ apiHandlers } = await import("../server/api"));
        ({ killAllSessions, setPtySink } = await import("../server/pty"));
        ({ setAiSink } = await import("../server/ai"));
        ({ serveImage, serveCandidate } = await import("../server/gallery"));
        ({ startClipWatch, freshClipboardText } = await import("./clipWatch"));
        ({ initHotkey, shutdownHotkey } = await import("./hotkey"));
        ({ loadWindowState, trackWindowState } = await import("./windowState"));

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
        // 命名空间而非 MpApi 业务契约（fire-and-forget，无需返回值）
        ipcMain.on("mp:hide-window", () => win?.hide());

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
            () => win,
            () => {
                // 托盘「设置」：唤起窗口并让前端打开设置对话框
                showWindow();
                win?.webContents.send("mp:open-settings");
            },
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
        webPreferences: {
            preload: join(__dirname, "preload.cjs"),
            contextIsolation: true, // 隔离：页面拿不到 require/ipcRenderer
            nodeIntegration: false,
            sandbox: true,
        },
    });
    if (st.maximized) w.maximize();
    trackWindowState(w);

    // 关闭按钮 = 隐藏（程序继续常驻托盘）；真正的退出只走托盘菜单
    w.on("close", (e) => {
        if (!quitting) {
            e.preventDefault();
            w.hide();
        }
    });
    w.on("closed", () => {
        win = null;
    });

    // 书签类条目由前端 window.open 打开：一律交给系统默认浏览器
    w.webContents.setWindowOpenHandler(({ url }) => {
        if (/^https?:/i.test(url)) void shell.openExternal(url);
        return { action: "deny" };
    });
    // 页面内导航只允许开发服务器自身（生产态 file:// 无外链）
    w.webContents.on("will-navigate", (e, url) => {
        if (!url.startsWith(DEV_URL)) {
            e.preventDefault();
            if (/^https?:/i.test(url)) void shell.openExternal(url);
        }
    });

    if (app.isPackaged) {
        void w.loadFile(join(__dirname, "..", "dist", "index.html"));
    } else {
        void w.loadURL(DEV_URL);
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
    if (!w.isVisible()) w.show();
    w.focus();
    setTimeout(() => {
        if (w.isDestroyed() || !w.isVisible()) return;
        w.setAlwaysOnTop(false);
        // 激活若在 show 瞬间没落定（前台锁的瞬态），这里再试一次
        if (!w.isFocused()) w.focus();
    }, 120);
    // 呼出即聚焦搜索框（spotlight 式：双击完 Ctrl 直接打字即搜）。
    // payload = 时限内的剪贴板素材（null = 超时/关闭/非文本），渲染端以 chip 呈现
    w.webContents.send("mp:focus-search", freshClipboardText());
}

// 三分支：前台可见才藏；可见但已失焦（被别的窗口盖住）时双击 Ctrl 是「提到前面」而非「藏掉」
function toggleWindow(): void {
    if (win && win.isVisible() && !win.isMinimized() && win.isFocused()) win.hide();
    else showWindow();
}
