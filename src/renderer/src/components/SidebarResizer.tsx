import { useRef, type PointerEvent as ReactPointerEvent } from "react";

// 侧栏的布局偏好存 localStorage，不进 SQLite：只对本机这块窗口有意义。
const WIDTH_KEY = "mypage-sidebar-width";
const COLLAPSED_KEY = "mypage-sidebar-collapsed";
export const DEFAULT_SIDEBAR_WIDTH = 246;
const MIN_SIDEBAR_WIDTH = 200;
// 上限取窗口宽度的 40%，免得把右侧标签区挤没。App 里 aside 的 max-w-[40%] 与这里是同一个数，改要一起改
const MAX_SIDEBAR_RATIO = 0.4;
/** 图标条的固定宽度：只放得下居中的图标，不能单独拖宽 */
export const RAIL_WIDTH = 52;
// 拖拽时侧栏右缘越过这个位置就吸附成图标条，退回去就展开。取图标条与最窄完整侧栏的中点附近，
// 所以 RAIL_WIDTH 到 MIN_SIDEBAR_WIDTH 之间的宽度不会出现
const COLLAPSE_THRESHOLD = 120;

export type SidebarState = {
    /** 最后一次完整侧栏的宽度：收成图标条时不覆盖它，展开时回到它 */
    width: number;
    collapsed: boolean;
};

/** 读已存的布局；宽度只接受有限的正数，其余回落默认值。宽度上限不在这里夹，窗口大小每次不同，由 aside 的 max-w 负责 */
export function loadSidebar(): SidebarState {
    try {
        const raw = localStorage.getItem(WIDTH_KEY);
        const value = Number(raw);
        const width =
            raw !== null && Number.isFinite(value) && value > 0
                ? Math.max(MIN_SIDEBAR_WIDTH, Math.round(value))
                : DEFAULT_SIDEBAR_WIDTH;
        return { width, collapsed: localStorage.getItem(COLLAPSED_KEY) === "1" };
    } catch {
        return { width: DEFAULT_SIDEBAR_WIDTH, collapsed: false };
    }
}

function saveSidebar(state: SidebarState): void {
    try {
        localStorage.setItem(WIDTH_KEY, String(Math.round(state.width)));
        localStorage.setItem(COLLAPSED_KEY, state.collapsed ? "1" : "0");
    } catch {
        // 隐私模式等场景写不进去就只在本次会话生效，不打断拖拽
    }
}

function clampWidth(width: number): number {
    // 窗口宽度就是侧栏所在容器的宽度（容器铺满窗口）
    const max = Math.floor(window.innerWidth * MAX_SIDEBAR_RATIO);
    return Math.min(Math.max(Math.round(width), MIN_SIDEBAR_WIDTH), Math.max(MIN_SIDEBAR_WIDTH, max));
}

/** 侧栏右缘被拖到 raw 这个位置时应有的状态；收成图标条时保留原来的完整宽度 */
function resolve(raw: number, lastWidth: number): SidebarState {
    if (raw < COLLAPSE_THRESHOLD) return { width: lastWidth, collapsed: true };
    return { width: clampWidth(raw), collapsed: false };
}

type Props = {
    /** 当前侧栏状态（aside 实际显示的完整宽度可能被 max-w 夹得更窄） */
    state: SidebarState;
    onChange: (state: SidebarState) => void;
};

/**
 * 侧栏右边缘的拖拽区：看不见，没有线也没有把手，只有鼠标移上去时光标变成左右箭头。
 * 必须放在 `relative` 的 aside 里：它贴着 aside 的右边缘、跨两边各 2px，aside 被夹窄或收成图标条时也跟着走。
 * 往左拖越过阈值吸附成图标条，往右拖过阈值展开；双击：完整侧栏回默认宽度，图标条展开到上次的宽度。
 * 只服务鼠标/指针，没有键盘等价操作，所以对读屏隐藏。
 */
export function SidebarResizer({ state, onChange }: Props) {
    const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

    function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
        if (event.button !== 0) return;
        // 阻止文本选中：否则拖过侧栏和右侧标签区会留下选区
        event.preventDefault();
        // 捕获指针后，拖出窗口仍能收到 pointermove 与 pointerup
        event.currentTarget.setPointerCapture(event.pointerId);
        // 起点按「实际显示的宽度」算：完整侧栏的偏好值可能大于当前窗口允许的上限
        dragRef.current = {
            startX: event.clientX,
            startWidth: state.collapsed ? RAIL_WIDTH : clampWidth(state.width),
        };
    }

    function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
        const drag = dragRef.current;
        if (!drag) return;
        onChange(resolve(drag.startWidth + event.clientX - drag.startX, state.width));
    }

    function handlePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
        const drag = dragRef.current;
        if (!drag) return;
        dragRef.current = null;
        // 落点与最后一次 pointermove 可能差一两个像素，以松手位置再算一次
        const next = resolve(drag.startWidth + event.clientX - drag.startX, state.width);
        onChange(next);
        saveSidebar(next);
    }

    function handlePointerCancel() {
        if (!dragRef.current) return;
        dragRef.current = null;
        // 取消（比如系统手势）拿不到可靠落点，按当前已生效的状态落盘
        saveSidebar(state);
    }

    function handleDoubleClick() {
        // 图标条里双击是「展开」，回到上次的完整宽度；完整侧栏里双击是「复位」，回默认宽度
        const next = state.collapsed
            ? { width: state.width, collapsed: false }
            : { width: DEFAULT_SIDEBAR_WIDTH, collapsed: false };
        onChange(next);
        saveSidebar(next);
    }

    return (
        <div
            aria-hidden
            className="absolute inset-y-0 -right-0.5 z-10 w-1 cursor-col-resize touch-none"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
            onDoubleClick={handleDoubleClick}
        />
    );
}
