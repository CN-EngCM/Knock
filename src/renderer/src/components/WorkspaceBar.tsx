import { useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuSeparator,
    ContextMenuSub,
    ContextMenuSubContent,
    ContextMenuSubTrigger,
    ContextMenuTrigger,
} from "@/components/ui/context-menu";
import type { Workspace } from "@/api/client";
import { WORKSPACE_PALETTE, workspaceColor, workspaceStroke } from "@/lib/workspaceColor";
import { useI18n } from "@/i18n/useI18n";
import { cn } from "@/lib/utils";

// 列表高度（不含标题行）：最小一行，默认六行；上限按侧栏的实时高度算。
const LIST_HEIGHT_KEY = "mypage-workspace-height";
const MIN_LIST_HEIGHT = 32;
const DEFAULT_LIST_HEIGHT = 192;
const MAX_LIST_HEIGHT_RATIO = 0.7;

// 布局偏好存 localStorage，不进 SQLite：高度只对本机这块侧栏有意义，
// 也没必要跟工作区数据一起备份。
function loadListHeight(): number {
    try {
        const raw = localStorage.getItem(LIST_HEIGHT_KEY);
        if (raw === null) return DEFAULT_LIST_HEIGHT;
        const value = Number(raw);
        // 只接受正数：空串、非数字、NaN、Infinity、负数与 0 都回落到默认高度；
        // 过小的正数不算坏数据，显示时再按最小高度夹住
        return Number.isFinite(value) && value > 0 ? Math.max(MIN_LIST_HEIGHT, Math.round(value)) : DEFAULT_LIST_HEIGHT;
    } catch {
        return DEFAULT_LIST_HEIGHT;
    }
}

function saveListHeight(height: number): void {
    try {
        // 只存数字，且只存列表的可视高度，不含上方的标题行
        localStorage.setItem(LIST_HEIGHT_KEY, String(Math.round(height)));
    } catch {
        // 隐私模式等场景写不进去就只在本次会话生效，不打断拖拽
    }
}

type Props = {
    /** 侧栏收成了只有图标的窄条：标题文字去掉，每行只剩色块加首字 */
    collapsed: boolean;
    workspaces: Workspace[];
    /** 当前生效的工作区；数据还没到时为 null */
    activeId: number | null;
    /** 每个工作区停靠区里的面板总数（工具＋终端）；没挂过实例的工作区按 0 显示 */
    panelCounts: Record<number, number>;
    onSwitch: (id: number) => void;
    onCreate: () => void;
    onRename: (workspace: Workspace) => void;
    onChangeFolder: (workspace: Workspace) => void;
    /** color 为 null = 恢复按 id 自动取色 */
    onChangeColor: (workspace: Workspace, color: string | null) => void;
    onDelete: (workspace: Workspace) => void;
};

/**
 * 侧栏顶部的工作区块：标题行 + 高度可拖拽的列表（默认六行）。
 * 列表高度记在 localStorage，只影响本机界面；数据与增删改都归 App（这里不碰 api）。
 * 侧栏隐藏时整块跟着 aside 一起消失，不另做入口。
 */
export function WorkspaceBar({
    collapsed,
    workspaces,
    activeId,
    panelCounts,
    onSwitch,
    onCreate,
    onRename,
    onChangeFolder,
    onChangeColor,
    onDelete,
}: Props) {
    const { t } = useI18n();
    const rootRef = useRef<HTMLDivElement>(null);
    const dragRef = useRef<{ startY: number; startHeight: number } | null>(null);
    const [preferredHeight, setPreferredHeight] = useState(loadListHeight);
    // 侧栏可用高度；0 表示还没量到，此时不设上限，避免首帧就把已存的高度压成一行
    const [asideHeight, setAsideHeight] = useState(0);
    const [dragging, setDragging] = useState(false);

    useLayoutEffect(() => {
        const aside = rootRef.current?.closest("aside");
        if (!aside) return;
        // 上限的基准是 aside 的可用高度：本组件根节点的高度会随列表一起变，不能拿它来算
        const sync = () => {
            if (aside.clientHeight > 0) setAsideHeight(aside.clientHeight);
        };
        sync();
        const observer = new ResizeObserver(sync);
        observer.observe(aside);
        return () => observer.disconnect();
    }, []);

    // 窗口变小时只夹住显示高度，不改已存的偏好，窗口恢复后还能回到原来的高度
    const maxHeight =
        asideHeight > 0 ? Math.max(MIN_LIST_HEIGHT, Math.floor(asideHeight * MAX_LIST_HEIGHT_RATIO)) : Infinity;
    const visibleHeight = Math.min(Math.max(preferredHeight, MIN_LIST_HEIGHT), maxHeight);

    const clampHeight = (height: number) => Math.min(Math.max(Math.round(height), MIN_LIST_HEIGHT), maxHeight);

    function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
        if (event.button !== 0) return;
        // 阻止文本选中：否则按住拖过标题或列表会留下选区
        event.preventDefault();
        // 捕获指针后，拖出侧栏甚至拖出窗口仍能收到 pointermove 与 pointerup
        event.currentTarget.setPointerCapture(event.pointerId);
        dragRef.current = { startY: event.clientY, startHeight: visibleHeight };
        setDragging(true);
    }

    function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
        const drag = dragRef.current;
        if (!drag) return;
        const next = clampHeight(drag.startHeight + event.clientY - drag.startY);
        // 拖到上限时显示高度不会再变，此时不覆盖偏好，窗口恢复后还能回到之前的高度
        if (next !== visibleHeight) setPreferredHeight(next);
    }

    function finishDrag(clientY: number) {
        const drag = dragRef.current;
        if (!drag) return;
        dragRef.current = null;
        setDragging(false);
        // 落点与最后一次 pointermove 可能差一两个像素，以松手位置再算一次
        const next = clampHeight(drag.startHeight + clientY - drag.startY);
        if (next !== visibleHeight) {
            setPreferredHeight(next);
            saveListHeight(next);
            return;
        }
        // 没拖动或已经顶到上限：显示高度没变，保存原偏好而不是夹过的显示值
        saveListHeight(preferredHeight);
    }

    function handlePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
        finishDrag(event.clientY);
    }

    function handlePointerCancel() {
        if (!dragRef.current) return;
        dragRef.current = null;
        setDragging(false);
        // 取消（比如系统手势）拿不到可靠落点，按当前已生效的偏好落盘
        saveListHeight(preferredHeight);
    }

    function handleDoubleClick() {
        // 双击回默认高度并落盘；当前窗口放不下时显示仍会被上限夹住
        setPreferredHeight(DEFAULT_LIST_HEIGHT);
        saveListHeight(DEFAULT_LIST_HEIGHT);
    }

    return (
        <div ref={rootRef} className="flex-none border-b border-line">
            {/* 标题行与右侧工作区工具栏同高（h-9 = 36px，含底边线），两条底边线在一条水平线上。
                图标条里没有地方放字：去掉标题，「＋」居中留着 */}
            <div
                className={cn(
                    "flex h-9 flex-none items-center border-b border-line",
                    collapsed ? "justify-center" : "justify-between pr-2 pl-4",
                )}
            >
                {!collapsed && <span className="text-xs font-medium">{t("ws.title")}</span>}
                <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    onClick={onCreate}
                    title={t("ws.new")}
                    aria-label={t("ws.new")}
                >
                    <Plus className="size-3.5" />
                </Button>
            </div>
            {/* 高度可拖拽并记住，默认 192px（六行）；超出这份高度就在区块内部滚动。
                图标条只有 52px，10px 的滚动条会把色块挤偏，所以隐藏滚动条，滚轮和触摸板照常能滚 */}
            <div className={cn("overflow-y-auto", collapsed && "no-scrollbar")} style={{ height: visibleHeight }}>
                {workspaces.map((workspace) => (
                    <WorkspaceRow
                        key={workspace.id}
                        collapsed={collapsed}
                        workspace={workspace}
                        active={workspace.id === activeId}
                        count={panelCounts[workspace.id] ?? 0}
                        onSwitch={onSwitch}
                        onRename={onRename}
                        onChangeFolder={onChangeFolder}
                        onChangeColor={onChangeColor}
                        onDelete={onDelete}
                    />
                ))}
            </div>
            {/* 4px 拖拽条：只服务鼠标/指针，没有键盘等价操作，因此对读屏隐藏也不进 Tab 序 */}
            <div
                aria-hidden
                className={`h-1 cursor-row-resize touch-none ${dragging ? "bg-(--line)" : "hover:bg-(--line)"}`}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerCancel}
                onDoubleClick={handleDoubleClick}
            />
        </div>
    );
}

type RowProps = {
    collapsed: boolean;
    workspace: Workspace;
    active: boolean;
    count: number;
    onSwitch: (id: number) => void;
    onRename: (workspace: Workspace) => void;
    onChangeFolder: (workspace: Workspace) => void;
    onChangeColor: (workspace: Workspace, color: string | null) => void;
    onDelete: (workspace: Workspace) => void;
};

