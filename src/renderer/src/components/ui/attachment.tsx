import * as React from "react"
import { File, ImageOff, LoaderCircle, RotateCcw, X } from "lucide-react"
import { cn } from "@/lib/utils"

type AttachmentStatus = "ready" | "uploading" | "processing" | "error" | "complete"
type AttachmentSize = "default" | "sm" | "xs"
type AttachmentOrientation = "horizontal" | "vertical"
type AttachmentImage = {
  /** 本地缩略图或同源图片地址。 */
  src: string
  /** 替代文本；省略时使用附件名称。 */
  alt?: string
}
type AttachmentProps = Omit<React.ComponentProps<"div">, "title"> & {
  name: string
  description?: React.ReactNode
  icon?: React.ReactNode
  image?: AttachmentImage
  status?: AttachmentStatus
  progress?: number
  size?: AttachmentSize
  orientation?: AttachmentOrientation
  disabled?: boolean
  /** 在移除按钮之前追加的自定义动作，例如复制链接。 */
  actions?: React.ReactNode
  /** 预览触发器插槽，可放置 Dialog/Popover 的 asChild 触发器。 */
  trigger?: React.ReactNode
  onOpen?: () => void
  onRemove?: () => void
  onRetry?: () => void
}

const sizeStyles: Record<AttachmentSize, { root: string; media: string; content: string }> = {
  default: { root: "gap-2 p-2 text-xs", media: "size-10 rounded-lg", content: "gap-0.5" },
  sm: { root: "gap-2.5 p-1.5 text-small", media: "size-8 rounded-lg", content: "gap-0.5" },
  xs: { root: "gap-1.5 rounded-lg p-1 text-small", media: "size-7 rounded-md", content: "gap-0" },
}

const verticalWidth: Record<AttachmentSize, string> = {
  default: "w-[120px]",
  sm: "w-[104px]",
  xs: "w-[88px]",
}

const actionClass =
  "flex size-5 shrink-0 cursor-default select-none items-center justify-center rounded-md text-muted-foreground hover:bg-(--state-hover-control) hover:text-foreground disabled:pointer-events-none disabled:opacity-(--state-disabled-opacity) [&_svg]:size-3"

const statusShimmer =
  "bg-[linear-gradient(90deg,var(--muted-foreground),var(--foreground)_45%,var(--muted-foreground))] bg-[length:200%_100%] bg-clip-text text-transparent animate-pulse motion-reduce:animate-none"

type AttachmentActionProps = Omit<React.ComponentProps<"button">, "aria-label"> & {
  /** 动作的可见/辅助技术名称，例如 “Copy link”。 */
  label: string
}

function AttachmentAction({ label, className, title, type = "button", children, ...props }: AttachmentActionProps) {
  return (
    <button
      {...props}
      type={type}
      data-slot="attachment-action"
      aria-label={label}
      title={title ?? label}
      className={cn(actionClass, className)}
    >
      {children}
    </button>
  )
}

