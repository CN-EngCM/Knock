import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { TOOLS, type ToolId } from "@/tools/registry";
import { api, type Expert, type Group, type Item, type ToolAliases } from "@/api/client";
import { KIND_TAG } from "@/lib/kindTag";
import { useExperts } from "@/lib/experts";
import { useI18n } from "@/i18n/useI18n";

// ── 顶栏搜索框（v2.3）：输入即出下拉候选 + 剪贴板素材流 ──
// 候选 = 匹配条目（标题/目标）+ 匹配的内置工具（名称/描述/id/别名）。
// 布局（用户决策）：推荐工具区恒在。纯手打时命中在上、推荐沉底——Enter 落
//   命中项（开条目是主用途），↓ 到底进推荐；素材 chip 在场时推荐置顶——
//   Enter 即注入，保住「复制 → 呼出 → Enter」的素材流契约。
// 注入契约：只要从推荐工具进入，一律注入「chip ?? 手打 query」，
//   没有旧的「无命中升格为素材」隐形规则。
// 键盘：↑↓ 移动高亮、Enter 打开/注入高亮项、Esc 先清 chip 再清 query。
// 本地路径直达：输入像绝对路径且真实存在时，命中区顶部多一组「── 路径 ──」
//   动作行（文件 = 打开文件 + 前往所在目录；文件夹 = 前往），纯手打时 Enter 直接落第一行。

const MAX_CANDIDATES = 9;
const CHIP_MAX_CHARS = 32;
const PATH_PROBE_DEBOUNCE_MS = 200;

type Candidate =
    | { kind: "item"; item: Item; groupName: string }
    | { kind: "tool"; id: ToolId; name: string; desc: string }
    /** 勾了「推荐到搜索栏」的 AI 专家：进推荐区一行 */
    | { kind: "expert"; expert: Expert }
    /** label 是动作名，target 是该动作真正要交给 onOpenPath 的完整路径 */
    | { kind: "path"; label: "open" | "goto"; target: string };

type Props = {
    groups: Group[];
    items: Item[];
    /** 工具别名（设置页维护）：别名命中也算工具候选 */
    toolAliases: ToolAliases;
    onOpenItem: (item: Item) => void;
    /** input 非 null 时 = 带素材打开工具（App 层负责注入通道）；expertId 仅 ai 工具（进入指定专家） */
    onOpenTool: (id: ToolId, input: string | null, expertId?: number) => void;
    /** 下拉路径动作的执行落点：组件只做形状判定与存在性探测，打开与失败反馈归 App 层 */
    onOpenPath: (path: string) => void;
};

