import { useSyncExternalStore } from "react";
import { api, onAiEvent } from "@/api/client";

// ── AI 会话的模块级 store ──
// 为什么放模块层：工具 tab 关闭 = 组件卸载（TOOL_SPEC §3 铁律），但 AI 助手是用户决策的
// 例外——流式回答不能因为切走/关掉 tab 就断线丢内容。把会话与在途流的登记都搬到模块级
// 内存里，事件订阅也只做一次（模块加载时），流就会在组件看不见的地方继续推进，重开即见
// 最新内容。仍遵守「应用重启从空开始」：纯内存、不落盘。
// 实现与 src/lib/experts.ts 同款最小结构：模块级变量 + 订阅集 + useSyncExternalStore，
// 不为此引入状态管理抽象（仓库硬约束 5）。

export type Msg = {
    role: "user" | "assistant";
    content: string;
    reasoning?: string;
    /** streaming=增量进行中；stopped=用户停止（已收部分保留）；缺省=完成 */
    status?: "streaming" | "stopped" | "error";
    errStatus?: number;
};

export type Conv = {
    msgs: Msg[];
    /** 会话内临时切换的模型 id（不写回专家配置；清空会话时也保留） */
    override: string | null;
};

/** useAiSessions 的快照形状：lastEid 供界面区分「前台会话更新」与「后台会话增量」 */
export type SessionsSnapshot = {
    convs: Record<number, Conv>;
    activeId: number | null;
    /** 最近一次变更所属的专家 id；setActive 视为变更自己（切换后应滚到底） */
    lastEid: number | null;
};

let convs: Record<number, Conv> = {};
let activeId: number | null = null;
let lastEid: number | null = null;

/** 在途流登记：streamId → 专家 id。并发流的唯一路由依据（每专家可各有一条流互不干扰） */
const streams = new Map<number, number>();

const subs = new Set<() => void>();
let snap: SessionsSnapshot = { convs, activeId, lastEid };

/** 每次变更换新引用并广播（useSyncExternalStore 靠引用比较跳过无效渲染） */
function commit(): void {
    snap = { convs, activeId, lastEid };
    for (const fn of subs) fn();
}

export function setActive(id: number | null): void {
    if (activeId === id) return;
    activeId = id;
    lastEid = id;
    commit();
}

/** 模块外读当前选中（事件处理器/异步回调里不想为取值多养一个 ref 时用） */
export function getActive(): number | null {
    return activeId;
}

/** 发送一轮问答的 UI 先行：user + 占位 assistant（status streaming，delta 追加进占位）。
 *  两行总是一起 push —— 单轮界面的「一问一答一卡」分组依赖这个成对约定 */
export function appendExchange(eid: number, userText: string): void {
    const cur = convs[eid] ?? { msgs: [], override: null };
    convs = {
        ...convs,
        [eid]: {
            ...cur,
            msgs: [
                ...cur.msgs,
                { role: "user", content: userText },
                { role: "assistant", content: "", status: "streaming" },
            ],
        },
    };
    lastEid = eid;
    commit();
}

/** startChat 失败时撤掉最后一对占位；只在 appendExchange 之后紧跟调用（回滚语义不通用） */
export function rollbackLastExchange(eid: number): void {
    const cur = convs[eid];
    if (!cur || cur.msgs.length < 2) return;
    convs = { ...convs, [eid]: { ...cur, msgs: cur.msgs.slice(0, -2) } };
    lastEid = eid;
    commit();
}

/** 流 id 登记进路由表：此后该流的 delta / 终结事件才写入对应会话 */
export function registerStream(eid: number, streamId: number): void {
    streams.set(streamId, eid);
}

