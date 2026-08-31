import { useEffect, useRef, useState } from "react";
import { ImagePlus, SquareCheckBig } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/dialogs/ConfirmDialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api, type GalleryGroup, type GalleryImage } from "@/api/client";
import { useI18n } from "@/i18n/useI18n";
import type { MessageKey } from "@/i18n/zh";
import { GroupSidebar } from "./gallery/GroupSidebar";
import { ImageGrid } from "./gallery/ImageGrid";
import { TagEditor } from "./gallery/TagEditor";
import { Viewer } from "./gallery/Viewer";
import { FORMATS, extOf, fmt } from "./gallery/util";

// 图库：左分组栏 + 右网格。数据编排都在这里——查询状态（分组/标签/搜索/排序）
// 是纯组件 state（TOOL_SPEC §5：运行时状态不还原），分页取 200 展 100 增量渲染；
// 竞态防护用序号 ref（TranslateTool 同款）：查询变更推进序号，晚归旧包丢弃。

const PAGE = 200; // 每页取回条数（= 后端单次上限）
const STEP = 100; // 网格增量渲染步长
const DEBOUNCE_MS = 350; // 搜索输入防抖
const IMPORT_BATCH = 16; // 导入分批大小（渲染端约定）

type SortId = "time" | "name" | "size";
type Query = { group: number | "all"; tags: string[]; search: string; sort: SortId };
type ImportState = { total: number; done: number; skipped: number };
type TagTarget = { mode: "image"; image: GalleryImage } | { mode: "batch"; ids: number[] };
type ConfirmTarget = { kind: "images"; ids: number[]; fromViewer?: boolean } | { kind: "group"; group: GalleryGroup };

const SORTS: readonly { id: SortId; key: MessageKey }[] = [
    { id: "time", key: "gallery.sort.time" },
    { id: "name", key: "gallery.sort.name" },
    { id: "size", key: "gallery.sort.size" },
];

