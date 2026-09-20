import { Suspense, type ReactNode } from "react";
import { PanelLeft, Terminal } from "lucide-react";
import { toolMeta, type ToolId } from "@/tools/registry";
import { useI18n } from "@/i18n/useI18n";
import type { TermSession } from "./TerminalZone";

// 右列 tab 区(设计定稿:一枚内层玻璃面板):工具与终端会话共用一条 tab 行——
// 工具 tab 与会话 tab 都是一等 tab。tab 栏右簇:侧栏开关
// (工具菜单/新建终端已移顶栏搜索栏旁;钉住与设置也在顶栏)。
// 会话不是 ToolId（server 的工具 id 词汇与别名持久化不含终端），清单与激活页签
// 的所有权在 App，这里只按 props 渲染。生命周期约定（用户决策，2026-08）：
//   打开 —— 工具从工具菜单或搜索候选进（懒加载 chunk）；会话由 App 调 ptySpawn；
//   切换 —— 非活动工具/会话 display:none 保活（工具草稿不丢、终端回滚缓冲不丢）；
//   关闭 —— 工具 tab 的 × 卸载组件释放状态；会话 tab 的 × 结束 pty 会话（无隐藏保活态）。
// 素材注入不经 props（懒加载 chunk 未就绪时 props 会先被清空，素材在挂载前丢失），
// 由 toolInput.ts 的模块级 pending 在组件挂载时消费。
type Props = {
    open: ToolId[];
    /** 激活页签 id：工具 id（字符串）或终端会话 id（数字）；null = 无激活 */
    active: ToolId | number | null;
    onActivate: (id: ToolId) => void;
    onClose: (id: ToolId) => void;
    /** 左侧启动面板显隐（开关在 tab 栏右簇；侧栏自身藏了以后开关必须还在） */
    sidebarVisible: boolean;
    onToggleSidebar: () => void;
    /** 工具内引导直达设置页（如翻译缺密钥）；App 负责带定位分节打开对话框 */
    onOpenSettings: () => void;
    /** 终端会话 tab：点击激活，× 结束会话 */
    sessions: TermSession[];
    onActivateSession: (id: number) => void;
    onCloseSession: (id: number) => void;
    /** 会话 xterm 宿主槽位（App 挂载的 TerminalZone）：任一会话激活即显示 */
    children?: ReactNode;
};

export function ToolsZone({
    open,
    active,
    onActivate,
    onClose,
    sidebarVisible,
    onToggleSidebar,
    onOpenSettings,
    sessions,
    onActivateSession,
    onCloseSession,
    children,
}: Props) {
    const { t } = useI18n();

    return (
        // app-no-drag:面板全交互;窗口拖拽把手仅顶栏品牌区
        <div className="glass-panel app-no-drag flex min-h-0 flex-1 flex-col overflow-hidden">
            {/* tab 行(设计定稿 40px):活动 tab 浮白底,行底一条 12% 白线 */}
            <div className="flex h-10 flex-none items-stretch gap-1 border-b border-white/[0.12] pl-2.5 pr-2">
                {open.map((id) => (
                    <div
                        key={id}
                        onClick={() => onActivate(id)}
                        className={`flex cursor-default select-none items-center gap-1.5 rounded-t-lg px-3 text-[12.5px] transition-colors ${
                            active === id
                                ? "bg-white/[0.15] font-semibold text-white"
                                : "mt-1.5 text-white/55 hover:text-white/85"
                        }`}
                    >
                        {t(toolMeta(id).nameKey)}
                        <button
                            type="button"
                            onClick={(e) => {
                                e.stopPropagation();
                                onClose(id);
                            }}
                            className={`rounded px-1 text-[11px] leading-none transition-colors hover:bg-white/10 ${
                                active === id ? "text-white/65 hover:text-white" : "text-white/30 hover:text-white/70"
                            }`}
                        >
                            ×
                        </button>
                    </div>
                ))}
                {sessions.map((s) => (
                    <div
                        key={s.id}
                        onClick={() => onActivateSession(s.id)}
                        className={`flex cursor-default select-none items-center gap-1.5 rounded-t-lg px-3 text-[12.5px] transition-colors ${
                            active === s.id
                                ? "bg-white/[0.15] font-semibold text-white"
                                : "mt-1.5 text-white/55 hover:text-white/85"
                        }`}
                    >
                        {/* 小图标区分会话 tab 与工具 tab（× 会结束进程，值得一眼可辨） */}
                        <Terminal size={12} className="opacity-70" />
                        {s.label}
                        <button
                            type="button"
                            onClick={(e) => {
                                e.stopPropagation();
                                onCloseSession(s.id);
                            }}
                            className={`rounded px-1 text-[11px] leading-none transition-colors hover:bg-white/10 ${
                                active === s.id ? "text-white/65 hover:text-white" : "text-white/30 hover:text-white/70"
                            }`}
                            title={t("menu.delete")}
                        >
                            ×
                        </button>
                    </div>
                ))}

                {/* 右簇:侧栏开关 */}
                <span className="flex flex-1 items-center justify-end gap-1.5">
                    <button
                        type="button"
                        className="ghost-btn"
                        aria-pressed={sidebarVisible}
                        onClick={onToggleSidebar}
                        title={t("btn.sidebar")}
                    >
                        <PanelLeft size={14} />
                    </button>
                </span>
            </div>
            <div className="relative min-h-0 flex-1">
                {open.map((id) => {
                    const C = toolMeta(id).Component;
                    return (
                        <div
                            key={id}
                            className="absolute inset-0"
                            style={{ display: active === id ? undefined : "none" }}
                        >
                            <Suspense fallback={<div className="p-3 text-[12px] text-muted">…</div>}>
                                <C openSettings={onOpenSettings} />
                            </Suspense>
                        </div>
                    );
                })}
                {/* 终端槽位：children 由 App 随会话清单挂载（末个会话结束才卸载），
                    这里只包一层与工具面板同规格的定位容器，激活与否切 display 保会话 */}
                {children && (
                    <div
                        className="absolute inset-0"
                        style={{ display: typeof active === "number" ? undefined : "none" }}
                    >
                        {children}
                    </div>
                )}
            </div>
        </div>
    );
}
