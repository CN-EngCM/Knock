import {
    Suspense,
    lazy,
    useCallback,
    Dispatch,
    useEffect,
    useMemo,
    useRef,
    SetStateAction,
    useState,
    type CSSProperties,
} from "react";
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
    type Workspace,
} from "./api/client";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Marker } from "@/components/ui/marker";
import { Spinner } from "@/components/ui/spinner";
import { Toaster } from "@/components/ui/sonner";
import { Titlebar, TitlebarWell } from "@/components/ui/titlebar";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { LauncherList } from "./components/LauncherList";
import { SearchBox } from "./components/SearchBox";
import { ToolsMenu } from "./components/ToolsMenu";
import { ToolHome } from "./components/ToolHome";
import { WorkspaceBar } from "./components/WorkspaceBar";
import { RAIL_WIDTH, SidebarResizer, loadSidebar } from "./components/SidebarResizer";
import { cn } from "@/lib/utils";
import { WorkspaceToolbar } from "./components/WorkspaceToolbar";
import { disposeTerm, setTermFont } from "./components/termStore";
import type { DockviewApi } from "@/components/ui/dock-layout";
import { toolMeta, type ToolId } from "./tools/registry";
import { clearToolInput, dispatchToolFocus, dispatchToolInput } from "./tools/toolInput";
import { ItemDialog, type ItemFormValues } from "./components/dialogs/ItemDialog";
import { NameDialog } from "./components/dialogs/NameDialog";
import { WorkspaceDialog } from "./components/dialogs/WorkspaceDialog";
import { ConfirmDialog } from "./components/dialogs/ConfirmDialog";
import { SettingsDialog, type SectionId } from "./components/dialogs/SettingsDialog";
import { applyFonts } from "./lib/fonts";
import { itemIconName } from "./lib/kindIcon";
import { cleanTermTitle } from "./lib/termTitle";
import { applyTheme, currentTheme } from "./lib/theme";
import {
    addPanelPreferEmptyGroup,
    clearDockLayout,
    hasMultipleGroups,
    restoreDockLayout,
    watchDockLayout,
} from "./lib/dockLayout";
import { hostOf } from "./lib/webUrl";
import { workspaceStroke } from "./lib/workspaceColor";
import { useI18n } from "./i18n/useI18n";

