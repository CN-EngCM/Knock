import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Toggle as TogglePrimitive } from "radix-ui"

const toggleVariants = cva(
  "group/toggle inline-flex cursor-default select-none items-center justify-center gap-1 rounded-md border-0 text-xs font-medium whitespace-nowrap disabled:opacity-(--state-disabled-opacity) data-[state=on]:bg-[var(--control-toggle-selected)] data-[state=on]:shadow-sunken active:brightness-90 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*=size-])]:size-3.5",
  {
    variants: {
      variant: {
        default: "bg-[var(--control-toggle-background)]",
        outline: "bg-transparent shadow-[inset_0_0_0_0.5px_#0003] hover:bg-(--state-hover-control) dark:shadow-[inset_0_0_0_0.5px_#0005]",
      },
      size: {
        default:
          "h-(--size-control-md) min-w-(--size-control-md) px-(--space-lg) has-data-[icon=inline-end]:pe-(--space-md) has-data-[icon=inline-start]:ps-(--space-md)",
        sm: "h-(--size-control-sm) min-w-(--size-control-sm) rounded-[min(var(--radius-md),12px)] px-(--space-lg) text-small has-data-[icon=inline-end]:pe-(--space-sm) has-data-[icon=inline-start]:ps-(--space-sm) [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-(--size-control-lg) min-w-(--size-control-lg) px-(--space-lg) has-data-[icon=inline-end]:pe-(--space-md) has-data-[icon=inline-start]:ps-(--space-md)",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Toggle({
  className,
  variant = "default",
  size = "default",
  ...props
}: React.ComponentProps<typeof TogglePrimitive.Root> &
  VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive.Root
      data-slot="toggle"
      className={cn(toggleVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Toggle, toggleVariants }
