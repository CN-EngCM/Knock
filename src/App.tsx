import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Toaster, toast } from "sonner";
import { Check, Pencil, Settings, Terminal } from "lucide-react";
import { DndContext, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, verticalListSortingStrategy } from "@dnd-kit/sortable";
import {
    api,
    type ApiResult,
    type Group,
    type Item,
    type TermConfig,
    type TermPatch,
    type ToolAliasPatch,
    type ToolAliases,
} from "./api/client";
import { AsciiSplash } from "./components/AsciiSplash";
import { GroupPanel } from "./components/GroupPanel";
import { SearchBox } from "./components/SearchBox";
import { Splitter } from "./components/Splitter";
import { ToolsMenu } from "./components/ToolsMenu";
import { ToolsZone } from "./components/ToolsZone";
import { TerminalZone } from "./components/TerminalZone";
import type { ToolId } from "./tools/registry";
import { clearToolInput, dispatchToolInput } from "./tools/toolInput";
import { ItemDialog, type ItemFormValues } from "./components/dialogs/ItemDialog";
import { GroupDialog } from "./components/dialogs/GroupDialog";
import { ConfirmDialog } from "./components/dialogs/ConfirmDialog";
import { ImportDialog } from "./components/dialogs/ImportDialog";
import { SettingsDialog } from "./components/dialogs/SettingsDialog";
import { useDragSensors } from "./lib/dnd";
import { useI18n } from "./i18n/useI18n";
import { applyTheme, initialTheme, saveTheme, type ThemeMode } from "./theme";

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
    | { kind: "settings" };

// ── 三区布局状态（v2.2）：侧栏宽度 / 终端高度 / 终端显隐 ──
// 与主题、语言一样存 localStorage——布局偏好属于本机个人设置，不进 SQLite。
type Layout = {
    sidebarW: number;
    termH: number;
    termVisible: boolean;
};

