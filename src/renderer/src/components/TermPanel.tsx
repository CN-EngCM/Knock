import { useEffect, useRef } from "react";
import { Terminal as XTerm, type Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { toast } from "sonner";
import { api } from "@/api/client";
import { useI18n } from "@/i18n/useI18n";
import { cleanTermTitle } from "@/lib/termTitle";
import { getTerm, registerTerm, termFont, themeFromVars } from "./termStore";

// 终端标签页：每个会话一个标签。xterm 实例归 termStore 持有（与组件生命周期解耦）：
// 组件重挂时（开发态 StrictMode 会把 effect 跑两遍）已存在的实例只做 term.open(新容器)，
// 回滚缓冲不丢；会话结束由 App 关标签并 dispose 实例。

// 复制粘贴：xterm 不碰剪贴板（Ctrl+C/V 默认作为 SIGINT/0x16 直发 shell）。
// 复制统一走右键——Windows 终端惯例：有选区复制、无选区粘贴；Ctrl+C 永远
// 留给中断程序。Ctrl+V（macOS 为 Cmd+V）只管粘贴，走 term.paste 自动适配
// bracketed paste。剪贴板读写走主进程 API：渲染进程只放行了写权限（见 app.ts），
// 读剪贴板必须经主进程。
const isMac = navigator.userAgent.includes("Mac");

type Props = {
    sessionId: number;
    /** 是否是当前标签：切回来时要重新 fit 并聚焦（隐藏时容器是 0 尺寸，fit 无意义） */
    active: boolean;
    /** 终端程序用 OSC 0/2 改标题时通知标签排换名字 */
    onTitle: (title: string) => void;
};

export function TermPanel({ sessionId, active, onTitle }: Props) {
    const { t } = useI18n();
    const hostRef = useRef<HTMLDivElement>(null);
    // 回调走 ref：父级每次渲染都是新函数，不能让它触发整个 xterm 挂载 effect 重跑
    const onTitleRef = useRef(onTitle);
    onTitleRef.current = onTitle;
    // 挂载 effect 里造好「重排并聚焦」的动作放这里，active 变化的 effect 来调
    const refocus = useRef<() => void>(() => {});

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
                // 行高不能大于 1：DOM 渲染器里方块字符也由字体绘制，单元格被撑高后
                // 字形只占中间一段，TUI 用方块拼的 logo 会碎成一格一格的横条。
                lineHeight: 1,
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
                    // return false 只让 xterm 不处理这次按键，拦不住浏览器默认行为：
                    // 不 preventDefault 的话，随后的原生 paste 事件会被 xterm 内置监听
                    // 再粘一次（右键走 contextmenu，不触发 paste，所以右键从来正常）
                    ev.preventDefault();
                    void pasteFromClipboard(term);
                    return false;
                }
                return true;
            });
            handle = { term, fit };
        }
        // 终端程序可用 OSC 0/2 改窗口标题：跟随到标签上。订阅随本次挂载
        const titleSub = term.onTitleChange((title) => {
            const next = cleanTermTitle(title);
            if (next) onTitleRef.current(next);
        });
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

        // fit 后把新尺寸同步给 pty；隐藏的标签跳过（0 尺寸 fit 无意义）。
        // 拖宽侧栏或缩放窗口时容器尺寸每帧都在变，TUI 程序会跟着反复重排；画面仍立即 fit，
        // pty 尺寸改成停手后再发（120ms 尾随），别让 vim/fzf 这类程序被高频重排拖慢。
        let sizeTimer: number | undefined;
        let sentCols = 0;
        let sentRows = 0;
        const sendSize = () => {
            sizeTimer = undefined;
            if (term.cols === sentCols && term.rows === sentRows) return;
            sentCols = term.cols;
            sentRows = term.rows;
            void api.ptyResize(sessionId, term.cols, term.rows);
        };
        const scheduleSize = () => {
            // 首次先同步一次，免得 TUI 按 80x24 画完再跳
            if (!sentCols) {
                sendSize();
                return;
            }
            window.clearTimeout(sizeTimer);
            sizeTimer = window.setTimeout(sendSize, 120);
        };
        const fitAndSync = () => {
            if (el.offsetParent === null) return;
            try {
                fit.fit();
            } catch {
                /* 0 尺寸瞬间，忽略 */
            }
            scheduleSize();
        };
        requestAnimationFrame(fitAndSync);
        const ro = new ResizeObserver(fitAndSync);
        ro.observe(el);
        // 等一帧再 fit：标签刚被切回来时 display 还没生效
        refocus.current = () =>
            requestAnimationFrame(() => {
                fitAndSync();
                term.focus();
            });
        return () => {
            ro.disconnect();
            titleSub.dispose();
            el.removeEventListener("contextmenu", onContextMenu);
            // 卸载时还有没发出的尺寸就补一刀，避免 pty 停在拖动中途的大小
            if (sizeTimer !== undefined) {
                window.clearTimeout(sizeTimer);
                sendSize();
            }
            // 实例保留在 termStore——会话结束才 dispose
        };
    }, [sessionId, t]);

    // 成为当前标签（含新开的终端）：重新 fit 并聚焦
    useEffect(() => {
        if (active) refocus.current();
    }, [active]);

    return <div ref={hostRef} className="relative h-full min-h-0 p-1" />;
}
