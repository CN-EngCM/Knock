import type { Msg } from "./aiSessions";

/**
 * 会话区的一个 turn：一条用户消息开启，其后的 assistant 回复（含思考与将来的工具调用）
 * 都归入同一 turn。MessageScroller 的滚动锚点与 React key 都挂在这个结构上。
 */
export type AiTurn = {
    /** 稳定 key：turn 首条消息在 msgs 里的下标。流式增量只改内容，不会改这个下标。 */
    key: string;
    messages: Msg[];
};

/**
 * 把 append-only 的 msgs 折叠成 turn。用户消息开启新 turn，assistant 消息挂到最近的
 * 用户 turn 上——单轮/多轮共用同一份结构，不必再为「一问一答一张卡」单独配对。
 * 不用整个 msgs 的数组下标做 key：turn 首条消息的下标在流式期间不变，只有追加新用户
 * 消息、清空或回滚才会增删 turn，因此流式增量不会重建 turn 列表。
 */
export function buildTurns(msgs: readonly Msg[]): AiTurn[] {
    const turns: AiTurn[] = [];
    for (let index = 0; index < msgs.length; index += 1) {
        const message = msgs[index];
        const last = turns[turns.length - 1];
        // 用户消息一律开新 turn；首条就是 assistant（异常尾巴）也单独成 turn，避免丢消息
        if (message.role === "user" || last === undefined) {
            turns.push({ key: `${message.role === "user" ? "u" : "a"}${index}`, messages: [message] });
        } else {
            last.messages.push(message);
        }
    }
    return turns;
}
