import * as React from "react"
import { createPortal } from "react-dom"
import { Check, ChevronDown } from "lucide-react"
import { Slot } from "radix-ui"
import { cn } from "@/lib/utils"
import { Button } from "./button"
import { useShortcutText } from "@/lib/shortcut"
import { useOverlayDensity } from "@/hooks/use-overlay-density"

/** 菜单锚点：优先显示位置，以及下方空间不足时改用的翻转位置 */
interface MenuAnchor {
  x: number
  y: number
  /** 下方放不下时，菜单底边应对齐到的 y 坐标 */
  flipY: number | null
}

interface MenuContextValue {
  open: boolean
  initialFocus: "content" | "first" | "last"
  closeMenu: (returnFocus?: boolean) => void
  anchor: MenuAnchor
  align: "start" | "end"
  direction: "ltr" | "rtl"
  triggerRef: React.RefObject<HTMLElement | null>
  contentRef: React.RefObject<HTMLDivElement | null>
  registerItem: (node: HTMLButtonElement) => () => void
  getItems: () => HTMLButtonElement[]
}

/** 读取触发元素实际继承的方向，portal 内容需要显式带上 dir。 */
function directionOf(element: HTMLElement | null): "ltr" | "rtl" {
  if (!element || typeof window === "undefined") return "ltr"

  return window.getComputedStyle(element).direction === "rtl" ? "rtl" : "ltr"
}

const MenuContext = React.createContext<MenuContextValue | null>(null)

function useMenu() {
  const ctx = React.useContext(MenuContext)

  if (!ctx) throw new Error("MenuContent 与菜单项必须作为 MenuTrigger 的子元素使用")

  return ctx
}

/** 从 MenuTrigger 的 children 里分离出触发元素与菜单内容 */
function splitTriggerChildren(children: React.ReactNode) {
  let trigger: React.ReactNode = null
  const contents: React.ReactElement[] = []

  for (const child of React.Children.toArray(children)) {
    if (React.isValidElement(child) && child.type === MenuContent) {
      contents.push(child)
    } else if (trigger == null) {
      trigger = child
    }
  }

  return {
    trigger,
    contents,
  }
}

/**
 * GaN.UI Menu
 *
 * 桌面软件弹出菜单：MenuTrigger 包住触发元素与 MenuContent，
 * trigger="click" 点击唤出，trigger="context" 在触发元素上右键唤出。
 * 打开后 ArrowUp/ArrowDown 循环高亮、Enter/Space 选中、Home/End 跳转，
 * Esc 或点击外部关闭；菜单浮层用 fixed 定位并自动避开视口边缘。
 */
