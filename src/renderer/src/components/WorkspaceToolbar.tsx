import { useMemo, type RefObject } from "react";
import { FolderTree, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TitlebarWell } from "@/components/ui/titlebar";
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

// 工具栏条目的行样式
const ITEM_CLASS =
    "flex h-6 max-w-[180px] flex-none items-center gap-1.5 rounded-sm px-1.5 text-xs text-foreground select-none hover:bg-(--state-hover)";
// 「打开当前文件夹」只留图标，与文件树按钮同为 24px 见方；悬停底色沿用条目的，两处保持一致
const FOLDER_BUTTON_CLASS =
    "flex size-6 flex-none items-center justify-center rounded-sm select-none hover:bg-(--state-hover)";

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
 * 顶栏里的项目快捷启动工具栏：文件树按钮 + 固定「打开当前文件夹」+ 横向条目 + 右端固定的「＋」，
 * 装在和搜索框同款的凹槽里。宽度按内容算，由 App 把它排在工具集按钮左边，条目多了就往左长；
 * 顶栏空间不够时它被挤窄，条目在槽内横向滚动（不显示滚动条，鼠标滚轮即可滚）。
 * 文件夹按钮是工作区自带的动作，写死在这里不进 items 表；其余条目按归属从数据库来。
 * 只有普通工作区才有（临时工作区没有归属条目）；条目顺序复用左栏的 sortItems，
 * 保证两处看到同一套排序规则。文件树按钮和「＋」不参与滚动：条目再多也要能一眼看到入口。
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
    // 用组件库 TitlebarWell 的凹槽材质（自带 gan-no-drag，点击不会变成拖窗口），
    // 尺寸改成 28px 高的横排，与搜索井同高；条目按钮 24px，上下各留 2px
    return (
        <TitlebarWell role="toolbar" aria-label={t("ws.toolbar.title")} className="h-[28px] flex-row gap-1 px-1 py-0">
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
            {/* 凹槽只有 28px，放不下一条 10px 的滚动条，所以隐藏滚动条、改用滚轮。
                滚轮默认只认纵向，这里把纵向滚动量换成横向。
                没有 flex-1：宽度跟着内容走，空位留给顶栏的拖窗口区；被挤窄时 min-w-0 让它缩 */}
            <div
                className="no-scrollbar flex h-full min-w-0 items-center gap-1 overflow-x-auto overflow-y-hidden"
                onWheel={(event) => {
                    event.currentTarget.scrollLeft += event.deltaY;
                }}
            >
                {folder && (
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <button
                                type="button"
                                className={FOLDER_BUTTON_CLASS}
                                aria-label={t("ws.toolbar.openFolder")}
                                onClick={() => onOpenFolder(folder)}
                            >
                                <FolderIcon path={folder} light={light} />
                            </button>
                        </TooltipTrigger>
                        {/* 按钮没有文字了：提示第一行说它做什么，第二行才是路径 */}
                        <TooltipContent className="max-w-64 flex-col items-start gap-0.5 text-caption">
                            <div>{t("ws.toolbar.openFolder")}</div>
                            <div className="break-all font-mono">{folder}</div>
                        </TooltipContent>
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
        </TitlebarWell>
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
