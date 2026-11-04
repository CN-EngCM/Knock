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
    type Workspace,
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
import { ToolsMenu } from "./components/ToolsMenu";
import { ToolHome } from "./components/ToolHome";
import { WorkspaceBar } from "./components/WorkspaceBar";
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
import { cleanTermTitle } from "./lib/termTitle";
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
    | { kind: "ws-rename"; workspace: Workspace }
    | { kind: "ws-delete"; workspace: Workspace }
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
    // 本机目录条目 id：file 类型同时表示文件与文件夹，只能运行时 stat 判定，
    // 右键菜单据此决定要不要显示「在此打开终端」一组
    const [dirIds, setDirIds] = useState<ReadonlySet<number>>(() => new Set());
    const [dialog, setDialog] = useState<DialogState>({ kind: "none" });
    const [platform, setPlatform] = useState("");
    const [layout, setLayout] = useState<Layout>(loadLayout);
    // 排序模式：开启才显示启动列表的拖拽把手（运行时状态，不持久化，默认关）
    const [sortMode, setSortMode] = useState(false);
    // 界面主题：初始值来自 main.tsx 首帧前套好的 <html> 类；切换经 settings 表持久化
    const [theme, setTheme] = useState<ThemeId>(currentTheme);
    // ── 工作区：每个工作区一套独立的停靠区实例，同一时刻只显示当前那个 ──
    // 数据以服务端为准（activeId 落库在 settings 表）：切换成功后重拉，界面不自留副本
    const [wsData, setWsData] = useRpcValue(api.getWorkspaces);
    const activeWorkspaceId = wsData?.activeId ?? null;
    // 切换工作区：先落库再重拉；停靠区实例常驻，切换只是换显示，不动任何面板与终端
    const switchWorkspace = useCallback(
        async (id: number) => {
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

    // 新建：名字里的编号取「工作区 N」中第一个没被占用的（删掉 1 之后新建会重新用上 1）；
    // 建成后自动切过去，界面只认最后一次拉取的结果
    const createWorkspace = useCallback(async () => {
        const used = new Set((wsData?.workspaces ?? []).filter((w) => !w.builtin).map((w) => w.name));
        let n = 1;
        while (used.has(`${t("ws.defaultName")} ${n}`)) n += 1;
        const created = await api.createWorkspace(`${t("ws.defaultName")} ${n}`);
        if (!created.ok) {
            toast.error(t("toast.error"));
            return;
        }
        await refreshWorkspaces();
        const active = await api.setActiveWorkspace(created.data.id);
        if (!active.ok) toast.error(t("toast.error"));
        await refreshWorkspaces();
    }, [wsData, t, refreshWorkspaces]);

    // 改名：服务端 trim 后校验 1..40 字，成功重拉列表
    async function renameWorkspace(workspace: Workspace, name: string) {
        const r = await api.renameWorkspace(workspace.id, name);
        if (!r.ok) {
            toast.error(t("toast.error"));
            return;
        }
        await refreshWorkspaces();
    }

    // 工具区停靠容器：首次打开面板时挂载（懒加载 dockview），此后常驻——面板清空
    // 由 dock 空态水印（ToolHome）兜底。已开面板与布局是纯运行时状态，不落盘不还原（用户决策）
    const [dockWanted, setDockWanted] = useState(false);
    // dock 命令桥：面板开/关/激活都走所属工作区的 dockview api；该工作区实例懒加载就绪前的
    // 调用按工作区分队列，onReady 只冲刷自己那一条
    const dockCtl = useRef<{
        apis: Map<number, DockviewApi>;
        queues: Map<number, Array<(api: DockviewApi) => void>>;
    }>({ apis: new Map(), queues: new Map() });
    // 每个工作区的终端数：dockview 是命令式 api，面板增删不会让 React 重渲染，
    // 这里在面板增删事件里重算，供侧栏的工作区列表显示
    const [termCounts, setTermCounts] = useState<Record<number, number>>({});
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

    // ── 文件夹条目：在应用内终端打开该目录（标签名取文件夹名），opencode / claude
    //    作为会话首条命令送入。目录不存在由 spawnSession 按 launch.missing 提示。
    //    名字按标签上限截断，ptySpawn 的 label 本身也有长度上限 ──
    function openInTerminal(item: Item, command?: "opencode" | "claude") {
        const trimmed = item.target.replace(/[\\/]+$/, "");
        const folder = cleanTermTitle(trimmed.split(/[\\/]/).pop() || item.target) ?? item.target;
        void spawnSession({ cwd: item.target, label: command ? `${command} · ${folder}` : folder, command });
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
        if (id === "terminal") {
            void spawnSession();
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
        // 没有当前工作区就不起会话：pty 起来了却没有面板接，等于留一个看不见的 shell
        const ws = activeWorkspaceId;
        if (ws === null) return;
        const r = await api.ptySpawn(req ? { cwd: req.cwd, label: req.label } : undefined);
        if (!r.ok) {
            // 命令条目的工作目录不存在：与 App 启动失败同口径（launch.missing + 路径）
            if (r.error.kind === "missing") toast.error(`${t("launch.missing")}: ${r.error.path}`);
            else toast.error(t("toast.error"));
            return;
        }
        setDockWanted(true);
        whenDockApi(ws, (dock) => {
            dock.addPanel({
                id: `term:${r.data.id}`,
                component: "term",
                title: r.data.label,
                params: { sessionId: r.data.id },
            });
        });
        if (req?.command) void api.ptyWrite(r.data.id, `${req.command}\r`);
    }

    // dock 就绪：存下这个工作区的实例、冲刷它排队的命令；面板移除善后按实例各挂一次
    // （终端面板 = 结束 pty + 释放 xterm 实例，工具面板组件自卸载无需善后）
    const handleDockReady = useCallback((workspaceId: number, dock: DockviewApi) => {
        const ctl = dockCtl.current;
        ctl.apis.set(workspaceId, dock);
        // 终端数只能按实例现状重算：面板增删发生在 dockview 内部，React 收不到通知；
        // 数字没变就返回原对象，避免每次面板增删都触发一轮无意义的渲染
        const syncTermCount = () => {
            const count = dock.panels.filter((panel) => panel.id.startsWith("term:")).length;
            setTermCounts((prev) => (prev[workspaceId] === count ? prev : { ...prev, [workspaceId]: count }));
        };
        dock.onDidAddPanel(() => syncTermCount());
        dock.onDidRemovePanel((panel) => {
            if (!panel.id.startsWith("term:")) return;
            syncTermCount();
            const id = Number(panel.id.slice(5));
            void api.ptyKill(id);
            disposeTerm(id);
        });
        // 监听先挂好再冲刷队列：实例就绪前排队的面板也要计进终端数；末尾再对齐一次现状
        ctl.queues
            .get(workspaceId)
            ?.splice(0)
            .forEach((fn) => fn(dock));
        ctl.queues.delete(workspaceId);
        syncTermCount();
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
        // 工作区没了，它名下的终端数也没有意义，顺手清掉，免得表里越积越多
        setTermCounts((prev) => {
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
        await refreshWorkspaces();
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

    // 终端字体/字号：termStore 直改实例并重排，不经过面板 props
    useEffect(() => {
        setTermFont(fontCfg?.monoFont ?? "", termCfg?.fontSize ?? 13);
    }, [fontCfg, termCfg]);

    // dock chunk 闲时预取：首个面板打开不用现等 dockview 下载
    useEffect(() => {
        const id = requestIdleCallback(() => void import("./components/DockZone"));
        return () => cancelIdleCallback(id);
    }, []);

    // 工具内「打开设置」引导：分节跟随当前工作区实例里激活的工具面板（translate/ai 有缺配置态）
    function openSettingsForActiveTool() {
        const dock = activeWorkspaceId === null ? undefined : dockCtl.current.apis.get(activeWorkspaceId);
        const active = dock?.activePanel?.id;
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
                                        dirIds={dirIds}
                                        onOpenInTerminal={openInTerminal}
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

                            {/* 工作区块固定在侧栏底部：侧栏隐藏时跟着消失，不另做入口 */}
                            <WorkspaceBar
                                workspaces={wsData?.workspaces ?? []}
                                activeId={activeWorkspaceId}
                                termCounts={termCounts}
                                onSwitch={(id) => void switchWorkspace(id)}
                                onCreate={() => void createWorkspace()}
                                onRename={(workspace) => setDialog({ kind: "ws-rename", workspace })}
                                onDelete={(workspace) => setDialog({ kind: "ws-delete", workspace })}
                            />
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
                                    workspaces={wsData.workspaces.map((w) => w.id)}
                                    activeId={wsData.activeId}
                                    onReady={handleDockReady}
                                    onOpenTool={openTool}
                                    onOpenSettings={openSettingsForActiveTool}
                                />
                            </Suspense>
                        ) : (
                            /* 冷启动空态：dock 未挂载不加载 dockview，首页卡片与搜索即入口 */
                            <div className="h-full min-h-0">
                                <ToolHome onOpen={openTool} />
                            </div>
                        )}
                    </main>
                </div>

                {/* ── 弹窗区 ── */}
                <GroupDialog
                    open={
                        dialog.kind === "group-create" || dialog.kind === "group-rename" || dialog.kind === "ws-rename"
                    }
                    initialName={
                        dialog.kind === "group-rename"
                            ? dialog.group.name
                            : dialog.kind === "ws-rename"
                              ? dialog.workspace.name
                              : null
                    }
                    title={dialog.kind === "ws-rename" ? t("ws.rename") : undefined}
                    label={dialog.kind === "ws-rename" ? t("common.name") : undefined}
                    maxLength={dialog.kind === "ws-rename" ? 40 : undefined}
                    onClose={() => setDialog({ kind: "none" })}
                    onSubmit={
                        dialog.kind === "group-rename"
                            ? (name) => mutate(() => api.renameGroup(dialog.group.id, name), t("toast.saved"))
                            : dialog.kind === "ws-rename"
                              ? (name) => renameWorkspace(dialog.workspace, name)
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
                    open={
                        dialog.kind === "group-delete" || dialog.kind === "item-delete" || dialog.kind === "ws-delete"
                    }
                    title={
                        dialog.kind === "ws-delete"
                            ? t("ws.deleteTitle")
                            : dialog.kind === "group-delete"
                              ? `${t("group.delete")}：${dialog.group.name}`
                              : dialog.kind === "item-delete"
                                ? `${t("menu.delete")}:${dialog.item.title}`
                                : ""
                    }
                    description={
                        dialog.kind === "ws-delete"
                            ? t("ws.deleteHint")
                            : dialog.kind === "group-delete"
                              ? t("group.deleteHint")
                              : undefined
                    }
                    onClose={() => setDialog({ kind: "none" })}
                    onConfirm={async () => {
                        if (dialog.kind === "ws-delete") {
                            await deleteWorkspace(dialog.workspace);
                        } else if (dialog.kind === "group-delete") {
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
