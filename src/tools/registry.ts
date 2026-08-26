// ── 内置工具注册表（v2.2）──
// 工具组件一律 React.lazy：对应 chunk 只在工具首次打开时加载；
// tab 关闭即卸载组件（ToolsZone 不再渲染它），重库随引用释放——
// 这是「工具多了也不卡」的两个前提：懒加载 + 关闭即卸载。
// 新增工具 = 这里加一行 + i18n 补 nameKey/descKey + tools/ 下实现组件。
import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import type { MessageKey } from "@/i18n/zh";
// ToolId 的事实来源在 server/schemas.TOOL_IDS（别名存库需要前后端共享 id 词汇）；
// 此处仅 type import（编译期擦除），不会把 server 代码带进渲染进程
import type { ToolId } from "../../server/schemas";

export type { ToolId };

export type ToolMeta = {
    id: ToolId;
    nameKey: MessageKey;
    descKey: MessageKey;
    /** 能吃文本素材的工具：搜索框推荐区展示，选中时把素材注入其输入框 */
    acceptsText?: boolean;
    Component: LazyExoticComponent<ComponentType<{ initialInput?: string | null }>>;
};

export const TOOLS: readonly ToolMeta[] = [
    {
        id: "json",
        nameKey: "tool.json.name",
        descKey: "tool.json.desc",
        acceptsText: true,
        Component: lazy(() => import("./JsonTool")),
    },
    {
        id: "qr",
        nameKey: "tool.qr.name",
        descKey: "tool.qr.desc",
        acceptsText: true,
        Component: lazy(() => import("./QrTool")),
    },
    { id: "scan", nameKey: "tool.scan.name", descKey: "tool.scan.desc", Component: lazy(() => import("./ScanTool")) },
];

export function toolMeta(id: ToolId): ToolMeta {
    const meta = TOOLS.find((t) => t.id === id);
    if (!meta) throw new Error(`unknown tool: ${id}`);
    return meta;
}
