import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronRight, Search, X } from "lucide-react";
import botIcon from "@/assets/icons/bot.svg";
import fileIcon from "@/assets/icons/file.svg";
import folderOpenIcon from "@/assets/icons/folder-open.svg";
import { TOOLS, toolMeta, type ToolId } from "@/tools/registry";
import { api, type Expert, type FolderAction, type Item, type ToolAliases } from "@/api/client";
import { KindIcon } from "@/lib/kindIcon";
import { sortItems } from "@/lib/itemOrder";
import { matchText } from "@/lib/pinyinMatch";
import { useExperts } from "@/lib/experts";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription } from "@/components/ui/empty";
import { Kbd } from "@/components/ui/kbd";
import { Marker } from "@/components/ui/marker";
import { TITLEBAR_HEIGHT, useWindowRoom } from "@/lib/windowRoom";
import type { MessageKey } from "@/i18n";
import { useI18n } from "@/i18n/useI18n";
import type { Shown, Term } from "./ToolArea";

// ── 顶栏搜索框（v2.3）：输入即出下拉候选 + 剪贴板素材流 ──
// 下拉分三块，各答一件事：
//   命中区（我想找什么）= 匹配的条目（标题；文件夹条目的目标路径也算）+ 匹配的全部内置工具（名称/描述/id/别名）
//     + 匹配的全部 AI 专家（名称，不论是否勾了推荐）。条目标题、工具名称与别名、专家名称还认拼音，规则见 lib/pinyinMatch.ts。
//     选中只打开、不带入文字，不管工具吃不吃文本；专家行只打开并切到该专家。
//   推荐区（这段字交给谁）= 能吃文本的工具 + 勾了推荐的 AI 专家，恒在。
//     选中一律注入「chip ?? 手打 query」。同一个工具可能在两块各出现一次，意思不同。
//   路径区：输入像绝对路径且真实存在时的动作行（文件 = 打开文件 + 前往所在目录；文件夹 = 前往）。
// 布局（用户决策）：路径区恒在最上（复制或手打的是存在的本地路径时，Enter 就是打开它）。
//   纯手打：路径区 + 命中区在上、推荐沉底——Enter 落第一个路径/命中行（开条目是主用途），↓ 到底进推荐。
//     没有任何命中时不预选行、Enter 不做事（手打的字不会悄悄带进便签），要带字先按 ↓。
//   素材 chip 在场：路径区、推荐区、命中区依次排列，高亮第一行。不是路径时第一行就是推荐，
//     Enter 即注入，保住「复制 → 呼出 → Enter」的素材流契约。
// 键盘：↑↓ 移动高亮、Enter 打开/注入高亮项、Esc 先清 chip 再清 query。
// 输入为空时没有下拉；按 / 弹出全部列表（没有侧栏、没有工具菜单后，这是浏览条目、切换和关闭工具与终端的唯一入口），
//   从上到下：运行中（有东西开着才出现）→ 快速启动条目 → 没打开的工具（含「终端」= 新开会话），打字后变回搜索。
//   默认高亮第一个条目，/ 后 Enter 开条目的习惯不变，↑ 才走到运行中。运行中的行按 Delete 或点 × 关闭。
// 文件夹条目按 → 在该行下面展开子菜单（固定的「在此打开终端」+ 设置里自定义的文件夹动作），Enter 仍是打开文件夹，← 或 Esc 收回子菜单。
//
// 下拉面板不是悬浮层（用户决策）：它是窗口里的一块正常内容，铺满顶栏下面的工具区（经 portal 画进 App 的 <main>）。
//   窗口收成一条时，面板打开就把窗口撑到「顶栏 + PANEL_HEIGHT」；窗口已展开时窗口不变，面板整块盖住工具区，
//   工具区不卸载、尺寸不变（终端不会被重排），面板关了原样露出来。
//   鼠标点面板里没有行的空白处 = 让搜索框失焦 = 关闭面板（输入的文字保留），点行、拖滚动条不会误关。

const MAX_CANDIDATES = 9;
/** 窗口收成一条时，下拉面板的固定高度（px）：固定而不跟内容走，打字筛选时窗口不会跟着一伸一缩 */
const PANEL_HEIGHT = 480;
const CHIP_MAX_CHARS = 32;
const PATH_PROBE_DEBOUNCE_MS = 200;
/** 推荐区基础顺序里排最前的工具（便签）；不动 TOOLS 数组，推荐区的顺序在这里单独定 */
const REC_FIRST: ToolId = "notes";

