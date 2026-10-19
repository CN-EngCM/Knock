// ── 内置工具注册表（v2.2）──
// 单个标签的工具组件使用 React.lazy，终端宿主由 App 懒加载；
// tab 关闭即卸载组件（ToolsZone 不再渲染它），重库随引用释放——
// 这是「工具多了也不卡」的两个前提：懒加载 + 关闭即卸载。
// 新增工具 = 这里加一行 + i18n 补 nameKey/descKey + tools/ 下实现组件。
import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import type { LucideIcon } from "lucide-react";
import { Braces, QrCode, ScanLine, FileSearch, Languages, Sparkles, Images, SquareTerminal } from "lucide-react";
import type { MessageKey } from "@/i18n/zh";
// ToolId 的事实来源在 server/schemas.TOOL_IDS（别名存库需要前后端共享 id 词汇）；
// 此处仅 type import（编译期擦除），不会把 server 代码带进渲染进程
import type { ToolId } from "../../../main/server/schemas";

export type { ToolId };

export type ToolMeta = {
    id: ToolId;
    nameKey: MessageKey;
    descKey: MessageKey;
    /** 工具入口图标（工具首页卡片/工具菜单共用） */
    icon: LucideIcon;
    /** 能吃文本素材的工具：搜索框推荐区展示，选中时把素材注入其输入框 */
    acceptsText?: boolean;
    /** 终端由 App 新建会话并交给独立宿主管理，其余工具按标签挂载组件 */
    Component: LazyExoticComponent<ComponentType<{ initialInput?: string | null; openSettings?: () => void }>> | null;
};

export const TOOLS: readonly ToolMeta[] = [
    {
        id: "json",
        nameKey: "tool.json.name",
        descKey: "tool.json.desc",
        icon: Braces,
        acceptsText: true,
        Component: lazy(() => import("./JsonTool")),
    },
    {
        id: "qr",
        nameKey: "tool.qr.name",
        descKey: "tool.qr.desc",
        icon: QrCode,
        acceptsText: true,
        Component: lazy(() => import("./QrTool")),
    },
    {
        id: "scan",
        nameKey: "tool.scan.name",
        descKey: "tool.scan.desc",
        icon: ScanLine,
        Component: lazy(() => import("./ScanTool")),
    },
    {
        id: "files",
        nameKey: "tool.files.name",
        descKey: "tool.files.desc",
        icon: FileSearch,
        acceptsText: true,
        Component: lazy(() => import("./FileSearchTool")),
    },
    {
        id: "translate",
        nameKey: "tool.translate.name",
        descKey: "tool.translate.desc",
        icon: Languages,
        acceptsText: true,
        Component: lazy(() => import("./TranslateTool")),
    },
    {
        id: "ai",
        nameKey: "tool.ai.name",
        descKey: "tool.ai.desc",
        icon: Sparkles,
        // 不标 acceptsText（2026-08 用户决策）：ai 不以工具行进推荐区，推荐位只留给专家行；
        // 素材注入不受影响——专家行走 onOpenTool("ai", text, expertId)，不经此标记。
        // 副作用是 ai 重新回到搜索命中区（按名称/描述/别名匹配，同 scan）。
        Component: lazy(() => import("./AiTool")),
    },
    {
        id: "gallery",
        nameKey: "tool.gallery.name",
        descKey: "tool.gallery.desc",
        icon: Images,
        // 不标 acceptsText：图库不吃文本素材（素材入口是文件拖拽/剪贴板图片）
        Component: lazy(() => import("./GalleryTool")),
    },
    {
        id: "terminal",
        nameKey: "tool.terminal.name",
        descKey: "tool.terminal.desc",
        icon: SquareTerminal,
        Component: null,
    },
];

export function toolMeta(id: ToolId): ToolMeta {
    const meta = TOOLS.find((t) => t.id === id);
    if (!meta) throw new Error(`unknown tool: ${id}`);
    return meta;
}
