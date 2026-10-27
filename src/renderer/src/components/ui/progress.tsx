import * as React from "react"
import { Progress as ProgressPrimitive } from "radix-ui"
import { cn } from "@/lib/utils"

function Progress({ className, value = null, max = 100, ...props }: React.ComponentProps<typeof ProgressPrimitive.Root>) {
  const limit = Number.isFinite(max) && max > 0 ? max : 100
  const amount = typeof value === "number" && Number.isFinite(value) ? Math.min(limit, Math.max(0, value)) : null
  return (
    <ProgressPrimitive.Root {...props} data-slot="progress" value={amount} max={limit}
      className={cn("relative h-1 w-full overflow-hidden rounded-[4px] bg-input shadow-[inset_0_1px_1px_rgb(0_0_0/9%)] dark:shadow-[inset_0_1px_1px_rgb(0_0_0/26.7%)]", className)}>
      <ProgressPrimitive.Indicator data-slot="progress-indicator"
        className={cn("h-full rounded-[inherit] bg-primary shadow-[inset_0_0.5px_0_rgb(255_255_255/19%),0_1px_3px_rgb(0_0_0/7%)] dark:shadow-[inset_0_0.5px_0_rgb(255_255_255/19%),0_1px_3px_rgb(0_0_0/20%)] transition-[width] duration-(--motion-standard-in) ease-(--motion-ease) motion-reduce:transition-none", amount === null && "animate-pulse motion-reduce:animate-none")}
        style={{ width: amount === null ? "100%" : (amount / limit * 100) + "%" }} />
    </ProgressPrimitive.Root>
  )
}
export { Progress }
