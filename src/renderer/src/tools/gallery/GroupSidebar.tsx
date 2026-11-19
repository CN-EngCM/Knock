import { useState } from "react";
import { Folder, Lock, LockOpen } from "lucide-react";
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuSeparator,
    ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Item, ItemActions, ItemContent, ItemMedia, ItemTitle } from "@/components/ui/item";
import { Separator } from "@/components/ui/separator";
import { Toggle } from "@/components/ui/toggle";
import type { GalleryGroup } from "@/api/client";
import { useI18n } from "@/i18n/useI18n";

type Props = {
    /** null = 首拉未就绪，列表区留白 */
    groups: GalleryGroup[] | null;
    /** 「全部图片」伪条目的计数（各组之和；锁定视角的 groups 本就不含私密分组） */
    allCount: number;
    active: number | "all";
    /** 系统文件拖到侧栏时，用于提示文件夹可以在这里建组。 */
    dropHint: boolean;
    /** 分组标记/取消私密（标记时未设图库密码由调用方先引导设密码） */
    onTogglePrivate: (group: GalleryGroup, isPrivate: boolean) => void;
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
    onSelect: (group: number | "all") => void;
    /** 空态入口和左栏入口共用这个输入框。 */
    creating: boolean;
    /** 打开或关闭新建分组输入框。 */
    onCreatingChange: (creating: boolean) => void;
    /** 返回 true = 创建成功（收起内联输入） */
    onCreate: (name: string) => Promise<boolean>;
    onRename: (id: number, name: string) => void;
    onDelete: (group: GalleryGroup) => void;
};

