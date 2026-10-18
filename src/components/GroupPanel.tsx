import { useState } from "react";
import { DndContext, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronDown, ChevronRight, GripVertical, Plus, Trash2 } from "lucide-react";
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

// 左栏里的纵向分组区块：组头可点击折叠，条目区沿用原有渲染与拖拽。
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
            className="mb-4 flex flex-col"
        >
            {/* 组头:折叠箭头 + 名称(次级色小字) + 等宽计数;点击折叠/展开;
                右键改名/删除;编辑模式显示把手与加号/删除 */}
            <ContextMenu>
                <ContextMenuTrigger asChild>
                    <h2
                        {...(editing ? sortable.listeners : {})}
                        onClick={() => setCollapsed((v) => !v)}
                        className="flex min-h-[25px] cursor-default touch-none select-none items-center gap-1.5 px-1.5 pb-1 pt-1.5 text-[11px] font-medium text-muted-foreground"
                    >
                        {editing && (
                            <GripVertical className="size-3 flex-none cursor-grab text-dim-foreground" aria-hidden />
                        )}
                        <span className="flex-none text-dim-foreground" aria-hidden>
                            {showItems ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                        </span>
                        <span className="whitespace-nowrap">{group.name}</span>
                        <span className="ml-auto flex-none font-mono text-[10px] font-normal text-dim-foreground">
                            {items.length}
                        </span>
                        {editing && (
                            <button
                                type="button"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onAddItem(group);
                                }}
                                title={t("item.new")}
                                aria-label={t("item.new")}
                                className="flex-none rounded-[3px] p-0.5 text-dim-foreground transition-colors hover:bg-hover hover:text-foreground"
                            >
                                <Plus className="size-3" />
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
                                aria-label={t("group.delete")}
                                className="flex-none rounded-[3px] p-0.5 text-dim-foreground transition-colors hover:bg-hover hover:text-destructive"
                            >
                                <Trash2 className="size-3" />
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
                <div className="flex flex-col gap-0.5 px-1 pb-2">
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
                        <span className="px-2 py-1.5 text-[11px] text-dim-foreground">{t("group.empty")}</span>
                    )}
                    {editing && (
                        <button
                            type="button"
                            onClick={() => onAddItem(group)}
                            className="mt-0.5 flex min-h-[32px] items-center gap-2 rounded-[4px] border border-dashed border-border px-2 text-[11px] text-dim-foreground transition-colors hover:bg-hover hover:text-foreground"
                        >
                            <Plus className="size-3.5" />
                            {t("item.new")}…
                        </button>
                    )}
                </div>
            )}
        </section>
    );
}
