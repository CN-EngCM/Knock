import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { ToolId } from "../../../main/server/schemas";

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
//
// 素材按工作区投递：每个工作区一套独立的停靠区，同一个工具可以在多个工作区同时开着。
// 素材只属于「投递时的当前工作区」，所以两条通道都要比对 workspaceId——否则 A 工作区里
// 已开着的面板会收到（甚至抢走）B 工作区的素材。工作区 id 由 DockZone 经
// ToolWorkspaceContext 提供给面板里的组件，各工具代码不用感知。
export const TOOL_INPUT_EVENT = "mypage:tool-input";
export type ToolInputDetail = { tool: ToolId; text: string; expertId?: number; workspaceId: number };

/** 面板所在的工作区 id（DockZone 按面板参数提供；null = 不在工作区里直接挂载） */
export const ToolWorkspaceContext = createContext<number | null>(null);

/** 模块级待注入素材：dispatch 写入，挂载或事件送达时消费（读后即清） */
let pending: ToolInputDetail | null = null;

export function dispatchToolInput(detail: ToolInputDetail): void {
    pending = detail;
    window.dispatchEvent(new CustomEvent(TOOL_INPUT_EVENT, { detail }));
}

/** 看一眼属于自己的素材（不清除；没有则 null）。渲染必须是纯的：React 可能把一次渲染丢掉重来，
 *  若在渲染里就清 pending，重来的那次就拿不到素材了（懒加载 chunk 首次下载时实测会丢），所以清除放到提交后 */
function peekToolInput(id: ToolId, workspaceId: number | null): ToolInputDetail | null {
    return pending?.tool === id && pending.workspaceId === workspaceId ? pending : null;
}

/** 取走属于自己的素材（读后即清） */
function consumeToolInput(id: ToolId, workspaceId: number | null): void {
    if (pending?.tool === id && pending.workspaceId === workspaceId) pending = null;
}

/** 裸开工具（不带素材）时清掉可能残留的旧素材，避免陈旧注入 */
export function clearToolInput(id: ToolId, workspaceId: number): void {
    if (pending?.tool === id && pending.workspaceId === workspaceId) pending = null;
}

// ── 聚焦事件：已开着的面板被再次「打开」时组件不会重新挂载，也收不到 dockview 的激活事件，
// 需要一个同样按工作区投递的信号让它把焦点放回输入框（目前只有便签监听）──
export const TOOL_FOCUS_EVENT = "mypage:tool-focus";
type ToolFocusDetail = { tool: ToolId; workspaceId: number };

export function dispatchToolFocus(tool: ToolId, workspaceId: number): void {
    window.dispatchEvent(new CustomEvent<ToolFocusDetail>(TOOL_FOCUS_EVENT, { detail: { tool, workspaceId } }));
}

/** 订阅本工作区里本工具的聚焦信号；回调走 ref，调用方不必稳定引用 */
export function useToolFocus(id: ToolId, onFocus: () => void): void {
    const workspaceId = useContext(ToolWorkspaceContext);
    const cb = useRef(onFocus);
    cb.current = onFocus;
    useEffect(() => {
        const h = (e: Event) => {
            const d = (e as CustomEvent<ToolFocusDetail>).detail;
            if (d.tool === id && d.workspaceId === workspaceId) cb.current();
        };
        window.addEventListener(TOOL_FOCUS_EVENT, h);
        return () => window.removeEventListener(TOOL_FOCUS_EVENT, h);
    }, [id, workspaceId]);
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

/** 工具的受控文本输入：挂载吃 pending + 实时事件注入，返回 text 与注入信号。
 *  fallback 是没有素材时的默认内容；不能塞进 initial，initial 非 null 会跳过挂载通道，首次打开就收不到素材 */
export function useToolInput(id: ToolId, initial?: string | null, fallback = ""): ToolInput {
    const workspaceId = useContext(ToolWorkspaceContext);
    // 首次渲染的消费结果只取一次（useState 初始化器同款约束）：initial 非 null
    // 视为直挂场景优先用之，此时不动 pending（与旧实现行为一致）
    const [first] = useState(() => (initial != null ? null : peekToolInput(id, workspaceId)));
    const [text, setText] = useState(() => first?.text ?? initial ?? fallback);
    const [expertId, setExpertId] = useState<number | undefined>(first?.expertId);
    const [seq, setSeq] = useState(first ? 1 : 0);

    // 提交后才清 pending；只清自己读到的那份，期间新投递的素材不受影响
    useEffect(() => {
        if (first && pending === first) pending = null;
    }, [first]);

    useEffect(() => {
        const h = (e: Event) => {
            const d = (e as CustomEvent<ToolInputDetail>).detail;
            if (d.tool === id && d.workspaceId === workspaceId) {
                consumeToolInput(id, workspaceId); // 事件送达同样清 pending
                setText(d.text);
                setExpertId(d.expertId);
                setSeq((n) => n + 1);
            }
        };
        window.addEventListener(TOOL_INPUT_EVENT, h);
        return () => window.removeEventListener(TOOL_INPUT_EVENT, h);
    }, [id, workspaceId]);

    return { text, setText, expertId, seq };
}
