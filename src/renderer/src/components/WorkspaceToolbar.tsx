import { useMemo, type RefObject } from "react";
import { FolderTree, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Scopebar } from "@/components/ui/toolbar";
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuSeparator,
    ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { FolderIcon, KindIcon } from "@/lib/kindIcon";
import { sortItems } from "@/lib/itemOrder";
import type { Item, Workspace } from "@/api/client";
import { useI18n } from "@/i18n/useI18n";
import { MoveToWorkspaceMenu } from "./MoveToWorkspaceMenu";

// 工具栏条目与固定文件夹按钮共用同一套行样式，避免两处慢慢长歪
const ITEM_CLASS =
    "flex h-6 max-w-[180px] flex-none items-center gap-1.5 rounded-sm px-1.5 text-xs text-foreground select-none hover:bg-(--state-hover)";

type Props = {
    /** 当前工作区的文件夹；空串表示旧库还没补过目录，此时不渲染固定按钮 */
    folder: string;
    /** 当前工作区的条目（调用方已按归属过滤） */
    items: Item[];
    /** 目标经运行时确认是本机目录的条目 id：只有这些条目才出现「在此打开终端」一组 */
    dirIds: ReadonlySet<number>;
    /** 可移动到的普通工作区（不含临时工作区） */
    workspaces: Workspace[];
    /** 工具栏所属工作区：移动菜单据此排除当前归属 */
    currentWorkspaceId: number;
    /** 浅色主题：图标包里少数图标有专为浅底画的款式 */
    light: boolean;
    /** 文件树浮层是否打开：按钮据此显示按下态 */
    treeOpen: boolean;
    /** 按钮的 ref 交给浮层：它的「点外面收起」要放过这个按钮 */
    treeButtonRef: RefObject<HTMLButtonElement | null>;
    onToggleTree: () => void;
    onCreate: () => void;
    onOpenFolder: (folder: string) => void;
    onOpen: (item: Item) => void;
    onOpenInTerminal: (item: Item, command?: "opencode" | "claude") => void;
    /** 网页收藏改用系统浏览器打开 */
    onOpenExternal: (item: Item) => void;
    onEditItem: (item: Item) => void;
    onDeleteItem: (item: Item) => void;
    onMoveItem: (item: Item, workspaceId: number | null) => void;
};

/**
 * 工作区顶部的项目快捷启动工具栏：固定「打开当前文件夹」+ 横向条目 + 右端固定的「＋」。
 * 文件夹按钮是工作区自带的动作，写死在这里不进 items 表；其余条目按归属从数据库来。
 * 只有普通工作区才有（临时工作区没有归属条目）；条目顺序复用左栏的 sortItems，
 * 保证两处看到同一套排序规则。右侧「＋」不参与滚动：条目再多也要能一眼看到添加入口。
 */
export function WorkspaceToolbar({
    folder,
    items,
    dirIds,
    workspaces,
    currentWorkspaceId,
    light,
    treeOpen,
    treeButtonRef,
    onToggleTree,
    onCreate,
    onOpenFolder,
    onOpen,
    onOpenInTerminal,
    onOpenExternal,
    onEditItem,
    onDeleteItem,
    onMoveItem,
}: Props) {
    const { t } = useI18n();
    const sorted = useMemo(() => sortItems(items), [items]);
    // 用组件库 Scopebar 变体承载内容条的面板材质与边框（它自带 gan-no-drag）；
    // 只覆盖两处：36px 固定高度、根节点不滚动（条目在内部横滚，「＋」固定右端）
    return (
        <Scopebar
            role="toolbar"
            aria-label={t("ws.toolbar.title")}
            className="h-9 flex-none gap-1 overflow-hidden px-2"
        >
            {/* 文件树入口固定在最左，不随条目滚动；工作区没有文件夹时没东西可看，不显示 */}
            {folder && (
                <Button
                    ref={treeButtonRef}
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-6 flex-none"
                    active={treeOpen}
                    onClick={onToggleTree}
                    title={t("ws.toolbar.fileTree")}
                    aria-label={t("ws.toolbar.fileTree")}
                >
                    <FolderTree className="size-3.5" />
                </Button>
            )}
            {/* 工具条只有 36px：横向滚动条会占掉 10px，条目按钮取 24px 才不会被挤掉。
                滑块保持可见，条目多了可以直接拖动滑块滚到末尾 */}
            <div className="flex h-full min-w-0 flex-1 items-center gap-1 overflow-x-auto overflow-y-hidden">
                {folder && (
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <button type="button" className={ITEM_CLASS} onClick={() => onOpenFolder(folder)}>
                                <FolderIcon path={folder} light={light} />
                                <span className="min-w-0 truncate">{t("ws.toolbar.openFolder")}</span>
                            </button>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-64 break-all font-mono text-caption">{folder}</TooltipContent>
                    </Tooltip>
                )}
                {sorted.map((item) => (
                    <WorkspaceToolbarItem
                        key={item.id}
                        item={item}
                        isDir={dirIds.has(item.id)}
                        light={light}
                        workspaces={workspaces}
                        currentWorkspaceId={currentWorkspaceId}
                        onOpen={onOpen}
                        onOpenInTerminal={onOpenInTerminal}
                        onOpenExternal={onOpenExternal}
                        onEdit={onEditItem}
                        onDelete={onDeleteItem}
                        onMove={onMoveItem}
                    />
                ))}
            </div>
            <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-6 flex-none"
                onClick={onCreate}
                title={t("ws.toolbar.add")}
                aria-label={t("ws.toolbar.add")}
            >
                <Plus className="size-3.5" />
            </Button>
        </Scopebar>
    );
}