/** 不可变改写该会话最后一条 assistant（delta 与终结态都落到它身上） */
export function patchLastAssistant(eid: number, fn: (m: Msg) => Msg): void {
    const conv = convs[eid];
    if (!conv || conv.msgs.length === 0) return;
    const idx = conv.msgs.length - 1;
    const last = conv.msgs[idx];
    if (last.role !== "assistant") return;
    const msgs = [...conv.msgs];
    msgs[idx] = fn(last);
    convs = { ...convs, [eid]: { ...conv, msgs } };
    lastEid = eid;
    commit();
}

/** 最后一条 assistant 若还在流式，就地标记「已停止」（已收部分保留）。
 *  停旧流时 abort 事件因路由换代到达不了旧占位，必须现在就标 */
export function markConvStopped(eid: number): void {
    patchLastAssistant(eid, (m) => (m.status === "streaming" ? { ...m, status: "stopped" } : m));
}

/** 停掉某位专家在途的全部流并就地标 stopped；其他专家的并发流不动（2026-08 并发决策） */
export function stopExpertStreams(eid: number): void {
    let touched = false;
    for (const [sid, owner] of streams) {
        if (owner !== eid) continue;
        void api.aiChatStop(sid);
        streams.delete(sid);
        touched = true;
    }
    // 先摘路由再标 stopped：随后到达的 abort 因查无此流被丢弃，不会二次改写
    if (touched) markConvStopped(eid);
}

/** 会话内模型临时切换：只改 conv.override 不写回专家配置 */
export function setOverride(eid: number, modelId: string | null): void {
    const cur = convs[eid] ?? { msgs: [], override: null };
    convs = { ...convs, [eid]: { msgs: cur.msgs, override: modelId } };
    lastEid = eid;
    commit();
}

/** 清空对话历史但保留 override（override 是「这个会话怎么配」，不是内容） */
export function clearConv(eid: number): void {
    const cur = convs[eid];
    if (!cur) return;
    convs = { ...convs, [eid]: { msgs: [], override: cur.override } };
    lastEid = eid;
    commit();
}

/** 专家被删除：连带停掉在途流并抹掉整个会话（无处安放的会话不留残骸） */
export function dropConv(eid: number): void {
    stopExpertStreams(eid);
    if (!(eid in convs)) return;
    const next = { ...convs };
    delete next[eid];
    convs = next;
    lastEid = eid;
    commit();
}

/** 该专家末条 assistant 是否仍在流式（发送按钮「停止」态与左栏流式标记共用） */
export function convStreaming(eid: number): boolean {
    const msgs = convs[eid]?.msgs;
    if (!msgs || msgs.length === 0) return false;
    const last = msgs[msgs.length - 1];
    return last.role === "assistant" && last.status === "streaming";
}

/** 组件侧订阅入口（照 src/lib/experts.ts 的写法） */
export function useAiSessions(): SessionsSnapshot {
    return useSyncExternalStore(
        (fn) => {
            subs.add(fn);
            return () => {
                subs.delete(fn);
            };
        },
        () => snap,
    );
}

// 模块加载时订阅一次 mp:ai-event：按 streams 路由到会话，组件卸载不影响推进。
// 查无登记的流（未注册的窗口期、已终结后的残响）一律丢弃——宁可少渲染也不错写会话。
onAiEvent((ev) => {
    const eid = streams.get(ev.streamId);
    if (eid == null) return;
    if (ev.type === "delta") {
        patchLastAssistant(eid, (m) =>
            ev.phase === "reasoning"
                ? { ...m, reasoning: (m.reasoning ?? "") + ev.text }
                : { ...m, content: m.content + ev.text },
        );
        return;
    }
    // 流终结三态：先解除路由再落状态
    streams.delete(ev.streamId);
    if (ev.type === "done") patchLastAssistant(eid, (m) => ({ ...m, status: undefined }));
    else if (ev.type === "abort") patchLastAssistant(eid, (m) => ({ ...m, status: "stopped" }));
    else patchLastAssistant(eid, (m) => ({ ...m, status: "error", errStatus: ev.status }));
});
