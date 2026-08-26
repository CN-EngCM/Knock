import { createHash, randomUUID } from "node:crypto";
import type { TranslateInput } from "./schemas";
import { getSetting } from "./util/settings";

// ── 有道文本翻译 API（工具 translate 的后端）──
// 接口 https://openapi.youdao.com/api，POST form 编码。
// 签名 v3：sha256(appKey + input + salt + curtime + appSecret)；salt 用 UUID，
// 同一 salt+curtime 重复提交会被判为重放攻击拒绝。
// input 截断规则（官方约定）：长度 ≤20 原样，否则「前 10 字符 + 总长 + 后 10 字符」。
// 长度按 UTF-16 码元数（与官方 JS/Java demo 的 q.length 一致，含 emoji 时不能换成码点数）。
// v3.0.0（2024-04）起接口下线了词典正文（basic/web 字段），成功响应只剩
// translation 主译文、l 语言对与词典网页 deeplink——查词体验靠 webdict 链接兜底。

const API_URL = "https://openapi.youdao.com/api";
const TIMEOUT_MS = 8000;

export type TranslateResult = {
    /** 主译文（translation 多条时按行拼接） */
    text: string;
    /** 实际使用的源语言（l = "from2to" 拆出；auto 时即检测结果）。可能是不在常用表里的语言代码，前端按需兜底 */
    detected: string;
    /** 词典网页链接（查词场景跳转用，普通句段翻译可能没有） */
    dictUrl?: string;
};

export type YoudaoFail =
    | { kind: "not-configured" } // settings 里密钥没配全
    | { kind: "network" } // 请求发不出去/超时/响应不是 JSON
    | { kind: "api"; code: string }; // 有道返回 errorCode ≠ 0，code 原样交给前端释义

export type YoudaoResult = { ok: true; data: TranslateResult } | { ok: false; error: YoudaoFail };

/** 官方截断规则：>20 字符时签名用「前 10 + 长度 + 后 10」替代原文 */
function truncateForSign(q: string): string {
    if (q.length <= 20) return q;
    return `${q.slice(0, 10)}${q.length}${q.slice(q.length - 10)}`;
}

export async function youdaoTranslate(input: TranslateInput): Promise<YoudaoResult> {
    // 每次请求现读库：设置页改完密钥立即生效，无需重启
    const appKey = getSetting("youdaoAppKey", "");
    const secret = getSetting("youdaoAppSecret", "");
    if (!appKey || !secret) return { ok: false, error: { kind: "not-configured" } };

    const curtime = Math.floor(Date.now() / 1000).toString();
    const salt = randomUUID();
    const sign = createHash("sha256")
        .update(appKey + truncateForSign(input.text) + salt + curtime + secret)
        .digest("hex");

    const networkFail = { ok: false, error: { kind: "network" } } as const;
    let res: Response;
    try {
        // URLSearchParams 作 body 自动带 form 编码的 Content-Type
        res = await fetch(API_URL, {
            method: "POST",
            body: new URLSearchParams({
                q: input.text,
                from: input.from,
                to: input.to,
                appKey,
                salt,
                sign,
                signType: "v3",
                curtime,
            }),
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });
    } catch {
        return networkFail;
    }
    if (!res.ok) return networkFail;

    let payload: {
        errorCode?: string;
        translation?: string[];
        l?: string;
        webdict?: { url?: string };
    };
    try {
        // json() 返回 any，赋给带类型标注的变量即完成收窄
        payload = await res.json();
    } catch {
        return networkFail;
    }
    if (!payload.errorCode) return networkFail;
    if (payload.errorCode !== "0") {
        return { ok: false, error: { kind: "api", code: payload.errorCode } };
    }

    // l 形如 "zh-CHS2en"：按约定的 "2" 分隔拆出实际源语言
    const detected = (payload.l ?? "").split("2")[0] || input.from;
    return {
        ok: true,
        data: {
            text: (payload.translation ?? []).join("\n"),
            detected,
            dictUrl: payload.webdict?.url || undefined,
        },
    };
}
