import type { MessageKey } from "@/i18n/zh";

// 有道错误码 → 文案 key 的映射（翻译工具与设置页「测试连接」共用）。
// 节选常见码，官方完整表见接口文档的错误代码章节；未收录的码返回 null，
// 由调用方显示原始码兜底——不穷举 100+ 码。
const MAP: Record<string, MessageKey> = {
    "101": "translate.err.101",
    "102": "translate.err.102",
    "103": "translate.err.103",
    "108": "translate.err.108",
    "110": "translate.err.110",
    "111": "translate.err.111",
    "112": "translate.err.112",
    "113": "translate.err.113",
    "202": "translate.err.202",
    "203": "translate.err.203",
    "206": "translate.err.206",
    "207": "translate.err.207",
    "401": "translate.err.401",
    "411": "translate.err.411",
    network: "translate.err.network",
};

export function youdaoErrKey(code: string): MessageKey | null {
    return MAP[code] ?? null;
}
