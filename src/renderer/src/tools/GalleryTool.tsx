import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, Globe, ImagePlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { MenuContent, MenuItem, MenuTrigger } from "@/components/ui/menu";
import { Progress } from "@/components/ui/progress";
import { StatusBar, StatusBarItem } from "@/components/ui/statusbar";
import { Switch } from "@/components/ui/switch";
import { Toolbar, ToolbarGroup, ToolbarSearch, ToolbarSeparator } from "@/components/ui/toolbar";
import { ConfirmDialog } from "@/components/dialogs/ConfirmDialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api, type GalleryGroup, type GalleryImage } from "@/api/client";
import { useI18n } from "@/i18n/useI18n";
import type { MessageKey } from "@/i18n/zh";
import { GroupSidebar } from "./gallery/GroupSidebar";
import { ImageGrid, type GridEmptyState } from "./gallery/ImageGrid";
import { PasswordDialog } from "./gallery/PasswordDialog";
import { TagEditor } from "./gallery/TagEditor";
import { UrlImport } from "./gallery/UrlImport";
import { Viewer } from "./gallery/Viewer";
import { FORMATS, extOf, fmt } from "./gallery/util";

// 图库：顶部工具栏、左分组栏和右网格。查询状态（分组/标签/收藏/搜索/排序）
// 是纯组件 state（TOOL_SPEC §5：运行时状态不还原），分页取 200 展 100 增量渲染；
// 竞态防护用序号 ref（TranslateTool 同款）：查询变更推进序号，晚归旧包丢弃。

const PAGE = 200; // 每页取回条数（= 后端单次上限）
const STEP = 100; // 网格增量渲染步长
const DEBOUNCE_MS = 350; // 搜索输入防抖
const IMPORT_BATCH = 16; // 导入分批大小（渲染端约定）

type SortId = "time" | "name" | "size";
type Query = { group: number | "all"; tags: string[]; search: string; sort: SortId; favoriteOnly: boolean };
type ImportState = { total: number; done: number; skipped: number };
type TagTarget = { mode: "image"; image: GalleryImage } | { mode: "batch"; ids: number[] };
type ConfirmTarget =
    | { kind: "images"; ids: number[]; fromViewer?: boolean }
    | { kind: "group"; group: GalleryGroup }
    | { kind: "tag"; tag: string };
/** 密码框目标：unlock = 解锁图库；set = 未设密码时「设为私密」的引导（设完顺手标记
 *  thenPrivateId 组）；修改/清除密码走设置弹窗的图库分节，不经这里 */
type PwTarget = { mode: "unlock" | "set"; thenPrivateId?: number };

const SORTS: readonly { id: SortId; key: MessageKey }[] = [
    { id: "time", key: "gallery.sort.time" },
    { id: "name", key: "gallery.sort.name" },
    { id: "size", key: "gallery.sort.size" },
];

