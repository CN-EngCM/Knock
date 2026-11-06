import { useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/context-menu";
import type { Workspace } from "@/api/client";
import { workspaceColor, workspaceStroke } from "@/lib/workspaceColor";
import { useI18n } from "@/i18n/useI18n";

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
        // 只存数字，且只存列表的可视高度，不含上方 43px 标题行
        localStorage.setItem(LIST_HEIGHT_KEY, String(Math.round(height)));
    } catch {
        // 隐私模式等场景写不进去就只在本次会话生效，不打断拖拽
    }
}

type Props = {
    workspaces: Workspace[];
    /** 当前生效的工作区；数据还没到时为 null */
    activeId: number | null;
    /** 每个工作区停靠区里的面板总数（工具＋终端）；没挂过实例的工作区按 0 显示 */
    panelCounts: Record<number, number>;
    onSwitch: (id: number) => void;
    onCreate: () => void;
    onRename: (workspace: Workspace) => void;
    onChangeFolder: (workspace: Workspace) => void;
    onDelete: (workspace: Workspace) => void;
};

/**
 * 侧栏顶部的工作区块：标题行 + 高度可拖拽的列表（默认六行）。
 * 列表高度记在 localStorage，只影响本机界面；数据与增删改都归 App（这里不碰 api）。
 * 侧栏隐藏时整块跟着 aside 一起消失，不另做入口。
 */
export function WorkspaceBar({
    workspaces,
    activeId,
    panelCounts,
    onSwitch,
    onCreate,
    onRename,
    onChangeFolder,
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
            <div className="flex h-[43px] flex-none items-center justify-between border-b border-line pr-2 pl-4">
                <span className="text-xs font-medium">{t("ws.title")}</span>
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
            {/* 高度可拖拽并记住，默认 192px（六行）；超出这份高度就在区块内部滚动 */}
            <div className="overflow-y-auto" style={{ height: visibleHeight }}>
                {workspaces.map((workspace) => (
                    <WorkspaceRow
                        key={workspace.id}
                        workspace={workspace}
                        active={workspace.id === activeId}
                        count={panelCounts[workspace.id] ?? 0}
                        onSwitch={onSwitch}
                        onRename={onRename}
                        onChangeFolder={onChangeFolder}
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
    workspace: Workspace;
    active: boolean;
    count: number;
    onSwitch: (id: number) => void;
    onRename: (workspace: Workspace) => void;
    onChangeFolder: (workspace: Workspace) => void;
    onDelete: (workspace: Workspace) => void;
};

function WorkspaceRow({ workspace, active, count, onSwitch, onRename, onChangeFolder, onDelete }: RowProps) {
    const { t } = useI18n();
    const color = workspaceColor(workspace);
    // builtin 的名字在库里存的是空串，显示名必须走 i18n
    const name = workspace.builtin ? t("ws.scratch") : workspace.name;
    // 文件夹是工作区的项目目录：悬停时连窗口数一起给全，方便确认这一行指向哪个目录。
    // 旧库里没补过文件夹的工作区保留空串，此时只显示窗口数
    const title = workspace.folder
        ? `${count} ${t("ws.windowUnit")} · ${workspace.folder}`
        : `${count} ${t("ws.windowUnit")}`;
    const row = (
        <button
            type="button"
            onClick={() => onSwitch(workspace.id)}
            // 计数只留一个数字，鼠标停在哪一行都能从 title 读到完整说法
            title={title}
            // 当前行：同色低透明度底色 + 上/左/下三边内描边（1px 不占布局，行高仍是 32px）。
            // 用内阴影而不是 border：通栏行的 border 会把内容挤动 1px，滚起来会抖。
            // 右边不画——那一侧紧挨停靠区的左描边，画了会变成两条并排的线
            className="relative flex h-8 w-full select-none items-center pr-2 pl-4 text-left hover:bg-(--state-hover)"
            style={
                active
                    ? {
                          backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)`,
                          boxShadow: [
                              `inset 0 1px 0 ${workspaceStroke(workspace)}`,
                              `inset 1px 0 0 ${workspaceStroke(workspace)}`,
                              `inset 0 -1px 0 ${workspaceStroke(workspace)}`,
                          ].join(", "),
                      }
                    : undefined
            }
        >
            {/* 贴左边缘、整行高的竖色条 */}
            <span aria-hidden className="absolute inset-y-0 left-0 w-[3px]" style={{ backgroundColor: color }} />
            <span className={`min-w-0 flex-1 truncate text-xs ${active ? "text-foreground" : "text-muted-foreground"}`}>
                {name}
            </span>
            <span className="flex-none pl-2 font-mono text-[11px] text-dim-foreground">{count}</span>
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
                <ContextMenuItem variant="destructive" onClick={() => onDelete(workspace)}>
                    {t("common.delete")}
                </ContextMenuItem>
            </ContextMenuContent>
        </ContextMenu>
    );
}