export default function GalleryTool() {
    const { t } = useI18n();
    const rootRef = useRef<HTMLDivElement>(null);

    // ── 数据 ──
    const [groups, setGroups] = useState<GalleryGroup[] | null>(null);
    const [allTags, setAllTags] = useState<string[]>([]);
    const [query, setQuery] = useState<Query>({ group: "all", tags: [], search: "", sort: "time" });
    const [searchInput, setSearchInput] = useState("");
    const [items, setItems] = useState<GalleryImage[]>([]);
    const [total, setTotal] = useState(0);
    const [status, setStatus] = useState<"loading" | "done">("loading");
    const [visibleCount, setVisibleCount] = useState(STEP);
    const [reloadTick, setReloadTick] = useState(0);
    const seq = useRef(0);
    const fetchingMore = useRef(false);

    // ── 交互 ──
    // 选择模式：开启后缩略图才可勾选（普通模式单击即开查看器），退出时清空勾选
    const [selectMode, setSelectMode] = useState(false);
    const [selectedIds, setSelectedIds] = useState<ReadonlySet<number>>(new Set());
    const anchorRef = useRef<number | null>(null); // Shift 范围选择的起点
    const [menuIds, setMenuIds] = useState<number[]>([]);
    const [viewerIndex, setViewerIndex] = useState<number | null>(null);
    const [tagTarget, setTagTarget] = useState<TagTarget | null>(null);
    const [confirmTarget, setConfirmTarget] = useState<ConfirmTarget | null>(null);

    function exitSelectMode() {
        setSelectMode(false);
        setSelectedIds(new Set());
    }

    // ── 导入 ──
    const [importing, setImporting] = useState<ImportState | null>(null);
    const importBusy = useRef(false);
    const cancelImport = useRef(false);
    const [dragOver, setDragOver] = useState(false);

    // 异步回调里要用的最新 state 快照（挂一次的 document 监听避免闭包过期）
    const queryRef = useRef(query);
    queryRef.current = query;
    const groupsRef = useRef(groups);
    groupsRef.current = groups;

    const allCount = (groups ?? []).reduce((s, g) => s + g.count, 0);

    /** 重拉分组 + 全局 tag 池，返回新分组表（供「all 视图落收件箱」即时取用） */
    async function refreshGroups(): Promise<GalleryGroup[]> {
        const [g, tg] = await Promise.all([api.galleryGroups(), api.galleryAllTags()]);
        if (g.ok) setGroups(g.data);
        if (tg.ok) setAllTags(tg.data);
        return g.ok ? g.data : [];
    }

    /** 任何变更操作后的统一刷新：重拉 groups + tags，图片查询重置到第一页 */
    function refreshAll() {
        void refreshGroups();
        setReloadTick((v) => v + 1);
    }

    useEffect(() => {
        void refreshGroups();
    }, []);

    // 图片查询主链路：依赖一变立即查（防抖只作用于打字，见 searchInput effect）；
    // 序号对不上的晚归旧包直接丢弃
    useEffect(() => {
        const my = ++seq.current;
        fetchingMore.current = false;
        setVisibleCount(STEP);
        setStatus("loading");
        void api
            .galleryImages({
                group: query.group,
                tags: query.tags,
                search: query.search,
                sort: query.sort,
                limit: PAGE,
                offset: 0,
            })
            .then((r) => {
                if (my !== seq.current) return;
                if (r.ok) {
                    setItems(r.data.items);
                    setTotal(r.data.total);
                } else {
                    setItems([]);
                    setTotal(0);
                    toast.error(t("toast.error"));
                }
                setStatus("done");
            });
    }, [query, reloadTick, t]);

    // 搜索框防抖进 query（trim 后相同就不动对象，避免多余 refetch）
    useEffect(() => {
        const timer = setTimeout(() => {
            const v = searchInput.trim();
            setQuery((q) => (q.search === v ? q : { ...q, search: v }));
        }, DEBOUNCE_MS);
        return () => clearTimeout(timer);
    }, [searchInput]);

    // 查询变化即清空选择：旧选中 id 对新结果集可能已失效
    useEffect(() => {
        setSelectedIds(new Set());
        anchorRef.current = null;
    }, [query, reloadTick]);

    // 增量渲染 + 翻页：先扩展示数，取回的不够看且库里还有再取下一页
    function loadMore() {
        if (visibleCount < items.length) {
            setVisibleCount((c) => Math.min(c + STEP, items.length));
            return;
        }
        if (fetchingMore.current || items.length >= total) return;
        fetchingMore.current = true;
        const my = seq.current;
        void api
            .galleryImages({
                group: query.group,
                tags: query.tags,
                search: query.search,
                sort: query.sort,
                limit: PAGE,
                offset: items.length,
            })
            .then((r) => {
                fetchingMore.current = false;
                if (my !== seq.current) return;
                if (!r.ok) return;
                const got = r.data.items;
                setItems((prev) => [...prev, ...got]);
                setTotal(r.data.total);
                setVisibleCount((c) => c + STEP);
            });
    }
    const loadMoreRef = useRef(loadMore);
    loadMoreRef.current = loadMore;

    // ── 多选 ──
    function selectSingle(index: number) {
        const id = items[index]?.id;
        if (id == null) return;
        anchorRef.current = index;
        setSelectedIds(new Set([id]));
    }
    function toggleSelect(index: number) {
        const id = items[index]?.id;
        if (id == null) return;
        anchorRef.current = index;
        setSelectedIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }
    function rangeSelect(index: number) {
        const from = anchorRef.current ?? 0;
        const [a, b] = from <= index ? [from, index] : [index, from];
        const next = new Set<number>();
        for (let i = a; i <= b; i++) {
            const it = items[i];
            if (it) next.add(it.id);
        }
        setSelectedIds(next);
    }

    // ── document 键盘：选择模式下 Ctrl+A 全选 / Esc 退出选择 ──
    useEffect(() => {
        function editable(el: EventTarget | null): boolean {
            const n = el as HTMLElement | null;
            return !!n && (n.tagName === "INPUT" || n.tagName === "TEXTAREA" || n.isContentEditable);
        }
        function usable(): boolean {
            // ToolsZone 用 display:none 保活非活动 tab：offsetParent 为 null 时按键不归我们管
            if (rootRef.current?.offsetParent == null) return false;
            if (viewerIndex != null) return false; // 查看器自己吃按键
            if (document.querySelector("[role=dialog]")) return false; // 弹窗打开时不抢
            return true;
        }
        function onKeyDown(e: KeyboardEvent) {
            if (!selectMode) return;
            if (e.ctrlKey || e.metaKey) {
                if (e.key !== "a" && e.key !== "A") return;
                if (!usable() || editable(e.target)) return;
                e.preventDefault();
                setSelectedIds(new Set(items.map((i) => i.id)));
            } else if (e.key === "Escape") {
                if (!usable() || editable(e.target)) return;
                exitSelectMode();
            }
        }
        document.addEventListener("keydown", onKeyDown);
        return () => document.removeEventListener("keydown", onKeyDown);
    }, [items, viewerIndex, selectMode]);

    // ── 粘贴导入 ──
    /** 粘贴/导入落点：组视图 = 当前组；all 视图 = 收件箱（groups 未就绪先刷一把） */
    async function targetGroupId(): Promise<number | null> {
        const q = queryRef.current;
        if (q.group !== "all") return q.group;
        const gs = groupsRef.current ?? (await refreshGroups());
        return gs.find((g) => g.inbox)?.id ?? null;
    }

    async function pasteInto() {
        const gid = await targetGroupId();
        if (gid == null) {
            toast.error(t("toast.error"));
            return;
        }
        const r = await api.galleryPaste(gid);
        if (!r.ok) {
            // no-image = 剪贴板里没图（用户多半在粘文本）：静默不吵
            if (!(r.error.kind === "gallery" && r.error.code === "no-image")) toast.error(t("toast.error"));
            return;
        }
        if (r.data.imported === 1) toast.success(t("gallery.toast.pasted"));
        else toast(t("gallery.toast.dup"));
        refreshAll();
    }

    // 监听只挂一次，回调走 ref：永远调到最新的 pasteInto（含最新 t 与查询状态）
    const pasteRef = useRef(pasteInto);
    pasteRef.current = pasteInto;
    useEffect(() => {
        function onPaste(e: ClipboardEvent) {
            if (rootRef.current?.offsetParent == null) return; // 别的 tab 里粘贴不误触
            const el = e.target as HTMLElement | null;
            if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
            void pasteRef.current();
        }
        document.addEventListener("paste", onPaste);
        return () => document.removeEventListener("paste", onPaste);
    }, []);

    // ── 导入 ──
    async function runImport(paths: string[], groupId: number) {
        const files = paths.filter((p) => FORMATS.includes(extOf(p)));
        if (files.length === 0 || importBusy.current) return;
        importBusy.current = true;
        cancelImport.current = false;
        setImporting({ total: files.length, done: 0, skipped: 0 });
        let imported = 0;
        let skipped = 0;
        let ok = true;
        for (let i = 0; i < files.length; i += IMPORT_BATCH) {
            if (cancelImport.current) break; // 取消：已导入的保留
            const r = await api.galleryImport(files.slice(i, i + IMPORT_BATCH), groupId);
            if (!r.ok) {
                ok = false;
                toast.error(t("toast.error"));
                break; // 批次失败中止，已导入的保留
            }
            imported += r.data.imported;
            skipped += r.data.skipped;
            setImporting({ total: files.length, done: Math.min(i + IMPORT_BATCH, files.length), skipped });
        }
        setImporting(null);
        importBusy.current = false;
        if (ok && imported + skipped > 0) {
            toast.success(
                fmt(t("gallery.toast.imported"), { n: imported }) +
                    (skipped > 0 ? fmt(t("gallery.toast.skipped"), { n: skipped }) : ""),
            );
        }
        refreshAll(); // 取消/失败也刷：让已导入的部分立刻可见
    }

    async function importFiles() {
        const r = await api.galleryPickFiles();
        if (!r.ok) {
            toast.error(t("toast.error"));
            return;
        }
        if (r.data.length === 0) return; // 空数组 = 取消选择
        const gid = await targetGroupId();
        if (gid == null) {
            toast.error(t("toast.error"));
            return;
        }
        await runImport(r.data, gid);
    }

    function onRootDrop(e: React.DragEvent) {
        e.preventDefault();
        e.stopPropagation();
        setDragOver(false);
        const paths = Array.from(e.dataTransfer.files)
            .map((f) => window.knock.filePathFor(f))
            .filter(Boolean);
        if (paths.length === 0) return;
        void (async () => {
            const gid = await targetGroupId();
            if (gid == null) {
                toast.error(t("toast.error"));
                return;
            }
            await runImport(paths, gid);
        })();
    }

    // ── 分组操作 ──
    async function createGroup(name: string): Promise<boolean> {
        const r = await api.galleryCreateGroup(name);
        if (!r.ok) {
            toast.error(t("toast.error"));
            return false;
        }
        toast.success(t("toast.saved"));
        refreshAll();
        return true;
    }

    async function renameGroup(id: number, name: string) {
        const r = await api.galleryRenameGroup(id, name);
        if (!r.ok) {
            toast.error(t("toast.error"));
            return;
        }
        toast.success(t("toast.saved"));
        void refreshGroups();
    }

    function askDeleteGroup(group: GalleryGroup) {
        setConfirmTarget({ kind: "group", group });
    }

    // ── 网格菜单动作（作用于 menuIds）──
    async function moveMenuTo(groupId: number) {
        if (menuIds.length === 0) return;
        const r = await api.galleryMoveImages(menuIds, groupId);
        if (!r.ok) {
            toast.error(t("toast.error"));
            return;
        }
        toast.success(t("toast.saved"));
        refreshAll();
    }
    async function openSingle() {
        if (menuIds.length !== 1) return;
        const r = await api.galleryOpenImage(menuIds[0]);
        if (!r.ok) toast.error(t("toast.error"));
    }
    async function revealSingle() {
        if (menuIds.length !== 1) return;
        const r = await api.galleryRevealImage(menuIds[0]);
        if (!r.ok) toast.error(t("toast.error"));
    }
    function askDeleteMenu() {
        if (menuIds.length === 0) return;
        setConfirmTarget({ kind: "images", ids: [...menuIds] });
    }

    // ── 确认删除（图片批量 / 分组）──
    async function confirmDelete() {
        const tg = confirmTarget;
        if (!tg) return;
        if (tg.kind === "group") {
            const r = await api.galleryDeleteGroup(tg.group.id);
            if (!r.ok) {
                toast.error(t("toast.error"));
                return;
            }
            toast.success(t("toast.deleted"));
            if (queryRef.current.group === tg.group.id) setQuery((q) => ({ ...q, group: "all" }));
            refreshAll();
            return;
        }
        const r = await api.galleryDeleteImages(tg.ids);
        if (!r.ok) {
            toast.error(t("toast.error"));
            return;
        }
        toast.success(t("toast.deleted"));
        if (tg.fromViewer) {
            // 列表即时移除并指向相邻一张：优先同索引（原后一张），末尾退一格，全空关闭
            const idx = viewerIndex ?? 0;
            const kept = items.filter((it) => !tg.ids.includes(it.id));
            setItems(kept);
            setTotal((v) => Math.max(0, v - tg.ids.length));
            if (kept.length === 0) setViewerIndex(null);
            else setViewerIndex(Math.min(idx, kept.length - 1));
        }
        refreshAll();
    }

    // ── 标签保存（单图替换 / 批量并集）──
    async function saveTags(tags: string[]): Promise<boolean> {
        const tg = tagTarget;
        if (!tg) return false;
        if (tg.mode === "image") {
            const r = await api.gallerySetImageTags(tg.image.id, tags);
            if (!r.ok) {
                toast.error(t("toast.error"));
                return false;
            }
        } else {
            // 接口是整体替换语义，批量「添加」= 对每张求旧∪新再写回
            for (const id of tg.ids) {
                const old = items.find((it) => it.id === id)?.tags ?? [];
                const merged = Array.from(new Set([...old, ...tags]));
                const r = await api.gallerySetImageTags(id, merged);
                if (!r.ok) {
                    toast.error(t("toast.error"));
                    return false;
                }
            }
        }
        toast.success(t("toast.saved"));
        refreshAll();
        return true;
    }

    function toggleTagFilter(tag: string) {
        setQuery((q) => ({
            ...q,
            tags: q.tags.includes(tag) ? q.tags.filter((x) => x !== tag) : [...q.tags, tag],
        }));
    }

    // ── 派生文案 ──
    const resetKey = `${query.group}|${query.tags.join(",")}|${query.search}|${query.sort}|${reloadTick}`;
    const tagTitle = !tagTarget
        ? ""
        : tagTarget.mode === "batch"
          ? t("gallery.tags.batchTitle")
          : t("gallery.tags.editTitle");
    const tagHint =
        tagTarget?.mode === "batch" ? fmt(t("gallery.tags.batchHint"), { m: tagTarget.ids.length }) : undefined;
    const tagInitial = !tagTarget ? [] : tagTarget.mode === "image" ? tagTarget.image.tags : [];
    const confirmTitle = !confirmTarget
        ? ""
        : confirmTarget.kind === "images"
          ? t("gallery.delImagesTitle")
          : t("gallery.delGroupTitle");
    const confirmDesc = !confirmTarget
        ? ""
        : confirmTarget.kind === "images"
          ? fmt(t("gallery.delImagesDesc"), { n: confirmTarget.ids.length })
          : fmt(t("gallery.delGroupDesc"), {
                name: confirmTarget.group.inbox ? t("gallery.inbox") : confirmTarget.group.name,
                n: confirmTarget.group.count,
            });

    return (
        <div
            ref={rootRef}
            className="flex h-full"
            onDragOver={(e) => {
                if (!e.dataTransfer.types.includes("Files")) return;
                e.preventDefault();
                setDragOver(true);
            }}
            onDragLeave={(e) => {
                if (!rootRef.current?.contains(e.relatedTarget as Node | null)) setDragOver(false);
            }}
            // 捕获阶段先复位高亮：拖到分组行导入时子层 stopPropagation，根的 onDrop
            // 收不到，高亮会赖着不走；capture 在子层处理前必经
            onDropCapture={() => setDragOver(false)}
            onDrop={onRootDrop}
        >
            <GroupSidebar
                groups={groups}
                allCount={allCount}
                active={query.group}
                allTags={allTags}
                activeTags={query.tags}
                onToggleTag={toggleTagFilter}
                onSelect={(g) => setQuery((q) => ({ ...q, group: g }))}
                onCreate={createGroup}
                onRename={renameGroup}
                onDelete={askDeleteGroup}
                onDropFiles={(paths, gid) => void runImport(paths, gid)}
            />

            <section className="flex min-w-0 flex-1 flex-col">
                {/* 工具条 */}
                <div className="flex flex-none flex-wrap items-center gap-1.5 px-2 py-1.5">
                    <Button type="button" size="xs" onClick={() => void importFiles()}>
                        <ImagePlus />
                        {t("gallery.import")}
                    </Button>
                    <Button
                        type="button"
                        size="xs"
                        variant={selectMode ? "default" : "outline"}
                        onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
                    >
                        <SquareCheckBig />
                        {selectMode ? t("gallery.select.exit") : t("gallery.select.start")}
                    </Button>
                    <input
                        value={searchInput}
                        onChange={(e) => setSearchInput(e.target.value)}
                        spellCheck={false}
                        placeholder={t("gallery.searchPlaceholder")}
                        className="h-6 w-44 flex-none border border-line bg-bg px-2 text-[12px] text-text outline-none placeholder:text-muted focus:border-dim"
                    />
                    <Select value={query.sort} onValueChange={(v) => setQuery((q) => ({ ...q, sort: v as SortId }))}>
                        <SelectTrigger size="sm" className="h-6 w-28 px-2 text-[12px]">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {SORTS.map((s) => (
                                <SelectItem key={s.id} value={s.id}>
                                    {t(s.key)}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>

                {/* 导入进度 */}
                {importing && (
                    <div className="flex flex-none items-center gap-2 px-2 pb-1.5">
                        <span className="flex-none text-[11px] text-muted">
                            {fmt(t("gallery.importing"), { done: importing.done, total: importing.total })}
                        </span>
                        <div className="h-0.5 min-w-8 flex-1 bg-line">
                            <div
                                className="h-full bg-text"
                                style={{ width: `${importing.total ? (importing.done / importing.total) * 100 : 0}%` }}
                            />
                        </div>
                        <Button type="button" variant="outline" size="xs" onClick={() => (cancelImport.current = true)}>
                            {t("gallery.cancelImport")}
                        </Button>
                    </div>
                )}

                <ImageGrid
                    items={items}
                    status={status}
                    visibleCount={visibleCount}
                    selectedIds={selectedIds}
                    selectMode={selectMode}
                    groups={groups ?? []}
                    menuIds={menuIds}
                    resetKey={resetKey}
                    dropHint={dragOver}
                    onOpen={(i) => {
                        anchorRef.current = i;
                        setViewerIndex(i);
                    }}
                    onSelect={(i, mode) => {
                        if (mode === "toggle") toggleSelect(i);
                        else if (mode === "range") rangeSelect(i);
                        else selectSingle(i);
                    }}
                    onClearSelection={() => {
                        setSelectedIds(new Set());
                        anchorRef.current = null;
                    }}
                    onMenuIds={setMenuIds}
                    onLoadMore={() => loadMoreRef.current()}
                    onView={() => {
                        const idx = items.findIndex((it) => it.id === menuIds[0]);
                        if (idx >= 0) setViewerIndex(idx);
                    }}
                    onMove={(gid) => void moveMenuTo(gid)}
                    onAddTags={() => setTagTarget({ mode: "batch", ids: [...menuIds] })}
                    onOpenSingle={() => void openSingle()}
                    onRevealSingle={() => void revealSingle()}
                    onDelete={askDeleteMenu}
                    onImportCta={() => void importFiles()}
                />

                {/* 底部统计 */}
                <div className="flex flex-none items-center gap-3 border-t border-line px-2.5 py-1 text-[11px] text-muted">
                    <span>{fmt(t("gallery.total"), { n: total })}</span>
                    {selectedIds.size > 0 && <span>{fmt(t("gallery.selectedCount"), { m: selectedIds.size })}</span>}
                </div>
            </section>

            {viewerIndex != null && items[viewerIndex] && (
                <Viewer
                    items={items}
                    index={viewerIndex}
                    groups={groups ?? []}
                    onNav={setViewerIndex}
                    onClose={() => setViewerIndex(null)}
                    onEditTags={(img) => setTagTarget({ mode: "image", image: img })}
                    onDelete={(img) => setConfirmTarget({ kind: "images", ids: [img.id], fromViewer: true })}
                />
            )}

            {tagTarget && (
                <TagEditor
                    title={tagTitle}
                    hint={tagHint}
                    initialTags={tagInitial}
                    pool={allTags}
                    onSave={saveTags}
                    onClose={() => setTagTarget(null)}
                />
            )}

            <ConfirmDialog
                open={confirmTarget !== null}
                title={confirmTitle}
                description={confirmDesc}
                onClose={() => setConfirmTarget(null)}
                onConfirm={confirmDelete}
            />
        </div>
    );
}
