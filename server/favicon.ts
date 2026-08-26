import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "./util/dataDir";
import { getSetting } from "./util/settings";

// ── favicon 拉取与本地缓存 ──
// 策略（需求 §3.1）：优先直连站点自身 /favicon.ico（国内网络最可靠），
// 失败再走可配置的公共图标服务兜底（settings.favicon_mirror，默认 DuckDuckGo，
// 国内可能不可达——不可达就退化为无图标，不影响使用）。

const CACHE_DIR = join(dataDir(), "favicons");

function faviconPath(domain: string): string {
    return join(CACHE_DIR, `${domain}.img`);
}

/** 带超时的 GET，返回响应体；任何失败返回 null（调用方只关心成功与否） */
async function fetchBuffer(url: string, timeoutMs = 5000): Promise<{ buf: Buffer; mime: string } | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, {
            signal: controller.signal,
            redirect: "follow",
            headers: { "user-agent": "Mozilla/5.0 (Knock favicon fetcher)" },
        });
        if (!res.ok) return null;
        const mime = res.headers.get("content-type") ?? "";
        // 站点常把 404 页配 text/html 返回 200，靠类型过滤掉
        if (mime && !mime.startsWith("image/") && !mime.includes("octet-stream")) return null;
        const buf = Buffer.from(await res.arrayBuffer());
        // 太小是坏数据（占位 1px 图等），太大不值得缓存
        if (buf.length < 32 || buf.length > 512 * 1024) return null;
        return { buf, mime };
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

/** 依 magic bytes 判断图片类型，让缓存文件以正确的 Content-Type 对外服务 */
function sniffMime(buf: Buffer): string {
    if (buf.subarray(0, 4).toString("hex") === "89504e47") return "image/png";
    if (buf.subarray(0, 3).toString("ascii") === "GIF") return "image/gif";
    if (buf.subarray(0, 2).toString("hex") === "ffd8") return "image/jpeg";
    if (buf.subarray(0, 2).toString("ascii") === "BM") return "image/bmp";
    if (
        buf
            .subarray(0, 5)
            .toString("ascii")
            .match(/^<\?xml|<svg/i)
    )
        return "image/svg+xml";
    return "image/x-icon";
}

/** 读取缓存的 favicon；没有则按策略抓取并落盘，彻底失败返回 null */
export async function loadFavicon(domain: string): Promise<{ buf: Buffer; mime: string } | null> {
    const cached = faviconPath(domain);
    if (existsSync(cached)) {
        const buf = readFileSync(cached);
        // 空文件是「已知失败」的负缓存标记，直接判失败
        if (buf.length === 0) return null;
        return { buf, mime: sniffMime(buf) };
    }

    // 1) 直连站点自身 favicon
    const direct = await fetchBuffer(`https://${domain}/favicon.ico`);
    if (direct) return save(cached, direct.buf);

    // 2) 公共图标服务兜底（settings 可换镜像）
    const mirror = getSetting("favicon_mirror", "https://icons.duckduckgo.com/ip3/{domain}.ico");
    const viaMirror = await fetchBuffer(mirror.replaceAll("{domain}", domain));
    if (viaMirror) return save(cached, viaMirror.buf);

    // 3) 负结果也落盘一个空标记文件，避免每次刷新都重试已知失败的域名。
    //    空文件读取时按 0 字节处理，接口返回 404。
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(cached, Buffer.alloc(0));
    return null;

    function save(path: string, buf: Buffer): { buf: Buffer; mime: string } {
        mkdirSync(CACHE_DIR, { recursive: true });
        writeFileSync(path, buf);
        return { buf, mime: sniffMime(buf) };
    }
}
