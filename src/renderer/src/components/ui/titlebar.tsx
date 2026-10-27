import * as React from "react"
import { cn } from "@/lib/utils"
import { Copy, Maximize2, Minimize2, Minus, Square, X } from "lucide-react"
import { usePlatform, type Platform } from "@/lib/platform"

type WindowControlAction = "minimize" | "maximize" | "close"

/** 窗口按钮的可访问名称，maximized 时最大化按钮显示 restore */
type WindowControlLabels = Partial<Record<"minimize" | "maximize" | "restore" | "close", string>>

const defaultWindowControlLabels = {
  minimize: "Minimize",
  maximize: "Maximize",
  restore: "Restore",
  close: "Close",
}

/** 仅预留空位时的默认宽度（px）：mac 红绿灯 52，Windows 3×46 的 titleBarOverlay，Linux 约 96 */
const defaultReservedWidth: Record<Platform, number> = { mac: 52, windows: 138, linux: 96 }

// 窗口按钮贴着标题栏边缘，焦点环必须画在按钮内侧，否则会被标题栏的 overflow-hidden 裁掉。
const insetOutline = { outlineOffset: -2 } as const

type ControlsProps = {
  labels: typeof defaultWindowControlLabels
  maximized: boolean
  onAction: (action: WindowControlAction) => void
}

/** mac 红绿灯：中性灰圆点（与装饰圆点同一令牌），悬停整组或键盘聚焦时显示图标 */
function MacWindowControls({ labels, maximized, onAction }: ControlsProps) {
  const dot =
    "gan-no-drag relative inline-flex size-3 items-center justify-center rounded-full bg-window-control text-titlebar-foreground shadow-[inset_0_0_0_1px_rgb(0_0_0/25%)] [&_svg]:size-2 [&_svg]:opacity-0 group-hover/lights:[&_svg]:opacity-100 focus-visible:[&_svg]:opacity-100"
  return (
    <div data-slot="titlebar-window-controls" data-platform="mac" className="group/lights flex shrink-0 items-center gap-2">
      <button type="button" aria-label={labels.close} data-action="close" className={dot} style={insetOutline} onClick={() => onAction("close")}>
        <X strokeWidth={3} aria-hidden />
      </button>
      <button type="button" aria-label={labels.minimize} data-action="minimize" className={dot} style={insetOutline} onClick={() => onAction("minimize")}>
        <Minus strokeWidth={3} aria-hidden />
      </button>
      <button type="button" aria-label={maximized ? labels.restore : labels.maximize} data-action="maximize" className={dot} style={insetOutline} onClick={() => onAction("maximize")}>
        {maximized ? <Minimize2 strokeWidth={3} aria-hidden /> : <Maximize2 strokeWidth={3} aria-hidden />}
      </button>
    </div>
  )
}

/**
 * Windows / Linux 末端窗口按钮，绝对定位在标题栏边缘（与 Electron titleBarOverlay 一样悬浮在内容之上）。
 * Windows 为 46px 宽、贴边的方形按钮，关闭悬停变红；Linux 为 24px 圆形按钮、离边缘 12px，
 * 关闭悬停保持中性（GNOME / KDE 习惯）。
 */
function EndWindowControls({ platform, size, labels, maximized, onAction }: ControlsProps & {
  platform: "windows" | "linux"
  size: "compact" | "large"
}) {
  const windows = platform === "windows"
  const button = windows
    ? "inline-flex h-full w-[46px] items-center justify-center text-titlebar-foreground hover:bg-(--state-hover-control) active:bg-(--state-pressed) [&_svg]:size-3.5"
    : "inline-flex size-6 items-center justify-center rounded-full text-titlebar-foreground hover:bg-(--state-hover-control) active:bg-(--state-pressed) [&_svg]:size-3.5"
  const close = windows
    ? "hover:bg-[var(--button-standard-destructive)] hover:text-white active:bg-[var(--button-standard-destructive)] active:text-white active:opacity-80"
    : ""
  return (
    <div
      data-slot="titlebar-window-controls"
      data-platform={platform}
      className={cn(
        "gan-no-drag absolute z-10 flex items-center",
        windows ? "end-0" : "end-3 gap-1",
        size === "large" ? "top-0 h-[34px]" : "inset-y-0",
      )}
    >
      <button type="button" aria-label={labels.minimize} data-action="minimize" className={button} style={insetOutline} onClick={() => onAction("minimize")}>
        <Minus aria-hidden />
      </button>
      <button type="button" aria-label={maximized ? labels.restore : labels.maximize} data-action="maximize" className={button} style={insetOutline} onClick={() => onAction("maximize")}>
        {maximized ? <Copy className="size-3" aria-hidden /> : <Square className="size-3" aria-hidden />}
      </button>
      <button type="button" aria-label={labels.close} data-action="close" className={cn(button, close)} style={insetOutline} onClick={() => onAction("close")}>
        <X aria-hidden />
      </button>
    </div>
  )
}

