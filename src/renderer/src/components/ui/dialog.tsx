"use client"

import * as React from "react"
import { useOverlayDensity } from "@/hooks/use-overlay-density"
import { cn } from "@/lib/utils"
import { Dialog as DialogPrimitive } from "radix-ui"

import { Button } from "@/components/ui/button"
import { XIcon } from "lucide-react"
import { usePlatform } from "@/lib/platform"

function Dialog({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 isolate z-50 bg-black/10 data-open:duration-(--motion-standard-in) data-closed:duration-(--motion-standard-out) motion-reduce:animate-none motion-reduce:transition-none data-open:ease-(--motion-ease) data-closed:ease-(--motion-ease-exit)  data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className
      )}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  closeLabel = "Close",
  ref,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean
  closeLabel?: string
}) {
  const overlayRef = useOverlayDensity(ref)
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          "fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-[18px] rounded-[12px] bg-card p-5 shadow-modal text-xs text-card-foreground ring-1 ring-(--elevation-modal-border) data-open:duration-(--motion-standard-in) data-closed:duration-(--motion-standard-out) motion-reduce:animate-none motion-reduce:transition-none data-open:ease-(--motion-ease) data-closed:ease-(--motion-ease-exit) outline-none sm:max-w-lg data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          className
        )}
        // 全局约定：对话框不因点击遮罩/外部区域而关闭（防误触丢表单草稿），
        // 关闭途径 = 右上角 × / Esc / 底部按钮；个别对话框要恢复默认行为时传自己的 onInteractOutside 覆盖
        onInteractOutside={(e) => e.preventDefault()}
        {...props}
        ref={overlayRef}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close data-slot="dialog-close" asChild>
            <Button
              appearance="standard"
              variant="ghost"
              className="absolute top-2 end-2"
              size="icon-sm"
            >
              <XIcon
              />
              <span className="sr-only">{closeLabel}</span>
            </Button>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-1.5", className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  autoOrder = true,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
  /** 按平台排列按钮：Windows 主操作在起始端，mac/Linux 在末端；子元素保持“取消在前、主操作在后”。设为 false 则固定按书写顺序靠末端排列 */
  autoOrder?: boolean
}) {
  const platform = usePlatform()
  const reversed = autoOrder && platform === "windows"
  return (
    <div
      data-slot="dialog-footer"
      data-button-order={reversed ? "primary-start" : "primary-end"}
      className={cn(
        "-mx-5 -mb-5 flex flex-col-reverse gap-2 rounded-b-[12px] border-t bg-muted/30 p-5 sm:flex-row sm:justify-end",
        reversed && "sm:flex-row-reverse sm:justify-start",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close asChild>
          <Button appearance="standard" variant="outline">Close</Button>
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn(
        "text-sm leading-none font-semibold",
        className
      )}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-xs text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
