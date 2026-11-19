/** 补全缺省协议，校验后返回地址与解析结果。 */
function parseWebAddress(input: string): { address: string; url: URL } | null {
    const text = input.trim();
    if (!text || /[\t\r\n]/.test(text)) return null;
    // 带 :// 才算自带协议（localhost:3000 里的冒号不算）；没写协议的补 https://
    const address = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`;
    let url: URL;
    try {
        url = new URL(address);
    } catch {
        return null;
    }
    // 只放行 http/https：file:// 之类的在这里挡掉
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return { address, url };
}

/** 网页收藏支持内网主机名，保存时保留用户输入的地址形式。 */
export function normalizeBookmarkUrl(input: string): string | null {
    const parsed = parseWebAddress(input);
    // Chromium 可能把主机名中的空格编码成 %20，解析成功仍不能用来访问。
    if (!parsed || parsed.url.hostname.includes("%")) return null;
    return parsed.address;
}

/** 把地址栏里的文字整理成可打开的网址，其他文字返回 null。 */
export function normalizeUrl(input: string): string | null {
    if (/\s/.test(input.trim())) return null;
    const parsed = parseWebAddress(input);
    if (!parsed) return null;
    // 单个词（如 hello）不当网址：要有点号、是 localhost，或是 IPv6 字面量
    const host = parsed.url.hostname;
    if (!host.includes(".") && host !== "localhost" && !host.startsWith("[")) return null;
    return parsed.url.href;
}

/** 面板标签的初始标题：取域名，页面标题到了再由页面自己改 */
export function hostOf(url: string): string {
    try {
        return new URL(url).hostname || url;
    } catch {
        return url;
    }
}
