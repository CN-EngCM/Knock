import * as React from "react";
import { cn } from "@/lib/utils";
import { Tooltip as TooltipPrimitive } from "radix-ui";

function TooltipProvider({ delayDuration = 400, ...props }: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
    return <TooltipPrimitive.Provider data-slot="tooltip-provider" delayDuration={delayDuration} {...props} />;
}

function Tooltip({ ...props }: React.ComponentProps<typeof TooltipPrimitive.Root>) {
    return <TooltipPrimitive.Root data-slot="tooltip" {...props} />;
}

function TooltipTrigger({ ...props }: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
    return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

function TooltipContent({
    className,
    sideOffset = 4,
    children,
    ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
    return (
        <TooltipPrimitive.Portal>
            <TooltipPrimitive.Content
                data-slot="tooltip-content"
                sideOffset={sideOffset}
                className={cn(
                    "z-50 inline-flex w-fit max-w-xs origin-(--radix-tooltip-content-transform-origin) items-center gap-1.5 rounded-[4px] border-[0.5px] border-black/10 dark:border-white/10 bg-background px-2 py-[5px] text-[11px] leading-[1.4] font-medium text-balance text-foreground shadow-[0_2px_6px_rgb(0_0_0/11%)] dark:shadow-[0_2px_6px_rgb(0_0_0/33%)] duration-100 ease-[cubic-bezier(0.16,1,0.3,1)] data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 data-closed:animate-out data-closed:fade-out-0 motion-reduce:animate-none",
                    className,
                )}
                {...props}
            >
                {children}
            </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
    );
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger };
