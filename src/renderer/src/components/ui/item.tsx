import * as React from "react"
import { Slot } from "radix-ui"
import { cn } from "@/lib/utils"

type ItemVariant = "default" | "outline" | "muted"
type ItemSize = "default" | "sm"

function Item({ className, variant = "default", size = "default", asChild = false, ...props }: React.ComponentProps<"div"> & { variant?: ItemVariant; size?: ItemSize; asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "div"
  return <Comp data-slot="item" data-variant={variant} data-size={size} className={cn("flex flex-wrap items-center gap-(--space-2xl) rounded-md border border-transparent text-xs text-foreground", size === "sm" ? "gap-(--space-xl) px-(--space-xl) py-(--space-md)" : "px-(--space-xl) py-(--space-lg)", variant === "outline" && "border-border", variant === "muted" && "bg-muted", asChild && "cursor-default select-none hover:bg-(--state-hover)", className)} {...props} />
}
function ItemGroup({ className, ...props }: React.ComponentProps<"div">) { return <div data-slot="item-group" className={cn("flex min-w-0 flex-col gap-2", className)} {...props} /> }
function ItemMedia({ className, variant = "default", ...props }: React.ComponentProps<"div"> & { variant?: "default" | "icon" | "image" }) { return <div data-slot="item-media" data-variant={variant} className={cn("flex shrink-0 items-center justify-center [&_svg]:pointer-events-none", variant === "default" && "[&_svg]:size-4", variant === "icon" && "min-h-[34px] max-h-[42px] w-[34px] self-stretch rounded-[5px] bg-canvas shadow-well [&_svg]:size-5", variant === "image" && "size-8 overflow-hidden rounded-sm [&_img]:size-full [&_img]:object-cover", className)} {...props} /> }
function ItemContent({ className, ...props }: React.ComponentProps<"div">) { return <div data-slot="item-content" className={cn("flex min-w-0 flex-1 flex-col gap-1", className)} {...props} /> }
function ItemTitle({ className, ...props }: React.ComponentProps<"div">) { return <div data-slot="item-title" className={cn("flex w-fit max-w-full min-w-0 items-center gap-2 text-xs leading-[16.5px] font-medium", className)} {...props} /> }
function ItemDescription({ className, ...props }: React.ComponentProps<"p">) { return <p data-slot="item-description" className={cn("line-clamp-2 text-xs leading-[18px] text-balance text-muted-foreground", className)} {...props} /> }
function ItemActions({ className, ...props }: React.ComponentProps<"div">) { return <div data-slot="item-actions" className={cn("flex shrink-0 items-center gap-2", className)} {...props} /> }
function ItemHeader({ className, ...props }: React.ComponentProps<"div">) { return <div data-slot="item-header" className={cn("flex basis-full items-center justify-between gap-2", className)} {...props} /> }
function ItemFooter({ className, ...props }: React.ComponentProps<"div">) { return <div data-slot="item-footer" className={cn("flex basis-full items-center justify-between gap-2", className)} {...props} /> }
function ItemSeparator({ className, ...props }: React.ComponentProps<"hr">) { return <hr data-slot="item-separator" className={cn("shrink-0 border-border", className)} {...props} /> }
export { Item, ItemGroup, ItemMedia, ItemContent, ItemTitle, ItemDescription, ItemActions, ItemHeader, ItemFooter, ItemSeparator }
