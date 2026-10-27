import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/context-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Tree, type TreeDropPosition, type TreeRowContext, type TreeNode } from "@/components/ui/tree";
import { KindIcon } from "@/lib/kindIcon";
import type { Group, Item } from "@/api/client";
import { useI18n } from "@/i18n/useI18n";

// 树节点 id 是字符串而领域 id 是数字，用类型前缀区分
const nodeId = {
    group: (id: number) => `group:${id}`,
    item: (id: number) => `item:${id}`,
    // 空分组的占位子节点：让组行保有展开箭头与提示文案
    empty: (groupId: number) => `group:${groupId}:empty`,
};

function isItem(data: unknown): data is Item {
    return !!data && typeof data === "object" && "kind" in data;
}

function isGroup(data: unknown): data is Group {
    return !!data && typeof data === "object" && "name" in data && !isItem(data);
}

/** 条目拖拽落库的单位：按组给全序列，一次移动最多牵动两个组（源组与目标组） */
export type ItemMove = { groupId: number; items: Item[] }[];

type Props = {
    groups: Group[];
    items: Item[];
    /** 排序模式：开启才传 dnd 给 Tree（显示把手、允许拖动），平时整树不可拖 */
    sortable?: boolean;
    onOpen: (item: Item) => void;
    onEditItem: (item: Item) => void;
    onDeleteItem: (item: Item) => void;
    onRenameGroup: (group: Group) => void;
    onDeleteGroup: (group: Group) => void;
    onReorderGroups: (next: Group[]) => void;
    onMoveItem: (affected: ItemMove) => void;
};

/**
 * 左侧启动列表：GaN.UI Tree 的业务封装。
 * 两层结构（分组 → 启动项），单击条目即启动（openItem 内 500ms 防抖）、回车同打开，
 * 组行单击/回车/箭头皆可折叠切换；单击的选中高亮只是顺带的视觉反馈。
 * 拖拽仅在排序模式（sortable）开启时启用，规则：条目组内排序或跨组插入；
 * 条目拖到组行 = 移入该组（追加到末尾）；分组只能在组间排序，不能进组（数据模型无嵌套）。
 */
export function LauncherTree({
    groups,
    items,
    sortable,
    onOpen,
    onEditItem,
    onDeleteItem,
    onRenameGroup,
    onDeleteGroup,
    onReorderGroups,
    onMoveItem,
}: Props) {
    const { t } = useI18n();

    // 折叠状态记「谁被折叠了」而非「谁展开」：新组天然展开，删组留下的残留项对不上号也无碍
    const [collapsed, setCollapsed] = useState<Set<number>>(() => new Set());
    const expandedIds = useMemo(
        () => groups.filter((g) => !collapsed.has(g.id)).map((g) => nodeId.group(g.id)),
        [groups, collapsed],
    );

    function handleExpandedChange(ids: string[]) {
        const open = new Set(ids);
        setCollapsed(new Set(groups.filter((g) => !open.has(nodeId.group(g.id))).map((g) => g.id)));
    }

    // 组内按 position 排序的条目清单
    const itemsOf = useMemo(() => {
        const byGroup = new Map<number, Item[]>();
        for (const item of items) {
            const list = byGroup.get(item.group_id) ?? [];
            list.push(item);
            byGroup.set(item.group_id, list);
        }
        for (const list of byGroup.values()) list.sort((a, b) => a.position - b.position);
        return (groupId: number) => byGroup.get(groupId) ?? [];
    }, [items]);

    const nodes = useMemo<TreeNode[]>(
        () =>
            groups.map((group) => {
                const groupItems = itemsOf(group.id);
                const children: TreeNode[] = groupItems.length
                    ? groupItems.map((item) => ({
                          id: nodeId.item(item.id),
                          label: item.title,
                          icon: <KindIcon item={item} />,
                          data: item,
                      }))
                    : [
                          {
                              id: nodeId.empty(group.id),
                              label: t("group.empty"),
                              disabled: true,
                          },
                      ];
                return { id: nodeId.group(group.id), label: group.name, data: group, children };
            }),
        [groups, itemsOf, t],
    );

    // 回车键：条目 = 打开；分组 = 切换展开（与箭头按钮对等的键盘路径）
    function handleActivate(node: TreeNode) {
        if (isItem(node.data)) {
            onOpen(node.data);
            return;
        }
        if (isGroup(node.data)) {
            const id = nodeId.group(node.data.id);
            setExpanded(id, !expandedIds.includes(id));
        }
    }

    function setExpanded(id: string, expanded: boolean) {
        handleExpandedChange(expanded ? [...expandedIds, id] : expandedIds.filter((x) => x !== id));
    }

    function canDrop(drag: TreeNode, target: TreeNode, position: TreeDropPosition): boolean {
        if (isGroup(drag.data)) return isGroup(target.data) && position !== "inside";
        if (isItem(drag.data)) {
            // 条目行前后 = 组内排序或跨组插入；条目不能装条目，组行任意位置都算移入
            if (isItem(target.data)) return position !== "inside";
            if (isGroup(target.data)) return true;
        }
        return false;
    }

    function handleMove(drag: TreeNode, target: TreeNode, position: TreeDropPosition) {
        if (isGroup(drag.data) && isGroup(target.data)) {
            const dragged = drag.data;
            const over = target.data;
            const rest = groups.filter((g) => g.id !== dragged.id);
            const index = rest.findIndex((g) => g.id === over.id);
            const at = position === "before" ? index : index + 1;
            onReorderGroups([...rest.slice(0, at), dragged, ...rest.slice(at)]);
            return;
        }
        if (!isItem(drag.data)) return;
        const moved = drag.data;
        const source = itemsOf(moved.group_id).filter((i) => i.id !== moved.id);
        let groupId: number;
        let ordered: Item[];
        if (isItem(target.data)) {
            const over = target.data;
            groupId = over.group_id;
            const list = itemsOf(groupId).filter((i) => i.id !== moved.id);
            const index = list.findIndex((i) => i.id === over.id);
            const at = position === "before" ? index : index + 1;
            ordered = [...list.slice(0, at), { ...moved, group_id: groupId }, ...list.slice(at)];
        } else if (isGroup(target.data)) {
            groupId = target.data.id;
            ordered = [...itemsOf(groupId).filter((i) => i.id !== moved.id), { ...moved, group_id: groupId }];
        } else {
            return;
        }
        onMoveItem(
            groupId === moved.group_id
                ? [{ groupId, items: ordered }]
                : [
                      { groupId: moved.group_id, items: source },
                      { groupId, items: ordered },
                  ],
        );
    }

    function renderRow({ node, expanded }: TreeRowContext) {
        if (isItem(node.data))
            return <ItemRowContent item={node.data} onOpen={onOpen} onEdit={onEditItem} onDelete={onDeleteItem} />;
        if (isGroup(node.data)) {
            // 类型收窄进不了 onToggle 闭包，先存 const
            const group = node.data;
            return (
                <GroupRowContent
                    group={group}
                    count={itemsOf(group.id).length}
                    onRename={onRenameGroup}
                    onDelete={onDeleteGroup}
                    onToggle={() => setExpanded(nodeId.group(group.id), !expanded)}
                />
            );
        }
        return <span className="min-w-0 flex-1 truncate text-[11px] text-dim-foreground">{node.label}</span>;
    }

    return (
        <Tree
            nodes={nodes}
            label={t("side.title")}
            rowHeight={26}
            className="h-full px-2.5 py-3"
            expandedIds={expandedIds}
            onExpandedChange={handleExpandedChange}
            onActivate={handleActivate}
            dnd={sortable ? { reorder: true, moveInto: true, canDrop, onMove: handleMove } : undefined}
            renderRow={renderRow}
            labels={{
                collapse: t("tree.collapse"),
                expand: t("tree.expand"),
                dragHandle: (label) => t("tree.dragHandle").replace("{label}", label),
            }}
        />
    );
}

