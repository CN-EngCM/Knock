import { useEffect, useState } from "react";
import type { ToolId } from "../../server/schemas";

// ── 工具输入注入（v2.3 素材流）的通道收口 ──
// 素材从搜索框流向工具输入框有两条路径，覆盖两种时序：
// 1) 挂载初值——tab 未打开时，App 记 pending，ToolsZone 首次挂载该工具时
//    作为 initialInput 传入（事件先于挂载派发会丢，必须有这条兜底）；
// 2) 实时事件——tab 已开着、组件早已挂载，初值通道够不着，用 window 事件送达。
// 工具组件统一通过 useToolInput 接入，两个通道都对组件透明。
export const TOOL_INPUT_EVENT = "mypage:tool-input";
export type ToolInputDetail = { tool: ToolId; text: string };

export function dispatchToolInput(detail: ToolInputDetail): void {
    window.dispatchEvent(new CustomEvent(TOOL_INPUT_EVENT, { detail }));
}

/** 工具的受控文本输入：初值 + 事件注入，返回 [text, setText] */
export function useToolInput(id: ToolId, initial?: string | null): [string, (v: string) => void] {
    const [text, setText] = useState(initial ?? "");
    useEffect(() => {
        const h = (e: Event) => {
            const d = (e as CustomEvent<ToolInputDetail>).detail;
            if (d.tool === id) setText(d.text);
        };
        window.addEventListener(TOOL_INPUT_EVENT, h);
        return () => window.removeEventListener(TOOL_INPUT_EVENT, h);
    }, [id]);
    return [text, setText];
}
