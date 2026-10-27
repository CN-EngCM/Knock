import * as React from "react"
import { cn } from "@/lib/utils"
function Empty({ className, ...props }: React.ComponentProps<"div">) { return <div data-slot="empty" className={cn("flex min-w-0 flex-col items-center justify-center gap-3 rounded-md border border-dashed border-transparent px-4 py-7 text-center text-xs", className)} {...props} /> }
function EmptyHeader({ className, ...props }: React.ComponentProps<"div">) { return <div data-slot="empty-header" className={cn("flex max-w-sm flex-col items-center gap-2", className)} {...props} /> }
function EmptyMedia({ className, variant = "default", ...props }: React.ComponentProps<"div"> & { variant?: "default" | "icon" }) { return <div data-slot="empty-media" className={cn("mb-2 flex size-8 items-center justify-center [&_svg]:size-6", variant === "icon" && "rounded-md bg-muted", className)} {...props} /> }
function EmptyTitle({ className, as = "h3", ...props }: React.ComponentProps<"h3"> & { as?: "h2" | "h3" | "h4" | "h5" | "h6" | "p" }) { return React.createElement(as, { "data-slot": "empty-title", className: cn("text-control leading-[17.33px] font-semibold", className), ...props }) }
function EmptyDescription({ className, ...props }: React.ComponentProps<"p">) { return <p data-slot="empty-description" className={cn("text-xs leading-[19.5px] text-muted-foreground [&_a]:underline [&_a]:underline-offset-4", className)} {...props} /> }
function EmptyContent({ className, ...props }: React.ComponentProps<"div">) { return <div data-slot="empty-content" className={cn("flex max-w-sm flex-col items-center gap-4", className)} {...props} /> }
export { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription, EmptyContent }