function MenuTrigger({
  trigger = "click",
  align = "start",
  asChild = true,
  disabled = false,
  children,
}: {
  /** 唤出方式：click 点击触发元素 / context 在触发元素上右键 */
  trigger?: "click" | "context"
  /** 菜单相对锚点的水平对齐 */
  align?: "start" | "end"
  /** 把打开行为合并到子元素上；关闭时行为暂停，改为渲染一个 span 容器 */
  asChild?: boolean
  disabled?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = React.useState(false)
  const [initialFocus, setInitialFocus] = React.useState<MenuContextValue["initialFocus"]>("content")
  const [anchor, setAnchor] = React.useState<MenuAnchor | null>(null)
  const [direction, setDirection] = React.useState<"ltr" | "rtl">("ltr")
  const triggerRef = React.useRef<HTMLElement | null>(null)
  const contentRef = React.useRef<HTMLDivElement | null>(null)
  const itemsRef = React.useRef<Array<HTMLButtonElement>>([])

  const registerItem = React.useCallback((node: HTMLButtonElement) => {
    itemsRef.current.push(node)

    return () => {
      itemsRef.current = itemsRef.current.filter((item) => item !== node)
    }
  }, [])

  const closeMenu = React.useCallback((returnFocus = true) => {
    setOpen(false)

    if (returnFocus) triggerRef.current?.focus()
  }, [])

  const openAt = (
    next: MenuAnchor,
    focus: MenuContextValue["initialFocus"] = "content",
    nextDirection: "ltr" | "rtl" = "ltr",
  ) => {
    setInitialFocus(focus)
    setDirection(nextDirection)
    setAnchor(next)
    setOpen(true)
  }

  const openFromTrigger = (focus: MenuContextValue["initialFocus"] = "content") => {
    if (disabled) return

    const rect = triggerRef.current?.getBoundingClientRect()
    const nextDirection = directionOf(triggerRef.current)
    // start / end 是逻辑边：RTL 下触发器的右缘才是 start。
    const start = nextDirection === "rtl" ? (rect?.right ?? 0) : (rect?.left ?? 0)
    const end = nextDirection === "rtl" ? (rect?.left ?? 0) : (rect?.right ?? 0)

    openAt(
      {
        x: align === "end" ? end : start,
        y: (rect?.bottom ?? 0) + 4,
        flipY: rect ? rect.top - 4 : null,
      },
      focus,
      nextDirection,
    )
  }

  const { trigger: triggerChild, contents } = splitTriggerChildren(children)

  const triggerProps = {
    ref: triggerRef,
    "aria-haspopup": "menu" as const,
    "aria-expanded": open,
    "aria-disabled": disabled || undefined,
    "data-state": open ? "open" : "closed",

    onKeyDown: (e: React.KeyboardEvent) => {
      if (disabled) return

      if (
        e.key === "ArrowDown" ||
        e.key === "ArrowUp" ||
        (trigger === "context" && (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")))
      ) {
        e.preventDefault()
        openFromTrigger(e.key === "ArrowUp" ? "last" : "first")
      }
    },

    ...(trigger === "context"
      ? {
          onContextMenu: (e: React.MouseEvent) => {
            e.preventDefault()

            if (disabled) return

            openAt({
              x: e.clientX,
              y: e.clientY + 2,
              flipY: e.clientY - 2,
            }, "content", directionOf(triggerRef.current))
          },
        }
      : {
          onClick: (e: React.MouseEvent) => {
            if (disabled) return

            if (open) closeMenu()
            else openFromTrigger(e.detail === 0 ? "first" : "content")
          },
        }),
  }

  const contextValue = React.useMemo<MenuContextValue>(
    () => ({
      open,
      initialFocus,
      closeMenu,

      anchor: anchor ?? {
        x: 0,
        y: 0,
        flipY: null,
      },

      align,
      direction,
      triggerRef,
      contentRef,
      registerItem,
      getItems: () => itemsRef.current,
    }),
    [open, initialFocus, anchor, align, direction, closeMenu, registerItem],
  )

  return (
    <MenuContext.Provider value={contextValue}>
      {asChild ? (
        <Slot.Root {...triggerProps}>{triggerChild as React.ReactElement}</Slot.Root>
      ) : (
        <span
          {...triggerProps}
          tabIndex={disabled ? -1 : 0}
          className="inline-flex cursor-default select-none"
        >
          {triggerChild}
        </span>
      )}
      {open && anchor && contents}
    </MenuContext.Provider>
  )
}

/** 菜单浮层：渲染到 body，根据锚点定位并避开视口边缘，接管键盘导航 */
function MenuContent({ className, style, children, ...props }: React.ComponentProps<"div">) {
  const ctx = useMenu()
  // portal 到 body 后继承不到触发器所在子树的 data-density，挂载时按触发器补写。
  const densityRef = useOverlayDensity(ctx.contentRef, { originRef: ctx.triggerRef })

  const [placed, setPlaced] = React.useState<{
    x: number
    y: number
  } | null>(null)

  React.useLayoutEffect(() => {
    const el = ctx.contentRef.current

    if (!el) return

    const { offsetWidth: width, offsetHeight: height } = el

    let x = ctx.anchor.x
    const startAligned = ctx.align === "start"
    // LTR 的 start 对齐左缘，RTL 的 start 对齐右缘；end 反之。
    const subtractWidth = startAligned ? ctx.direction === "rtl" : ctx.direction === "ltr"

    if (subtractWidth) x -= width

    x = Math.max(8, Math.min(x, window.innerWidth - width - 8))
    let y = ctx.anchor.y

    if (y + height > window.innerHeight - 8) {
      y = ctx.anchor.flipY != null ? ctx.anchor.flipY - height : window.innerHeight - height - 8
      y = Math.max(8, y)
    }

    setPlaced({
      x,
      y,
    })
  }, [ctx])

  React.useLayoutEffect(() => {
    // 定位提交且可见后聚焦；浮层禁止过渡 visibility，保留进入动画即可。
    if (!placed) return
    const content = ctx.contentRef.current
    if (!content || content.contains(document.activeElement)) return
    const items = ctx.getItems().filter((item) => item.isConnected && !item.disabled)
    const item =
      ctx.initialFocus === "first" ? items[0] : ctx.initialFocus === "last" ? items.at(-1) : null
    const target = item ?? content
    target.focus({ preventScroll: true })
  }, [ctx, placed])

  React.useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null

      if (!target) return

      if (ctx.contentRef.current?.contains(target)) return

      if (ctx.triggerRef.current?.contains(target)) return

      ctx.closeMenu(false)
      // 点击可聚焦控件时让浏览器照常移交焦点；只有焦点落回空白容器才回焦触发器。
      window.setTimeout(() => {
        const active = document.activeElement

        // 另一个浮层/菜单已在点击后接管焦点时不要抢回。
        if (
          active instanceof Element &&
          active.closest('[role="menu"], [role="listbox"], [role="dialog"], [role="alertdialog"]')
        ) {
          return
        }

        const focusable =
          active instanceof Element &&
          active.matches(
            'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [contenteditable="true"], [tabindex]:not([tabindex="-1"])',
          )

        if (!focusable) ctx.triggerRef.current?.focus({ preventScroll: true })
      }, 0)
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Tab") {
        e.preventDefault()
        ctx.closeMenu()
      }
    }

    const onResize = () => ctx.closeMenu(false)
    document.addEventListener("pointerdown", onPointerDown, true)
    document.addEventListener("keydown", onKeyDown, true)
    window.addEventListener("resize", onResize)

    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true)
      document.removeEventListener("keydown", onKeyDown, true)
      window.removeEventListener("resize", onResize)
    }
  }, [ctx])

  if (!ctx.open) return null

  return createPortal(
    <div
      ref={densityRef}
      role="menu"
      dir={ctx.direction}
      tabIndex={-1}
      data-slot="menu-content"
      {...props}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        // 键盘导航只在可聚焦的菜单项之间移动
        const items = ctx.getItems().filter((item) => !item.disabled)

        if (items.length === 0) return

        const current = items.findIndex((item) => item === document.activeElement)

        if (e.key === "ArrowDown") {
          e.preventDefault()
          items[(current + 1 + items.length) % items.length].focus()
        } else if (e.key === "ArrowUp") {
          e.preventDefault()
          items[current < 0 ? items.length - 1 : (current - 1 + items.length) % items.length].focus()
        } else if (e.key === "Home") {
          e.preventDefault()
          items[0].focus()
        } else if (e.key === "End") {
          e.preventDefault()
          items[items.length - 1].focus()
        }
      }}
      style={{
        ...style,
        left: placed?.x ?? 0,
        top: placed?.y ?? 0,
        visibility: placed ? undefined : "hidden",
      }}
      className={cn(
        "fixed z-50 min-w-[160px] cursor-default select-none rounded-[6px] border border-(--elevation-overlay-border) bg-panel p-1 text-popover-foreground shadow-overlay",
        "animate-in fade-in-0 transition-none duration-(--motion-quick-in) ease-(--motion-ease)",
        // 变换原点落在浮层与触发器相接的那条逻辑边上。
        (ctx.align === "start") === (ctx.direction === "ltr") ? "origin-top-left" : "origin-top-right",
        className,
      )}
    >
      {children}
    </div>,
    document.body,
  )
}

