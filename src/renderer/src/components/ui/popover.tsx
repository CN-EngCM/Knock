"use client"

import * as React from "react"
import { useOverlayDensity } from "@/hooks/use-overlay-density"
import { cn } from "@/lib/utils"
import { Direction as DirectionPrimitive, Popover as PopoverPrimitive } from "radix-ui"

function Popover({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />
}

function PopoverTrigger({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />
}

function PopoverContent({
  className,
  align = "center",
  side = "bottom",
  sideOffset = 4,
  dir,
  ref,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  const direction = dir === "ltr" || dir === "rtl" ? dir : DirectionPrimitive.useDirection()

  const overlayRef = useOverlayDensity(ref)
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        dir={dir ?? (direction === "rtl" ? "rtl" : undefined)}
        align={align}
        side={side}
        sideOffset={sideOffset}
        className={cn(
          "z-50 flex w-64 origin-(--radix-popover-content-transform-origin) flex-col gap-2.5 rounded-md bg-card p-4 text-xs text-card-foreground shadow-overlay ring-1 ring-(--elevation-overlay-border) outline-hidden data-open:duration-(--motion-standard-in) data-closed:duration-(--motion-standard-out) motion-reduce:animate-none motion-reduce:transition-none data-open:ease-(--motion-ease) data-closed:ease-(--motion-ease-exit) data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          className
        )}
        {...props}
        ref={overlayRef}
      />
    </PopoverPrimitive.Portal>
  )
}

function PopoverClose({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Close>) {
  return <PopoverPrimitive.Close data-slot="popover-close" {...props} />
}

function PopoverAnchor({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Anchor>) {
  return <PopoverPrimitive.Anchor data-slot="popover-anchor" {...props} />
}

function PopoverHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="popover-header"
      className={cn("flex flex-col gap-0.5 text-xs", className)}
      {...props}
    />
  )
}

function PopoverTitle({
  className,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Title>) {
  return (
    <PopoverPrimitive.Title
      data-slot="popover-title"
      className={cn("font-medium", className)}
      {...props}
    />
  )
}

function PopoverDescription({
  className,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Description>) {
  return (
    <PopoverPrimitive.Description
      data-slot="popover-description"
      className={cn("text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Popover,
  PopoverAnchor,
  PopoverClose,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
}
