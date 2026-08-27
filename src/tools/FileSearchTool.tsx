import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api, type FileHit } from "@/api/client";
import { useI18n } from "@/i18n/useI18n";
import type { MessageKey } from "@/i18n/zh";
import { useToolInput } from "./toolInput";

// 文件搜索：查询经主进程 es.exe 交给正在运行的 Everything（仅 Windows）。
// 竞态约定：每次请求带序号，晚归的旧结果直接丢弃，快速输入不闪结果。
// 查询词与过滤状态都是运行时状态：关闭工具即丢弃，下次从空开始（用户决策，勿加还原）。

const LIMIT = 200;
const DEBOUNCE_MS = 300;

// 常用后缀快捷过滤（多选 → ext:a;b）：集合固定，分组只为了让 chips 可扫读
const EXT_GROUPS: { key: MessageKey; exts: string[] }[] = [
    { key: "files.extGroup.doc", exts: ["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "md"] },
    { key: "files.extGroup.img", exts: ["png", "jpg", "jpeg", "gif", "webp", "svg", "ico"] },
    { key: "files.extGroup.av", exts: ["mp4", "mkv", "mov", "mp3", "wav", "flac"] },
    { key: "files.extGroup.zip", exts: ["zip", "7z", "rar", "tar", "gz"] },
    { key: "files.extGroup.code", exts: ["ts", "js", "py", "go", "rs", "java", "c", "cpp", "html", "css", "json"] },
];

type Only = "all" | "file" | "folder";
type SortKey = "name" | "size" | "dm";

function fmtSize(n: number): string {
    if (n <= 0) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let v = n;
    let i = 0;
    while (v >= 1024 && i < units.length - 1) {
        v /= 1024;
        i++;
    }
    return `${i === 0 || v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

/** ISO 原串 2026-08-26T17:50:37 → 展示 2026-08-26 17:50（去秒即可，不涉及时区换算） */
function fmtMtime(s: string): string {
    return s ? s.slice(0, 16).replace("T", " ") : "";
}

/** 行内灰色小字显示的目录部分（去掉名字本身；保留末级分隔符） */
function dirOf(h: FileHit): string {
    // 文件夹的 path 以 \ 结尾而 name 不含它，先去掉尾随 \ 再按 name 截，否则会多留一个字母
    const p = h.isDir && h.path.endsWith("\\") ? h.path.slice(0, -1) : h.path;
    return p.slice(0, p.length - h.name.length);
}

export default function FileSearchTool({ initialInput }: { initialInput?: string | null }) {
    const { t } = useI18n();
    const [query, setQuery] = useToolInput("files", initialInput);
    const [only, setOnly] = useState<Only>("all");
    const [exts, setExts] = useState<string[]>([]);
    const [sortKey, setSortKey] = useState<SortKey>("dm");
    const [ascending, setAscending] = useState(false);
    const [hits, setHits] = useState<FileHit[]>([]);
    // idle=还没搜过；loading；done；error=Everything 不可用；winOnly=平台不符
    const [status, setStatus] = useState<"idle" | "loading" | "done" | "error" | "winOnly">("idle");
    const [selected, setSelected] = useState(0);
    const [retryTick, setRetryTick] = useState(0);
    const seq = useRef(0);
    const listRef = useRef<HTMLDivElement>(null);

    // 平台守卫：非 Windows 直接展示提示页（不再发查询）
    useEffect(() => {
        void api.session().then((r) => {
            if (r.ok && r.data.platform !== "win32") setStatus("winOnly");
        });
    }, []);

    // 搜索主链路：空词回空态；非空防抖后查询，序号对不上的晚归结果丢弃
    const extKey = exts.join(","); // 数组引用每次渲染都变，压成字符串做稳定依赖
    useEffect(() => {
        const q = query.trim();
        if (q === "") {
            seq.current++;
            setHits([]);
            setStatus("idle");
            return;
        }
        setStatus("loading");
        const timer = setTimeout(() => {
            const my = ++seq.current;
            void api
                .fileSearch({
                    query: q,
                    only,
                    // ext: 只对文件有意义；仅文件夹时不下发后缀
                    exts: only === "folder" ? [] : exts,
                    sort: sortKey,
                    ascending,
                    limit: LIMIT,
                })
                .then((r) => {
                    if (my !== seq.current) return;
                    if (r.ok) {
                        setHits(r.data.hits);
                        setSelected(0);
                        setStatus("done");
                    } else if (r.error.kind === "everything") {
                        setStatus("error");
                    } else {
                        setHits([]);
                        setStatus("done");
                        toast.error(t("toast.error"));
                    }
                });
        }, DEBOUNCE_MS);
        return () => clearTimeout(timer);
    }, [query, only, extKey, exts, sortKey, ascending, retryTick, t]);

    // 键盘选中行滚进可视区（block:nearest 只在出界时滚动）
    useEffect(() => {
        listRef.current?.querySelector(`[data-idx="${selected}"]`)?.scrollIntoView({ block: "nearest" });
    }, [selected]);

    function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
        if (hits.length === 0) return;
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            const delta = e.key === "ArrowDown" ? 1 : -1;
            setSelected((s) => (s + delta + hits.length) % hits.length);
        } else if (e.key === "Enter") {
            void openHit(hits[Math.min(selected, hits.length - 1)]);
        }
    }

    function errToast(kind: string) {
        toast.error(kind === "missing" ? t("launch.missing") : t("toast.error"));
    }

    async function openHit(h: FileHit) {
        const r = await api.openPath(h.path);
        if (!r.ok) errToast(r.error.kind);
    }

    async function revealHit(h: FileHit) {
        const r = await api.revealPath(h.path);
        if (!r.ok) errToast(r.error.kind);
    }

    async function copyPath(h: FileHit) {
        try {
            await navigator.clipboard.writeText(h.path);
            toast.success(t("json.copied"));
        } catch {
            toast.error(t("toast.error"));
        }
    }

    function toggleExt(e: string) {
        setExts((prev) => (prev.includes(e) ? prev.filter((x) => x !== e) : [...prev, e]));
    }

    const btn = "tbtn border border-line px-2.5 py-1 text-[12px] hover:bg-faint";
    // 选中态反色用全局 .seg-on（index.css）：tbtn 是无 layer 的普通类，级联压过
    // Tailwind utilities，直接写 bg-text text-bg 会被 .tbtn 的颜色声明盖掉
    const seg = (active: boolean) =>
        `tbtn border px-2.5 py-1 text-[12px] ${active ? "seg-on" : "border-line hover:bg-faint"}`;
    const chip = (on: boolean) =>
        `border px-1.5 py-0.5 font-mono text-[11px] ${on ? "seg-on" : "border-line text-dim hover:bg-faint"}`;
    const arrow = (key: SortKey) => (sortKey === key ? (ascending ? " ↑" : " ↓") : "");

    return (
        <div className="flex h-full flex-col gap-2 p-3">
            <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKeyDown}
                spellCheck={false}
                placeholder={t("files.placeholder")}
                className="flex-none border border-line bg-bg px-2.5 py-1.5 font-mono text-[12.5px] text-text outline-none placeholder:text-muted"
            />

            <div className="flex flex-none flex-wrap items-center gap-1.5">
                {(["all", "file", "folder"] as const).map((o) => (
                    <button key={o} type="button" className={seg(only === o)} onClick={() => setOnly(o)}>
                        [ {t(`files.filter.${o}`)} ]
                    </button>
                ))}
                <span className="mx-1 text-line">│</span>
                {(["name", "size", "dm"] as const).map((k) => (
                    <button
                        key={k}
                        type="button"
                        className={seg(sortKey === k)}
                        onClick={() => {
                            if (sortKey === k)
                                setAscending((v) => !v); // 点同一个 = 切升降序
                            else {
                                setSortKey(k);
                                setAscending(k === "name"); // 名称默认升序，其余默认新的/大的在前
                            }
                        }}
                    >
                        [ {t(`files.sort.${k}`)}
                        {arrow(k)} ]
                    </button>
                ))}
            </div>

            <div
                className={`flex flex-none flex-wrap items-center gap-x-3 gap-y-1 ${
                    only === "folder" ? "pointer-events-none opacity-40" : ""
                }`}
            >
                {EXT_GROUPS.map((g) => (
                    <span key={g.key} className="flex items-center gap-1">
                        <span className="text-[11px] text-muted">{t(g.key)}</span>
                        {g.exts.map((e) => (
                            <button
                                key={e}
                                type="button"
                                className={chip(exts.includes(e))}
                                onClick={() => toggleExt(e)}
                            >
                                {e}
                            </button>
                        ))}
                    </span>
                ))}
            </div>

            <div ref={listRef} className="flex min-h-0 flex-1 flex-col gap-1 overflow-auto">
                {status === "winOnly" && <Center text={t("files.winOnly")} />}

                {status === "error" && (
                    <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
                        <span className="text-[13px] text-text">{t("files.everything.title")}</span>
                        <span className="max-w-md text-[12px] leading-relaxed text-dim">
                            {t("files.everything.hint")}
                        </span>
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                className={btn}
                                onClick={() => window.open("https://www.voidtools.com/", "_blank", "noreferrer")}
                            >
                                [ {t("files.everything.site")} ]
                            </button>
                            <button type="button" className={btn} onClick={() => setRetryTick((v) => v + 1)}>
                                [ {t("files.everything.retry")} ]
                            </button>
                        </div>
                    </div>
                )}

                {status === "idle" && (
                    <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
                        <span className="text-[12.5px] text-dim">{t("files.hint")}</span>
                        <span className="font-mono text-[11.5px] text-muted">{t("files.hintEx")}</span>
                    </div>
                )}

                {status === "loading" && <Center text={t("files.searching")} />}

                {status === "done" && hits.length === 0 && <Center text={t("files.none")} />}

                {status === "done" &&
                    hits.map((h, i) => (
                        <div
                            key={`${i}-${h.path}`}
                            data-idx={i}
                            onClick={() => setSelected(i)}
                            onDoubleClick={() => void openHit(h)}
                            title={h.path}
                            className={`flex flex-none cursor-default items-center gap-2.5 border px-2.5 py-1.5 ${
                                selected === i ? "border-text bg-faint" : "border-line bg-bg"
                            }`}
                        >
                            {h.isDir && (
                                <span className="flex-none border border-line px-1.5 py-0.5 text-[10.5px] text-muted">
                                    DIR
                                </span>
                            )}
                            <span className="min-w-0 max-w-[45%] flex-none truncate font-mono text-[12.5px] text-text">
                                {h.name}
                            </span>
                            {/* 目录从头截断（rtl + plaintext 让省略号落在左侧）：保住最末几级
                                父目录——找文件时「在哪个文件夹」比盘符开头有价值 */}
                            <span className="min-w-0 flex-1 truncate text-left text-[11px] text-dim [direction:rtl] [unicode-bidi:plaintext]">
                                {dirOf(h)}
                            </span>
                            <span className="flex-none text-[11px] tabular-nums text-muted">{fmtSize(h.size)}</span>
                            <span className="flex-none text-[11px] tabular-nums text-muted">{fmtMtime(h.mtime)}</span>
                            <button type="button" className={btn} onClick={() => void openHit(h)}>
                                [ {t("files.open")} ]
                            </button>
                            <button type="button" className={btn} onClick={() => void revealHit(h)}>
                                [ {t("files.reveal")} ]
                            </button>
                            <button type="button" className={btn} onClick={() => void copyPath(h)}>
                                [ {t("files.copy")} ]
                            </button>
                        </div>
                    ))}

                {status === "done" && hits.length > 0 && (
                    <div className="flex-none px-1 pt-1 text-[11px] text-muted">
                        {hits.length} {t("files.count")}
                        {hits.length === LIMIT ? ` · ${t("files.truncated")}` : ""}
                    </div>
                )}
            </div>
        </div>
    );
}

function Center({ text }: { text: string }) {
    return <div className="px-6 py-10 text-center text-[12.5px] text-dim">{text}</div>;
}
