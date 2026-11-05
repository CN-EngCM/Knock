import { app, dialog, protocol } from "electron";
import { resolveDataDirOnBoot } from "./dataBoot";

// ── Electron 主进程入口 ──
// 只做必须赶在「开库之前」的事：注册 scheme、抢单实例锁、确定数据目录。
// 其余（窗口 / 托盘 / 热键 / IPC / mpimg 协议处理器）全在 app.ts。
//
// 为什么 app.ts 要动态 import：server 侧模块与 clipWatch/hotkey/windowState 都经
// server/util/settings → db 在 import 求值期同步打开 SQLite；而数据目录由默认根下的
// 指针文件决定，开库前可能还要弹首次引导 / 恢复对话框（dataBoot.ts）。所以 app.ts 必须
// 推迟到 whenReady 且数据目录引导完成后才加载，它内部再用普通静态 import 即可。

// 图库图片按 id 直读（主进程 serveImage 从数据目录取字节），不经 IPC 传字节；
// 注册自定义 scheme 必须赶在 app ready 之前（所以留在这里，处理器见 app.ts），
// standard+stream 是 <img> 正常加载的最低要求，
// supportFetchAPI 供查看器「复制到剪贴板」用 fetch 取原图字节；
// corsEnabled 让页面（file:// 或开发服务器 origin）与缩略图 Worker 能跨源 fetch 它——
// 不开的话 fetch("mpimg://…") 直接 TypeError，响应还要带 access-control-allow-origin 才算数
protocol.registerSchemesAsPrivileged([
    { scheme: "mpimg", privileges: { standard: true, stream: true, supportFetchAPI: true, corsEnabled: true } },
]);

app.setAppUserModelId("com.knock.app"); // Windows 托盘/任务栏分组标识

// ── 单实例锁：二次启动只唤起已有实例的窗口（second-instance 监听在 app.ts） ──
if (!app.requestSingleInstanceLock()) {
    app.quit();
} else {
    app.whenReady()
        .then(async () => {
            // 开库前先确定数据目录：无指针弹首次引导，指针失效走恢复流程（可能重启/退出）
            await resolveDataDirOnBoot();
            // 目录已定，此刻才加载会开库的模块
            (await import("./app")).startApp();
        })
        .catch(showBootFailure);

    // 窗口被隐藏而非关闭，永远不会全部关闭；不退出（macOS 惯例同样处理）
    app.on("window-all-closed", () => {});
}

// ── 启动失败 ──
// 开库、建表、迁移都在启动链上。任何一步出错时进程不会自己退出：没有窗口也没有托盘，
// 还占着单实例锁，用户再双击也只是把启动请求交给这个看不见的进程，表现为「打不开」。
// 所以必须明确提示并退出。文案内联双语，理由同 dataBoot.ts（主进程不引渲染层的 i18n）。
function showBootFailure(e: unknown): void {
    console.error("[boot] failed:", e);
    const zh = app.getLocale().startsWith("zh");
    const reason = e instanceof Error ? e.message : String(e);
    dialog.showErrorBox(
        zh ? "敲敲启动失败" : "Knock failed to start",
        zh
            ? `${reason}\n\n如果刚换过程序版本，请改用最新版本。`
            : `${reason}\n\nIf you recently switched versions, use the latest one.`,
    );
    app.exit(1);
}
