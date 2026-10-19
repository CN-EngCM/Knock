import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Tabs as TabsPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

function Tabs({ className, orientation = "horizontal", ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
    return (
        <TabsPrimitive.Root
            data-slot="tabs"
            orientation={orientation}
            className={cn("group/tabs flex gap-2 data-[orientation=horizontal]:flex-col", className)}
            {...props}
        />
    );
}
const tabsListVariants = cva(
    "group/tabs-list inline-flex w-fit items-center rounded-md p-[3px] text-xs text-muted-foreground group-data-[orientation=horizontal]/tabs:h-[27px] group-data-[orientation=vertical]/tabs:flex-col",
    {
        variants: {
            variant: {
                default:
                    "bg-[#ececee] shadow-[inset_0_1px_1px_rgb(0_0_0/7%)] dark:bg-black/35 dark:shadow-[inset_0_1px_1px_#0003]",
                line: "gap-1 rounded-none bg-transparent p-0",
            },
        },
        defaultVariants: { variant: "default" },
    },
);
function TabsList({
    className,
    variant = "default",
    ...props
}: React.ComponentProps<typeof TabsPrimitive.List> & VariantProps<typeof tabsListVariants>) {
    return (
        <TabsPrimitive.List
            data-slot="tabs-list"
            data-variant={variant}
            className={cn(tabsListVariants({ variant }), className)}
            {...props}
        />
    );
}
function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
    return (
        <TabsPrimitive.Trigger
            data-slot="tabs-trigger"
            className={cn(
                "relative inline-flex h-[21px] cursor-default select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-sm px-2 text-xs font-medium text-muted-foreground transition-colors duration-100 disabled:opacity-50 data-[state=active]:bg-white data-[state=active]:text-foreground data-[state=active]:shadow-[inset_0_0.5px_0_rgb(255_255_255/10%),0_1px_2px_rgb(0_0_0/6%)] dark:data-[state=active]:bg-white/18 dark:data-[state=active]:shadow-[inset_0_0.5px_0_#ffffff0d,0_1px_2px_#0004] group-data-[orientation=vertical]/tabs:w-full group-data-[orientation=vertical]/tabs:justify-start [&_svg]:size-3.5 group-data-[variant=line]/tabs-list:rounded-none group-data-[variant=line]/tabs-list:data-[state=active]:bg-transparent group-data-[variant=line]/tabs-list:data-[state=active]:shadow-none group-data-[variant=line]/tabs-list:after:absolute group-data-[variant=line]/tabs-list:after:inset-x-0 group-data-[variant=line]/tabs-list:after:bottom-0 group-data-[variant=line]/tabs-list:after:h-px group-data-[variant=line]/tabs-list:data-[state=active]:after:bg-foreground",
                className,
            )}
            {...props}
        />
    );
}
// 保留挂载以保存工具草稿，非活动面板必须隐藏。
function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
    return (
        <TabsPrimitive.Content
            data-slot="tabs-content"
            className={cn("min-w-0 flex-1 text-xs data-[state=inactive]:hidden", className)}
            {...props}
        />
    );
}
export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants };
