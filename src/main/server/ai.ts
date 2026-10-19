import { getSetting } from "./util/settings";
import type { AiChatInput, AiModelConfig } from "./schemas";
// type-only import 编译期擦除，不构成运行时循环依赖
import type { ApiResult } from "./api";

// ── AI 助手：OpenAI 兼容的 chat/completions 流式对接（工具 ai 的后端）──
// 请求在主进程发（密钥不进渲染包）；数据走「启动 → 事件下行 → 停止」三件套，
// 与终端 pty 同款模式：startChat 立即返回 streamId，增量经 setAiSink 注入的
// 出口推给渲染进程（src/main/index.ts 转发到 mp:ai-event 频道）。
//
// 两家供应商（v1 只做 OpenAI 兼容协议，端点见 PROVIDER_BASE）的 SSE 帧一致：
//   data: {...} 逐行下发，data: [DONE] 结束。delta 分两相——
//   choices[0].delta.reasoning_content（思考相，先流出）与 delta.content（回答相，后流出）。
// 思考型模型思考阶段可能长达数十秒且两字段都可能缺省/null，必须 typeof === "string"
// 且非空才发事件，否则界面在思考期间表现为假死。

/** 主进程 → 渲染进程的事件；phase 区分思考相与回答相 */
export type AiEvent =
    | { type: "delta"; streamId: number; phase: "reasoning" | "content"; text: string }
    | { type: "done"; streamId: number }
    | { type: "abort"; streamId: number }
    | { type: "error"; streamId: number; status?: number };

// server 层不持有 BrowserWindow：出口由 src/main/index.ts 注入
let emit: ((e: AiEvent) => void) | null = null;
export function setAiSink(fn: (e: AiEvent) => void): void {
    emit = fn;
}

const PROVIDER_BASE: Record<string, string> = {
    deepseek: "https://api.deepseek.com",
    zhipu: "https://open.bigmodel.cn/api/paas/v4",
};

// 首字节看门狗 30s：连接挂起/网络黑洞时的交代通道；流开始后不设总超时
// （长回答可能跑几分钟，中途掐断比等待更伤）
const FIRST_BYTE_TIMEOUT_MS = 30_000;
const TEST_TIMEOUT_MS = 15_000;

const streams = new Map<number, AbortController>();
let nextStreamId = 1;

function endpoint(cfg: AiModelConfig): string {
    return `${PROVIDER_BASE[cfg.provider]}/chat/completions`;
}

function headers(apiKey: string): Record<string, string> {
    return { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` };
}

/** 现读 settings 键 aiModels 找指定配置——每次对话现读，设置页改完即生效（同 youdao 先例） */
function findModel(modelId: string): AiModelConfig | null {
    let list: unknown;
    try {
        list = JSON.parse(getSetting("aiModels", "[]"));
    } catch {
        return null; // 坏数据当空表，等设置页重存修复
    }
    if (!Array.isArray(list)) return null;
    return (list as AiModelConfig[]).find((m) => m.id === modelId) ?? null;
}

/**
 * 发起一轮对话：立即返回 streamId，增量经事件出口推送。
 * 模型 id 不存在按 not-found 返回（提示用户去绑定/检查模型列表）。
 */
export function startChat(input: AiChatInput): ApiResult<{ streamId: number }> {
    const cfg = findModel(input.modelId);
    if (!cfg) return { ok: false, error: { kind: "not-found" } };
    const streamId = nextStreamId++;
    const controller = new AbortController();
    streams.set(streamId, controller);
    // 刻意不 await：请求-响应契约只交付 streamId，泵在后路异步跑
    void pump(streamId, cfg, input, controller);
    return { ok: true, data: { streamId } };
}

/** SSE 行扫描：从缓冲取一行（容忍 \r\n），载荷去掉 data: 前缀；非 data 行忽略 */
function nextDataLine(buf: string): { payload: string; rest: string } | null {
    const nl = buf.indexOf("\n");
    if (nl < 0) return null;
    const line = buf.slice(0, nl).replace(/\r$/, "");
    const rest = buf.slice(nl + 1);
    return line.startsWith("data:") ? { payload: line.slice(5).trim(), rest } : { payload: "", rest };
}

async function pump(
    streamId: number,
    cfg: AiModelConfig,
    input: AiChatInput,
    controller: AbortController,
): Promise<void> {
    // 看门狗只在首字节前武装：收到第一个有效 delta（或已进入错误分支）即拆除。
    // 标志位区分「超时掐断」与「用户停止」——同为 AbortError，语义却要分开上报。
    let timedOut = false;
    const watchdog = setTimeout(() => {
        timedOut = true;
        controller.abort();
    }, FIRST_BYTE_TIMEOUT_MS);

    try {
        const res = await fetch(endpoint(cfg), {
            method: "POST",
            headers: headers(cfg.apiKey),
            body: JSON.stringify({
                model: cfg.model,
                stream: true,
                messages: [{ role: "system", content: input.system }, ...input.messages],
                // 两家供应商同名参数 reasoning_effort，词表取交集直传不映射；default = 不发
                // 该参数（服务端默认强度）——事实依据见 schemas.AI_EFFORT_IDS 注释
                ...(input.effort !== "default" ? { reasoning_effort: input.effort } : {}),
            }),
            signal: controller.signal,
        });
        if (!res.ok) {
            // HTTP 错误体是 JSON（如 {"error":{"message":...}}），原文对用户无意义，
            // 只带状态码回去由前端映射成可读文案
            void res.body?.cancel().catch(() => {});
            emit?.({ type: "error", streamId, status: res.status });
            return;
        }
        const reader = res.body?.getReader();
        if (!reader) {
            emit?.({ type: "error", streamId });
            return;
        }

        clearTimeout(watchdog); // 已拿到响应头与 body 流，看门狗使命结束
        // 解码器必须每泵独立：跨 chunk 的多字节字符靠 {stream:true} 维持状态，
        // 并发会话共用一个实例会让半截 UTF-8 序列串台
        const decoder = new TextDecoder();
        let buf = "";
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            for (;;) {
                const next = nextDataLine(buf);
                if (!next) break;
                buf = next.rest;
                if (!next.payload) continue;
                if (next.payload === "[DONE]") {
                    // 协议收尾后主动 cancel：不让服务器残余帧/连接悬挂占资源
                    void reader.cancel().catch(() => {});
                    emit?.({ type: "done", streamId });
                    return;
                }
                // 单行 JSON 解析失败只丢该帧：流式传输中偶发的残帧不值得整场报废
                let frame: {
                    choices?: { delta?: { content?: unknown; reasoning_content?: unknown } }[];
                };
                try {
                    frame = JSON.parse(next.payload);
                } catch {
                    continue;
                }
                const delta = frame.choices?.[0]?.delta;
                if (!delta) continue;
                const reasoning = delta.reasoning_content;
                if (typeof reasoning === "string" && reasoning) {
                    emit?.({ type: "delta", streamId, phase: "reasoning", text: reasoning });
                }
                const content = delta.content;
                if (typeof content === "string" && content) {
                    emit?.({ type: "delta", streamId, phase: "content", text: content });
                }
            }
        }
        // 服务端没发 [DONE] 就断流（未中断也无 error）：当作正常完成收尾
        emit?.({ type: "done", streamId });
    } catch (err) {
        if (!timedOut && isAbortError(err)) {
            emit?.({ type: "abort", streamId }); // 用户停止
        } else {
            // 网络层失败 / 首字节超时：无 status（前端映射为网络类文案）
            emit?.({ type: "error", streamId });
        }
    } finally {
        clearTimeout(watchdog); // 未拆过也得清（防泄漏），重复 clear 无害
        streams.delete(streamId);
    }
}

function isAbortError(err: unknown): boolean {
    return err instanceof Error && err.name === "AbortError";
}

/** 中断进行中的对话；找不到（已结束/非法 id）静默成功——停止操作天然幂等 */
export function stopChat(streamId: number): ApiResult<null> {
    streams.get(streamId)?.abort();
    return { ok: true, data: null };
}

/** 测试连接：同端点非流式 mini 请求；cfg 是设置页当前编辑值，测完即弃、不落库 */
export async function testModel(cfg: AiModelConfig): Promise<ApiResult<null>> {
    let res: Response;
    try {
        res = await fetch(endpoint(cfg), {
            method: "POST",
            headers: headers(cfg.apiKey),
            body: JSON.stringify({ model: cfg.model, messages: [{ role: "user", content: "reply: pong" }] }),
            signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
        });
    } catch {
        return { ok: false, error: { kind: "ai" } }; // 网络层失败/超时，无 status
    }
    void res.body?.cancel().catch(() => {});
    return res.ok ? { ok: true, data: null } : { ok: false, error: { kind: "ai", status: res.status } };
}
