import * as React from "react";
import { cn } from "@/lib/utils";

// 输入面材质(GaN.UI):井底 + 内阴影 + 0.5px 内描边;Textarea 复用同一表面
export const inputSurface =
    "cursor-default rounded-[4px] border-0 bg-[var(--control-input-background)] text-xs text-foreground shadow-[inset_0_1px_2px_#0001,inset_0_0_0_0.5px_var(--control-input-edge),0_0.5px_0_#ffffff12] dark:shadow-[inset_0_1px_2px_#0003,inset_0_0_0_0.5px_var(--control-input-edge),0_0.5px_0_#ffffff12] transition-colors duration-100 placeholder:text-muted-foreground disabled:opacity-50 aria-invalid:[outline-style:solid] aria-invalid:outline-1 aria-invalid:outline-destructive";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
    return (
        <input
            type={type}
            data-slot="input"
            className={cn(
                inputSurface,
                "h-[25px] w-full min-w-0 px-2 py-1 file:me-2 file:h-[19px] file:border-0 file:rounded-sm file:bg-white/15 file:px-2 file:text-[11px] file:text-foreground disabled:cursor-default",
                className,
            )}
            {...props}
        />
    );
}
export { Input };
