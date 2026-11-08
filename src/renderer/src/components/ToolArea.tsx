import { Suspense, lazy } from "react";
import { Spinner } from "@/components/ui/spinner";
import { toolMeta, type ToolId } from "@/tools/registry";

// xterm 本体较大，第一个终端出现时才加载
const TermPanel = lazy(() => import("./TermPanel").then((m) => ({ default: m.TermPanel })));

// 工具区：同一时间只显示一个工具或终端，其余活着的只是 display:none 留着
// （草稿、终端回滚缓冲都不丢）。关掉才卸载：工具回到初始态，终端会话结束。
// 存活的工具、终端会话和当前显示项都归 App 持有（开工具、起终端、shell 退出、后台超时都在 App），这里只负责画。

export type Term = { sessionId: number; title: string };
/** 当前显示的是哪一个；null = 什么都不显示（窗口收成一条） */
export type Shown = { kind: "tool"; id: ToolId } | { kind: "term"; sessionId: number } | null;

type Props = {
    /** 活着的内置工具（不含终端） */
    tools: ToolId[];
    terms: Term[];
    shown: Shown;
    onTermTitle: (sessionId: number, title: string) => void;
    onOpenSettings: () => void;
};

export function ToolArea({ tools, terms, shown, onTermTitle, onOpenSettings }: Props) {
    return (
        <div className="app-no-drag relative min-h-0 min-w-0 flex-1">
            {tools.map((id) => (
                <div
                    key={`tool:${id}`}
                    hidden={!(shown?.kind === "tool" && shown.id === id)}
                    className="absolute inset-0"
                >
                    <ToolBody toolId={id} onOpenSettings={onOpenSettings} />
                </div>
            ))}
            {terms.map((term) => {
                const active = shown?.kind === "term" && shown.sessionId === term.sessionId;
                return (
                    <div key={`term:${term.sessionId}`} hidden={!active} className="absolute inset-0">
                        <Suspense fallback={null}>
                            <TermPanel
                                sessionId={term.sessionId}
                                active={active}
                                onTitle={(title) => onTermTitle(term.sessionId, title)}
                            />
                        </Suspense>
                    </div>
                );
            })}
        </div>
    );
}

function ToolBody({ toolId, onOpenSettings }: { toolId: ToolId; onOpenSettings: () => void }) {
    const Component = toolMeta(toolId).Component;
    // 终端没有 Component，它走 TermPanel
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
