import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuSeparator,
    ContextMenuSub,
    ContextMenuSubContent,
    ContextMenuSubTrigger,
    ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Button } from "@/components/ui/button";
import type { GalleryGroup, GalleryImage } from "@/api/client";
import { useI18n } from "@/i18n/useI18n";

type Props = {
    items: GalleryImage[];
    status: "loading" | "done";
    /** 当前渲染到第几张（增量渲染），≤ items.length */
    visibleCount: number;
    selectedIds: ReadonlySet<number>;
    /** 选择模式：点击=勾选（配合方框标记）；关闭时点击=直接打开查看器 */
    selectMode: boolean;
    groups: GalleryGroup[];
    /** 右键菜单的作用目标（选中集或单图），父组件据此执行批量动作 */
    menuIds: number[];
    /** 当前是否画廊视图：右键出「从画廊移除」（普通视图出「加入画廊」，单选目标已在册则置灰） */
    wallView: boolean;
    /** 右键「加入画廊/从画廊移除」（父组件按 wallView 分派） */
    onWall: () => void;
    /** 变化时把滚动位置归零（查询切换/刷新） */
    resetKey: string;
    /** 根容器正在拖文件悬停：网格区给个底色反馈 */
    dropHint: boolean;
    onOpen: (index: number) => void;
    /** mode: single = 普通点击单选；toggle = Ctrl 点击；range = Shift 从锚点范围选 */
    onSelect: (index: number, mode: "single" | "toggle" | "range") => void;
    /** 点网格空白处：清空选中（含 Shift 锚点） */
    onClearSelection: () => void;
    onMenuIds: (ids: number[]) => void;
    /** 滚动近底：先扩 visibleCount，不够再翻页（父组件实现） */
    onLoadMore: () => void;
    onView: () => void;
    onMove: (groupId: number) => void;
    onAddTags: () => void;
    onOpenSingle: () => void;
    onRevealSingle: () => void;
    onDelete: () => void;
    onImportCta: () => void;
};

function Thumb({ img }: { img: GalleryImage }) {
    const [failed, setFailed] = useState(false);
    if (failed) {
        // 图挂了不裂版：兜底块显示名字与格式
        return (
            <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-faint px-1 text-center">
                <span className="w-full truncate text-[10.5px] text-dim">{img.title}</span>
                <span className="text-[10px] text-muted">{img.format}</span>
            </div>
        );
    }
    return (
        <img
            src={`mpimg://thumb/${img.id}`}
            alt={img.title}
            loading="lazy"
            decoding="async"
            draggable={false}
            onError={() => setFailed(true)}
            className="h-full w-full object-cover"
        />
    );
}