type Candidate =
    | { kind: "item"; item: Item }
    /** carry 为真 = 推荐区的行，选中带入文字；否则是命中区的行，只打开 */
    | { kind: "tool"; id: ToolId; name: string; desc: MessageKey; carry?: boolean }
    /** AI 专家。carry 为真 = 推荐区的行（只有勾了「推荐到搜索栏」的才有），选中带入文字；
     *  否则是命中区的行（所有专家都参与，按名称匹配），选中只打开并切到该专家 */
    | { kind: "expert"; expert: Expert; carry?: boolean }
    /** 「/」列表「运行中」段的行：已打开的工具和终端会话，选中 = 切过去，可关闭 */
    | { kind: "liveTool"; id: ToolId }
    | { kind: "liveTerm"; term: Term }
    /** label 是动作名，target 是该动作真正要交给 onOpenPath 的完整路径 */
    | { kind: "path"; label: "open" | "goto"; target: string };

/** 下拉里各区的小标题：at 是插在第几行之前；hint 是紧跟标题的一句提示（条目段为空时用） */
type GroupLabel = { at: number; text: string; hint?: string };

/** 候选行首图标：条目取图标包里的图（同快捷启动列表），工具、终端、专家和路径动作各配一张拟物图 */
function candidateIcon(c: Candidate, dirIds: ReadonlySet<number>, light: boolean): React.ReactNode {
    if (c.kind === "item") return <KindIcon item={c.item} isDir={dirIds.has(c.item.id)} light={light} />;
    if (c.kind === "tool" || c.kind === "liveTool") {
        const icon = TOOLS.find((x) => x.id === c.id)?.icon;
        return icon ? <img src={icon} alt="" className="size-[18px]" /> : null;
    }
    if (c.kind === "liveTerm") return <img src={toolMeta("terminal").icon} alt="" className="size-[18px]" />;
    if (c.kind === "expert") return <img src={botIcon} alt="" className="size-[18px]" />;
    return <img src={c.label === "open" ? fileIcon : folderOpenIcon} alt="" className="size-[18px]" />;
}

/** 候选行的 React key、标题和行尾说明。同一个工具或专家会在命中区、推荐区各出现一次，key 要带上区分 */
function candidateInfo(c: Candidate, t: ReturnType<typeof useI18n>["t"]): { key: string; title: string; tail: string } {
    switch (c.kind) {
        case "item":
            return { key: `i${c.item.id}`, title: c.item.title, tail: t(`item.kind.${c.item.kind}`) };
        case "tool":
            return { key: `t${c.id}${c.carry ? "-rec" : ""}`, title: c.name, tail: t(c.desc) };
        case "liveTool": {
            const meta = toolMeta(c.id);
            return { key: `lt${c.id}`, title: t(meta.nameKey), tail: t(meta.descKey) };
        }
        case "liveTerm":
            return { key: `lm${c.term.sessionId}`, title: c.term.title, tail: t("tool.terminal.name") };
        case "expert":
            return {
                key: `e${c.expert.id}${c.carry ? "-rec" : ""}`,
                title: c.expert.name,
                tail: t(c.expert.multi ? "ai.modeMulti" : "ai.modeSingle"),
            };
        case "path":
            return {
                key: `p${c.label}${c.target}`,
                title: t(c.label === "open" ? "search.openFile" : "search.gotoFolder"),
                tail: c.target,
            };
    }
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
    /** 文件夹条目子菜单的落点：在该目录开终端；action 有值时执行它的命令，没有 = 只开终端 */
    onOpenInTerminal: (item: Item, action?: FolderAction) => void;
    /** 用户自定义的文件夹动作（设置页维护）：子菜单里排在固定的「在此打开终端」后面 */
    folderActions: FolderAction[];
    /** 「/」列表「运行中」段的数据与落点：已打开的工具、终端会话、当前显示的是哪一个 */
    aliveTools: ToolId[];
    terms: Term[];
    shown: Shown;
    onShowTerm: (sessionId: number) => void;
    onCloseTool: (id: ToolId) => void;
    /** 关终端要先确认，确认框在 App 里 */
    onCloseTerm: (sessionId: number) => void;
    /** 下拉面板画进哪个节点：App 的 <main>（顶栏下面的工具区，需 position:relative）。null = 还没挂好，先不画 */
    panelHost: HTMLElement | null;
};

