import type { AppShortcut } from "@/api/client";

// 窗口内快捷键（App.tsx 监听）：Ctrl+` 切工作区、Ctrl+Tab 切面板，带 Shift 反向。
// 选这两个键是因为终端程序和网页几乎不用它们，在终端、网页里也能放心拦下。
// 网页（<webview>）吃掉按键，主进程 webView.ts 里有同一套映射，改键两边一起改。

/** 按键对应哪个窗口内快捷键；不是就返回 null。
 *  用物理键位 code 认反引号：中文输入法下 key 不一定是 "`"。
 *  按住不放的重复按键也认得出来（调用方要拦下它，免得被终端当成普通按键），只是不该再触发一次切换 */
export function shortcutOf(e: KeyboardEvent): AppShortcut | null {
    if (!e.ctrlKey || e.altKey || e.metaKey) return null;
    if (e.code === "Backquote") return e.shiftKey ? "workspace-prev" : "workspace-next";
    if (e.key === "Tab") return e.shiftKey ? "panel-prev" : "panel-next";
    return null;
}

/** 有弹窗、菜单、下拉这类浮层开着：Esc 该先留给它们，切换键也不该在弹窗后面悄悄生效。
 *  图库的键盘处理用的是同一个判断（role=dialog） */
export function overlayOpen(): boolean {
    return (
        document.querySelector(
            '[role="dialog"], [role="alertdialog"], [role="menu"], [data-radix-popper-content-wrapper]',
        ) !== null
    );
}

/** 焦点在能打字的地方：输入框、文本域、下拉、可编辑区域。这里的 Esc 归它自己，不收窗口 */
export function isTextEntry(el: EventTarget | null): boolean {
    if (!(el instanceof HTMLElement)) return false;
    return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable;
}
