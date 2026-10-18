import { useCallback, useEffect, useRef } from "react";
import { Terminal as XTerm, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { toast } from "sonner";
import { api, onPtyEvent } from "@/api/client";
import { DEFAULT_MONO_STACK, withFallback } from "@/lib/fonts";
import { useI18n } from "@/i18n/useI18n";

// 右列 tab 区的终端会话宿主：每个会话一个 xterm 实例。会话清单与活动页签的
// 所有权在 App——会话是 tab 行里与工具并列的一等 tab（spawn/kill/激活都在
// App），本组件只管 xterm 的生命周期：容器挂载建实例、pty 数据写入、会话从
// 清单消失时 dispose。非激活会话的容器 display:none 保活（切 tab 不丢回滚
// 缓冲）。组件随清单挂载/卸载：末个会话结束即卸载（实例已 dispose，无状态可保）。

/** 会话 tab 行（App 与本组件共享；spawn/kill/清单维护在 App） */
export type TermSession = { id: number; label: string };

// 主题色从 CSS 变量现读（--term-* 实底令牌随 .dark 类切换，见 index.css；
// xterm 需要实底色且自带的解析器不认 color-mix()，选区色用专门的 rgba 令牌）
function themeFromVars(): ITheme {
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

type Props = {
    /** 会话清单（App 持有；关 tab / shell 自退时 App 从中移除并触发卸载） */
    sessions: TermSession[];
    /** 激活会话 id；null = 激活的是工具 tab（全部容器 display:none） */
    activeId: number | null;
    /** 等宽字体（设置页「等宽字体」，空串 = 默认栈）与字号；xterm 的字不在 CSS 变量体系里，须单独喂 */
    monoFont: string;
    fontSize: number;
};

export function TerminalZone({ sessions, activeId, monoFont, fontSize }: Props) {
    const { t } = useI18n();
    const rootRef = useRef<HTMLDivElement>(null);
    const terms = useRef(new Map<number, XTerm>());
    const fits = useRef(new Map<number, FitAddon>());
    const containers = useRef(new Map<number, HTMLElement>());
    // attach 是稳定回调（不随字体设置变身份），建实例时从 ref 读当前字体；
    // activeIdRef 供不依赖 activeId 的 effect（字体变更后的重新 fit）读当前值
    const fontRef = useRef({ monoFont, fontSize });
    const activeIdRef = useRef(activeId);

    useEffect(() => {
        activeIdRef.current = activeId;
    }, [activeId]);

    const disposeTerm = useCallback((id: number) => {
        terms.current.get(id)?.dispose();
        terms.current.delete(id);
        fits.current.delete(id);
        containers.current.delete(id);
    }, []);

    // fit 后把新尺寸同步给 pty；容器不可见（display:none）时直接跳过
    const fitAndSync = useCallback((id: number) => {
        const term = terms.current.get(id);
        const fit = fits.current.get(id);
        const el = containers.current.get(id);
        if (!term || !fit || !el || el.offsetParent === null) return;
        try {
            fit.fit();
        } catch {
            /* 隐藏瞬间的 0 尺寸，忽略 */
        }
        void api.ptyResize(id, term.cols, term.rows);
    }, []);

    // 会话容器挂载 → 建 xterm 实例并接好输入输出
    const attach = useCallback(
        (el: HTMLElement | null, id: number) => {
            if (!el) {
                containers.current.delete(id);
                return;
            }
            containers.current.set(id, el);
            if (terms.current.has(id)) return;
            const term = new XTerm({
                fontFamily: withFallback(fontRef.current.monoFont, DEFAULT_MONO_STACK),
                fontSize: fontRef.current.fontSize,
                lineHeight: 1.2,
                cursorBlink: true,
                scrollback: 5000,
                theme: themeFromVars(),
            });
            const fit = new FitAddon();
            term.loadAddon(fit);
            // 复制粘贴：xterm 不碰剪贴板（Ctrl+C/V 默认作为 SIGINT/0x16 直发 shell）。
            // 复制统一走右键——Windows 终端惯例：有选区复制、无选区粘贴；Ctrl+C 永远
            // 留给中断程序（有残留选区时按 Ctrl+C 被吞成复制是实打实的坑）。
            // Ctrl+V（macOS 为 Cmd+V）只管粘贴，走 term.paste 自动适配 bracketed
            // paste（多行粘贴不会立刻逐行执行）。剪贴板读写走主进程 API：打包后页面
            // 是 file:// 非安全上下文，渲染进程没有 navigator.clipboard。
            const isMac = navigator.userAgent.includes("Mac");
            const pasteFromClipboard = () =>
                api
                    .clipboardRead()
                    .then((text) => {
                        if (text) term.paste(text);
                    })
                    .catch(() => toast.error(t("toast.error")));
            term.attachCustomKeyEventHandler((ev) => {
                if (ev.type !== "keydown" || ev.altKey) return true;
                const mod = isMac ? ev.metaKey : ev.ctrlKey;
                if (mod && ev.key.toLowerCase() === "v") {
                    void pasteFromClipboard();
                    return false;
                }
                return true;
            });
            term.open(el);
            // 右键处理挂在外层容器上；本段只在建实例的路径执行（attach 会随 ref
            // 身份变化重调），不会重复挂导致一次右键触发两遍
            el.addEventListener("contextmenu", (ev) => {
                ev.preventDefault();
                if (term.hasSelection()) {
                    void api.clipboardWrite(term.getSelection());
                    term.clearSelection();
                } else {
                    void pasteFromClipboard();
                }
            });
            term.onData((d) => void api.ptyWrite(id, d));
            terms.current.set(id, term);
            fits.current.set(id, fit);
            // 容器有尺寸后再 fit（rAF 等一帧布局）
            requestAnimationFrame(() => {
                fitAndSync(id);
                term.focus();
            });
        },
        [fitAndSync, t],
    );

    // pty 输出：id 分发到对应 xterm。必须在 cleanup 里退订（见 preload 注释）：
    // StrictMode 的双跑 effect 会叠加监听器，双份 write 就是「终端每行显示两遍」的根因。
    // 会话结束不在这里处理——清单归 App，本组件由下面的清单收缩 effect 统一 dispose
    useEffect(() => {
        const off = onPtyEvent((e) => {
            if (e.type === "data") terms.current.get(e.id)?.write(e.data);
        });
        return off;
    }, []);

    // 会话从清单消失（关 tab / shell 自退，两条路都由 App 先改清单）→ dispose 对应 xterm
    useEffect(() => {
        const live = new Set(sessions.map((s) => s.id));
        for (const id of [...terms.current.keys()]) if (!live.has(id)) disposeTerm(id);
    }, [sessions, disposeTerm]);

    // 区域尺寸变化 → 只 fit 当前可见的会话（隐藏容器 fit 无意义）
    useEffect(() => {
        const root = rootRef.current;
        if (!root) return;
        const ro = new ResizeObserver(() => {
            if (activeId !== null) fitAndSync(activeId);
        });
        ro.observe(root);
        return () => ro.disconnect();
    }, [activeId, fitAndSync]);

    // 切 tab / 终端从隐藏恢复：重新 fit + 聚焦
    useEffect(() => {
        if (activeId === null) return;
        const id = activeId;
        requestAnimationFrame(() => {
            fitAndSync(id);
            terms.current.get(id)?.focus();
        });
    }, [activeId, fitAndSync]);

    // 字体设置变化 → 已有会话同步重设（xterm 支持运行期改 fontFamily/fontSize），改完重新 fit
    useEffect(() => {
        fontRef.current = { monoFont, fontSize };
        const family = withFallback(monoFont, DEFAULT_MONO_STACK);
        for (const term of terms.current.values()) {
            term.options.fontFamily = family;
            term.options.fontSize = fontSize;
        }
        requestAnimationFrame(() => {
            const id = activeIdRef.current;
            if (id !== null) fitAndSync(id);
        });
    }, [monoFont, fontSize, fitAndSync]);

    // 主题切换（html 的 .dark 类变化）→ 已有会话运行期换主题色，不重建进程不清缓冲
    useEffect(() => {
        const root = document.documentElement;
        const sync = () => {
            const theme = themeFromVars();
            for (const term of terms.current.values()) term.options.theme = theme;
        };
        const observer = new MutationObserver(sync);
        observer.observe(root, { attributes: true, attributeFilter: ["class"] });
        return () => observer.disconnect();
    }, []);

    return (
        <div ref={rootRef} className="relative h-full min-h-0 bg-[var(--term-bg)]">
            {sessions.map((s) => (
                <div
                    key={s.id}
                    ref={(el) => attach(el, s.id)}
                    className="absolute inset-0 p-1"
                    style={{ display: activeId === s.id ? undefined : "none" }}
                />
            ))}
        </div>
    );
}