/** 条目行内容：图标 + 标题，target 悬停提示，右键菜单与单击启动 */
function ItemRowContent({
    item,
    onOpen,
    onEdit,
    onDelete,
}: {
    item: Item;
    onOpen: (item: Item) => void;
    onEdit: (item: Item) => void;
    onDelete: (item: Item) => void;
}) {
    const { t } = useI18n();
    // 单击启动挂在内容层（openItem 自带 500ms 同条目防抖，连点与双击都只开一次）
    return (
        <ContextMenu>
            <ContextMenuTrigger asChild>
                <span className="flex min-w-0 flex-1 items-center gap-2" onClick={() => onOpen(item)}>
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
                </span>
            </ContextMenuTrigger>
            <ContextMenuContent>
                <ContextMenuItem onClick={() => onOpen(item)}>{t("menu.open")}</ContextMenuItem>
                <ContextMenuItem onClick={() => onEdit(item)}>{t("menu.edit")}</ContextMenuItem>
                <ContextMenuItem variant="destructive" onClick={() => onDelete(item)}>
                    {t("menu.delete")}
                </ContextMenuItem>
            </ContextMenuContent>
        </ContextMenu>
    );
}

/** 分组行内容：组名 + 条目数徽章，单击折叠/展开，右键菜单重命名/删除 */
function GroupRowContent({
    group,
    count,
    onRename,
    onDelete,
    onToggle,
}: {
    group: Group;
    count: number;
    onRename: (group: Group) => void;
    onDelete: (group: Group) => void;
    onToggle: () => void;
}) {
    const { t } = useI18n();
    return (
        <ContextMenu>
            <ContextMenuTrigger asChild>
                <span className="flex min-w-0 flex-1 cursor-default items-center gap-1.5" onClick={onToggle}>
                    <span className="truncate text-[11px] font-medium text-muted-foreground">{group.name}</span>
                    <Badge variant="ghost" className="ml-auto font-mono font-normal text-dim-foreground">
                        {count}
                    </Badge>
                </span>
            </ContextMenuTrigger>
            <ContextMenuContent>
                <ContextMenuItem onClick={() => onRename(group)}>{t("menu.rename")}</ContextMenuItem>
                <ContextMenuItem variant="destructive" onClick={() => onDelete(group)}>
                    {t("menu.delete")}
                </ContextMenuItem>
            </ContextMenuContent>
        </ContextMenu>
    );
}
