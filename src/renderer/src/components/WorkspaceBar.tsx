import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/context-menu";
import type { Workspace } from "@/api/client";
import { useI18n } from "@/i18n/useI18n";

// 工作区标识色：高饱和、彼此区分明显，只作小面积色条与低透明度底色，深浅主题下都看得清。
// 普通工作区按 id 取色而不是按列表下标——删掉一个工作区后，其余工作区的颜色不会跟着变
const PALETTE = [
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

function colorOf(workspace: Workspace): string {
    return workspace.builtin ? BUILTIN_COLOR : PALETTE[workspace.id % PALETTE.length];
}

type Props = {
    workspaces: Workspace[];
    /** 当前生效的工作区；数据还没到时为 null */
    activeId: number | null;
    /** 每个工作区里的终端数；没挂过实例的工作区按 0 显示 */
    termCounts: Record<number, number>;
    onSwitch: (id: number) => void;
    onCreate: () => void;
    onRename: (workspace: Workspace) => void;
    onDelete: (workspace: Workspace) => void;
};

/**
 * 侧栏底部的工作区区块：标题行 + 最多四行可见的列表。
 * 只负责渲染与回调，数据与增删改都归 App（这里不碰 api）。
 * 侧栏隐藏时整块跟着 aside 一起消失，不另做入口。
 */
export function WorkspaceBar({ workspaces, activeId, termCounts, onSwitch, onCreate, onRename, onDelete }: Props) {
    const { t } = useI18n();
    return (
        <div className="flex-none border-t border-line">
            <div className="flex h-[43px] flex-none items-center justify-between pr-2 pl-4">
                <span className="text-xs font-medium">{t("ws.title")}</span>
                <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    onClick={onCreate}
                    title={t("ws.new")}
                    aria-label={t("ws.new")}
                >
                    <Plus className="size-3.5" />
                </Button>
            </div>
            {/* 四行封顶（4 × 48px），再多就在区块内部滚动 */}
            <div className="max-h-[192px] overflow-y-auto">
                {workspaces.map((workspace) => (
                    <WorkspaceRow
                        key={workspace.id}
                        workspace={workspace}
                        active={workspace.id === activeId}
                        count={termCounts[workspace.id] ?? 0}
                        onSwitch={onSwitch}
                        onRename={onRename}
                        onDelete={onDelete}
                    />
                ))}
            </div>
        </div>
    );
}

type RowProps = {
    workspace: Workspace;
    active: boolean;
    count: number;
    onSwitch: (id: number) => void;
    onRename: (workspace: Workspace) => void;
    onDelete: (workspace: Workspace) => void;
};

function WorkspaceRow({ workspace, active, count, onSwitch, onRename, onDelete }: RowProps) {
    const { t } = useI18n();
    const color = colorOf(workspace);
    // builtin 的名字在库里存的是空串，显示名必须走 i18n
    const name = workspace.builtin ? t("ws.scratch") : workspace.name;
    const row = (
        <button
            type="button"
            onClick={() => onSwitch(workspace.id)}
            // 当前行用同色低透明度底色；内联背景会盖过 hover 类，效果与启动列表的选中行一致
            className="relative flex h-12 w-full select-none items-center pr-2 pl-4 text-left hover:bg-(--state-hover)"
            style={active ? { backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)` } : undefined}
        >
            {/* 贴左边缘、整行高的竖色条 */}
            <span aria-hidden className="absolute inset-y-0 left-0 w-[3px]" style={{ backgroundColor: color }} />
            <span className="flex min-w-0 flex-col gap-0.5">
                <span className={`truncate text-xs ${active ? "text-foreground" : "text-muted-foreground"}`}>
                    {name}
                </span>
                <span className="text-[11px] text-dim-foreground">
                    {count} {t("ws.termUnit")}
                </span>
            </span>
        </button>
    );
    // 临时工作区不可改名、不可删除，右键菜单也不给
    if (workspace.builtin) return row;
    return (
        <ContextMenu>
            <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
            <ContextMenuContent>
                <ContextMenuItem onClick={() => onRename(workspace)}>{t("ws.rename")}</ContextMenuItem>
                <ContextMenuItem variant="destructive" onClick={() => onDelete(workspace)}>
                    {t("common.delete")}
                </ContextMenuItem>
            </ContextMenuContent>
        </ContextMenu>
    );
}
