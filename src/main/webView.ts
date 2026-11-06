import { app, session, type WebContents } from "electron";
import { IMPORT_PARTITION } from "./server/chromeLogin";
import { withNativeDialog } from "./server/util/nativeDialog";

// ── 应用内网页（<webview>）的会话与安全 ──
// 网页面板用 <webview> 嵌在停靠区里（渲染端见 components/WebPanel.tsx）。网页是第三方内容，
// 所以这里把它和应用本体隔开：独立持久分区、不给 Node、不挂 preload、权限一律拒绝。

/** 所有网页共用的持久分区：登录一次长期有效。数据落在 sessionData（数据目录的 browser-data）下 */
export const WEB_PARTITION = "persist:web";

/**
 * 网页的会话设置与开窗转发，startApp 里调用一次。
 * onOpenUrl：网页要新开窗口（target=_blank / window.open）时的出口，由调用方转给渲染端开新面板。
 */
export function initWebView(onOpenUrl: (url: string) => void): void {
    const ses = session.fromPartition(WEB_PARTITION);
    // UA 去掉 Electron 与应用名：很多站看到 Electron 会给残缺页面或直接拒绝，只改这个分区。
    // 只设会话级不够：实测 <webview> 的网页不吃它，请求头和 navigator.userAgent 都还带 Electron，
    // 所以下面每个网页的 webContents 创建时再各设一次
    const userAgent = ses.getUserAgent().replace(/\s(?:Electron|Knock)\/\S+/gi, "");
    ses.setUserAgent(userAgent);
    // 摄像头、麦克风、定位、通知等一律拒绝，不弹询问（request 与 check 两个口都要堵）
    ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    ses.setPermissionCheckHandler(() => false);
    // 下载走 Electron 默认的另存为框。这个框不经 withNativeDialog，在场时主窗口失焦会被「失焦自动隐藏」
    // 藏到框后面；这里补计数：框关闭后下载要么开始（updated）要么取消（done），先到的那个就是框关了
    ses.on("will-download", (_e, item) => {
        void withNativeDialog(
            () =>
                new Promise<void>((resolve) => {
                    item.once("updated", () => resolve());
                    item.once("done", () => resolve());
                }),
        );
    });

    // 网页自己的 webContents 只有创建后才拿得到，所以在全局事件里按类型挂
    app.on("web-contents-created", (_e, contents) => {
        if (contents.getType() !== "webview") return;
        contents.setUserAgent(userAgent);
        // 新窗口请求：http/https 交给渲染端在当前工作区新开面板，其他协议丢弃，
        // 避免页面随便拉起本机程序
        contents.setWindowOpenHandler(({ url }) => {
            if (/^https?:/i.test(url)) onOpenUrl(url);
            return { action: "deny" };
        });
        // 页面自己发起的跳转（含重定向）同样只放行 http/https；渲染端设 src 的导航不经这两个事件
        const blockNonHttp = (e: { preventDefault(): void }, url: string) => {
            if (!/^https?:/i.test(url)) e.preventDefault();
        };
        contents.on("will-navigate", blockNonHttp);
        contents.on("will-redirect", blockNonHttp);
    });
}

/** 挂在主窗口上：每个 <webview> 创建前把它的配置钉死，页面里的属性改不动这些 */
export function guardWebviews(host: WebContents): void {
    host.on("will-attach-webview", (e, webPreferences, params) => {
        delete webPreferences.preload;
        webPreferences.nodeIntegration = false;
        webPreferences.contextIsolation = true;
        webPreferences.sandbox = true;
        // 分区由主进程定：渲染端少传或写错，网页也进不了应用自己的会话
        params.partition = WEB_PARTITION;
        // 初始地址只认 http/https 或空白页
        const src = params.src ?? "";
        if (src !== "" && src !== "about:blank" && !/^https?:\/\//i.test(src)) e.preventDefault();
    });
}

/** 把会话数据刷盘：cookie 默认攒一阵才写，app.exit 不等。改数据目录重启前必须调用，否则搬过去的是旧登录态 */
export async function flushBrowserData(): Promise<void> {
    const sessions = [
        session.defaultSession,
        session.fromPartition(WEB_PARTITION),
        session.fromPartition(IMPORT_PARTITION),
    ];
    await Promise.allSettled(sessions.flatMap((s) => [s.cookies.flushStore(), s.flushStorageData()]));
}
