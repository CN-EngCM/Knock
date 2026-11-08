import { BrowserWindow } from "electron";
import { getSetting, setSetting } from "./server/util/settings";

// ── 窗口状态记忆（记住上次位置、宽度和展开时的高度）──
// 状态存 SQLite settings 表（键 window_state），与业务数据同库同备份。
// 主进程独占写、仅此处读写，无并发问题。
// 窗口有两种形态（见 app.ts 的 applyLayout）：展开（有工具或终端在显示）和收成只剩顶栏的一条。
// 宽度两种形态共用；存下来的 height 只是「展开时的高度」，收成一条时的矮高度不存。

export type WinState = {
    x?: number;
    y?: number;
    width: number;
    /** 展开时的高度 */
    height: number;
};

/** 顶栏高度，收成一条时窗口就这么高。渲染端 App.tsx 的顶栏 h-[48px] 是同一个数，改要两处一起改 */
export const TITLEBAR_HEIGHT = 48;
export const MIN_WIDTH = 840;
export const MIN_EXPANDED_HEIGHT = 520;

/** 首次启动默认 1180×760 */
const DEFAULT: WinState = { width: 1180, height: 760 };
const KEY = "window_state";

/** 展开时的高度：跟着 resize 实时更新（不等防抖落盘），收起再展开时用 */
let expandedHeight = DEFAULT.height;

function isInt(v: unknown): v is number {
    return typeof v === "number" && Number.isFinite(v);
}

export function loadWindowState(): WinState {
    const state = readState();
    expandedHeight = state.height;
    return state;
}

function readState(): WinState {
    const raw = getSetting(KEY, "");
    if (!raw) return DEFAULT;
    try {
        const s = JSON.parse(raw) as Partial<WinState>;
        if (!isInt(s.width) || !isInt(s.height)) return DEFAULT;
        return {
            // 下限 = 最小窗口尺寸：存下的更小值统一抬到最小值
            width: Math.max(s.width, MIN_WIDTH),
            height: Math.max(s.height, MIN_EXPANDED_HEIGHT),
            // 负坐标合法（多显示器左侧屏），但原屏幕可能已拔掉——交给 Electron 钳制
            x: isInt(s.x) ? s.x : undefined,
            y: isInt(s.y) ? s.y : undefined,
        };
    } catch {
        return DEFAULT;
    }
}

export function getExpandedHeight(): number {
    return expandedHeight;
}

// 被跟踪窗口的模块级引用：changeDataDir 迁移时要取「当前」bounds 补写进新库
// 副本（旧库随后被删，防抖未落盘的最后一段状态不补就丢了），需从外部够到窗口
let tracked: BrowserWindow | null = null;

/** 跟踪窗口并持久化状态：resize/move 防抖写盘，close 时立即写一次。
 *  isExpanded 告诉这里「现在是不是展开形态」：只有展开时的高度才算用户调的高度 */
export function trackWindowState(win: BrowserWindow, isExpanded: () => boolean): void {
    tracked = win;
    let timer: NodeJS.Timeout | undefined;

    const save = () => {
        const b = win.getBounds();
        const state: WinState = { x: b.x, y: b.y, width: b.width, height: expandedHeight };
        setSetting(KEY, JSON.stringify(state));
    };
    const schedule = () => {
        clearTimeout(timer);
        timer = setTimeout(save, 500);
    };

    win.on("resize", () => {
        if (isExpanded()) expandedHeight = win.getBounds().height;
        schedule();
    });
    win.on("move", schedule);
    win.on("close", save);
}

/** 当前窗口状态快照（与 save() 同款）；无窗口时退回已存状态。
 *  供 changeDataDir 把状态写进迁移副本，键同为 window_state */
export function currentWindowState(): WinState {
    if (!tracked || tracked.isDestroyed()) return readState();
    const b = tracked.getBounds();
    return { x: b.x, y: b.y, width: b.width, height: expandedHeight };
}
