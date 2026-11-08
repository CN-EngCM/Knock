import { useCallback, Dispatch, useEffect, useRef, SetStateAction, useState } from "react";
import { toast, useSonner } from "sonner";
import { ArrowUpToLine, ChevronUp, Pin, Settings2 } from "lucide-react";
import {
    api,
    onPtyEvent,
    type ApiError,
    type ApiResult,
    type FolderAction,
    type FontPatch,
    type Item,
    type TermPatch,
    type ThemeId,
    type ToolAliasPatch,
} from "./api/client";
import { Button } from "@/components/ui/button";
import { Marker } from "@/components/ui/marker";
import { Toaster } from "@/components/ui/sonner";
import { Titlebar, TitlebarWell } from "@/components/ui/titlebar";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { SearchBox } from "./components/SearchBox";
import { ToolArea, type Shown, type Term } from "./components/ToolArea";
import { TITLEBAR_HEIGHT, useMaxRoom, useWindowRoom } from "./lib/windowRoom";
import { disposeTerm, setTermFont } from "./components/termStore";
import type { ToolId } from "./tools/registry";
import { clearToolInput, dispatchToolFocus, dispatchToolInput } from "./tools/toolInput";
import { ItemDialog, type ItemFormValues } from "./components/dialogs/ItemDialog";
import { ConfirmDialog } from "./components/dialogs/ConfirmDialog";
import { SettingsDialog, type SectionId } from "./components/dialogs/SettingsDialog";
import { applyFonts } from "./lib/fonts";
import { cleanTermTitle } from "./lib/termTitle";
import { applyTheme, currentTheme } from "./lib/theme";
import { useI18n } from "./i18n/useI18n";

// 工具内「打开设置」引导要直达的分节：工具有缺配置态就登记一行；
// 未收录的 ToolId 保持旧行为落回翻译分节
const TOOL_SETTINGS_SECTION: Partial<Record<ToolId, SectionId>> = {
    translate: "translate",
    ai: "ai",
};

// 条目弹窗收敛为一个可辨识联合（discriminated union）：
// 用 kind 字段区分形态，switch 后每个分支的 payload 类型自动收窄。
// 设置页单独一个状态：新增、编辑、删除条目都从设置页的「快速启动」分节发起，条目弹窗要叠在设置页上面，两者必须能同时开着。
type ItemDialogState =
    { kind: "none" } | { kind: "create" } | { kind: "edit"; item: Item } | { kind: "delete"; item: Item };

/** 报错提示出现时，窗口收成一条也要撑开：顶栏 + 一条提示的高度，多条叠着再加 */
function ToastRoom() {
    const { toasts } = useSonner();
    const n = Math.min(toasts.length, 3);
    useWindowRoom(n > 0 ? TITLEBAR_HEIGHT + 120 + 64 * (n - 1) : 0);
    return null;
}

/** 启动期只读一次的设置类 RPC：挂载即拉一次，失败保持 null（界面以 … 占位，不阻塞首帧） */
function useRpcValue<T>(load: () => Promise<ApiResult<T>>): [T | null, Dispatch<SetStateAction<T | null>>] {
    const [value, setValue] = useState<T | null>(null);
    // load 收进 ref、依赖数组留空：请求保证只发一次；即便调用处换传内联箭头，
    // 也不会因每次渲染换函数身份而反复请求
    const loadRef = useRef(load);
    useEffect(() => {
        loadRef.current().then((r) => {
            if (r.ok) setValue(r.data);
        });
    }, []);
    return [value, setValue];
}

