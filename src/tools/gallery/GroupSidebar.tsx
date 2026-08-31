import { useState } from "react";
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuSeparator,
    ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Button } from "@/components/ui/button";
import type { GalleryGroup } from "@/api/client";
import { useI18n } from "@/i18n/useI18n";

type Props = {
    /** null = 首拉未就绪，列表区留白 */
    groups: GalleryGroup[] | null;
    /** 「全部图片」伪条目的计数（各组之和） */
    allCount: number;
    active: number | "all";
    /** 全局 tag 池（过滤 chips 的词源） */
    allTags: string[];
    /** 已激活的过滤 tag（命中 chips 高亮） */
    activeTags: string[];
    onToggleTag: (tag: string) => void;
    onSelect: (group: number | "all") => void;
    /** 返回 true = 创建成功（收起内联输入） */
    onCreate: (name: string) => Promise<boolean>;
    onRename: (id: number, name: string) => void;
    onDelete: (group: GalleryGroup) => void;
    /** 拖文件到组行 = 导入进该组 */
    onDropFiles: (paths: string[], groupId: number) => void;
};

// 左侧分组栏：全部图片（伪条目）→ 收件箱（内置，不可删/改名）→ 用户分组（创建序）
// → 底部「＋ 新建分组」。分组行右键菜单 + 文件拖放目标（dragover 高亮）。
export function GroupSidebar({
    groups,
    allCount,
    active,
    allTags,
    activeTags,
    onToggleTag,
    onSelect,
    onCreate,
    onRename,
    onDelete,
    onDropFiles,
}: Props) {
    const { t } = useI18n();
    const [creating, setCreating] = useState(false);
    const [newName, setNewName] = useState("");
    const [renamingId, setRenamingId] = useState<number | null>(null);
    const [renameName, setRenameName] = useState("");
    const [dropTarget, setDropTarget] = useState<number | null>(null);

    const list = groups ?? [];
    const inbox = list.find((g) => g.inbox) ?? null;
    const userGroups = list.filter((g) => !g.inbox);

    // 行样式对齐 AiTool 专家列表：左侧粗边是最强选中信号，悬浮只变字色
    const rowCls = (on: boolean) =>
        `flex w-full cursor-default select-none items-center gap-1.5 border-l-2 px-2 py-1.5 text-left text-[12.5px] ${
            on ? "border-text bg-faint text-text" : "border-transparent text-muted hover:text-dim"
        }`;
    // 过滤 chip（与 FileSearchTool 的后缀 chips 同款骨架：seg-on 为选中态）
    const chipCls = (on: boolean) =>
        `border px-1.5 py-0.5 text-[12px] ${on ? "seg-on" : "border-line text-dim hover:bg-faint"}`;

    /** 组行的文件拖放：只对拖文件（types 含 Files）反应，避免劫持其他拖拽 */
    function dropHandlers(gid: number) {
        return {
            onDragOver: (e: React.DragEvent) => {
                if (!e.dataTransfer.types.includes("Files")) return;
                e.preventDefault();
                e.stopPropagation(); // 不冒泡到根容器的整页高亮
                setDropTarget(gid);
            },
            onDragLeave: () => setDropTarget((v) => (v === gid ? null : v)),
            onDrop: (e: React.DragEvent) => {
                if (!e.dataTransfer.types.includes("Files")) return;
                e.preventDefault();
                e.stopPropagation();
                setDropTarget(null);
                const paths = Array.from(e.dataTransfer.files)
                    .map((f) => window.knock.filePathFor(f))
                    .filter(Boolean);
                if (paths.length > 0) onDropFiles(paths, gid);
            },
        };
    }

    function commitRename() {
        const id = renamingId;
        const name = renameName.trim();
        setRenamingId(null);
        if (id == null || !name) return;
        const g = list.find((x) => x.id === id);
        if (g && name !== g.name) onRename(id, name);
    }

    async function submitCreate() {
        const name = newName.trim();
        if (!name) {
            setCreating(false);
            return;
        }
        if (await onCreate(name)) {
            setCreating(false);
            setNewName("");
        }
    }

    /** 组行内容：改名中显示内联输入 */
    function groupRow(group: GalleryGroup, on: boolean, dragging: boolean) {
        const name = group.inbox ? t("gallery.inbox") : group.name;
        return (
            <div
                onClick={() => renamingId !== group.id && onSelect(group.id)}
                className={`${rowCls(on)} ${
                    dragging && !on ? "bg-faint outline outline-1 -outline-offset-1 outline-dim" : ""
                }`}
            >
                {renamingId === group.id ? (
                    <input
                        autoFocus
                        value={renameName}
                        onChange={(e) => setRenameName(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") commitRename();
                            else if (e.key === "Escape") setRenamingId(null);
                        }}
                        onBlur={commitRename}
                        className="min-w-0 flex-1 border border-line bg-bg px-1 text-[12px] text-text outline-none"
                    />
                ) : (
                    <span className="min-w-0 flex-1 truncate">{name}</span>
                )}
                <span className="flex-none text-[10.5px] tabular-nums text-muted">{group.count}</span>
            </div>
        );
    }

    function groupEntry(group: GalleryGroup) {
        const on = active === group.id;
        const drop = dropHandlers(group.id);
        const row = groupRow(group, on, dropTarget === group.id);
        // 收件箱是内置组：不可删/改名，右键不出菜单；但仍可作为拖放目标
        if (group.inbox) {
            return (
                <div key={group.id} {...drop}>
                    {row}
                </div>
            );
        }
        return (
            <ContextMenu key={group.id}>
                <ContextMenuTrigger asChild>
                    <div {...drop}>{row}</div>
                </ContextMenuTrigger>
                <ContextMenuContent>
                    <ContextMenuItem
                        onClick={() => {
                            setRenamingId(group.id);
                            setRenameName(group.name);
                        }}
                    >
                        {t("gallery.group.rename")}
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem variant="destructive" onClick={() => onDelete(group)}>
                        {t("gallery.menu.delete")}
                    </ContextMenuItem>
                </ContextMenuContent>
            </ContextMenu>
        );
    }

    return (
        <aside className="flex w-48 flex-none flex-col border-r border-line">
            <div className="min-h-0 flex-1 overflow-y-auto py-1.5">
                {/* 「全部图片」伪条目：count = 各组之和 */}
                <div className={rowCls(active === "all")} onClick={() => onSelect("all")}>
                    <span className="min-w-0 flex-1 truncate">{t("gallery.all")}</span>
                    <span className="flex-none text-[10.5px] tabular-nums text-muted">{allCount}</span>
                </div>
                {inbox && groupEntry(inbox)}
                {userGroups.map((g) => groupEntry(g))}
                {groups === null && <div className="px-2 py-1.5 text-[12px] text-muted">…</div>}

                {/* 全局 tag 过滤：分组列表下方一条分隔线隔开，不占缩略图区 */}
                {allTags.length > 0 && (
                    <>
                        <div className="mx-2 my-1.5 border-t border-line" aria-hidden />
                        <div className="flex flex-wrap gap-1 px-2 pb-1">
                            {allTags.map((tag) => (
                                <button
                                    key={tag}
                                    type="button"
                                    className={chipCls(activeTags.includes(tag))}
                                    onClick={() => onToggleTag(tag)}
                                >
                                    {tag}
                                </button>
                            ))}
                        </div>
                    </>
                )}
            </div>
            <div className="flex-none border-t border-line p-1.5">
                {creating ? (
                    <input
                        autoFocus
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") void submitCreate();
                            else if (e.key === "Escape") setCreating(false);
                        }}
                        onBlur={() => void submitCreate()}
                        placeholder={t("gallery.groupNamePlaceholder")}
                        className="h-6 w-full border border-line bg-bg px-1.5 text-[12px] text-text outline-none placeholder:text-muted focus:border-dim"
                    />
                ) : (
                    <Button
                        type="button"
                        variant="outline"
                        size="xs"
                        className="w-full"
                        onClick={() => {
                            setCreating(true);
                            setNewName("");
                        }}
                    >
                        ＋ {t("gallery.newGroup")}
                    </Button>
                )}
            </div>
        </aside>
    );
}
