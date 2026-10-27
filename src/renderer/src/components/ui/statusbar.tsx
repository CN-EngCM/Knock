import * as React from "react"
import { cn } from "@/lib/utils"

/** Tone of the optional 6px status dot. The adjacent text still owns the meaning. */
type StatusBarTone = "online" | "busy" | "away" | "offline" | "error"

const toneDotClass: Record<StatusBarTone, string> = {
  online: "bg-[var(--meter-green)]",
  busy: "bg-[var(--chart-1)]",
  away: "bg-[var(--chart-3)]",
  offline: "bg-[var(--dim-foreground)]",
  error: "bg-[var(--destructive)]",
}

type StatusBarItemProps = React.ComponentProps<"div"> & {
  /** Slightly brighter text for the current selection, playhead or aggregate state. */
  emphasis?: boolean
  /** Decorative 6px state dot rendered before the label. */
  status?: StatusBarTone
}

/**
 * Flat, quiet bottom rail (25px at regular density). Children are free status cells; a `ml-auto`
 * cell pushes the trailing group to the right. `left`/`right` stay available
 * for older compositions.
 */
function StatusBar({
  left,
  right,
  className,
  children,
  ...props
}: React.ComponentProps<"div"> & { left?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div
      data-slot="statusbar"
      className={cn(
        "flex h-(--size-statusbar) shrink-0 select-none items-center gap-(--space-wide) overflow-hidden border-t border-line bg-background px-(--space-lg) text-small leading-[16.5px] font-medium text-[var(--statusbar-foreground)] [&_svg]:size-3 [&_svg]:shrink-0",
        className,
      )}
      {...props}
    >
      {left != null && <div className="flex min-w-0 items-center gap-(--space-wide)">{left}</div>}
      {children}
      {right != null && <div className="ml-auto flex min-w-0 items-center gap-(--space-wide)">{right}</div>}
    </div>
  )
}

function StatusBarItem({
  emphasis = false,
  status,
  className,
  children,
  ...props
}: StatusBarItemProps) {
  return (
    <div
      data-slot="statusbar-item"
      data-status={status}
      className={cn(
        "flex min-w-0 items-center gap-(--space-sm) truncate whitespace-nowrap tabular-nums",
        emphasis && "text-[var(--statusbar-emphasis)]",
        className,
      )}
      {...props}
    >
      {status != null && (
        <span
          data-slot="statusbar-status"
          aria-hidden="true"
          className={cn("size-[6px] shrink-0 rounded-full", toneDotClass[status])}
        />
      )}
      {children}
    </div>
  )
}

export { StatusBar, StatusBarItem }
export type { StatusBarItemProps, StatusBarTone }
