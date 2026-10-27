"use client"

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

import { Button } from "@/components/ui/button"
import { Input, inputSurface } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"

function InputGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="input-group"
      role="group"
      className={cn(
        inputSurface,
        "group/input-group relative flex h-(--size-control-md) w-full min-w-0 items-center rounded-[4px] border-0 outline-none in-data-[slot=combobox-content]:focus-within:border-inherit in-data-[slot=combobox-content]:focus-within:ring-0 has-disabled:bg-input/50 has-disabled:opacity-(--state-disabled-opacity) has-[[data-slot=input-group-control]:focus]:bg-[var(--control-input-focus-background)] has-[[data-slot][aria-invalid=true]]:[outline-style:solid] has-[[data-slot][aria-invalid=true]]:outline-1 has-[[data-slot][aria-invalid=true]]:outline-destructive has-[>[data-align=block-end]]:h-auto has-[>[data-align=block-end]]:flex-col has-[>[data-align=block-start]]:h-auto has-[>[data-align=block-start]]:flex-col has-[>textarea]:h-auto  dark:has-disabled:bg-input/80 has-[>[data-align=block-end]]:[&>input]:pt-3 has-[>[data-align=block-start]]:[&>input]:pb-3 has-[>[data-align=inline-end]]:[&>input]:pe-1.5 has-[>[data-align=inline-start]]:[&>input]:ps-1.5",
        className
      )}
      {...props}
    />
  )
}

const inputGroupAddonVariants = cva(
  "flex h-auto cursor-default items-center justify-center gap-(--space-md) py-1.5 text-xs font-medium text-muted-foreground select-none group-data-[disabled=true]/input-group:opacity-(--state-disabled-opacity) [&>kbd]:rounded-[calc(var(--radius)-5px)] [&>svg:not([class*='size-'])]:size-4",
  {
    variants: {
      align: {
        "inline-start":
          "order-first shrink-0 ps-(--space-md) has-[>button]:ms-[-0.3rem] has-[>kbd]:ms-[-0.15rem]",
        "inline-end":
          "order-last shrink-0 pe-(--space-md) has-[>button]:me-[-0.3rem] has-[>kbd]:me-[-0.15rem]",
        "block-start":
          "order-first w-full justify-start px-2.5 pt-2 group-has-[>input]/input-group:pt-2 [.border-b]:pb-2",
        "block-end":
          "order-last w-full justify-start px-2.5 pb-2 group-has-[>input]/input-group:pb-2 [.border-t]:pt-2",
      },
    },
    defaultVariants: {
      align: "inline-start",
    },
  }
)

const inputGroupInteractiveSelector = [
  "button",
  "a[href]",
  "input",
  "textarea",
  "select",
  "[role='button']",
  "[role='menuitem']",
  "[role='menuitemcheckbox']",
  "[role='menuitemradio']",
  "[role='checkbox']",
  "[role='radio']",
  "[role='switch']",
  "[contenteditable='true']",
].join(",")

function isInputGroupInteractiveTarget(target: EventTarget | null) {
  return target instanceof Element && target.closest(inputGroupInteractiveSelector) !== null
}

function InputGroupAddon({
  className,
  align = "inline-start",
  onClick,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof inputGroupAddonVariants>) {
  return (
    <div
      role="group"
      data-slot="input-group-addon"
      data-align={align}
      className={cn(inputGroupAddonVariants({ align }), className)}
      onClick={(event) => {
        onClick?.(event)
        if (event.defaultPrevented || isInputGroupInteractiveTarget(event.target)) return
        event.currentTarget.parentElement?.querySelector<HTMLInputElement | HTMLTextAreaElement>("input,textarea")?.focus()
      }}
      {...props}
    />
  )
}

const inputGroupButtonVariants = cva(
  "flex items-center gap-(--space-md) text-xs shadow-none",
  {
    variants: {
      size: {
        xs: "h-(--size-control-xs) gap-(--space-xs) rounded-[calc(var(--radius)-3px)] px-(--space-sm) [&>svg:not([class*='size-'])]:size-3.5",
        sm: "",
        "icon-xs":
          "size-(--size-control-xs) rounded-[calc(var(--radius)-3px)] p-0 has-[>svg]:p-0",
        "icon-sm": "size-(--size-control-md) p-0 has-[>svg]:p-0",
      },
    },
    defaultVariants: {
      size: "xs",
    },
  }
)

function InputGroupButton({
  className,
  type = "button",
  variant = "ghost",
  size = "xs",
  ...props
}: Omit<React.ComponentProps<typeof Button>, "size"> &
  VariantProps<typeof inputGroupButtonVariants>) {
  return (
    <Button
      appearance="standard"
      type={type}
      data-size={size}
      variant={variant}
      className={cn(inputGroupButtonVariants({ size }), className)}
      {...props}
    />
  )
}

function InputGroupText({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "flex items-center gap-2 text-xs text-muted-foreground [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    />
  )
}

function InputGroupInput({
  className,
  ...props
}: React.ComponentProps<"input">) {
  return (
    <Input
      data-slot="input-group-control"
      className={cn(
        "flex-1 rounded-none border-0 bg-transparent shadow-none dark:shadow-none ring-0 focus-visible:ring-0 focus-visible:!outline-none disabled:bg-transparent disabled:opacity-100 aria-invalid:ring-0 aria-invalid:!outline-none dark:bg-transparent dark:disabled:bg-transparent",
        className
      )}
      {...props}
    />
  )
}

function InputGroupTextarea({
  className,
  ...props
}: React.ComponentProps<"textarea">) {
  return (
    <Textarea
      data-slot="input-group-control"
      className={cn(
        "min-w-0 flex-1 resize-none border-0 bg-transparent py-2 shadow-none dark:shadow-none ring-0 focus-visible:ring-0 focus-visible:!outline-none disabled:bg-transparent disabled:opacity-100 aria-invalid:ring-0 aria-invalid:!outline-none dark:bg-transparent dark:disabled:bg-transparent",
        className
      )}
      {...props}
    />
  )
}

export {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupText,
  InputGroupInput,
  InputGroupTextarea,
}
