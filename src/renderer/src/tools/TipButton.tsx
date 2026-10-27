import type { ComponentProps, ReactNode } from "react";
import { ActionBarButton } from "@/components/ui/action-bar";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type Props = ButtonProps & {
    /** Tooltip 内容；图标按钮的可访问名仍由调用点的 aria-label 决定。 */
    label: ReactNode;
};

/** 按钮 + Tooltip 的薄组合。Tooltip 依赖 App 根部的 TooltipProvider（Portal 保留上下文）。 */
export function TipButton({ label, ...props }: Props) {
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <Button {...props} />
            </TooltipTrigger>
            <TooltipContent>{label}</TooltipContent>
        </Tooltip>
    );
}

type ActionButtonProps = ComponentProps<typeof ActionBarButton>;

/**
 * ActionBarButton + Tooltip 的薄组合（浮动工具条专用）。
 * TooltipTrigger 的 asChild 需要触发节点的 DOM ref 与事件：React 19 里 ref 是普通 prop，
 * ActionBarButton 的 ...props 会把它透传到 <button>，因此无需另包一层真实节点。
 */
export function TipActionButton({ label, ...props }: ActionButtonProps & { label: ReactNode }) {
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <ActionBarButton {...props} />
            </TooltipTrigger>
            <TooltipContent>{label}</TooltipContent>
        </Tooltip>
    );
}
