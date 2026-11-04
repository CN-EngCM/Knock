import { Suspense, lazy, useMemo, type FunctionComponent } from "react";
import { DockLayout } from "@/components/ui/dock-layout";
import type {
    DockviewApi,
    DockviewReadyEvent,
    IDockviewPanelProps,
    IWatermarkPanelProps,
} from "@/components/ui/dock-layout";
import { toolMeta, type ToolId } from "@/tools/registry";
import { Spinner } from "@/components/ui/spinner";
import { ToolHome } from "./ToolHome";

const DockTerm = lazy(() => import("./DockTerm").then((m) => ({ default: m.DockTerm })));

type Props = {
    onReady: (api: DockviewApi) => void;
    onOpenTool: (id: ToolId) => void;
    onOpenSettings: () => void;
};

// 工具区停靠容器：GaN.UI DockLayout 的业务封装。面板 id 约定 tool:<ToolId>（单实例）
// 与 term:<会话号>；激活权威是 dockview，App 只经 api 开/关/激活。空态水印 = 工具首页。
// 组头不挂任何动作：开工具走顶栏「工具集」，关面板走标签上的 × 或右键菜单。

export function DockZone({ onReady, onOpenTool, onOpenSettings }: Props) {
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

    function handleReady(event: DockviewReadyEvent) {
        onReady(event.api);
    }

    return (
        // 停靠区直接铺满工作区：形状与层次由 dock 皮肤自己给（组间距、组描边、标签栏），
        // 不再外套留白与细边框卡片，否则等于在皮肤外再画一层框
        <div className="app-no-drag h-full min-h-0">
            <DockLayout
                className="h-full"
                components={components}
                watermarkComponent={watermark}
                // 组间距参与布局计算，只能走属性；缝的颜色由皮肤 --dock-gap 提供
                groupGap={4}
                onReady={handleReady}
            />
        </div>
    );
}
