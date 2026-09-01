import { useEffect, useRef, useState } from "react";
import { ImagePlus, Play } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ConfirmDialog } from "@/components/dialogs/ConfirmDialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api, type GalleryGroup, type GalleryImage } from "@/api/client";
import { useI18n } from "@/i18n/useI18n";
import type { MessageKey } from "@/i18n/zh";
import { GroupSidebar } from "./gallery/GroupSidebar";
import { ImageGrid } from "./gallery/ImageGrid";
import { PasswordDialog } from "./gallery/PasswordDialog";
import { Slideshow } from "./gallery/Slideshow";
import { TagEditor } from "./gallery/TagEditor";
import { UrlImport } from "./gallery/UrlImport";
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
type Query = { group: number | "all" | "wall"; tags: string[]; search: string; sort: SortId };
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
    // 图库密码与解锁态：解锁 = 持有明文密码（随列表/查询携带）。只存组件 state
    // ——工具关闭即卸载释放，重开回到锁定（解锁不跨会话，用户需求）
    const [pwSet, setPwSet] = useState(false); // 是否设了图库密码（锁定开关显隐的依据）
    const [unlocked, setUnlocked] = useState<string | null>(null);
    const [pwTarget, setPwTarget] = useState<PwTarget | null>(null);
    // 从网址导入：入口在侧栏（导入内容自动单独成组，不落当前视图）
    const [urlImport, setUrlImport] = useState(false);
    // 画廊：侧栏计数 + 放映覆盖层（快照取全量，见 Slideshow）
    const [wallCount, setWallCount] = useState(0);
    const [slideshow, setSlideshow] = useState(false);

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
    const unlockedRef = useRef(unlocked);
    unlockedRef.current = unlocked;

    // 「全部图片」计数与后端隔离边界一致：私密分组永远不计（解锁与否都不进全部视图）
    const allCount = (groups ?? []).filter((g) => !g.private).reduce((s, g) => s + g.count, 0);

    /** 重拉分组 + 全局 tag 池 + 密码状态，返回新分组表（供「all 视图落收件箱」即时取用）。
     *  pw = 解锁密码：锁定视角（缺省）下私密分组不随列表下发；密码状态顺带同步
     *  （设置页改密后，锁入口显隐与解锁态在这里追平） */
    async function refreshGroups(pw?: string): Promise<GalleryGroup[]> {
        const [g, tg, ps, wc] = await Promise.all([
            api.galleryGroups(pw),
            api.galleryAllTags(),
            api.galleryPasswordState(),
            api.galleryWallCount(pw),
        ]);
        if (g.ok) setGroups(g.data);
        if (tg.ok) setAllTags(tg.data);
        if (ps.ok) setPwSet(ps.data.has);
        if (wc.ok) setWallCount(wc.data.count);
        return g.ok ? g.data : [];
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
                group: query.group,
                tags: query.tags,
                search: query.search,
                sort: query.sort,
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
    }, [query, reloadTick, unlocked, t]);

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
                password: unlockedRef.current ?? undefined,
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
            if (slideshow) return false; // 放映层同理
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
    }, [items, viewerIndex, selectMode, slideshow]);

    // ── 粘贴导入 ──
    /** 粘贴/导入落点：组视图 = 当前组；all/wall 视图 = 收件箱（groups 未就绪先刷一把） */
    async function targetGroupId(): Promise<number | null> {
        const q = queryRef.current;
        if (q.group !== "all" && q.group !== "wall") return q.group;
        const gs = groupsRef.current ?? (await refreshGroups(unlockedRef.current ?? undefined));
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

    function openUrlImport() {
        setUrlImport(true);
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

    // ── 图库密码（工具级一个）：解锁态 = 手上握着明文密码，锁定开关在工具条 ──

    /** 锁定：立即收回私密内容。上锁永远免密；清掉可能含私密图的弹窗/查看器/放映层，
     *  当前组是私密则退回全部。分组表与「全部」由 [unlocked] effect 与主查询 effect 重拉 */
    function lockLibrary() {
        setUnlocked(null);
        setPwTarget(null);
        setViewerIndex(null);
        setSlideshow(false);
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

    // ── 画廊（放映墙）：成员籍操作，图片本体与分组归属都不动 ──
    // 三者都不走 refreshAll（reloadTick 会把网格滚动归零）：画廊成员籍不影响当前视图
    // 的行集与顺序，本地补丁 + 重拉侧栏计数即可，滚动位置原地不动（用户实测反馈）。

    /** 加入结果统一提示：有新增报数量，全在册报「已在画廊」（幂等并集的诚实反馈） */
    function wallToast(added: number) {
        toast.success(added > 0 ? fmt(t("gallery.wall.added"), { n: added }) : t("gallery.wall.already"));
    }

    /** 重拉侧栏（分组计数 + 画廊计数），不动网格 */
    function refreshWallCount() {
        void refreshGroups(unlockedRef.current ?? undefined);
    }

    async function wallAddMenu() {
        if (menuIds.length === 0) return;
        const r = await api.galleryWallAdd(menuIds);
        if (!r.ok) {
            toast.error(t("toast.error"));
            return;
        }
        wallToast(r.data.added);
        // 只补 inWall 标记（右键「加入画廊」的置灰依据），行集不变
        setItems((prev) => prev.map((it) => (menuIds.includes(it.id) ? { ...it, inWall: true } : it)));
        refreshWallCount();
    }
    async function wallRemoveMenu() {
        if (menuIds.length === 0) return;
        const r = await api.galleryWallRemove(menuIds);
        if (!r.ok) {
            toast.error(t("toast.error"));
            return;
        }
        toast.success(fmt(t("gallery.wall.removed"), { n: menuIds.length }));
        // 画廊视图内就地过滤（同查看器删除的本地补丁先例）：行消失、滚动不跳
        const removed = new Set(menuIds);
        setItems((prev) => prev.filter((it) => !removed.has(it.id)));
        setTotal((v) => Math.max(0, v - removed.size));
        setSelectedIds((prev) => new Set([...prev].filter((id) => !removed.has(id))));
        refreshWallCount();
    }
    async function wallAddGroup(group: GalleryGroup) {
        const r = await api.galleryWallAddGroup(group.id);
        if (!r.ok) {
            toast.error(t("toast.error"));
            return;
        }
        wallToast(r.data.added);
        // 可见行里属于该组的补上 inWall；组内其余行不在当前视图，无需动
        setItems((prev) => prev.map((it) => (it.groupId === group.id ? { ...it, inWall: true } : it)));
        refreshWallCount();
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
          : confirmTarget.kind === "group"
            ? t("gallery.delGroupTitle")
            : t("gallery.tag.delTitle");
    const confirmDesc = !confirmTarget
        ? ""
        : confirmTarget.kind === "images"
          ? fmt(t("gallery.delImagesDesc"), { n: confirmTarget.ids.length })
          : confirmTarget.kind === "group"
            ? fmt(t("gallery.delGroupDesc"), {
                  name: confirmTarget.group.inbox ? t("gallery.inbox") : confirmTarget.group.name,
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
                wallCount={wallCount}
                active={query.group}
                onTogglePrivate={togglePrivate}
                onWallAddGroup={(g) => void wallAddGroup(g)}
                pwSet={pwSet}
                locked={unlocked == null}
                onLockClick={() => (unlocked == null ? setPwTarget({ mode: "unlock" }) : lockLibrary())}
                allTags={allTags}
                activeTags={query.tags}
                onToggleTag={toggleTagFilter}
                onTagDelete={(tag) => setConfirmTarget({ kind: "tag", tag })}
                onSelect={(g) => setQuery((q) => ({ ...q, group: g }))}
                onCreate={createGroup}
                onRename={renameGroup}
                onDelete={askDeleteGroup}
                onDropFiles={(paths, gid) => void runImport(paths, gid)}
                onUrlImport={openUrlImport}
            />

            <section className="flex min-w-0 flex-1 flex-col">
                {/* 工具条 */}
                <div className="flex flex-none flex-wrap items-center gap-1.5 px-2 py-1.5">
                    <Button type="button" size="xs" variant="outline" onClick={() => void importFiles()}>
                        <ImagePlus />
                        {t("gallery.import")}
                    </Button>
                    {/* 选择模式用开关而非按钮：状态一目了然，也免去「选择/退出选择」两态文案切换 */}
                    <span className="flex items-center gap-1.5">
                        <Switch
                            id="gallery-select-mode"
                            checked={selectMode}
                            onCheckedChange={(v) => (v ? setSelectMode(true) : exitSelectMode())}
                        />
                        <label htmlFor="gallery-select-mode" className="cursor-pointer text-[12px] text-dim">
                            {t("gallery.select.mode")}
                        </label>
                    </span>
                    <input
                        value={searchInput}
                        onChange={(e) => setSearchInput(e.target.value)}
                        spellCheck={false}
                        placeholder={t("gallery.searchPlaceholder")}
                        className="h-6 w-44 flex-none border border-line bg-bg px-2 text-[12px] text-text outline-none placeholder:text-muted focus:border-dim"
                    />
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
                    {/* 画廊视图专属：放映（空画廊置灰；放映层自取画廊快照，不受当前搜索/排序影响） */}
                    {query.group === "wall" && (
                        <Button
                            type="button"
                            size="xs"
                            variant="outline"
                            disabled={wallCount === 0}
                            onClick={() => setSlideshow(true)}
                        >
                            <Play />
                            {t("gallery.wall.play")}
                        </Button>
                    )}
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
                    wallView={query.group === "wall"}
                    onWall={() => (query.group === "wall" ? void wallRemoveMenu() : void wallAddMenu())}
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
                    // 画廊视图打开的查看器不带删除（策展面禁删，与网格右键菜单同规）
                    onDelete={
                        query.group === "wall"
                            ? undefined
                            : (img) => setConfirmTarget({ kind: "images", ids: [img.id], fromViewer: true })
                    }
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

            {urlImport && <UrlImport onClose={() => setUrlImport(false)} onImported={refreshAll} />}

            {slideshow && <Slideshow password={unlocked ?? undefined} onClose={() => setSlideshow(false)} />}

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