type ItemProps = {
    item: Item;
    /** 目标是本机目录：菜单多出「在此打开终端」一组 */
    isDir: boolean;
    light: boolean;
    workspaces: Workspace[];
    currentWorkspaceId: number;
    onOpen: (item: Item) => void;
    onOpenInTerminal: (item: Item, command?: "opencode" | "claude") => void;
    onOpenExternal: (item: Item) => void;
    onEdit: (item: Item) => void;
    onDelete: (item: Item) => void;
    onMove: (item: Item, workspaceId: number | null) => void;
};

/** 工具栏里的单个条目：图标 + 标题，单击即启动，右键给与左栏一致的菜单 */
function WorkspaceToolbarItem({
    item,
    isDir,
    light,
    workspaces,
    currentWorkspaceId,
    onOpen,
    onOpenInTerminal,
    onOpenExternal,
    onEdit,
    onDelete,
    onMove,
}: ItemProps) {
    const { t } = useI18n();
    return (
        <ContextMenu>
            <ContextMenuTrigger asChild>
                <button type="button" onClick={() => onOpen(item)} className={ITEM_CLASS}>
                    <KindIcon item={item} isDir={isDir} light={light} />
                    {/* Tooltip 只包标题：与 ContextMenuTrigger 各占一层 asChild，互不抢 props */}
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <span className="min-w-0 truncate">{item.title}</span>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-64 break-all font-mono text-caption">
                            {item.target}
                        </TooltipContent>
                    </Tooltip>
                </button>
            </ContextMenuTrigger>
            <ContextMenuContent>
                <ContextMenuItem onClick={() => onOpen(item)}>{t("menu.open")}</ContextMenuItem>
                {item.kind === "bookmark" && (
                    <ContextMenuItem onClick={() => onOpenExternal(item)}>{t("menu.openExternal")}</ContextMenuItem>
                )}
                {isDir && (
                    <>
                        <ContextMenuSeparator />
                        <ContextMenuItem onClick={() => onOpenInTerminal(item)}>
                            {t("menu.terminalHere")}
                        </ContextMenuItem>
                        <ContextMenuItem onClick={() => onOpenInTerminal(item, "opencode")}>
                            {t("menu.opencodeHere")}
                        </ContextMenuItem>
                        <ContextMenuItem onClick={() => onOpenInTerminal(item, "claude")}>
                            {t("menu.claudeHere")}
                        </ContextMenuItem>
                        <ContextMenuSeparator />
                    </>
                )}
                <ContextMenuItem onClick={() => onEdit(item)}>{t("menu.edit")}</ContextMenuItem>
                <MoveToWorkspaceMenu
                    currentWorkspaceId={currentWorkspaceId}
                    workspaces={workspaces}
                    onMove={(workspaceId) => onMove(item, workspaceId)}
                />
                <ContextMenuItem variant="destructive" onClick={() => onDelete(item)}>
                    {t("menu.delete")}
                </ContextMenuItem>
            </ContextMenuContent>
        </ContextMenu>
    );
}
