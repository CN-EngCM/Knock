import { useMemo, useRef, useState } from "react";
import { Check } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api, type GalleryCandidate } from "@/api/client";
import { useI18n } from "@/i18n/useI18n";
import type { MessageKey } from "@/i18n/zh";
import { fmt, fmtBytes } from "./util";

// 从网址导入：翻页收集候选 URL → 统一分批下载探尺寸 → 候选网格（尺寸过滤+勾选）→ 入库。
// 翻页/下载循环由渲染端驱动——进度就是 state，取消就是停止循环，不需要事件通道；
// 导入集 = 勾选 ∩ 过滤后可见：过滤是主要取舍手段，滤掉即不导入。
// 确认导入时自动单独成组（域名命名、同名复用），不落当前视图的分组。
// 参数（含尺寸/体积过滤值）记忆在 localStorage（TOOL_SPEC §5：只有界面记得住的进 localStorage）。

const LS_KEY = "mypage-gallery-url-import";
const DOWNLOAD_BATCH = 10; // 下载批次 = 进度条粒度
const IMPORT_BATCH = 16; // 入库批次：与文件导入一致（主进程同步落盘，控制单次阻塞时长）

type Params = {
    pages: string;
    maxCandidates: string;
    maxBytesMb: string;
    concurrency: string;
    timeoutSec: string;
    minW: string; // 字符串态直存输入框（空 = 不限），使用处再解析
    minH: string;
    minKb: string;
    minDw: string; // 最小显示宽/高：按图片在页面上的 CSS 布局尺寸过滤（缩略图排除）
    minDh: string;
};

const DEFAULT_PARAMS: Params = {
    pages: "10",
    maxCandidates: "200",
    maxBytesMb: "50",
    concurrency: "4",
    timeoutSec: "15",
    minW: "",
    minH: "",
    minKb: "",
    minDw: "",
    minDh: "",
};

/** 老数据缺字段/非法值回落默认（TOOL_SPEC：localStorage 读写都 try/catch） */
function loadParams(): Params {
    try {
        const raw = JSON.parse(localStorage.getItem(LS_KEY) ?? "") as Partial<Record<keyof Params, unknown>>;
        const n = { ...DEFAULT_PARAMS };
        for (const k of Object.keys(DEFAULT_PARAMS) as (keyof Params)[]) {
            if (typeof raw[k] === "string" && (raw[k] as string).length > 0) n[k] = raw[k] as string;
        }
        return n;
    } catch {
        return { ...DEFAULT_PARAMS };
    }
}

/** 正整数解析：非法/非正回落给定的默认值 */
function num(v: string, fallback: number): number {
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
}

type Phase = "form" | "collecting" | "grid" | "importing";
type Progress = { stage: "page"; page: number; found: number } | { stage: "download"; done: number; total: number };

const inputCls =
    "h-6 border border-line bg-bg px-2 text-[12px] text-text outline-none placeholder:text-muted focus:border-dim";

// 表单里的参数字段（label 的 i18n 键）；min* 同时是网格阶段的实时过滤控件，同一份 state
const FIELDS: readonly { key: keyof Params; label: MessageKey }[] = [
    { key: "pages", label: "gallery.url.pages" },
    { key: "maxCandidates", label: "gallery.url.maxCandidates" },
    { key: "maxBytesMb", label: "gallery.url.maxBytesMb" },
    { key: "concurrency", label: "gallery.url.concurrency" },
    { key: "timeoutSec", label: "gallery.url.timeoutSec" },
    { key: "minW", label: "gallery.url.minW" },
    { key: "minH", label: "gallery.url.minH" },
    { key: "minKb", label: "gallery.url.minKb" },
    { key: "minDw", label: "gallery.url.minDw" },
    { key: "minDh", label: "gallery.url.minDh" },
];

// 网格工具条只摆过滤字段（体积下限滤小文件，显示下限滤页面上的缩略图元素）
const FILTERS: readonly { key: keyof Params; label: MessageKey }[] = [
    { key: "minW", label: "gallery.url.minW" },
    { key: "minH", label: "gallery.url.minH" },
    { key: "minKb", label: "gallery.url.minKb" },
    { key: "minDw", label: "gallery.url.minDw" },
    { key: "minDh", label: "gallery.url.minDh" },
];

