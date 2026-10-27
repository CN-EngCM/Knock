import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Slot } from "radix-ui"

const badgeVariants = cva(
  "group/badge inline-flex w-fit shrink-0 cursor-default select-none items-center justify-center gap-1 overflow-hidden tabular-nums rounded-sm border border-transparent px-[5px] py-px text-caption leading-[13.333px] font-medium whitespace-nowrap outline-none aria-invalid:border-destructive [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a]:hover:bg-primary/80",
        secondary:
          "bg-[var(--avatar-background,var(--secondary))] text-foreground [a]:hover:brightness-110",
        destructive:
          "bg-destructive text-white [a]:hover:brightness-110 dark:bg-destructive/60",
        outline:
          "border-border text-foreground [a]:hover:bg-muted [a]:hover:text-muted-foreground",
        ghost:
          "[a]:hover:bg-muted [a]:hover:text-muted-foreground dark:[a]:hover:bg-muted/50",
        link: "text-[var(--button-standard-link)] underline-offset-4 [a]:hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
