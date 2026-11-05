import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuSeparator,
    ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { KindIcon } from "@/lib/kindIcon";
import { sortItems } from "@/lib/itemOrder";
import { cn } from "@/lib/utils";
import type { Item, Workspace } from "@/api/client";
import { useI18n } from "@/i18n/useI18n";
import { MoveToWorkspaceMenu } from "./MoveToWorkspaceMenu";

type Props = {
    items: Item[];
    /** 目标经运行时确认是本机目录的条目 id：只有这些条目才出现「在此打开终端」一组 */
    dirIds: ReadonlySet<number>;
    /** 可移动到的普通工作区（不含临时工作区） */
    workspaces: Workspace[];
    onOpenInTerminal: (item: Item, command?: "opencode" | "claude") => void;
    onOpen: (item: Item) => void;
    onEditItem: (item: Item) => void;
    onDeleteItem: (item: Item) => void;
    onMoveItem: (item: Item, workspaceId: number | null) => void;
};

/** 行的 DOM id：只给 aria-activedescendant 引用，不拿它做选择器，所以冒号之类字符不用转义 */
function rowId(listId: string, itemId: number): string {
    return `${listId}-item-${itemId}`;
}

/**
 * 左侧快捷启动列表：role="listbox" 的单层扁平列表。
 * 用 listbox 而不是 tree：这里没有层级、展开与折叠，treeitem 的箭头占位和 aria-level 都是多余的，
 * listbox 的 option 只回答「有哪些可选项、当前是哪一项」，屏幕阅读器也不会期待方向键展开子级。
 * 焦点常驻容器、行不参与 Tab 顺序：行跟着数据刷新重建，焦点落在行上会随卸载丢失；容器常驻，
 * 用 aria-activedescendant 告诉辅助技术当前行，键盘只挪活动索引、不搬焦点。
 * 顺序由 sortItems 固定（类型 → 标题）；单击即启动，500ms 同条目防抖在 App 的 openItem 里。
 */
export function LauncherList({
    items,
    dirIds,
    workspaces,
    onOpenInTerminal,
    onOpen,
    onEditItem,
    onDeleteItem,
    onMoveItem,
}: Props) {
    const { t } = useI18n();
    const listId = useId();
    const rowRefs = useRef<(HTMLDivElement | null)[]>([]);
    const [activeIndex, setActiveIndex] = useState(0);
    // 焦点是否在容器上：活动行只在此时铺选中底色，焦点去了搜索框或右键菜单，列表不留高亮
    const [focused, setFocused] = useState(false);

    // 排序放在 memo 里：items 引用不变就不重排，行列表也保持引用稳定
    const sorted = useMemo(() => sortItems(items), [items]);
    const lastIndex = Math.max(sorted.length - 1, 0);
    // 条目增删后旧索引可能越界：渲染时先夹住，首帧的 aria-activedescendant 就不会指向不存在的行
    const boundedIndex = Math.min(activeIndex, lastIndex);
    useEffect(() => {
        if (activeIndex !== boundedIndex) setActiveIndex(boundedIndex);
    }, [activeIndex, boundedIndex]);

    // 活动行变化就滚到可见：键盘移动与点击都只改索引，滚动统一在这里做
    useEffect(() => {
        rowRefs.current[boundedIndex]?.scrollIntoView({ block: "nearest" });
    }, [boundedIndex]);

    function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
        if (sorted.length === 0) return;
        if (event.key === "ArrowDown") {
            event.preventDefault();
            // 到边界停住，不绕回另一端
            setActiveIndex(Math.min(boundedIndex + 1, lastIndex));
        } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActiveIndex(Math.max(boundedIndex - 1, 0));
        } else if (event.key === "Home") {
            event.preventDefault();
            setActiveIndex(0);
        } else if (event.key === "End") {
            event.preventDefault();
            setActiveIndex(lastIndex);
        } else if (event.key === "Enter") {
            event.preventDefault();
            onOpen(sorted[boundedIndex]);
        }
    }

    return (
        <div
            role="listbox"
            aria-label={t("side.title")}
            aria-activedescendant={sorted.length > 0 ? rowId(listId, sorted[boundedIndex].id) : undefined}
            tabIndex={0}
            className="h-full overflow-y-auto px-2.5 py-3 outline-none"
            onKeyDown={handleKeyDown}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
        >
            {sorted.map((item, index) => (
                <LauncherRow
                    key={item.id}
                    id={rowId(listId, item.id)}
                    item={item}
                    active={index === boundedIndex}
                    focused={focused}
                    isDir={dirIds.has(item.id)}
                    workspaces={workspaces}
                    onActivate={() => setActiveIndex(index)}
                    onOpen={onOpen}
                    onOpenInTerminal={onOpenInTerminal}
                    onEdit={onEditItem}
                    onDelete={onDeleteItem}
                    onMove={onMoveItem}
                    registerRef={(node) => {
                        rowRefs.current[index] = node;
                    }}
                />
            ))}
        </div>
    );
}

type RowProps = {
    /** aria-activedescendant 指向的行 id */
    id: string;
    item: Item;
    /** 活动行：aria-selected 跟着它 */
    active: boolean;
    /** 容器是否持有焦点：没有焦点时活动行不着色 */
    focused: boolean;
    /** 目标是本机目录：菜单多出「在此打开终端」一组 */
    isDir: boolean;
    /** 可移动到的普通工作区（不含临时工作区） */
    workspaces: Workspace[];
    onActivate: () => void;
    onOpen: (item: Item) => void;
    onOpenInTerminal: (item: Item, command?: "opencode" | "claude") => void;
    onEdit: (item: Item) => void;
    onDelete: (item: Item) => void;
    onMove: (item: Item, workspaceId: number | null) => void;
    registerRef: (node: HTMLDivElement | null) => void;
};

/** 条目行：类型图标 + 标题，整行单击启动、整行右键弹菜单；活动行在列表有焦点时铺选中底色 */
function LauncherRow({
    id,
    item,
    active,
    focused,
    isDir,
    workspaces,
    onActivate,
    onOpen,
    onOpenInTerminal,
    onEdit,
    onDelete,
    onMove,
    registerRef,
}: RowProps) {
    const { t } = useI18n();
    return (
        <ContextMenu>
            {/* 整行是右键触发器：行元素同时承担 option 语义、点击目标与 Radix 的 trigger child */}
            <ContextMenuTrigger asChild>
                <div
                    id={id}
                    ref={registerRef}
                    role="option"
                    aria-selected={active}
                    className={cn(
                        "flex h-[26px] cursor-default items-center gap-2 rounded-sm ps-1.5 pe-2",
                        "text-xs text-foreground select-none",
                        active && focused
                            ? "bg-(--state-selected) text-(--state-selected-foreground)"
                            : "hover:bg-(--state-hover)",
                    )}
                    onClick={() => {
                        onActivate();
                        onOpen(item);
                    }}
                    onContextMenu={onActivate}
                >
                    <KindIcon item={item} />
                    {/* Tooltip 只包标题文本：与 ContextMenuTrigger 各占一层 asChild，互不抢 props */}
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <span className="min-w-0 flex-1 truncate">{item.title}</span>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-64 break-all font-mono text-caption">
                            {item.target}
                        </TooltipContent>
                    </Tooltip>
                </div>
            </ContextMenuTrigger>
            <ContextMenuContent>
                <ContextMenuItem onClick={() => onOpen(item)}>{t("menu.open")}</ContextMenuItem>
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
                {/* 左侧条目本来就在左侧，移动目标只列工作区；没有工作区时整项不渲染 */}
                <MoveToWorkspaceMenu
                    currentWorkspaceId={null}
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
