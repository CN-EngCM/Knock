import { memo, useEffect, useMemo, useRef, useState } from "react";
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
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import type { GalleryGroup, GalleryImage } from "@/api/client";
import { useI18n } from "@/i18n/useI18n";
import { requestThumb } from "./thumbQueue";

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

function NameBlock({ img }: { img: GalleryImage }) {
    // 图挂了不裂版：兜底块显示名字与格式
    return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-(--state-hover) px-1 text-center">
            <span className="w-full truncate text-[10.5px] text-muted-foreground">{img.title}</span>
            <span className="text-[10px] text-dim-foreground">{img.format}</span>
        </div>
    );
}

// 缩略图由渲染端生成：先直接请求现成的；404（还没有）就占位并排队生成，
// 成功后换成带 ?v=1 的地址（绕开浏览器对刚才失败结果的缓存）；再失败就用名字兜底块
function Thumb({ img }: { img: GalleryImage }) {
    const [phase, setPhase] = useState<"first" | "generating" | "ready" | "failed">("first");
    const alive = useRef(true);
    useEffect(() => {
        alive.current = true;
        return () => {
            alive.current = false;
        };
    }, []);

    function onError() {
        if (phase !== "first") {
            setPhase("failed");
            return;
        }
        setPhase("generating");
        void requestThumb(img.id, img.format).then((ok) => {
            if (alive.current) setPhase(ok ? "ready" : "failed");
        });
    }

    if (phase === "failed") return <NameBlock img={img} />;
    if (phase === "generating") return <div className="h-full w-full bg-(--state-hover)" />;
    return (
        <img
            src={`mpimg://thumb/${img.id}${phase === "ready" ? "?v=1" : ""}`}
            alt={img.title}
            loading="lazy"
            decoding="async"
            draggable={false}
            onError={onError}
            className="h-full w-full object-cover"
        />
    );
}

// 单个格子：memo 包住，勾选一张只重渲染那一格。点击和右键都由网格容器按 data-index 统一处理，
// 所以格子不需要回调 props
const Cell = memo(function Cell({
    img,
    index,
    selected,
    selectMode,
}: {
    img: GalleryImage;
    index: number;
    selected: boolean;
    selectMode: boolean;
}) {
    return (
        <div
            data-index={index}
            title={img.title}
            className={`relative aspect-square cursor-default overflow-hidden rounded-[4px] border ${
                selectMode && selected ? "border-primary ring-1 ring-primary" : "border-line hover:border-border"
            }`}
            // content-visibility：万级规模时屏外单元格跳过排版
            style={{ contentVisibility: "auto", containIntrinsicSize: "auto 132px" }}
        >
            <Thumb img={img} />
            {selectMode && (
                // 左上角方框勾选标记：未勾=半透明空框（压在图上要可读），勾=强调色实底打勾
                <span
                    className={`absolute left-1 top-1 flex size-4 items-center justify-center rounded-[3px] border ${
                        selected ? "border-primary bg-primary text-primary-foreground" : "border-white/70 bg-black/30"
                    }`}
                >
                    {selected && <Check size={11} strokeWidth={3.5} />}
                </span>
            )}
        </div>
    );
});

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
    // id → 下标：右键目标的归属查找用，避免每次渲染对 items 线性扫描
    const indexById = useMemo(() => new Map(items.map((it, i) => [it.id, i])), [items]);
    // 右键目标的归属：全在同一组时，禁用「移动到」里的当前组
    const targets = menuIds.map((id) => items[indexById.get(id) ?? -1]).filter((x) => x != null);
    const sameGroup = targets.length > 0 && targets.every((it) => it.groupId === targets[0].groupId);
    const viewIdx = indexById.get(menuIds[0]) ?? -1;

    /** 事件目标所在格子的下标；点在空白处返回 null */
    function cellIndexOf(target: EventTarget): number | null {
        const el = (target as HTMLElement).closest<HTMLElement>("[data-index]");
        return el ? Number(el.dataset.index) : null;
    }

    function onGridClick(e: React.MouseEvent) {
        const i = cellIndexOf(e.target);
        if (i == null) {
            onClearSelection(); // 点空白清选
            return;
        }
        // 普通模式单击即开；选择模式单击=勾选（Ctrl 单切 / Shift 范围）
        if (!selectMode) onOpen(i);
        else if (e.ctrlKey || e.metaKey) onSelect(i, "toggle");
        else if (e.shiftKey) onSelect(i, "range");
        else onSelect(i, "single");
    }

    // 右键先于菜单打开：把作用目标报给父组件（选中集包含目标=作用于选中集）。
    // 空白处 preventDefault：Radix 看到 defaultPrevented 就不开菜单
    function onGridContextMenu(e: React.MouseEvent) {
        const i = cellIndexOf(e.target);
        const img = i == null ? undefined : shown[i];
        if (!img) {
            e.preventDefault();
            return;
        }
        onMenuIds(selectedIds.has(img.id) ? [...selectedIds] : [img.id]);
    }

    return (
        <ContextMenu>
            <ContextMenuTrigger asChild>
                <div
                    ref={scrollRef}
                    onClick={onGridClick}
                    onContextMenu={onGridContextMenu}
                    className={`min-h-0 flex-1 overflow-auto p-2 ${dropHint ? "bg-(--state-hover)" : "bg-canvas"}`}
                >
                    {status === "loading" && items.length === 0 && (
                        <div className="flex items-center justify-center py-10">
                            <Spinner label={t("common.loading")} className="text-dim-foreground" />
                        </div>
                    )}

                    {status === "done" && items.length === 0 && (
                        <Empty className="h-full justify-center">
                            <EmptyHeader>
                                <EmptyTitle>{t("gallery.empty")}</EmptyTitle>
                                <EmptyDescription className="text-[11.5px] text-dim-foreground">
                                    {t(wallView ? "gallery.wall.emptyHint" : "gallery.emptyHint")}
                                </EmptyDescription>
                            </EmptyHeader>
                            {!wallView && (
                                <EmptyContent>
                                    <Button
                                        type="button"
                                        appearance="standard"
                                        variant="primary"
                                        size="sm"
                                        onClick={onImportCta}
                                    >
                                        {t("gallery.import")}
                                    </Button>
                                </EmptyContent>
                            )}
                        </Empty>
                    )}

                    <div
                        className="grid gap-2"
                        style={{ gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))" }}
                    >
                        {shown.map((img, i) => (
                            <Cell
                                key={img.id}
                                img={img}
                                index={i}
                                selected={selectedIds.has(img.id)}
                                selectMode={selectMode}
                            />
                        ))}
                    </div>
                    <div ref={sentinelRef} className="h-px" aria-hidden />
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
                                <span className="ml-auto pl-3 text-[11px] text-dim-foreground">{g.count}</span>
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
}