/** Titlebar 中心凹陷井：放大镜搜索、标题输入等内容的容器 */
function TitlebarWell({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="titlebar-well"
      className={cn(
        "gan-no-drag flex h-10 min-w-0 select-none flex-col items-center justify-center overflow-hidden rounded-[7px] bg-[linear-gradient(var(--well-top),var(--well-bottom))] px-[18px] py-1 shadow-well has-[input:focus]:bg-none has-[input:focus]:bg-[var(--control-input-focus-background)]",
        className,
      )}
      {...props}
    />
  )
}

/**
 * GaN.UI Titlebar
 *
 * 桌面软件窗口标题栏：紧凑（--size-titlebar，regular 密度 34px）或大号 68px（不随密度变化）两种，中间为标题或自定义内容井，
 * 左右为工具插槽。整个容器是可拖拽区（Electron 下生效），插槽内容自动排除拖拽。
 *
 * compact 使用左右等宽的弹性轨道承载标题，large 使用左右两个 1fr 网格列，
 * 因此左右动作数量不等时标题仍保持容器几何中心；large 的中心列由
 * centerMaxWidth 限宽，过长标题在列内省略而不是换行。
 *
 * 平台窗口控件（默认 windowControls="none"，行为与旧版一致，仍可用 trafficLights 画装饰圆点）：
 * "buttons" 渲染可用的窗口按钮——mac 在起始端（红绿灯），Windows 在末端（最小化/最大化/关闭，贴边，
 * 关闭悬停红色），Linux 在末端（圆形小按钮）；"reserve" 只预留空位，给 Electron 的
 * trafficLightPosition / titleBarOverlay 绘制的原生控件让位。平台取自 platform 属性，
 * 缺省取 PlatformProvider / 自动检测；窗口控件开启后忽略 trafficLights。
 */
