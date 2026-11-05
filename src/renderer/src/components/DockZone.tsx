import { Suspense, lazy, useCallback, useEffect, useMemo, useState, type FunctionComponent } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { DockLayout, GanDockviewTab } from "@/components/ui/dock-layout";
import type {
    DockLayoutTabMenuItem,
    DockviewApi,
    DockviewReadyEvent,
    GetTabContextMenuItemsParams,
    IDockviewPanelHeaderProps,
    IDockviewPanelProps,
    IWatermarkPanelProps,
} from "@/components/ui/dock-layout";
import { toolMeta, type ToolId } from "@/tools/registry";
import { Spinner } from "@/components/ui/spinner";
import { cleanTermTitle, TERM_TITLE_MAX } from "@/lib/termTitle";
import { useI18n } from "@/i18n/useI18n";
import { ConfirmDialog } from "./dialogs/ConfirmDialog";
import { FormRow } from "./dialogs/settings/shared";
import { ToolWorkspaceContext } from "@/tools/toolInput";
import { ToolHome } from "./ToolHome";

const DockTerm = lazy(() => import("./DockTerm").then((m) => ({ default: m.DockTerm })));

type Props = {
    /** 当前存在的工作区 id：已删除的工作区要从实例列表里剪掉 */
    workspaces: number[];
    activeId: number;
    onReady: (workspaceId: number, api: DockviewApi) => void;
    onOpenTool: (id: ToolId) => void;
    onOpenSettings: () => void;
};

// 工具区停靠容器：GaN.UI DockLayout 的业务封装，一个工作区一个实例。
// 面板 id 约定仍为 tool:<ToolId>（单实例）与 term:<会话号>——id 的唯一性只在各自实例内
// 校验，不同工作区出现同 id 不冲突。激活权威是 dockview，App 只经 api 开/关/激活。
// 空态水印 = 工具首页。组头不挂任何动作：开工具走顶栏「工具集」，关面板走标签上的 × 或右键菜单。

// 标签：终端面板点 × 或中键关闭前先确认——面板一关就结束 shell 会话，正在跑的程序
// 会跟着没。右键菜单的关闭走 dock 自己的 api，不经过这里，因此不确认（与批量关闭一致）。
// 包装层只为在捕获阶段抢在默认标签的关闭手势之前，display:contents 让它不参与标签布局。
function DockTab(props: IDockviewPanelHeaderProps) {
    const { t } = useI18n();
    const [confirming, setConfirming] = useState(false);
    if (!props.api.id.startsWith("term:")) return <GanDockviewTab {...props} />;

    const ask = (event: { preventDefault(): void; stopPropagation(): void }) => {
        event.preventDefault();
        event.stopPropagation();
        setConfirming(true);
    };
    return (
        <>
            <div
                className="contents"
                onClickCapture={(event) => {
                    if (event.target instanceof Element && event.target.closest(".gan-tab-close")) ask(event);
                }}
                onPointerUpCapture={(event) => {
                    // 中键关闭由默认标签在 pointerup 里处理，也在这里拦下
                    if (event.button === 1) ask(event);
                }}
            >
                <GanDockviewTab {...props} />
            </div>
            <ConfirmDialog
                open={confirming}
                title={t("term.closeConfirm")}
                description={t("term.closeConfirmHint")}
                confirmLabel={t("common.close")}
                onClose={() => setConfirming(false)}
                onConfirm={async () => props.api.close()}
            />
        </>
    );
}

export function DockZone({ workspaces, activeId, onReady, onOpenTool, onOpenSettings }: Props) {
    const { t } = useI18n();
    // 已挂载实例的工作区：访问过的都留着，切回去时面板、终端与回滚缓冲原样还在
    const [mounted, setMounted] = useState<number[]>(() => [activeId]);
    // 新成为当前的工作区补进列表，已删除的工作区从中剪掉；顺序保持首次访问的先后，
    // 内容没变就返回原引用，免得父级每次渲染都触发一轮更新
    useEffect(() => {
        setMounted((cur) => {
            const next = cur.filter((id) => workspaces.includes(id));
            if (!next.includes(activeId)) next.push(activeId);
            const same = next.length === cur.length && next.every((id, index) => id === cur[index]);
            return same ? cur : next;
        });
    }, [activeId, workspaces]);
    // 本帧就把当前工作区算进来：等 effect 补状态的话，切过去会闪一帧空白
    const ids = mounted.includes(activeId) ? mounted : [...mounted, activeId];

    // 面板组件表与覆盖件都保持引用稳定：dockview 换掉组件引用会整区重渲染
    const components = useMemo(
        () => ({
            tool: ({ params }: IDockviewPanelProps) => {
                const { toolId, workspaceId } = params as { toolId: ToolId; workspaceId: number };
                const meta = toolMeta(toolId);
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
                            {/* 面板所在工作区：素材与聚焦信号按它投递（见 tools/toolInput.ts） */}
                            <ToolWorkspaceContext.Provider value={workspaceId}>
                                <C openSettings={onOpenSettings} />
                            </ToolWorkspaceContext.Provider>
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

    function handleReady(event: DockviewReadyEvent, workspaceId: number) {
        onReady(workspaceId, event.api);
    }

    // 终端标签改名：dock 的默认标签菜单不提供改名，这里只给 term 面板在最前面插一项。
    // 名字只存在面板标题里（布局与会话都不持久化），空名忽略、超长截断，
    // 与终端程序 OSC 标题共用同一套长度上限
    const [renaming, setRenaming] = useState<{ api: IDockviewPanelHeaderProps["api"]; value: string } | null>(null);

    const extendTabContextMenu = useCallback(
        (items: DockLayoutTabMenuItem[], params: GetTabContextMenuItemsParams) => {
            if (!params.panel.id.startsWith("term:")) return items;
            const target = params.panel.api;
            return [
                { label: t("term.rename"), action: () => setRenaming({ api: target, value: target.title ?? "" }) },
                "separator" as const,
                ...items,
            ];
        },
        [t],
    );

    function submitRename(event: React.FormEvent) {
        event.preventDefault();
        if (!renaming) return;
        const next = cleanTermTitle(renaming.value);
        if (!next) return;
        renaming.api.setTitle(next);
        setRenaming(null);
    }

    return (
        <>
            {/* 停靠区直接铺满工作区：形状与层次由 dock 皮肤自己给（组间距、组描边、标签栏），
                不再外套留白与细边框卡片，否则等于在皮肤外再画一层框 */}
            <div className="app-no-drag h-full min-h-0">
                {ids.map((id) => (
                    // 同一时刻只显示当前工作区的实例，其余留在 DOM 里 display:none——
                    // 切走不动 dockview 布局、不卸载面板，终端进程与回滚缓冲都不受影响
                    <div key={id} className={id === activeId ? "h-full min-h-0" : "hidden"}>
                        <DockLayout
                            className="h-full"
                            components={components}
                            defaultTabComponent={DockTab}
                            watermarkComponent={watermark}
                            extendTabContextMenu={extendTabContextMenu}
                            // 组间距参与布局计算，只能走属性；缝的颜色由皮肤 --dock-gap 提供
                            groupGap={4}
                            onReady={(event) => handleReady(event, id)}
                        />
                    </div>
                ))}
            </div>
            <Dialog open={renaming !== null} onOpenChange={(open) => !open && setRenaming(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{t("term.renameTitle")}</DialogTitle>
                    </DialogHeader>
                    <form className="grid gap-4" onSubmit={submitRename}>
                        <FormRow>
                            <FieldLabel htmlFor="term-tab-title">{t("common.name")}</FieldLabel>
                            <Input
                                id="term-tab-title"
                                value={renaming?.value ?? ""}
                                onChange={(event) =>
                                    setRenaming((cur) => (cur ? { ...cur, value: event.target.value } : cur))
                                }
                                autoFocus
                                maxLength={TERM_TITLE_MAX}
                            />
                        </FormRow>
                        <DialogFooter>
                            <Button
                                type="button"
                                appearance="standard"
                                variant="outline"
                                size="default"
                                onClick={() => setRenaming(null)}
                            >
                                {t("common.cancel")}
                            </Button>
                            <Button type="submit" appearance="standard" variant="primary" size="default">
                                {t("common.save")}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        </>
    );
}
