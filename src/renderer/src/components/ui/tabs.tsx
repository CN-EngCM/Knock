import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Tabs as TabsPrimitive } from "radix-ui"
import { cn } from "@/lib/utils"

function Tabs({ className, orientation = "horizontal", ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return <TabsPrimitive.Root data-slot="tabs" orientation={orientation} className={cn("group/tabs flex gap-2 data-[orientation=horizontal]:flex-col", className)} {...props} />
}
const tabsListVariants = cva("group/tabs-list inline-flex w-fit items-center rounded-md p-[3px] text-xs text-muted-foreground group-data-[orientation=horizontal]/tabs:h-(--size-tabs-well) group-data-[orientation=vertical]/tabs:flex-col", { variants: { variant: { default: "bg-[var(--well)] shadow-well dark:bg-black/35", line: "gap-1 rounded-none bg-transparent p-0" } }, defaultVariants: { variant: "default" } })
function TabsList({ className, variant = "default", ...props }: React.ComponentProps<typeof TabsPrimitive.List> & VariantProps<typeof tabsListVariants>) {
  return <TabsPrimitive.List data-slot="tabs-list" data-variant={variant} className={cn(tabsListVariants({ variant }), className)} {...props} />
}
function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return <TabsPrimitive.Trigger data-slot="tabs-trigger" className={cn("relative inline-flex h-(--size-tabs-item) cursor-default select-none items-center justify-center gap-(--space-sm) whitespace-nowrap rounded-sm px-(--space-md) text-xs font-medium text-muted-foreground disabled:opacity-(--state-disabled-opacity) data-[state=active]:bg-white data-[state=active]:text-foreground data-[state=active]:shadow-raised dark:data-[state=active]:bg-white/18 group-data-[orientation=vertical]/tabs:w-full group-data-[orientation=vertical]/tabs:justify-start [&_svg]:size-3.5 group-data-[variant=line]/tabs-list:rounded-none group-data-[variant=line]/tabs-list:data-[state=active]:bg-transparent group-data-[variant=line]/tabs-list:data-[state=active]:shadow-none group-data-[variant=line]/tabs-list:after:absolute group-data-[variant=line]/tabs-list:after:inset-x-0 group-data-[variant=line]/tabs-list:after:bottom-0 group-data-[variant=line]/tabs-list:after:h-px group-data-[variant=line]/tabs-list:data-[state=active]:after:bg-foreground", className)} {...props} />
}
// forceMount keeps inactive panels mounted, so hide them by state instead of leaving every panel visible.
function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content data-slot="tabs-content" className={cn("min-w-0 flex-1 text-xs data-[state=inactive]:hidden", className)} {...props} />
}
export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }
