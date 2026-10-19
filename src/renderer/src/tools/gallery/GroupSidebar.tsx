import { useState } from "react";
import { Globe, Lock, LockOpen } from "lucide-react";
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuSeparator,
    ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { GalleryGroup } from "@/api/client";
import { useI18n } from "@/i18n/useI18n";

type Props = {
    /** null = 首拉未就绪，列表区留白 */
    groups: GalleryGroup[] | null;
    /** 「全部图片」伪条目的计数（各组之和；锁定视角的 groups 本就不含私密分组） */
    allCount: number;
    /** 「画廊」伪条目的计数（锁定视角已剔除私密图，与画廊查询同一边界） */
    wallCount: number;
    active: number | "all" | "wall";
    /** 分组标记/取消私密（标记时未设图库密码由调用方先引导设密码） */
    onTogglePrivate: (group: GalleryGroup, isPrivate: boolean) => void;
    /** 整组加入画廊（快照语义：此刻组内成员一次性入册） */
    onWallAddGroup: (group: GalleryGroup) => void;
    /** 图库密码是否已设（未设 = 私密体系未启用，锁入口不显示——同主流相册未开无入口） */
    pwSet: boolean;
    /** true = 锁定中（点锁弹密码框解锁）；false = 已解锁（点开锁重新锁定） */
    locked: boolean;
    /** 锁入口点击 */
    onLockClick: () => void;
    /** 全局 tag 池（过滤 chips 的词源） */
    allTags: string[];
    /** 已激活的过滤 tag（命中 chips 高亮） */
    activeTags: string[];
    onToggleTag: (tag: string) => void;
    /** 词级删除某个标签（从所有图片移除，调用方配确认框） */
    onTagDelete: (tag: string) => void;
    onSelect: (group: number | "all" | "wall") => void;
    /** 返回 true = 创建成功（收起内联输入） */
    onCreate: (name: string) => Promise<boolean>;
    onRename: (id: number, name: string) => void;
    onDelete: (group: GalleryGroup) => void;
    /** 拖文件到组行 = 导入进该组 */
    onDropFiles: (paths: string[], groupId: number) => void;
    /** 打开「从网址导入」对话框（导入内容自动单独成组，不落当前视图） */
    onUrlImport: () => void;
};