function Titlebar({
  title,
  trafficLights = true,
  windowControls = "none",
  platform: platformProp,
  reservedWidth,
  maximized = false,
  onMinimize,
  onMaximize,
  onClose,
  windowControlLabels,
  left,
  right,
  center,
  centerMaxWidth = 260,
  size = "compact",
  className,
  style,
  ...props
}: Omit<React.HTMLAttributes<HTMLDivElement>, "title"> & {
  /** 窗口标题，center 未提供时显示在正中；字符串在窄空间内单行省略 */
  title?: React.ReactNode
  /** 是否显示左侧中性灰窗口圆点（纯展示样式）；windowControls 不为 "none" 时忽略 */
  trafficLights?: boolean
  /**
   * 平台窗口控件：none 不处理（默认，兼容旧版）；buttons 渲染可交互的窗口按钮；
   * reserve 只预留空位，供 Electron 原生控件（trafficLightPosition / titleBarOverlay）占用。
   */
  windowControls?: "none" | "buttons" | "reserve"
  /** 覆盖平台，缺省取 PlatformProvider / 自动检测；决定窗口控件在起始端（mac）还是末端（Windows/Linux） */
  platform?: Platform
  /** reserve 模式预留宽度（px；mac 从起始内边距算起，Windows/Linux 从窗口边缘算起），默认 mac 52、Windows 138、Linux 96 */
  reservedWidth?: number
  /** 窗口是否已最大化，仅影响最大化按钮的图标与可访问名称（还原） */
  maximized?: boolean
  /** 点击最小化按钮 */
  onMinimize?: () => void
  /** 点击最大化/还原按钮，由宿主决定切换 */
  onMaximize?: () => void
  /** 点击关闭按钮 */
  onClose?: () => void
  /** 窗口按钮的可访问名称，默认英文 Minimize / Maximize / Restore / Close */
  windowControlLabels?: WindowControlLabels
  /** 左侧插槽，默认为窗口按钮 */
  left?: React.ReactNode
  /** 右侧插槽 */
  right?: React.ReactNode
  /** 中心插槽，替换标题，常配合 TitlebarWell 使用 */
  center?: React.ReactNode
  /** 大号模式下中心区最大宽度（px） */
  centerMaxWidth?: number
  /** compact 高度取 --size-titlebar（regular 34px）/ large 固定 68px */
  size?: "compact" | "large"
}) {
  const isLarge = size === "large"
  const contextPlatform = usePlatform()
  const platform = platformProp ?? contextPlatform
  const labels = { ...defaultWindowControlLabels, ...windowControlLabels }
  const hasControls = windowControls !== "none"
  const controlsOnStart = platform === "mac"
  const handleAction = (action: WindowControlAction) => {
    if (action === "minimize") onMinimize?.()
    else if (action === "maximize") onMaximize?.()
    else onClose?.()
  }
  // 空位：mac 在起始端从内边距起算；Windows/Linux 在末端从窗口边缘起算（抵消根节点水平内边距）。
  const reserveSpacer = (
    <div
      aria-hidden
      data-slot="titlebar-window-controls-reserve"
      data-platform={platform}
      className={cn("h-5 shrink-0", !controlsOnStart && (isLarge ? "-me-[14px]" : "-me-(--space-xl)"))}
      style={{ width: reservedWidth ?? defaultReservedWidth[platform] }}
    />
  )
  return (
    <div
      data-slot="titlebar"
      data-size={size}
      data-platform={hasControls ? platform : undefined}
      data-window-controls={hasControls ? windowControls : undefined}
      style={
        {
          "--titlebar-center-width": `${centerMaxWidth}px`,
          ...(isLarge
            ? {
                gridTemplateColumns:
                  "minmax(0,1fr) minmax(0, min(var(--titlebar-center-width), calc(100% - 168px))) minmax(0,1fr)",
              }
            : {}),
          ...style,
        } as React.CSSProperties
      }
      className={cn(
        "gan-drag relative min-w-0 select-none border-x-0 border-t-0 border-b border-window-border bg-[linear-gradient(var(--bar-top),var(--bar-bottom))]",
        isLarge
          ? "grid h-[68px] min-h-[68px] items-center gap-3 overflow-hidden px-[14px] py-2 shadow-flat"
          : "flex h-(--size-titlebar) items-center gap-(--space-md) overflow-hidden px-(--space-xl)",
        className,
      )}
      {...props}
    >
      <div
        data-slot="titlebar-left"
        className={cn(
          "gan-no-drag flex min-w-0 items-center gap-(--space-md)",
          !isLarge && "min-w-[72px] flex-1",
        )}
      >
        {hasControls && controlsOnStart &&
          (windowControls === "buttons" ? (
            <MacWindowControls labels={labels} maximized={maximized} onAction={handleAction} />
          ) : (
            reserveSpacer
          ))}
        {left ??
          (!hasControls && trafficLights && (
            <span className="flex gap-[7px]" aria-hidden>
              <span className="size-[11px] rounded-full bg-window-control shadow-[inset_0_0_0_1px_rgb(0_0_0/25%)]" />
              <span className="size-[11px] rounded-full bg-window-control shadow-[inset_0_0_0_1px_rgb(0_0_0/25%)]" />
              <span className="size-[11px] rounded-full bg-window-control shadow-[inset_0_0_0_1px_rgb(0_0_0/25%)]" />
            </span>
          ))}
      </div>
      <div
        data-slot="titlebar-center"
        className={cn(
          "min-w-0 text-center text-small font-medium text-titlebar-foreground dark:[text-shadow:0_1px_#0004]",
          isLarge ? "w-full" : "max-w-full shrink px-2",
          center != null ? "gan-no-drag" : "pointer-events-none overflow-hidden text-ellipsis whitespace-nowrap",
        )}
        aria-label={center != null && typeof title === "string" ? title : undefined}
      >
        {center ??
          (typeof title === "string" ? (
            <span className="block truncate">{title}</span>
          ) : (
            title
          ))}
      </div>
      <div
        data-slot="titlebar-right"
        className={cn(
          "gan-no-drag flex min-w-0 items-center gap-(--space-md)",
          isLarge ? "justify-end" : "min-w-[72px] flex-1 justify-end",
        )}
      >
        {right}
        {hasControls && !controlsOnStart && reserveSpacer}
      </div>
      {windowControls === "buttons" && !controlsOnStart && (
        <EndWindowControls
          platform={platform as "windows" | "linux"}
          size={size}
          labels={labels}
          maximized={maximized}
          onAction={handleAction}
        />
      )}
    </div>
  )
}

export { Titlebar, TitlebarWell }
export type { WindowControlLabels }