function WorkspaceRow({
    collapsed,
    workspace,
    active,
    count,
    onSwitch,
    onRename,
    onChangeFolder,
    onChangeColor,
    onDelete,
}: RowProps) {
    const { t } = useI18n();
    const color = workspaceColor(workspace);
    // builtin 的名字在库里存的是空串，显示名必须走 i18n
    const name = workspace.builtin ? t("ws.scratch") : workspace.name;
    // 文件夹是工作区的项目目录：悬停时连窗口数一起给全，方便确认这一行指向哪个目录。
    // 旧库里没补过文件夹的工作区保留空串，此时只显示窗口数
    const detail = workspace.folder
        ? `${count} ${t("ws.windowUnit")} · ${workspace.folder}`
        : `${count} ${t("ws.windowUnit")}`;
    // 图标条里只有首字，名字和窗口数都放进悬停提示
    const title = collapsed ? `${name} · ${detail}` : detail;
    const initial = Array.from(name)[0]?.toUpperCase() ?? "";
    const row = (
        <button
            type="button"
            onClick={() => onSwitch(workspace.id)}
            // 计数只留一个数字，鼠标停在哪一行都能从 title 读到完整说法
            title={title}
            // 图标条里按钮的可见内容只有一个字，读屏需要完整的名字
            aria-label={collapsed ? name : undefined}
            // 当前行：同色低透明度底色 + 上/右/下/左四边内描边（1px 不占布局，行高仍是 32px）。
            // 用内阴影而不是 border：通栏行的 border 会把内容挤动 1px，滚起来会抖。
            className={cn(
                "relative flex h-8 w-full select-none items-center text-left hover:bg-(--state-hover)",
                collapsed ? "justify-center" : "pr-2 pl-4",
            )}
            style={
                active
                    ? {
                          backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)`,
                          boxShadow: [
                              `inset 0 1px 0 ${workspaceStroke(workspace)}`,
                              `inset -1px 0 0 ${workspaceStroke(workspace)}`,
                              `inset 0 -1px 0 ${workspaceStroke(workspace)}`,
                              `inset 1px 0 0 ${workspaceStroke(workspace)}`,
                          ].join(", "),
                      }
                    : undefined
            }
        >
            {/* 贴左边缘、整行高的竖色条 */}
            <span aria-hidden className="absolute inset-y-0 left-0 w-[3px]" style={{ backgroundColor: color }} />
            {collapsed ? (
                // 工作区没有图标，用「同色低透明度底的圆角方块 + 名字首字」代替；底色与当前行的同一档
                <span
                    aria-hidden
                    className={cn(
                        "grid size-7 place-items-center rounded-md text-xs font-medium",
                        active ? "text-foreground" : "text-muted-foreground",
                    )}
                    style={{ backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)` }}
                >
                    {initial}
                </span>
            ) : (
                <>
                    <span
                        className={`min-w-0 flex-1 truncate text-xs ${active ? "text-foreground" : "text-muted-foreground"}`}
                    >
                        {name}
                    </span>
                    <span className="flex-none pl-2 font-mono text-[11px] text-dim-foreground">{count}</span>
                </>
            )}
        </button>
    );
    // 临时工作区不可改名、不可删除，右键菜单也不给
    if (workspace.builtin) return row;
    return (
        <ContextMenu>
            <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
            <ContextMenuContent>
                <ContextMenuItem onClick={() => onRename(workspace)}>{t("ws.rename")}</ContextMenuItem>
                <ContextMenuItem onClick={() => onChangeFolder(workspace)}>{t("ws.changeFolder")}</ContextMenuItem>
                <ContextMenuSub>
                    <ContextMenuSubTrigger>{t("ws.color")}</ContextMenuSubTrigger>
                    <ContextMenuSubContent>
                        {/* 两排五个色块；当前生效的颜色（含自动取到的那格）外圈描一圈。
                            用 ContextMenuItem 当色块，键盘方向键与选中后自动收起菜单都是现成的 */}
                        <div className="grid grid-cols-5 gap-1 p-1">
                            {WORKSPACE_PALETTE.map((swatch) => (
                                <ContextMenuItem
                                    key={swatch}
                                    className="size-6 justify-center p-0"
                                    aria-label={swatch}
                                    onClick={() => onChangeColor(workspace, swatch)}
                                >
                                    <span
                                        className={`size-3.5 rounded-full ${
                                            swatch === color ? "outline-2 outline-offset-2 outline-foreground" : ""
                                        }`}
                                        style={{ backgroundColor: swatch }}
                                    />
                                </ContextMenuItem>
                            ))}
                        </div>
                        <ContextMenuSeparator />
                        {/* 没手选过时本来就是自动取色，恢复默认无事可做 */}
                        <ContextMenuItem
                            disabled={workspace.color === null}
                            onClick={() => onChangeColor(workspace, null)}
                        >
                            {t("ws.colorReset")}
                        </ContextMenuItem>
                    </ContextMenuSubContent>
                </ContextMenuSub>
                <ContextMenuItem variant="destructive" onClick={() => onDelete(workspace)}>
                    {t("common.delete")}
                </ContextMenuItem>
            </ContextMenuContent>
        </ContextMenu>
    );
}
