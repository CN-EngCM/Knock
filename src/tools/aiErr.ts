import type { MessageKey } from "@/i18n/zh";

// LLM 供应商 HTTP 状态码 → 文案 key 的映射（工具内消息流与设置页「测试连接」共用）。
// 只收常见状态；未收录的返回 null，由调用方按「请求失败：<status>」兜底拼接——
// 上游状态码集合不封闭，不穷举。
export function aiErrKey(status?: number): MessageKey | null {
    if (status === undefined) return "ai.err.network"; // 无 status = 网络层失败或超时
    if (status === 401 || status === 403) return "ai.err.auth";
    if (status === 429) return "ai.err.limit";
    return null;
}
