import { getSetting, setSetting } from "./util/settings";

// ── 钉住 / 置顶 ──
// 钉住是跨重启的工作模式偏好（落 settings 表），置顶是钉住下的临时叠加态（仅内存）。
// 置顶为什么挂在钉住下面：未钉住的窗口遵守「失焦即藏 / 热键二态切换」，
// 此时让窗口压在最前和这套形态冲突；把置顶定义成子状态，一处判定就能同时管住
// blur 自动隐藏与热键呼出这两条路径。
// 置顶为什么不落库：它是对其他窗口的临时压制，重启后若还生效，用户会忘了自己
// 开过、只看到窗口莫名盖住别人；钉住才代表「我需要这个窗口长期在场」。

const PIN_KEY = "pinned";

let pinned = false;
let topmost = false;

/** 启动读一次钉住状态；置顶每次启动都从关闭开始（见上：不落库） */
export function initPin(): void {
    pinned = getSetting(PIN_KEY, "0") === "1";
    topmost = false;
}

export function isPinned(): boolean {
    return pinned;
}

/** 实际生效的置顶：钉住是父状态，未钉住时内存里的 topmost 不参与任何判定 */
export function isTopmost(): boolean {
    return pinned && topmost;
}

export function getPinState(): { pinned: boolean; topmost: boolean } {
    return { pinned, topmost: isTopmost() };
}

/** 钉住：写内存并落库；取消钉住顺带清掉置顶，避免再次钉住时旧置顶悄悄复活 */
export function setPinned(v: boolean): void {
    pinned = v;
    if (!v) topmost = false;
    setSetting(PIN_KEY, v ? "1" : "0");
}

/** 置顶：只在钉住时接受，未钉住的窗口没有「常在最前」的语义 */
export function setTopmost(v: boolean): void {
    if (!pinned) return;
    topmost = v;
}