/** 极轻内容嗅探：http(s) → qr 置顶（URL 可能也是合法 JSON 串，先判 URL）；JSON.parse 成功 → json 置顶 */
function sniffTop(src: string): ToolId | null {
    if (/^https?:\/\//i.test(src)) return "qr";
    try {
        JSON.parse(src);
        return "json";
    } catch {
        return null;
    }
}

/** 输入形如本地绝对路径（Windows 盘符 / UNC 开头）才值得发 IPC 探测；返回剥引号后的串。
 *  相对路径会落到 Electron 启动目录，语义无意义；资源管理器「复制文件地址」常带成对英文引号，先剥再判 */
function asLocalAbsolutePath(src: string): string | null {
    const s = /^".*"$/.test(src) ? src.slice(1, -1) : src;
    return /^[A-Za-z]:[\\/]|^\\\\/.test(s) ? s : null;
}

/** 文件输入的「前往文件夹」目标 = 所在目录（保留末尾分隔符）；形状判定已保证分隔符存在 */
function parentDir(p: string): string {
    return p.match(/^.*[\\/]/)?.[0] ?? p;
}

/** chip 单行展示：空白折叠 + 按码点截断 */
function chipLabel(text: string): string {
    const flat = text.replace(/\s+/g, " ").trim();
    const chars = [...flat];
    return chars.length > CHIP_MAX_CHARS ? chars.slice(0, CHIP_MAX_CHARS).join("") + "…" : flat;
}

export function SearchBox({ groups, items, toolAliases, onOpenItem, onOpenTool, onOpenPath }: Props) {
    const { t } = useI18n();
    const [query, setQuery] = useState("");
    const [clip, setClip] = useState<string | null>(null);
    const [focused, setFocused] = useState(false);
    const [hi, setHi] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);
    // 勾了推荐的专家列表（AiTool 与此处经共享 store 同步，专家增删改即时反映）
    const experts = useExperts();

    // 双击 Ctrl 呼出：清空搜索词、装上剪贴板素材（null = 超时/关闭）、聚焦输入框
    useEffect(() => {
        return window.knock.onFocusSearch((text) => {
            setQuery("");
            setClip(text);
            inputRef.current?.focus();
        });
    }, []);

    // 匹配源：素材 chip 优先（chip 在场时用完整剪贴板文本去匹配条目/工具）
    const q = (clip ?? query).trim().toLowerCase();

    const { matches } = useMemo(() => {
        const out: Candidate[] = [];
        if (q) {
            const gname = new Map(groups.map((g) => [g.id, g.name]));
            for (const item of items) {
                if (item.title.toLowerCase().includes(q) || item.target.toLowerCase().includes(q)) {
                    out.push({ kind: "item", item, groupName: gname.get(item.group_id) ?? "" });
                    if (out.length >= MAX_CANDIDATES) break;
                }
            }
            for (const tool of TOOLS) {
                if (out.length >= MAX_CANDIDATES) break;
                const name = t(tool.nameKey);
                const desc = t(tool.descKey);
                const aliases = (toolAliases[tool.id] ?? "").split(/[\s,，]+/).filter(Boolean);
                const hit =
                    name.toLowerCase().includes(q) ||
                    tool.id.includes(q) ||
                    desc.toLowerCase().includes(q) ||
                    aliases.some((a) => a.toLowerCase().includes(q));
                if (hit) out.push({ kind: "tool", id: tool.id, name, desc });
            }
        }
        return { matches: out };
    }, [q, groups, items, t, toolAliases]);

    // 命中区：条目 + 不吃素材的工具；能吃素材的工具恒住推荐区，不在命中区重复出现
    const hits = useMemo(
        () => matches.filter((m) => m.kind !== "tool" || !TOOLS.find((x) => x.id === m.id)?.acceptsText),
        [matches],
    );

    // 推荐工具：能吃文本素材的工具，按嗅探结果置顶
    const recTools = useMemo(() => {
        const list = TOOLS.filter((x) => x.acceptsText);
        const top = sniffTop((clip ?? query).trim());
        return top ? [...list].sort((a, b) => (a.id === top ? -1 : b.id === top ? 1 : 0)) : list;
    }, [clip, query]);

    // 布局：chip 在场推荐置顶（Enter 即注入）；纯手打推荐沉底（Enter 开命中项）
    const recOnTop = clip !== null;

    // ── 本地路径直达：输入像绝对路径才探测；防抖把连续击键压成一次 IPC stat ──
    // 竞态用 alive 标记丢弃晚归结果——快速输入时旧路径的「存在」不能污染新输入
    const [pathHit, setPathHit] = useState<{ path: string; isDir: boolean } | null>(null);
    useEffect(() => {
        const p = asLocalAbsolutePath((clip ?? query).trim());
        if (!p) {
            setPathHit(null);
            return;
        }
        let alive = true;
        const timer = setTimeout(() => {
            void api.statPath(p).then((r) => {
                if (!alive) return;
                setPathHit(r.ok ? { path: p, isDir: r.data.isDir } : null);
            });
        }, PATH_PROBE_DEBOUNCE_MS);
        return () => {
            alive = false;
            clearTimeout(timer);
        };
    }, [query, clip]);

    // 路径直达动作行：文件夹只有前往；文件打开放前——纯手打时 Enter 默认就是打开文件
    const pathRows: Candidate[] = !pathHit
        ? []
        : pathHit.isDir
          ? [{ kind: "path", label: "goto", target: pathHit.path }]
          : [
                { kind: "path", label: "open", target: pathHit.path },
                { kind: "path", label: "goto", target: parentDir(pathHit.path) },
            ];

    const { candidates, pathStart, recStart } = useMemo(() => {
        const rec: Candidate[] = recTools.map((tool) => ({
            kind: "tool",
            id: tool.id,
            name: t(tool.nameKey),
            desc: t(tool.descKey),
        }));
        // 勾了推荐的专家排在工具行之后、同一推荐区里（下标数学不用动）
        for (const expert of experts.filter((e) => e.recommend)) {
            rec.push({ kind: "expert", expert });
        }
        // 分组标签插入点：chip 在场推荐置顶；纯手打 = 路径区+命中区在上、推荐沉底
        return {
            candidates: recOnTop ? [...rec, ...pathRows, ...hits] : [...pathRows, ...hits, ...rec],
            pathStart: pathRows.length > 0 ? (recOnTop ? rec.length : 0) : -1,
            recStart: recOnTop ? 0 : pathRows.length + hits.length,
        };
    }, [recOnTop, hits, pathRows, recTools, experts, t]);

    // 注入源：素材 chip 优先，否则手打 query——从推荐工具进入就注入
    const injectSource = clip ?? (query.trim() || null);

    // 匹配源 / 素材 / 路径探测结论 / 专家行数变化后高亮回到第一项（chip 在场即推荐工具，
    // Enter 直接注入；探测结论与推荐专家进出会增删行，旧高亮序号可能指错行，一并重置）
    useEffect(() => setHi(0), [q, clip, pathHit, experts]);

    const open = q.length > 0 && focused;

    function select(c: Candidate) {
        if (c.kind === "item") {
            onOpenItem(c.item);
        } else if (c.kind === "tool") {
            const accepts = TOOLS.find((x) => x.id === c.id)?.acceptsText;
            onOpenTool(c.id, accepts ? injectSource : null);
        } else if (c.kind === "expert") {
            // 专家行：素材 chip ?? query 一起交给 ai（没有则 null——只切到该专家正常打开）
            onOpenTool("ai", injectSource, c.expert.id);
        } else {
            onOpenPath(c.target);
        }
        setQuery("");
        setClip(null);
    }

    function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
        if (e.key === "ArrowDown") {
            e.preventDefault();
            setHi((h) => Math.min(h + 1, candidates.length - 1));
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHi((h) => Math.max(h - 1, 0));
        } else if (e.key === "Enter") {
            const c = candidates[hi];
            if (c) select(c);
        } else if (e.key === "Escape") {
            // 先清素材 chip，再清普通 query
            if (clip !== null) setClip(null);
            else setQuery("");
        }
    }

    return (
        /* 顶栏搜索 pill(设计定稿):玻璃渐变底 + 32% 白描边,聚焦薄荷绿光晕(见 .knock-search)。
           高 46 = 顶栏整行(设计稿 SearchBar 与 TitleBar 同高),非小号内嵌胶囊 */
        <div className="knock-search relative flex h-[46px] min-w-0 flex-1 items-center gap-2 px-3.5">
            {" "}
            <Search size={15} className="flex-none text-white/55" aria-hidden />
            {/* 素材 chip：只读，键入即弃（见 onChange），× 手动移除 */}
            {clip !== null && (
                <span className="flex max-w-[70%] min-w-0 flex-none items-center gap-1.5 truncate rounded-full border border-white/20 bg-white/10 px-2.5 py-0.5 text-[12px] text-dim">
                    <span aria-hidden>❐</span>
                    <span className="truncate">{chipLabel(clip)}</span>
                    <button
                        type="button"
                        className="flex-none px-0.5 text-muted transition-colors hover:text-text"
                        aria-label={t("common.delete")}
                        onClick={() => setClip(null)}
                    >
                        ×
                    </button>
                </span>
            )}
            <input
                ref={inputRef}
                id="search"
                type="text"
                value={query}
                onChange={(e) => {
                    // 第一个键入字符 = 用户接管输入框，素材让位
                    if (clip !== null) setClip(null);
                    setQuery(e.target.value);
                }}
                onKeyDown={onKeyDown}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                placeholder={t("search.placeholder")}
                aria-label={t("search.placeholder")}
                autoComplete="off"
                spellCheck={false}
                className="min-w-0 flex-1 border-0 bg-transparent p-0 text-[13.5px] text-text outline-none placeholder:text-white/45"
            />
            {open && (
                <div className="app-no-drag absolute left-0 right-0 top-[calc(100%+10px)] z-50 max-h-80 overflow-y-auto rounded-2xl border border-white/16 bg-raised p-1.5 shadow-2xl shadow-black/40 backdrop-blur-2xl drop-anim">
                    {/* 只剩推荐工具或路径动作行时不算「无匹配」——指的是没有条目/工具命中 */}
                    {hits.length === 0 && pathRows.length === 0 && (
                        <span className="block px-2.5 py-1.5 text-[12.5px] text-muted">{t("search.noHit")}</span>
                    )}
                    {/* 推荐区分隔标签的位置随布局：置顶在第 0 行前，沉底在命中区之后 */}
                    {candidates.map((c, i) => {
                        const sel = hi === i;
                        const tag =
                            c.kind === "item"
                                ? KIND_TAG[c.item.kind]
                                : c.kind === "tool"
                                  ? t("tools.menu")
                                  : c.kind === "expert"
                                    ? t("search.expert")
                                    : c.label === "open"
                                      ? "file"
                                      : "dir";
                        const title =
                            c.kind === "item"
                                ? c.item.title
                                : c.kind === "tool"
                                  ? c.name
                                  : c.kind === "expert"
                                    ? c.expert.name
                                    : t(c.label === "open" ? "search.openFile" : "search.gotoFolder");
                        const tail =
                            c.kind === "item"
                                ? c.groupName
                                : c.kind === "tool"
                                  ? c.desc
                                  : c.kind === "expert"
                                    ? t(c.expert.multi ? "ai.modeMulti" : "ai.modeSingle")
                                    : c.target;
                        return (
                            <Fragment
                                key={
                                    c.kind === "item"
                                        ? `i${c.item.id}`
                                        : c.kind === "tool"
                                          ? `t${c.id}`
                                          : c.kind === "expert"
                                            ? `e${c.expert.id}`
                                            : `p${c.label}${c.target}`
                                }
                            >
                                {i === pathStart && (
                                    <div className="px-2.5 pb-0.5 pt-1 text-[10.5px] text-muted">
                                        ── {t("search.pathGroup")} ──
                                    </div>
                                )}
                                {i === recStart && (
                                    <div className="px-2.5 pb-0.5 pt-1 text-[10.5px] text-muted">
                                        ── {t("search.recommended")} ──
                                    </div>
                                )}
                                <button
                                    type="button"
                                    // 阻止 mousedown 默认行为保住输入框焦点，避免点击候选前下拉先因失焦消失
                                    onMouseDown={(e) => e.preventDefault()}
                                    onMouseEnter={() => setHi(i)}
                                    onClick={() => select(c)}
                                    // 高亮行浮白玻璃底 + 白字——玻璃体系的选中语言（不做反色）
                                    className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors ${
                                        sel ? "bg-white/10 text-text" : "text-dim"
                                    }`}
                                >
                                    <span className="kind-badge flex-none">{tag}</span>
                                    <span className="min-w-0 flex-1 truncate">{title}</span>
                                    <span
                                        className={`max-w-[40%] flex-none truncate text-[11.5px] ${sel ? "text-dim" : "text-muted"}`}
                                    >
                                        {tail}
                                    </span>
                                </button>
                            </Fragment>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
