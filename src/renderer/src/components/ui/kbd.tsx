import * as React from "react";
import { cn } from "@/lib/utils";

// 键帽(纯展示):快捷键监听由调用方注册并清理
function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
    return (
        <kbd
            data-slot="kbd"
            className={cn(
                "inline-flex h-5 min-w-5 cursor-default items-center justify-center rounded-[3px] border border-black/20 bg-white px-[5px] font-sans text-[11px] leading-none text-muted-foreground shadow-[inset_0_0.5px_0_rgb(255_255_255/8%),0_1px_1px_rgb(0_0_0/5%)] dark:bg-white/[0.04] dark:shadow-[inset_0_0.5px_0_rgb(255_255_255/8%),0_1px_1px_rgb(0_0_0/15%)] select-none [&_svg]:size-3",
                className,
            )}
            {...props}
        />
    );
}
function KbdGroup({ className, ...props }: React.ComponentProps<"span">) {
    return <span data-slot="kbd-group" className={cn("inline-flex items-center gap-1", className)} {...props} />;
}
export { Kbd, KbdGroup };
