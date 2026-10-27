import * as React from "react"
import { Slot } from "radix-ui"
import { cn } from "@/lib/utils"
import type { Button } from "@/components/ui/button"

type ActionBarTheme = "charcoal" | "dark" | "light"
type TimecodeFormat = "hh:mm:ss:ff" | "mm:ss:ff"

/** Format a frame count as drop-free timecode. Frame rate is rounded to a whole number. */
function formatTimecode(
  frames: number,
  frameRate = 25,
  format: TimecodeFormat = "hh:mm:ss:ff",
): string {
  const fps = Math.max(1, Math.round(frameRate))
  const totalFrames = Math.max(0, Math.floor(frames))
  const parts = [
    Math.floor(totalFrames / fps / 3600),
    Math.floor(totalFrames / fps / 60) % 60,
    Math.floor(totalFrames / fps) % 60,
    totalFrames % fps,
  ]
  const visible = format === "mm:ss:ff" ? parts.slice(1) : parts

  return visible.map((part) => String(part).padStart(2, "0")).join(":")
}

/** Transport band. Button groups are composed with ActionBarGroup. */
function ActionBar({
  theme,
  className,
  style,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { theme?: ActionBarTheme }) {
  // 未传 theme 时跟随应用主题：--action-auto-* 在暗色下为同调石墨材质（明度与 charcoal 相当），浅色下为浅色栏材质。
  const surface =
    theme === "dark"
      ? "var(--action-dark-surface)"
      : theme === "light"
        ? "var(--action-light-surface)"
        : theme == null
          ? "var(--action-auto-surface)"
          : "var(--action-surface)"
  return (
    <div
      data-slot="action-bar"
      data-theme={theme ?? "auto"}
      className={cn(
        "gan-no-drag flex min-w-0 flex-wrap items-center justify-between gap-x-7 gap-y-3 px-(--space-2xl) py-3.5 select-none shadow-[0_1px_2px_rgb(0_0_0/32%)]",
        className,
      )}
      style={
        {
          background: surface,
          color:
            theme === "light"
              ? "var(--action-light-foreground)"
              : theme == null
                ? "var(--action-auto-foreground)"
                : "var(--action-foreground)",
          "--action-control-fill":
            theme === "light"
              ? "var(--action-light-control, rgb(255 255 255 / 15%))"
              : theme == null
                ? "var(--action-auto-control, rgb(255 255 255 / 5.5%))"
                : "var(--action-control, rgb(255 255 255 / 5.5%))",
          ...style,
        } as React.CSSProperties
      }
      {...props}
    />
  )
}
function ActionBarGroup({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="action-bar-group"
      role="group"
      className={cn(
        "inline-flex max-w-full shrink-0 items-center overflow-hidden rounded-[10px] bg-[var(--action-control-fill,var(--action-control,rgb(255_255_255/5.5%)))] [&>[data-slot=action-bar-button]]:rounded-none [&>[data-slot=action-bar-button]:not([data-active])]:bg-transparent",
        className,
      )}
      {...props}
    />
  )
}
function ActionBarButton({
  active,
  activeTint,
  plain = false,
  asChild = false,
  // Legacy Button variant is accepted; the transport theme owns the surface.
  variant: _variant,
  size = "icon",
  className,
  style,
  ...props
}: React.ComponentProps<typeof Button> & { activeTint?: string; plain?: boolean }) {
  const Comp = asChild ? Slot.Root : "button"
  return (
    <Comp
      type="button"
      data-slot="action-bar-button"
      data-active={active || undefined}
      data-plain={plain || undefined}
      aria-pressed={active == null ? undefined : active}
      className={cn(
        "inline-flex h-(--size-subbar) min-w-9 shrink-0 cursor-default items-center justify-center gap-(--space-sm) rounded-[10px] border-0 bg-[var(--action-button-fill)] text-xs font-medium outline-none focus-visible:-outline-offset-2 select-none disabled:pointer-events-none disabled:opacity-40 enabled:hover:brightness-110 enabled:active:bg-[var(--action-pressed,rgb(0_0_0/35%))] data-active:text-white data-active:shadow-[inset_0_1px_1px_rgb(0_0_0/18%),inset_0_-1px_1px_rgb(255_255_255/3.5%)] [&_svg]:pointer-events-none [&_svg]:size-[17px] [&_svg]:shrink-0",
        size?.startsWith("icon") ? "w-9 p-0" : "px-(--space-xl)",
        className,
      )}
      style={
        {
          "--action-button-fill": active
            ? (activeTint ?? "var(--action-active, rgb(0 0 0 / 52%))")
            : plain
              ? "transparent"
              : "var(--action-control-fill, var(--action-control, rgb(255 255 255 / 5.5%)))",
          ...style,
        } as React.CSSProperties
      }
      {...props}
    />
  )
}
function ActionBarSeparator({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      data-slot="action-bar-separator"
      aria-hidden
      className={cn(
        "mx-1 h-5 w-0 shrink-0 border-s border-black/25",
        className,
      )}
      {...props}
    />
  )
}
function ActionBarWell({
  maxWidth = 320,
  className,
  style,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { maxWidth?: number }) {
  return (
    <div
      data-slot="action-bar-well"
      data-max-width={maxWidth}
      className={cn(
        "min-w-0 max-w-full rounded-[10px] bg-[image:var(--action-well-surface)] px-2.5 py-2 text-center text-white shadow-[inset_0_1px_2px_rgb(0_0_0/27%),inset_0_0_0_0.5px_rgb(0_0_0/40%),0_0.5px_0_rgb(255_255_255/9%)]",
        className,
      )}
      style={{ maxWidth: `min(${maxWidth}px, 100%)`, ...style }}
      {...props}
    />
  )
}
function TransportWell({
  frames,
  frameRate = 25,
  duration,
  onSeek,
  detail,
  format = "hh:mm:ss:ff",
  className,
  ...props
}: Omit<React.HTMLAttributes<HTMLDivElement>, "onSeek"> & {
  frames: number
  frameRate?: number
  duration?: number
  onSeek?: (frames: number) => void
  detail?: React.ReactNode
  format?: TimecodeFormat
}) {
  const fps = Math.max(1, Math.round(frameRate))
  const limit = Math.max(0, Math.floor(duration ?? Math.max(frames, fps * 60)))
  const safeFrames = Math.max(0, Math.min(limit, Math.floor(frames)))
  const timecode = formatTimecode(safeFrames, fps, format)
  return (
    <ActionBarWell
      data-well="transport"
      className={cn("w-[210px] shrink-0", className)}
      {...props}
    >
      <div className="text-micro leading-[13.5px] font-medium text-white/45">Timecode</div>
      <output
        aria-label="Timecode"
        aria-live="off"
        className="block font-mono text-readout leading-[27.5px] tracking-normal text-[var(--action-timecode)]"
      >
        {timecode}
      </output>
      <div className="text-micro leading-[13.5px] font-medium text-white/40">
        {detail ?? `${frameRate} fps`}
      </div>
      {onSeek && (
        <input
          aria-label="Seek position"
          aria-valuetext={timecode}
          type="range"
          min={0}
          max={limit}
          step={1}
          value={safeFrames}
          onChange={(e) =>
            onSeek(Math.max(0, Math.min(limit, Math.floor(Number(e.target.value)))))
          }
          className="mt-1 block h-2 w-full accent-primary"
        />
      )}
    </ActionBarWell>
  )
}
function MusicWell({
  bars,
  beats,
  tempo,
  meter = "4/4",
  onTempoChange,
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  bars: number
  beats: number
  tempo: number
  meter?: string
  onTempoChange?: (tempo: number) => void
}) {
  const [tempoDraft, setTempoDraft] = React.useState(String(tempo))

  React.useEffect(() => setTempoDraft(String(tempo)), [tempo])

  return (
    <ActionBarWell
      data-well="music"
      className={cn(
        "flex w-[228px] shrink-0 items-center justify-evenly gap-4 [&>div]:min-w-0",
        className,
      )}
      {...props}
    >
      <div>
        <div className="text-micro text-white/45">POSITION</div>
        <output aria-label="Musical position" aria-live="off" className="text-base tabular-nums">
          {String(bars).padStart(3, "0")} · {beats}
        </output>
      </div>
      <span className="h-7 w-0 border-s border-white/10" />
      <div>
        <div className="text-micro text-white/45">TEMPO</div>
        {onTempoChange ? (
          <input
            aria-label="Tempo"
            type="number"
            min={20}
            max={300}
            value={tempoDraft}
            onChange={(e) => {
              const draft = e.target.value
              setTempoDraft(draft)
              const value = Number(draft)
              if (draft.trim() && Number.isFinite(value) && value >= 20 && value <= 300) {
                onTempoChange(value)
              }
            }}
            onBlur={() => setTempoDraft(String(tempo))}
            className="w-12 bg-transparent text-center text-base outline-none tabular-nums"
          />
        ) : (
          <output className="text-base tabular-nums">{tempo}</output>
        )}
      </div>
      <div>
        <div className="text-micro text-white/45">METER</div>
        <output className="text-base">{meter}</output>
      </div>
    </ActionBarWell>
  )
}
function TaskWell({
  label,
  progress,
  detail,
  onCancel,
  className,
  ...props
}: Omit<React.HTMLAttributes<HTMLDivElement>, "onCancel"> & {
  label: React.ReactNode
  progress: number
  detail?: React.ReactNode
  onCancel?: () => void
}) {
  const clamped = Math.max(0, Math.min(1, progress))
  return (
    <ActionBarWell data-well="task" className={cn("w-[280px] text-left", className)} {...props}>
      <div className="flex items-center justify-between gap-3 text-small">
        <span className="truncate">{label}</span>
        {onCancel && (
          <button
            type="button"
            aria-label="Cancel task"
            onClick={onCancel}
            className="cursor-default text-white/50 hover:text-white"
          >
            ×
          </button>
        )}
      </div>
      <progress
        aria-label={typeof label === "string" ? label : "Task progress"}
        value={clamped}
        max={1}
        className="my-1 block h-1 w-full accent-primary"
      />
      <div className="text-micro text-white/40">{detail ?? `${Math.round(clamped * 100)}%`}</div>
    </ActionBarWell>
  )
}
function ActionBarSlider({
  value,
  onValueChange,
  resetValue,
  min = 0,
  max = 1,
  step = 0.01,
  format,
  tint = "var(--action-slider-fill)",
  className,
  style,
  ...props
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> & {
  value: number
  onValueChange: (value: number) => void
  min?: number
  max?: number
  step?: number
  resetValue?: number
  tint?: string
  format?: (value: number) => string
}) {
  const range = max > min ? max - min : 1
  const clamped = Math.max(min, Math.min(max, value))
  const ratio = (clamped - min) / range
  const reset =
    resetValue == null ? undefined : Math.max(min, Math.min(max, resetValue))
  const valueText = format ? format(clamped) : props["aria-valuetext"]
  const clamp = (next: number) => Math.max(min, Math.min(max, next))
  return (
    <input
      {...props}
      data-slot="action-bar-slider"
      aria-label={props["aria-label"] ?? "Value"}
      aria-valuetext={valueText}
      type="range"
      min={min}
      max={max}
      step={step}
      value={clamped}
      onChange={(e) => onValueChange(clamp(Number(e.target.value)))}
      onDoubleClick={(e) => {
        props.onDoubleClick?.(e)
        if (reset != null) onValueChange(reset)
      }}
      className={cn(
        "h-(--size-control-sm) w-[120px] cursor-default appearance-none rounded-full border-0 px-(--space-md) shadow-[inset_0_1px_2px_rgb(0_0_0/47%),0_0.5px_0_rgb(255_255_255/9%)] [:root:not(.dark)_[data-theme=auto]_&]:shadow-[inset_0_1px_2px_rgb(0_0_0/15%),0_0.5px_0_rgb(255_255_255/9%)] [&::-moz-range-track]:h-1 [&::-moz-range-thumb]:size-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-[var(--bar-slider-thumb)] [&::-moz-range-thumb]:shadow-[0_1px_3px_rgb(0_0_0/40%)] [:root:not(.dark)_[data-theme=auto]_&::-moz-range-thumb]:shadow-[0_1px_3px_rgb(0_0_0/13%)] [&::-webkit-slider-runnable-track]:h-1 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-thumb]:-mt-2 [&::-webkit-slider-thumb]:size-5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[var(--bar-slider-thumb)] [&::-webkit-slider-thumb]:shadow-[0_1px_3px_rgb(0_0_0/40%)] [:root:not(.dark)_[data-theme=auto]_&::-webkit-slider-thumb]:shadow-[0_1px_3px_rgb(0_0_0/13%)]",
        className,
      )}
      style={{
        background: `linear-gradient(to right, ${tint} ${ratio * 100}%, var(--action-slider-track) ${ratio * 100}%) center / calc(100% - 16px) 4px no-repeat, var(--action-slider-well)`,
        ...style,
      }}
    />
  )
}
export {
  ActionBar,
  ActionBarButton,
  ActionBarGroup,
  ActionBarSeparator,
  ActionBarWell,
  ActionBarSlider,
  TransportWell,
  MusicWell,
  TaskWell,
  formatTimecode,
}
export type { ActionBarTheme, TimecodeFormat }
