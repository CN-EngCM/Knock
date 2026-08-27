import { globalShortcut } from "electron";
import { uIOhook, UiohookKey } from "uiohook-napi";
import { getSetting, setSetting } from "../server/util/settings";
import type { HotkeyId } from "../server/schemas";

// ── 全局呼出热键 ──
// 两类机制：
//   double-*  —— 双击修饰键（Ctrl/Alt/Shift，300ms 内两次）。Electron 的
//                globalShortcut 只能注册静态组合键，做不到双击检测，
//                因此走 uiohook-napi 的低级键盘钩子。
//   组合键    —— globalShortcut 直接注册。
// 预设 id 的唯一事实来源在 server/schemas.ts（前端下拉与后端校验共用）。

export type HotkeyResult = { ok: true } | { ok: false; error: "unknown" | "conflict" };

/** 双击判定的窗口期；两次按下间隔超过它就不算 */
const DOUBLE_INTERVAL = 300;

// uiohook-napi 对左右修饰键用不同键码，两种都要认
// （键名来自 libuiohook：左 Ctrl=Ctrl、右 Ctrl=CtrlRight，Alt 同理叫 Alt/AltRight）
const DOUBLE_KEYS: Record<string, number[]> = {
    "double-ctrl": [UiohookKey.Ctrl, UiohookKey.CtrlRight],
    "double-alt": [UiohookKey.Alt, UiohookKey.AltRight],
    "double-shift": [UiohookKey.Shift, UiohookKey.ShiftRight],
};

const COMBO_ACCELERATORS: Partial<Record<HotkeyId, string>> = {
    "alt-space": "Alt+Space",
    "ctrl-alt-space": "Control+Alt+Space",
};

/** 当前生效热键（启动时由 initHotkey 读出并应用） */
let active: HotkeyId | null = null;

/** 呼出动作（显隐切换），由 main.ts 注入，本模块不持有窗口引用 */
let onToggle: (() => void) | null = null;

// 双击检测状态：
//   lastPress   上次目标键按下的时间戳
//   sawOtherKey 两次按下之间是否夹了别的键——夹了就不是「双击」而是连招
//               （例如编辑器里 Ctrl+Z Ctrl+Z 不应误触发呼出）
//   downKeys    当前按住的目标键。按住不放时 OS 会连发自动重复的 keydown
//               （约 30ms 一次），不过滤的话双击判定会被喂成连续触发——
//               必须只认「抬起后再按下」的边沿。
let lastPress = 0;
let sawOtherKey = false;
const downKeys = new Set<number>();

function handleKeyup(e: { keycode: number }): void {
    downKeys.delete(e.keycode);
}

function handleKeydown(e: { keycode: number }): void {
    if (!onToggle || !active) return;
    const targets = DOUBLE_KEYS[active];
    if (!targets) return;
    if (targets.includes(e.keycode)) {
        if (downKeys.has(e.keycode)) return; // 自动重复，不是新的一次按下
        downKeys.add(e.keycode);
        const now = Date.now();
        if (!sawOtherKey && now - lastPress < DOUBLE_INTERVAL) {
            lastPress = 0; // 触发后重置，防三连击误触发两次
            onToggle();
        } else {
            lastPress = now;
            sawOtherKey = false;
        }
    } else {
        sawOtherKey = true;
    }
}

/** 注销当前热键（双击类撤钩子监听，组合类反注册快捷键） */
function deactivate(): void {
    if (!active) return;
    const acc = COMBO_ACCELERATORS[active];
    if (acc) globalShortcut.unregister(acc);
    else {
        uIOhook.removeListener("keydown", handleKeydown);
        uIOhook.removeListener("keyup", handleKeyup);
    }
    downKeys.clear();
    active = null;
}

/**
 * 应用一个热键预设。失败（组合键被其他程序占用）时不改变现有热键。
 * 启动时与设置页改键（PUT /api/hotkey）都走这里。
 */
export function applyHotkey(id: HotkeyId): HotkeyResult {
    const isDouble = id in DOUBLE_KEYS;
    const acc = COMBO_ACCELERATORS[id];
    if (!isDouble && !acc) return { ok: false, error: "unknown" };

    deactivate();
    if (acc) {
        // register 失败 = 组合键已被占用（如其他全局启动器）
        const ok = globalShortcut.register(acc, () => onToggle?.());
        if (!ok) return { ok: false, error: "conflict" };
    } else {
        lastPress = 0;
        sawOtherKey = false;
        downKeys.clear();
        uIOhook.on("keydown", handleKeydown);
        uIOhook.on("keyup", handleKeyup);
        uIOhook.start(); // 幂等：已启动时重复调用无副作用
    }
    active = id;
    return { ok: true };
}

/** 进程启动时调用一次：注入呼出动作并应用已保存的热键 */
export function initHotkey(toggle: () => void): void {
    onToggle = toggle;
    const saved = getSetting("hotkey", "double-ctrl") as HotkeyId;
    const r = applyHotkey(saved);
    if (!r.ok) {
        // 保存的预设失效（如被占用）：回退默认双击 Ctrl，保证呼出永远可用
        applyHotkey("double-ctrl");
        setSetting("hotkey", "double-ctrl");
    }
}

/** 当前生效的预设 id（GET /api/hotkey 用） */
export function currentHotkey(): HotkeyId {
    return (active ?? getSetting("hotkey", "double-ctrl")) as HotkeyId;
}

/** 退出前反注册，否则组合键注册会残留在系统里直到进程死亡 */
export function shutdownHotkey(): void {
    deactivate();
}
