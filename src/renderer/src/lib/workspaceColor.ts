// ── 工作区标识色 ──
// 侧栏标签、选中描边与停靠区边框共用同一份取色规则：一处定义，三处引用，
// 避免调色板散落在组件里各写一份、改色时漏掉某处。
// 没手选颜色的普通工作区按 id 取色而不是按列表下标——删掉一个工作区后，其余工作区的颜色不会跟着变。
// 用户手选的颜色存在工作区行的 color 里（存色值不存下标，调色板日后增删也不影响已选的）；
// 右键菜单里的可选色块就是这份调色板。
export const WORKSPACE_PALETTE = [
    "#ff2d78",
    "#ff7a1a",
    "#f5a300",
    "#a3e635",
    "#22c55e",
    "#14b8a6",
    "#22d3ee",
    "#4f7cff",
    "#8b5cf6",
    "#d946ef",
];

// 自带的临时工作区不参与调色循环：中性灰让它与用户建的工作区一眼区分开
const BUILTIN_COLOR = "var(--muted-foreground)";

/** 只依赖取色需要的字段，调用方不必传整行工作区数据 */
type ColorSource = { id: number; builtin: boolean; color: string | null };

export function workspaceColor(workspace: ColorSource): string {
    if (workspace.builtin) return BUILTIN_COLOR;
    return workspace.color ?? WORKSPACE_PALETTE[workspace.id % WORKSPACE_PALETTE.length];
}

// 描边用同色半透明：实色 1px 在高饱和色下会显得生硬，半透明叠在底色上更接近「染了一层光」。
// 强度交给 CSS 令牌按主题给值（浅色背景要更实一点才看得清）。
// 标签内描边与停靠区外描边共用同一个强度：两处同色，切换工作区时整块区域一眼呼应
export function workspaceStroke(workspace: ColorSource): string {
    return `color-mix(in srgb, ${workspaceColor(workspace)} var(--ws-stroke), transparent)`;
}
