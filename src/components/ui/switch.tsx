import * as React from "react";
import { Switch as SwitchPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

/** 拨动开关：未选为描边空轨道 + 暗滑钮，选中整条反色（与 .seg-on 的选中语言一致）。
 *  刻意与 Input/SelectTrigger 的「等宽描边盒子」拉开形态差，避免设置页里按钮长得像文本框。 */
function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
    return (
        <SwitchPrimitive.Root
            data-slot="switch"
            className={cn(
                "inline-flex h-[18px] w-8 shrink-0 cursor-pointer items-center rounded-full border border-line bg-faint p-0.5 transition-colors outline-none",
                "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
                "disabled:cursor-not-allowed disabled:opacity-50",
                "data-[state=checked]:border-text data-[state=checked]:bg-text",
                className,
            )}
            {...props}
        >
            <SwitchPrimitive.Thumb
                data-slot="switch-thumb"
                className={cn(
                    "block size-3 rounded-full bg-dim transition-transform",
                    "data-[state=checked]:translate-x-[14px] data-[state=checked]:bg-bg",
                )}
            />
        </SwitchPrimitive.Root>
    );
}

export { Switch };
