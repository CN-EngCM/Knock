import { useState } from "react";
import { DndContext, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronDown, ChevronRight, GripVertical } from "lucide-react";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/context-menu";
import { ItemRow } from "./ItemRow";
import { useDragSensors } from "@/lib/dnd";
import type { Group, Item } from "@/api/client";
import { useI18n } from "@/i18n/useI18n";

type Props = {
    group: Group;
    items: Item[];
    onRename: (group: Group) => void;
    onDelete: (group: Group) => void;
    onOpen: (item: Item) => void;
    onEdit: (item: Item) => void;
    onDeleteItem: (item: Item) => void;
    onReorderItems: (groupId: number, ordered: Item[]) => void;
};

export function GroupPanel({ group, items, onRename, onDelete, onOpen, onEdit, onDeleteItem, onReorderItems }: Props) {
    const { t } = useI18n();
    const [collapsed, setCollapsed] = useState(false);
    const dragSensors = useDragSensors();
    const sortable = useSortable({ id: group.id });
    const style = {
        transform: CSS.Transform.toString(sortable.transform),
        transition: sortable.transition,
    };

    // 只在本组内排序，跨组移动由启动项编辑弹窗中的分组选择负责。
    function handleItemDragEnd(e: DragEndEvent) {
        const { active, over } = e;
        if (!over || active.id === over.id) return;
        const oldIndex = items.findIndex((i) => i.id === active.id);
        const newIndex = items.findIndex((i) => i.id === over.id);
        if (oldIndex < 0 || newIndex < 0) return;
        onReorderItems(group.id, arrayMove(items, oldIndex, newIndex));
    }

    return (
        <section ref={sortable.setNodeRef} style={style} className="mb-4 flex flex-col">
            <ContextMenu>
                <ContextMenuTrigger asChild>
                    <h2
                        onClick={() => setCollapsed((v) => !v)}
                        className="group/group-header flex min-h-[25px] cursor-default select-none items-center gap-1.5 px-1.5 pb-1 pt-1.5 text-[11px] font-medium text-muted-foreground"
                    >
                        <button
                            type="button"
                            ref={sortable.setActivatorNodeRef}
                            {...sortable.attributes}
                            {...sortable.listeners}
                            onClick={(e) => e.stopPropagation()}
                            aria-label={t("group.reorder")}
                            title={t("group.reorder")}
                            className="grid size-4 flex-none touch-none place-items-center rounded-[3px] text-dim-foreground opacity-0 hover:bg-hover group-hover/group-header:opacity-100 focus-visible:opacity-100"
                        >
                            <GripVertical className="size-3 cursor-grab" aria-hidden />
                        </button>
                        <span className="flex-none text-dim-foreground" aria-hidden>
                            {collapsed ? <ChevronRight className="size-3" /> : <ChevronDown className="size-3" />}
                        </span>
                        <span className="whitespace-nowrap">{group.name}</span>
                        <span className="ml-auto flex-none font-mono text-[10px] font-normal text-dim-foreground">
                            {items.length}
                        </span>
                    </h2>
                </ContextMenuTrigger>
                <ContextMenuContent>
                    <ContextMenuItem onClick={() => onRename(group)}>{t("menu.rename")}</ContextMenuItem>
                    <ContextMenuItem variant="destructive" onClick={() => onDelete(group)}>
                        {t("menu.delete")}
                    </ContextMenuItem>
                </ContextMenuContent>
            </ContextMenu>

            {!collapsed && (
                <div className="flex flex-col gap-0.5 px-1 pb-2">
                    <DndContext sensors={dragSensors} onDragEnd={handleItemDragEnd}>
                        <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
                            {items.map((item) => (
                                <ItemRow
                                    key={item.id}
                                    item={item}
                                    onOpen={onOpen}
                                    onEdit={onEdit}
                                    onDelete={onDeleteItem}
                                />
                            ))}
                        </SortableContext>
                    </DndContext>
                    {items.length === 0 && (
                        <span className="px-2 py-1.5 text-[11px] text-dim-foreground">{t("group.empty")}</span>
                    )}
                </div>
            )}
        </section>
    );
}