// 网格：auto-fill 方格缩略图 + 增量渲染（滚动哨兵通知父组件）+ 多选 + 右键菜单
export function ImageGrid({
    items,
    status,
    visibleCount,
    selectedIds,
    selectMode,
    groups,
    menuIds,
    wallView,
    onWall,
    resetKey,
    dropHint,
    onOpen,
    onSelect,
    onClearSelection,
    onMenuIds,
    onLoadMore,
    onView,
    onMove,
    onAddTags,
    onOpenSingle,
    onRevealSingle,
    onDelete,
    onImportCta,
}: Props) {
    const { t } = useI18n();
    const scrollRef = useRef<HTMLDivElement>(null);
    const sentinelRef = useRef<HTMLDivElement>(null);
    // 哨兵回调走 ref：IntersectionObserver 只建一次，永远调最新的 loadMore 闭包
    const moreRef = useRef(onLoadMore);
    moreRef.current = onLoadMore;

    // 查询切换时回到顶部，否则新结果从页面中部开始看
    useEffect(() => {
        scrollRef.current?.scrollTo({ top: 0 });
    }, [resetKey]);

    useEffect(() => {
        const el = sentinelRef.current;
        const root = scrollRef.current;
        if (!el || !root) return;
        const io = new IntersectionObserver(
            (entries) => {
                if (entries.some((e) => e.isIntersecting)) moreRef.current();
            },
            // 提前 600px 预载，滚动到近底才翻页会闪
            { root, rootMargin: "600px" },
        );
        io.observe(el);
        return () => io.disconnect();
    }, []);

    const shown = items.slice(0, visibleCount);
    // 右键目标的归属：全在同一组时，禁用「移动到」里的当前组
    const targets = menuIds.map((id) => items.find((it) => it.id === id)).filter((x) => x != null);
    const sameGroup = targets.length > 0 && targets.every((it) => it.groupId === targets[0].groupId);
    const viewIdx = items.findIndex((it) => it.id === menuIds[0]);

    return (
        <div
            ref={scrollRef}
            onClick={onClearSelection}
            className={`min-h-0 flex-1 overflow-auto p-2 ${dropHint ? "bg-faint" : ""}`}
        >
            {status === "loading" && items.length === 0 && (
                <div className="px-6 py-10 text-center text-[12px] text-muted">…</div>
            )}

            {status === "done" && items.length === 0 && (
                <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                    <span className="text-[13px] text-dim">{t("gallery.empty")}</span>
                    <span className="text-[11.5px] text-muted">
                        {t(wallView ? "gallery.wall.emptyHint" : "gallery.emptyHint")}
                    </span>
                    {!wallView && (
                        <Button type="button" size="sm" onClick={onImportCta}>
                            {t("gallery.import")}
                        </Button>
                    )}
                </div>
            )}

            <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))" }}>
                {shown.map((img, i) => {
                    const selected = selectedIds.has(img.id);
                    return (
                        <ContextMenu key={img.id}>
                            <ContextMenuTrigger asChild>
                                <div
                                    onClick={(e) => {
                                        e.stopPropagation(); // 不冒泡到容器的「点空白清选」
                                        // 普通模式单击即开；选择模式单击=勾选（Ctrl 单切 / Shift 范围）
                                        if (!selectMode) {
                                            onOpen(i);
                                            return;
                                        }
                                        if (e.ctrlKey || e.metaKey) onSelect(i, "toggle");
                                        else if (e.shiftKey) onSelect(i, "range");
                                        else onSelect(i, "single");
                                    }}
                                    // 右键先于菜单打开：把作用目标报给父组件（选中集包含目标=作用于选中集）
                                    onContextMenu={() =>
                                        onMenuIds(selectedIds.has(img.id) ? [...selectedIds] : [img.id])
                                    }
                                    title={img.title}
                                    className={`relative aspect-square cursor-default overflow-hidden rounded border ${
                                        selectMode && selected
                                            ? "border-text ring-1 ring-text"
                                            : "border-line hover:border-dim"
                                    }`}
                                    // content-visibility：万级规模时屏外单元格跳过排版
                                    style={{ contentVisibility: "auto", containIntrinsicSize: "auto 132px" }}
                                >
                                    <Thumb img={img} />
                                    {selectMode && (
                                        // 左上角方框勾选标记：未勾=半透明空框（压在图上要可读），勾=反色实底打勾
                                        <span
                                            className={`absolute left-1 top-1 flex size-4 items-center justify-center rounded-[3px] border ${
                                                selected ? "border-text bg-text text-bg" : "border-white/70 bg-black/30"
                                            }`}
                                        >
                                            {selected && <Check size={11} strokeWidth={3.5} />}
                                        </span>
                                    )}
                                </div>
                            </ContextMenuTrigger>
                            <ContextMenuContent>
                                <ContextMenuItem disabled={viewIdx < 0} onClick={() => viewIdx >= 0 && onView()}>
                                    {t("gallery.menu.view")}
                                </ContextMenuItem>
                                <ContextMenuSub>
                                    <ContextMenuSubTrigger>{t("gallery.menu.moveTo")}</ContextMenuSubTrigger>
                                    <ContextMenuSubContent>
                                        {groups.map((g) => (
                                            <ContextMenuItem
                                                key={g.id}
                                                disabled={sameGroup && targets[0].groupId === g.id}
                                                onClick={() => onMove(g.id)}
                                            >
                                                {g.inbox ? t("gallery.inbox") : g.name}
                                                <span className="ml-auto pl-3 text-[11px] text-muted">{g.count}</span>
                                            </ContextMenuItem>
                                        ))}
                                    </ContextMenuSubContent>
                                </ContextMenuSub>
                                <ContextMenuItem onClick={onAddTags}>
                                    {menuIds.length === 1 ? t("gallery.menu.editTags") : t("gallery.menu.addTags")}
                                </ContextMenuItem>
                                {/* 单选且已在册 → 置灰（比点了没反应诚实）；多选混合态保持可点，后端幂等跳过 */}
                                <ContextMenuItem
                                    disabled={!wallView && menuIds.length === 1 && targets[0]?.inWall === true}
                                    onClick={onWall}
                                >
                                    {wallView ? t("gallery.wall.remove") : t("gallery.wall.add")}
                                    {!wallView && menuIds.length > 1 ? ` (${menuIds.length})` : ""}
                                </ContextMenuItem>
                                <ContextMenuItem disabled={menuIds.length !== 1} onClick={onOpenSingle}>
                                    {t("gallery.menu.openWith")}
                                </ContextMenuItem>
                                <ContextMenuItem disabled={menuIds.length !== 1} onClick={onRevealSingle}>
                                    {t("gallery.menu.reveal")}
                                </ContextMenuItem>
                                {/* 画廊视图是策展面：只有「移出」，库级删除（破坏性）不在此提供，
                                    防整理放映内容时顺手误删原图——要删去分组视图删 */}
                                {!wallView && (
                                    <>
                                        <ContextMenuSeparator />
                                        <ContextMenuItem variant="destructive" onClick={onDelete}>
                                            {t("gallery.menu.delete")}
                                            {menuIds.length > 1 ? ` (${menuIds.length})` : ""}
                                        </ContextMenuItem>
                                    </>
                                )}
                            </ContextMenuContent>
                        </ContextMenu>
                    );
                })}
            </div>
            <div ref={sentinelRef} className="h-px" aria-hidden />
        </div>
    );
}
