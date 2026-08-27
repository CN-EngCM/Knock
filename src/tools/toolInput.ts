import { useEffect, useState } from "react";
import type { ToolId } from "../../server/schemas";

// ── 工具输入注入（素材流）的通道收口 ──
// 素材从搜索框流向工具有两条通道，覆盖两种时序：
// 1) 挂载时读 pending——tab 未打开（或懒加载 chunk 还在路上）时，素材先落在
//    模块级变量里，工具组件真正挂载那一刻（useState 初始化）取走并清掉。
//    不经 React 状态/props，因此不受 Suspense 异步挂载影响——旧实现把初值放
//    props 里，首次打开要等 chunk 下载，props 先被「tab 已出现」的清理逻辑置空，
//    素材在挂载前就丢了（首次打开注入失败的根因）；
// 2) 实时事件——tab 已开着、组件早已挂载，挂载通道够不着，用 window 事件送达
//    （送达即清 pending，保持「读后即清」的单次消费语义）。
// 工具组件统一通过 useToolInput 接入，两个通道都对组件透明。
export const TOOL_INPUT_EVENT = "mypage:tool-input";
export type ToolInputDetail = { tool: ToolId; text: string; expertId?: number };

/** 模块级待注入素材：dispatch 写入，挂载或事件送达时消费（读后即清） */
let pending: ToolInputDetail | null = null;

export function dispatchToolInput(detail: ToolInputDetail): void {
    pending = detail;
    window.dispatchEvent(new CustomEvent(TOOL_INPUT_EVENT, { detail }));
}

/** 挂载时取走属于自己的素材（读后即清；没有则 null） */
function consumeToolInput(id: ToolId): ToolInputDetail | null {
    if (pending?.tool === id) {
        const detail = pending;
        pending = null;
        return detail;
    }
    return null;
}

/** 裸开工具（不带素材）时清掉可能残留的旧素材，避免陈旧注入 */
export function clearToolInput(id: ToolId): void {
    if (pending?.tool === id) pending = null;
}

// hook 的返回值：text 是受控文本；expertId 取最近一次注入携带值；
// seq 是注入序号——每送抵一次注入就 +1（含挂载消费的那次）。单独给 seq 是因为
// AiTool 需要「这是新注入」的边沿信号来触发自动发送，光看 text 区分不了
// 「用户清空输入后又被注入了相同文本」；其他工具只用 text/setText 即可。
type ToolInput = {
    text: string;
    setText: (v: string) => void;
    expertId: number | undefined;
    seq: number;
};

/** 工具的受控文本输入：挂载吃 pending + 实时事件注入，返回 text 与注入信号 */
export function useToolInput(id: ToolId, initial?: string | null): ToolInput {
    // 首次渲染的消费结果只取一次（useState 初始化器同款约束）：initial 非 null
    // 视为直挂场景优先用之，此时不动 pending（与旧实现行为一致）
    const [first] = useState(() => (initial != null ? null : consumeToolInput(id)));
    const [text, setText] = useState(() => first?.text ?? initial ?? "");
    const [expertId, setExpertId] = useState<number | undefined>(first?.expertId);
    const [seq, setSeq] = useState(first ? 1 : 0);

    useEffect(() => {
        const h = (e: Event) => {
            const d = (e as CustomEvent<ToolInputDetail>).detail;
            if (d.tool === id) {
                consumeToolInput(id); // 事件送达同样清 pending
                setText(d.text);
                setExpertId(d.expertId);
                setSeq((n) => n + 1);
            }
        };
        window.addEventListener(TOOL_INPUT_EVENT, h);
        return () => window.removeEventListener(TOOL_INPUT_EVENT, h);
    }, [id]);

    return { text, setText, expertId, seq };
}
