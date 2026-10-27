import * as React from "react"
import { Search } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

export interface ScopebarOption {
  value: string
  label?: React.ReactNode
  icon?: React.ReactNode
  disabled?: boolean
}
function Toolbar({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="toolbar"
      role="toolbar"
      className={cn(
        "gan-drag relative flex h-(--size-toolbar) min-w-0 items-center gap-(--space-sm) overflow-x-auto border-b border-[var(--bar-bottom-line)] bg-[image:var(--toolbar-surface)] px-(--space-lg) select-none shadow-flat",
        className,
      )}
      {...props}
    />
  )
}
function ToolbarGroup({
  segmented = false,
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { segmented?: boolean }) {
  return (
    <div
      data-slot="toolbar-group"
      className={cn(
        "gan-no-drag inline-flex shrink-0 items-center",
        segmented
          ? "rounded-[5px] shadow-[0_1px_1px_rgb(0_0_0/6%)] [&>button]:rounded-none [&>button]:px-(--space-2xl) [&>button:first-child]:rounded-l-[5px] [&>button:last-child]:rounded-r-[5px] [&>button+button]:border-l [&>button+button]:border-black/10"
          : "gap-(--space-sm)",
        className,
      )}
      {...props}
    />
  )
}
function ToolbarSeparator({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      data-slot="toolbar-separator"
      aria-hidden
      className={cn(
        "h-(--size-control-sm) w-0 shrink-0 border-s border-[var(--toolbar-separator)]",
        className,
      )}
      {...props}
    />
  )
}
function ToolbarButton({
  variant = "secondary",
  size = "sm",
  active,
  className,
  ...props
}: React.ComponentProps<typeof Button>) {
  return (
    <Button
      variant={variant}
      size={size}
      active={active}
      className={cn(
        "data-active:bg-[var(--toolbar-active)] data-active:shadow-flat",
        className,
      )}
      {...props}
    />
  )
}
function ToolbarSearch({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label
      data-slot="toolbar-search"
      className={cn(
        "gan-no-drag flex h-(--size-control-md) w-36 shrink-0 items-center rounded-[4px] bg-[var(--toolbar-search)] text-xs shadow-well",
        className,
      )}
    >
      <Search aria-hidden className="ml-2 size-[13px] shrink-0 text-muted-foreground" />
      <input
        type="search"
        aria-label={props["aria-label"] ?? "Search"}
        placeholder="Search"
        className="h-full min-w-0 flex-1 border-0 bg-transparent px-(--space-md) text-xs outline-none placeholder:text-muted-foreground"
        {...props}
      />
    </label>
  )
}
function Scope({
  active,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      type="button"
      data-slot="scope"
      data-active={active || undefined}
      aria-pressed={active}
      className={cn(
        "gan-no-drag inline-flex h-(--size-scope-item) shrink-0 cursor-default items-center justify-center gap-[5px] rounded-[4px] border-0 bg-transparent px-[9px] text-small leading-[11px] font-medium text-muted-foreground dark:text-white/52 outline-none select-none disabled:pointer-events-none disabled:opacity-(--state-disabled-opacity) enabled:hover:not-data-active:bg-(--state-hover-control) enabled:hover:not-data-active:text-foreground dark:enabled:hover:not-data-active:text-white/75 data-active:bg-[var(--scope-active)] data-active:text-foreground dark:data-active:text-white/95 data-active:shadow-raised [&_svg]:size-3",
        className,
      )}
      {...props}
    />
  )
}
function Scopebar({
  options,
  value,
  onValueChange,
  label,
  children,
  className,
  ...props
}: Omit<React.HTMLAttributes<HTMLDivElement>, "onChange"> & {
  options?: ScopebarOption[]
  value?: string
  onValueChange?: (value: string) => void
  label?: React.ReactNode
}) {
  return (
    <div
      data-slot="scopebar"
      role="group"
      className={cn(
        "gan-no-drag flex h-(--size-scope-row) min-w-0 items-center gap-[3px] overflow-x-auto border-b border-[var(--bar-bottom-line)] bg-panel px-(--space-lg) select-none",
        className,
      )}
      {...props}
    >
      {label != null && (
        <>
          <span className="mr-[9px] shrink-0 text-small font-medium text-muted-foreground dark:text-white/75">{label}</span>
          <ToolbarSeparator className="mr-2 h-3.5" />
        </>
      )}
      {options?.map((option) => (
        <Scope
          key={option.value}
          active={option.value === value}
          disabled={option.disabled}
          onClick={() => onValueChange?.(option.value)}
        >
          {option.icon}
          {option.label}
        </Scope>
      ))}
      {children}
    </div>
  )
}
export { Toolbar, ToolbarGroup, ToolbarSeparator, ToolbarButton, ToolbarSearch, Scopebar, Scope }
