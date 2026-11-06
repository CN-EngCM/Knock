import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import botIcon from "@/assets/icons/bot.svg";
import fileIcon from "@/assets/icons/file.svg";
import folderOpenIcon from "@/assets/icons/folder-open.svg";
import { TOOLS, type ToolId } from "@/tools/registry";
import { api, type Expert, type Item, type ToolAliases } from "@/api/client";
import { KindIcon } from "@/lib/kindIcon";
import { sortItems } from "@/lib/itemOrder";
import { useExperts } from "@/lib/experts";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription } from "@/components/ui/empty";
import { Kbd } from "@/components/ui/kbd";
import { Marker } from "@/components/ui/marker";
import type { MessageKey } from "@/i18n";
import { useI18n } from "@/i18n/useI18n";

// ── 顶栏搜索框（v2.3）：输入即出下拉候选 + 剪贴板素材流 ──
// 下拉分三块，各答一件事：
//   命中区（我想找什么）= 匹配的条目（标题；文件夹条目的目标路径也算）+ 匹配的全部内置工具（名称/描述/id/别名）。
//     选中只打开、不带入文字，不管工具吃不吃文本。
//   推荐区（这段字交给谁）= 能吃文本的工具 + 勾了推荐的 AI 专家，恒在。
//     选中一律注入「chip ?? 手打 query」。同一个工具可能在两块各出现一次，意思不同。
//   路径区：输入像绝对路径且真实存在时的动作行（文件 = 打开文件 + 前往所在目录；文件夹 = 前往）。
// 布局（用户决策）：路径区恒在最上（复制或手打的是存在的本地路径时，Enter 就是打开它）。
//   纯手打：路径区 + 命中区在上、推荐沉底——Enter 落第一个路径/命中行（开条目是主用途），↓ 到底进推荐。
//     没有任何命中时不预选行、Enter 不做事（手打的字不会悄悄带进便签），要带字先按 ↓。
//   素材 chip 在场：路径区、推荐区、命中区依次排列，高亮第一行。不是路径时第一行就是推荐，
//     Enter 即注入，保住「复制 → 呼出 → Enter」的素材流契约。
// 键盘：↑↓ 移动高亮、Enter 打开/注入高亮项、Esc 先清 chip 再清 query。

const MAX_CANDIDATES = 9;
const CHIP_MAX_CHARS = 32;
const PATH_PROBE_DEBOUNCE_MS = 200;
/** 推荐区基础顺序里排最前的工具（便签）；不动 TOOLS 数组，工具首页与工具集菜单的顺序另算 */
const REC_FIRST: ToolId = "notes";

type Candidate =
    | { kind: "item"; item: Item }
    /** carry 为真 = 推荐区的行，选中带入文字；否则是命中区的行，只打开 */
    | { kind: "tool"; id: ToolId; name: string; desc: MessageKey; carry?: boolean }
    /** 勾了「推荐到搜索栏」的 AI 专家：进推荐区一行 */
    | { kind: "expert"; expert: Expert }
    /** label 是动作名，target 是该动作真正要交给 onOpenPath 的完整路径 */
    | { kind: "path"; label: "open" | "goto"; target: string };

/** 候选行首图标：条目取图标包里的图（同快捷启动列表），工具、专家和路径动作各配一张拟物图 */
function candidateIcon(c: Candidate, dirIds: ReadonlySet<number>, light: boolean): React.ReactNode {
    if (c.kind === "item") return <KindIcon item={c.item} isDir={dirIds.has(c.item.id)} light={light} />;
    if (c.kind === "tool") {
        const icon = TOOLS.find((x) => x.id === c.id)?.icon;
        return icon ? <img src={icon} alt="" className="size-[18px]" /> : null;
    }
    if (c.kind === "expert") return <img src={botIcon} alt="" className="size-[18px]" />;
    return <img src={c.label === "open" ? fileIcon : folderOpenIcon} alt="" className="size-[18px]" />;
}

