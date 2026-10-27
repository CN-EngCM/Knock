import { useEffect, useRef } from "react";
import { Terminal as XTerm, type Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { toast } from "sonner";
import type { IDockviewPanelProps } from "@/components/ui/dock-layout";
import { api } from "@/api/client";
import { useI18n } from "@/i18n/useI18n";
import { getTerm, registerTerm, termFont, themeFromVars } from "./termStore";

// 终端面板：每个会话一块 dock 面板。xterm 实例归 termStore 持有（与面板生命周期
// 解耦）——面板被拖动重组时本组件卸载重挂，已存在的实例只做 term.open(新容器)，
// 回滚缓冲不丢；会话结束由 App 关面板并 dispose 实例。

// 复制粘贴：xterm 不碰剪贴板（Ctrl+C/V 默认作为 SIGINT/0x16 直发 shell）。
// 复制统一走右键——Windows 终端惯例：有选区复制、无选区粘贴；Ctrl+C 永远
// 留给中断程序。Ctrl+V（macOS 为 Cmd+V）只管粘贴，走 term.paste 自动适配
// bracketed paste。剪贴板读写走主进程 API：打包后页面是 file:// 非安全
// 上下文，渲染进程没有 navigator.clipboard。
const isMac = navigator.userAgent.includes("Mac");

export function DockTerm({ params, api: panelApi }: IDockviewPanelProps) {
    const { t } = useI18n();
    const sessionId = (params as { sessionId: number }).sessionId;
    const hostRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const el = hostRef.current;
        if (!el) return;

        function pasteFromClipboard(target: Terminal) {
            api.clipboardRead()
                .then((text) => {
                    if (text) target.paste(text);
                })
                .catch(() => toast.error(t("toast.error")));
        }

        // 实例与输入监听只随会话建一次；重挂（拖动重组）时只做 term.open(新容器)
        let handle = getTerm(sessionId);
        let term: Terminal;
        let fit: FitAddon;
        if (handle) {
            term = handle.term;
            fit = handle.fit;
        } else {
            term = new XTerm({
                ...termFont(),
                lineHeight: 1.2,
                cursorBlink: true,
                scrollback: 5000,
                theme: themeFromVars(),
            });
            fit = new FitAddon();
            term.loadAddon(fit);
            term.onData((d) => void api.ptyWrite(sessionId, d));
            term.attachCustomKeyEventHandler((ev) => {
                if (ev.type !== "keydown" || ev.altKey) return true;
                const mod = isMac ? ev.metaKey : ev.ctrlKey;
                if (mod && ev.key.toLowerCase() === "v") {
                    void pasteFromClipboard(term);
                    return false;
                }
                return true;
            });
            handle = { term, fit };
        }
        // 右键挂当前容器元素（随元素生死，重挂到新容器不会重复）
        const onContextMenu = (ev: MouseEvent) => {
            ev.preventDefault();
            if (term.hasSelection()) {
                void api.clipboardWrite(term.getSelection());
                term.clearSelection();
            } else {
                void pasteFromClipboard(term);
            }
        };
        el.addEventListener("contextmenu", onContextMenu);
        term.open(el);
        registerTerm(sessionId, handle);

        // fit 后把新尺寸同步给 pty；隐藏组里的面板跳过（0 尺寸 fit 无意义）
        const fitAndSync = () => {
            if (el.offsetParent === null) return;
            try {
                fit.fit();
            } catch {
                /* 0 尺寸瞬间，忽略 */
            }
            void api.ptyResize(sessionId, term.cols, term.rows);
        };
        requestAnimationFrame(() => {
            fitAndSync();
            term.focus();
        });
        const ro = new ResizeObserver(fitAndSync);
        ro.observe(el);
        // 面板从隐藏组切回可见（激活/拖回）：重新 fit 并聚焦
        const visibility = panelApi.onDidVisibilityChange((visible) => {
            if (!visible) return;
            requestAnimationFrame(() => {
                fitAndSync();
                term.focus();
            });
        });
        return () => {
            ro.disconnect();
            visibility.dispose();
            el.removeEventListener("contextmenu", onContextMenu);
            // 实例保留在 termStore——会话结束才 dispose
        };
    }, [sessionId, panelApi, t]);

    return <div ref={hostRef} className="relative h-full min-h-0 p-1" />;
}
