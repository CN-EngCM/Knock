import { useState } from "react";
import { DndContext, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Plus, Trash2 } from "lucide-react";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/context-menu";
import { ItemRow } from "./ItemRow";
import { useDragSensors } from "@/lib/dnd";
import type { Group, Item } from "@/api/client";
import { useI18n } from "@/i18n/useI18n";

type Props = {
    group: Group;
    items: Item[]; // 已按 position 排序的组内条目
    editing: boolean;
    /** 编辑模式多选删除：勾中的条目 id 集合与切换回调（透传给 ItemRow） */
    selectedIds: ReadonlySet<number>;
    onToggleSelect: (id: number) => void;
    onAddItem: (group: Group) => void;
    onRename: (group: Group) => void;
    onDelete: (group: Group) => void;
    onOpen: (item: Item) => void;
    onEdit: (item: Item) => void;
    onDeleteItem: (item: Item) => void;
    /** 组内拖拽落定：传回该组的新顺序 */
    onReorderItems: (groupId: number, ordered: Item[]) => void;
};

// v2.2 起分组是左侧栏里的纵向区块（不再是网格面板）：
// 组头可点击折叠，条目区沿用原有渲染与拖拽。
export function GroupPanel({
    group,
    items,
    editing,
    selectedIds,
    onToggleSelect,
    onAddItem,
    onRename,
    onDelete,
    onOpen,
    onEdit,
    onDeleteItem,
    onReorderItems,
}: Props) {
    const { t } = useI18n();
    const [collapsed, setCollapsed] = useState(false);
    const dragSensors = useDragSensors();
    const showItems = !collapsed;

    // 分组自身的排序（编辑模式启用）
    const sortable = useSortable({ id: group.id, disabled: !editing });
    const style = {
        transform: CSS.Transform.toString(sortable.transform),
        transition: sortable.transition,
    };

    // 条目拖拽：只在本组列表内换位（跨组移动走「编辑条目」弹窗里的分组选择）
    function handleItemDragEnd(e: DragEndEvent) {
        const { active, over } = e;
        if (!over || active.id === over.id) return;
        const oldIndex = items.findIndex((i) => i.id === active.id);
        const newIndex = items.findIndex((i) => i.id === over.id);
        if (oldIndex < 0 || newIndex < 0) return;
        onReorderItems(group.id, arrayMove(items, oldIndex, newIndex));
    }

    return (
        <section
            ref={sortable.setNodeRef}
            style={style}
            // sortable.attributes 含 role="button"/aria-disabled，只在可拖拽时铺上，
            // 否则普通模式下整个区块会被读屏器误报成一个禁用按钮
            {...(editing ? sortable.attributes : {})}
            className="flex flex-col pb-1.5"
        >
            {/* 组头：▾ [ 名称 ] ──── n；点击折叠/展开；右键改名/删除；编辑模式显示把手与加号 */}
            <ContextMenu>
                <ContextMenuTrigger asChild>
                    <h2
                        {...(editing ? sortable.listeners : {})}
                        onClick={() => setCollapsed((v) => !v)}
                        // bg-panel 让组头成带状（与终端区/状态栏同底色），和下方条目拉开层次
                        className="flex cursor-default touch-none select-none items-center gap-2 border-b border-line bg-panel px-2.5 py-1.5 text-[13px] tracking-wide text-dim"
                    >
                        {editing && <GripVertical className="size-3.5 flex-none cursor-grab text-muted" aria-hidden />}
                        <span className="w-3 flex-none text-[10px] text-muted" aria-hidden>
                            {showItems ? "▾" : "▸"}
                        </span>
                        <span className="whitespace-nowrap">[ {group.name} ]</span>
                        <span className="h-px min-w-4 flex-1 bg-line" aria-hidden />
                        <span className="flex-none text-[11.5px] text-muted">{items.length}</span>
                        {editing && (
                            <button
                                type="button"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onAddItem(group);
                                }}
                                title={t("item.new")}
                                className="flex-none text-muted hover:text-text"
                            >
                                <Plus className="size-3.5" />
                            </button>
                        )}
                        {editing && (
                            <button
                                type="button"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onDelete(group);
                                }}
                                title={t("group.delete")}
                                className="flex-none text-muted hover:text-destructive"
                            >
                                <Trash2 className="size-3.5" />
                            </button>
                        )}
                    </h2>
                </ContextMenuTrigger>
                <ContextMenuContent>
                    <ContextMenuItem onClick={() => onRename(group)}>{t("menu.rename")}</ContextMenuItem>
                    <ContextMenuItem variant="destructive" onClick={() => onDelete(group)}>
                        {t("menu.delete")}
                    </ContextMenuItem>
                </ContextMenuContent>
            </ContextMenu>

            {showItems && (
                <div className="flex flex-col gap-0.5 px-1.5 pt-1">
                    {editing ? (
                        <DndContext sensors={dragSensors} onDragEnd={handleItemDragEnd}>
                            <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
                                {items.map((item) => (
                                    <ItemRow
                                        key={item.id}
                                        item={item}
                                        editing
                                        selected={selectedIds.has(item.id)}
                                        onToggleSelect={onToggleSelect}
                                        onOpen={onOpen}
                                        onEdit={onEdit}
                                        onDelete={onDeleteItem}
                                    />
                                ))}
                            </SortableContext>
                        </DndContext>
                    ) : (
                        items.map((item) => (
                            <ItemRow
                                key={item.id}
                                item={item}
                                editing={false}
                                onOpen={onOpen}
                                onEdit={onEdit}
                                onDelete={onDeleteItem}
                            />
                        ))
                    )}

                    {items.length === 0 && !editing && (
                        <span className="px-2 py-1 text-[12.5px] text-muted">{t("group.empty")}</span>
                    )}
                    {editing && (
                        <button
                            type="button"
                            onClick={() => onAddItem(group)}
                            className="flex items-center gap-2 border border-dashed border-line px-2 py-1 font-mono text-[12.5px] text-muted hover:text-text"
                        >
                            <span className="w-9 flex-none">new</span>
                            {t("item.new")}…
                        </button>
                    )}
                </div>
            )}
        </section>
    );
}