// 左侧分组栏：全部图片（伪条目）→ 收件箱（内置，不可删/改名）→ 画廊（伪条目）→ 用户分组
// （创建序）→ 底部「＋ 新建分组」与「从网址导入」。分组行右键菜单 + 文件拖放目标（dragover 高亮）。
// 私密分组只在解锁视角出现（锁定时后端不下发，这里无需处理锁定态）。
export function GroupSidebar({
    groups,
    allCount,
    wallCount,
    active,
    onTogglePrivate,
    onWallAddGroup,
    pwSet,
    locked,
    onLockClick,
    allTags,
    activeTags,
    onToggleTag,
    onTagDelete,
    onSelect,
    onCreate,
    onRename,
    onDelete,
    onDropFiles,
    onUrlImport,
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

    // 行样式：选中 = 选中行填充 + 强调色文字，未选中悬浮给悬停填充
    const rowCls = (on: boolean) =>
        `flex w-full cursor-default select-none items-center gap-1.5 px-2 py-1.5 text-left text-[12.5px] ${
            on ? "bg-rowsel text-primary" : "text-dim-foreground hover:bg-hover hover:text-foreground"
        }`;

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

    /** 组行内容：改名中显示内联输入；私密组带开锁小图标示意（仅解锁视角可见该行） */
    function groupRow(group: GalleryGroup, on: boolean, dragging: boolean) {
        const name = group.inbox ? t("gallery.inbox") : group.name;
        return (
            <div
                onClick={() => renamingId !== group.id && onSelect(group.id)}
                className={`${rowCls(on)} ${
                    dragging && !on ? "bg-hover outline outline-1 -outline-offset-1 outline-primary" : ""
                }`}
            >
                {renamingId === group.id ? (
                    <Input
                        autoFocus
                        value={renameName}
                        onChange={(e) => setRenameName(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") commitRename();
                            else if (e.key === "Escape") setRenamingId(null);
                        }}
                        onBlur={commitRename}
                        className="h-6 min-w-0 flex-1 px-1"
                    />
                ) : (
                    <>
                        <span className="min-w-0 flex-1 truncate">{name}</span>
                        {group.private && <LockOpen size={11} className="flex-none text-dim-foreground" />}
                        <span className="flex-none text-[10.5px] tabular-nums text-dim-foreground">{group.count}</span>
                    </>
                )}
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
                    <ContextMenuItem onClick={() => onTogglePrivate(group, !group.private)}>
                        {group.private ? t("gallery.group.clearPrivate") : t("gallery.group.setPrivate")}
                    </ContextMenuItem>
                    <ContextMenuItem onClick={() => onWallAddGroup(group)}>
                        {t("gallery.wall.addGroup")}
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
        <aside className="flex w-48 flex-none flex-col border-e border-line bg-background">
            {/* 滚动区外套一层 flex 列：内容滚动，锁入口钉在滚动区底部（贴「新建分组」
                上方分隔线），不随内容多少浮动 */}
            <div className="flex min-h-0 flex-1 flex-col">
                <div className="min-h-0 flex-1 overflow-y-auto py-1.5">
                    {/* 「全部图片」伪条目：count = 各组之和 */}
                    <div className={rowCls(active === "all")} onClick={() => onSelect("all")}>
                        <span className="min-w-0 flex-1 truncate">{t("gallery.all")}</span>
                        <span className="flex-none text-[10.5px] tabular-nums text-dim-foreground">{allCount}</span>
                    </div>
                    {inbox && groupEntry(inbox)}
                    {/* 「画廊」伪条目：跨分组的放映池，count 由后端按锁定视角算好 */}
                    <div className={rowCls(active === "wall")} onClick={() => onSelect("wall")}>
                        <span className="min-w-0 flex-1 truncate">{t("gallery.wall")}</span>
                        <span className="flex-none text-[10.5px] tabular-nums text-dim-foreground">{wallCount}</span>
                    </div>
                    {userGroups.map((g) => groupEntry(g))}
                    {groups === null && <div className="px-2 py-1.5 text-[12px] text-dim-foreground">…</div>}

                    {/* 全局 tag 过滤：分组列表下方一条分隔线隔开，不占缩略图区 */}
                    {allTags.length > 0 && (
                        <>
                            <div className="mx-2 my-1.5 border-t border-line" aria-hidden />
                            <div className="flex flex-wrap gap-1 px-2 pb-1">
                                {allTags.map((tag) => (
                                    <ContextMenu key={tag}>
                                        <ContextMenuTrigger asChild>
                                            <Button
                                                type="button"
                                                appearance="standard"
                                                variant="outline"
                                                size="xs"
                                                className="px-1.5"
                                                aria-pressed={activeTags.includes(tag)}
                                                onClick={() => onToggleTag(tag)}
                                            >
                                                {tag}
                                            </Button>
                                        </ContextMenuTrigger>
                                        <ContextMenuContent>
                                            <ContextMenuItem variant="destructive" onClick={() => onTagDelete(tag)}>
                                                {t("gallery.tag.deleteAll")}
                                            </ContextMenuItem>
                                        </ContextMenuContent>
                                    </ContextMenu>
                                ))}
                            </div>
                        </>
                    )}
                </div>

                {/* 私密锁入口：主流相册式的隐晦入口——钉在列表区最底部（「新建分组」
                    上方分隔线之上）、纯图标右对齐、低调灰；解锁后变成开锁图标（点击重新锁定） */}
                {pwSet && (
                    <button
                        type="button"
                        onClick={onLockClick}
                        aria-label={locked ? t("gallery.pw.unlockBtn") : t("gallery.pw.lockBtn")}
                        className="flex w-full flex-none justify-end px-2 py-1 text-dim-foreground hover:text-muted-foreground"
                    >
                        {locked ? <Lock size={12} /> : <LockOpen size={12} />}
                    </button>
                )}
            </div>
            <div className="flex-none space-y-1.5 border-t border-line p-1.5">
                {creating ? (
                    <Input
                        autoFocus
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") void submitCreate();
                            else if (e.key === "Escape") setCreating(false);
                        }}
                        onBlur={() => void submitCreate()}
                        placeholder={t("gallery.groupNamePlaceholder")}
                        className="h-6 w-full"
                    />
                ) : (
                    <Button
                        type="button"
                        appearance="standard"
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
                <Button
                    type="button"
                    appearance="standard"
                    variant="outline"
                    size="xs"
                    className="w-full"
                    onClick={onUrlImport}
                >
                    <Globe />
                    {t("gallery.urlImport")}
                </Button>
            </div>
        </aside>
    );
}
