import { useEffect, useId, useSyncExternalStore } from "react";

// 窗口收成只有顶栏的一条时，搜索下拉、弹窗、提示都需要竖向空间。
// 它们各自登记「我需要窗口至少这么高」（总高度，含顶栏），App 取最大值报给主进程撑开窗口，
// 东西消失（登记 0 或组件卸载）窗口就缩回去。窗口已展开时这些登记不起作用。

/** 顶栏高度（px）：窗口收成一条时就这么高。主进程 windowState.ts 的 TITLEBAR_HEIGHT 是同一个数，改要两处一起改 */
export const TITLEBAR_HEIGHT = 48;

const needs = new Map<string, number>();
const listeners = new Set<() => void>();
let current = 0;

/** 登记或更新一处需求；px ≤ 0 = 撤销 */
export function setRoom(key: string, px: number): void {
    if (px > 0) needs.set(key, Math.ceil(px));
    else needs.delete(key);
    const next = Math.max(0, ...needs.values());
    if (next === current) return;
    current = next;
    listeners.forEach((l) => l());
}

/** 固定高度的需求（弹窗、提示）：px 为 0 时不占空间，组件卸载自动撤销 */
export function useWindowRoom(px: number): void {
    const key = useId();
    useEffect(() => {
        setRoom(key, px);
    }, [key, px]);
    useEffect(() => () => setRoom(key, 0), [key]);
}

/** 当前所有需求里最大的那个高度，0 = 没有需求 */
export function useMaxRoom(): number {
    return useSyncExternalStore(
        (cb) => {
            listeners.add(cb);
            return () => listeners.delete(cb);
        },
        () => current,
    );
}
