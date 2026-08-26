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
export type ToolInputDetail = { tool: ToolId; text: string };

/** 模块级待注入素材：dispatch 写入，挂载或事件送达时消费（读后即清） */
let pending: ToolInputDetail | null = null;

export function dispatchToolInput(detail: ToolInputDetail): void {
    pending = detail;
    window.dispatchEvent(new CustomEvent(TOOL_INPUT_EVENT, { detail }));
}

/** 挂载时取走属于自己的素材（读后即清；没有则 null） */
function consumeToolInput(id: ToolId): string | null {
    if (pending?.tool === id) {
        const text = pending.text;
        pending = null;
        return text;
    }
    return null;
}

/** 裸开工具（不带素材）时清掉可能残留的旧素材，避免陈旧注入 */
export function clearToolInput(id: ToolId): void {
    if (pending?.tool === id) pending = null;
}

/** 工具的受控文本输入：挂载吃 pending + 实时事件注入，返回 [text, setText] */
export function useToolInput(id: ToolId, initial?: string | null): [string, (v: string) => void] {
    const [text, setText] = useState(() => initial ?? consumeToolInput(id) ?? "");
    useEffect(() => {
        const h = (e: Event) => {
            const d = (e as CustomEvent<ToolInputDetail>).detail;
            if (d.tool === id) {
                consumeToolInput(id); // 事件送达同样清 pending
                setText(d.text);
            }
        };
        window.addEventListener(TOOL_INPUT_EVENT, h);
        return () => window.removeEventListener(TOOL_INPUT_EVENT, h);
    }, [id]);
    return [text, setText];
}
