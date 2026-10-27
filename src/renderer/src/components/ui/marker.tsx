import * as React from "react"
import { cn } from "@/lib/utils"

type MarkerVariant = "default" | "muted" | "primary" | "destructive"
type MarkerAlign = "start" | "center" | "end"
type MarkerStructure = "default" | "separator" | "border"
type MarkerProps = React.ComponentProps<"div"> & {
  /** 颜色语义；不是参考页的结构变体。 */
  variant?: MarkerVariant
  align?: MarkerAlign
  /** 兼容旧调用的分隔结构别名，等同于 structure="separator"。 */
  separator?: boolean
  /** 结构：默认行、两侧分隔线或底边边界。 */
  structure?: MarkerStructure
  icon?: React.ReactNode
  /** 为内容添加工作中 shimmer；系统要求减弱动效时停止动画但保留静态渐变。 */
  shimmer?: boolean
}

const shimmerClass =
  "bg-[linear-gradient(90deg,var(--muted-foreground),var(--foreground)_45%,var(--muted-foreground))] bg-[length:200%_100%] bg-clip-text text-transparent animate-pulse motion-reduce:animate-none"

function MarkerShimmer({ className, ...props }: React.ComponentProps<"span">) {
  return <span data-slot="marker-shimmer" className={cn(shimmerClass, className)} {...props} />
}

function Marker({
  className,
  children,
  variant = "default",
  align = "center",
  separator = false,
  structure,
  icon,
  shimmer = false,
  ...props
}: MarkerProps) {
  const resolvedStructure = structure ?? (separator ? "separator" : "default")
  return <div
    data-slot="marker"
    data-variant={variant}
    data-structure={resolvedStructure}
    data-shimmer={shimmer || undefined}
    className={cn(
      "relative flex min-h-4 w-full min-w-0 items-center gap-2 text-start text-xs leading-4 [&_a]:underline [&_a]:underline-offset-3 [&_a:hover]:text-foreground",
      align === "center" ? "justify-center" : align === "end" ? "justify-end" : "justify-start",
      variant === "primary" ? "text-primary" : variant === "destructive" ? "text-destructive" : variant === "muted" ? "text-dim-foreground" : "text-muted-foreground",
      resolvedStructure === "border" && "border-b border-line pb-2",
      className,
    )}
    {...props}
  >
    {resolvedStructure === "separator" && <span aria-hidden="true" data-slot="marker-separator" className="h-0 min-w-3 flex-1 border-t border-line" />}
    {icon && <span data-slot="marker-icon" aria-hidden="true" className="flex size-4 shrink-0 items-center justify-center [&>svg]:size-4">{icon}</span>}
    <span data-slot="marker-content" className={cn("min-w-0 max-w-full break-words text-center", shimmer && shimmerClass)}>{children}</span>
    {resolvedStructure === "separator" && <span aria-hidden="true" data-slot="marker-separator" className="h-0 min-w-3 flex-1 border-t border-line" />}
  </div>
}

export { Marker, MarkerShimmer }
export type { MarkerAlign, MarkerProps, MarkerStructure, MarkerVariant }