// 工具区停靠容器懒加载：dockview 与面板组件都不进首屏 chunk；
// 空态（从未开过面板）直接渲染 ToolHome，不挂 dock
const DockZone = lazy(() => import("./components/DockZone").then((m) => ({ default: m.DockZone })));
// 文件树浮层同样懒加载：图标映射表约 450KB，第一次点开文件树时才载入
const FileTreePanel = lazy(() => import("./components/FileTreePanel"));

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
    | { kind: "item-create"; workspaceId: number | null }
    | { kind: "item-edit"; item: Item }
    | { kind: "item-delete"; item: Item }
    | { kind: "ws-create"; initialName: string }
    | { kind: "ws-rename"; workspace: Workspace }
    | { kind: "ws-delete"; workspace: Workspace }
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
    // 右键菜单据此决定要不要显示「在此打开终端」一组
    const [dirIds, setDirIds] = useState<ReadonlySet<number>>(() => new Set());
    const [dialog, setDialog] = useState<DialogState>({ kind: "none" });
    // 文件树浮层：记的是「为哪个工作区打开的」，换工作区（含删除当前工作区）后自然就不再匹配、等于收起；
    // 面板挂载后常驻（关闭只是不渲染内容），这样各工作区的展开状态能在本次运行内留住
    // 侧栏：宽度（最后一次完整侧栏的）+ 是否收成只有图标的窄条，拖拽与持久化都在 SidebarResizer
    const [sidebar, setSidebar] = useState(loadSidebar);
    const sidebarCollapsed = sidebar.collapsed;
    const [treeOpenFor, setTreeOpenFor] = useState<number | null>(null);
    const [treeMounted, setTreeMounted] = useState(false);
    const treeButtonRef = useRef<HTMLButtonElement>(null);
    const treeAnchorRef = useRef<HTMLDivElement>(null);
    const [platform, setPlatform] = useState("");
    // 界面主题：初始值来自 index.html 首帧前套好的 <html> 类；切换经 settings 表持久化
    const [theme, setTheme] = useState<ThemeId>(currentTheme);
    // ── 工作区：每个工作区一套独立的停靠区实例，同一时刻只显示当前那个 ──
    // 数据以服务端为准（activeId 落库在 settings 表）：切换成功后重拉，界面不自留副本
    const [wsData, setWsData] = useRpcValue(api.getWorkspaces);
    const activeWorkspaceId = wsData?.activeId ?? null;
    // 当前工作区决定停靠区活动标签的标识线：数据还没到时退回中性线，避免首帧闪一个不属于任何工作区的颜色
    const activeWorkspace = wsData?.workspaces.find((w) => w.id === activeWorkspaceId) ?? null;
    const dockStroke = activeWorkspace ? workspaceStroke(activeWorkspace) : "var(--line)";
    // 条目按归属分开用：左侧列表只认空值，工作区工具栏只认当前工作区 id，
    // 顶栏搜索收全部（工作区条目也能按标题搜到，由 SearchBox 自己区分归属）。移动菜单负责换归属
    const globalItems = useMemo(() => items.filter((item) => item.workspaceId === null), [items]);
    const activeWorkspaceItems = useMemo(
        () => (activeWorkspaceId === null ? [] : items.filter((item) => item.workspaceId === activeWorkspaceId)),
        [items, activeWorkspaceId],
    );
    // 移动菜单的目标：临时工作区没有工具栏，不作为目标
    const workspaceTargets = useMemo(() => (wsData?.workspaces ?? []).filter((w) => !w.builtin), [wsData]);
    // 文件树只给有文件夹的普通工作区；断线态与工具栏一样不提供
    const treeWorkspace =
        serverOk !== false && activeWorkspace && !activeWorkspace.builtin && activeWorkspace.folder
            ? { id: activeWorkspace.id, folder: activeWorkspace.folder }
            : null;
    const treeOpen = treeOpenFor !== null && treeOpenFor === treeWorkspace?.id;
    function toggleTree() {
        setTreeMounted(true);
        setTreeOpenFor(treeOpen ? null : (treeWorkspace?.id ?? null));
    }
    // 工作区文件夹是该工作区新终端与命令条目的默认工作目录；临时工作区、旧的无文件夹工作区
    // 返回 undefined，调用方据此回落到主目录
    function workspaceFolderOf(workspaceId: number | null): string | undefined {
        if (workspaceId === null) return undefined;
        const workspace = wsData?.workspaces.find((w) => w.id === workspaceId);
        if (!workspace || workspace.builtin) return undefined;
        return workspace.folder || undefined;
    }
    // 切换工作区：先落库再重拉；停靠区实例常驻，切换只是换显示，不动任何面板与终端
    const switchWorkspace = useCallback(
        async (id: number) => {
            // 切回原工作区时不能让浮层自己弹出来
            setTreeOpenFor(null);
            const r = await api.setActiveWorkspace(id);
            if (!r.ok) {
                toast.error(t("toast.error"));
                return;
            }
            const next = await api.getWorkspaces();
            if (next.ok) setWsData(next.data);
        },
        [t, setWsData],
    );
    // 工作区数据以服务端为准：任何变更后重拉，界面不自留副本
    const refreshWorkspaces = useCallback(async () => {
        const next = await api.getWorkspaces();
        if (next.ok) setWsData(next.data);
    }, [setWsData]);

    // 新建工作区：只负责算默认名并打开弹窗，落库交给提交回调（文件夹在弹窗里选）；
    // 编号仍取「工作区 N」中第一个没被占用的（删掉 1 之后新建会重新用上 1）
    const openCreateWorkspace = useCallback(() => {
        const used = new Set((wsData?.workspaces ?? []).filter((w) => !w.builtin).map((w) => w.name));
        let n = 1;
        while (used.has(`${t("ws.defaultName")} ${n}`)) n += 1;
        setDialog({ kind: "ws-create", initialName: `${t("ws.defaultName")} ${n}` });
    }, [wsData, t]);

    // 提交新建：服务端校验文件夹，成功后重拉并切到新工作区；失败抛给弹窗保持打开。
    // 切换失败只提示不回滚——工作区已经建好，用户点一下列表就能切过去
    async function submitCreateWorkspace(name: string, folder: string) {
        const created = await api.createWorkspace(name, folder);
        if (!created.ok) throw new Error(created.error.kind);
        await refreshWorkspaces();
        const active = await api.setActiveWorkspace(created.data.id);
        if (!active.ok) toast.error(t("toast.error"));
        await refreshWorkspaces();
    }

    // 修改工作区文件夹：从当前目录起步选新目录，成功后重拉列表。
    // 已开的终端与面板各自持有自己的 cwd，本次修改只影响之后新开的会话
    async function changeWorkspaceFolder(workspace: Workspace) {
        const picked = await api.pickDirectory(workspace.folder);
        if (!picked.ok || picked.data === null) return;
        const r = await api.updateWorkspaceFolder(workspace.id, picked.data);
        if (!r.ok) {
            toast.error(t("toast.error"));
            return;
        }
        await refreshWorkspaces();
    }

    // 改名：服务端 trim 后校验 1..40 字，成功重拉列表
    async function renameWorkspace(workspace: Workspace, name: string) {
        const r = await api.renameWorkspace(workspace.id, name);
        if (!r.ok) {
            toast.error(t("toast.error"));
            return;
        }
        await refreshWorkspaces();
    }

    // 改标识色：null = 恢复自动取色。成功后重拉列表，侧栏色条与停靠区标签标识线随数据一起换
    async function changeWorkspaceColor(workspace: Workspace, color: string | null) {
        const r = await api.setWorkspaceColor(workspace.id, color);
        if (!r.ok) {
            toast.error(t("toast.error"));
            return;
        }
        await refreshWorkspaces();
    }

    // 工具区停靠容器：首次打开面板时挂载（懒加载 dockview），此后常驻——面板清空
    // 由 dock 空态水印（ToolHome）兜底。已开面板是纯运行时状态，不落盘不还原（用户决策）；
    // 格子的排法单独记在 lib/dockLayout.ts，启动时还原成一排空格子
    const [dockWanted, setDockWanted] = useState(false);
    // dock 命令桥：面板开/关/激活都走所属工作区的 dockview api；该工作区实例懒加载就绪前的
    // 调用按工作区分队列，onReady 只冲刷自己那一条
    const dockCtl = useRef<{
        apis: Map<number, DockviewApi>;
        queues: Map<number, Array<(api: DockviewApi) => void>>;
    }>({ apis: new Map(), queues: new Map() });
    // 每个工作区的面板总数（工具＋终端）：dockview 是命令式 api，面板增删不会让 React 重渲染，
    // 这里在面板增删事件里重算，供侧栏的工作区列表显示
    const [panelCounts, setPanelCounts] = useState<Record<number, number>>({});
    // 终端设置（shell/字号）：字号喂 termStore（xterm 实例表），设置页改这里再落库
    const [termCfg, setTermCfg] = useRpcValue(api.getTermConfig);
    // 字体设置（界面/等宽）：applyFonts 写 CSS 变量全局生效；等宽栈同步喂 termStore
    const [fontCfg, setFontCfg] = useRpcValue(api.getFontConfig);
    // 临时工作区小工具自动关闭的时长（分钟，0 = 关）：计时在下面的 effect 里，所以放 App，设置页改这里再落库
    const [scratchCfg, setScratchCfg] = useRpcValue(api.getScratchAutoClose);

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

    // 设置页提交临时工作区自动关闭时长：成功回填，下面的计时 effect 随之按新时长从头数
    function patchScratchAutoClose(minutes: number): Promise<boolean> {
        return patchSetting(() => api.setScratchAutoClose(minutes), setScratchCfg);
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

    // ── 打开条目：书签在应用内开网页面板；终端命令驱动终端执行；应用/文件走后端启动器 ──
    // 应用/文件启动成功后隐藏窗口（用户决策 2026-08）：失败保留窗口让 toast 可见；
    // 终端命令和网页面板都开在本窗口里，不藏
    async function openItem(item: Item) {
        const now = Date.now();
        const blocked = lastOpenRef.current?.id === item.id && now - lastOpenRef.current.at < 500;
        lastOpenRef.current = { id: item.id, at: now };
        if (blocked) return;
        // 工作区条目一律开在它所属的工作区里（并切过去）；左栏的全局条目没有归属，开在当前工作区
        if (item.kind === "bookmark") {
            void openWeb(item.target, item.workspaceId ?? undefined, itemIconName(item) ?? undefined);
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

    // ── 执行终端命令条目：显式工作目录优先；工作区条目留空时继承所属工作区文件夹，
    //    左侧条目（无归属）留空仍回主目录。cwd 不存在由服务端按 missing 拒绝 ──
    function runCommand(item: Item) {
        const cwd = item.args || workspaceFolderOf(item.workspaceId);
        void spawnSession({
            cwd,
            label: item.title,
            command: item.target,
            autoClose: item.autoClose,
            workspaceId: item.workspaceId ?? undefined,
            icon: itemIconName(item) ?? undefined,
        });
    }

    // ── 文件夹条目：在应用内终端打开该目录（标签名取文件夹名），opencode / claude
    //    作为会话首条命令送入。目录不存在由 spawnSession 按 launch.missing 提示。
    //    名字按标签上限截断，ptySpawn 的 label 本身也有长度上限 ──
    function openFolderInTerminal(folderPath: string, command?: "opencode" | "claude") {
        const trimmed = folderPath.replace(/[\\/]+$/, "");
        const folder = cleanTermTitle(trimmed.split(/[\\/]/).pop() || folderPath) ?? folderPath;
        void spawnSession({ cwd: folderPath, label: command ? `${command} · ${folder}` : folder, command });
    }
    // 条目版只是取出 target 转给路径版；文件树右键菜单直接用路径版
    function openInTerminal(item: Item, command?: "opencode" | "claude") {
        openFolderInTerminal(item.target, command);
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
    //（有空格子优先进空格子，全满了进第一格，见 lib/dockLayout.ts）；关闭走面板 × / 右键菜单，App 只订阅面板移除做善后。
    // input 非空 = 带素材打开：素材落模块级 pending，组件挂载时消费 + 事件覆盖
    // 已开的面板（双通道与时序问题见 tools/toolInput.ts）；裸开则清残留素材。
    // expertId 仅 ai 工具有意义（进入指定专家）；它与 input 相互独立，
    // 「只有专家、没有素材」同样要过注入通道，让组件收到新注入的边沿信号
    // 队列按工作区分开：各工作区的实例各自就绪，命令只能落到自己那个实例上
    function whenDockApi(workspaceId: number, fn: (dock: DockviewApi) => void) {
        const ctl = dockCtl.current;
        const dock = ctl.apis.get(workspaceId);
        if (dock) {
            fn(dock);
            return;
        }
        const queue = ctl.queues.get(workspaceId);
        if (queue) queue.push(fn);
        else ctl.queues.set(workspaceId, [fn]);
    }

    // 工具集菜单的「已打开」标记：只看当前工作区的实例，其余工作区的面板不算
    function getOpenTools(): ToolId[] {
        const dock = activeWorkspaceId === null ? undefined : dockCtl.current.apis.get(activeWorkspaceId);
        if (!dock) return [];
        return dock.panels.filter((p) => p.id.startsWith("tool:")).map((p) => p.id.slice(5) as ToolId);
    }

    function openTool(id: ToolId, input?: string | null, expertId?: number) {
        // 终端落在当前工作区文件夹；临时工作区或没设文件夹的工作区回主目录
        if (id === "terminal") {
            void spawnSession({ cwd: workspaceFolderOf(activeWorkspaceId) });
            return;
        }
        // 浏览器可多开：每次新开一块空白网页面板
        if (id === "browser") {
            void openWeb();
            return;
        }
        // 工作区数据还没到时不知道该往哪开：直接忽略这次点击（此时 dock 也还没挂出来）
        const ws = activeWorkspaceId;
        if (ws === null) return;
        setDockWanted(true);
        whenDockApi(ws, (dock) => {
            const panel = dock.getPanel(`tool:${id}`);
            if (panel) panel.api.setActive();
            else
                addPanelPreferEmptyGroup(dock, {
                    id: `tool:${id}`,
                    component: "tool",
                    title: t(toolMeta(id).nameKey),
                    params: { toolId: id, workspaceId: ws },
                });
        });
        // 素材与聚焦信号都带上工作区 id：只有这个工作区里的面板会收到
        if (input != null || expertId != null)
            dispatchToolInput({ tool: id, text: input ?? "", expertId, workspaceId: ws });
        else clearToolInput(id, ws);
        dispatchToolFocus(id, ws);
    }

    // ── 网页面板：每次都新开一块（web:<号>），默认开在当前激活工作区的停靠区，不去找已开的 ──
    // 已开的那块可能早就跳去别的页了，找它反而容易错。不带 url 是「浏览器」工具的空白页。
    // workspaceId 只有搜索框选中别的工作区的网页收藏时才会不是当前工作区：开在它那里并切过去。
    // icon 是快捷启动条目的图标名，标签上用它；没有（浏览器工具、网页里开的新窗口）就用默认的地球。
    // renderer: "always" 让内容画在 dockview 的覆盖层上，拖拽分屏时不被搬动，网页不会重载
    const nextWebId = useRef(1);
    async function openWeb(url?: string, workspaceId?: number, icon?: string) {
        const ws = workspaceId ?? activeWorkspaceId;
        if (ws === null) return;
        setDockWanted(true);
        const id = nextWebId.current++;
        // 先切再加面板：面板在可见的停靠区里挂载，网页才按正确的尺寸创建。
        // 切换失败只提示，面板仍加到目标工作区，用户点一下列表就能过去
        if (ws !== activeWorkspaceId) await switchWorkspace(ws);
        whenDockApi(ws, (dock) => {
            addPanelPreferEmptyGroup(dock, {
                id: `web:${id}`,
                component: "web",
                title: url ? hostOf(url) : t("tool.browser.name"),
                params: { url, icon },
                renderer: "always",
            });
        });
    }

    // 网页里的 target=_blank / window.open：主进程转来，只会是 http/https 地址
    const openWebRef = useRef(openWeb);
    openWebRef.current = openWeb;
    useEffect(() => window.knock.onWebOpen((url) => openWebRef.current(url)), []);

    // 右键菜单「在系统浏览器中打开」：交给系统默认浏览器，同时藏起本窗口（与旧版点书签的行为一致）
    function openInSystemBrowser(item: Item) {
        window.open(item.target, "_blank", "noreferrer");
        window.knock.hideWindow();
    }

    // ── 终端会话生命周期：每个会话一块 dock 面板（term:<会话号>）──

    // 开新会话（工具菜单 / 终端命令条目共用）：cwd 由调用方决定（工作区文件夹或条目自带的
    // 工作目录），缺省主目录；命令条目的整行命令在建好后写入执行——首屏输出由 termStore
    // 的缓冲兜住，面板挂载后回放
    // workspaceId 只有搜索框选中别的工作区的终端命令条目时才会不是当前工作区：开在它那里并切过去
    async function spawnSession(req?: {
        cwd?: string;
        label?: string;
        command?: string;
        autoClose?: boolean;
        workspaceId?: number;
        /** 快捷启动条目的图标名，标签上用它；没有就用终端默认图标 */
        icon?: string;
    }) {
        // 没有当前工作区就不起会话：pty 起来了却没有面板接，等于留一个看不见的 shell
        const ws = req?.workspaceId ?? activeWorkspaceId;
        if (ws === null) return;
        const r = await api.ptySpawn(req ? { cwd: req.cwd, label: req.label } : undefined);
        if (!r.ok) {
            // 命令条目的工作目录不存在：与 App 启动失败同口径（launch.missing + 路径）
            if (r.error.kind === "missing") toast.error(`${t("launch.missing")}: ${r.error.path}`);
            else toast.error(t("toast.error"));
            return;
        }
        setDockWanted(true);
        // 会话起成功才切（目录不存在等失败留在原工作区，只弹报错）；先切再加面板，
        // 终端在可见的停靠区里挂载才按正确的尺寸排版。切换失败只提示，面板仍加到目标工作区，
        // 否则 pty 起来了却没有面板接
        if (ws !== activeWorkspaceId) await switchWorkspace(ws);
        whenDockApi(ws, (dock) => {
            addPanelPreferEmptyGroup(dock, {
                id: `term:${r.data.id}`,
                component: "term",
                title: r.data.label,
                params: { sessionId: r.data.id, icon: req?.icon },
            });
        });
        // 自动关闭：命令后面追加「成功才退出 shell」，shell 一退出，下面的 exit 事件处理就会关掉面板；
        // 命令失败时 shell 留着，报错还看得见。追加什么由主进程按实际 shell 给出
        if (req?.command) {
            const tail = req.autoClose ? r.data.exitSuffix : "";
            void api.ptyWrite(r.data.id, `${req.command}${tail}\r`);
        }
    }

    // dock 就绪：存下这个工作区的实例、冲刷它排队的命令；面板移除善后按实例各挂一次
    // （终端面板 = 结束 pty + 释放 xterm 实例，工具面板组件自卸载无需善后）
    const handleDockReady = useCallback((workspaceId: number, dock: DockviewApi) => {
        const ctl = dockCtl.current;
        // 先还原上次记下的格子，再冲刷排队的开面板命令：新面板才能落进还原出来的激活格子里
        restoreDockLayout(workspaceId, dock);
        ctl.apis.set(workspaceId, dock);
        watchDockLayout(workspaceId, dock, () => ctl.apis.get(workspaceId) === dock);
        // 面板数只能按实例现状重算：面板增删发生在 dockview 内部，React 收不到通知；
        // 数字没变就返回原对象，避免每次面板增删都触发一轮无意义的渲染
        const syncPanelCount = () => {
            const count = dock.panels.length;
            setPanelCounts((prev) => (prev[workspaceId] === count ? prev : { ...prev, [workspaceId]: count }));
        };
        dock.onDidAddPanel(() => syncPanelCount());
        dock.onDidRemovePanel((panel) => {
            // 先对齐计数再按前缀善后：pty 清理只认 term 面板，两步互不依赖
            syncPanelCount();
            if (!panel.id.startsWith("term:")) return;
            const id = Number(panel.id.slice(5));
            void api.ptyKill(id);
            disposeTerm(id);
        });
        // 监听先挂好再冲刷队列：实例就绪前排队的面板也要计进面板数；末尾再对齐一次现状
        ctl.queues
            .get(workspaceId)
            ?.splice(0)
            .forEach((fn) => fn(dock));
        ctl.queues.delete(workspaceId);
        syncPanelCount();
    }, []);

    // 工作区被删掉后，它的实例会随之卸载（dockview api 由组件自己销毁）；
    // 这里同步丢掉映射里的旧实例，免得后续命令落到已销毁的实例上
    useEffect(() => {
        const list = wsData?.workspaces;
        if (!list) return;
        const alive = new Set(list.map((w) => w.id));
        for (const id of dockCtl.current.apis.keys()) {
            if (!alive.has(id)) dockCtl.current.apis.delete(id);
        }
        // 工作区没了，它名下的面板数也没有意义，顺手清掉，免得表里越积越多
        setPanelCounts((prev) => {
            const stale = Object.keys(prev)
                .map(Number)
                .filter((id) => !alive.has(id));
            if (stale.length === 0) return prev;
            const next = { ...prev };
            for (const id of stale) delete next[id];
            return next;
        });
    }, [wsData]);

    // 删除工作区：必须先把该实例里的面板逐个关掉，让上面的 onDidRemovePanel 收尾
    //（结束 pty、释放 xterm），再删数据行。反过来先删数据行会让 React 卸载整个实例，
    // 面板移除事件不触发，shell 就变成没人管的孤儿进程
    async function deleteWorkspace(workspace: Workspace) {
        const dock = dockCtl.current.apis.get(workspace.id);
        if (dock) {
            for (const panel of [...dock.panels]) panel.api.close();
        }
        const r = await api.deleteWorkspace(workspace.id);
        if (!r.ok) {
            toast.error(t("toast.error"));
            return;
        }
        clearDockLayout(workspace.id);
        await refreshWorkspaces();
        // 条目随工作区外键级联删除：再拉一次全量，左侧与工具栏里别留着已不存在的行
        await refresh();
    }

    // 移动条目归属（左侧 ↔ 工作区）：成功后重拉全量，界面只认服务端结果
    async function moveItem(item: Item, workspaceId: number | null) {
        await mutate(() => api.moveItem(item.id, workspaceId), t("toast.moved"));
    }

    // shell 自己退出（exit / 进程崩溃）：先释放 xterm 实例再关面板（触发上面的
    // 移除善后；ptyKill 对已退会话是空操作）。事件只带会话号，不知道属于哪个工作区，
    // 逐个实例找那块 term 面板（实例数量个位数，遍历无压力）
    useEffect(() => {
        const off = onPtyEvent((e) => {
            if (e.type !== "exit") return;
            disposeTerm(e.id);
            for (const dock of dockCtl.current.apis.values()) dock.getPanel(`term:${e.id}`)?.api.close();
        });
        return off;
    }, []);

    // 界面语言切换：所有已就绪实例里的工具面板标题都跟着换（终端标题是会话标签，非本地化文案）
    useEffect(() => {
        for (const dock of dockCtl.current.apis.values()) {
            for (const panel of dock.panels) {
                if (!panel.id.startsWith("tool:")) continue;
                panel.api.setTitle(t(toolMeta(panel.id.slice(5) as ToolId).nameKey));
            }
        }
        // 实例表读 ref，无需进依赖
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [lang, t]);

    // ── 临时工作区小工具自动关闭：用户看不到临时工作区满设定时长，就把里面的小工具面板全关掉 ──
    // 「看不到」= 窗口藏起来了，或窗口开着但当前在别的工作区；回到临时工作区即取消，再离开从头数。
    // 终端（term:）与网页（web:）面板不动，只关 tool: 面板，格子排布也不动。
    // 窗口开着时只看 hide / show 事件：钉住时被别的窗口盖住不算藏起来（与文件树浮层同口径）。
    // 计时放渲染端的原因：各工作区的停靠区实例在这里；定时器在窗口藏着时照走（AI 流式那边也是这么用的）
    const [windowHidden, setWindowHidden] = useState(false);
    useEffect(() => {
        const offHidden = window.knock.onWindowHidden(() => setWindowHidden(true));
        const offShown = window.knock.onWindowShown(() => setWindowHidden(false));
        return () => {
            offHidden();
            offShown();
        };
    }, []);
    const scratchId = wsData?.workspaces.find((w) => w.builtin)?.id ?? null;
    const scratchAway = windowHidden || activeWorkspaceId !== scratchId;
    const scratchMinutes = scratchCfg?.minutes ?? 0;
    useEffect(() => {
        if (scratchId === null || scratchMinutes <= 0 || !scratchAway) return;
        const timer = setTimeout(
            () => {
                const dock = dockCtl.current.apis.get(scratchId);
                if (!dock) return;
                // 复制一份再遍历：关面板会改动 dock.panels
                for (const panel of [...dock.panels]) {
                    if (panel.id.startsWith("tool:")) panel.api.close();
                }
            },
            scratchMinutes * 60 * 1000,
        );
        return () => clearTimeout(timer);
    }, [scratchId, scratchMinutes, scratchAway]);

    // 终端字体/字号：termStore 直改实例并重排，不经过面板 props
    useEffect(() => {
        setTermFont(fontCfg?.monoFont ?? "", termCfg?.fontSize ?? 13);
    }, [fontCfg, termCfg]);

    // 当前工作区记下的布局不止一个格子时，不等开面板就把停靠区挂出来，让格子在启动时就还原；
    // 单个格子或没存过则保持懒加载（此时没有可画的格子，首页卡片就是入口）
    useEffect(() => {
        if (!dockWanted && activeWorkspaceId !== null && hasMultipleGroups(activeWorkspaceId)) setDockWanted(true);
    }, [dockWanted, activeWorkspaceId]);

    // dock chunk 闲时预取：首个面板打开不用现等 dockview 下载
    useEffect(() => {
        const id = requestIdleCallback(() => void import("./components/DockZone"));
        return () => cancelIdleCallback(id);
    }, []);

    // 文件树面板闲时先挂上（没打开时什么都不画）：代码包提前加载并执行完，第一次点开不用现等，
    // 面板也趁此后台预读工作区文件夹的第一层。实测冷启动后首次点开约 335ms，之后每次约 30ms，差的主要是代码包
    const hasTreeWorkspace = treeWorkspace !== null;
    useEffect(() => {
        if (treeMounted || !hasTreeWorkspace) return;
        const id = requestIdleCallback(() => setTreeMounted(true));
        return () => cancelIdleCallback(id);
    }, [treeMounted, hasTreeWorkspace]);

    // 工具内「打开设置」引导：分节跟随当前工作区实例里激活的工具面板（translate/ai 有缺配置态）
    function openSettingsForActiveTool() {
        const dock = activeWorkspaceId === null ? undefined : dockCtl.current.apis.get(activeWorkspaceId);
        const active = dock?.activePanel?.id;
        const toolId = active?.startsWith("tool:") ? (active.slice(5) as ToolId) : undefined;
        setDialog({ kind: "settings", section: (toolId && TOOL_SETTINGS_SECTION[toolId]) || "translate" });
    }

    // 传给 DockZone 的回调与工作区 id 列表必须引用稳定：DockZone 用它们 useMemo 出面板组件表和
    // 水印，引用一变 dockview 就整区重渲染、水印里的 ToolHome 也被卸载重建。
    // 两个函数闭包里要读最新状态（当前工作区、语言），所以最新值放 ref、外面包空依赖的 useCallback。
    const openToolRef = useRef(openTool);
    openToolRef.current = openTool;
    const openSettingsRef = useRef(openSettingsForActiveTool);
    openSettingsRef.current = openSettingsForActiveTool;
    const dockOpenTool = useCallback((id: ToolId, input?: string | null, expertId?: number) => {
        openToolRef.current(id, input, expertId);
    }, []);
    const dockOpenSettings = useCallback(() => openSettingsRef.current(), []);
    const workspaceIds = useMemo(() => (wsData?.workspaces ?? []).map((w) => w.id), [wsData]);

    // 条目弹窗的归属：新建时取弹窗选的（左侧 null / 工具栏当前工作区），编辑时取条目自己的。
    // 归属决定新建默认类型与工作目录提示；弹窗关闭时这些值不参与渲染
    const itemDialogWorkspaceId =
        dialog.kind === "item-create"
            ? dialog.workspaceId
            : dialog.kind === "item-edit"
              ? dialog.item.workspaceId
              : null;
    const itemDialogWorkspace =
        itemDialogWorkspaceId === null
            ? null
            : (wsData?.workspaces.find((workspace) => workspace.id === itemDialogWorkspaceId) ?? null);
    const itemDialogInWorkspace = itemDialogWorkspace !== null && !itemDialogWorkspace.builtin;
    // 删除工作区前的条目数：确认框据此说明会连带删掉多少快捷启动
    const deletingWorkspaceItemCount =
        dialog.kind === "ws-delete" ? items.filter((item) => item.workspaceId === dialog.workspace.id).length : 0;
    // 便签不在前端全量数据里，确认框打开时现查一次条数
    const [deletingNoteCount, setDeletingNoteCount] = useState(0);
    const deletingWorkspaceId = dialog.kind === "ws-delete" ? dialog.workspace.id : null;
    useEffect(() => {
        setDeletingNoteCount(0);
        if (deletingWorkspaceId === null) return;
        let alive = true;
        void api.notesCount(deletingWorkspaceId).then((r) => {
            if (alive && r.ok) setDeletingNoteCount(r.data);
        });
        return () => {
            alive = false;
        };
    }, [deletingWorkspaceId]);

    return (
        <TooltipProvider>
            <div className="flex h-screen flex-col overflow-hidden font-sans text-foreground">
                <Toaster position="bottom-center" />

                {/* Titlebar 根节点即 gan-drag 拖拽区；搜索井、右侧按钮在 no-drag 插槽内。
                    左槽单独改回 drag 并拉满行高，保住原「品牌区可拖窗」的手感；
                    中槽限宽 + mx-auto：搜索框不必铺满整行，在品牌与右侧按钮之间居中；
                    overflow-visible 让搜索下拉能悬出 40px 顶栏。 */}
                <Titlebar
                    role="banner"
                    windowControls="none"
                    trafficLights={false}
                    className="z-20 h-[40px] flex-none overflow-visible [&>[data-slot=titlebar-left]]:flex-none [&>[data-slot=titlebar-left]]:self-stretch [&>[data-slot=titlebar-left]]:gan-drag [&>[data-slot=titlebar-right]]:flex-none [&>[data-slot=titlebar-center]]:mx-auto [&>[data-slot=titlebar-center]]:max-w-[540px] [&>[data-slot=titlebar-center]]:flex-1"
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
                            {/* 中英文品牌都是 Knock，上下叠两行：11px 字、12px 行高，两行合计 24px，放得进 40px 顶栏 */}
                            <strong className="flex flex-col text-[11px] font-medium leading-3 tracking-wider">
                                <span>{t("app.brand")}</span>
                                <span>{t("app.brand")}</span>
                            </strong>
                        </span>
                    }
                    center={
                        /* 28px 搜索井：relative 供 SearchBox 下拉定位，左右内边距与原搜索井一致（10px）。
                           再矮会挤到素材 chip（约 20px，井上下内边距各 4px） */
                        <TitlebarWell className="relative h-[28px] flex-row px-2.5 overflow-visible">
                            <SearchBox
                                items={items}
                                workspaces={workspaceTargets}
                                dirIds={dirIds}
                                light={theme === "light"}
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
                            <ToolsMenu getOpenTools={getOpenTools} onOpen={openTool} />
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

                {/* 两区工作区 */}
                <div className="relative z-10 flex min-h-0 flex-1">
                    {/* 宽度可拖拽并记住，往左拖到头会收成只有图标的窄条（RAIL_WIDTH）。
                        max-w-[40%] 是窗口变窄时完整侧栏的上限，与 SidebarResizer 里的比例是同一个数。
                        relative z-10：让右边缘那条看不见的拖拽区（SidebarResizer，探出 2px 到停靠区上）盖在停靠区之上 */}
                    <aside
                        className="app-no-drag relative z-10 flex min-h-0 max-w-[40%] flex-none flex-col bg-background"
                        style={{ width: sidebarCollapsed ? RAIL_WIDTH : sidebar.width }}
                    >
                        <SidebarResizer state={sidebar} onChange={setSidebar} />
                        {/* 工作区块固定在侧栏顶部 */}
                        <WorkspaceBar
                            collapsed={sidebarCollapsed}
                            workspaces={wsData?.workspaces ?? []}
                            activeId={activeWorkspaceId}
                            panelCounts={panelCounts}
                            onSwitch={(id) => void switchWorkspace(id)}
                            onCreate={openCreateWorkspace}
                            onRename={(workspace) => setDialog({ kind: "ws-rename", workspace })}
                            onChangeFolder={(workspace) => void changeWorkspaceFolder(workspace)}
                            onChangeColor={(workspace, color) => void changeWorkspaceColor(workspace, color)}
                            onDelete={(workspace) => setDialog({ kind: "ws-delete", workspace })}
                        />

                        {/* 标题行与工作区块的标题行同高（h-9 = 36px，含底边线），也是工作区工具栏的高度。
                            图标条里没有地方放字：去掉标题，「＋」居中留着，新建入口不能丢 */}
                        <div
                            className={cn(
                                "flex h-9 flex-none items-center border-b border-line",
                                sidebarCollapsed ? "justify-center" : "justify-between pr-2 pl-4",
                            )}
                        >
                            {!sidebarCollapsed && <span className="text-xs font-medium">{t("side.title")}</span>}
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="size-7"
                                onClick={() => setDialog({ kind: "item-create", workspaceId: null })}
                                title={t("side.addItem")}
                                aria-label={t("side.addItem")}
                            >
                                <Plus className="size-3.5" />
                            </Button>
                        </div>

                        {/* 滚动与内边距都归列表自管（行高 26 需要整行统一的滚动容器） */}
                        <div className="min-h-0 flex-1">
                            {globalItems.length === 0 ? (
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
                                    items={globalItems}
                                    dirIds={dirIds}
                                    light={theme === "light"}
                                    workspaces={workspaceTargets}
                                    onOpenInTerminal={openInTerminal}
                                    onOpenExternal={openInSystemBrowser}
                                    onOpen={openItem}
                                    onEditItem={(item) => setDialog({ kind: "item-edit", item })}
                                    onDeleteItem={(item) => setDialog({ kind: "item-delete", item })}
                                    onMoveItem={(item, workspaceId) => void moveItem(item, workspaceId)}
                                />
                            )}
                        </div>
                    </aside>

                    {/* 停靠区没有外圈描边：和侧栏的分界靠底色深浅（bg-background 对 bg-canvas） */}
                    <main
                        className="relative flex min-w-0 flex-1 flex-col bg-canvas"
                        style={
                            {
                                // 活动标签的标识线只在深色主题取工作区色（换工作区时连标签标记一起换色）；
                                // 浅色主题焦点标签是深底浅字，原本的白色高光才是那套材质的一部分
                                ...(theme === "dark"
                                    ? {
                                          "--dock-focus-top-line": dockStroke,
                                          "--dock-focus-mark": dockStroke,
                                      }
                                    : {}),
                            } as CSSProperties
                        }
                    >
                        {/* 普通工作区顶部一条项目快捷启动工具栏：条目归属当前工作区，
                            临时工作区没有归属条目，不渲染。断线态也不显示，避免点了没反应的按钮 */}
                        {serverOk !== false && activeWorkspace && !activeWorkspace.builtin && (
                            <WorkspaceToolbar
                                folder={activeWorkspace.folder}
                                items={activeWorkspaceItems}
                                dirIds={dirIds}
                                workspaces={workspaceTargets}
                                currentWorkspaceId={activeWorkspace.id}
                                light={theme === "light"}
                                treeOpen={treeOpen}
                                treeButtonRef={treeButtonRef}
                                onToggleTree={toggleTree}
                                onCreate={() => setDialog({ kind: "item-create", workspaceId: activeWorkspace.id })}
                                onOpenFolder={(folder) => void openLocalPath(folder)}
                                onOpen={openItem}
                                onOpenInTerminal={openInTerminal}
                                onOpenExternal={openInSystemBrowser}
                                onEditItem={(item) => setDialog({ kind: "item-edit", item })}
                                onDeleteItem={(item) => setDialog({ kind: "item-delete", item })}
                                onMoveItem={(item, workspaceId) => void moveItem(item, workspaceId)}
                            />
                        )}
                        <div ref={treeAnchorRef} className="flex min-h-0 flex-1 flex-col">
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
                            ) : dockWanted && wsData ? (
                                /* 工作区数据还没到时按空态处理：此时不知道该挂哪个工作区的实例 */
                                <Suspense
                                    fallback={
                                        <div className="flex h-full items-center justify-center">
                                            <Spinner decorative className="text-muted-foreground" />
                                        </div>
                                    }
                                >
                                    <DockZone
                                        workspaces={workspaceIds}
                                        activeId={wsData.activeId}
                                        light={theme === "light"}
                                        onReady={handleDockReady}
                                        onOpenTool={dockOpenTool}
                                        onOpenSettings={dockOpenSettings}
                                    />
                                </Suspense>
                            ) : (
                                /* 冷启动空态：dock 未挂载不加载 dockview，首页卡片与搜索即入口 */
                                <div className="h-full min-h-0">
                                    <ToolHome onOpen={openTool} />
                                </div>
                            )}
                        </div>
                    </main>
                </div>

                {treeMounted && (
                    <Suspense fallback={null}>
                        <FileTreePanel
                            open={treeOpen}
                            onOpenChange={(open) => setTreeOpenFor(open ? activeWorkspaceId : null)}
                            workspace={treeWorkspace}
                            light={theme === "light"}
                            anchorRef={treeAnchorRef}
                            toggleRef={treeButtonRef}
                            onOpenPath={(path) => void openLocalPath(path)}
                            onOpenFolderInTerminal={(path) => openFolderInTerminal(path)}
                            onChangeFolder={() => {
                                if (activeWorkspace) void changeWorkspaceFolder(activeWorkspace);
                            }}
                        />
                    </Suspense>
                )}

                {/* ── 弹窗区 ── */}
                <NameDialog
                    open={dialog.kind === "ws-rename"}
                    initialName={dialog.kind === "ws-rename" ? dialog.workspace.name : ""}
                    title={t("ws.rename")}
                    label={t("common.name")}
                    maxLength={40}
                    onClose={() => setDialog({ kind: "none" })}
                    onSubmit={async (name) => {
                        if (dialog.kind === "ws-rename") await renameWorkspace(dialog.workspace, name);
                    }}
                />

                <WorkspaceDialog
                    open={dialog.kind === "ws-create"}
                    initialName={dialog.kind === "ws-create" ? dialog.initialName : ""}
                    onClose={() => setDialog({ kind: "none" })}
                    onSubmit={submitCreateWorkspace}
                />

                <ItemDialog
                    open={dialog.kind === "item-create" || dialog.kind === "item-edit"}
                    item={dialog.kind === "item-edit" ? dialog.item : null}
                    platform={platform}
                    inWorkspace={itemDialogInWorkspace}
                    workspaceFolder={itemDialogInWorkspace ? itemDialogWorkspace?.folder : undefined}
                    light={theme === "light"}
                    onClose={() => setDialog({ kind: "none" })}
                    onSubmit={
                        dialog.kind === "item-edit"
                            ? (values: ItemFormValues) =>
                                  mutate(() => api.updateItem(dialog.item.id, values), t("toast.saved"))
                            : (values: ItemFormValues) =>
                                  mutate(
                                      () => api.createItem({ ...values, workspaceId: itemDialogWorkspaceId }),
                                      t("toast.saved"),
                                  )
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
                    scratchMinutes={scratchCfg?.minutes ?? null}
                    onScratchMinutes={patchScratchAutoClose}
                    toolAliases={toolAliases}
                    onToolAlias={patchToolAlias}
                />

                <ConfirmDialog
                    open={dialog.kind === "item-delete" || dialog.kind === "ws-delete"}
                    title={
                        dialog.kind === "ws-delete"
                            ? t("ws.deleteTitle")
                            : dialog.kind === "item-delete"
                              ? `${t("menu.delete")}:${dialog.item.title}`
                              : ""
                    }
                    description={
                        dialog.kind === "ws-delete"
                            ? [
                                  t("ws.deleteHint"),
                                  deletingWorkspaceItemCount > 0
                                      ? `${t("ws.deleteItemsPrefix")}${deletingWorkspaceItemCount}${t("ws.deleteItemsSuffix")}`
                                      : "",
                                  deletingNoteCount > 0
                                      ? `${t("ws.deleteItemsPrefix")}${deletingNoteCount}${t("ws.deleteNotesSuffix")}`
                                      : "",
                              ]
                                  .filter(Boolean)
                                  .join(" ")
                            : undefined
                    }
                    onClose={() => setDialog({ kind: "none" })}
                    onConfirm={async () => {
                        if (dialog.kind === "ws-delete") {
                            await deleteWorkspace(dialog.workspace);
                        } else if (dialog.kind === "item-delete") {
                            await mutate(() => api.deleteItem(dialog.item.id), t("toast.deleted"));
                        }
                    }}
                />
            </div>
        </TooltipProvider>
    );
}
