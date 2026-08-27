import { app, BrowserWindow, ipcMain, shell } from "electron";
import { join } from "node:path";
// esbuild 以 ESM 打包本文件，__dirname 由构建脚本注入的 banner 提供
import { apiHandlers } from "../server/api";
import { killAllSessions, setPtySink } from "../server/pty";
import { freshClipboardText, startClipWatch } from "./clipWatch";
import { createTray } from "./tray";
import { initHotkey, shutdownHotkey } from "./hotkey";
import { loadWindowState, trackWindowState } from "./windowState";

// ── Electron 主进程入口 ──
// 单实例托盘常驻应用：业务逻辑（server/api.ts 处理器表 + SQLite）跑在本进程内，
// 渲染进程经 preload 白名单 invoke 调用。

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
    app.on("second-instance", () => showWindow());

    app.whenReady().then(() => {
        createWindow();
        // 剪贴板打点：呼出时据此判断最近一次复制是否落在时限内（见 clipWatch.ts）
        startClipWatch();
        // 终端输出流：pty 会话 → 渲染进程（窗口藏到托盘时事件静默丢弃，会话继续活着）
        setPtySink((ev) => win?.webContents.send("mp:pty-event", ev));
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
        killAllSessions(); // 终端会话随应用退出回收，避免孤儿 shell 进程
        shutdownHotkey(); // 反注册组合键，避免残留系统级注册
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

function toggleWindow(): void {
    if (win && win.isVisible() && !win.isMinimized()) win.hide();
    else showWindow();
}

// ── RPC 注册：server/api.ts 的处理器表逐个挂到 ipcMain ──
// channel 名即方法名（getData / createGroup / …），类型契约见 server/api.ts。
// 参数透传给处理器，由处理器入口的 zod 校验兜底（preload 是通用转发）。
for (const [channel, handler] of Object.entries(apiHandlers)) {
    // Object.entries 把参数类型抹成 unknown；处理器入口有 zod 校验兜底，此处断回参数元组
    ipcMain.handle(channel, (_e, ...args) => handler(...(args as never[])));
}