/** 普通菜单项：选中后菜单自动关闭 */
function MenuItem({
  onSelect,
  shortcut,
  className,
  disabled,
  children,
  ...props
}: React.ComponentProps<"button"> & {
  /** 选中后的回调 */
  onSelect?: () => void
  /** 显示在右侧的快捷键提示；按快捷键语法书写（如 "mod+shift+k"）时随平台显示为 ⌘⇧K / Ctrl+Shift+K，其他文本原样显示 */
  shortcut?: string
}) {
  const ctx = useMenu()
  const shortcutText = useShortcutText(shortcut)

  return (
    <button
      type="button"
      role="menuitem"
      ref={ctx.registerItem}
      disabled={disabled}
      aria-disabled={disabled || undefined}
      data-slot="menu-item"
      data-disabled={disabled ? "" : undefined}
      onPointerMove={(e) => {
        if (e.pointerType === "mouse" && !disabled) e.currentTarget.focus({ preventScroll: true })
      }}
      onPointerLeave={(e) => {
        if (e.pointerType === "mouse" && document.activeElement === e.currentTarget) {
          ctx.contentRef.current?.focus({ preventScroll: true })
        }
      }}
      onClick={() => {
        onSelect?.()
        ctx.closeMenu()
      }}
      className={cn(
        "flex h-(--size-item) w-full cursor-default select-none items-center gap-(--space-md) rounded-[3px] px-(--space-md) text-start text-xs text-popover-foreground outline-none [&_svg]:size-[14px] [&_svg]:shrink-0",
        "focus:bg-[var(--menu-highlight)]",
        disabled && "pointer-events-none opacity-(--state-disabled-opacity)",
        className,
      )}
      {...props}
    >
      {children}
      {shortcutText && (
        <span aria-hidden className="ms-auto ps-4 font-mono text-xs text-dim-foreground">
          {shortcutText}
        </span>
      )}
    </button>
  )
}

