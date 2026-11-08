import { Suspense, lazy, useState } from "react";
import { X } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Spinner } from "@/components/ui/spinner";
import { toolMeta, type ToolId } from "@/tools/registry";
import { useI18n } from "@/i18n/useI18n";
import { ConfirmDialog } from "./dialogs/ConfirmDialog";
import { ToolHome } from "./ToolHome";

// xterm 本体较大，第一个终端标签出现时才加载
const TermPanel = lazy(() => import("./TermPanel").then((m) => ({ default: m.TermPanel })));

// 右侧标签区：一排标签，工具和终端会话是并列的页，按打开顺序排。
// 没显示的标签只是 display:none 留着（草稿、终端回滚不丢），关标签才卸载：
// 工具回到初始态，终端会话结束。没有任何标签时显示工具首页。
// 标签列表与激活项归 App 持有（开工具、起终端、shell 退出都在 App），这里只负责画。

export type Tab =
    { key: string; kind: "tool"; toolId: ToolId } | { key: string; kind: "term"; sessionId: number; title: string };

export const toolTabKey = (id: ToolId) => `tool:${id}`;
export const termTabKey = (sessionId: number) => `term:${sessionId}`;

type Props = {
    tabs: Tab[];
    /** 当前标签的 key；null = 一个都没有，显示工具首页 */
    activeKey: string | null;
    onActivate: (key: string) => void;
    onClose: (key: string) => void;
    onTermTitle: (sessionId: number, title: string) => void;
    onOpenTool: (id: ToolId) => void;
    onOpenSettings: () => void;
};

export function ToolTabs({ tabs, activeKey, onActivate, onClose, onTermTitle, onOpenTool, onOpenSettings }: Props) {
    const { t } = useI18n();
    // 等确认关闭的终端标签：会话一关，里面正在跑的程序就跟着没了，所以先问一句
    const [confirmKey, setConfirmKey] = useState<string | null>(null);

    const titleOf = (tab: Tab) => (tab.kind === "tool" ? t(toolMeta(tab.toolId).nameKey) : tab.title);
    const iconOf = (tab: Tab) => toolMeta(tab.kind === "tool" ? tab.toolId : "terminal").icon;

    function requestClose(tab: Tab) {
        if (tab.kind === "term") setConfirmKey(tab.key);
        else onClose(tab.key);
    }

    return (
        <Tabs value={activeKey ?? ""} onValueChange={onActivate} className="app-no-drag h-full min-h-0 min-w-0 gap-0">
            {tabs.length > 0 && (
                <div className="flex h-[34px] flex-none items-center border-b border-line px-1.5">
                    <div className="no-scrollbar min-w-0 overflow-x-auto">
                        <TabsList variant="line" aria-label={t("tools.menu")}>
                            {tabs.map((tab) => (
                                // 关闭按钮与标签按钮并列，不嵌套，免得影响键盘操作
                                <div
                                    key={tab.key}
                                    className="relative flex-none"
                                    // 中键关闭：mousedown 要拦掉，否则 Chromium 会进入滚轮自动滚动
                                    onMouseDown={(e) => e.button === 1 && e.preventDefault()}
                                    onAuxClick={(e) => e.button === 1 && requestClose(tab)}
                                >
                                    <TabsTrigger value={tab.key} className="pe-6">
                                        <img src={iconOf(tab)} alt="" className="size-3.5 flex-none" />
                                        <span className="max-w-[150px] truncate">{titleOf(tab)}</span>
                                    </TabsTrigger>
                                    <button
                                        type="button"
                                        onClick={() => requestClose(tab)}
                                        aria-label={`${t("common.close")} ${titleOf(tab)}`}
                                        className="absolute end-0.5 top-1/2 grid size-[17px] -translate-y-1/2 place-items-center rounded-[3px] text-muted-foreground opacity-60 hover:bg-(--state-hover) hover:opacity-100 focus-visible:opacity-100"
                                    >
                                        <X className="size-3" />
                                    </button>
                                </div>
                            ))}
                        </TabsList>
                    </div>
                </div>
            )}
            <div className="relative min-h-0 flex-1">
                {tabs.map((tab) => (
                    <div key={tab.key} role="tabpanel" hidden={tab.key !== activeKey} className="absolute inset-0">
                        {tab.kind === "tool" ? (
                            <ToolBody toolId={tab.toolId} onOpenSettings={onOpenSettings} />
                        ) : (
                            <Suspense fallback={null}>
                                <TermPanel
                                    sessionId={tab.sessionId}
                                    active={tab.key === activeKey}
                                    onTitle={(title) => onTermTitle(tab.sessionId, title)}
                                />
                            </Suspense>
                        )}
                    </div>
                ))}
                {activeKey === null && (
                    <div className="absolute inset-0">
                        <ToolHome onOpen={onOpenTool} />
                    </div>
                )}
            </div>
            <ConfirmDialog
                open={confirmKey !== null}
                title={t("term.closeConfirm")}
                description={t("term.closeConfirmHint")}
                confirmLabel={t("common.close")}
                onClose={() => setConfirmKey(null)}
                onConfirm={async () => {
                    if (confirmKey !== null) onClose(confirmKey);
                }}
            />
        </Tabs>
    );
}

function ToolBody({ toolId, onOpenSettings }: { toolId: ToolId; onOpenSettings: () => void }) {
    const Component = toolMeta(toolId).Component;
    // 终端没有 Component，它的标签走 TermPanel
    if (!Component) return null;
    return (
        <div className="h-full min-h-0 overflow-auto">
            <Suspense
                fallback={
                    <div className="p-3">
                        <Spinner decorative className="text-muted-foreground" />
                    </div>
                }
            >
                <Component openSettings={onOpenSettings} />
            </Suspense>
        </div>
    );
}
