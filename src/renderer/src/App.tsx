import { Suspense, lazy, useCallback, Dispatch, useEffect, useRef, SetStateAction, useState } from "react";
import { toast } from "sonner";
import { ArrowUpDown, Moon, PanelLeft, Pin, PinOff, Plus, Settings2, Sun } from "lucide-react";
import {
    api,
    onPtyEvent,
    type ApiError,
    type ApiResult,
    type AiModelConfig,
    type FontPatch,
    type Group,
    type Item,
    type TermPatch,
    type ThemeId,
    type ToolAliasPatch,
    type TranslateConfigPatch,
} from "./api/client";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Marker } from "@/components/ui/marker";
import { MenuTrigger, MenuContent, MenuItem } from "@/components/ui/menu";
import { Spinner } from "@/components/ui/spinner";
import { Toaster } from "@/components/ui/sonner";
import { Titlebar, TitlebarWell } from "@/components/ui/titlebar";
import { Toggle } from "@/components/ui/toggle";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { LauncherTree, type ItemMove } from "./components/LauncherTree";
import { SearchBox } from "./components/SearchBox";
import { ToolHome } from "./components/ToolHome";
import { disposeTerm, setTermFont } from "./components/termStore";
import type { DockviewApi } from "@/components/ui/dock-layout";
import { toolMeta, type ToolId } from "./tools/registry";
import { clearToolInput, dispatchToolInput } from "./tools/toolInput";
import { ItemDialog, type ItemFormValues } from "./components/dialogs/ItemDialog";
import { GroupDialog } from "./components/dialogs/GroupDialog";
import { ConfirmDialog } from "./components/dialogs/ConfirmDialog";
import { ImportDialog } from "./components/dialogs/ImportDialog";
import { SettingsDialog, type SectionId } from "./components/dialogs/SettingsDialog";
import { applyFonts } from "./lib/fonts";
import { applyTheme, currentTheme } from "./lib/theme";
import { useI18n } from "./i18n/useI18n";

// 工具区停靠容器懒加载：dockview 与面板组件都不进首屏 chunk；
// 空态（从未开过面板）直接渲染 ToolHome，不挂 dock
const DockZone = lazy(() => import("./components/DockZone").then((m) => ({ default: m.DockZone })));

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
    | { kind: "group-create" }
    | { kind: "group-rename"; group: Group }
    | { kind: "group-delete"; group: Group }
    | { kind: "item-create"; groupId: number }
    | { kind: "item-edit"; item: Item }
    | { kind: "item-delete"; item: Item }
    | { kind: "import" }
    // section：设置页打开时直接定位的分节（工具内「打开设置」引导用；缺省回基础设置）
    | { kind: "settings"; section?: SectionId };

// ── 布局状态：启动列表显隐 ──
// 与界面语言一样存 localStorage——布局偏好属于本机个人设置，不进 SQLite。
type Layout = {
    sidebarVisible: boolean;
};

