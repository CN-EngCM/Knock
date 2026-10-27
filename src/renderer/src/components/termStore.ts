import { api, onPtyEvent } from "@/api/client";
import type { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";
import type { ITheme } from "@xterm/xterm";
import { DEFAULT_MONO_STACK, withFallback } from "@/lib/fonts";

// 终端会话的 xterm 实例表：实例生命周期与 dock 面板解耦——面板被拖动重组只是
// DOM 重挂（term.open 到新容器，回滚缓冲在实例上不丢），会话结束才 dispose。
// 本模块刻意不 import xterm 运行时（只有 type import）：它随 App 主包加载，
// xterm 本体留在 DockTerm 面板的懒加载块里。

export interface TermHandle {
    term: Terminal;
    fit: FitAddon;
}

const terms = new Map<number, TermHandle>();
// 面板挂载（xterm 就绪）前到达的 pty 输出先攒着，register 时回放；
// 首个终端面板要等懒加载块，这个缓冲比旧架构更有必要
const pending = new Map<number, string[]>();

let fontCfg = { monoFont: "", fontSize: 13 };

// 主题色从 CSS 变量现读（--term-* 实底令牌随 .dark 类切换，见 index.css；
// xterm 需要实底色且自带的解析器不认 color-mix()，选区色用专门的 rgba 令牌）
export function themeFromVars(): ITheme {
    const cs = getComputedStyle(document.documentElement);
    const v = (n: string) => cs.getPropertyValue(n).trim();
    return {
        background: v("--term-bg"),
        foreground: v("--term-fg"),
        cursor: v("--primary"),
        cursorAccent: v("--term-bg"),
        selectionBackground: v("--term-sel"),
    };
}

/** 建实例用的字体选项（创建时一次读当前配置） */
export function termFont(): { fontFamily: string; fontSize: number } {
    return { fontFamily: withFallback(fontCfg.monoFont, DEFAULT_MONO_STACK), fontSize: fontCfg.fontSize };
}

export function getTerm(id: number): TermHandle | undefined {
    return terms.get(id);
}

export function registerTerm(id: number, handle: TermHandle) {
    terms.set(id, handle);
    const buffered = pending.get(id);
    if (buffered) {
        for (const chunk of buffered) handle.term.write(chunk);
        pending.delete(id);
    }
}

export function disposeTerm(id: number) {
    terms.get(id)?.term.dispose();
    terms.delete(id);
    pending.delete(id);
}

/** 全量 fit（字体变更后重排用）；不可见面板（隐藏组）跳过，恢复可见时面板自行 fit */
export function fitAll() {
    for (const [id, { term, fit }] of terms.entries()) {
        try {
            fit.fit();
            void api.ptyResize(id, term.cols, term.rows);
        } catch {
            /* 0 尺寸瞬间，忽略 */
        }
    }
}

/** 字体设置变化：已有实例运行期改 fontFamily/fontSize，改完全量重新 fit */
export function setTermFont(monoFont: string, fontSize: number) {
    fontCfg = { monoFont, fontSize };
    const family = withFallback(monoFont, DEFAULT_MONO_STACK);
    for (const { term } of terms.values()) {
        term.options.fontFamily = family;
        term.options.fontSize = fontSize;
    }
    requestAnimationFrame(() => fitAll());
}

// pty 输出：id 分发到对应实例；实例未就绪先缓冲。模块级单份订阅，无重挂叠加问题
onPtyEvent((e) => {
    if (e.type !== "data") return;
    const handle = terms.get(e.id);
    if (handle) handle.term.write(e.data);
    else {
        const list = pending.get(e.id) ?? [];
        list.push(e.data);
        pending.set(e.id, list);
    }
});

// 主题切换（html 的 .dark 类变化）→ 运行期换主题色，不重建进程不清缓冲
{
    const observer = new MutationObserver(() => {
        const theme = themeFromVars();
        for (const { term } of terms.values()) term.options.theme = theme;
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
}