export default function GalleryTool() {
    const { t } = useI18n();
    const rootRef = useRef<HTMLDivElement>(null);
    const favoriteSwitchId = useId();

    // ── 数据 ──
    const [groups, setGroups] = useState<GalleryGroup[] | null>(null);
    const [creatingGroup, setCreatingGroup] = useState(false);
    const [allTags, setAllTags] = useState<string[]>([]);
    const [query, setQuery] = useState<Query>({
        group: "all",
        tags: [],
        search: "",
        sort: "time",
        favoriteOnly: false,
    });
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
    const [viewerId, setViewerId] = useState<number | null>(null);
    const viewerIndex = viewerId == null ? -1 : items.findIndex((it) => it.id === viewerId);
    const favoritePending = useRef(false);
    const [tagTarget, setTagTarget] = useState<TagTarget | null>(null);
    const [confirmTarget, setConfirmTarget] = useState<ConfirmTarget | null>(null);
    // 图库密码与解锁态：解锁 = 持有明文密码（随列表/查询携带）。只存组件 state
    // ——工具关闭即卸载释放，重开回到锁定（解锁不跨会话，用户需求）
    const [pwSet, setPwSet] = useState(false); // 是否设了图库密码（锁定开关显隐的依据）
    const [unlocked, setUnlocked] = useState<string | null>(null);
    const [pwTarget, setPwTarget] = useState<PwTarget | null>(null);
    // 网址导入在打开弹窗时确定目标，抓取和分批入库期间沿用同一个分组。
    const [urlImportGroup, setUrlImportGroup] = useState<Pick<GalleryGroup, "id" | "name"> | null>(null);

    function exitSelectMode() {
        setSelectMode(false);
        setSelectedIds(new Set());
    }

    // ── 导入 ──
    const [importing, setImporting] = useState<ImportState | null>(null);
    const importBusy = useRef(false);
    const cancelImport = useRef(false);
    const [dragOver, setDragOver] = useState<"groups" | "grid" | null>(null);

    // 异步回调里要用的最新 state 快照（挂一次的 document 监听避免闭包过期）
    const queryRef = useRef(query);
    queryRef.current = query;
    const groupsRef = useRef(groups);
    groupsRef.current = groups;
    const unlockedRef = useRef(unlocked);
    unlockedRef.current = unlocked;

    // 「全部图片」计数与后端隔离边界一致：私密分组永远不计（解锁与否都不进全部视图）
    const allCount = (groups ?? []).filter((g) => !g.private).reduce((s, g) => s + g.count, 0);
    const importGroup = groups?.find((g) => g.id === query.group);
    const importGroupId = importGroup?.id ?? null;

    /** 重拉分组、标签池和密码状态，未传解锁密码时仅返回公开分组。 */
    async function refreshGroups(pw?: string): Promise<void> {
        const r = await api.galleryOverview(pw);
        if (!r.ok) return;
        setGroups(r.data.groups);
        setAllTags(r.data.tags);
        setPwSet(r.data.hasPassword);
    }

    /** 任何变更操作后的统一刷新：重拉 groups + tags，图片查询重置到第一页 */
    function refreshAll() {
        void refreshGroups(unlockedRef.current ?? undefined);
        setReloadTick((v) => v + 1);
    }

    // 解锁/锁定切换：分组表内容集随之变化，统一在此驱动（挂载首拉也走这里，
    // 密码状态一并同步）；图片重查由主查询 effect 对 unlocked 的依赖自动完成
    useEffect(() => {
        void refreshGroups(unlocked ?? undefined);
    }, [unlocked]);

    // 图片查询主链路：依赖一变立即查（防抖只作用于打字，见 searchInput effect）；
    // 序号对不上的晚归旧包直接丢弃
    useEffect(() => {
        const my = ++seq.current;
        fetchingMore.current = false;
        setVisibleCount(STEP);
        setStatus("loading");
        void api
            .galleryImages({
                ...query,
                limit: PAGE,
                offset: 0,
                password: unlocked ?? undefined,
            })
            .then((r) => {
                if (my !== seq.current) return;
                if (r.ok) {
                    setItems(r.data.items);
                    setTotal(r.data.total);
                } else {
                    setItems([]);
                    setTotal(0);
                    // locked = 解锁态已失效（如密码在设置里被改掉）：回到锁定并重拉
                    // （[unlocked] effect 随之收回私密分组），退回全部并提示重新解锁
                    if (r.error.kind === "gallery" && r.error.code === "locked") {
                        setUnlocked(null);
                        setQuery((q) => ({ ...q, group: "all" }));
                        toast.error(t("gallery.pw.locked"));
                    } else {
                        toast.error(t("toast.error"));
                    }
                }
                setStatus("done");
            });
    }, [query, reloadTick, unlocked]); // 依赖故意不含 t：语言切换不值得整轮重查（错误 toast 瞬时显示，旧语言无感）

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
        if (query.favoriteOnly && favoritePending.current) return;
        if (visibleCount < items.length) {
            setVisibleCount((c) => Math.min(c + STEP, items.length));
            return;
        }
        if (fetchingMore.current || items.length >= total) return;
        fetchingMore.current = true;
        const my = seq.current;
        void api
            .galleryImages({
                ...query,
                limit: PAGE,
                offset: items.length,
                password: unlockedRef.current ?? undefined,
            })
            .then((r) => {
                if (my !== seq.current) return;
                fetchingMore.current = false;
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
            // dock 对非活动面板隐藏保活：offsetParent 为 null 时按键不归我们管
            if (rootRef.current?.offsetParent == null) return false;
            if (viewerIndex >= 0) return false; // 查看器自己吃按键
            if (document.querySelector("[role=dialog]")) return false; // 弹窗打开时不抢
            return true;
        }
        function onKeyDown(e: KeyboardEvent) {
            if (!selectMode || e.defaultPrevented) return;
            if (e.ctrlKey || e.metaKey) {
                if (e.key !== "a" && e.key !== "A") return;
                if (!usable() || editable(e.target)) return;
                e.preventDefault();
                setSelectedIds(new Set(items.map((i) => i.id)));
            } else if (e.key === "Escape") {
                if (!usable() || editable(e.target)) return;
                // 已处理就标记出来：App 层的 Esc 看到 defaultPrevented 就不会把整个窗口收起
                e.preventDefault();
                exitSelectMode();
            }
        }
        document.addEventListener("keydown", onKeyDown);
        return () => document.removeEventListener("keydown", onKeyDown);
    }, [items, viewerIndex, selectMode]);

    // ── 粘贴导入 ──
    async function pasteInto(hasImage: boolean) {
        if (importGroupId == null) {
            if (hasImage) toast(t("gallery.import.selectGroup"));
            return;
        }
        const r = await api.galleryPaste(importGroupId);
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
            const hasImage = Array.from(e.clipboardData?.items ?? []).some((item) => item.type.startsWith("image/"));
            void pasteRef.current(hasImage);
        }
        document.addEventListener("paste", onPaste);
        return () => document.removeEventListener("paste", onPaste);
    }, []);

    // ── 导入 ──
    /** 汇总本地导入完成时写入和跳过的图片数量。 */
    function showImportResult(imported: number, skipped: number) {
        toast.success(
            fmt(t("gallery.toast.imported"), { n: imported }) +
                (skipped > 0 ? fmt(t("gallery.toast.skipped"), { n: skipped }) : ""),
        );
    }

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
        if (ok && imported + skipped > 0) showImportResult(imported, skipped);
        refreshAll(); // 取消/失败也刷：让已导入的部分立刻可见
    }

    async function importFiles() {
        const gid = importGroupId;
        if (gid == null) {
            toast(t("gallery.import.selectGroup"));
            return;
        }
        const r = await api.galleryPickFiles();
        if (!r.ok) {
            toast.error(t("toast.error"));
            return;
        }
        if (r.data.length === 0) return; // 空数组 = 取消选择
        await runImport(r.data, gid);
    }

    function openUrlImport() {
        if (!importGroup) {
            toast(t("gallery.import.selectGroup"));
            return;
        }
        setUrlImportGroup({ id: importGroup.id, name: importGroup.name });
    }

    /** 文件夹导入完成后选中新组，失败时刷新已成功写入的图片。 */
    async function importFolder(path: string) {
        if (importBusy.current) return;
        importBusy.current = true;
        const loading = toast.loading(t("gallery.folder.importing"));
        try {
            const result = await api.galleryImportFolder(path);
            if (!result.ok) {
                const { error } = result;
                toast.error(error.kind === "gallery-folder" ? t(`gallery.folder.${error.code}`) : t("toast.error"));
                return;
            }
            const { groupId, imported, skipped } = result.data;
            setQuery((q) => ({ ...q, group: groupId }));
            showImportResult(imported, skipped);
        } catch {
            toast.error(t("toast.error"));
        } finally {
            toast.dismiss(loading);
            importBusy.current = false;
            refreshAll();
        }
    }

    /** 分组行只接收拖到当前选中行的文件，避免落到指针下方的其他分组。 */
    function dropGroupId(target: EventTarget): number | null {
        const row = (target as HTMLElement).closest<HTMLElement>("[data-gallery-group]");
        return row && row.dataset.galleryGroup !== String(importGroupId) ? null : importGroupId;
    }

    function onRootDrop(e: React.DragEvent) {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        e.stopPropagation();
        setDragOver(null);
        const files = Array.from(e.dataTransfer.files);
        const target = e.target as HTMLElement;
        if (
            target.closest("[data-gallery-group-sidebar]") &&
            Array.from(e.dataTransfer.items).some((item) => item.webkitGetAsEntry()?.isDirectory)
        ) {
            if (files.length !== 1) {
                toast(t("gallery.folder.single"));
                return;
            }
            const path = window.knock.filePathFor(files[0]);
            if (path) void importFolder(path);
            else toast.error(t("gallery.folder.unreadable"));
            return;
        }
        const paths = files.map((f) => window.knock.filePathFor(f)).filter(Boolean);
        if (paths.length === 0) return;
        const gid = dropGroupId(e.target);
        if (gid == null) {
            toast(t("gallery.import.selectGroup"));
            return;
        }
        void runImport(paths, gid);
    }

    // ── 分组操作 ──
    async function createGroup(name: string): Promise<boolean> {
        const r = await api.galleryCreateGroup(name);
        if (!r.ok) {
            toast.error(t("toast.error"));
            return false;
        }
        toast.success(t("toast.saved"));
        setQuery((q) => ({ ...q, group: r.data.id }));
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

    // ── 图库密码（工具级一个）：解锁态 = 手上握着明文密码，锁定开关在工具条 ──

    /** 锁定：立即收回私密内容。上锁永远免密；清掉可能含私密图的弹窗和查看器，
     *  当前组是私密则退回全部。分组表与「全部」由 [unlocked] effect 与主查询 effect 重拉 */
    function lockLibrary() {
        setUnlocked(null);
        setPwTarget(null);
        setViewerId(null);
        setTagTarget(null);
        setConfirmTarget(null);
        const q = queryRef.current;
        if (q.group !== "all") {
            const grp = groupsRef.current?.find((g) => g.id === q.group);
            if (grp?.private) setQuery((x) => ({ ...x, group: "all" }));
        }
    }

    /** 分组标记/取消私密。未设密码时标记无从生效——先引导设密码，设完顺手标记 */
    function togglePrivate(group: GalleryGroup, isPrivate: boolean) {
        if (isPrivate && !pwSet) {
            setPwTarget({ mode: "set", thenPrivateId: group.id });
            return;
        }
        void api.gallerySetGroupPrivate(group.id, isPrivate).then((r) => {
            if (!r.ok) {
                toast.error(t("toast.error"));
                return;
            }
            toast.success(t(isPrivate ? "gallery.pw.setPrivateDone" : "gallery.pw.clearPrivateDone"));
            refreshAll();
        });
    }

    /** 密码框提交：unlock = 校验通过即解锁；set = 落库后顺手解锁（不打断当前视图） */
    async function submitPassword(pw: string): Promise<boolean> {
        const tg = pwTarget;
        if (!tg) return false;
        if (tg.mode === "unlock") {
            const r = await api.galleryUnlock(pw);
            if (!r.ok) {
                if (r.error.kind === "gallery" && r.error.code === "wrong-password") {
                    toast.error(t("gallery.pw.wrong"));
                } else {
                    toast.error(t("toast.error"));
                }
                return false; // 框留着，改一下重试
            }
            setUnlocked(pw); // 分组表与图片集由 effects 跟随刷新
            return true;
        }
        if (tg.thenPrivateId != null) {
            const pr = await api.gallerySetGroupPrivate(tg.thenPrivateId, true);
            if (!pr.ok) {
                toast.error(t("toast.error"));
                return false;
            }
        }
        setPwSet(true);
        setUnlocked(pw); // [unlocked] effect 重拉的分组表此时已含私密标记
        toast.success(t("gallery.pw.setDone"));
        return true;
    }

    /**
     * 移动工具栏选中项或右键菜单所指的图片。
     * @param ids 要移动的图片编号。
     * @param groupId 目标分组编号。
     */
    async function moveImagesTo(ids: number[], groupId: number) {
        if (ids.length === 0) return;
        const r = await api.galleryMoveImages(ids, groupId);
        if (!r.ok) {
            toast.error(t("toast.error"));
            return;
        }
        toast.success(t("toast.saved"));
        refreshAll();
    }

    // ── 网格菜单动作（作用于 menuIds）──
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

    // ── 确认删除（图片批量 / 分组 / 标签词）──
    async function confirmDelete() {
        const tg = confirmTarget;
        if (!tg) return;
        if (tg.kind === "tag") {
            const r = await api.galleryDeleteTag(tg.tag);
            if (!r.ok) {
                toast.error(t("toast.error"));
                return;
            }
            // 该词可能正被用作过滤器，删除后一并摘掉
            setQuery((q) => ({ ...q, tags: q.tags.filter((x) => x !== tg.tag) }));
            toast.success(t("toast.deleted"));
            refreshAll();
            return;
        }
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
            const idx = Math.max(viewerIndex, 0);
            const gone = new Set(tg.ids);
            const kept = items.filter((it) => !gone.has(it.id));
            setItems(kept);
            setTotal((v) => Math.max(0, v - tg.ids.length));
            setSelectedIds((prev) => new Set([...prev].filter((id) => !gone.has(id))));
            setViewerId((kept[idx] ?? kept[idx - 1])?.id ?? null);
            // 不走 refreshAll：reloadTick 会把列表重置回前 200 条、网格滚回顶部，
            // 本地补丁已让行集正确，只需追平侧栏计数
            void refreshGroups(unlockedRef.current ?? undefined);
            return;
        }
        refreshAll();
    }

    /**
     * 保存收藏状态，并在收藏筛选中选择仍在列表中的相邻图片。
     * @param image 正在查看的图片。
     * @param favorite 要保存的收藏状态。
     * @returns 保存和界面更新结束后完成。
     */
    async function setFavorite(image: GalleryImage, favorite: boolean): Promise<void> {
        if (favoritePending.current || status !== "done") return;
        favoritePending.current = true;
        const removing = query.favoriteOnly && !favorite;
        const index = viewerIndex;
        const password = unlocked ?? undefined;
        // 移除图片会改变后续页的偏移，丢弃按原偏移查询的分页结果。
        const requestSeq = removing ? ++seq.current : seq.current;
        if (removing) fetchingMore.current = false;
        try {
            const r = await api.gallerySetImageFavorite(image.id, favorite, password);
            if (requestSeq !== seq.current) return;
            if (!r.ok) {
                if (r.error.kind === "gallery" && r.error.code === "locked") {
                    lockLibrary();
                    toast.error(t("gallery.pw.locked"));
                } else {
                    toast.error(t("toast.error"));
                }
                return;
            }
            if (!removing) {
                setItems((prev) => prev.map((it) => (it.id === image.id ? { ...it, favorite } : it)));
                return;
            }

            const following = items[index + 1];
            let nextPageItem: GalleryImage | undefined;
            let remaining = total - 1;
            if (!following && items.length < total) {
                // 当前图是已加载列表的末尾，移除后下一张会落在它原来的位置。
                const page = await api.galleryImages({ ...query, limit: 1, offset: index, password }).catch(() => null);
                if (requestSeq !== seq.current) return;
                if (page?.ok) {
                    nextPageItem = page.data.items[0];
                    remaining = page.data.total;
                } else {
                    toast.error(t("toast.error"));
                }
            }
            setItems((prev) => {
                const kept = prev.filter((it) => it.id !== image.id);
                return nextPageItem ? [...kept, nextPageItem] : kept;
            });
            setTotal(remaining);
            const next = following ?? nextPageItem ?? items[index - 1];
            setViewerId((id) => (id === image.id ? (next?.id ?? null) : id));
            anchorRef.current = null;
            setSelectedIds((prev) => new Set([...prev].filter((id) => id !== image.id)));
        } catch {
            toast.error(t("toast.error"));
        } finally {
            favoritePending.current = false;
        }
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
            setItems((prev) => prev.map((it) => (it.id === tg.image.id ? { ...it, tags } : it)));
        } else {
            const r = await api.galleryAddTagsToImages(tg.ids, tags);
            if (!r.ok) {
                toast.error(t("toast.error"));
                return false;
            }
            const ids = new Set(tg.ids);
            setItems((prev) =>
                prev.map((it) => (ids.has(it.id) ? { ...it, tags: Array.from(new Set([...it.tags, ...tags])) } : it)),
            );
        }
        toast.success(t("toast.saved"));
        // 只更新当前行的标签和标签池，保留网格的滚动位置。
        void api.galleryAllTags().then((r) => {
            if (r.ok) setAllTags(r.data);
        });
        return true;
    }

    function toggleTagFilter(tag: string) {
        setQuery((q) => ({
            ...q,
            tags: q.tags.includes(tag) ? q.tags.filter((x) => x !== tag) : [...q.tags, tag],
        }));
    }

    /** 清除图片筛选，保留当前分组和排序。 */
    function clearFilters() {
        setSearchInput("");
        setQuery((q) => ({ ...q, search: "", tags: [], favoriteOnly: false }));
    }

    /** 网格无图时，按当前分组和筛选条件提供下一步操作。 */
    function emptyState(): GridEmptyState | null {
        if (groups === null) return null;
        if (query.search || query.tags.length > 0 || query.favoriteOnly) {
            return {
                title: t(query.search || query.tags.length > 0 ? "gallery.empty.noMatch" : "gallery.favorite.empty"),
                action: { label: t("gallery.filter.clear"), onClick: clearFilters },
            };
        }
        if (importGroup) {
            return {
                title: t("gallery.empty.group"),
                description: t("gallery.emptyHint"),
                action: { label: t("gallery.import"), onClick: () => void importFiles() },
            };
        }
        if (groups.length === 0) {
            return {
                title: t("gallery.empty"),
                description: t("gallery.empty.folderHint"),
                action: {
                    label: t("gallery.newGroup"),
                    onClick: () => setCreatingGroup(true),
                    disabled: creatingGroup,
                },
            };
        }
        return { title: t("gallery.empty"), description: t("gallery.import.selectGroup") };
    }

    const selectedGroupId = selectedIds.size > 0 ? items.find((item) => selectedIds.has(item.id))?.groupId : undefined;
    const selectedSameGroup =
        selectedGroupId != null && !items.some((item) => selectedIds.has(item.id) && item.groupId !== selectedGroupId);
    const moveGroups = (groups ?? []).filter((group) => !selectedSameGroup || group.id !== selectedGroupId);

    // ── 派生文案 ──
    const resetKey = `${query.group}|${query.tags.join(",")}|${query.search}|${query.sort}|${query.favoriteOnly}|${reloadTick}`;
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
          : confirmTarget.kind === "group"
            ? t("gallery.delGroupTitle")
            : t("gallery.tag.delTitle");
    const confirmDesc = !confirmTarget
        ? ""
        : confirmTarget.kind === "images"
          ? fmt(t("gallery.delImagesDesc"), { n: confirmTarget.ids.length })
          : confirmTarget.kind === "group"
            ? fmt(t("gallery.delGroupDesc"), {
                  name: confirmTarget.group.name,
                  n: confirmTarget.group.count,
              })
            : fmt(t("gallery.tag.delDesc"), { tag: confirmTarget.tag });
    // set 模式唯一入口 = 未设密码时右键「设为私密」的引导（修改/清除密码走设置弹窗的图库分节）
    const pwTitle = !pwTarget
        ? ""
        : pwTarget.mode === "unlock"
          ? t("gallery.pw.unlockTitle")
          : t("gallery.pw.setTitle");

    return (
        <div
            ref={rootRef}
            className="flex h-full flex-col"
            onDragOver={(e) => {
                if (!e.dataTransfer.types.includes("Files")) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "copy";
                // 拖放完成前读不到文件条目，空类型用于提示文件夹可能的落点。
                if (
                    (e.target as HTMLElement).closest("[data-gallery-group-sidebar]") &&
                    Array.from(e.dataTransfer.items).some((item) => item.kind === "file" && !item.type)
                ) {
                    setDragOver("groups");
                } else {
                    setDragOver(dropGroupId(e.target) != null ? "grid" : null);
                }
            }}
            onDragLeave={(e) => {
                if (!rootRef.current?.contains(e.relatedTarget as Node | null)) setDragOver(null);
            }}
            onDrop={onRootDrop}
        >
            <Toolbar className="gan-no-drag h-auto min-h-(--size-toolbar) flex-none flex-wrap gap-1.5 px-2 py-1.5">
                <ToolbarGroup>
                    <Button
                        type="button"
                        appearance="standard"
                        variant="outline"
                        size="xs"
                        onClick={() => void importFiles()}
                    >
                        <ImagePlus />
                        {t("gallery.import")}
                    </Button>
                    <Button type="button" appearance="standard" variant="outline" size="xs" onClick={openUrlImport}>
                        <Globe />
                        {t("gallery.urlImport")}
                    </Button>
                </ToolbarGroup>
                <ToolbarGroup>
                    {/* 选择模式用开关而非按钮：状态一目了然，也免去「选择/退出选择」两态文案切换 */}
                    <span className="flex items-center gap-1.5">
                        <Switch
                            id="gallery-select-mode"
                            checked={selectMode}
                            onCheckedChange={(v) => (v ? setSelectMode(true) : exitSelectMode())}
                        />
                        <label
                            htmlFor="gallery-select-mode"
                            className="cursor-pointer text-[12px] text-muted-foreground"
                        >
                            {t("gallery.select.mode")}
                        </label>
                    </span>
                    <span className="flex items-center gap-1.5">
                        <Switch
                            id={favoriteSwitchId}
                            checked={query.favoriteOnly}
                            onCheckedChange={(favoriteOnly) => setQuery((q) => ({ ...q, favoriteOnly }))}
                        />
                        <label htmlFor={favoriteSwitchId} className="cursor-pointer text-[12px] text-muted-foreground">
                            {t("gallery.favorite.only")}
                        </label>
                    </span>
                </ToolbarGroup>
                <ToolbarSeparator />
                <ToolbarSearch
                    type="text"
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    spellCheck={false}
                    placeholder={t("gallery.searchPlaceholder")}
                    aria-label={t("gallery.searchPlaceholder")}
                    className="w-44"
                />
                <ToolbarGroup>
                    <Select value={query.sort} onValueChange={(v) => setQuery((q) => ({ ...q, sort: v as SortId }))}>
                        {/* h-6 必须 !：SelectTrigger 内部 data-[size=sm]:h-8 带属性选择器，普通 h-6 压不过 */}
                        <SelectTrigger size="sm" className="h-6! w-28 px-2 text-[12px]">
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
                </ToolbarGroup>
            </Toolbar>

            {/* 导入进度 */}
            {importing && (
                <div className="flex flex-none items-center gap-2 px-2 pb-1.5">
                    <span className="flex-none text-[11px] text-dim-foreground">
                        {fmt(t("gallery.importing"), { done: importing.done, total: importing.total })}
                    </span>
                    <Progress
                        value={importing.total ? (importing.done / importing.total) * 100 : 0}
                        className="h-0.5 min-w-8 flex-1"
                    />
                    <Button
                        type="button"
                        appearance="standard"
                        variant="outline"
                        size="xs"
                        onClick={() => (cancelImport.current = true)}
                    >
                        {t("gallery.cancelImport")}
                    </Button>
                </div>
            )}

            <div className="flex min-h-0 flex-1">
                <GroupSidebar
                    groups={groups}
                    allCount={allCount}
                    active={query.group}
                    dropHint={dragOver === "groups"}
                    onTogglePrivate={togglePrivate}
                    pwSet={pwSet}
                    locked={unlocked == null}
                    onLockClick={() => (unlocked == null ? setPwTarget({ mode: "unlock" }) : lockLibrary())}
                    allTags={allTags}
                    activeTags={query.tags}
                    onToggleTag={toggleTagFilter}
                    onTagDelete={(tag) => setConfirmTarget({ kind: "tag", tag })}
                    onSelect={(g) => setQuery((q) => ({ ...q, group: g }))}
                    creating={creatingGroup}
                    onCreatingChange={setCreatingGroup}
                    onCreate={createGroup}
                    onRename={renameGroup}
                    onDelete={askDeleteGroup}
                />
                <section className="flex min-w-0 flex-1 flex-col">
                    <ImageGrid
                        items={items}
                        status={status}
                        visibleCount={visibleCount}
                        selectedIds={selectedIds}
                        selectMode={selectMode}
                        empty={emptyState()}
                        groups={groups ?? []}
                        menuIds={menuIds}
                        resetKey={resetKey}
                        dropHint={dragOver === "grid"}
                        onOpen={(i) => {
                            anchorRef.current = i;
                            setViewerId(items[i]?.id ?? null);
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
                            if (items.some((it) => it.id === menuIds[0])) setViewerId(menuIds[0]);
                        }}
                        onMove={(gid) => void moveImagesTo(menuIds, gid)}
                        onAddTags={() => {
                            // 单选直接开编辑框（chip 可 × 删除），多选保持批量添加（并集）
                            if (menuIds.length === 1) {
                                const img = items.find((it) => it.id === menuIds[0]);
                                if (img) {
                                    setTagTarget({ mode: "image", image: img });
                                    return;
                                }
                            }
                            setTagTarget({ mode: "batch", ids: [...menuIds] });
                        }}
                        onOpenSingle={() => void openSingle()}
                        onRevealSingle={() => void revealSingle()}
                        onDelete={askDeleteMenu}
                    />

                    {/* 底部统计 */}
                    <StatusBar className="gap-3 px-2.5">
                        <StatusBarItem className="text-[11px] text-dim-foreground">
                            {fmt(t("gallery.total"), { n: total })}
                        </StatusBarItem>
                        {selectMode && selectedIds.size > 0 && (
                            <div className="ml-auto flex items-center gap-2">
                                <StatusBarItem emphasis className="text-[11px]">
                                    {fmt(t("gallery.selectedCount"), { m: selectedIds.size })}
                                </StatusBarItem>
                                <MenuTrigger align="end" disabled={moveGroups.length === 0}>
                                    <Button
                                        type="button"
                                        appearance="standard"
                                        variant="outline"
                                        size="xs"
                                        disabled={moveGroups.length === 0}
                                    >
                                        {t("gallery.menu.moveTo")}
                                        <ChevronDown />
                                    </Button>
                                    <MenuContent className="max-h-[50vh] max-w-72 overflow-auto">
                                        {moveGroups.map((group) => (
                                            <MenuItem
                                                key={group.id}
                                                onSelect={() => void moveImagesTo([...selectedIds], group.id)}
                                            >
                                                <span className="truncate">{group.name}</span>
                                            </MenuItem>
                                        ))}
                                    </MenuContent>
                                </MenuTrigger>
                                <Button
                                    type="button"
                                    appearance="standard"
                                    variant="outline"
                                    size="xs"
                                    onClick={() => setTagTarget({ mode: "batch", ids: [...selectedIds] })}
                                >
                                    {t("gallery.menu.addTags")}
                                </Button>
                            </div>
                        )}
                    </StatusBar>
                </section>
            </div>

            {viewerIndex >= 0 && (
                <Viewer
                    items={items}
                    index={viewerIndex}
                    groups={groups ?? []}
                    onNav={(i) => setViewerId(items[i]?.id ?? null)}
                    onClose={() => setViewerId(null)}
                    onSetFavorite={(img, favorite) => void setFavorite(img, favorite)}
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

            {pwTarget && (
                <PasswordDialog
                    title={pwTitle}
                    hint={pwTarget.mode === "unlock" ? t("gallery.pw.unlockHint") : undefined}
                    confirmLabel={pwTarget.mode === "unlock" ? t("gallery.pw.unlockBtn") : t("common.save")}
                    onSubmit={submitPassword}
                    onClose={() => setPwTarget(null)}
                />
            )}

            {urlImportGroup !== null && (
                <UrlImport group={urlImportGroup} onClose={() => setUrlImportGroup(null)} onImported={refreshAll} />
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