// 左侧依次显示全部图片、按创建顺序排列的分组和标签，底部是解锁入口与新建分组。
// 私密分组只在解锁视角出现（锁定时后端不下发，这里无需处理锁定态）。
export function GroupSidebar({
    groups,
    allCount,
    active,
    dropHint,
    onTogglePrivate,
    pwSet,
    locked,
    onLockClick,
    allTags,
    activeTags,
    onToggleTag,
    onTagDelete,
    onSelect,
    creating,
    onCreatingChange,
    onCreate,
    onRename,
    onDelete,
}: Props) {
    const { t } = useI18n();
    const [newName, setNewName] = useState("");
    const [renamingId, setRenamingId] = useState<number | null>(null);
    const [renameName, setRenameName] = useState("");

    const list = groups ?? [];

    // 行样式：选中 = 选中行填充 + 强调色文字，未选中悬浮给悬停填充
    const rowCls = (on: boolean) =>
        `flex w-full cursor-default select-none items-center gap-1.5 px-2 py-1.5 text-left text-[12.5px] ${
            on
                ? "bg-(--state-selected) text-primary"
                : "text-dim-foreground hover:bg-(--state-hover) hover:text-foreground"
        }`;

    // 分组行换 Item 后覆写库的默认密度：单行不换行、无圆角/边框，让行高与上方伪条目一致
    const itemRowCls = (on: boolean) => `${rowCls(on)} flex-nowrap rounded-none border-0`;

    function commitRename() {
        const id = renamingId;
        const name = renameName.trim();
        setRenamingId(null);
        if (id == null || !name) return;
        const g = list.find((x) => x.id === id);
        if (g && name !== g.name) onRename(id, name);
    }

    /** 收起输入框并清空本次输入。 */
    function closeCreate() {
        onCreatingChange(false);
        setNewName("");
    }

    async function submitCreate() {
        const name = newName.trim();
        if (!name || (await onCreate(name))) closeCreate();
    }

    /** 组行内容：Item 薄包装（媒体槽 = 文件夹图标，私密组换开锁图标；
     *  改名中只留内联输入，计数与图标一并让位——与原行行为一致） */
    function groupRow(group: GalleryGroup) {
        return (
            <Item
                onClick={() => renamingId !== group.id && onSelect(group.id)}
                className={itemRowCls(active === group.id)}
            >
                {renamingId === group.id ? (
                    <ItemContent>
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
                            className="h-6 min-w-0 px-1"
                        />
                    </ItemContent>
                ) : (
                    <>
                        <ItemMedia>{group.private ? <LockOpen aria-hidden /> : <Folder aria-hidden />}</ItemMedia>
                        <ItemContent>
                            <ItemTitle className="w-full text-[12.5px] font-normal leading-normal">
                                <span className="min-w-0 flex-1 truncate">{group.name}</span>
                            </ItemTitle>
                        </ItemContent>
                        <ItemActions>
                            <Badge
                                variant="ghost"
                                className="flex-none px-0 text-[10.5px] tabular-nums text-dim-foreground"
                            >
                                {group.count}
                            </Badge>
                        </ItemActions>
                    </>
                )}
            </Item>
        );
    }

    function groupEntry(group: GalleryGroup) {
        return (
            <ContextMenu key={group.id}>
                <ContextMenuTrigger asChild>
                    <div data-gallery-group={group.id}>{groupRow(group)}</div>
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
                    <ContextMenuSeparator />
                    <ContextMenuItem variant="destructive" onClick={() => onDelete(group)}>
                        {t("gallery.menu.delete")}
                    </ContextMenuItem>
                </ContextMenuContent>
            </ContextMenu>
        );
    }

    return (
        <aside
            data-gallery-group-sidebar
            className={`flex w-48 flex-none flex-col border-e border-line ${dropHint ? "bg-(--state-hover) outline outline-1 -outline-offset-1 outline-primary" : "bg-background"}`}
        >
            {/* 滚动区外套一层 flex 列：内容滚动，锁入口钉在滚动区底部（贴「新建分组」
                上方分隔线），不随内容多少浮动 */}
            <div className="flex min-h-0 flex-1 flex-col">
                <div className="min-h-0 flex-1 overflow-y-auto py-1.5">
                    {/* 「全部图片」伪条目：count = 各组之和 */}
                    <div data-gallery-group="all" className={rowCls(active === "all")} onClick={() => onSelect("all")}>
                        <span className="min-w-0 flex-1 truncate">{t("gallery.all")}</span>
                        <Badge
                            variant="ghost"
                            className="flex-none px-0 text-[10.5px] tabular-nums text-dim-foreground"
                        >
                            {allCount}
                        </Badge>
                    </div>
                    {list.map(groupEntry)}
                    {groups === null && <div className="px-2 py-1.5 text-[12px] text-dim-foreground">…</div>}

                    {/* 全局 tag 过滤：分组列表下方一条分隔线隔开，不占缩略图区 */}
                    {allTags.length > 0 && (
                        <>
                            <Separator className="mx-2 my-1.5 w-auto" />
                            <div className="flex flex-wrap gap-1 px-2 pb-1">
                                {allTags.map((tag) => (
                                    <ContextMenu key={tag}>
                                        {/* ContextMenuTrigger 会给子元素注入 data-state=open/closed，
                                            Toggle 的选中态也用 data-state；中间垫一层 span 隔离两者 */}
                                        <ContextMenuTrigger asChild>
                                            <span className="inline-flex">
                                                <Toggle
                                                    type="button"
                                                    variant="outline"
                                                    size="sm"
                                                    className="h-(--size-control-xs) px-(--space-sm)"
                                                    pressed={activeTags.includes(tag)}
                                                    onPressedChange={() => onToggleTag(tag)}
                                                >
                                                    {tag}
                                                </Toggle>
                                            </span>
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
            <div className="flex-none border-t border-line p-1.5">
                {creating ? (
                    <Input
                        autoFocus
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") void submitCreate();
                            else if (e.key === "Escape") closeCreate();
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
                        onClick={() => onCreatingChange(true)}
                    >
                        ＋ {t("gallery.newGroup")}
                    </Button>
                )}
            </div>
        </aside>
    );
}
