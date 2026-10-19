import { Suspense, type ReactNode } from "react";
import { SquareTerminal } from "lucide-react";
import { toolMeta, type ToolId } from "@/tools/registry";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToolsMenu } from "./ToolsMenu";
import { useI18n } from "@/i18n/useI18n";
import type { TermSession } from "./TerminalZone";

type Props = {
    open: ToolId[];
    /** 数字是终端会话，字符串是单个标签的工具；null 显示工具首页 */
    active: ToolId | number | null;
    onActivate: (id: ToolId) => void;
    onOpenTool: (id: ToolId) => void;
    onClose: (id: ToolId) => void;
    home: ReactNode;
    onOpenSettings: () => void;
    sessions: TermSession[];
    onActivateSession: (id: number) => void;
    onCloseSession: (id: number) => void;
    /** 终端宿主随会话清单挂载，切换标签时保持会话和回滚缓冲 */
    children?: ReactNode;
};

export function ToolsZone({
    open,
    active,
    onActivate,
    onOpenTool,
    onClose,
    home,
    onOpenSettings,
    sessions,
    onActivateSession,
    onCloseSession,
    children,
}: Props) {
    const { t } = useI18n();
    const closeClass =
        "absolute right-0.5 top-0.5 grid size-[17px] place-items-center rounded-[3px] text-[13px] leading-none text-muted-foreground opacity-60 hover:bg-hover hover:opacity-100 focus-visible:opacity-100";

    return (
        <Tabs
            value={typeof active === "number" ? `session:${active}` : (active ?? "")}
            onValueChange={(value) => {
                if (value.startsWith("session:")) onActivateSession(Number(value.slice(8)));
                else onActivate(value as ToolId);
            }}
            className="app-no-drag min-h-0 min-w-0 flex-1 gap-1.5 p-1.5"
        >
            <div className="flex h-[27px] flex-none items-center gap-1 rounded-md bg-background">
                {(open.length > 0 || sessions.length > 0) && (
                    <div className="min-w-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                        <TabsList
                            aria-label={t("tools.menu")}
                            className="bg-background shadow-none dark:bg-background dark:shadow-none"
                        >
                            {open.map((id) => {
                                const Icon = toolMeta(id).icon;
                                return (
                                    <div key={id} className="relative flex-none">
                                        <TabsTrigger value={id} className="pr-6">
                                            <Icon aria-hidden />
                                            <span className="max-w-[150px] truncate">{t(toolMeta(id).nameKey)}</span>
                                        </TabsTrigger>
                                        {/* 关闭按钮与标签按钮并列，避免嵌套按钮影响键盘操作。 */}
                                        <button
                                            type="button"
                                            onClick={() => onClose(id)}
                                            aria-label={`${t("common.close")} ${t(toolMeta(id).nameKey)}`}
                                            className={closeClass}
                                        >
                                            ×
                                        </button>
                                    </div>
                                );
                            })}
                            {sessions.map((s) => (
                                <div key={s.id} className="relative flex-none">
                                    <TabsTrigger
                                        value={`session:${s.id}`}
                                        aria-controls="terminal-panel"
                                        className="pr-6"
                                    >
                                        <SquareTerminal aria-hidden />
                                        <span className="max-w-[150px] truncate">{s.label}</span>
                                    </TabsTrigger>
                                    <button
                                        type="button"
                                        onClick={() => onCloseSession(s.id)}
                                        aria-label={`${t("common.close")} ${s.label}`}
                                        className={closeClass}
                                    >
                                        ×
                                    </button>
                                </div>
                            ))}
                        </TabsList>
                    </div>
                )}
                <ToolsMenu open={open} onOpen={onOpenTool} />
            </div>
            <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden rounded-md border border-line bg-background">
                {open.map((id) => {
                    const C = toolMeta(id).Component;
                    // 终端由独立宿主管理，不在这里创建单个工具面板。
                    if (!C) return null;
                    return (
                        <TabsContent key={id} value={id} forceMount className="absolute inset-0 overflow-auto">
                            <Suspense fallback={<div className="p-3 text-xs text-muted-foreground">…</div>}>
                                <C openSettings={onOpenSettings} />
                            </Suspense>
                        </TabsContent>
                    );
                })}
                {children && (
                    <div
                        id="terminal-panel"
                        role="tabpanel"
                        aria-label={t("tool.terminal.name")}
                        className="absolute inset-0"
                        style={{ display: typeof active === "number" ? undefined : "none" }}
                    >
                        {children}
                    </div>
                )}
                {active === null && home}
            </div>
        </Tabs>
    );
}
