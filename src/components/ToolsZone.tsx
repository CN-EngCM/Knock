import { Suspense, type ReactNode } from "react";
import { Grid2x2, Terminal } from "lucide-react";
import { toolMeta, type ToolId } from "@/tools/registry";
import { ToolsMenu } from "./ToolsMenu";
import { useI18n } from "@/i18n/useI18n";
import type { TermSession } from "./TerminalZone";

// 右列 tab 区:工具与终端会话共用一条 tab 行——都是一等 tab。
// 行首 = 工具首页按钮(activeTab === null 即显示首页),行尾 ＋ = 工具菜单;
// 侧栏开关在顶栏(与工具菜单/新建终端/钉住/主题/设置同处)。
// 会话不是 ToolId（server 的工具 id 词汇与别名持久化不含终端），清单与激活页签
// 的所有权在 App，这里只按 props 渲染。生命周期约定（用户决策，2026-08）：
//   打开 —— 工具从工具菜单/首页卡片/搜索候选进（懒加载 chunk）；会话由 App 调 ptySpawn；
//   切换 —— 非活动工具/会话 display:none 保活（工具草稿不丢、终端回滚缓冲不丢）；
//   关闭 —— 工具 tab 的 × 卸载组件释放状态；会话 tab 的 × 结束 pty 会话（无隐藏保活态）。
// 素材注入不经 props（懒加载 chunk 未就绪时 props 会先被清空，素材在挂载前丢失），
// 由 toolInput.ts 的模块级 pending 在组件挂载时消费。
type Props = {
    open: ToolId[];
    /** 激活页签 id：工具 id（字符串）或终端会话 id（数字）；null = 工具首页 */
    active: ToolId | number | null;
    onActivate: (id: ToolId) => void;
    /** 从 tab 行 ＋ 菜单打开工具（未开则建 tab 挂载，已开仅切换）：App 的 openTool 流程，与顶栏菜单/首页卡片同源 */
    onOpenTool: (id: ToolId) => void;
    onClose: (id: ToolId) => void;
    /** 回到工具首页（不关任何 tab，面板 display:none 保活） */
    onGoHome: () => void;
    /** 工具首页内容（App 传入 ToolHome） */
    home: ReactNode;
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
    onOpenTool,
    onClose,
    onGoHome,
    home,
    onOpenSettings,
    sessions,
    onActivateSession,
    onCloseSession,
    children,
}: Props) {
    const { t } = useI18n();

    return (
        // app-no-drag:面板全交互;窗口拖拽把手仅顶栏品牌区
        <div className="app-no-drag flex min-h-0 flex-1 flex-col">
            {/* tab 行(43px):首页按钮 + 可滚动 tab 列 + 工具菜单;活动 tab 底部蓝线 */}
            <div className="flex h-[43px] flex-none items-center gap-1 border-b border-well bg-background px-2">
                <button
                    type="button"
                    className="icon-btn"
                    aria-pressed={active === null}
                    onClick={onGoHome}
                    title={t("tools.home")}
                    aria-label={t("tools.home")}
                >
                    <Grid2x2 className="size-4" />
                </button>
                {/* 标签过多时横向滚动(隐藏滚动条),活动标签与 × 始终可达 */}
                <div className="flex h-full min-w-0 flex-1 items-stretch overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    {open.map((id) => (
                        <div
                            key={id}
                            onClick={() => onActivate(id)}
                            className={`group/tab relative flex h-full cursor-default select-none items-center gap-1.5 px-2.5 text-xs whitespace-nowrap transition-colors ${
                                active === id
                                    ? "bg-hover text-foreground"
                                    : "text-muted-foreground hover:text-foreground"
                            }`}
                        >
                            {active === id && (
                                <span className="absolute inset-x-0 bottom-0 h-0.5 bg-primary" aria-hidden />
                            )}
                            <span className="max-w-[150px] truncate">{t(toolMeta(id).nameKey)}</span>
                            <button
                                type="button"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onClose(id);
                                }}
                                aria-label={t("common.close")}
                                className="grid size-[18px] flex-none place-items-center rounded-[3px] text-[13px] leading-none opacity-50 transition-opacity hover:bg-hover hover:opacity-100"
                            >
                                ×
                            </button>
                        </div>
                    ))}
                    {sessions.map((s) => (
                        <div
                            key={s.id}
                            onClick={() => onActivateSession(s.id)}
                            className={`group/tab relative flex h-full cursor-default select-none items-center gap-1.5 px-2.5 text-xs whitespace-nowrap transition-colors ${
                                active === s.id
                                    ? "bg-hover text-foreground"
                                    : "text-muted-foreground hover:text-foreground"
                            }`}
                        >
                            {active === s.id && (
                                <span className="absolute inset-x-0 bottom-0 h-0.5 bg-primary" aria-hidden />
                            )}
                            {/* 小图标区分会话 tab 与工具 tab（× 会结束进程，值得一眼可辨） */}
                            <Terminal className="size-3.5 opacity-70" aria-hidden />
                            <span className="max-w-[150px] truncate">{s.label}</span>
                            <button
                                type="button"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onCloseSession(s.id);
                                }}
                                aria-label={t("menu.delete")}
                                title={t("menu.delete")}
                                className="grid size-[18px] flex-none place-items-center rounded-[3px] text-[13px] leading-none opacity-50 transition-opacity hover:bg-hover hover:opacity-100"
                            >
                                ×
                            </button>
                        </div>
                    ))}
                </div>
                <ToolsMenu open={open} onOpen={onOpenTool} placement="tab" />
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
                            <Suspense fallback={<div className="p-3 text-xs text-muted-foreground">…</div>}>
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
                {/* 工具首页：无激活页签时显示（工具面板全部 display:none 保活） */}
                {active === null && home}
            </div>
        </div>
    );
}