function Attachment({
  name,
  description,
  icon,
  image,
  status = "ready",
  progress,
  size = "default",
  orientation = "horizontal",
  disabled = false,
  actions,
  trigger,
  onOpen,
  onRemove,
  onRetry,
  className,
  children,
  ...props
}: AttachmentProps) {
  const loading = status === "uploading" || status === "processing"
  const vertical = orientation === "vertical"
  const percent = progress === undefined ? undefined : Math.min(100, Math.max(0, Number.isFinite(progress) ? progress : 0))
  const statusText = status === "uploading" ? `Uploading${percent === undefined ? "" : ` · ${percent}%`}` : status === "processing" ? "Processing" : status === "error" ? "Upload failed. Try again." : status === "complete" ? "Uploaded" : undefined
  const canPreview = !disabled && !loading
  const [imageState, setImageState] = React.useState<"loading" | "loaded" | "error">("loading")

  React.useEffect(() => {
    setImageState("loading")
  }, [image?.src])

  const imageFailed = imageState === "error"
  const fallbackIcon = icon ?? (image ? <ImageOff aria-hidden="true" /> : <File aria-hidden="true" />)
  const sizeStyle = sizeStyles[size]
  const hasActions = Boolean(actions || onRemove || (status === "error" && onRetry))
  const defaultDescription = description ?? statusText
  const descriptionTitle = typeof defaultDescription === "string" ? defaultDescription : undefined

  const triggerContent = trigger && canPreview
    ? <div data-slot="attachment-trigger" title={name} className="absolute inset-0 z-10 [&>*]:size-full">{trigger}</div>
    : !trigger && onOpen
      ? <button
          type="button"
          data-slot="attachment-trigger"
          aria-label={`Preview ${name}`}
          title={name}
          disabled={!canPreview}
          onClick={onOpen}
          className="absolute inset-0 z-10 cursor-default rounded-[inherit]"
        />
      : null

  return <div
    data-slot="attachment"
    data-status={status}
    data-size={size}
    data-orientation={orientation}
    aria-disabled={disabled || undefined}
    aria-busy={loading || undefined}
    className={cn(
      "group/attachment relative inline-flex max-w-full min-w-0 shrink-0 flex-wrap rounded-xl border border-border bg-card text-card-foreground has-[button]:hover:bg-muted/35",
      sizeStyle.root,
      vertical ? cn("flex-col items-stretch", verticalWidth[size]) : "items-center",
      disabled && "opacity-(--state-disabled-opacity)",
      status === "error" && "border-destructive/40 bg-destructive/5",
      className,
    )}
    {...props}
  >
    <div
      data-slot="attachment-media"
      data-image-state={image ? imageState : undefined}
      className={cn(
        "relative flex shrink-0 items-center justify-center overflow-hidden bg-muted text-muted-foreground [&_img]:size-full [&_img]:object-cover [&_svg]:pointer-events-none",
        vertical ? cn("aspect-square w-full", size === "xs" ? "rounded-md" : "rounded-lg") : sizeStyle.media,
        status === "error" && "bg-destructive/10 text-destructive",
      )}
    >
      {status === "uploading"
        ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin [--icon-stroke:1.5px] motion-reduce:animate-none" />
        : image && !imageFailed
          ? <img
              src={image.src}
              alt={image.alt ?? name}
              loading="lazy"
              decoding="async"
              draggable={false}
              onLoad={() => setImageState("loaded")}
              onError={() => setImageState("error")}
            />
          : fallbackIcon}
    </div>

    <div data-slot="attachment-content" className={cn("flex min-w-0 flex-1 flex-col leading-tight", sizeStyle.content, vertical && "w-full flex-none px-1 pb-0.5")}>
      <span
        data-slot="attachment-title"
        className={cn("block min-w-0 max-w-full truncate text-start font-medium", loading && statusShimmer)}
        title={name}
      >
        {name}
      </span>
      {defaultDescription && <span
        data-slot="attachment-description"
        role={status !== "ready" ? "status" : undefined}
        className={cn("block min-w-0 max-w-full truncate text-small text-muted-foreground", status === "error" && "text-destructive")}
        title={descriptionTitle}
      >
        {defaultDescription}
      </span>}
      {status === "uploading" && percent !== undefined && <span
        data-slot="attachment-progress"
        role="progressbar"
        aria-label={`Upload ${name}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={`${percent}%`}
        className="mt-1 h-0.5 w-full overflow-hidden rounded-full bg-input"
      >
        <span
          data-slot="attachment-progress-fill"
          className="block h-full bg-primary transition-[width] duration-(--motion-standard-in) ease-(--motion-ease) motion-reduce:transition-none"
          style={{ width: `${percent}%` }}
        />
      </span>}
      {children}
    </div>

    {hasActions && <div
      data-slot="attachment-actions"
      inert={disabled || undefined}
      className={cn(
        "relative z-20 flex shrink-0 items-center gap-0.5",
        vertical && "absolute end-2 top-2 rounded-md bg-background/70 p-0.5 backdrop-blur-sm",
      )}
    >
      {actions}
      {status === "error" && onRetry && <AttachmentAction label={`Retry ${name}`} disabled={disabled} onClick={onRetry}><RotateCcw aria-hidden="true" /></AttachmentAction>}
      {onRemove && <AttachmentAction label={`${loading ? "Cancel upload of" : "Remove"} ${name}`} disabled={disabled} onClick={onRemove}><X aria-hidden="true" /></AttachmentAction>}
    </div>}

    {triggerContent}
  </div>
}

function AttachmentGroup({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="attachment-group" className={cn("flex min-w-0 max-w-full flex-wrap items-start gap-2", className)} {...props} />
}

export { Attachment, AttachmentAction, AttachmentGroup }
export type { AttachmentActionProps, AttachmentImage, AttachmentOrientation, AttachmentProps, AttachmentSize, AttachmentStatus }
