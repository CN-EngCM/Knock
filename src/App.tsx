import { Suspense, lazy, useCallback, Dispatch, useEffect, useMemo, useRef, SetStateAction, useState } from "react";
import { Toaster, toast } from "sonner";
import { Check, Pencil, Pin, PinOff, Plus, Settings } from "lucide-react";
import { DndContext, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, verticalListSortingStrategy } from "@dnd-kit/sortable";
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
    type ToolAliasPatch,
    type TranslateConfigPatch,
} from "./api/client";
import { AsciiSplash } from "./components/AsciiSplash";
import { GroupPanel } from "./components/GroupPanel";
import { SearchBox } from "./components/SearchBox";
import { Splitter } from "./components/Splitter";
import { ToolsMenu } from "./components/ToolsMenu";
import { ToolsZone } from "./components/ToolsZone";
import type { ToolId } from "./tools/registry";
import { clearToolInput, dispatchToolInput } from "./tools/toolInput";
import { ItemDialog, type ItemFormValues } from "./components/dialogs/ItemDialog";
import type { TermSession } from "./components/TerminalZone";
import { GroupDialog } from "./components/dialogs/GroupDialog";
import { ConfirmDialog } from "./components/dialogs/ConfirmDialog";
import { ImportDialog } from "./components/dialogs/ImportDialog";
import { SettingsDialog, type SectionId } from "./components/dialogs/SettingsDialog";
import { useDragSensors } from "./lib/dnd";
import { applyFonts } from "./lib/fonts";
import { useI18n } from "./i18n/useI18n";

// 终端会话宿主懒加载：xterm 体积不小，首屏用不到就不进主 chunk（拆分由 Vite 自动完成）
const TerminalZone = lazy(() => import("./components/TerminalZone").then((m) => ({ default: m.TerminalZone })));

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
    | { kind: "items-bulk-delete"; ids: number[] }
    | { kind: "import" }
    // section：设置页打开时直接定位的分节（工具内「打开设置」引导用；缺省回基础设置）
    | { kind: "settings"; section?: SectionId };

// ── 布局状态：侧栏宽度 / 侧栏显隐 ──
// 与界面语言一样存 localStorage——布局偏好属于本机个人设置，不进 SQLite。
type Layout = {
    sidebarW: number;
    sidebarVisible: boolean;
};