/** 把 el 滚进 list 的可见范围。只改 list 自己的 scrollTop，不用 scrollIntoView：
 *  它会连祖先一起滚，窗口刚从一条撑开的瞬间，App 根容器（overflow:hidden）会被滚走，顶栏就看不见了。
 *  list 还没有高度（窗口还没长出来）时不动，免得 scrollTop 被设成一个越界的值 */
function keepVisible(list: HTMLElement, el: HTMLElement): void {
    if (list.clientHeight === 0) return;
    const top = el.offsetTop;
    const bottom = top + el.offsetHeight;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
}

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

export function SearchBox({
    items,
    dirIds,
    light,
    toolAliases,
    onOpenItem,
    onOpenTool,
    onOpenPath,
    onOpenInTerminal,
    folderActions,
    aliveTools,
    terms,
    shown,
    onShowTerm,
    onCloseTool,
    onCloseTerm,
    panelHost,
}: Props) {
    const { t } = useI18n();
    const [query, setQuery] = useState("");
    const [clip, setClip] = useState<string | null>(null);
    const [focused, setFocused] = useState(false);
    const [hi, setHi] = useState(0);
    // 「/」弹出的全部条目列表：只在输入为空时有意义，打字、失焦、选中都会收起
    const [listOpen, setListOpen] = useState(false);
    // 文件夹条目的子菜单：在该条目行下面展开，hi 是子菜单里高亮的行
    const [sub, setSub] = useState<{ item: Item; hi: number } | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);
    // 勾了推荐的专家列表（AiTool 与此处经共享 store 同步，专家增删改即时反映）
    const experts = useExperts();

    // 双击 Ctrl 呼出：清空搜索词、装上剪贴板素材（null = 超时/关闭）、聚焦输入框
    useEffect(() => {
        return window.knock.onFocusSearch((text) => {
            setQuery("");
            setClip(text);
            setListOpen(false);
            setSub(null);
            inputRef.current?.focus();
        });
    }, []);

    // 「/」随时弹出全部条目：别处的输入框（含终端的隐藏输入框）里照常打字；
    // 本搜索框里只有输入为空（没有 chip、没有字）时才弹列表，否则「/」就是个普通字符
    useEffect(() => {
        function onWindowKeyDown(e: KeyboardEvent) {
            if (e.key !== "/" || e.ctrlKey || e.altKey || e.metaKey) return;
            const el = e.target as HTMLElement;
            if (el === inputRef.current) {
                if (query !== "" || clip !== null) return;
            } else if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable) {
                return;
            }
            e.preventDefault();
            inputRef.current?.focus();
            setListOpen(true);
        }
        window.addEventListener("keydown", onWindowKeyDown);
        return () => window.removeEventListener("keydown", onWindowKeyDown);
    }, [query, clip]);

    // 匹配源：素材 chip 优先（chip 在场时用完整剪贴板文本去匹配条目/工具）
    const q = (clip ?? query).trim().toLowerCase();
    // 拼音只对手打的字生效：带着剪贴板素材时 q 是复制来的数据，不是「打字找东西」的意图，
    // 只做字面匹配，免得复制一个英文单词就冒出莫名其妙的中文命中
    const pinyinOn = clip === null;
    // 列表模式：「/」弹出、输入为空——下拉里是运行中、全部条目和没打开的工具，不走命中/推荐分区
    const listMode = listOpen && q.length === 0;

    // 命中区：条目在前、工具在后；工具不论吃不吃文本都在这里，选中只打开
    const hits = useMemo(() => {
        const out: Candidate[] = [];
        if (q) {
            // 先按 / 列表同一套规则排序再匹配：候选顺序与列表顺序一致，不会随数据落库次序跳动。
            // 目标只对文件夹条目参与匹配（用路径找文件夹）；网址、应用、命令、文件的目标一律不匹配，
            // 否则打 "com"、"exe" 之类会命中一大片。目录判定是异步的，回来之前文件夹条目只按标题命中
            for (const item of sortItems(items)) {
                const targetHit = dirIds.has(item.id) && item.target.toLowerCase().includes(q);
                if (matchText(item.title, q, pinyinOn) || targetHit) {
                    out.push({ kind: "item", item });
                    if (out.length >= MAX_CANDIDATES) break;
                }
            }
            for (const tool of TOOLS) {
                if (out.length >= MAX_CANDIDATES) break;
                const name = t(tool.nameKey);
                const desc = tool.descKey;
                const aliases = aliasesOf(toolAliases, tool.id);
                // 名称和别名认拼音；id 与描述只做字面匹配（描述是整句话，首字母一打会命中一大片）
                const hit =
                    matchText(name, q, pinyinOn) ||
                    tool.id.includes(q) ||
                    t(desc).toLowerCase().includes(q) ||
                    aliases.some((a) => matchText(a, q, pinyinOn));
                if (hit) out.push({ kind: "tool", id: tool.id, name, desc });
            }
            // 专家排最后：不论有没有勾推荐都参与，专家只有名称可匹配；选中只打开，不带字
            for (const expert of experts) {
                if (out.length >= MAX_CANDIDATES) break;
                if (matchText(expert.name, q, pinyinOn)) out.push({ kind: "expert", expert });
            }
        }
        return out;
    }, [q, pinyinOn, items, dirIds, t, toolAliases, experts]);

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

    const { candidates, groupLabels, listHi } = useMemo(() => {
        if (listMode) {
            // 已打开的工具只在运行中段出现，工具段里不重复；终端永远在工具段（选中 = 新开一个会话）
            const live: Candidate[] = [
                ...aliveTools.map((id): Candidate => ({ kind: "liveTool", id })),
                ...terms.map((term): Candidate => ({ kind: "liveTerm", term })),
            ];
            const itemRows = sortItems(items).map((item): Candidate => ({ kind: "item", item }));
            const toolRows = TOOLS.filter((x) => !aliveTools.includes(x.id)).map((x): Candidate => ({
                kind: "tool",
                id: x.id,
                name: t(x.nameKey),
                desc: x.descKey,
            }));
            const labels: GroupLabel[] = [];
            if (live.length > 0) labels.push({ at: 0, text: t("tools.alive") });
            labels.push({
                at: live.length,
                text: t("search.itemsGroup"),
                hint: itemRows.length === 0 ? t("search.listEmpty") : undefined,
            });
            labels.push({ at: live.length + itemRows.length, text: t("search.toolsGroup") });
            return {
                candidates: [...live, ...itemRows, ...toolRows],
                groupLabels: labels,
                // 默认高亮第一个条目：「/」后 Enter 开条目的习惯不变；没有条目时不预选，免得 Enter 误开工具
                listHi: itemRows.length > 0 ? live.length : -1,
            };
        }
        const rec: Candidate[] = recTools.map((tool) => ({
            kind: "tool",
            id: tool.id,
            name: t(tool.nameKey),
            desc: tool.descKey,
            carry: true,
        })); // 勾了推荐的专家排在工具行之后、同一推荐区里（下标数学不用动）
        for (const expert of experts.filter((e) => e.recommend)) {
            rec.push({ kind: "expert", expert, carry: true });
        }
        // 路径区恒在最上；chip 在场时其后是推荐区、命中区，纯手打时其后是命中区、推荐区沉底。
        // 分组标签插在各区第一行前，下标随布局算（命中区没有标签）
        const labels: GroupLabel[] = [];
        if (pathRows.length > 0) labels.push({ at: 0, text: t("search.pathGroup") });
        labels.push({ at: recOnTop ? pathRows.length : pathRows.length + hits.length, text: t("search.recommended") });
        return {
            candidates: recOnTop ? [...pathRows, ...rec, ...hits] : [...pathRows, ...hits, ...rec],
            groupLabels: labels,
            listHi: -1,
        };
    }, [listMode, items, aliveTools, terms, recOnTop, hits, pathRows, recTools, experts, t]);

    // 注入源：素材 chip 优先，否则手打 query——从推荐工具进入就注入
    const injectSource = clip ?? (query.trim() || null);

    // 默认高亮第一行：chip 在场时，是路径就落路径区第一行（Enter 直接打开），否则是推荐第一行（Enter 直接注入）；
    // 纯手打 = 第一个路径/命中行。手打且路径区、命中区都空时不预选（-1），
    // 否则 Enter 会把手打的字悄悄带进推荐区第一行。「/」列表见 listHi
    const defaultHi = listMode ? listHi : recOnTop || pathRows.length + hits.length > 0 ? 0 : -1;

    // 匹配源 / 素材 / 路径探测结论 / 专家行数变化后高亮回到默认位置
    // （探测结论与推荐专家进出会增删行，旧高亮序号可能指错行，一并重置）
    useEffect(() => {
        setHi(defaultHi);
        setSub(null);
    }, [q, clip, pathHit, experts, defaultHi, listMode]);

    // 键盘移动高亮后滚到可见：「/」列表可能有很多行
    useEffect(() => {
        const list = listRef.current;
        const row = list?.querySelector<HTMLElement>(`[data-row="${hi}"]`);
        if (list && row) keepVisible(list, row);
    }, [hi]);

    // 子菜单展开或在里面移动高亮后，同样滚到可见（子菜单在行下面，行在列表底部时会被挤到视野外）
    useEffect(() => {
        if (!sub) return;
        const list = listRef.current;
        const row = list?.querySelector<HTMLElement>(`[data-sub-row="${sub.hi}"]`);
        if (list && row) keepVisible(list, row);
    }, [sub?.item.id, sub?.hi]);

    const open = (q.length > 0 || listMode) && focused;

    // 下拉撑开窗口：窗口收成一条时放不下面板，登记「顶栏 + 面板」的固定高度（窗口已展开时这个登记不起作用）
    useWindowRoom(open ? TITLEBAR_HEIGHT + PANEL_HEIGHT : 0);

    /** 收起下拉并清空输入（选中、子菜单执行后共用） */
    function reset() {
        setQuery("");
        setClip(null);
        setListOpen(false);
        setSub(null);
    }

    /** 点右边的「/」键帽：效果同按下 /，弹出全部列表。
     *  搜索框里有字或 chip 时，按键本来只是个普通字符、弹不出列表；点按钮是明确要列表，所以先清掉它们 */
    function openList() {
        setClip(null);
        setQuery("");
        setSub(null);
        inputRef.current?.focus();
        setListOpen(true);
    }

    /** 展开第 index 行（文件夹条目）的子菜单；这一行的子菜单已经开着就收回（鼠标点 ▸ 当开关用） */
    function openSub(index: number) {
        const c = candidates[index];
        if (c?.kind !== "item" || !dirIds.has(c.item.id)) return;
        setHi(index);
        setSub(sub?.item.id === c.item.id ? null : { item: c.item, hi: 0 });
    }

    // 子菜单的行：固定的「在此打开终端」（label 走多语言、没有动作），后面是用户的动作（label 取动作名）
    const subRows: ReadonlyArray<{ label: string; action?: FolderAction }> = [
        { label: t("menu.terminalHere") },
        ...folderActions.map((a) => ({ label: t("menu.openHere").replace("{name}", a.name), action: a })),
    ];

    function runSub(index: number) {
        if (!sub) return;
        onOpenInTerminal(sub.item, subRows[index].action);
        reset();
    }

    /** 关掉运行中段的一行。工具直接关、列表留着；终端要先确认，确认框会抢走输入框焦点，列表本来就会收起，这里顺手收掉 */
    function closeLive(c: Extract<Candidate, { kind: "liveTool" | "liveTerm" }>) {
        if (c.kind === "liveTool") {
            onCloseTool(c.id);
        } else {
            onCloseTerm(c.term.sessionId);
            reset();
        }
    }

    function select(c: Candidate) {
        if (c.kind === "item") {
            onOpenItem(c.item);
        } else if (c.kind === "tool") {
            // 推荐区的行带字，命中区和「/」列表的行只打开
            onOpenTool(c.id, c.carry ? injectSource : null);
        } else if (c.kind === "liveTool") {
            onOpenTool(c.id, null);
        } else if (c.kind === "liveTerm") {
            onShowTerm(c.term.sessionId);
        } else if (c.kind === "expert") {
            // 推荐区的专家行把素材 chip ?? query 一起交给 ai（没有则 null——只切到该专家正常打开）；
            // 命中区的专家行只打开并切到该专家：打的字是在找人，不是要问的问题
            onOpenTool("ai", c.carry ? injectSource : null, c.expert.id);
        } else {
            onOpenPath(c.target);
        }
        reset();
    }

    function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
        // 子菜单开着：方向键只在子菜单里走，Enter 执行，← / Esc 收回（Esc 只收子菜单，不关整个下拉）
        if (sub) {
            if (e.key === "ArrowDown") {
                e.preventDefault();
                setSub({ ...sub, hi: Math.min(sub.hi + 1, subRows.length - 1) });
            } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSub({ ...sub, hi: Math.max(sub.hi - 1, 0) });
            } else if (e.key === "Enter") {
                e.preventDefault();
                runSub(sub.hi);
            } else if (e.key === "ArrowLeft" || e.key === "Escape") {
                e.preventDefault();
                setSub(null);
            }
            return;
        }
        if (e.key === "ArrowDown") {
            e.preventDefault();
            setHi((h) => Math.min(h + 1, candidates.length - 1));
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            // 未预选（-1）时 ↑ 保持不动，不要凭空跳到第一行
            setHi((h) => (h <= 0 ? h : h - 1));
        } else if (e.key === "ArrowRight") {
            // 光标在文字末尾才拦：否则 → 还要用来在输入里移动光标
            const atEnd =
                e.currentTarget.selectionStart === query.length && e.currentTarget.selectionEnd === query.length;
            if (atEnd) {
                const c = candidates[hi];
                if (c?.kind === "item" && dirIds.has(c.item.id)) {
                    e.preventDefault();
                    openSub(hi);
                }
            }
        } else if (e.key === "Delete" && listMode) {
            // 只有运行中的行能删：条目和没打开的工具按 Delete 什么都不做，不会误删条目
            const c = candidates[hi];
            if (c?.kind === "liveTool" || c?.kind === "liveTerm") {
                e.preventDefault();
                closeLive(c);
            }
        } else if (e.key === "Enter") {
            const c = candidates[hi];
            if (c) select(c);
        } else if (e.key === "Escape") {
            // 先清素材 chip，再收「/」列表，最后清普通 query
            if (clip !== null) setClip(null);
            else if (listOpen) setListOpen(false);
            else setQuery("");
        }
    }

    return (
        /* 搜索行：井体（28px、内边距、聚焦底色）由外层 TitlebarWell 提供，这里只保留布局；
           下拉面板不在这里，经 portal 画进 panelHost（见文件头注释）。 */
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
                    setListOpen(false);
                    setQuery(e.target.value);
                }}
                onKeyDown={onKeyDown}
                onFocus={() => setFocused(true)}
                onBlur={() => {
                    setFocused(false);
                    setListOpen(false);
                    setSub(null);
                }}
                placeholder={t("search.placeholder")}
                aria-label={t("search.placeholder")}
                autoComplete="off"
                spellCheck={false}
                className="min-w-0 flex-1 select-text border-0 bg-transparent p-0 text-xs text-foreground outline-none placeholder:text-muted-foreground"
            />
            {/* mousedown 默认行为压住：免得点按钮让输入框先失焦，列表随之收起 */}
            <button
                type="button"
                tabIndex={-1}
                title={t("search.listAll")}
                aria-label={t("search.listAll")}
                onMouseDown={(e) => e.preventDefault()}
                onClick={openList}
                className="flex-none"
            >
                <Kbd className="cursor-pointer hover:text-foreground">/</Kbd>
            </button>
            {open &&
                panelHost &&
                createPortal(
                    // 盖在工具区上面，用不透明底色把后面的工具挡住（工具区本身不动）；id 给测试脚本取节点。
                    // mousedown 默认行为一律压住：点行、拖滚动条都不能让输入框失焦、面板随之消失
                    <div
                        id="search-panel"
                        onMouseDown={(e) => e.preventDefault()}
                        className="absolute inset-0 z-30 bg-canvas text-foreground"
                    >
                        {/* 滚动容器要 relative：行的 offsetTop 以它为基准（keepVisible 靠这个算位置） */}
                        <div ref={listRef} className="relative h-full overflow-y-auto">
                            {/* min-h-full：行不够多时它也撑满面板，点到它自己（不是行）就是点了空白处，关闭面板；
                                滚动条属于外面的滚动容器，点滚动条碰不到这里 */}
                            <div
                                className="min-h-full px-2 py-1"
                                onClick={(e) => {
                                    if (e.target === e.currentTarget) inputRef.current?.blur();
                                }}
                            >
                                {/* 「无匹配」指命中区和路径区都空；下面照常列推荐区，让用户能 ↓ 选一行带字 */}
                                {!listMode && hits.length === 0 && pathRows.length === 0 && (
                                    <Empty className="px-2.5 py-2">
                                        <EmptyDescription>{t("search.noHit")}</EmptyDescription>
                                    </Empty>
                                )}
                                {candidates.map((c, i) => {
                                    const sel = hi === i;
                                    const { key, title, tail } = candidateInfo(c, t);
                                    // 正在显示的运行中行用强调色
                                    const current =
                                        (c.kind === "liveTool" && shown?.kind === "tool" && shown.id === c.id) ||
                                        (c.kind === "liveTerm" &&
                                            shown?.kind === "term" &&
                                            shown.sessionId === c.term.sessionId);
                                    return (
                                        <Fragment key={key}>
                                            {/* 各区小标题插在该区第一行前；hint 是紧跟标题的一句提示（「/」列表里没有条目时去设置添加） */}
                                            {groupLabels
                                                .filter((g) => g.at === i)
                                                .map((g) => (
                                                    <Fragment key={g.text}>
                                                        <Marker
                                                            structure="separator"
                                                            variant="muted"
                                                            className="px-2.5 pt-1.5 pb-0.5 text-caption"
                                                        >
                                                            {g.text}
                                                        </Marker>
                                                        {g.hint && (
                                                            <Empty className="px-2.5 py-2">
                                                                <EmptyDescription>{g.hint}</EmptyDescription>
                                                            </Empty>
                                                        )}
                                                    </Fragment>
                                                ))}
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                data-row={i}
                                                // 阻止 mousedown 默认行为保住输入框焦点，避免点击候选前下拉先因失焦消失
                                                onMouseDown={(e) => e.preventDefault()}
                                                // 子菜单开着时高亮钉在它所属的行上：方向键和 Enter 此时只管子菜单，
                                                // 鼠标路过别的行不能把高亮挪走，否则看上去 Enter 会开那一行
                                                onMouseEnter={() => {
                                                    if (!sub) setHi(i);
                                                }}
                                                onClick={() => select(c)}
                                                className={`h-auto w-full justify-start gap-2.5 rounded-[4px] px-2 py-1.5 text-left text-xs ${
                                                    sel ? "bg-(--state-selected)" : ""
                                                } ${current ? "font-medium text-primary" : sel ? "text-foreground" : "text-muted-foreground"}`}
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
                                                {/* 运行中行尾的 ×：高亮（含鼠标悬停）时才显示，点它只关闭、不当成选中 */}
                                                {(c.kind === "liveTool" || c.kind === "liveTerm") && (
                                                    <span
                                                        role="button"
                                                        aria-label={`${t("common.close")} ${title}`}
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            closeLive(c);
                                                        }}
                                                        className={`-me-1 grid size-5 flex-none place-items-center rounded-[3px] text-dim-foreground hover:bg-(--state-hover) hover:text-foreground ${sel ? "" : "invisible"}`}
                                                    >
                                                        <X className="size-3.5" />
                                                    </span>
                                                )}
                                                {/* 文件夹条目行尾的 ▸：提示有子菜单，鼠标点它展开（键盘用 →） */}
                                                {c.kind === "item" && dirIds.has(c.item.id) && (
                                                    <span
                                                        role="button"
                                                        aria-label={t("search.moreActions")}
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            openSub(i);
                                                        }}
                                                        className="-me-1 grid size-5 flex-none place-items-center rounded-[3px] text-dim-foreground hover:bg-(--state-hover) hover:text-foreground"
                                                    >
                                                        <ChevronRight className="size-3.5" />
                                                    </span>
                                                )}
                                            </Button>
                                            {/* 子菜单直接在触发它的那一行下面展开，缩进到标题那一列（图标 18 + 间距 10 + 行内边距 8） */}
                                            {sub && c.kind === "item" && sub.item.id === c.item.id && (
                                                <div role="menu" className="mb-0.5 ml-9">
                                                    {subRows.map((r, j) => (
                                                        <Button
                                                            key={j}
                                                            type="button"
                                                            variant="ghost"
                                                            role="menuitem"
                                                            data-sub-row={j}
                                                            onMouseEnter={() => setSub({ ...sub, hi: j })}
                                                            onClick={() => runSub(j)}
                                                            className={`h-auto w-full justify-start rounded-[4px] px-2 py-1.5 text-left text-xs ${
                                                                sub.hi === j
                                                                    ? "bg-(--state-selected) text-foreground"
                                                                    : "text-muted-foreground"
                                                            }`}
                                                        >
                                                            {r.label}
                                                        </Button>
                                                    ))}
                                                </div>
                                            )}
                                        </Fragment>
                                    );
                                })}
                            </div>
                        </div>
                    </div>,
                    panelHost,
                )}
        </div>
    );
}