/** 勾选菜单项：点击切换勾选状态，菜单保持打开 */
function MenuCheckboxItem({
  checked = false,
  onCheckedChange,
  closeOnSelect = false,
  className,
  disabled,
  children,
  ...props
}: React.ComponentProps<"button"> & {
  /** 勾选状态 */
  checked?: boolean
  /** 勾选状态变化回调 */
  onCheckedChange?: (checked: boolean) => void
  closeOnSelect?: boolean
}) {
  const ctx = useMenu()

  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={checked}
      ref={ctx.registerItem}
      disabled={disabled}
      aria-disabled={disabled || undefined}
      data-slot="menu-checkbox-item"
      data-disabled={disabled ? "" : undefined}
      onPointerMove={(e) => {
        if (e.pointerType === "mouse" && !disabled) e.currentTarget.focus({ preventScroll: true })
      }}
      onPointerLeave={(e) => {
        if (e.pointerType === "mouse" && document.activeElement === e.currentTarget) {
          ctx.contentRef.current?.focus({ preventScroll: true })
        }
      }}
      onClick={() => {
        onCheckedChange?.(!checked)

        if (closeOnSelect) ctx.closeMenu()
      }}
      className={cn(
        "flex h-(--size-item) w-full cursor-default select-none items-center gap-(--space-xs) rounded-[3px] pe-(--space-md) ps-(--space-xs) text-start text-xs text-popover-foreground outline-none [&_svg]:size-3 [&_svg]:shrink-0",
        "focus:bg-[var(--menu-highlight)]",
        disabled && "pointer-events-none opacity-(--state-disabled-opacity)",
        className,
      )}
      {...props}
    >
      <span aria-hidden className="flex size-[14px] shrink-0 items-center justify-center">
        {checked && <Check />}
      </span>
      {children}
    </button>
  )
}

/** 菜单分隔线 */
function MenuSeparator({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      role="separator"
      data-slot="menu-separator"
      className={cn("mx-2 my-1 h-0 border-t border-line", className)}
      {...props}
    />
  )
}

/** Button-faced selector, with the lower-level menu API retained for action menus. */
function Menu({
  label,
  value,
  onValueChange,
  defaultValue,
  options,
  plain = false,
  disabled = false,
  trigger,
  className,
  ...props
}: Omit<React.ComponentProps<"button">, "value" | "defaultValue" | "onChange" | "children"> & {
  label?: string
  value?: string
  onValueChange?: (value: string) => void
  defaultValue?: string
  options: string[] | React.ReactNode
  plain?: boolean
  trigger?: React.ReactElement
}) {
  const strings =
    Array.isArray(options) && options.every((option) => typeof option === "string")
      ? (options as string[])
      : null
  const [internalValue, setInternalValue] = React.useState(defaultValue ?? strings?.[0] ?? "")
  const selected = value ?? internalValue

  return (
    <MenuTrigger disabled={disabled}>
      {trigger ?? (
        <Button
          {...props}
          size="default"
          disabled={disabled}
          className={cn(
            "min-w-[100px] justify-between gap-(--space-md) px-(--space-md)",
            plain && "rounded-none",
            className,
          )}
        >
          {strings ? (
            <span className="grid min-w-0 flex-1 text-start">
              {strings.map((option, index) => (
                <span
                  key={`${option}-${index}`}
                  aria-hidden
                  className="invisible col-start-1 row-start-1 whitespace-nowrap"
                >
                  {option}
                </span>
              ))}
              <span className="col-start-1 row-start-1 truncate">{label ?? selected}</span>
            </span>
          ) : (
            (label ?? selected)
          )}
          <ChevronDown className="size-3 text-current opacity-65" />
        </Button>
      )}
      <MenuContent>
        {strings
          ? strings.map((option) => (
              <MenuCheckboxItem
                key={option}
                checked={selected === option}
                closeOnSelect
                onCheckedChange={() => {
                  if (value === undefined) setInternalValue(option)

                  onValueChange?.(option)
                }}
              >
                {option}
              </MenuCheckboxItem>
            ))
          : options}
      </MenuContent>
    </MenuTrigger>
  )
}

export { Menu, MenuTrigger, MenuContent, MenuItem, MenuCheckboxItem, MenuSeparator }