function loadLayout(): Layout {
    const fallback: Layout = { sidebarW: 290, sidebarVisible: true };
    try {
        const raw = localStorage.getItem("mypage-layout");
        if (!raw) return fallback;
        const s = JSON.parse(raw) as Partial<Layout>;
        return {
            sidebarW: typeof s.sidebarW === "number" ? Math.min(480, Math.max(230, s.sidebarW)) : fallback.sidebarW,
            sidebarVisible: s.sidebarVisible !== false,
        };
    } catch {
        return fallback;
    }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

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
    const [editing, setEditing] = useState(false);
    const [serverOk, setServerOk] = useState<boolean | null>(null);
    const [groups, setGroups] = useState<Group[]>([]);
    const [items, setItems] = useState<Item[]>([]);
    const [dialog, setDialog] = useState<DialogState>({ kind: "none" });
    // 编辑模式多选删除：勾中的条目 id 集（退出编辑清空；数据刷新后自动剔除已删 id）
    const [selectedIds, setSelectedIds] = useState<ReadonlySet<number>>(new Set());
    const toggleSelect = useCallback((id: number) => {
        setSelectedIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }, []);
    const [platform, setPlatform] = useState("");
    const [layout, setLayout] = useState<Layout>(loadLayout);
    // 已打开工具是纯运行时状态：每次启动强制从空开始，不落盘不还原（用户决策）
    const [openTools, setOpenTools] = useState<ToolId[]>([]);
    // 激活页签：工具 id（字符串）或终端会话 id（数字），null = 无激活。
    // 单一状态源避免「工具与会话各自记激活」的不可能态
    const [activeTab, setActiveTab] = useState<ToolId | number | null>(null);
    // 终端会话清单（tab 行里的一等 tab）：spawn 成功进、关 tab / shell 自退出；
    // TerminalZone 随清单挂载/卸载，xterm 实例归它管
    const [termSessions, setTermSessions] = useState<TermSession[]>([]);
    // 终端设置（shell/字号）：字号喂 TerminalZone，设置页改这里再落库
    const [termCfg, setTermCfg] = useRpcValue(api.getTermConfig);
    // 字体设置（界面/等宽）：applyFonts 写 CSS 变量全局生效；等宽栈再以 props 流给终端
    const [fontCfg, setFontCfg] = useRpcValue(api.getFontConfig);
    const dragSensors = useDragSensors();

    // 布局持久化（拖完分栏松手时才写，写盘频率无压力）
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
    // 渲染端只管展示与切换，隐藏判定在主进程（electron/main.ts 的 blur 处理）；
    // 呼出事件即「新一轮会话」：与主进程的隐藏清钉对齐，双方各自重置为未钉
    const [pinned, setPinned] = useState(false);
    useEffect(() => window.knock.onFocusSearch(() => setPinned(false)), []);
    const togglePin = useCallback(() => {
        setPinned((p) => {
            window.knock.setPinned(!p);
            return !p;
        });
    }, []);

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

    // 设置页提交终端设置：成功回填配置（字号由 props 流到 TerminalZone 即时生效）
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

    function reorderItems(groupId: number, next: Item[]) {
        setItems((prev) => [
            ...prev.filter((i) => i.group_id !== groupId),
            ...next.map((item, index) => ({ ...item, position: index })),
        ]);
        api.reorder({ items: next.map((i) => ({ id: i.id, group_id: groupId })) }).then((r) => {
            if (!r.ok) {
                toast.error(t("toast.error"));
                refresh();
            }
        });
    }

    function handleGroupDragEnd(e: DragEndEvent) {
        const { active, over } = e;
        if (!over || active.id === over.id) return;
        const oldIndex = groups.findIndex((g) => g.id === active.id);
        const newIndex = groups.findIndex((g) => g.id === over.id);
        if (oldIndex < 0 || newIndex < 0) return;
        reorderGroups(arrayMove(groups, oldIndex, newIndex));
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

    // 选择集维护：数据刷新后剔除已不存在的 id（组删除/单条删除的级联清理由此兜住）
    useEffect(() => {
        setSelectedIds((prev) => {
            if (prev.size === 0) return prev;
            const live = new Set(items.map((i) => i.id));
            const next = new Set([...prev].filter((id) => live.has(id)));
            return next.size === prev.size ? prev : next;
        });
    }, [items]);

    // 退出编辑模式即清空选择
    useEffect(() => {
        if (!editing) setSelectedIds((prev) => (prev.size === 0 ? prev : new Set()));
    }, [editing]);

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

    // ── 分组视图数据：组内按 position 排序 ──
    // （搜索已改为顶栏下拉候选，侧栏不再实时过滤）
    const grouped = useMemo(
        () =>
            groups.map((group) => ({
                group,
                items: items.filter((i) => i.group_id === group.id).sort((a, b) => a.position - b.position),
            })),
        [groups, items],
    );

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

    // ── 工具生命周期：菜单/搜索候选打开 / 点 tab 切换 / 点 × 关闭（卸载释放）──
    // input 非空 = 带素材打开：素材落模块级 pending，组件挂载时消费 + 事件覆盖
    // 已开的 tab（双通道与时序问题见 tools/toolInput.ts）；裸开则清残留素材。
    // expertId 仅 ai 工具有意义（进入指定专家）；它与 input 相互独立，
    // 「只有专家、没有素材」同样要过注入通道，让组件收到新注入的边沿信号
    function openTool(id: ToolId, input?: string | null, expertId?: number) {
        setOpenTools((cur) => (cur.includes(id) ? cur : [...cur, id]));
        setActiveTab(id);
        if (input != null || expertId != null) dispatchToolInput({ tool: id, text: input ?? "", expertId });
        else clearToolInput(id);
    }

    function closeTool(id: ToolId) {
        const next = openTools.filter((x) => x !== id);
        setOpenTools(next);
        // 关掉活动工具 tab：回落最后剩余工具，其次最后一枚会话 tab
        setActiveTab((cur) => (cur === id ? (next.at(-1) ?? termSessions.at(-1)?.id ?? null) : cur));
    }

    // ── 终端会话生命周期：会话是 tab 行的一等 tab，清单与激活都在这里 ──

    // 开新会话（tab 行 ＋ / 终端命令条目共用）：成功即入清单并激活；
    // 命令条目带 cwd/label/整行命令，会话建好后整行写入回车执行
    async function spawnSession(req?: { cwd?: string; label?: string; command?: string }) {
        const r = await api.ptySpawn(req ? { cwd: req.cwd, label: req.label } : undefined);
        if (!r.ok) {
            // 命令条目的工作目录不存在：与 App 启动失败同口径（launch.missing + 路径）
            if (r.error.kind === "missing") toast.error(`${t("launch.missing")}: ${r.error.path}`);
            else toast.error(t("toast.error"));
            return;
        }
        setTermSessions((prev) => [...prev, { id: r.data.id, label: r.data.label }]);
        setActiveTab(r.data.id);
        if (req?.command) void api.ptyWrite(r.data.id, `${req.command}\r`);
    }

    // 关会话 tab：移出清单（TerminalZone 随之 dispose 该 xterm）+ 结束 pty；
    // 若它正持有活动权，由下方兜底 effect 回落
    function closeSession(id: number) {
        setTermSessions((prev) => prev.filter((s) => s.id !== id));
        void api.ptyKill(id);
    }

    // shell 自己退出（exit / 进程崩溃）：从清单移除；xterm 实例由 TerminalZone
    // 的清单收缩 effect dispose（preload 的 onPtyEvent 支持多订阅者）
    useEffect(() => {
        const off = onPtyEvent((e) => {
            if (e.type === "exit") setTermSessions((prev) => prev.filter((s) => s.id !== e.id));
        });
        return off;
    }, []);

    // 活动页签指向已不存在的会话（关 tab / shell 自退）时回落：
    // 最后一枚会话 → 最后一个工具 → 无激活（右列空态）
    useEffect(() => {
        if (typeof activeTab === "number" && !termSessions.some((s) => s.id === activeTab)) {
            setActiveTab(termSessions.at(-1)?.id ?? openTools.at(-1) ?? null);
        }
    }, [activeTab, termSessions, openTools]);

    // 终端 chunk 预取：spawn 现在先于 TerminalZone 挂载（App 直接调 ptySpawn），
    // 首个会话的 shell 横幅若落在 lazy chunk 的加载窗口会被丢掉，闲时预载规避
    useEffect(() => {
        const id = requestIdleCallback(() => void import("./components/TerminalZone"));
        return () => cancelIdleCallback(id);
    }, []);

    const sidebarGroups = (editing: boolean) =>
        grouped.map(({ group, items: groupItems }) => (
            <GroupPanel
                key={group.id}
                group={group}
                items={groupItems}
                editing={editing}
                selectedIds={selectedIds}
                onToggleSelect={toggleSelect}
                onAddItem={(g) => setDialog({ kind: "item-create", groupId: g.id })}
                onRename={(g) => setDialog({ kind: "group-rename", group: g })}
                onDelete={(g) => setDialog({ kind: "group-delete", group: g })}
                onOpen={openItem}
                onEdit={(item) => setDialog({ kind: "item-edit", item })}
                onDeleteItem={(item) => setDialog({ kind: "item-delete", item })}
                onReorderItems={reorderItems}
            />
        ));

    return (
        /* 窗口本体即玻璃浮窗(设计稿里玻璃外的极光矩形是画布背景,不做进应用)。
           拖拽区:玻璃底默认 app-drag(顶栏空处/面板间隙/空态区可拖),面板与
           交互区一律 app-no-drag 豁免 */
        <div className="flex h-screen flex-col overflow-hidden font-sans text-text">
            <Toaster
                position="bottom-center"
                toastOptions={{
                    style: {
                        background: "var(--surface-raised)",
                        color: "var(--text)",
                        border: "1px solid rgba(255, 255, 255, 0.16)",
                        borderRadius: "12px",
                        fontFamily: "inherit",
                    },
                }}
            />

            <div className="knock-glass app-drag relative flex min-h-0 flex-1 flex-col overflow-hidden">
                <div className="knock-glow" aria-hidden />

                {/* 顶栏一行六件:品牌 + 过滤输入(占满剩余宽) + 工具菜单 + 新建终端 + 钉住 + 设置
                    (工具菜单/新建终端用户定移顶栏,原 tab 栏右簇;顶栏高度由搜索胶囊撑出
                    ——SearchBar 与 TitleBar 同高 46,pt-4 让胶囊顶边距 = 工作区四周的
                    16px,不再垂直居中出 5px 贴顶缝。z-20 必须高于工作区的 z-10:搜索
                    下拉悬出顶栏范围,同 z 会整树输给后出现的兄弟节点) */}
                <header className="relative z-20 flex flex-none items-center gap-3 pt-4 pr-4 pl-5">
                    <span className="select-none text-[14.5px] font-semibold tracking-wide text-white">敲敲 Knock</span>
                    <div className="app-no-drag flex min-w-0 flex-1 items-center">
                        <SearchBox
                            groups={groups}
                            items={items}
                            // 别名未拉到（null）时按空表处理：搜索不该等设置项就绪
                            toolAliases={toolAliases ?? {}}
                            onOpenItem={openItem}
                            onOpenTool={openTool}
                            onOpenPath={openLocalPath}
                        />
                    </div>
                    <ToolsMenu open={openTools} onOpen={openTool} />
                    <button
                        type="button"
                        className="icon-btn app-no-drag"
                        onClick={() => void spawnSession()}
                        title={t("term.new")}
                    >
                        <Plus size={14} />
                    </button>
                    <button
                        type="button"
                        className="icon-btn app-no-drag"
                        aria-pressed={pinned}
                        onClick={togglePin}
                        title={t(pinned ? "btn.unpin" : "btn.pin")}
                    >
                        {pinned ? <PinOff size={14} /> : <Pin size={14} />}
                    </button>
                    <button
                        type="button"
                        className="icon-btn app-no-drag"
                        onClick={() => setDialog({ kind: "settings" })}
                        title={t("btn.settings")}
                    >
                        <Settings size={14} />
                    </button>
                </header>

                {serverOk === false || groups.length === 0 ? (
                    /* 断线态 / 冷启动空态：玻璃面板占满工作区居中提示 */
                    <main className="glass-panel app-no-drag relative z-10 m-4 mt-2.5 flex min-h-0 flex-1 flex-col items-center justify-center gap-4 text-dim">
                        {groups.length === 0 && serverOk !== false ? (
                            <>
                                <span className="text-[13px]">{t("group.none")}</span>
                                <button
                                    type="button"
                                    className="tbtn border border-line px-4 py-2 hover:bg-faint"
                                    onClick={() => setDialog({ kind: "group-create" })}
                                >
                                    [ {t("group.noneBtn")} ]
                                </button>
                            </>
                        ) : (
                            <>
                                <span className="text-[13px] tracking-wide">──[ {t("offline.title")} ]──</span>
                                <span className="max-w-[460px] text-center text-[12.5px] text-muted">
                                    {t("offline.hint")}
                                </span>
                                <button
                                    type="button"
                                    className="tbtn border border-line px-4 py-2 hover:bg-faint"
                                    onClick={() => refresh()}
                                >
                                    [ {t("offline.retry")} ]
                                </button>
                            </>
                        )}
                    </main>
                ) : (
                    /* 两栏工作区：左=启动面板(全部分组平铺,可整栏收起),右=tab 区
                       （工具与终端会话共用一条 tab 行，各是一等 tab）。
                       本容器继承玻璃底的 app-drag:面板间空隙与右列空态可拖窗口,
                       两个面板自身各自 app-no-drag 豁免 */
                    <div className="relative z-10 flex min-h-0 flex-1 gap-1.5 p-4 pt-2.5">
                        {layout.sidebarVisible && (
                            <aside
                                className="glass-panel app-no-drag flex flex-none flex-col overflow-hidden"
                                style={{ width: layout.sidebarW }}
                            >
                                <div className="min-h-0 flex-1 overflow-y-auto px-2.5 py-2.5">
                                    {editing ? (
                                        /* 编辑模式：分组可拖拽排序，末尾出现新建分组块 */
                                        <DndContext sensors={dragSensors} onDragEnd={handleGroupDragEnd}>
                                            <SortableContext
                                                items={groups.map((g) => g.id)}
                                                strategy={verticalListSortingStrategy}
                                            >
                                                {sidebarGroups(true)}
                                                <button
                                                    className="mt-1 flex items-center justify-center rounded-[10px] border border-dashed border-line px-3 py-2.5 text-[12.5px] text-muted transition-colors hover:text-text"
                                                    onClick={() => setDialog({ kind: "group-create" })}
                                                >
                                                    ＋ {t("group.new")}
                                                </button>
                                            </SortableContext>
                                        </DndContext>
                                    ) : (
                                        sidebarGroups(false)
                                    )}
                                </div>

                                {/* 面板脚：编辑开关常驻；编辑中勾了条目时多选操作条挪到这里 */}
                                <div className="flex flex-none items-center gap-2 border-t border-white/10 px-2.5 py-1.5">
                                    <button
                                        type="button"
                                        className="ghost-btn"
                                        aria-pressed={editing}
                                        onClick={() => setEditing((v) => !v)}
                                        title={editing ? t("btn.editing") : t("btn.edit")}
                                    >
                                        {editing ? <Check size={14} /> : <Pencil size={14} />}
                                    </button>
                                    {editing && selectedIds.size > 0 && (
                                        <>
                                            <span className="text-[12px] text-dim">
                                                {t("edit.selected")}: {selectedIds.size}
                                            </span>
                                            <span className="flex items-center gap-2">
                                                <button
                                                    type="button"
                                                    className="tbtn"
                                                    onClick={() => setSelectedIds(new Set())}
                                                >
                                                    [ {t("edit.clear")} ]
                                                </button>
                                                <button
                                                    type="button"
                                                    className="tbtn"
                                                    onClick={() =>
                                                        setDialog({ kind: "items-bulk-delete", ids: [...selectedIds] })
                                                    }
                                                >
                                                    [ {t("edit.deleteSelected")} ]
                                                </button>
                                            </span>
                                        </>
                                    )}
                                </div>
                            </aside>
                        )}

                        {layout.sidebarVisible && (
                            <Splitter
                                orientation="vertical"
                                onDrag={(e) => setLayout((l) => ({ ...l, sidebarW: clamp(e.clientX, 230, 480) }))}
                            />
                        )}

                        <div className="flex min-w-0 flex-1 flex-col">
                            {openTools.length === 0 && termSessions.length === 0 ? (
                                /* 右列全空（无工具无会话）→ ASCII 标志占位 */
                                <AsciiSplash />
                            ) : (
                                <ToolsZone
                                    open={openTools}
                                    active={activeTab}
                                    onActivate={setActiveTab}
                                    onClose={closeTool}
                                    sidebarVisible={layout.sidebarVisible}
                                    onToggleSidebar={() =>
                                        setLayout((l) => ({ ...l, sidebarVisible: !l.sidebarVisible }))
                                    }
                                    onOpenSettings={() =>
                                        setDialog({
                                            kind: "settings",
                                            // 引导分节跟随当前激活工具（translate/ai 有缺配置态）
                                            section:
                                                (typeof activeTab === "string" && TOOL_SETTINGS_SECTION[activeTab]) ||
                                                "translate",
                                        })
                                    }
                                    sessions={termSessions}
                                    onActivateSession={setActiveTab}
                                    onCloseSession={closeSession}
                                >
                                    {/* 会话 xterm 宿主：随首个会话挂载、末个会话结束卸载；
                        激活的是工具时仅 display:none（切回不丢屏幕与回滚缓冲） */}
                                    {termSessions.length > 0 && (
                                        <Suspense fallback={null}>
                                            <TerminalZone
                                                sessions={termSessions}
                                                activeId={typeof activeTab === "number" ? activeTab : null}
                                                monoFont={fontCfg?.monoFont ?? ""}
                                                fontSize={termCfg?.fontSize ?? 13}
                                            />
                                        </Suspense>
                                    )}
                                </ToolsZone>
                            )}
                        </div>
                    </div>
                )}
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
                    dialog.kind === "group-delete" ||
                    dialog.kind === "item-delete" ||
                    dialog.kind === "items-bulk-delete"
                }
                title={
                    dialog.kind === "group-delete"
                        ? `${t("group.delete")}：${dialog.group.name}`
                        : dialog.kind === "item-delete"
                          ? `${t("menu.delete")}:${dialog.item.title}`
                          : dialog.kind === "items-bulk-delete"
                            ? `${t("edit.deleteSelected")}: ${dialog.ids.length}`
                            : ""
                }
                description={
                    dialog.kind === "group-delete"
                        ? t("group.deleteHint")
                        : dialog.kind === "items-bulk-delete"
                          ? t("edit.deleteSelectedHint")
                          : undefined
                }
                onClose={() => setDialog({ kind: "none" })}
                onConfirm={async () => {
                    if (dialog.kind === "group-delete") {
                        await mutate(() => api.deleteGroup(dialog.group.id), t("toast.deleted"));
                    } else if (dialog.kind === "item-delete") {
                        await mutate(() => api.deleteItem(dialog.item.id), t("toast.deleted"));
                    } else if (dialog.kind === "items-bulk-delete") {
                        // 批量删除：并行调 deleteItem（个人规模无需专用批量端点），全成才算成功
                        try {
                            const rs = await Promise.all(dialog.ids.map((id) => api.deleteItem(id)));
                            if (rs.some((r) => !r.ok)) throw new Error("bulk-delete");
                            await refresh();
                            setSelectedIds(new Set());
                            toast.success(t("toast.deleted"));
                        } catch {
                            toast.error(t("toast.error"));
                        }
                    }
                }}
            />
        </div>
    );
}
