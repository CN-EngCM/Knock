import { execSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { session } from "electron";
import type { ApiResult } from "./api";
import { dataDir } from "./util/dataDir";
import { CHROME_PROFILE_NAME } from "./util/dataLocation";

// ── 受限站登录态：专用 Chrome 实例 + CDP 同步 cookie ──
// 为什么不碰用户日常 Chrome：Chrome 136 起默认 user-data-dir 下 --remote-debugging-port
// 直接被忽略（防 infostealer 偷 cookie），cookie 本身还有 App-Bound Encryption，第三方
// 进程解不开。反过来做：Knock 拉起一个**独立持久 profile** 的 Chrome（--user-data-dir
// 指到数据目录 chrome-profile/，登录一次长期有效），用户在其中登录，Knock 经 CDP
// （Chrome 官方调试接口）把目标 URL 的 cookie 拷进 persist:gallery-import 分区；
// 抓取三链路（抓页 fetch / 隐藏窗口渲染 / 图片下载）都挂该分区，登录态由此生效。

/** 抓取会话分区：隐藏渲染窗口与 cookie 注入共用（gallery.ts 引用） */
export const IMPORT_PARTITION = "persist:gallery-import";

// 固定端口：任意时刻可探活（GET /json/version），Knock 重启后也能找回还开着的实例；
// 9333 避开常用开发端口。被别的程序占用时拉起后探活失败，按启动失败报错
const CDP_PORT = 9333;
const LAUNCH_TIMEOUT_MS = 10000;

function profileDir(): string {
    return join(dataDir(), CHROME_PROFILE_NAME);
}

// ensure 失败的两种可预期错误：没装 Chrome，或拉起/探活超时
type EnsureResult = { ws: string } | { err: "no-chrome" | "chrome" };

function ensureFailure(r: Extract<EnsureResult, { err: "no-chrome" | "chrome" }>): ApiResult<never> {
    return { ok: false, error: { kind: "gallery", code: r.err } };
}

/** Chrome 可执行文件：先文件系统常见位置，再 Windows 注册表 App Paths（自定义安装位） */
function findChrome(): string | null {
    if (process.platform === "win32") {
        const roots = [process.env.ProgramFiles, process.env["ProgramFiles(x86)"], process.env.LOCALAPPDATA];
        const hit = roots
            .filter((r): r is string => !!r)
            .map((r) => join(r, "Google", "Chrome", "Application", "chrome.exe"))
            .find((p) => existsSync(p));
        if (hit) return hit;
        try {
            const out = execSync(
                'reg query "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe" /ve',
                { encoding: "utf8" },
            );
            const m = /REG_SZ\s+(.+)/.exec(out);
            const p = m?.[1]?.trim();
            if (p && existsSync(p)) return p;
        } catch {
            /* 未安装或无键 */
        }
        return null;
    }
    if (process.platform === "darwin") {
        const paths = [
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            join(homedir(), "Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
        ];
        return paths.find((p) => existsSync(p)) ?? null;
    }
    return null;
}

/** CDP HTTP 探活：返回 browser 级 WebSocket 地址，实例不在跑返回 null */
async function cdpEndpoint(): Promise<string | null> {
    try {
        const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`, {
            signal: AbortSignal.timeout(800),
        });
        if (!res.ok) return null;
        const v = (await res.json()) as { webSocketDebuggerUrl?: string };
        return typeof v.webSocketDebuggerUrl === "string" ? v.webSocketDebuggerUrl : null;
    } catch {
        return null;
    }
}

// 拉起进行中去重：连点「登录/同步」不重复 spawn
let launching: Promise<EnsureResult> | null = null;

/** 确保专用 Chrome 在跑并返回 CDP 地址；不在则拉起（url 作为起始页，方便直接登录） */
async function ensureChrome(url: string): Promise<EnsureResult> {
    const alive = await cdpEndpoint();
    if (alive) return { ws: alive };
    if (!launching) launching = launchChrome(url).finally(() => (launching = null));
    return launching;
}

async function launchChrome(url: string): Promise<EnsureResult> {
    const exe = findChrome();
    if (!exe) return { err: "no-chrome" };
    mkdirSync(profileDir(), { recursive: true });
    // detached + unref：Chrome 是用户的窗口，生命周期独立于 Knock（登录态持久的前提）。
    // 已有同 profile 实例在跑时新进程会把 url 转交老进程后自退——探活照样成功，无碍
    const child = spawn(
        exe,
        [
            `--user-data-dir=${profileDir()}`,
            `--remote-debugging-port=${CDP_PORT}`,
            "--no-first-run",
            "--no-default-browser-check",
            url,
        ],
        { detached: true, stdio: "ignore" },
    );
    child.on("error", () => undefined); // 拉起失败（文件损坏等）由探活超时兜底报错，不升级为 uncaught
    child.unref();
    const deadline = Date.now() + LAUNCH_TIMEOUT_MS;
    while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 300));
        const ws = await cdpEndpoint();
        if (ws) return { ws };
    }
    return { err: "chrome" };
}

// CDP 客户端：全局 WebSocket（Node 22+ 的 undici 实现，零依赖），不引 ws 包

function cdpConnect(wsUrl: string): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(wsUrl);
        const fail = () => reject(new Error("cdp connect failed"));
        ws.onopen = () => resolve(ws);
        ws.onerror = fail;
        ws.onclose = fail; // 未 open 即 close（连接拒绝）也走失败；成功后 close 再触发时已 settle，无害
    });
}

let cdpSeq = 0;

/** WebSocket 上的 CDP 调用：自增 id 配对 result，协议 error 即 reject；
 *  sessionId 用于 flatten 模式下的 page 级会话（browser 级 ws 只认 browser 域命令）。
 *  连接中途断开时 reject 未完成调用——否则对端退出会让 Promise 永远 pending */
function cdpCall(ws: WebSocket, method: string, params: Record<string, unknown>, sessionId?: string): Promise<unknown> {
    return new Promise((resolve, reject) => {
        const id = ++cdpSeq;
        const onMessage = (ev: MessageEvent) => {
            const msg = JSON.parse(String(ev.data)) as { id?: number; result?: unknown; error?: unknown };
            if (msg.id !== id) return;
            cleanup();
            if (msg.error !== undefined) reject(new Error(`cdp ${method} failed`));
            else resolve(msg.result);
        };
        const onClose = () => {
            cleanup();
            reject(new Error(`cdp ${method}: connection closed`));
        };
        const cleanup = () => {
            ws.removeEventListener("message", onMessage);
            ws.removeEventListener("close", onClose);
        };
        ws.addEventListener("message", onMessage);
        ws.addEventListener("close", onClose);
        ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
}

/** 拉起（或在跑则复用）专用 Chrome 打开目标页，用户在其中登录 */
export async function chromeLogin(url: string): Promise<ApiResult<null>> {
    const r = await ensureChrome(url);
    return "ws" in r ? { ok: true, data: null } : ensureFailure(r);
}

// CDP cookie 形状（只列要用的字段；sameSite 取值随 Chrome 版本增减，按 string 宽容收）
type CdpCookie = {
    name: string;
    value: string;
    domain: string;
    path: string;
    expires: number; // unix 秒，-1 = 会话 cookie
    httpOnly: boolean;
    secure: boolean;
    sameSite?: string;
};

/** 把专用 Chrome 里「访问该 URL 会带的 cookie」（父域 domain cookie 含内）拷进抓取分区 */
export async function chromeSync(url: string): Promise<ApiResult<{ count: number }>> {
    const ensured = await ensureChrome(url);
    if ("err" in ensured) return ensureFailure(ensured);
    let ws: WebSocket | null = null;
    try {
        ws = await cdpConnect(ensured.ws);
        // Network.getCookies 需要 page 会话：开个 about:blank 附着调用，完事关掉
        const { targetId } = (await cdpCall(ws, "Target.createTarget", { url: "about:blank" })) as {
            targetId: string;
        };
        const { sessionId } = (await cdpCall(ws, "Target.attachToTarget", { targetId, flatten: true })) as {
            sessionId: string;
        };
        const res = (await cdpCall(ws, "Network.getCookies", { urls: [url] }, sessionId)) as {
            cookies?: CdpCookie[];
        };
        void cdpCall(ws, "Target.closeTarget", { targetId }).catch(() => undefined);
        const ses = session.fromPartition(IMPORT_PARTITION);
        let count = 0;
        for (const c of res.cookies ?? []) {
            try {
                await ses.cookies.set({
                    // cookie 行没有 origin，按 domain 拼：secure cookie 必须落在 https url 上
                    url: `${c.secure ? "https" : "http"}://${c.domain.replace(/^\./, "")}${c.path || "/"}`,
                    name: c.name,
                    value: c.value,
                    domain: c.domain,
                    path: c.path || "/",
                    secure: c.secure,
                    httpOnly: c.httpOnly,
                    ...(c.expires > 0 ? { expirationDate: c.expires } : {}),
                    ...(c.sameSite === "Strict"
                        ? { sameSite: "strict" as const }
                        : c.sameSite === "Lax"
                          ? { sameSite: "lax" as const }
                          : {}),
                });
                count++;
            } catch {
                /* 单条写不进（域非法等）不挡整批 */
            }
        }
        return { ok: true, data: { count } };
    } catch {
        return { ok: false, error: { kind: "gallery", code: "chrome" } };
    } finally {
        try {
            ws?.close();
        } catch {
            /* 已断开 */
        }
    }
}