type Props = {
    items: Item[];
    /** 目标经运行时确认是本机目录的条目 id：这些条目的候选行显示文件夹图标 */
    dirIds: ReadonlySet<number>;
    /** 浅色主题：图标包里少数图标有专为浅底画的款式 */
    light: boolean;
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

/** 工具的别名列表（设置页存成空格/逗号分隔的串） */
function aliasesOf(aliases: ToolAliases, id: ToolId): string[] {
    return (aliases[id] ?? "").split(/[\s,，]+/).filter(Boolean);
}

/** chip 单行展示：空白折叠 + 按码点截断；剪贴板可能是几 MB 的文本，先粗截再处理 */
function chipLabel(text: string): string {
    const flat = text.slice(0, 256).replace(/\s+/g, " ").trim();
    const chars = [...flat];
    return chars.length > CHIP_MAX_CHARS ? chars.slice(0, CHIP_MAX_CHARS).join("") + "…" : flat;
}

export function SearchBox({ items, dirIds, light, toolAliases, onOpenItem, onOpenTool, onOpenPath }: Props) {
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

    // 命中区：条目在前、工具在后；工具不论吃不吃文本都在这里，选中只打开
    const hits = useMemo(() => {
        const out: Candidate[] = [];
        if (q) {
            // 先按侧栏同一套规则排序再匹配：候选顺序与列表顺序一致，不会随数据落库次序跳动。
            // 目标只对文件夹条目参与匹配（用路径找文件夹）；网址、应用、命令、文件的目标一律不匹配，
            // 否则打 "com"、"exe" 之类会命中一大片。目录判定是异步的，回来之前文件夹条目只按标题命中
            for (const item of sortItems(items)) {
                const targetHit = dirIds.has(item.id) && item.target.toLowerCase().includes(q);
                if (item.title.toLowerCase().includes(q) || targetHit) {
                    out.push({ kind: "item", item });
                    if (out.length >= MAX_CANDIDATES) break;
                }
            }
            for (const tool of TOOLS) {
                if (out.length >= MAX_CANDIDATES) break;
                const name = t(tool.nameKey);
                const desc = tool.descKey;
                const aliases = aliasesOf(toolAliases, tool.id);
                const hit =
                    name.toLowerCase().includes(q) ||
                    tool.id.includes(q) ||
                    t(desc).toLowerCase().includes(q) ||
                    aliases.some((a) => a.toLowerCase().includes(q));
                if (hit) out.push({ kind: "tool", id: tool.id, name, desc });
            }
        }
        return out;
    }, [q, items, dirIds, t, toolAliases]);

    // 推荐工具：能吃文本素材的工具，基础顺序便签在前，再按嗅探结果把命中项置顶（其余相对顺序不变）
    const recTools = useMemo(() => {
        const accepting = TOOLS.filter((x) => x.acceptsText);
        const list = [...accepting.filter((x) => x.id === REC_FIRST), ...accepting.filter((x) => x.id !== REC_FIRST)];
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
            desc: tool.descKey,
            carry: true,
        })); // 勾了推荐的专家排在工具行之后、同一推荐区里（下标数学不用动）
        for (const expert of experts.filter((e) => e.recommend)) {
            rec.push({ kind: "expert", expert });
        }
        // 路径区恒在最上；chip 在场时其后是推荐区、命中区，纯手打时其后是命中区、推荐区沉底。
        // 分组标签插在各区第一行前，下标随布局算
        return {
            candidates: recOnTop ? [...pathRows, ...rec, ...hits] : [...pathRows, ...hits, ...rec],
            pathStart: pathRows.length > 0 ? 0 : -1,
            recStart: recOnTop ? pathRows.length : pathRows.length + hits.length,
        };
    }, [recOnTop, hits, pathRows, recTools, experts, t]);

    // 注入源：素材 chip 优先，否则手打 query——从推荐工具进入就注入
    const injectSource = clip ?? (query.trim() || null);

    // 默认高亮第一行：chip 在场时，是路径就落路径区第一行（Enter 直接打开），否则是推荐第一行（Enter 直接注入）；
    // 纯手打 = 第一个路径/命中行。手打且路径区、命中区都空时不预选（-1），
    // 否则 Enter 会把手打的字悄悄带进推荐区第一行
    const defaultHi = recOnTop || pathRows.length + hits.length > 0 ? 0 : -1;

    // 匹配源 / 素材 / 路径探测结论 / 专家行数变化后高亮回到默认位置
    // （探测结论与推荐专家进出会增删行，旧高亮序号可能指错行，一并重置）
    useEffect(() => setHi(defaultHi), [q, clip, pathHit, experts, defaultHi]);

    const open = q.length > 0 && focused;

    function select(c: Candidate) {
        if (c.kind === "item") {
            onOpenItem(c.item);
        } else if (c.kind === "tool") {
            // 推荐区的行带字，命中区的行只打开
            onOpenTool(c.id, c.carry ? injectSource : null);
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
            // 未预选（-1）时 ↑ 保持不动，不要凭空跳到第一行
            setHi((h) => (h <= 0 ? h : h - 1));
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
        /* 搜索行：井体（34px、内边距、聚焦底色）由外层 TitlebarWell 提供，
           这里只保留布局；下拉用 absolute 锚定到 TitlebarWell（App 的 center 槽）。 */
        <div className="flex min-w-0 flex-1 items-center gap-2">
            <Search className="flex-none text-muted-foreground" size={15} aria-hidden />
            {/* 素材 chip：只读，键入即弃（见 onChange），× 手动移除 */}
            {clip !== null && (
                <span className="flex max-w-[70%] min-w-0 flex-none items-center gap-1.5 truncate rounded-full border border-border bg-well px-2.5 py-0.5 text-[11px] text-muted-foreground">
                    <span aria-hidden>❐</span>
                    <span className="truncate">{chipLabel(clip)}</span>
                    <Button
                        type="button"
                        appearance="standard"
                        variant="ghost"
                        size="xs"
                        className="h-auto flex-none px-0.5 text-[11px] text-dim-foreground hover:text-foreground"
                        aria-label={t("common.delete")}
                        onClick={() => setClip(null)}
                    >
                        ×
                    </Button>
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
                className="min-w-0 flex-1 select-text border-0 bg-transparent p-0 text-xs text-foreground outline-none placeholder:text-muted-foreground"
            />
            <Kbd className="flex-none">/</Kbd>
            {open && (
                <div className="drop-anim absolute inset-x-0 top-[calc(100%+8px)] z-50 max-h-80 overflow-y-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-[0_12px_30px_rgb(0_0_0/40%)]">
                    {/* 「无匹配」指命中区和路径区都空；下面照常列推荐区，让用户能 ↓ 选一行带字 */}
                    {hits.length === 0 && pathRows.length === 0 && (
                        <Empty className="px-2.5 py-2">
                            <EmptyDescription>{t("search.noHit")}</EmptyDescription>
                        </Empty>
                    )}
                    {/* 推荐区分隔标签的位置随布局：置顶在第 0 行前，沉底在命中区之后 */}
                    {candidates.map((c, i) => {
                        const sel = hi === i;
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
                                ? t(`item.kind.${c.item.kind}`)
                                : c.kind === "tool"
                                  ? t(c.desc)
                                  : c.kind === "expert"
                                    ? t(c.expert.multi ? "ai.modeMulti" : "ai.modeSingle")
                                    : c.target;
                        return (
                            <Fragment
                                key={
                                    c.kind === "item"
                                        ? `i${c.item.id}`
                                        : c.kind === "tool"
                                          ? `t${c.id}${c.carry ? "-rec" : ""}`
                                          : c.kind === "expert"
                                            ? `e${c.expert.id}`
                                            : `p${c.label}${c.target}`
                                }
                            >
                                {i === pathStart && (
                                    <Marker
                                        structure="separator"
                                        variant="muted"
                                        className="px-2.5 pt-1.5 pb-0.5 text-caption"
                                    >
                                        {t("search.pathGroup")}
                                    </Marker>
                                )}
                                {i === recStart && (
                                    <Marker
                                        structure="separator"
                                        variant="muted"
                                        className="px-2.5 pt-1.5 pb-0.5 text-caption"
                                    >
                                        {t("search.recommended")}
                                    </Marker>
                                )}
                                <Button
                                    type="button"
                                    variant="ghost"
                                    // 阻止 mousedown 默认行为保住输入框焦点，避免点击候选前下拉先因失焦消失
                                    onMouseDown={(e) => e.preventDefault()}
                                    onMouseEnter={() => setHi(i)}
                                    onClick={() => select(c)}
                                    className={`h-auto w-full justify-start gap-2.5 rounded-[4px] px-2 py-1.5 text-left text-xs ${
                                        sel ? "bg-(--state-selected) text-foreground" : "text-muted-foreground"
                                    }`}
                                >
                                    <span className="grid w-[18px] flex-none place-items-center">
                                        {candidateIcon(c, dirIds, light)}
                                    </span>
                                    <span className="min-w-0 flex-1 truncate">{title}</span>
                                    <span
                                        className={`max-w-[40%] flex-none truncate text-[10.5px] ${sel ? "text-muted-foreground" : "text-dim-foreground"}`}
                                    >
                                        {tail}
                                    </span>
                                </Button>
                            </Fragment>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