function loadLayout(): Layout {
    const fallback: Layout = { sidebarW: 300, termH: 230, termVisible: true };
    try {
        const raw = localStorage.getItem("mypage-layout");
        if (!raw) return fallback;
        const s = JSON.parse(raw) as Partial<Layout>;
        return {
            sidebarW: typeof s.sidebarW === "number" ? Math.min(480, Math.max(190, s.sidebarW)) : fallback.sidebarW,
            termH: typeof s.termH === "number" ? Math.min(600, Math.max(110, s.termH)) : fallback.termH,
            termVisible: s.termVisible !== false,
        };
    } catch {
        return fallback;
    }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export default function App() {
    const { t, lang, setLang } = useI18n();
    const [theme, setTheme] = useState<ThemeMode>(initialTheme);
    const [editing, setEditing] = useState(false);
    const [serverOk, setServerOk] = useState<boolean | null>(null);
    const [now, setNow] = useState(() => new Date());
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
    const [activeTool, setActiveTool] = useState<ToolId | null>(null);
    // 终端设置（shell/字体）与终端会话数：字体喂 TerminalZone，设置页改这里
    const [termCfg, setTermCfg] = useState<TermConfig | null>(null);
    // 启动不自动开会话（TerminalZone 已无 auto-spawn），从 false 起步避免空态闪错
    const [hasSessions, setHasSessions] = useState(false);
    const [termSpawnReq, setTermSpawnReq] = useState(0);
    const rightRef = useRef<HTMLDivElement>(null);
    const dragSensors = useDragSensors();

    useEffect(() => {
        applyTheme(theme);
        saveTheme(theme);
    }, [theme]);

    useEffect(() => {
        const id = setInterval(() => setNow(new Date()), 1000);
        return () => clearInterval(id);
    }, []);

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

    // 终端设置启动时拉一次：字体给 TerminalZone，shell 候选给设置页
    useEffect(() => {
        api.getTermConfig().then((r) => {
            if (r.ok) setTermCfg(r.data);
        });
    }, []);

    // 工具别名启动时拉一次：喂 SearchBox 参与候选匹配
    const [toolAliases, setToolAliases] = useState<ToolAliases>({});
    useEffect(() => {
        api.getToolAliases().then((r) => {
            if (r.ok) setToolAliases(r.data);
        });
    }, []);

    // 剪贴板素材时限（主进程每次呼出直接读库，这里的值只喂设置页展示）
    const [clipSec, setClipSec] = useState<number | null>(null);
    useEffect(() => {
        api.getClipPaste().then((r) => {
            if (r.ok) setClipSec(r.data.seconds);
        });
    }, []);

    async function patchClipSec(s: number): Promise<boolean> {
        try {
            const r = await api.setClipPaste(s);
            if (!r.ok) throw new Error(r.error.kind);
            setClipSec(r.data.seconds);
            return true;
        } catch {
            toast.error(t("toast.error"));
            return false;
        }
    }

    // 会话数上报回调必须稳定（TerminalZone 的 effect 依赖它），直接 setState 同值不触发重渲染
    const handleSessionCount = useCallback((n: number) => setHasSessions(n > 0), []);

    // 设置页提交终端设置：成功则回填配置（字体由 props 流到 TerminalZone 即时生效）
    async function patchTerm(p: TermPatch): Promise<boolean> {
        try {
            const r = await api.setTermConfig(p);
            if (!r.ok) throw new Error(r.error.kind);
            setTermCfg(r.data);
            return true;
        } catch {
            toast.error(t("toast.error"));
            return false;
        }
    }

    // 设置页提交工具别名：成功则回填（SearchBox 的候选匹配随 props 即时生效）
    async function patchToolAlias(p: ToolAliasPatch): Promise<boolean> {
        try {
            const r = await api.setToolAliases(p);
            if (!r.ok) throw new Error(r.error.kind);
            setToolAliases(r.data);
            return true;
        } catch {
            toast.error(t("toast.error"));
            return false;
        }
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

    // ── 打开条目：书签前端直开；应用/文件走后端启动器 ──
    async function openItem(item: Item) {
        if (item.kind === "bookmark") {
            window.open(item.target, "_blank", "noreferrer");
            return;
        }
        try {
            const r = await api.launch(item.id);
            if (!r.ok) {
                // 路径失效时错误里带具体路径（launcher.ts 约定）
                if (r.error.kind === "missing" || r.error.kind === "failed") {
                    toast.error(`${t("launch.missing")}: ${r.error.path}`);
                } else {
                    toast.error(t("toast.error"));
                }
            }
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
    // 已开的 tab（双通道与时序问题见 tools/toolInput.ts 注释）；裸开则清残留素材
    function openTool(id: ToolId, input?: string | null) {
        setOpenTools((cur) => (cur.includes(id) ? cur : [...cur, id]));
        setActiveTool(id);
        if (input != null) dispatchToolInput({ tool: id, text: input });
        else clearToolInput(id);
    }

    function closeTool(id: ToolId) {
        const next = openTools.filter((x) => x !== id);
        setOpenTools(next);
        setActiveTool((cur) => (cur === id ? (next.at(-1) ?? null) : cur));
    }

    const clock = [now.getHours(), now.getMinutes(), now.getSeconds()].map((n) => String(n).padStart(2, "0")).join(":");

    // 终端区实际显示 = 用户开关开着 且 还有会话（会话被关光时自动藏起）
    const showTerm = layout.termVisible && hasSessions;

    // 状态栏终端按钮：可见 → 隐藏；不可见 → 恢复，会话已被关光时顺带开一个新会话
    function toggleTerminal() {
        if (layout.termVisible && hasSessions) {
            setLayout((l) => ({ ...l, termVisible: false }));
            return;
        }
        setLayout((l) => ({ ...l, termVisible: true }));
        if (!hasSessions) setTermSpawnReq((n) => n + 1);
    }

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
        <div className="flex h-screen flex-col overflow-hidden bg-bg font-mono text-text">
            <div className="scanlines" aria-hidden="true" />
            <Toaster
                position="bottom-center"
                toastOptions={{
                    style: {
                        background: "var(--panel)",
                        color: "var(--text)",
                        border: "1px solid var(--line)",
                        borderRadius: "6px",
                        fontFamily: "inherit",
                    },
                }}
            />

            {/* 提示符行：$ 即搜索框（输入即出下拉候选，含工具）；右侧「工具 ▾」是内置工具另一入口 */}
            <header className="flex w-full flex-none flex-wrap items-center gap-2.5 px-6 pt-5 pb-2 text-[15px]">
                <span className="text-text">{t("prompt.user")}</span>
                <span className="text-dim">:~$</span>
                <SearchBox
                    groups={groups}
                    items={items}
                    toolAliases={toolAliases}
                    onOpenItem={openItem}
                    onOpenTool={openTool}
                />
                <ToolsMenu open={openTools} onOpen={openTool} />
            </header>

            {serverOk === false || groups.length === 0 ? (
                /* 断线态 / 冷启动空态：占满工作区居中提示 */
                <main className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 text-dim">
                    {groups.length === 0 && serverOk !== false ? (
                        <>
                            <span className="text-[13px]">{t("group.none")}</span>
                            <button
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
                                className="tbtn border border-line px-4 py-2 hover:bg-faint"
                                onClick={() => refresh()}
                            >
                                [ {t("offline.retry")} ]
                            </button>
                        </>
                    )}
                </main>
            ) : (
                /* 三区工作区：左=分组侧栏，右列上=工具区（有 tab 才出现），右列下=终端 */
                <div className="flex min-h-0 flex-1">
                    <aside className="flex flex-none flex-col overflow-y-auto pt-1" style={{ width: layout.sidebarW }}>
                        {editing ? (
                            /* 编辑模式：分组可拖拽排序，末尾出现新建分组块 */
                            <DndContext sensors={dragSensors} onDragEnd={handleGroupDragEnd}>
                                <SortableContext items={groups.map((g) => g.id)} strategy={verticalListSortingStrategy}>
                                    {sidebarGroups(true)}
                                    <button
                                        className="mx-2.5 mt-2 flex items-center justify-center border border-dashed border-line px-3 py-2.5 text-[12.5px] text-muted hover:text-text"
                                        onClick={() => setDialog({ kind: "group-create" })}
                                    >
                                        ＋ {t("group.new")}
                                    </button>
                                </SortableContext>
                            </DndContext>
                        ) : (
                            sidebarGroups(false)
                        )}

                        {/* 编辑模式多选操作条：勾了条目才出现，吸在侧栏滚动区底部 */}
                        {editing && selectedIds.size > 0 && (
                            <div className="sticky bottom-0 z-10 flex flex-none items-center justify-between gap-2 border-t border-line bg-panel px-3 py-1.5 text-[12.5px]">
                                <span className="text-dim">
                                    {t("edit.selected")}: {selectedIds.size}
                                </span>
                                <span className="flex items-center gap-2">
                                    <button type="button" className="tbtn" onClick={() => setSelectedIds(new Set())}>
                                        [ {t("edit.clear")} ]
                                    </button>
                                    <button
                                        type="button"
                                        className="tbtn"
                                        onClick={() => setDialog({ kind: "items-bulk-delete", ids: [...selectedIds] })}
                                    >
                                        [ {t("edit.deleteSelected")} ]
                                    </button>
                                </span>
                            </div>
                        )}
                    </aside>

                    <Splitter
                        orientation="vertical"
                        onDrag={(e) => setLayout((l) => ({ ...l, sidebarW: clamp(e.clientX, 190, 480) }))}
                    />

                    <div ref={rightRef} className="flex min-w-0 flex-1 flex-col">
                        {openTools.length > 0 && (
                            <ToolsZone
                                open={openTools}
                                active={activeTool}
                                onActivate={setActiveTool}
                                onClose={closeTool}
                            />
                        )}
                        {openTools.length > 0 && showTerm && (
                            <Splitter
                                orientation="horizontal"
                                onDrag={(e) => {
                                    const bottom = rightRef.current?.getBoundingClientRect().bottom;
                                    if (!bottom) return;
                                    setLayout((l) => ({ ...l, termH: clamp(bottom - e.clientY, 110, bottom - 200) }));
                                }}
                            />
                        )}
                        {/* 终端区常驻挂载（会话与回滚缓冲不因隐藏而丢），无会话或被关闭时仅 display:none */}
                        <section
                            className={openTools.length > 0 ? "flex-none" : "min-h-0 flex-1"}
                            style={{
                                height: openTools.length > 0 ? layout.termH : undefined,
                                display: showTerm ? undefined : "none",
                            }}
                        >
                            <TerminalZone
                                theme={theme}
                                visible={showTerm}
                                font={termCfg?.font ?? ""}
                                fontSize={termCfg?.fontSize ?? 13}
                                spawnReq={termSpawnReq}
                                onSessionCount={handleSessionCount}
                                onHide={() => setLayout((l) => ({ ...l, termVisible: false }))}
                            />
                        </section>
                        {/* 右列全空（无工具无终端）→ ASCII 标志占位 */}
                        {openTools.length === 0 && !showTerm && <AsciiSplash />}
                    </div>
                </div>
            )}

            {/* tmux 式状态栏：编辑开关、终端开关与设置入口收在右侧图标按钮 */}
            <footer className="sticky bottom-0 flex flex-none flex-wrap items-center justify-between gap-3 border-t border-line bg-panel px-4 py-1.5 text-xs text-dim">
                <span>
                    {t("status.version")} | {lang.toUpperCase()}
                </span>
                <span className="flex items-center gap-1.5">
                    <span>
                        {serverOk === null ? "…" : serverOk ? t("status.serverUp") : t("status.serverDown")} | {clock}
                    </span>
                    <button
                        className="tbtn"
                        aria-pressed={layout.termVisible}
                        onClick={toggleTerminal}
                        title={t("btn.terminal")}
                    >
                        <Terminal size={14} />
                    </button>
                    <button
                        className="tbtn"
                        aria-pressed={editing}
                        onClick={() => setEditing((v) => !v)}
                        title={editing ? t("btn.editing") : t("btn.edit")}
                    >
                        {editing ? <Check size={14} /> : <Pencil size={14} />}
                    </button>
                    <button className="tbtn" onClick={() => setDialog({ kind: "settings" })} title={t("btn.settings")}>
                        <Settings size={14} />
                    </button>
                </span>
            </footer>

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
                onClose={() => setDialog({ kind: "none" })}
                theme={theme}
                onTheme={setTheme}
                lang={lang}
                onChangeLang={setLang}
                platform={platform}
                onOpenImport={() => setDialog({ kind: "import" })}
                termCfg={termCfg}
                onTermPatch={patchTerm}
                toolAliases={toolAliases}
                onToolAlias={patchToolAlias}
                clipSec={clipSec}
                onClipSec={patchClipSec}
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