function loadLayout(): Layout {
    const fallback: Layout = { sidebarVisible: true };
    try {
        const raw = localStorage.getItem("mypage-layout");
        if (!raw) return fallback;
        const s = JSON.parse(raw) as Partial<Layout>;
        return {
            sidebarVisible: s.sidebarVisible !== false,
        };
    } catch {
        return fallback;
    }
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
    const [groups, setGroups] = useState<Group[]>([]);
    const [items, setItems] = useState<Item[]>([]);
    const [dialog, setDialog] = useState<DialogState>({ kind: "none" });
    const [platform, setPlatform] = useState("");
    const [layout, setLayout] = useState<Layout>(loadLayout);
    // 排序模式：开启才显示启动列表的拖拽把手（运行时状态，不持久化，默认关）
    const [sortMode, setSortMode] = useState(false);
    // 界面主题：初始值来自 main.tsx 首帧前套好的 <html> 类；切换经 settings 表持久化
    const [theme, setTheme] = useState<ThemeId>(currentTheme);
    // 工具区停靠容器：首次打开面板时挂载（懒加载 dockview），此后常驻——面板清空
    // 由 dock 空态水印（ToolHome）兜底。已开面板与布局是纯运行时状态，不落盘不还原（用户决策）
    const [dockWanted, setDockWanted] = useState(false);
    // dock 命令桥：面板开/关/激活都走 dockview api；DockZone 懒加载就绪前的调用排队，onReady 冲刷
    const dockCtl = useRef<{ api: DockviewApi | null; queue: Array<(api: DockviewApi) => void> }>({
        api: null,
        queue: [],
    });
    // 终端设置（shell/字号）：字号喂 termStore（xterm 实例表），设置页改这里再落库
    const [termCfg, setTermCfg] = useRpcValue(api.getTermConfig);
    // 字体设置（界面/等宽）：applyFonts 写 CSS 变量全局生效；等宽栈同步喂 termStore
    const [fontCfg, setFontCfg] = useRpcValue(api.getFontConfig);

    // 启动列表显隐变化后保存，下次启动沿用。
    useEffect(() => {
        try {
            localStorage.setItem("mypage-layout", JSON.stringify(layout));
        } catch {
            /* 忽略存储失败 */
        }
    }, [layout]);

    // 全量拉取：个人工具规模下最简单的数据同步方式（每次变更后重拉）
    const refresh = useCallback(async () => {
        try {
            const r = await api.getData();
            if (!r.ok) throw new Error(r.error.kind);
            setGroups(r.data.groups);
            setItems(r.data.items);
            setServerOk(true);
        } catch {
            setServerOk(false);
        }
    }, []);

    // 托盘菜单「设置」→ 唤起窗口的同时打开设置对话框（preload 转发的主进程事件）
    useEffect(() => {
        window.knock.onOpenSettings(() => setDialog({ kind: "settings" }));
    }, []);

    // ── 钉住：豁免「失焦自动隐藏」（挂终端/对照工作的场景）──
    // 渲染端只管展示与切换，隐藏判定在主进程（src/main/index.ts 的 blur 处理）；
    // 呼出事件即「新一轮会话」：与主进程的隐藏清钉对齐，双方各自重置为未钉
    const [pinned, setPinned] = useState(false);
    useEffect(() => window.knock.onFocusSearch(() => setPinned(false)), []);
    const togglePin = useCallback(() => {
        setPinned((p) => {
            window.knock.setPinned(!p);
            return !p;
        });
    }, []);

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

    // 剪贴板素材时限（主进程每次呼出直接读库，这里的值只喂设置页展示）
    const [clipPaste, setClipPaste] = useRpcValue(api.getClipPaste);
    const clipSec = clipPaste?.seconds ?? null;

    // 翻译密钥（有道）：只喂设置页编辑态；翻译请求由主进程现读库，不经这里
    const [translateCfg, setTranslateCfg] = useRpcValue(api.getTranslateConfig);

    // AI 模型配置（整表）：设置页编辑态 + 工具内「有无可配模型」判断均来自这里；
    // 对话请求由主进程现读库，不经这里
    const [aiModels, setAiModels] = useRpcValue(api.getAiModels);

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

    // 设置页提交剪贴板时限（秒）
    function patchClipSec(s: number): Promise<boolean> {
        return patchSetting(
            () => api.setClipPaste(s),
            (d) => setClipPaste(d),
        );
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

    // 设置页提交翻译密钥：成功回填编辑态
    function patchTranslate(p: TranslateConfigPatch): Promise<boolean> {
        return patchSetting(() => api.setTranslateConfig(p), setTranslateCfg);
    }

    // 设置页提交 AI 模型配置（整表替换）：成功回填；对话/测试请求由主进程现读库即生效
    function patchAiModels(list: AiModelConfig[]): Promise<boolean> {
        return patchSetting(
            () => api.setAiModels(list),
            () => setAiModels(list),
        );
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

    // ── 拖拽排序（乐观更新：先改本地，再落库，失败回滚重拉）──
    function reorderGroups(next: Group[]) {
        setGroups(next);
        api.reorder({ groups: next.map((g) => g.id) }).then((r) => {
            if (!r.ok) {
                toast.error(t("toast.error"));
                refresh();
            }
        });
    }

    // 条目拖拽落库：跨组移动一次牵动两个组，affected 按组给全序列
    function reorderItemGroups(affected: ItemMove) {
        const touched = new Set(affected.map((a) => a.groupId));
        setItems((prev) => [
            ...prev.filter((i) => !touched.has(i.group_id)),
            ...affected.flatMap((a) =>
                a.items.map((item, index) => ({ ...item, group_id: a.groupId, position: index })),
            ),
        ]);
        api.reorder({ items: affected.flatMap((a) => a.items.map((i) => ({ id: i.id, group_id: a.groupId }))) }).then(
            (r) => {
                if (!r.ok) {
                    toast.error(t("toast.error"));
                    refresh();
                }
            },
        );
    }

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

    // ── 打开条目：书签前端直开；终端命令驱动终端执行；应用/文件走后端启动器 ──
    // 启动成功后隐藏窗口（用户决策 2026-08）：失败保留窗口让 toast 可见；
    // 书签是 fire-and-forget 拿不到失败信号，打开即藏；终端命令就在本窗口里执行，不藏
    async function openItem(item: Item) {
        const now = Date.now();
        const blocked = lastOpenRef.current?.id === item.id && now - lastOpenRef.current.at < 500;
        lastOpenRef.current = { id: item.id, at: now };
        if (blocked) return;
        if (item.kind === "bookmark") {
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

    // ── 执行终端命令条目：新开会话（cwd/label 来自条目），建好后整行命令送入执行。
    //    cwd 不存在由服务端按 missing 拒绝（spawnSession 里 toast 同启动失败口径）
    function runCommand(item: Item) {
        void spawnSession({ cwd: item.args ?? undefined, label: item.title, command: item.target });
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

    // ── 工具生命周期：激活权威是 dockview——已开的面板 setActive，未开 addPanel ──
    //（默认进当前激活组）；关闭走面板 × / 右键菜单，App 只订阅面板移除做善后。
    // input 非空 = 带素材打开：素材落模块级 pending，组件挂载时消费 + 事件覆盖
    // 已开的面板（双通道与时序问题见 tools/toolInput.ts）；裸开则清残留素材。
    // expertId 仅 ai 工具有意义（进入指定专家）；它与 input 相互独立，
    // 「只有专家、没有素材」同样要过注入通道，让组件收到新注入的边沿信号
    function whenDockApi(fn: (dock: DockviewApi) => void) {
        const ctl = dockCtl.current;
        if (ctl.api) fn(ctl.api);
        else ctl.queue.push(fn);
    }

    function openTool(id: ToolId, input?: string | null, expertId?: number) {
        if (id === "terminal") {
            void spawnSession();
            return;
        }
        setDockWanted(true);
        whenDockApi((dock) => {
            const panel = dock.getPanel(`tool:${id}`);
            if (panel) panel.api.setActive();
            else
                dock.addPanel({
                    id: `tool:${id}`,
                    component: "tool",
                    title: t(toolMeta(id).nameKey),
                    params: { toolId: id },
                });
        });
        if (input != null || expertId != null) dispatchToolInput({ tool: id, text: input ?? "", expertId });
        else clearToolInput(id);
    }

    // ── 终端会话生命周期：每个会话一块 dock 面板（term:<会话号>）──

    // 开新会话（工具菜单 / 终端命令条目共用）：命令条目带 cwd/label/整行命令，
    // 会话建好即写入执行——首屏输出由 termStore 的缓冲兜住，面板挂载后回放
    async function spawnSession(req?: { cwd?: string; label?: string; command?: string }) {
        const r = await api.ptySpawn(req ? { cwd: req.cwd, label: req.label } : undefined);
        if (!r.ok) {
            // 命令条目的工作目录不存在：与 App 启动失败同口径（launch.missing + 路径）
            if (r.error.kind === "missing") toast.error(`${t("launch.missing")}: ${r.error.path}`);
            else toast.error(t("toast.error"));
            return;
        }
        setDockWanted(true);
        whenDockApi((dock) => {
            dock.addPanel({
                id: `term:${r.data.id}`,
                component: "term",
                title: r.data.label,
                params: { sessionId: r.data.id },
            });
        });
        if (req?.command) void api.ptyWrite(r.data.id, `${req.command}\r`);
    }

    // dock 就绪：冲刷排队命令；面板移除善后（终端面板 = 结束 pty + 释放 xterm 实例，
    // 工具面板组件自卸载无需善后）
    const handleDockReady = useCallback((dock: DockviewApi) => {
        const ctl = dockCtl.current;
        ctl.api = dock;
        ctl.queue.splice(0).forEach((fn) => fn(dock));
        dock.onDidRemovePanel((panel) => {
            if (!panel.id.startsWith("term:")) return;
            const id = Number(panel.id.slice(5));
            void api.ptyKill(id);
            disposeTerm(id);
        });
    }, []);

    // shell 自己退出（exit / 进程崩溃）：先释放 xterm 实例再关面板（触发上面的
    // 移除善后；ptyKill 对已退会话是空操作）
    useEffect(() => {
        const off = onPtyEvent((e) => {
            if (e.type !== "exit") return;
            disposeTerm(e.id);
            whenDockApi((dock) => dock.getPanel(`term:${e.id}`)?.api.close());
        });
        return off;
    }, []);

    // 界面语言切换：工具面板标题跟着换（终端标题是会话标签，非本地化文案）
    useEffect(() => {
        whenDockApi((dock) => {
            for (const panel of dock.panels) {
                if (!panel.id.startsWith("tool:")) continue;
                panel.api.setTitle(t(toolMeta(panel.id.slice(5) as ToolId).nameKey));
            }
        });
        // whenDockApi 读 ref，无需进依赖
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [lang, t]);

    // 终端字体/字号：termStore 直改实例并重排，不经过面板 props
    useEffect(() => {
        setTermFont(fontCfg?.monoFont ?? "", termCfg?.fontSize ?? 13);
    }, [fontCfg, termCfg]);

    // dock chunk 闲时预取：首个面板打开不用现等 dockview 下载
    useEffect(() => {
        const id = requestIdleCallback(() => void import("./components/DockZone"));
        return () => cancelIdleCallback(id);
    }, []);

    // 工具内「打开设置」引导：分节跟随当前激活的工具面板（translate/ai 有缺配置态）
    function openSettingsForActiveTool() {
        const active = dockCtl.current.api?.activePanel?.id;
        const toolId = active?.startsWith("tool:") ? (active.slice(5) as ToolId) : undefined;
        setDialog({ kind: "settings", section: (toolId && TOOL_SETTINGS_SECTION[toolId]) || "translate" });
    }

    return (
        <TooltipProvider>
            <div className="flex h-screen flex-col overflow-hidden font-sans text-foreground">
                <Toaster position="bottom-center" />

                {/* Titlebar 根节点即 gan-drag 拖拽区；搜索井、右侧按钮在 no-drag 插槽内。
                    左槽单独改回 drag 并拉满行高，保住原「品牌区可拖窗」的手感；
                    overflow-visible 让搜索下拉能悬出 61px 顶栏。 */}
                <Titlebar
                    role="banner"
                    windowControls="none"
                    trafficLights={false}
                    className="z-20 h-[61px] flex-none overflow-visible [&>[data-slot=titlebar-left]]:flex-none [&>[data-slot=titlebar-left]]:self-stretch [&>[data-slot=titlebar-left]]:gan-drag [&>[data-slot=titlebar-right]]:flex-none [&>[data-slot=titlebar-center]]:flex-1"
                    left={
                        <span className="gan-drag flex h-full w-[178px] flex-none select-none items-center gap-2.5 pr-2">
                            <span
                                className="grid w-[17px] flex-none grid-cols-2 gap-[3px] -rotate-[8deg] text-foreground"
                                aria-hidden
                            >
                                <b className="block h-[7px] w-[7px] rounded-[2px] border-[1.5px] border-current" />
                                <b className="block h-[7px] w-[7px] rounded-[2px] border-[1.5px] border-current" />
                                <b className="block h-[7px] w-[7px] rounded-[2px] border-[1.5px] border-current" />
                                <b className="block h-[7px] w-[7px] rounded-[2px] border-[1.5px] border-current bg-current" />
                            </span>
                            <strong className="text-base font-medium tracking-wider">敲敲</strong>
                            <span className="text-[11px] tracking-wide text-dim-foreground">Knock</span>
                        </span>
                    }
                    center={
                        /* 34px 搜索井：relative 供 SearchBox 下拉定位，左右内边距与原搜索井一致（10px） */
                        <TitlebarWell className="relative h-[34px] flex-row px-2.5 overflow-visible">
                            <SearchBox
                                groups={groups}
                                items={items}
                                // 别名未拉到（null）时按空表处理：搜索不该等设置项就绪
                                toolAliases={toolAliases ?? {}}
                                onOpenItem={openItem}
                                onOpenTool={openTool}
                                onOpenPath={openLocalPath}
                            />
                        </TitlebarWell>
                    }
                    right={
                        <div className="flex flex-none items-center gap-1">
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
                                        {pinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent>{t(pinned ? "btn.unpin" : "btn.pin")}</TooltipContent>
                            </Tooltip>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className="size-7"
                                        active={layout.sidebarVisible}
                                        onClick={() => setLayout((l) => ({ ...l, sidebarVisible: !l.sidebarVisible }))}
                                        aria-label={t("btn.sidebar")}
                                    >
                                        <PanelLeft className="size-4" />
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent>{t("btn.sidebar")}</TooltipContent>
                            </Tooltip>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className="size-7"
                                        onClick={() => void switchTheme(theme === "dark" ? "light" : "dark")}
                                        aria-label={t("btn.theme")}
                                    >
                                        {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent>{t("btn.theme")}</TooltipContent>
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

                {/* 两区工作区 */}
                <div className="relative z-10 flex min-h-0 flex-1">
                    {layout.sidebarVisible && (
                        <aside className="app-no-drag flex min-h-0 w-[246px] flex-none flex-col border-r border-well bg-background">
                            <div className="flex h-[43px] flex-none items-center justify-between border-b border-line pr-2 pl-4">
                                <span className="text-xs font-medium">{t("side.title")}</span>
                                <div className="flex items-center gap-1">
                                    <Toggle
                                        variant="outline"
                                        className="size-7"
                                        pressed={sortMode}
                                        onPressedChange={setSortMode}
                                        disabled={groups.length === 0}
                                        title={t("side.sort")}
                                        aria-label={t("side.sort")}
                                    >
                                        <ArrowUpDown className="size-3.5" />
                                    </Toggle>
                                    <MenuTrigger align="end">
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon"
                                            className="size-7"
                                            title={t("side.add")}
                                            aria-label={t("side.add")}
                                        >
                                            <Plus className="size-3.5" />
                                        </Button>
                                        <MenuContent>
                                            <MenuItem onSelect={() => setDialog({ kind: "group-create" })}>
                                                {t("group.new")}
                                            </MenuItem>
                                            <MenuItem
                                                disabled={groups.length === 0}
                                                onSelect={() =>
                                                    setDialog({ kind: "item-create", groupId: groups[0].id })
                                                }
                                            >
                                                {t("side.addItem")}
                                            </MenuItem>
                                            {groups.length === 0 && (
                                                <p className="px-2 py-1 text-[11px] text-dim-foreground">
                                                    {t("side.createGroupFirst")}
                                                </p>
                                            )}
                                        </MenuContent>
                                    </MenuTrigger>
                                </div>
                            </div>

                            {/* 滚动与内边距都归 Tree 自管（行高 26 与放置线需要整行统一的滚动容器） */}
                            <div className="min-h-0 flex-1">
                                {groups.length === 0 ? (
                                    /* 冷启动空态：引导只占左栏，右侧工具与终端不受影响 */
                                    <Empty className="px-3 py-8">
                                        <EmptyHeader>
                                            <EmptyTitle>{t("group.none")}</EmptyTitle>
                                            <EmptyDescription>{t("group.noneHint")}</EmptyDescription>
                                        </EmptyHeader>
                                    </Empty>
                                ) : (
                                    <LauncherTree
                                        groups={groups}
                                        items={items}
                                        sortable={sortMode}
                                        onOpen={openItem}
                                        onEditItem={(item) => setDialog({ kind: "item-edit", item })}
                                        onDeleteItem={(item) => setDialog({ kind: "item-delete", item })}
                                        onRenameGroup={(g) => setDialog({ kind: "group-rename", group: g })}
                                        onDeleteGroup={(g) => setDialog({ kind: "group-delete", group: g })}
                                        onReorderGroups={reorderGroups}
                                        onMoveItem={reorderItemGroups}
                                    />
                                )}
                            </div>
                        </aside>
                    )}

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
                        ) : dockWanted ? (
                            <Suspense
                                fallback={
                                    <div className="flex h-full items-center justify-center">
                                        <Spinner decorative className="text-muted-foreground" />
                                    </div>
                                }
                            >
                                <DockZone
                                    onReady={handleDockReady}
                                    onOpenTool={openTool}
                                    onOpenSettings={openSettingsForActiveTool}
                                />
                            </Suspense>
                        ) : (
                            /* 冷启动空态：dock 未挂载不加载 dockview，首页卡片与搜索即入口 */
                            <div className="h-full min-h-0 p-1.5">
                                <ToolHome onOpen={openTool} />
                            </div>
                        )}
                    </main>
                </div>

                {/* ── 弹窗区 ── */}
                <GroupDialog
                    open={dialog.kind === "group-create" || dialog.kind === "group-rename"}
                    initialName={dialog.kind === "group-rename" ? dialog.group.name : null}
                    onClose={() => setDialog({ kind: "none" })}
                    onSubmit={
                        dialog.kind === "group-rename"
                            ? (name) => mutate(() => api.renameGroup(dialog.group.id, name), t("toast.saved"))
                            : (name) => mutate(() => api.createGroup(name), t("toast.saved"))
                    }
                />

                <ItemDialog
                    open={dialog.kind === "item-create" || dialog.kind === "item-edit"}
                    groups={groups}
                    item={dialog.kind === "item-edit" ? dialog.item : null}
                    defaultGroupId={dialog.kind === "item-create" ? dialog.groupId : undefined}
                    platform={platform}
                    onClose={() => setDialog({ kind: "none" })}
                    onSubmit={
                        dialog.kind === "item-edit"
                            ? (values: ItemFormValues) =>
                                  mutate(() => api.updateItem(dialog.item.id, values), t("toast.saved"))
                            : (values: ItemFormValues) => mutate(() => api.createItem(values), t("toast.saved"))
                    }
                />

                <ImportDialog
                    open={dialog.kind === "import"}
                    onClose={() => setDialog({ kind: "none" })}
                    onImported={refresh}
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
                    onOpenImport={() => setDialog({ kind: "import" })}
                    termCfg={termCfg}
                    onTermPatch={patchTerm}
                    fontCfg={fontCfg}
                    onFontPatch={patchFont}
                    toolAliases={toolAliases}
                    onToolAlias={patchToolAlias}
                    clipSec={clipSec}
                    onClipSec={patchClipSec}
                    translateCfg={translateCfg}
                    onTranslateCfg={patchTranslate}
                    aiModels={aiModels}
                    onAiModels={patchAiModels}
                />

                <ConfirmDialog
                    open={dialog.kind === "group-delete" || dialog.kind === "item-delete"}
                    title={
                        dialog.kind === "group-delete"
                            ? `${t("group.delete")}：${dialog.group.name}`
                            : dialog.kind === "item-delete"
                              ? `${t("menu.delete")}:${dialog.item.title}`
                              : ""
                    }
                    description={dialog.kind === "group-delete" ? t("group.deleteHint") : undefined}
                    onClose={() => setDialog({ kind: "none" })}
                    onConfirm={async () => {
                        if (dialog.kind === "group-delete") {
                            await mutate(() => api.deleteGroup(dialog.group.id), t("toast.deleted"));
                        } else if (dialog.kind === "item-delete") {
                            await mutate(() => api.deleteItem(dialog.item.id), t("toast.deleted"));
                        }
                    }}
                />
            </div>
        </TooltipProvider>
    );
}
