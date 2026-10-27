import { cn } from "@/lib/utils"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn("animate-pulse rounded-sm bg-black/5 dark:bg-white/5 motion-reduce:animate-none", className)}
      {...props}
    />
  )
}

export { Skeleton }