/** 候选缩略图：mpimg://cand/<n>（主进程暂存目录按需生成），挂了显示兜底块 */
function CandThumb({ index }: { index: number }) {
    const [failed, setFailed] = useState(false);
    if (failed) {
        return <div className="h-full w-full bg-faint" />;
    }
    return (
        <img
            src={`mpimg://cand/${index}`}
            alt=""
            loading="lazy"
            decoding="async"
            draggable={false}
            onError={() => setFailed(true)}
            className="h-full w-full object-cover"
        />
    );
}

type Props = {
    onClose: () => void;
    onImported: () => void;
};

export function UrlImport({ onClose, onImported }: Props) {
    const { t } = useI18n();
    const [phase, setPhase] = useState<Phase>("form");
    const [url, setUrl] = useState("");
    const [params, setParams] = useState<Params>(loadParams);
    const [progress, setProgress] = useState<Progress | null>(null);
    const [candidates, setCandidates] = useState<GalleryCandidate[]>([]);
    const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
    const [importing, setImporting] = useState<{ done: number; total: number } | null>(null);
    const cancelRef = useRef(false);
    const importBusy = useRef(false);
    // 首页 <title>（服务端已清洗截断）：导入单独成组时的组名首选；仅导入用，不参与渲染
    const titleRef = useRef<string | null>(null);

    const minW = parseInt(params.minW, 10) || 0;
    const minH = parseInt(params.minH, 10) || 0;
    const minBytes = (parseInt(params.minKb, 10) || 0) * 1024;
    const minDw = parseInt(params.minDw, 10) || 0;
    const minDh = parseInt(params.minDh, 10) || 0;
    const filterOn = minW > 0 || minH > 0 || minBytes > 0 || minDw > 0 || minDh > 0;

    // 固定尺寸（面积）降序，失败与解不出尺寸的（svg 等）垫底
    const sorted = useMemo(() => {
        const area = (c: GalleryCandidate) => (c.ok ? c.width * c.height : -1);
        return [...candidates].sort((a, b) => area(b) - area(a));
    }, [candidates]);

    // 过滤（AND 语义，留空不限）：宽/高/体积按文件本身，显示宽/高按页面布局尺寸——
    // 探不到显示尺寸的（懒加载占位、渲染失败）与失败项一样视为不达标
    const visible = sorted.filter(
        (c) =>
            !filterOn ||
            (c.ok &&
                c.width >= minW &&
                c.height >= minH &&
                c.bytes >= minBytes &&
                c.displayW >= minDw &&
                c.displayH >= minDh),
    );

    // 导入集 = 勾选 ∩ 过滤后可见：过滤是主要取舍手段，滤掉即不导入
    // （默认全选的工作流下，早前「勾选与过滤解耦」会让滤掉的照常入库，按实际用法修正）
    const importIndices: number[] = [];
    for (const c of visible) if (c.ok && selected.has(c.index)) importIndices.push(c.index);

    function setParam(k: keyof Params, v: string) {
        setParams((p) => ({ ...p, [k]: v }));
    }

    /** 关闭（Esc/遮罩/X 同路）：停掉还在跑的循环；入库中除外——清场由入库循环自己收尾 */
    function requestClose() {
        cancelRef.current = true;
        if (phase !== "importing") void api.galleryCollectDiscard();
        onClose();
    }

    async function startCollect() {
        const u = url.trim();
        const pages = num(params.pages, 10);
        const maxCandidates = num(params.maxCandidates, 200);
        try {
            localStorage.setItem(LS_KEY, JSON.stringify(params));
        } catch {
            /* 存不进就算了，下次回落默认 */
        }
        const r0 = await api.galleryCollectStart();
        if (!r0.ok) {
            toast.error(t("toast.error"));
            return;
        }
        cancelRef.current = false;
        titleRef.current = null;
        setPhase("collecting");
        // 翻页收集：同 host 与循环防护（已抓页判定到底）主进程已保证，这里只管页数/数量上限与 URL 去重
        const seen = new Set<string>();
        const visited = new Set<string>();
        const found: string[] = [];
        const renders: Promise<unknown>[] = []; // 各页显示尺寸渲染（主进程并入会话，失败静默降级）
        let next: string | null = u;
        let pagesDone = 0;
        let isImage = false;
        while (next && !cancelRef.current && pagesDone < pages && found.length < maxCandidates) {
            const r = await api.galleryFetchPage(next);
            if (!r.ok) {
                toast.error(t("gallery.url.toast.fetchFailed"));
                setPhase("form");
                void api.galleryCollectDiscard();
                return;
            }
            visited.add(next);
            if (!titleRef.current && r.data.title) titleRef.current = r.data.title; // 组名用首页标题
            if (r.data.isImage) {
                isImage = true; // 直链：单张候选，无翻页语义
                found.push(...r.data.imageUrls);
                break;
            }
            // 显示尺寸靠隐藏窗口渲染（比抓页慢得多），与后续翻页并行跑，下载前统一收口
            renders.push(api.galleryPageDisplaySizes(next).catch(() => undefined));
            for (const img of r.data.imageUrls) {
                if (seen.has(img)) continue;
                seen.add(img);
                found.push(img);
            }
            pagesDone++;
            setProgress({ stage: "page", page: pagesDone, found: found.length });
            let target = r.data.nextUrl;
            if (target && visited.has(target)) target = null; // 「下一页」指回已抓页 = 到底
            next = target;
        }
        // 统一下载（截断在收集阶段已生效）：防盗链来源 = 会话首页，直链场景不带；
        // 先等显示尺寸渲染收口——候选的 displayW/H 在下载时从会话表带出
        await Promise.all(renders);
        const urls = found.slice(0, maxCandidates);
        const items: GalleryCandidate[] = [];
        for (let i = 0; i < urls.length; i += DOWNLOAD_BATCH) {
            if (cancelRef.current) break;
            const r = await api.galleryDownloadCandidates({
                referer: isImage ? "" : u,
                urls: urls.slice(i, i + DOWNLOAD_BATCH),
                maxBytes: num(params.maxBytesMb, 50) * 1024 * 1024,
                concurrency: num(params.concurrency, 4),
                timeoutMs: num(params.timeoutSec, 15) * 1000,
            });
            if (!r.ok) {
                toast.error(t("toast.error"));
                break; // 批次失败中止，已下到的照常呈现
            }
            items.push(...r.data.items);
            setProgress({ stage: "download", done: Math.min(i + DOWNLOAD_BATCH, urls.length), total: urls.length });
        }
        if (cancelRef.current) {
            setPhase("form"); // 取消回表单
            void api.galleryCollectDiscard();
            return;
        }
        if (items.length === 0) {
            toast(t("gallery.url.toast.none"));
            setPhase("form");
            void api.galleryCollectDiscard();
            return;
        }
        setCandidates(items);
        // 默认全选可入库的：已在库与失败项默认不勾（收不进/没内容）
        const idx: number[] = [];
        for (const c of items) if (c.ok && !c.inLibrary) idx.push(c.index);
        setSelected(new Set(idx));
        setProgress(null);
        setPhase("grid");
    }

    function toggle(c: GalleryCandidate) {
        if (!c.ok || c.inLibrary) return;
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(c.index)) next.delete(c.index);
            else next.add(c.index);
            return next;
        });
    }

    /** 确认导入时解析落点分组：单独成组——组名首选网页 <title>，后备站点域名（去 www.），
     *  均限长 50 对齐 schema；已有同名组则复用（同站多次导入归拢一组，配合 sha 去重不收重图）；
     *  解析失败返回 null */
    async function resolveGroupId(): Promise<number | null> {
        let name = titleRef.current ?? "";
        if (!name) {
            try {
                name = new URL(url.trim()).hostname.replace(/^www\./, "");
            } catch {
                /* 表单已校验 http(s)，走兜底名 */
            }
        }
        name = name.slice(0, 50) || t("gallery.urlImport");
        const gs = await api.galleryGroups();
        const existing = gs.ok ? gs.data.find((g) => !g.inbox && g.name === name) : undefined;
        if (existing) return existing.id;
        const r = await api.galleryCreateGroup(name);
        return r.ok ? r.data.id : null; // 建组失败（超长等）由调用方报错
    }

    async function importSelected() {
        const indices = importIndices;
        if (indices.length === 0 || importBusy.current) return;
        const gid = await resolveGroupId();
        if (gid == null) {
            toast.error(t("toast.error"));
            return;
        }
        importBusy.current = true;
        cancelRef.current = false;
        let imported = 0;
        let skipped = 0;
        let ok = true;
        setImporting({ done: 0, total: indices.length });
        for (let i = 0; i < indices.length; i += IMPORT_BATCH) {
            if (cancelRef.current) break; // 取消：已导入的保留
            const r = await api.galleryImportCandidates({ indices: indices.slice(i, i + IMPORT_BATCH), groupId: gid });
            if (!r.ok) {
                ok = false;
                toast.error(t("toast.error"));
                break;
            }
            imported += r.data.imported;
            skipped += r.data.skipped;
            setImporting({ done: Math.min(i + IMPORT_BATCH, indices.length), total: indices.length });
        }
        setImporting(null);
        importBusy.current = false;
        void api.galleryCollectDiscard(); // 会话收场：清暂存（取消/失败也清，重开重新抓）
        if (ok && imported + skipped > 0) {
            toast.success(
                fmt(t("gallery.toast.imported"), { n: imported }) +
                    (skipped > 0 ? fmt(t("gallery.toast.skipped"), { n: skipped }) : ""),
            );
        }
        onImported();
        onClose();
    }

    const canStart = /^https?:\/\//i.test(url.trim());

    return (
        <Dialog open onOpenChange={(o) => !o && requestClose()}>
            <DialogContent className="flex h-[82vh] max-h-[88vh] flex-col gap-3 sm:max-w-[1080px]">
                <DialogHeader>
                    <DialogTitle>{t("gallery.url.title")}</DialogTitle>
                </DialogHeader>

                {phase === "form" && (
                    <div className="flex flex-col gap-4 px-1">
                        <label className="flex items-center gap-2 text-[12px] text-dim">
                            <span className="w-10 flex-none text-right">{t("gallery.url.url")}</span>
                            <input
                                value={url}
                                onChange={(e) => setUrl(e.target.value)}
                                spellCheck={false}
                                placeholder="https://…"
                                autoFocus
                                className={`${inputCls} h-7 flex-1`}
                            />
                        </label>
                        <div className="flex flex-wrap gap-x-5 gap-y-2">
                            {FIELDS.map((f) => (
                                <label key={f.key} className="flex items-center gap-1.5 text-[11.5px] text-muted">
                                    <span>{t(f.label)}</span>
                                    <input
                                        value={params[f.key]}
                                        onChange={(e) => setParam(f.key, e.target.value)}
                                        inputMode="numeric"
                                        className={`${inputCls} w-16`}
                                    />
                                </label>
                            ))}
                        </div>
                    </div>
                )}

                {phase === "collecting" && (
                    <div className="flex flex-1 flex-col items-center justify-center gap-4">
                        <span className="text-[13px] text-dim">
                            {progress?.stage === "page"
                                ? fmt(t("gallery.url.fetchingPage"), { n: progress.page }) +
                                  fmt(t("gallery.url.found"), { m: progress.found })
                                : progress?.stage === "download"
                                  ? fmt(t("gallery.url.downloading"), { done: progress.done, total: progress.total })
                                  : "…"}
                        </span>
                        {progress?.stage === "download" && (
                            <div className="h-0.5 w-64 bg-line">
                                <div
                                    className="h-full bg-text"
                                    style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }}
                                />
                            </div>
                        )}
                        <Button type="button" variant="outline" size="xs" onClick={() => (cancelRef.current = true)}>
                            {t("gallery.cancelImport")}
                        </Button>
                    </div>
                )}

                {phase === "grid" && (
                    <>
                        <div className="flex flex-none flex-wrap items-center gap-3 px-1 text-[11.5px] text-muted">
                            {FILTERS.map((f) => (
                                <label key={f.key} className="flex items-center gap-1">
                                    <span>{t(f.label)}</span>
                                    <input
                                        value={params[f.key]}
                                        onChange={(e) => setParam(f.key, e.target.value)}
                                        inputMode="numeric"
                                        className={`${inputCls} w-16`}
                                    />
                                </label>
                            ))}
                            <span className="text-dim">
                                {fmt(t("gallery.url.matchCount"), { n: visible.length, m: sorted.length })}
                            </span>
                            <span>{fmt(t("gallery.url.selected"), { n: importIndices.length })}</span>
                        </div>
                        <div className="min-h-0 flex-1 overflow-auto p-1">
                            <div
                                className="grid gap-2"
                                style={{ gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))" }}
                            >
                                {visible.map((c) => {
                                    const checked = c.ok && selected.has(c.index);
                                    const clickable = c.ok && !c.inLibrary;
                                    return (
                                        <div
                                            key={c.ok ? c.index : c.url}
                                            title={c.url}
                                            onClick={() => toggle(c)}
                                            className={`relative aspect-square overflow-hidden rounded border ${
                                                checked
                                                    ? "border-text ring-1 ring-text"
                                                    : "border-line hover:border-dim"
                                            } ${clickable ? "cursor-pointer" : "cursor-default"}`}
                                            style={{ contentVisibility: "auto", containIntrinsicSize: "auto 132px" }}
                                        >
                                            {c.ok ? (
                                                <CandThumb index={c.index} />
                                            ) : (
                                                <div className="flex h-full w-full items-center justify-center bg-faint px-1 text-center text-[10.5px] text-muted">
                                                    {t("gallery.url.failed")}
                                                </div>
                                            )}
                                            {c.ok && (
                                                <div className="absolute inset-x-0 bottom-0 bg-black/45 px-1 py-0.5 text-[10px] leading-tight text-white/90">
                                                    <div className="truncate">
                                                        {c.width > 0 ? `${c.width}×${c.height}` : "—"} ·{" "}
                                                        {fmtBytes(c.bytes)}
                                                    </div>
                                                    {/* 显示尺寸与文件尺寸不一致时另起一行标注（CSS 缩小的缩略图场景），
                                                        拼一行会被截断看不见 */}
                                                    {c.displayW > 0 &&
                                                        (c.displayW !== c.width || c.displayH !== c.height) && (
                                                            <div className="truncate">
                                                                {t("gallery.url.display")} {c.displayW}×{c.displayH}
                                                            </div>
                                                        )}
                                                </div>
                                            )}
                                            {c.ok && c.inLibrary && (
                                                <span className="absolute right-1 top-1 rounded-[3px] bg-dim px-1 text-[10px] text-bg">
                                                    {t("gallery.url.inLibrary")}
                                                </span>
                                            )}
                                            {clickable && (
                                                <span
                                                    className={`absolute left-1 top-1 flex size-4 items-center justify-center rounded-[3px] border ${
                                                        checked
                                                            ? "border-text bg-text text-bg"
                                                            : "border-white/70 bg-black/30"
                                                    }`}
                                                >
                                                    {checked && <Check size={11} strokeWidth={3.5} />}
                                                </span>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </>
                )}

                {phase === "importing" && (
                    <div className="flex flex-1 flex-col items-center justify-center gap-4">
                        <span className="text-[13px] text-dim">
                            {importing
                                ? fmt(t("gallery.importing"), { done: importing.done, total: importing.total })
                                : "…"}
                        </span>
                        <div className="h-0.5 w-64 bg-line">
                            <div
                                className="h-full bg-text"
                                style={{
                                    width: `${importing && importing.total ? (importing.done / importing.total) * 100 : 0}%`,
                                }}
                            />
                        </div>
                        <Button type="button" variant="outline" size="xs" onClick={() => (cancelRef.current = true)}>
                            {t("gallery.cancelImport")}
                        </Button>
                    </div>
                )}

                <div className="mt-auto flex flex-none items-center justify-end gap-2 pt-1">
                    {(phase === "form" || phase === "grid") && (
                        <Button type="button" variant="outline" size="sm" onClick={requestClose}>
                            {t("gallery.url.close")}
                        </Button>
                    )}
                    {phase === "form" && (
                        <Button type="button" size="sm" disabled={!canStart} onClick={() => void startCollect()}>
                            {t("gallery.url.start")}
                        </Button>
                    )}
                    {phase === "grid" && (
                        <Button
                            type="button"
                            size="sm"
                            disabled={importIndices.length === 0}
                            onClick={() => void importSelected()}
                        >
                            {fmt(t("gallery.url.import"), { n: importIndices.length })}
                        </Button>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}
