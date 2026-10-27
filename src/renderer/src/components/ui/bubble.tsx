import * as React from "react"
import { cn } from "@/lib/utils"
import { Slot } from "radix-ui"

type BubbleVariant = "primary" | "secondary" | "muted" | "tinted" | "outline" | "destructive" | "ghost"
type BubbleSide = "start" | "end"
const BubbleContext = React.createContext<{ side: BubbleSide; variant: BubbleVariant }>({ side: "start", variant: "primary" })

function Bubble({ side = "start", variant = "primary", className, children, ...props }: React.ComponentProps<"div"> & { side?: BubbleSide; variant?: BubbleVariant }) {
  return <BubbleContext.Provider value={{ side, variant }}><div data-slot="bubble" data-side={side} data-variant={variant} className={cn("flex min-w-0 flex-col gap-1", side === "end" ? "items-end" : "items-start", className)} {...props}>{children}</div></BubbleContext.Provider>
}

const surfaces: Record<BubbleVariant, string> = {
  primary: "rounded-md border-transparent bg-primary text-white",
  secondary: "rounded-xl border-black/5 bg-[var(--bubble-secondary,color-mix(in_srgb,var(--muted),white_4.2%))] text-[color:var(--bubble-secondary-foreground,color-mix(in_srgb,var(--foreground),var(--muted-foreground)_22%))] dark:border-white/5",
  muted: "rounded-xl border-black/5 bg-[var(--bubble-secondary,color-mix(in_srgb,var(--muted),white_4.2%))] text-[color:var(--bubble-secondary-foreground,color-mix(in_srgb,var(--foreground),var(--muted-foreground)_22%))] dark:border-white/5",
  tinted: "rounded-md border-transparent bg-[var(--bubble-tinted,oklch(from_var(--primary)_0.3_calc(c*0.4)_h))] text-foreground",
  outline: "rounded-md border-border bg-background text-foreground",
  destructive: "rounded-md border-transparent bg-destructive/20 text-destructive",
  ghost: "w-full rounded-none border-transparent bg-transparent p-0 text-foreground",
}

type BubbleContentProps = React.ComponentProps<"div"> & {
  /** 将表面样式合并到单个子元素，用于真实的动作按钮或链接气泡。 */
  asChild?: boolean
}

function BubbleContent({ asChild = false, className, ...props }: BubbleContentProps) {
  const { variant } = React.useContext(BubbleContext)
  const Comp = asChild ? Slot.Root : "div"
  return <Comp data-slot="bubble-content" data-variant={variant} data-interactive={asChild || undefined} className={cn(
    "max-w-full border px-3 py-2 text-xs leading-[1.55] [overflow-wrap:anywhere] [&_a]:underline [&_a]:underline-offset-2 [&_p+p]:mt-2",
    asChild ? "w-fit cursor-default select-none text-start hover:brightness-110 active:brightness-95" : "select-text",
    surfaces[variant],
    className,
  )} {...props} />
}

function BubbleGroup({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="bubble-group" role="group" className={cn("flex flex-col gap-2", className)} {...props} />
}

function BubbleReactions({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="bubble-reactions" className={cn("flex flex-wrap gap-1 px-1", className)} {...props} />
}

function BubbleReaction({ pressed, defaultPressed = false, onPressedChange, disabled, className, children, onClick, ...props }: Omit<React.ComponentProps<"button">, "aria-pressed"> & { pressed?: boolean; defaultPressed?: boolean; onPressedChange?: (pressed: boolean) => void }) {
  const [internal, setInternal] = React.useState(defaultPressed)
  const active = pressed ?? internal
  return <button data-slot="bubble-reaction" type="button" aria-pressed={active} disabled={disabled} className={cn("inline-flex h-6 items-center gap-1 rounded-full border border-border bg-background px-2 text-small leading-4 cursor-default select-none aria-pressed:border-primary/60 aria-pressed:bg-primary/15 disabled:opacity-(--state-disabled-opacity)", className)} onClick={e => { onClick?.(e); if (!e.defaultPrevented) { if (pressed === undefined) setInternal(!active); onPressedChange?.(!active) } }} {...props}>{children}</button>
}

export { Bubble, BubbleContent, BubbleGroup, BubbleReactions, BubbleReaction }
export type { BubbleContentProps, BubbleVariant, BubbleSide }
