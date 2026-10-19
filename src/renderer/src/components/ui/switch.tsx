import * as React from "react";
import { Switch as Primitive } from "radix-ui";
import { cn } from "@/lib/utils";

function Switch({
    className,
    size = "default",
    ...props
}: React.ComponentProps<typeof Primitive.Root> & { size?: "sm" | "default" }) {
    return (
        <Primitive.Root
            data-slot="switch"
            data-size={size}
            className={cn(
                "group/switch relative inline-flex h-[18px] w-[31px] shrink-0 cursor-default select-none items-center rounded-full border-0 bg-input p-[2px] shadow-[inset_0_1px_2px_#0001,inset_0_0_0_0.5px_#0003,0_0.5px_0_#ffffff16] dark:shadow-[inset_0_1px_2px_#0003,inset_0_0_0_0.5px_#0004,0_0.5px_0_#ffffff16] transition-colors duration-100 data-[state=checked]:bg-primary disabled:opacity-50 data-[size=sm]:h-[14px] data-[size=sm]:w-[24px] aria-invalid:[outline-style:solid] aria-invalid:outline-1 aria-invalid:outline-destructive",
                className,
            )}
            {...props}
        >
            <Primitive.Thumb
                data-slot="switch-thumb"
                className="pointer-events-none block size-[14px] rounded-full bg-foreground shadow-[0_1px_2px_#0002] dark:shadow-[0_1px_2px_#0005] transition-transform duration-100 ease-[var(--motion-ease)] data-[state=checked]:translate-x-[13px] group-data-[size=sm]/switch:size-[10px] group-data-[size=sm]/switch:data-[state=checked]:translate-x-[10px] rtl:data-[state=checked]:-translate-x-[13px] rtl:group-data-[size=sm]/switch:data-[state=checked]:-translate-x-[10px]"
            />
        </Primitive.Root>
    );
}
export { Switch };
