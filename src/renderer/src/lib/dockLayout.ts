import type { DockviewApi, SerializedDockview } from "@/components/ui/dock-layout";

// 停靠区布局的记忆：只记「格子怎么排」（几列几行、各自多大、标签栏朝哪、最后激活哪一格），
// 不记格子里开过什么面板。存 localStorage，每个工作区一份（TOOL_SPEC §5：只有界面记得住的东西进 localStorage），
// 读写都 try/catch。数据直接用 dockview 自己的 toJSON 结果，只是把面板之类的内容剔掉，恢复时 fromJSON 回去，
// 恢复出来的格子全是空的（显示「空白分组」）。

const KEY_PREFIX = "mypage-dock-layout:";
// 拖分隔条时布局事件很密，停一会儿再写，不让每一帧都落盘
const SAVE_DELAY_MS = 300;

const keyOf = (workspaceId: number) => `${KEY_PREFIX}${workspaceId}`;

// dockview 的格子树：branch 的 data 是子节点数组，leaf 的 data 是一个格子
type GridNode = { type: "leaf" | "branch"; data: unknown; size?: number; visible?: boolean };
type GridRoot = SerializedDockview["grid"]["root"];

/** 把格子树里每个格子清成空格子，只留 id 和标签栏位置。恢复出来的格子都是空的，组头本来就该藏 */
function emptyGroups(node: GridNode): GridNode {
    if (node.type === "branch") return { ...node, data: (node.data as GridNode[]).map(emptyGroups) };
    const { id, headerPosition } = node.data as { id: string; headerPosition?: string };
    return { ...node, data: { id, views: [], hideHeader: true, headerPosition } };
}

function countGroups(node: GridNode): number {
    if (node.type === "branch") return (node.data as GridNode[]).reduce((sum, child) => sum + countGroups(child), 0);
    return 1;
}

/** 浮动窗口、弹出窗口、最大化、固定标记都不记：浮动窗口变空会被自动清掉，没有格子可留 */
function skeletonOf(json: SerializedDockview): SerializedDockview {
    const { width, height, orientation, root } = json.grid;
    return {
        grid: { width, height, orientation, root: emptyGroups(root as GridNode) as GridRoot },
        panels: {},
        activeGroup: json.activeGroup,
    };
}

/** 读出记下的布局；没存过、读不出来、形状不对都当没有 */
function loadDockLayout(workspaceId: number): SerializedDockview | null {
    try {
        const raw = localStorage.getItem(keyOf(workspaceId));
        if (raw === null) return null;
        const json = JSON.parse(raw) as SerializedDockview;
        const root = json.grid.root as GridNode;
        return root.type === "branch" && Array.isArray(root.data) ? json : null;
    } catch {
        return null;
    }
}

/** 记下的布局是否不止一个格子：只有这时才值得启动就把停靠区挂出来画格子 */
export function hasMultipleGroups(workspaceId: number): boolean {
    const json = loadDockLayout(workspaceId);
    return json !== null && countGroups(json.grid.root as GridNode) > 1;
}

/**
 * 开面板（工具、终端、网页共用）：有空格子就优先填空格子，格子全有面板了就往第一格填。
 * 先后顺序是格子在页面上的顺序，左→右、上→下：恢复出来的一排空格子会被依次填满。
 * 不看当前激活的是哪一格，落点才好预测。
 * 最大化时其他格子是藏着的，面板进去就看不见，所以走 dockview 默认（进激活格）；没有任何格子时同样走默认，由它新建第一格。
 * 浮动窗口变空会被自动清掉，只看网格里的格子。
 */
export function addPanelPreferEmptyGroup(
    dock: DockviewApi,
    // 落点由这里决定，调用方不传 position，也不开浮动窗口
    options: Omit<Parameters<DockviewApi["addPanel"]>[0], "position" | "floating">,
): void {
    const gridGroups = dock.hasMaximizedGroup()
        ? []
        : dock.groups
              .filter((group) => group.api.location.type === "grid")
              // 格子的 DOM 顺序就是布局树的顺序
              .sort((a, b) =>
                  a.element.compareDocumentPosition(b.element) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
              );
    const target = gridGroups.find((group) => group.panels.length === 0) ?? gridGroups[0];
    dock.addPanel(target ? { ...options, position: { referenceGroup: target } } : options);
}

// 每个工作区一个等待中的保存计时器
const timers = new Map<number, number>();

/** 删工作区时清掉它的布局，连同还没写出去的保存 */
export function clearDockLayout(workspaceId: number): void {
    window.clearTimeout(timers.get(workspaceId));
    timers.delete(workspaceId);
    try {
        localStorage.removeItem(keyOf(workspaceId));
    } catch {
        // 写不进去就算了，只是留下一条没人读的记录
    }
}

/** dock 刚就绪时调用：把记下的布局还原成一排空格子。数据对不上就当没存过 */
export function restoreDockLayout(workspaceId: number, dock: DockviewApi): void {
    const saved = loadDockLayout(workspaceId);
    if (!saved) return;
    try {
        dock.fromJSON(saved);
        // fromJSON 把 activeGroup 当面板 id 去找，空格子里没有面板，所以激活的格子要自己补
        if (saved.activeGroup) dock.getGroup(saved.activeGroup)?.api.setActive();
    } catch {
        // dockview 解析失败会自己回滚成空白，这里只需要丢掉坏数据
        clearDockLayout(workspaceId);
    }
}

function save(workspaceId: number, dock: DockviewApi): void {
    // 最大化时 toJSON 要先退出再恢复最大化，会再引发一轮布局事件，造成反复保存；
    // 最大化不改格子结构，跳过这次，退出最大化时自然会再存
    if (dock.hasMaximizedGroup()) return;
    try {
        const json = skeletonOf(dock.toJSON());
        // 一个格子都没有（全关了）等于回到默认，不留记录
        if (countGroups(json.grid.root as GridNode) === 0) localStorage.removeItem(keyOf(workspaceId));
        else localStorage.setItem(keyOf(workspaceId), JSON.stringify(json));
    } catch {
        // dock 已销毁或存储不可用：这次不存，不打断操作
    }
}

/**
 * 布局一变（含换激活格子）就防抖保存，不等退出时才存：托盘退出或被强杀时不一定来得及。
 * isAlive 在落盘前再问一次：工作区已删、或 dock 已被新实例顶替（开发模式的 StrictMode 会建两次）时放弃，
 * 免得销毁中的旧实例把空布局写进去。
 */
export function watchDockLayout(workspaceId: number, dock: DockviewApi, isAlive: () => boolean): void {
    const schedule = () => {
        window.clearTimeout(timers.get(workspaceId));
        timers.set(
            workspaceId,
            window.setTimeout(() => {
                timers.delete(workspaceId);
                if (isAlive()) save(workspaceId, dock);
            }, SAVE_DELAY_MS),
        );
    };
    dock.onDidLayoutChange(schedule);
    dock.onDidActiveGroupChange(schedule);
}
