import { useEffect, useRef, useState } from "react";
import { LayoutGrid } from "lucide-react";
import { TOOLS, type ToolId } from "@/tools/registry";
import { useI18n } from "@/i18n/useI18n";

// tab 行右簇的「工具」下拉(原顶栏「工具 ▾」的新家):内置工具的可见入口。
// ● = 已打开（点它只是切到该 tab），○ = 未打开（点它在工具区开新 tab）。
type Props = {
    open: ToolId[];
    onOpen: (id: ToolId) => void;
};

export function ToolsMenu({ open, onOpen }: Props) {
    const { t } = useI18n();
    const [show, setShow] = useState(false);
    const wrap = useRef<HTMLDivElement>(null);

    // 打开状态下点外部 / Esc 关闭；菜单未打开时不挂监听
    useEffect(() => {
        if (!show) return;
        const close = (e: MouseEvent) => {
            if (!wrap.current?.contains(e.target as Node)) setShow(false);
        };
        const esc = (e: KeyboardEvent) => {
            if (e.key === "Escape") setShow(false);
        };
        document.addEventListener("mousedown", close);
        document.addEventListener("keydown", esc);
        return () => {
            document.removeEventListener("mousedown", close);
            document.removeEventListener("keydown", esc);
        };
    }, [show]);

    return (
        /* app-no-drag:顶栏是玻璃拖拽底,触发钮与弹层都要豁免 */
        <div ref={wrap} className="app-no-drag relative flex-none">
            <button
                type="button"
                aria-expanded={show}
                className="icon-btn"
                title={t("tools.menu")}
                onClick={() => setShow((v) => !v)}
            >
                <LayoutGrid size={14} />
            </button>
            {show && (
                <div className="app-no-drag drop-anim absolute right-0 top-[calc(100%+8px)] z-50 min-w-80 rounded-2xl border border-white/16 bg-raised p-1.5 shadow-2xl shadow-black/40 backdrop-blur-2xl">
                    {/* app-no-drag:悬浮层悬出所在面板,不豁免会被全窗 app-drag 拖拽区吞掉点击/滚轮 */}
                    {TOOLS.map((tool) => (
                        <button
                            key={tool.id}
                            type="button"
                            className="flex w-full items-baseline justify-between gap-6 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-left text-[12.5px] text-dim transition-colors hover:bg-white/10 hover:text-text"
                            onClick={() => {
                                onOpen(tool.id);
                                setShow(false);
                            }}
                        >
                            <span>
                                <span className={open.includes(tool.id) ? "text-accent" : "text-muted"}>
                                    {open.includes(tool.id) ? "●" : "○"}
                                </span>{" "}
                                {t(tool.nameKey)}
                            </span>
                            <span className="text-[11.5px] text-muted">{t(tool.descKey)}</span>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