export default function App() {
    const { t, lang, setLang } = useI18n();
    const [serverOk, setServerOk] = useState<boolean | null>(null);
    const [items, setItems] = useState<Item[]>([]);
    // 本机目录条目 id：file 类型同时表示文件与文件夹，只能运行时 stat 判定，
    // 子菜单（按 →）据此决定哪些条目有「在此打开终端」
    const [dirIds, setDirIds] = useState<ReadonlySet<number>>(() => new Set());
    const [itemDialog, setItemDialog] = useState<ItemDialogState>({ kind: "none" });
    // 设置页：null = 关着；section 是打开时直接定位的分节（工具内「打开设置」引导用，缺省回基础设置）
    const [settings, setSettings] = useState<{ section?: SectionId } | null>(null);
    const [platform, setPlatform] = useState("");
    // 界面主题：初始值来自 index.html 首帧前套好的 <html> 类；切换经 settings 表持久化
    const [theme, setTheme] = useState<ThemeId>(currentTheme);
    // 终端设置（shell/字号）：字号喂 termStore（xterm 实例表），设置页改这里再落库
    const [termCfg, setTermCfg] = useRpcValue(api.getTermConfig);
    // 字体设置（界面/等宽）：applyFonts 写 CSS 变量全局生效；等宽栈同步喂 termStore
    const [fontCfg, setFontCfg] = useRpcValue(api.getFontConfig);

    // 全量拉取：个人工具规模下最简单的数据同步方式（每次变更后重拉）
    const refresh = useCallback(async () => {
        try {
            const r = await api.getData();
            if (!r.ok) throw new Error(r.error.kind);
            setItems(r.data.items);
            setServerOk(true);
        } catch {
            setServerOk(false);
        }
    }, []);

    // 目录判定：只查 file 类型且形状像本机绝对路径的条目（编辑弹窗允许自由文本，
    // app/command/bookmark 的 target 语义各不相同，不能拿去 stat）。条目变更后重算，
    // 每条目一次 IPC，个人工具的量级不需要批量接口
    useEffect(() => {
        let cancelled = false;
        const paths = items.filter((i) => i.kind === "file" && /^[A-Za-z]:[\\/]|^\\\\/.test(i.target));
        void Promise.all(
            paths.map(async (i) => {
                const r = await api.statPath(i.target);
                return r.ok && r.data.isDir ? i.id : null;
            }),
        ).then((ids) => {
            if (cancelled) return;
            setDirIds(new Set(ids.filter((id): id is number => id !== null)));
        });
        return () => {
            cancelled = true;
        };
    }, [items]);

    // 托盘菜单「设置」→ 唤起窗口的同时打开设置对话框（preload 转发的主进程事件）
    useEffect(() => {
        window.knock.onOpenSettings(() => setSettings({}));
    }, []);

    // ── 钉住 / 置顶：钉住豁免「失焦自动隐藏」（挂终端/对照工作的场景）──
    // 钉住跨重启保持、呼出不再重置；置顶是钉住下的子状态，只在内存里，重启即复位。
    // 状态变更只由界面发起、主进程不回推，所以启动读一次主进程现状即可（失败保持未钉：
    // 这是启动期状态读取，不弹 toast）
    const [pinned, setPinned] = useState(false);
    const [topmost, setTopmost] = useState(false);
    useEffect(() => {
        void api.getPinState().then((r) => {
            if (!r.ok) return;
            setPinned(r.data.pinned);
            setTopmost(r.data.topmost);
        });
    }, []);

    // 钉住：本地先取反再同步主进程（fire-and-forget）。取消钉住时本地一并清置顶，
    // 与主进程「取消钉住顺带清置顶」的行为保持一致，避免界面留着已失效的置顶态
    const togglePin = useCallback(() => {
        const next = !pinned;
        window.knock.setPinned(next);
        setPinned(next);
        if (!next) setTopmost(false);
    }, [pinned]);

    // 置顶：仅在钉住时可切换——未钉住的窗口遵守「失焦即藏」，让窗口压在最前与这套形态冲突
    const toggleTopmost = useCallback(() => {
        if (!pinned) return;
        const next = !topmost;
        window.knock.setTopmost(next);
        setTopmost(next);
    }, [pinned, topmost]);

    // 置顶按钮的提示文案：三态各一句（未钉住时按钮禁用，提示先钉住）
    const topmostLabel = !pinned ? t("btn.topmostHint") : t(topmost ? "btn.untopmost" : "btn.topmost");

    // ── 主题切换：乐观更新界面类 + 通知主进程换窗口底色/边线，再落库；
    //    落库失败回滚（settings 表是唯一权威来源）──
    const switchTheme = useCallback(
        async (next: ThemeId) => {
            const prev = theme;
            if (next === prev) return;
            setTheme(next);
            applyTheme(next);
            window.knock.setTheme(next);
            const r = await api.setTheme(next);
            if (!r.ok) {
                setTheme(prev);
                applyTheme(prev);
                window.knock.setTheme(prev);
                toast.error(t("toast.error"));
            }
        },
        [theme, t],
    );

    // 启动顺序：先取运行环境（platform），再拉数据。
    useEffect(() => {
        (async () => {
            try {
                const r = await api.session();
                if (r.ok) setPlatform(r.data.platform);
            } catch {
                /* 主进程不可达时交由 refresh 反映状态 */
            }
            await refresh();
        })();
    }, [refresh]);

    // 工具别名启动时拉一次：喂 SearchBox 参与候选匹配
    const [toolAliases, setToolAliases] = useRpcValue(api.getToolAliases);

    // 文件夹动作同样启动时拉一次：喂 SearchBox 的文件夹子菜单，设置页整份保存后回填
    const [folderActionsData, setFolderActionsData] = useRpcValue(api.getFolderActions);
    const folderActions = folderActionsData?.actions ?? null;

    // 设置页各分项提交的公共路径：失败统一 toast 并返回 false（弹窗内自行回滚），成功交给 apply 回填。
    // 现状没有 memo 需求，普通闭包定义即可（要吃到 i18n 文案，故放在组件内）
    async function patchSetting<T>(call: () => Promise<ApiResult<T>>, apply: (data: T) => void): Promise<boolean> {
        try {
            const r = await call();
            if (!r.ok) throw new Error(r.error.kind);
            apply(r.data);
            return true;
        } catch {
            toast.error(t("toast.error"));
            return false;
        }
    }

    // 设置页提交终端设置：成功回填配置（字号经 termFont 即时作用到终端实例）
    function patchTerm(p: TermPatch): Promise<boolean> {
        return patchSetting(() => api.setTermConfig(p), setTermCfg);
    }

    // 设置页提交字体设置：成功回填；applyFonts 随 fontCfg 变化重写 CSS 变量即全局生效
    function patchFont(p: FontPatch): Promise<boolean> {
        return patchSetting(() => api.setFontConfig(p), setFontCfg);
    }

    // 字体设置就绪/变更 → 写 <html> 行内 CSS 变量（fontCfg 为 null 时用空串 = 默认栈）
    useEffect(() => {
        applyFonts(fontCfg?.uiFont ?? "", fontCfg?.monoFont ?? "");
    }, [fontCfg]);

    // 设置页提交工具别名：成功回填（SearchBox 的候选匹配随 props 即时生效）
    function patchToolAlias(p: ToolAliasPatch): Promise<boolean> {
        return patchSetting(() => api.setToolAliases(p), setToolAliases);
    }

    // 设置页保存文件夹动作（整份替换）：成功回填，SearchBox 的子菜单随之更新
    function saveFolderActions(actions: FolderAction[]): Promise<boolean> {
        return patchSetting(() => api.setFolderActions(actions), setFolderActionsData);
    }

    // ── 变更操作：成功后重拉数据并轻提示，失败统一 toast ──
    // 约定：处理器返回 Result 联合，ok=false（含 404 等业务失败）按失败处理
    const mutate = useCallback(
        async (fn: () => Promise<ApiResult<unknown>>, successMsg?: string) => {
            try {
                const r = await fn();
                if (!r.ok) throw new Error(r.error.kind);
                await refresh();
                if (successMsg) toast.success(successMsg);
            } catch {
                toast.error(t("toast.error"));
            }
        },
        [refresh, t],
    );

    // 断线自动重试：主进程与渲染进程同生命周期，此态基本只在启动瞬间出现；
    // serverOk 变回 true 时（refresh 成功）本 effect 自动停止。
    useEffect(() => {
        if (serverOk !== false) return;
        const id = setInterval(() => {
            refresh();
        }, 5000);
        return () => clearInterval(id);
    }, [serverOk, refresh]);

    // 打开/启动类失败的统一提示：missing/failed 带具体路径（launcher.ts 约定），其余通用文案
    function apiErrorToast(e: ApiError) {
        if (e.kind === "missing" || e.kind === "failed") {
            toast.error(`${t("launch.missing")}: ${e.path}`);
        } else {
            toast.error(t("toast.error"));
        }
    }

    // 打开条目防抖：同一条目 500ms 内（≈Windows 默认双击间隔）的点击视为误连点。
    // 被拦的点击同样刷新时间戳——连点期间封锁持续顺延，点多久都只开一次，
    // 停手超过 500ms 后的下一次点击才真正打开；搜索候选与 / 列表共用此入口
    const lastOpenRef = useRef<{ id: number; at: number } | null>(null);

    // ── 打开条目：书签交给系统浏览器；终端命令驱动终端执行；应用/文件走后端启动器 ──
    // 书签、应用、文件启动成功后隐藏窗口（用户决策 2026-08）：失败保留窗口让 toast 可见；
    // 终端命令开在本窗口的终端里，不藏
    async function openItem(item: Item) {
        const now = Date.now();
        const blocked = lastOpenRef.current?.id === item.id && now - lastOpenRef.current.at < 500;
        lastOpenRef.current = { id: item.id, at: now };
        if (blocked) return;
        if (item.kind === "bookmark") {
            // 主进程的 setWindowOpenHandler 把 http/https 交给系统默认浏览器
            window.open(item.target, "_blank", "noreferrer");
            window.knock.hideWindow();
            return;
        }
        if (item.kind === "command") {
            runCommand(item);
            return;
        }
        try {
            const r = await api.launch(item.id);
            if (r.ok) window.knock.hideWindow();
            else apiErrorToast(r.error);
        } catch {
            toast.error(t("toast.error"));
        }
    }

    // ── 执行终端命令条目：工作目录填了就用，没填回主目录。cwd 不存在由服务端按 missing 拒绝 ──
    function runCommand(item: Item) {
        void spawnSession({
            cwd: item.args || undefined,
            label: item.title,
            command: item.target,
            autoClose: item.autoClose,
        });
    }

    // ── 文件夹条目：在应用内终端打开该目录。不带动作 = 只开终端（终端名取文件夹名）；
    //    带动作 = 终端名「动作名 · 文件夹名」，动作的命令作为会话首条命令送入，自动关闭照动作的开关。
    //    目录不存在由 spawnSession 按 launch.missing 提示。
    //    文件夹名按终端名上限截断，ptySpawn 的 label 本身也有长度上限 ──
    function openInTerminal(item: Item, action?: FolderAction) {
        const folderPath = item.target;
        const trimmed = folderPath.replace(/[\\/]+$/, "");
        const folder = cleanTermTitle(trimmed.split(/[\\/]/).pop() || folderPath) ?? folderPath;
        void spawnSession({
            cwd: folderPath,
            label: action ? `${action.name} · ${folder}` : folder,
            command: action?.command,
            autoClose: action?.autoClose,
        });
    }

    // ── 搜索框路径直达动作（打开文件 / 前往文件夹）：同样走 openPath，报错口径与 openItem 一致 ──
    async function openLocalPath(path: string) {
        try {
            const r = await api.openPath(path);
            if (r.ok) window.knock.hideWindow();
            else apiErrorToast(r.error);
        } catch {
            toast.error(t("toast.error"));
        }
    }

    // ── 工具区：活着的工具、终端会话，以及当前显示的是哪一个（同一时间只显示一个）──
    // 这三样归这里持有；关掉 = 卸载组件（工具回初始态，终端会话结束）。
    // 有东西在显示窗口就展开，没有就收成只剩顶栏的一条。
    // termsRef 给 closeTerm 读最新值：shell 退出事件的订阅只挂一次，闭包里的状态会是旧的
    const [tools, setTools] = useState<ToolId[]>([]);
    const [terms, setTerms] = useState<Term[]>([]);
    const [shown, setShown] = useState<Shown>(null);
    // 等确认关闭的终端会话：会话一关，里面正在跑的程序就跟着没了，所以先问一句
    const [confirmTerm, setConfirmTerm] = useState<number | null>(null);
    const termsRef = useRef(terms);
    termsRef.current = terms;

    // 搜索下拉面板画进 <main>（见 SearchBox 文件头注释）：拿到节点才能 portal，所以用 state 存而不是 ref
    const [mainEl, setMainEl] = useState<HTMLElement | null>(null);

    // ── 窗口形态：报给主进程。断线提示也要占地方，算展开；
    //    收起时搜索下拉、弹窗、提示要的高度由 windowRoom 汇总（展开时主进程不看 room）──
    const expanded = shown !== null || serverOk === false;
    const room = useMaxRoom();
    useEffect(() => {
        window.knock.setLayout(expanded, expanded ? 0 : room);
    }, [expanded, room]);

    // ── 后台自动关闭工具：窗口藏起来满「存活时间」，关掉所有非终端工具（终端永不自动关）。
    //    存活时间每次隐藏时现读，设置里改了从下一次隐藏起生效；中途窗口再显示就取消计时 ──
    useEffect(() => {
        let timer: number | undefined;
        let hidden = false;
        const off = window.knock.onWindowVisible((visible) => {
            hidden = !visible;
            window.clearTimeout(timer);
            if (visible) return;
            void api.getToolIdle().then((r) => {
                // 读设置期间窗口又显示了，就不用计时了
                if (!hidden || !r.ok || r.data.minutes === 0) return;
                window.clearTimeout(timer);
                timer = window.setTimeout(() => {
                    setTools([]);
                    setShown((cur) => (cur?.kind === "tool" ? null : cur));
                }, r.data.minutes * 60_000);
            });
        });
        return () => {
            off();
            window.clearTimeout(timer);
        };
    }, []);

    // 打开工具：已开着的只切过去，没开的加进去并显示。
    // input 非空 = 带素材打开：素材落模块级 pending，组件挂载时消费 + 事件覆盖
    // 已活着的工具（双通道与时序问题见 tools/toolInput.ts）；裸开则清残留素材。
    // expertId 仅 ai 工具有意义（进入指定专家）；它与 input 相互独立，
    // 「只有专家、没有素材」同样要过注入通道，让组件收到新注入的边沿信号
    function openTool(id: ToolId, input?: string | null, expertId?: number) {
        // 终端每次都新开一个会话
        if (id === "terminal") {
            void spawnSession();
            return;
        }
        setTools((cur) => (cur.includes(id) ? cur : [...cur, id]));
        setShown({ kind: "tool", id });
        if (input != null || expertId != null) dispatchToolInput({ tool: id, text: input ?? "", expertId });
        else clearToolInput(id);
        dispatchToolFocus(id);
    }

    // 关工具：卸载组件，工具回初始态。关的正是当前显示的，窗口随之收成一条（不自动切到别的）
    const closeTool = useCallback((id: ToolId) => {
        setTools((cur) => cur.filter((x) => x !== id));
        setShown((cur) => (cur?.kind === "tool" && cur.id === id ? null : cur));
    }, []);

    // 关终端：先结束 pty 并释放 xterm 实例。用户手动关和 shell 自己退出共用；
    // 已经不在列表里的（关了之后 pty 的 exit 事件再来一次）直接忽略
    const closeTerm = useCallback((sessionId: number) => {
        if (!termsRef.current.some((x) => x.sessionId === sessionId)) return;
        void api.ptyKill(sessionId);
        disposeTerm(sessionId);
        setTerms((cur) => cur.filter((x) => x.sessionId !== sessionId));
        setShown((cur) => (cur?.kind === "term" && cur.sessionId === sessionId ? null : cur));
    }, []);

    // 终端程序用 OSC 标题改名时，菜单里跟着换名字
    const renameTerm = useCallback((sessionId: number, title: string) => {
        setTerms((cur) =>
            cur.some((x) => x.sessionId === sessionId && x.title !== title)
                ? cur.map((x) => (x.sessionId === sessionId ? { ...x, title } : x))
                : cur,
        );
    }, []);

    // 开新会话（「终端」工具行 / 终端命令条目 / 文件夹条目共用）：cwd 由调用方决定，缺省主目录；
    // 命令条目的整行命令在建好后写入执行——首屏输出由 termStore 的缓冲兜住，终端挂载后回放
    async function spawnSession(req?: { cwd?: string; label?: string; command?: string; autoClose?: boolean }) {
        const r = await api.ptySpawn(req ? { cwd: req.cwd, label: req.label } : undefined);
        if (!r.ok) {
            // 命令条目的工作目录不存在：与 App 启动失败同口径（launch.missing + 路径）
            if (r.error.kind === "missing") toast.error(`${t("launch.missing")}: ${r.error.path}`);
            else toast.error(t("toast.error"));
            return;
        }
        setTerms((cur) => [...cur, { sessionId: r.data.id, title: r.data.label }]);
        setShown({ kind: "term", sessionId: r.data.id });
        // 自动关闭：命令后面追加「成功才退出 shell」，shell 一退出，下面的 exit 事件处理就会关掉这个终端；
        // 命令失败时 shell 留着，报错还看得见。追加什么由主进程按实际 shell 给出
        if (req?.command) {
            const tail = req.autoClose ? r.data.exitSuffix : "";
            void api.ptyWrite(r.data.id, `${req.command}${tail}\r`);
        }
    }

    // shell 自己退出（exit / 进程崩溃）：关掉这个终端（closeTerm 里会释放 xterm 实例，
    // ptyKill 对已退会话是空操作）
    useEffect(() => {
        const off = onPtyEvent((e) => {
            if (e.type === "exit") closeTerm(e.id);
        });
        return off;
    }, [closeTerm]);

    // 终端字体/字号：termStore 直改实例并重排，不经过终端组件
    useEffect(() => {
        setTermFont(fontCfg?.monoFont ?? "", termCfg?.fontSize ?? 13);
    }, [fontCfg, termCfg]);

    // 工具内「打开设置」引导：分节跟随当前显示的工具（translate/ai 有缺配置态）
    function openSettingsForActiveTool() {
        const toolId = shown?.kind === "tool" ? shown.id : undefined;
        setSettings({ section: (toolId && TOOL_SETTINGS_SECTION[toolId]) || "translate" });
    }

    return (
        <TooltipProvider>
            <div className="flex h-screen flex-col overflow-hidden font-sans text-foreground">
                <Toaster position="bottom-center" />
                <ToastRoom />

                {/* 顶栏 48px（TITLEBAR_HEIGHT，主进程收成一条时窗口也是这个高度）。
                    Titlebar 根节点即 gan-drag 拖拽区：左槽（品牌）和右槽都拉满行高并改回 drag，
                    搜索井两侧的空白都能拖窗口，右槽里只有按钮组是 no-drag。
                    搜索井放中槽：左右槽定宽且相等（140px，右槽按钮组最宽约 124px），中槽吃满剩下的全部宽度（没有上限），
                    所以搜索井始终在顶栏正中，窗口拖多宽它就多宽；最窄 276px（井 260 + 内边距 16），窗口不窄于最小宽度 840 时远够用，
                    按钮也不会被挤掉。 */}
                <Titlebar
                    role="banner"
                    windowControls="none"
                    trafficLights={false}
                    className="h-[48px] flex-none [&>[data-slot=titlebar-left]]:w-[140px] [&>[data-slot=titlebar-left]]:flex-none [&>[data-slot=titlebar-left]]:self-stretch [&>[data-slot=titlebar-left]]:gan-drag [&>[data-slot=titlebar-right]]:w-[140px] [&>[data-slot=titlebar-right]]:flex-none [&>[data-slot=titlebar-right]]:self-stretch [&>[data-slot=titlebar-right]]:gan-drag [&>[data-slot=titlebar-center]]:flex-1 [&>[data-slot=titlebar-center]]:min-w-[276px]"
                    left={
                        <span className="gan-drag flex h-full flex-none select-none items-center gap-2.5">
                            <span
                                className="grid w-[17px] flex-none grid-cols-2 gap-[3px] -rotate-[8deg] text-foreground"
                                aria-hidden
                            >
                                <b className="block h-[7px] w-[7px] rounded-[2px] border-[1.5px] border-current" />
                                <b className="block h-[7px] w-[7px] rounded-[2px] border-[1.5px] border-current" />
                                <b className="block h-[7px] w-[7px] rounded-[2px] border-[1.5px] border-current" />
                                <b className="block h-[7px] w-[7px] rounded-[2px] border-[1.5px] border-current bg-current" />
                            </span>
                            {/* 中英文品牌都是 Knock，上下叠两行：11px 字、12px 行高，两行合计 24px，放得进 48px 顶栏 */}
                            <strong className="flex flex-col text-[11px] font-medium leading-3 tracking-wider">
                                <span>{t("app.brand")}</span>
                                <span>{t("app.brand")}</span>
                            </strong>
                        </span>
                    }
                    center={
                        /* 32px 搜索井：左右内边距 10px。
                           再矮会挤到素材 chip（约 20px，井上下内边距各 4px）。宽度跟中槽走（w-full） */
                        <TitlebarWell className="h-8 w-full flex-row px-2.5">
                            <SearchBox
                                items={items}
                                dirIds={dirIds}
                                light={theme === "light"}
                                // 别名未拉到（null）时按空表处理：搜索不该等设置项就绪
                                toolAliases={toolAliases ?? {}}
                                onOpenItem={openItem}
                                onOpenTool={openTool}
                                onOpenPath={openLocalPath}
                                onOpenInTerminal={openInTerminal}
                                // 没拉到（null）按空表处理：子菜单只剩固定的「在此打开终端」
                                folderActions={folderActions ?? []}
                                aliveTools={tools}
                                terms={terms}
                                shown={shown}
                                onShowTerm={(sessionId) => setShown({ kind: "term", sessionId })}
                                onCloseTool={closeTool}
                                onCloseTerm={setConfirmTerm}
                                panelHost={mainEl}
                            />
                        </TitlebarWell>
                    }
                    right={
                        <div className="gan-no-drag flex flex-none items-center gap-1">
                            {/* 收起：窗口缩成一条，工具和终端都继续活着，只是不显示（只在展开时出现） */}
                            {shown !== null && (
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon"
                                            className="size-7"
                                            onClick={() => setShown(null)}
                                            aria-label={t("btn.collapse")}
                                        >
                                            <ChevronUp className="size-4" />
                                        </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>{t("btn.collapse")}</TooltipContent>
                                </Tooltip>
                            )}
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className="size-7"
                                        active={pinned}
                                        onClick={togglePin}
                                        aria-label={t(pinned ? "btn.unpin" : "btn.pin")}
                                    >
                                        <Pin className="size-4" />
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent>{t(pinned ? "btn.unpin" : "btn.pin")}</TooltipContent>
                            </Tooltip>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    {/* 禁用按钮自身不触发 tooltip：外面包一层 span，悬停仍能命中 */}
                                    <span className="inline-flex">
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon"
                                            className="size-7"
                                            active={pinned && topmost}
                                            disabled={!pinned}
                                            onClick={toggleTopmost}
                                            aria-label={topmostLabel}
                                        >
                                            <ArrowUpToLine className="size-4" />
                                        </Button>
                                    </span>
                                </TooltipTrigger>
                                <TooltipContent>{topmostLabel}</TooltipContent>
                            </Tooltip>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className="size-7"
                                        onClick={() => setSettings({})}
                                        aria-label={t("btn.settings")}
                                    >
                                        <Settings2 className="size-4" />
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent>{t("btn.settings")}</TooltipContent>
                            </Tooltip>
                        </div>
                    }
                />

                {/* 工具区：窗口收成一条时它没有高度；搜索下拉面板 absolute 铺满它（relative 是给面板定位用的） */}
                <main ref={setMainEl} className="relative z-10 flex min-h-0 min-w-0 flex-1 flex-col bg-canvas">
                    {serverOk === false ? (
                        /* 断线态：居中提示，自动 5s 重试（这时窗口按展开算，不然这段话没地方放） */
                        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3">
                            <Marker structure="separator" variant="muted" className="max-w-[460px]">
                                {t("offline.title")}
                            </Marker>
                            <span className="max-w-[460px] text-center text-xs text-dim-foreground">
                                {t("offline.hint")}
                            </span>
                            <Button appearance="standard" variant="outline" size="sm" onClick={() => refresh()}>
                                {t("offline.retry")}
                            </Button>
                        </div>
                    ) : (
                        <ToolArea
                            tools={tools}
                            terms={terms}
                            shown={shown}
                            onTermTitle={renameTerm}
                            onOpenSettings={openSettingsForActiveTool}
                        />
                    )}
                </main>

                {/* ── 弹窗区 ── */}
                <SettingsDialog
                    open={settings !== null}
                    initialSection={settings?.section}
                    onClose={() => setSettings(null)}
                    lang={lang}
                    onChangeLang={setLang}
                    platform={platform}
                    theme={theme}
                    onTheme={switchTheme}
                    termCfg={termCfg}
                    onTermPatch={patchTerm}
                    fontCfg={fontCfg}
                    onFontPatch={patchFont}
                    toolAliases={toolAliases}
                    onToolAlias={patchToolAlias}
                    items={items}
                    dirIds={dirIds}
                    onAddItem={() => setItemDialog({ kind: "create" })}
                    onEditItem={(item) => setItemDialog({ kind: "edit", item })}
                    onDeleteItem={(item) => setItemDialog({ kind: "delete", item })}
                    folderActions={folderActions}
                    onSaveFolderActions={saveFolderActions}
                />

                {/* 条目弹窗放在设置页之后：从设置页的「快速启动」分节打开时叠在它上面 */}
                <ItemDialog
                    open={itemDialog.kind === "create" || itemDialog.kind === "edit"}
                    item={itemDialog.kind === "edit" ? itemDialog.item : null}
                    platform={platform}
                    light={theme === "light"}
                    onClose={() => setItemDialog({ kind: "none" })}
                    onSubmit={
                        itemDialog.kind === "edit"
                            ? (values: ItemFormValues) =>
                                  mutate(() => api.updateItem(itemDialog.item.id, values), t("toast.saved"))
                            : (values: ItemFormValues) => mutate(() => api.createItem(values), t("toast.saved"))
                    }
                />

                <ConfirmDialog
                    open={itemDialog.kind === "delete"}
                    title={itemDialog.kind === "delete" ? `${t("menu.delete")}:${itemDialog.item.title}` : ""}
                    onClose={() => setItemDialog({ kind: "none" })}
                    onConfirm={async () => {
                        if (itemDialog.kind === "delete") {
                            await mutate(() => api.deleteItem(itemDialog.item.id), t("toast.deleted"));
                        }
                    }}
                />

                {/* 关终端前先确认：会话一关，里面正在跑的程序就没了 */}
                <ConfirmDialog
                    open={confirmTerm !== null}
                    title={t("term.closeConfirm")}
                    description={t("term.closeConfirmHint")}
                    confirmLabel={t("common.close")}
                    onClose={() => setConfirmTerm(null)}
                    onConfirm={async () => {
                        if (confirmTerm !== null) closeTerm(confirmTerm);
                    }}
                />
            </div>
        </TooltipProvider>
    );
}
