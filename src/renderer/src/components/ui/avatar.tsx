"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { Avatar as AvatarPrimitive } from "radix-ui"

function Avatar({
  className,
  size = "default",
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Root> & {
  size?: "default" | "sm" | "lg"
}) {
  return (
    <AvatarPrimitive.Root
      data-slot="avatar"
      data-size={size}
      className={cn(
        "group/avatar relative inline-flex size-8 shrink-0 overflow-visible rounded-lg bg-[var(--avatar-background,var(--secondary))] text-xs select-none shadow-raised data-[size=lg]:size-10 data-[size=sm]:size-6",
        className
      )}
      {...props}
    />
  )
}

function AvatarImage({
  className,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Image>) {
  return (
    <AvatarPrimitive.Image
      data-slot="avatar-image"
      className={cn(
        "aspect-square size-full rounded-[inherit] object-cover",
        className
      )}
      {...props}
    />
  )
}

function AvatarFallback({
  className,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Fallback>) {
  return (
    <AvatarPrimitive.Fallback
      data-slot="avatar-fallback"
      className={cn(
        "flex size-full items-center justify-center rounded-[inherit] bg-[var(--avatar-fallback,var(--secondary))] text-small font-medium tracking-[0.02em] text-foreground group-data-[size=sm]/avatar:text-small",
        className
      )}
      {...props}
    />
  )
}

function AvatarBadge({
  className,
  role,
  ...props
}: React.ComponentProps<"span">) {
  const labelled = Boolean(props["aria-label"] || props["aria-labelledby"])
  return (
    <span
      data-slot="avatar-badge"
      role={role ?? (labelled ? "img" : undefined)}
      className={cn(
        "absolute right-0 bottom-0 z-10 inline-flex items-center justify-center rounded-full bg-primary text-primary-foreground ring-2 ring-background select-none",
        "group-data-[size=sm]/avatar:size-2 group-data-[size=sm]/avatar:[&>svg]:hidden",
        "group-data-[size=default]/avatar:size-2.5 group-data-[size=default]/avatar:[&>svg]:size-2",
        "group-data-[size=lg]/avatar:size-3 group-data-[size=lg]/avatar:[&>svg]:size-2",
        className
      )}
      {...props}
    />
  )
}

function AvatarGroup({
  className,
  role,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="avatar-group"
      role={role ?? "group"}
      className={cn(
        "group/avatar-group flex items-center [&>*+*]:-ms-2 *:data-[slot=avatar]:ring-2 *:data-[slot=avatar]:ring-background",
        className
      )}
      {...props}
    />
  )
}

function AvatarGroupCount({
  className,
  role,
  ...props
}: React.ComponentProps<"div">) {
  const labelled = Boolean(props["aria-label"] || props["aria-labelledby"])
  return (
    <div
      data-slot="avatar-group-count"
      role={role ?? (labelled ? "img" : undefined)}
      className={cn(
        "relative flex size-[22px] shrink-0 items-center justify-center rounded-full bg-muted text-xs leading-normal text-muted-foreground ring-2 ring-background group-has-data-[size=lg]/avatar-group:size-8 group-has-data-[size=sm]/avatar-group:size-6 [&>svg]:size-4 group-has-data-[size=lg]/avatar-group:[&>svg]:size-5 group-has-data-[size=sm]/avatar-group:[&>svg]:size-3",
        className
      )}
      {...props}
    />
  )
}

export {
  Avatar,
  AvatarImage,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  AvatarBadge,
}
