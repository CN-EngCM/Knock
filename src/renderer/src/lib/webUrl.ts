/**
 * 把地址栏里的文字整理成可打开的 http/https 地址；不是网址返回 null。
 * 不做搜索：第一版没有接搜索引擎，不是网址就直接提示，不猜用户想搜什么。
 */
export function normalizeUrl(input: string): string | null {
    const text = input.trim();
    if (!text || /\s/.test(text)) return null;
    // 带 :// 才算自带协议（localhost:3000 里的冒号不算）；没写协议的补 https://
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`;
    let url: URL;
    try {
        url = new URL(withScheme);
    } catch {
        return null;
    }
    // 只放行 http/https：file:// 之类的在这里挡掉
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    // 单个词（如 hello）不当网址：要有点号、是 localhost，或是 IPv6 字面量
    const host = url.hostname;
    if (!host.includes(".") && host !== "localhost" && !host.startsWith("[")) return null;
    return url.href;
}

/** 面板标签的初始标题：取域名，页面标题到了再由页面自己改 */
export function hostOf(url: string): string {
    try {
        return new URL(url).hostname || url;
    } catch {
        return url;
    }
}
