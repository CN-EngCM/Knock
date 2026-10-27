import { Suspense, lazy, useMemo, useRef, type FunctionComponent } from "react";
import { X } from "lucide-react";
import { DockLayout } from "@/components/ui/dock-layout";
import type {
    DockviewApi,
    DockviewReadyEvent,
    IDockviewHeaderActionsProps,
    IDockviewPanelProps,
    IWatermarkPanelProps,
} from "@/components/ui/dock-layout";
import { toolMeta, type ToolId } from "@/tools/registry";
import { Spinner } from "@/components/ui/spinner";
import { ToolsMenu } from "./ToolsMenu";
import { ToolHome } from "./ToolHome";
import { useI18n } from "@/i18n/useI18n";

const DockTerm = lazy(() => import("./DockTerm").then((m) => ({ default: m.DockTerm })));

type Props = {
    onReady: (api: DockviewApi) => void;
    onOpenTool: (id: ToolId) => void;
    onOpenSettings: () => void;
};

// 工具区停靠容器：GaN.UI DockLayout 的业务封装。面板 id 约定 tool:<ToolId>（单实例）
// 与 term:<会话号>；激活权威是 dockview，App 只经 api 开/关/激活。空态水印 = 工具首页。
// 组头右端除「+」工具菜单外，单面板组的关闭按钮也在这里——皮肤把单标签的关闭
// 按钮藏进组头右端，覆盖 rightHeaderActionsComponent 时必须一并保住。

export function DockZone({ onReady, onOpenTool, onOpenSettings }: Props) {
    const { t } = useI18n();
    const apiRef = useRef<DockviewApi | null>(null);

    // 面板组件表与覆盖件都保持引用稳定：dockview 换掉组件引用会整区重渲染
    const components = useMemo(
        () => ({
            tool: ({ params }: IDockviewPanelProps) => {
                const meta = toolMeta((params as { toolId: ToolId }).toolId);
                const C = meta.Component;
                if (!C) return null;
                return (
                    <div className="h-full min-h-0 overflow-auto">
                        <Suspense
                            fallback={
                                <div className="p-3">
                                    <Spinner decorative className="text-muted-foreground" />
                                </div>
                            }
                        >
                            <C openSettings={onOpenSettings} />
                        </Suspense>
                    </div>
                );
            },
            term: (props: IDockviewPanelProps) => (
                <Suspense fallback={null}>
                    <DockTerm {...props} />
                </Suspense>
            ),
        }),
        [onOpenSettings],
    );

    const watermark = useMemo<FunctionComponent<IWatermarkPanelProps>>(
        () => () => (
            <div className="h-full">
                <ToolHome onOpen={onOpenTool} />
            </div>
        ),
        [onOpenTool],
    );

    const headerActions = useMemo<FunctionComponent<IDockviewHeaderActionsProps>>(
        () =>
            ({ panels, activePanel }) => {
                const dock = apiRef.current;
                const opened = dock
                    ? dock.panels.filter((p) => p.id.startsWith("tool:")).map((p) => p.id.slice(5) as ToolId)
                    : [];
                const single = panels.length === 1 ? (activePanel ?? panels[0]) : null;
                const singleTitle = single?.title ?? "";
                return (
                    // gan-group-actions 是皮肤约定的组头右端容器：水平/竖排组头的对齐都由它管
                    <div className="gan-group-actions">
                        <ToolsMenu open={opened} onOpen={onOpenTool} />
                        {single && (
                            <button
                                type="button"
                                className="gan-group-close"
                                aria-label={t("common.close") + singleTitle}
                                title={t("common.close") + singleTitle}
                                onPointerDown={(e) => e.preventDefault()}
                                onClick={() => single.api.close()}
                            >
                                <X aria-hidden="true" className="gan-tab-close-icon" />
                            </button>
                        )}
                    </div>
                );
            },
        [onOpenTool, t],
    );

    function handleReady(event: DockviewReadyEvent) {
        apiRef.current = event.api;
        onReady(event.api);
    }

    return (
        // 工作区 6px 留白沿用旧布局；dock 本体外缘无边框无圆角（皮肤 --dv-border-radius:0），
        // 套一张与旧内容面板同规格的卡片（细边框＋小圆角＋bg-background）给它形状，
        // 组间分隔线归 dock 皮肤，卡片内背景与组背景（--canvas）形成层次
        <div className="app-no-drag h-full min-h-0 p-1.5">
            <div className="h-full min-h-0 overflow-hidden rounded-md border border-line bg-background">
                <DockLayout
                    className="h-full"
                    components={components}
                    watermarkComponent={watermark}
                    rightHeaderActionsComponent={headerActions}
                    onReady={handleReady}
                />
            </div>
        </div>
    );
}
