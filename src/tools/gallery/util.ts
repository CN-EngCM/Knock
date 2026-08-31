// 图库前端共享的小工具函数。

// 拖拽导入的扩展名过滤词表：与 server/schemas.GALLERY_FORMATS 手工对齐
// （渲染进程禁止运行时 import server/ 的值，zod 在主进程仍会兜底）。
export const FORMATS: readonly string[] = ["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg"];

/** 极简插值：把「{name}/{n}」占位符替换成变量。t() 不带参数位，句子里的数字/名字用它填 */
export function fmt(s: string, vars: Record<string, string | number>): string {
    return s.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ""));
}

/** 路径扩展名（小写；无扩展名返回空串） */
export function extOf(p: string): string {
    const dot = p.lastIndexOf(".");
    return dot < 0 ? "" : p.slice(dot + 1).toLowerCase();
}

/** 字节人性化（与 FileSearchTool 的 fmtSize 同款算法，独立复制避免跨工具耦合） */
export function fmtBytes(n: number): string {
    if (n <= 0) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let v = n;
    let i = 0;
    while (v >= 1024 && i < units.length - 1) {
        v /= 1024;
        i++;
    }
    return `${i === 0 || v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

/** 导入时间（ms 时间戳）→ 本地「YYYY-MM-DD HH:mm」 */
export function fmtDateTime(ms: number): string {
    const d = new Date(ms);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