/** 清除登录态：优雅关掉专用 Chrome（CDP 官方命令）→ 等端口下线 → 删 profile → 清分区 */
export async function chromeClear(): Promise<ApiResult<null>> {
    const wsUrl = await cdpEndpoint();
    if (wsUrl) {
        try {
            const ws = await cdpConnect(wsUrl);
            // 不等 Browser.close 的 result：浏览器随即退出，回包大概率丢，等了反而挂死
            void cdpCall(ws, "Browser.close", {}).catch(() => undefined);
            ws.close();
        } catch {
            /* 关不掉（正在退出等）不挡，后面删不掉会兜底报错 */
        }
        // Windows 上 Chrome 持有 profile 文件句柄，带锁强删必失败：等端口下线（进程已退）
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline && (await cdpEndpoint())) {
            await new Promise((r) => setTimeout(r, 300));
        }
    }
    try {
        rmSync(profileDir(), { recursive: true, force: true });
    } catch {
        // 句柄异步释放的瞬态失败：歇一下重试一次，仍失败才报给用户（多半 Chrome 没关干净）
        try {
            await new Promise((r) => setTimeout(r, 500));
            rmSync(profileDir(), { recursive: true, force: true });
        } catch {
            return { ok: false, error: { kind: "gallery", code: "rm" } };
        }
    }
    await session.fromPartition(IMPORT_PARTITION).clearStorageData({ storages: ["cookies"] });
    return { ok: true, data: null };
}
