import * as React from "react"
import { ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"

/** Flat groups of independently collapsible desktop sections. */
function DisclosureGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="disclosure-group"
      className={cn("flex flex-col overflow-hidden border border-black/15 dark:border-black/60", className)}
      {...props}
    />
  )
}

type DisclosureProps = Omit<React.ComponentProps<"div">, "title"> & {
  title: React.ReactNode
  /** Header actions live outside the trigger, so they never toggle the section. */
  right?: React.ReactNode
  summary?: React.ReactNode
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  defaultExpanded?: boolean
  expanded?: boolean
  onExpandedChange?: (expanded: boolean) => void
  contentClassName?: string
}

function Disclosure({
  title,
  right,
  summary,
  defaultOpen,
  open: openProp,
  onOpenChange,
  defaultExpanded = true,
  expanded,
  onExpandedChange,
  className,
  contentClassName,
  children,
  ...props
}: DisclosureProps) {
  const [internalOpen, setInternalOpen] = React.useState(defaultOpen ?? defaultExpanded)
  const controlledOpen = openProp ?? expanded
  const open = controlledOpen ?? internalOpen
  const contentId = React.useId()
  const triggerId = React.useId()
  const triggerRef = React.useRef<HTMLButtonElement>(null)
  const contentRef = React.useRef<HTMLDivElement>(null)
  const lastFocused = React.useRef<HTMLElement | null>(null)
  const wasOpen = React.useRef(open)

  // Controlled parents can collapse a section while focus sits on one of its
  // controls. Moving focus to the trigger prevents a keyboard user from being
  // dropped on the document body. The last focused descendant also covers
  // browsers that blur an inert subtree before React runs this effect.
  React.useEffect(() => {
    if (wasOpen.current && !open) {
      const active = document.activeElement
      const last = lastFocused.current
      const activeInside = contentRef.current?.contains(active) === true
      const blurredByInert =
        active === document.body && last != null && contentRef.current?.contains(last) === true
      if (activeInside || blurredByInert) triggerRef.current?.focus()
    }
    if (!open) lastFocused.current = null
    wasOpen.current = open
  }, [open])

  function toggle() {
    const next = !open
    if (controlledOpen === undefined) setInternalOpen(next)
    onOpenChange?.(next)
    onExpandedChange?.(next)
  }

  return (
    <div
      data-slot="disclosure"
      data-state={open ? "open" : "closed"}
      className={cn("flex flex-col bg-[var(--disclosure-body)]", className)}
      {...props}
    >
      <div
        data-slot="disclosure-header"
        className={cn(
          "flex min-w-0 items-center border-t border-black/10 dark:border-black/40 bg-bar",
          open && "border-b border-black/10 dark:border-b-black/40",
        )}
      >
        <button
          ref={triggerRef}
          id={triggerId}
          data-slot="disclosure-trigger"
          type="button"
          aria-expanded={open}
          aria-controls={contentId}
          onClick={toggle}
          className="gan-no-drag flex h-[calc(var(--size-header)-1px)] min-w-0 flex-1 cursor-default select-none items-center gap-(--space-sm) px-(--space-lg) text-left text-small leading-[16.5px] font-medium text-foreground active:bg-(--state-pressed)"
        >
          <ChevronRight
            aria-hidden
            className={cn(
              "size-[10px] shrink-0 text-muted-foreground transition-transform duration-(--motion-quick-in) ease-(--motion-ease) motion-reduce:transition-none",
              open && "rotate-90",
            )}
          />
          <span data-slot="disclosure-title" className="min-w-0 truncate">
            {title}
          </span>
          {!open && summary != null && (
            <span
              data-slot="disclosure-summary"
              aria-hidden
              className="ml-auto truncate pl-2 text-caption leading-[15px] text-muted-foreground"
            >
              {summary}
            </span>
          )}
        </button>
        {right != null && (
          <div
            data-slot="disclosure-actions"
            className="flex shrink-0 items-center gap-(--space-xs) pr-(--space-lg)"
          >
            {right}
          </div>
        )}
      </div>
      <div
        ref={contentRef}
        id={contentId}
        role="region"
        aria-labelledby={triggerId}
        aria-hidden={!open}
        inert={!open}
        onFocusCapture={(event) => {
          lastFocused.current = event.target as HTMLElement
        }}
        onBlur={(event) => {
          const next = event.relatedTarget
          if (next instanceof Node && !event.currentTarget.contains(next)) {
            lastFocused.current = null
          }
        }}
        className={cn("grid transition-[grid-template-rows] motion-reduce:transition-none", open ? "duration-(--motion-standard-in) ease-(--motion-ease)" : "duration-(--motion-standard-out) ease-(--motion-ease-exit)")}
        style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
      >
        <div className="min-h-0 overflow-hidden">
          <div data-slot="disclosure-content" className={contentClassName}>
            {children}
          </div>
        </div>
      </div>
    </div>
  )
}

export { DisclosureGroup, Disclosure }
export type { DisclosureProps }
