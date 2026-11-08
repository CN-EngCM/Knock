import { useCallback, Dispatch, useEffect, useRef, SetStateAction, useState } from "react";
import { toast } from "sonner";
import { ArrowUpToLine, Pin, Plus, Settings2 } from "lucide-react";
import {
    api,
    onPtyEvent,
    type ApiError,
    type ApiResult,
    type FontPatch,
    type Item,
    type TermPatch,
    type ThemeId,
    type ToolAliasPatch,
} from "./api/client";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Marker } from "@/components/ui/marker";
import { Toaster } from "@/components/ui/sonner";
import { Titlebar, TitlebarWell } from "@/components/ui/titlebar";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { LauncherList } from "./components/LauncherList";
import { SearchBox } from "./components/SearchBox";
import { ToolsMenu } from "./components/ToolsMenu";
import { ToolTabs, termTabKey, toolTabKey, type Tab } from "./components/ToolTabs";
import { RAIL_WIDTH, SidebarResizer, loadSidebar } from "./components/SidebarResizer";
import { cn } from "@/lib/utils";
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

// 全部弹窗收敛为一个可辨识联合（discriminated union）：
// 用 kind 字段区分形态，switch 后每个分支的 payload 类型自动收窄。
type DialogState =
    | { kind: "none" }
    | { kind: "item-create" }
    | { kind: "item-edit"; item: Item }
    | { kind: "item-delete"; item: Item }
    // section：设置页打开时直接定位的分节（工具内「打开设置」引导用；缺省回基础设置）
    | { kind: "settings"; section?: SectionId };

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
    // 右键菜单据此决定要不要显示「在此打开终端」
    const [dirIds, setDirIds] = useState<ReadonlySet<number>>(() => new Set());
    const [dialog, setDialog] = useState<DialogState>({ kind: "none" });
    // 侧栏：宽度（最后一次完整侧栏的）+ 是否收成只有图标的窄条，拖拽与持久化都在 SidebarResizer
    const [sidebar, setSidebar] = useState(loadSidebar);
    const sidebarCollapsed = sidebar.collapsed;
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
        window.knock.onOpenSettings(() => setDialog({ kind: "settings" }));
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
    // 停手超过 500ms 后的下一次点击才真正打开；侧栏与搜索候选共用此入口
    const lastOpenRef = useRef<{ id: number; at: number } | null>(null);

    // ── 打开条目：书签交给系统浏览器；终端命令驱动终端执行；应用/文件走后端启动器 ──
    // 书签、应用、文件启动成功后隐藏窗口（用户决策 2026-08）：失败保留窗口让 toast 可见；
    // 终端命令开在本窗口的标签里，不藏
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

    // ── 文件夹条目：在应用内终端打开该目录（标签名取文件夹名），opencode / claude
    //    作为会话首条命令送入。目录不存在由 spawnSession 按 launch.missing 提示。
    //    名字按标签上限截断，ptySpawn 的 label 本身也有长度上限 ──
    function openInTerminal(item: Item, command?: "opencode" | "claude") {
        const folderPath = item.target;
        const trimmed = folderPath.replace(/[\\/]+$/, "");
        const folder = cleanTermTitle(trimmed.split(/[\\/]/).pop() || folderPath) ?? folderPath;
        void spawnSession({ cwd: folderPath, label: command ? `${command} · ${folder}` : folder, command });
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

    // 「/」随时聚焦搜索框
    useEffect(() => {
        function onWindowKeyDown(e: KeyboardEvent) {
            if (e.key !== "/" || e.ctrlKey || e.altKey || e.metaKey) return;
            const el = e.target as HTMLElement;
            if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable) return;
            e.preventDefault();
            document.getElementById("search")?.focus();
        }
        window.addEventListener("keydown", onWindowKeyDown);
        return () => window.removeEventListener("keydown", onWindowKeyDown);
    }, []);

    // ── 标签：工具和终端会话是同一排里并列的页，按打开顺序排 ──
    // 标签列表与激活项归这里持有；关闭标签 = 卸载组件（工具回初始态，终端会话结束）。
    // tabsRef / activeRef 给 closeTab 读最新值：shell 退出事件的订阅只挂一次，闭包里的状态会是旧的
    const [tabs, setTabs] = useState<Tab[]>([]);
    const [activeKey, setActiveKey] = useState<string | null>(null);
    const tabsRef = useRef(tabs);
    tabsRef.current = tabs;
    const activeRef = useRef(activeKey);
    activeRef.current = activeKey;

    // 打开工具：已开着的只切过去，没开的加到最后。
    // input 非空 = 带素材打开：素材落模块级 pending，组件挂载时消费 + 事件覆盖
    // 已开着的标签（双通道与时序问题见 tools/toolInput.ts）；裸开则清残留素材。
    // expertId 仅 ai 工具有意义（进入指定专家）；它与 input 相互独立，
    // 「只有专家、没有素材」同样要过注入通道，让组件收到新注入的边沿信号
    function openTool(id: ToolId, input?: string | null, expertId?: number) {
        // 终端每次都新开一个会话
        if (id === "terminal") {
            void spawnSession();
            return;
        }
        const key = toolTabKey(id);
        setTabs((cur) => (cur.some((tab) => tab.key === key) ? cur : [...cur, { key, kind: "tool", toolId: id }]));
        setActiveKey(key);
        if (input != null || expertId != null) dispatchToolInput({ tool: id, text: input ?? "", expertId });
        else clearToolInput(id);
        dispatchToolFocus(id);
    }

    // 关标签：终端要先结束 pty 并释放 xterm 实例；关的是当前标签才换，优先右邻、再左邻，都没有回首页
    const closeTab = useCallback((key: string) => {
        const cur = tabsRef.current;
        const index = cur.findIndex((tab) => tab.key === key);
        if (index < 0) return;
        const closing = cur[index];
        if (closing.kind === "term") {
            void api.ptyKill(closing.sessionId);
            disposeTerm(closing.sessionId);
        }
        const next = cur.filter((tab) => tab.key !== key);
        setTabs(next);
        if (activeRef.current === key) setActiveKey((next[index] ?? next[index - 1])?.key ?? null);
    }, []);

    // 终端程序用 OSC 标题改名时，跟着换标签名
    const renameTermTab = useCallback((sessionId: number, title: string) => {
        setTabs((cur) =>
            cur.some((tab) => tab.kind === "term" && tab.sessionId === sessionId && tab.title !== title)
                ? cur.map((tab) => (tab.kind === "term" && tab.sessionId === sessionId ? { ...tab, title } : tab))
                : cur,
        );
    }, []);

    // 开新会话（工具菜单 / 终端命令条目 / 文件夹条目共用）：cwd 由调用方决定，缺省主目录；
    // 命令条目的整行命令在建好后写入执行——首屏输出由 termStore 的缓冲兜住，标签挂载后回放
    async function spawnSession(req?: { cwd?: string; label?: string; command?: string; autoClose?: boolean }) {
        const r = await api.ptySpawn(req ? { cwd: req.cwd, label: req.label } : undefined);
        if (!r.ok) {
            // 命令条目的工作目录不存在：与 App 启动失败同口径（launch.missing + 路径）
            if (r.error.kind === "missing") toast.error(`${t("launch.missing")}: ${r.error.path}`);
            else toast.error(t("toast.error"));
            return;
        }
        const key = termTabKey(r.data.id);
        setTabs((cur) => [...cur, { key, kind: "term", sessionId: r.data.id, title: r.data.label }]);
        setActiveKey(key);
        // 自动关闭：命令后面追加「成功才退出 shell」，shell 一退出，下面的 exit 事件处理就会关掉标签；
        // 命令失败时 shell 留着，报错还看得见。追加什么由主进程按实际 shell 给出
        if (req?.command) {
            const tail = req.autoClose ? r.data.exitSuffix : "";
            void api.ptyWrite(r.data.id, `${req.command}${tail}\r`);
        }
    }

    // shell 自己退出（exit / 进程崩溃）：关掉它的标签（closeTab 里会释放 xterm 实例，
    // ptyKill 对已退会话是空操作）
    useEffect(() => {
        const off = onPtyEvent((e) => {
            if (e.type === "exit") closeTab(termTabKey(e.id));
        });
        return off;
    }, [closeTab]);

    // 终端字体/字号：termStore 直改实例并重排，不经过标签组件
    useEffect(() => {
        setTermFont(fontCfg?.monoFont ?? "", termCfg?.fontSize ?? 13);
    }, [fontCfg, termCfg]);

    // 工具内「打开设置」引导：分节跟随当前标签里的工具（translate/ai 有缺配置态）
    function openSettingsForActiveTool() {
        const active = tabs.find((tab) => tab.key === activeKey);
        const toolId = active?.kind === "tool" ? active.toolId : undefined;
        setDialog({ kind: "settings", section: (toolId && TOOL_SETTINGS_SECTION[toolId]) || "translate" });
    }

    return (
        <TooltipProvider>
            <div className="flex h-screen flex-col overflow-hidden font-sans text-foreground">
                <Toaster position="bottom-center" />

                {/* Titlebar 根节点即 gan-drag 拖拽区；搜索井、右侧按钮在 no-drag 里。
                    品牌、搜索井、空白全放进左槽，左槽吃满剩余宽度（flex-1）、拉满行高并改回 drag，
                    搜索井右边的空白就是拖窗口的地方；右槽只放四个固定按钮。
                    中槽不用（hidden），否则它的内边距和间距会白占位置；
                    overflow-visible 让搜索下拉能悬出 40px 顶栏。 */}
                <Titlebar
                    role="banner"
                    windowControls="none"
                    trafficLights={false}
                    className="z-20 h-[40px] flex-none overflow-visible [&>[data-slot=titlebar-left]]:self-stretch [&>[data-slot=titlebar-left]]:gan-drag [&>[data-slot=titlebar-right]]:flex-none [&>[data-slot=titlebar-center]]:hidden"
                    left={
                        <>
                            {/* mr-3 在左槽统一的 8px 间距上再加 12px，品牌与搜索井拉开到 20px */}
                            <span className="gan-drag mr-3 flex h-full flex-none select-none items-center gap-2.5">
                                <span
                                    className="grid w-[17px] flex-none grid-cols-2 gap-[3px] -rotate-[8deg] text-foreground"
                                    aria-hidden
                                >
                                    <b className="block h-[7px] w-[7px] rounded-[2px] border-[1.5px] border-current" />
                                    <b className="block h-[7px] w-[7px] rounded-[2px] border-[1.5px] border-current" />
                                    <b className="block h-[7px] w-[7px] rounded-[2px] border-[1.5px] border-current" />
                                    <b className="block h-[7px] w-[7px] rounded-[2px] border-[1.5px] border-current bg-current" />
                                </span>
                                {/* 中英文品牌都是 Knock，上下叠两行：11px 字、12px 行高，两行合计 24px，放得进 40px 顶栏 */}
                                <strong className="flex flex-col text-[11px] font-medium leading-3 tracking-wider">
                                    <span>{t("app.brand")}</span>
                                    <span>{t("app.brand")}</span>
                                </strong>
                            </span>
                            {/* 28px 搜索井：relative 供 SearchBox 下拉定位，左右内边距与原搜索井一致（10px）。
                            再矮会挤到素材 chip（约 20px，井上下内边距各 4px）。
                            期望宽 540px、最窄 260px */}
                            <TitlebarWell className="relative h-[28px] w-[540px] min-w-[260px] shrink-[1000] flex-row px-2.5 overflow-visible">
                                <SearchBox
                                    items={items}
                                    dirIds={dirIds}
                                    light={theme === "light"}
                                    // 别名未拉到（null）时按空表处理：搜索不该等设置项就绪
                                    toolAliases={toolAliases ?? {}}
                                    onOpenItem={openItem}
                                    onOpenTool={openTool}
                                    onOpenPath={openLocalPath}
                                />
                            </TitlebarWell>
                            {/* 弹性空白：同时是拖窗口的地方 */}
                            <div className="gan-drag min-w-0 flex-1 self-stretch" />
                        </>
                    }
                    right={
                        <div className="flex flex-none items-center gap-1">
                            <ToolsMenu
                                openTools={tabs.flatMap((tab) => (tab.kind === "tool" ? [tab.toolId] : []))}
                                onOpen={openTool}
                            />
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
                                        onClick={() => setDialog({ kind: "settings" })}
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

                {/* 左侧快捷启动 + 右侧标签区 */}
                <div className="relative z-10 flex min-h-0 flex-1">
                    {/* 宽度可拖拽并记住，往左拖到头会收成只有图标的窄条（RAIL_WIDTH）。
                        max-w-[40%] 是窗口变窄时完整侧栏的上限，与 SidebarResizer 里的比例是同一个数。
                        relative z-10：让右边缘那条看不见的拖拽区（SidebarResizer，探出 2px 到右侧区域上）盖在它之上 */}
                    <aside
                        className="app-no-drag relative z-10 flex min-h-0 max-w-[40%] flex-none flex-col bg-background"
                        style={{ width: sidebarCollapsed ? RAIL_WIDTH : sidebar.width }}
                    >
                        <SidebarResizer state={sidebar} onChange={setSidebar} />

                        {/* 标题行高 32px（含底边线）。图标条里没有地方放字：去掉标题，「＋」居中留着，新建入口不能丢 */}
                        <div
                            className={cn(
                                "flex h-8 flex-none items-center border-b border-line",
                                sidebarCollapsed ? "justify-center" : "justify-between pr-2 pl-4",
                            )}
                        >
                            {!sidebarCollapsed && <span className="text-xs font-medium">{t("side.title")}</span>}
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="size-7"
                                onClick={() => setDialog({ kind: "item-create" })}
                                title={t("side.addItem")}
                                aria-label={t("side.addItem")}
                            >
                                <Plus className="size-3.5" />
                            </Button>
                        </div>

                        {/* 滚动与内边距都归列表自管（行高 26 需要整行统一的滚动容器） */}
                        <div className="min-h-0 flex-1">
                            {items.length === 0 ? (
                                /* 冷启动空态：引导只占左栏，右侧工具与终端不受影响；
                                   图标条里这段话塞不下，不显示，只剩上面的「＋」 */
                                !sidebarCollapsed && (
                                    <Empty className="px-3 py-8">
                                        <EmptyHeader>
                                            <EmptyTitle>{t("side.empty")}</EmptyTitle>
                                            <EmptyDescription>{t("side.emptyHint")}</EmptyDescription>
                                        </EmptyHeader>
                                    </Empty>
                                )
                            ) : (
                                <LauncherList
                                    collapsed={sidebarCollapsed}
                                    items={items}
                                    dirIds={dirIds}
                                    light={theme === "light"}
                                    onOpenInTerminal={openInTerminal}
                                    onOpen={openItem}
                                    onEditItem={(item) => setDialog({ kind: "item-edit", item })}
                                    onDeleteItem={(item) => setDialog({ kind: "item-delete", item })}
                                />
                            )}
                        </div>
                    </aside>

                    {/* 右侧区域没有外圈描边：和侧栏的分界靠底色深浅（bg-background 对 bg-canvas） */}
                    <main className="relative flex min-w-0 flex-1 flex-col bg-canvas">
                        {serverOk === false ? (
                            /* 断线态：右列居中提示（左栏保留已拉到的数据），自动 5s 重试 */
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
                            <ToolTabs
                                tabs={tabs}
                                activeKey={activeKey}
                                onActivate={setActiveKey}
                                onClose={closeTab}
                                onTermTitle={renameTermTab}
                                onOpenTool={openTool}
                                onOpenSettings={openSettingsForActiveTool}
                            />
                        )}
                    </main>
                </div>

                {/* ── 弹窗区 ── */}
                <ItemDialog
                    open={dialog.kind === "item-create" || dialog.kind === "item-edit"}
                    item={dialog.kind === "item-edit" ? dialog.item : null}
                    platform={platform}
                    light={theme === "light"}
                    onClose={() => setDialog({ kind: "none" })}
                    onSubmit={
                        dialog.kind === "item-edit"
                            ? (values: ItemFormValues) =>
                                  mutate(() => api.updateItem(dialog.item.id, values), t("toast.saved"))
                            : (values: ItemFormValues) => mutate(() => api.createItem(values), t("toast.saved"))
                    }
                />

                <SettingsDialog
                    open={dialog.kind === "settings"}
                    initialSection={dialog.kind === "settings" ? dialog.section : undefined}
                    onClose={() => setDialog({ kind: "none" })}
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
                />

                <ConfirmDialog
                    open={dialog.kind === "item-delete"}
                    title={dialog.kind === "item-delete" ? `${t("menu.delete")}:${dialog.item.title}` : ""}
                    onClose={() => setDialog({ kind: "none" })}
                    onConfirm={async () => {
                        if (dialog.kind === "item-delete") {
                            await mutate(() => api.deleteItem(dialog.item.id), t("toast.deleted"));
                        }
                    }}
                />
            </div>
        </TooltipProvider>
    );
}
