import {
    ContextMenuItem,
    ContextMenuSeparator,
    ContextMenuSub,
    ContextMenuSubContent,
    ContextMenuSubTrigger,
} from "@/components/ui/context-menu";
import type { Workspace } from "@/api/client";
import { useI18n } from "@/i18n/useI18n";

type Props = {
    /** 当前归属：null = 左侧快捷启动；工作区 id = 该工作区的工具栏 */
    currentWorkspaceId: number | null;
    /** 可移动到的普通工作区（调用方只传非临时工作区，临时工作区没有工具栏） */
    workspaces: Workspace[];
    onMove: (workspaceId: number | null) => void;
};

/**
 * 「移动到工作区」子菜单：左侧快捷启动与工作区工具栏共用。
 * 目标里排除当前归属；从工作区移出时额外给「左侧快捷启动」。
 * 没有可选目标时整项不渲染，避免左侧条目看到一个空子菜单。
 */
export function MoveToWorkspaceMenu({ currentWorkspaceId, workspaces, onMove }: Props) {
    const { t } = useI18n();
    const targets = workspaces.filter((workspace) => workspace.id !== currentWorkspaceId);
    const canMoveToSidebar = currentWorkspaceId !== null;
    if (!canMoveToSidebar && targets.length === 0) return null;
    return (
        <ContextMenuSub>
            <ContextMenuSubTrigger>{t("menu.moveToWorkspace")}</ContextMenuSubTrigger>
            <ContextMenuSubContent>
                {canMoveToSidebar && (
                    <ContextMenuItem onClick={() => onMove(null)}>{t("menu.moveToSidebar")}</ContextMenuItem>
                )}
                {canMoveToSidebar && targets.length > 0 && <ContextMenuSeparator />}
                {targets.map((workspace) => (
                    <ContextMenuItem key={workspace.id} onClick={() => onMove(workspace.id)}>
                        {workspace.name}
                    </ContextMenuItem>
                ))}
            </ContextMenuSubContent>
        </ContextMenuSub>
    );
}
