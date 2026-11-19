import { screen, type BrowserWindow } from "electron";
import { getSetting, setSetting } from "./server/util/settings";

// ── 窗口状态记忆（记住上次位置/尺寸/是否最大化）──
// 状态存 SQLite settings 表（键 window_state），与业务数据同库同备份。
// 主进程独占写、仅此处读写，无并发问题。

export type WinState = {
    x?: number;
    y?: number;
    width: number;
    height: number;
    maximized: boolean;
};

/** 首次启动默认 1180×760（v2.2 起为三区布局：侧栏 + 工具 + 终端） */
const DEFAULT: WinState = { width: 1180, height: 760, maximized: false };
const KEY = "window_state";
export const MIN_WINDOW_WIDTH = 840;
export const MIN_WINDOW_HEIGHT = 520;

function isInt(v: unknown): v is number {
    return typeof v === "number" && Number.isInteger(v);
}

function loadWindowState(): WinState {
    const raw = getSetting(KEY, "");
    if (!raw) return DEFAULT;
    try {
        const s = JSON.parse(raw) as Partial<WinState>;
        if (!isInt(s.width) || !isInt(s.height)) return DEFAULT;
        return {
            width: Math.max(s.width, MIN_WINDOW_WIDTH),
            height: Math.max(s.height, MIN_WINDOW_HEIGHT),
            x: isInt(s.x) ? s.x : undefined,
            y: isInt(s.y) ? s.y : undefined,
            maximized: s.maximized === true,
        };
    } catch {
        return DEFAULT;
    }
}

/** 返回启动时可显示在当前屏幕上的窗口状态。 */
export function restoreWindowState(): WinState {
    const state = loadWindowState();
    const { x, y } = state;

    // 屏幕可以位于主屏左边或上方。检查顶栏是否有足够空间露在屏幕上，避免只剩一条边可见。
    if (x !== undefined && y !== undefined) {
        const titleBarVisible = screen.getAllDisplays().some(({ workArea }) => {
            const left = Math.max(x, workArea.x);
            const right = Math.min(x + state.width, workArea.x + workArea.width);
            return right - left >= 100 && y >= workArea.y && y + 24 <= workArea.y + workArea.height;
        });
        if (titleBarVisible) return state;
    }

    const area = screen.getPrimaryDisplay().workArea;
    const width = Math.max(MIN_WINDOW_WIDTH, Math.min(state.width, area.width));
    const height = Math.max(MIN_WINDOW_HEIGHT, Math.min(state.height, area.height));
    return {
        x: area.x + Math.floor(Math.max(0, area.width - width) / 2),
        y: area.y + Math.floor(Math.max(0, area.height - height) / 2),
        width,
        height,
        maximized: state.maximized,
    };
}

// 被跟踪窗口的模块级引用：changeDataDir 迁移时要取「当前」bounds 补写进新库
// 副本（旧库随后被删，防抖未落盘的最后一段状态不补就丢了），需从外部够到窗口
let tracked: BrowserWindow | null = null;

/** 跟踪窗口并持久化状态：resize/move 防抖写盘，close 时立即写一次 */
export function trackWindowState(win: BrowserWindow): void {
    tracked = win;
    let timer: NodeJS.Timeout | undefined;

    const save = () => {
        // getNormalBounds() 返回「还原后」的尺寸——最大化时不应把全屏尺寸存下来
        const b = win.getNormalBounds();
        const state: WinState = {
            x: b.x,
            y: b.y,
            width: b.width,
            height: b.height,
            maximized: win.isMaximized(),
        };
        setSetting(KEY, JSON.stringify(state));
    };
    const schedule = () => {
        clearTimeout(timer);
        timer = setTimeout(save, 500);
    };

    win.on("resize", schedule);
    win.on("move", schedule);
    win.on("close", save);
}

/** 当前窗口状态快照（与 save() 同款取「还原后」bounds）；无窗口时退回已存状态。
 *  供 changeDataDir 把状态写进迁移副本，键同为 window_state */
export function currentWindowState(): WinState {
    if (!tracked || tracked.isDestroyed()) return loadWindowState();
    const b = tracked.getNormalBounds();
    return {
        x: b.x,
        y: b.y,
        width: b.width,
        height: b.height,
        maximized: tracked.isMaximized(),
    };
}
