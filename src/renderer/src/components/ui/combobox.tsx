import * as React from "react"
import { useOverlayDensity } from "@/hooks/use-overlay-density"
import {
  Combobox as ComboboxPrimitive,
  DirectionProvider as BaseDirectionProvider,
} from "@base-ui/react"
import { cn } from "@/lib/utils"

import { Button } from "@/components/ui/button"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group"
import { ChevronDownIcon, XIcon, CheckIcon } from "lucide-react"

type ComboboxRootProps<
  Value,
  Multiple extends boolean | undefined = false,
  Item = Value,
> = ComboboxPrimitive.Root.Props<Value, Multiple, Item> & {
  /** Base UI reads direction from its own provider; mirror a local RTL section. */
  dir?: "ltr" | "rtl"
  /**
   * 选择框模式（仅单选）：值只能来自选项。弹层关闭后再按 Esc 不会清空已选值，
   * 弹层打开时 Tab 收起弹层并把焦点交给下一个控件，输入框失焦即收起弹层，
   * 输入后默认自动高亮第一个匹配项（`autoHighlight` 可显式覆盖）。
   * `ComboboxInput editable={false}` 自动开启本模式。
   */
  selectOnly?: boolean
}

type ComboboxChangeDetails = ComboboxPrimitive.Root.OpenChangeEventDetails

interface ComboboxBehavior {
  /** 选择框模式是否生效（`selectOnly` 或 `editable={false}`，且不是多选）。 */
  strict: boolean
  open: boolean
  /** 代替 Base UI 内部请求开合，会同步 `onOpenChange`。 */
  setOpen: (open: boolean, event: Event, reason: string) => void
  registerNonEditable: () => () => void
}

const ComboboxBehaviorContext = React.createContext<ComboboxBehavior | null>(null)

/** 与 Base UI 的 `createChangeEventDetails` 同形，供组件主动开合时传给 `onOpenChange`。 */
function createChangeDetails(reason: string, event: Event) {
  let canceled = false
  return {
    reason,
    event,
    trigger: undefined,
    cancel() {
      canceled = true
    },
    allowPropagation() {},
    get isCanceled() {
      return canceled
    },
    isPropagationAllowed: false,
  } as unknown as ComboboxChangeDetails
}

function Combobox<
  Value,
  Multiple extends boolean | undefined = false,
  Item = Value,
>({
  dir,
  selectOnly = false,
  children,
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  onValueChange,
  onInputValueChange,
  autoHighlight,
  openOnInputClick,
  ...props
}: ComboboxRootProps<Value, Multiple, Item>) {
  const [openState, setOpenState] = React.useState(defaultOpen)
  const [nonEditableCount, setNonEditableCount] = React.useState(0)
  const open = openProp ?? openState
  const openRef = React.useRef(open)
  openRef.current = open
  const strict = !props.multiple && (selectOnly || nonEditableCount > 0)
  const nonEditable = !props.multiple && nonEditableCount > 0

  const handleOpenChange = (next: boolean, details: ComboboxChangeDetails) => {
    onOpenChange?.(next, details)
    if (details.isCanceled) return
    openRef.current = next
    if (openProp === undefined) setOpenState(next)
  }
  // 组件主动开合（Tab、失焦、点击切换）也要经过同一条路径，让 `onOpenChange` 看得到。
  const setOpen = React.useCallback(
    (next: boolean, event: Event, reason: string) => {
      if (openRef.current === next) return
      handleOpenChange(next, createChangeDetails(reason, event))
    },
    // handleOpenChange 只读 onOpenChange 与 openProp，依赖它们即可。
    [onOpenChange, openProp]
  )
  const registerNonEditable = React.useCallback(() => {
    setNonEditableCount(count => count + 1)
    return () => setNonEditableCount(count => count - 1)
  }, [])

  // Esc 只关下拉：Radix DismissableLayer 在 document 捕获阶段监听 Esc，认不出 Base UI 弹层。
  // 弹层打开期间在 window 捕获阶段（先于 document）标记 defaultPrevented，Radix 看到后不再关闭
  // Dialog/Sheet/AlertDialog；这里不拦截传播，Base UI 自己的 Esc 逻辑照常关弹层。
  React.useEffect(() => {
    if (!open || props.inline) return
    const keepLayerOpen = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.isComposing) event.preventDefault()
    }
    window.addEventListener("keydown", keepLayerOpen, true)
    return () => window.removeEventListener("keydown", keepLayerOpen, true)
  }, [open, props.inline])

  // 弹层关闭时再按 Esc，Base UI 会清空输入并把值置空。选择框的值只能来自选项，所以取消这次清空。
  const handleValueChange = ((value: unknown, details: ComboboxPrimitive.Root.ChangeEventDetails) => {
    if (strict && details.reason === "escape-key") return details.cancel()
    ;(onValueChange as ((value: unknown, details: ComboboxPrimitive.Root.ChangeEventDetails) => void) | undefined)?.(value, details)
  }) as typeof onValueChange
  const handleInputValueChange = (value: string, details: ComboboxPrimitive.Root.ChangeEventDetails) => {
    if (strict && details.reason === "escape-key") return details.cancel()
    onInputValueChange?.(value, details)
  }

  const behavior = React.useMemo<ComboboxBehavior>(
    () => ({ strict, open, setOpen, registerNonEditable }),
    [strict, open, setOpen, registerNonEditable]
  )
  const root = (
    <ComboboxBehaviorContext.Provider value={behavior}>
      <ComboboxPrimitive.Root
        {...props}
        open={open}
        onOpenChange={handleOpenChange}
        onValueChange={handleValueChange}
        onInputValueChange={handleInputValueChange}
        autoHighlight={autoHighlight ?? (strict ? true : undefined)}
        // 禁止输入时由输入框组自己切换开合，避免与 Base UI 的点击展开各切一次。
        openOnInputClick={nonEditable ? false : openOnInputClick}
      >
        {children}
      </ComboboxPrimitive.Root>
    </ComboboxBehaviorContext.Provider>
  )
  return dir ? (
    <BaseDirectionProvider direction={dir}>{root}</BaseDirectionProvider>
  ) : (
    root
  )
}

function ComboboxValue({ ...props }: ComboboxPrimitive.Value.Props) {
  return <ComboboxPrimitive.Value data-slot="combobox-value" {...props} />
}

function ComboboxTrigger({
  className,
  children,
  ...props
}: ComboboxPrimitive.Trigger.Props) {
  return (
    <ComboboxPrimitive.Trigger
      data-slot="combobox-trigger"
      className={cn("[&_svg:not([class*='size-'])]:size-4", className)}
      {...props}
    >
      {children}
      <ChevronDownIcon className="pointer-events-none size-4 text-muted-foreground" />
    </ComboboxPrimitive.Trigger>
  )
}

function ComboboxClear({
  className,
  "aria-label": ariaLabel = "Clear selection",
  ...props
}: ComboboxPrimitive.Clear.Props) {
  return (
    <ComboboxPrimitive.Clear
      data-slot="combobox-clear"
      aria-label={ariaLabel}
      // The rendered Button owns data-slot, so mark the target for the trigger-hiding selector.
      render={<InputGroupButton variant="ghost" size="icon-xs" className="combobox-clear" />}
      className={cn(className)}
      {...props}
    >
      <XIcon className="pointer-events-none" />
    </ComboboxPrimitive.Clear>
  )
}

const TABBABLE_SELECTOR =
  'a[href],button,input:not([type="hidden"]),select,textarea,[tabindex],[contenteditable="true"]'

function isTabbable(element: HTMLElement) {
  if (element.tabIndex < 0 || (element as HTMLButtonElement).disabled) return false
  if (
    element.closest(
      '[data-slot="combobox-content"],[inert],[data-base-ui-focus-guard],[data-floating-ui-focus-guard]'
    )
  ) {
    return false
  }
  return element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden"
}

/**
 * Base UI 的弹层带焦点守卫，Tab 会落进守卫（Radix 模态里还会被 FocusScope 拉回容器）。
 * 所以弹层打开时的 Tab 由组件自己把焦点交给 DOM 顺序上的下一个控件；模态层内首尾循环，与 Radix 一致。
 */
function findAdjacentTabbable(from: HTMLElement, backwards: boolean) {
  const scope = from.closest<HTMLElement>('[role="dialog"],[role="alertdialog"]')
  const tabbables = Array.from(
    (scope ?? from.ownerDocument.body).querySelectorAll<HTMLElement>(TABBABLE_SELECTOR)
  ).filter(element => element === from || isTabbable(element))
  const index = tabbables.indexOf(from)
  if (index < 0) return null
  const next = index + (backwards ? -1 : 1)
  return scope ? tabbables[(next + tabbables.length) % tabbables.length] : (tabbables[next] ?? null)
}

function listOptions(input: HTMLInputElement) {
  const list =
    input.ownerDocument.getElementById(input.getAttribute("aria-controls") ?? "") ??
    input.ownerDocument.querySelector('[data-slot="combobox-content"][data-open]')
  return list
    ? Array.from(list.querySelectorAll<HTMLElement>('[role="option"]:not([aria-disabled="true"])'))
    : []
}

const highlightedIndex = (options: HTMLElement[]) =>
  options.findIndex(option => option.hasAttribute("data-highlighted"))

function pressArrow(input: HTMLInputElement, key: "ArrowDown" | "ArrowUp") {
  input.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }))
}

const nextTask = () => new Promise<void>(resolve => window.setTimeout(resolve, 0))

function moveHighlightByPointer(target: HTMLElement) {
  target.dispatchEvent(new MouseEvent("mousemove", {
    bubbles: true,
    cancelable: true,
    view: window,
    movementX: 1,
    movementY: 1,
  }))
}

/**
 * 列表项在 mousemove 时会把高亮同步到当前项，一次事件就能定位到目标。
 * 高亮没有更新时退回方向键，步数上限取当前选项数，长列表也能走到目标。
 */
async function highlightOption(input: HTMLInputElement, target: HTMLElement, superseded: () => boolean) {
  const options = listOptions(input)
  const to = options.indexOf(target)
  if (to < 0 || highlightedIndex(options) === to) return

  moveHighlightByPointer(target)
  await Promise.resolve()
  if (superseded()) return

  if (target.isConnected && target.hasAttribute("data-highlighted")) {
    target.scrollIntoView({ block: "nearest" })
    return
  }

  for (let step = 0; step < options.length && !superseded(); step++) {
    const current = listOptions(input)
    const from = highlightedIndex(current)
    const destination = current.indexOf(target)
    if (destination < 0 || from === destination) return
    pressArrow(input, from < destination ? "ArrowDown" : "ArrowUp")
    await nextTask()
    if (highlightedIndex(listOptions(input)) === destination) return
  }
}

/** 与原生 select 的 typeahead 一致：连按同一字符在匹配项间循环，快速连按多个字符按前缀匹配。 */
function findTypeaheadTarget(options: HTMLElement[], buffer: string) {
  const current = highlightedIndex(options)
  const repeated = buffer.length > 1 && [...buffer].every(character => character === buffer[0])
  const needle = repeated ? buffer[0] : buffer
  const start = needle.length === 1 ? current + 1 : Math.max(current, 0)
  for (let offset = 0; offset < options.length; offset++) {
    const option = options[(start + offset) % options.length]
    if (option.textContent?.trim().toLocaleLowerCase().startsWith(needle)) return option
  }
  return null
}

type ComboboxInputKeyDownEvent = Parameters<NonNullable<ComboboxPrimitive.Input.Props["onKeyDown"]>>[0]
type ComboboxInputBlurEvent = Parameters<NonNullable<ComboboxPrimitive.Input.Props["onBlur"]>>[0]

function ComboboxInput({
  className,
  children,
  disabled = false,
  showTrigger = true,
  showClear = false,
  size = "default",
  editable = true,
  triggerLabel,
  clearLabel,
  onKeyDown,
  onBlur,
  onBeforeInput,
  onPaste,
  onCut,
  onDrop,
  onSelect,
  onMouseDown,
  inputMode,
  ...props
}: Omit<ComboboxPrimitive.Input.Props, "size"> & {
  showTrigger?: boolean
  showClear?: boolean
  /** 与 `Select` 的 `size` 一致；`sm` 取 `--size-control-sm`。 */
  size?: "default" | "sm"
  /**
   * `false` 时外观不变但不能输入：无文本光标、不可选中文本，点击输入框任意位置展开列表，
   * 字母键按前缀跳到选项（typeahead）。隐含选择框模式（同 `Combobox` 的 `selectOnly`）。
   * 不使用原生 `readOnly`：它会让读屏报“只读”，也会被排除在表单约束校验之外。
   */
  editable?: boolean
  /** 右侧展开按钮的可访问名称。不传时按钮对读屏隐藏（输入框本身已是 combobox，↓ 可展开）。 */
  triggerLabel?: string
  /** 清除按钮的可访问名称，不传时用英文 “Clear selection”。 */
  clearLabel?: string
}) {
  const behavior = React.useContext(ComboboxBehaviorContext)
  const nonEditable = !editable
  const registerNonEditable = behavior?.registerNonEditable
  React.useLayoutEffect(() => {
    if (!nonEditable || !registerNonEditable) return
    return registerNonEditable()
  }, [nonEditable, registerNonEditable])

  const typeahead = React.useRef({ buffer: "", timer: 0, run: 0 })
  React.useEffect(() => () => window.clearTimeout(typeahead.current.timer), [])

  const openList = (input: HTMLInputElement) => pressArrow(input, "ArrowDown")
  const runTypeahead = (input: HTMLInputElement, character: string) => {
    const state = typeahead.current
    window.clearTimeout(state.timer)
    state.buffer += character.toLocaleLowerCase()
    state.timer = window.setTimeout(() => {
      state.buffer = ""
    }, 500)
    const run = ++state.run
    const move = () => {
      const target = findTypeaheadTarget(listOptions(input), state.buffer)
      if (target) void highlightOption(input, target, () => state.run !== run)
    }
    if (behavior?.open) return move()
    openList(input)
    // 弹层随开合状态挂载，等选项出现后再跳。
    let frames = 0
    const wait = () => {
      if (listOptions(input).length > 0 || ++frames > 30) move()
      else requestAnimationFrame(wait)
    }
    requestAnimationFrame(wait)
  }

  const handleKeyDown = (event: ComboboxInputKeyDownEvent) => {
    onKeyDown?.(event)
    if (event.defaultPrevented || disabled || !behavior) return
    const input = event.currentTarget
    const native = event.nativeEvent
    if (nonEditable && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
      event.preventDefault()
      return
    }
    if (native.isComposing || event.ctrlKey || event.metaKey || event.altKey) return

    if (behavior.strict && event.key === "Tab" && behavior.open) {
      const target = findAdjacentTabbable(input, event.shiftKey)
      behavior.setOpen(false, native, "focus-out")
      if (target) {
        event.preventDefault()
        // Radix FocusScope 在容器上按“当前焦点是否在首尾”处理 Tab；焦点已被我们移走，不能再让它循环一次。
        event.stopPropagation()
        target.focus()
      }
      return
    }

    if (!nonEditable) return
    const { key } = event
    if (key === " " && typeahead.current.buffer !== "") {
      event.preventDefault()
      event.preventBaseUIHandler()
      runTypeahead(input, " ")
    } else if (key === "Enter" || key === " ") {
      if (!behavior.open) {
        event.preventDefault()
        event.preventBaseUIHandler()
        openList(input)
      } else if (key === " ") {
        event.preventDefault()
        event.preventBaseUIHandler()
        listOptions(input).find(option => option.hasAttribute("data-highlighted"))?.click()
      }
    } else if (key.length === 1 || key === "Backspace" || key === "Delete") {
      event.preventDefault()
      event.preventBaseUIHandler()
      if (key.length === 1) runTypeahead(input, key)
    }
  }

  const handleBlur = (event: ComboboxInputBlurEvent) => {
    onBlur?.(event)
    if (!behavior?.strict || !behavior.open) return
    // 焦点进入弹层不算失焦（选项用鼠标按下时输入框并不会失焦）。
    if ((event.relatedTarget as Element | null)?.closest('[data-slot="combobox-content"]')) return
    behavior.setOpen(false, event.nativeEvent, "focus-out")
  }

  // 禁止输入时拦截所有会改文本的途径；输入法组合无法取消，但文本不会成为值，关闭弹层即还原。
  const blockEdit = (event: { preventDefault: () => void }) => {
    if (nonEditable) event.preventDefault()
  }

  const handleGroupMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    if (disabled || (event.target as Element).closest("button")) return
    event.preventDefault()
    event.currentTarget.querySelector("input")?.focus()
  }
  const handleGroupClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (disabled || !behavior || (event.target as Element).closest("button")) return
    behavior.setOpen(!behavior.open, event.nativeEvent, "input-press")
  }

  return (
    <InputGroup
      data-size={size}
      className={cn(size === "sm" && "h-(--size-control-sm)", className)}
      onMouseDown={nonEditable ? handleGroupMouseDown : undefined}
      onClick={nonEditable ? handleGroupClick : undefined}
    >
      <ComboboxPrimitive.Input
        render={
          <InputGroupInput
            disabled={disabled}
            className={nonEditable ? "caret-transparent select-none selection:bg-transparent" : undefined}
          />
        }
        inputMode={nonEditable ? "none" : inputMode}
        aria-autocomplete={nonEditable ? "none" : undefined}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        onBeforeInput={event => {
          onBeforeInput?.(event)
          blockEdit(event)
        }}
        onPaste={event => {
          onPaste?.(event)
          blockEdit(event)
        }}
        onCut={event => {
          onCut?.(event)
          blockEdit(event)
        }}
        onDrop={event => {
          onDrop?.(event)
          blockEdit(event)
        }}
        onSelect={event => {
          onSelect?.(event)
          // Shift+方向键之类仍可能产生选区，收回成光标位置。
          const input = event.currentTarget
          if (nonEditable && input.selectionStart !== input.selectionEnd) {
            input.setSelectionRange(input.selectionEnd, input.selectionEnd)
          }
        }}
        onMouseDown={event => {
          onMouseDown?.(event)
          if (nonEditable && !disabled) event.preventDefault()
        }}
        {...props}
      />
      {(showTrigger || showClear) && (
        <InputGroupAddon align="inline-end">
          {showTrigger && (
            <InputGroupButton
              size="icon-xs"
              variant="ghost"
              asChild
              data-slot="input-group-button"
              className="group-has-[.combobox-clear]/input-group:hidden data-pressed:bg-transparent"
              disabled={disabled}
            >
              <ComboboxTrigger
                tabIndex={-1}
                aria-label={triggerLabel}
                aria-hidden={triggerLabel ? undefined : true}
              />
            </InputGroupButton>
          )}
          {showClear && <ComboboxClear disabled={disabled} aria-label={clearLabel} />}
        </InputGroupAddon>
      )}
      {children}
    </InputGroup>
  )
}

function ComboboxContent({
  className,
  side = "bottom",
  sideOffset = 6,
  align = "start",
  alignOffset = 0,
  anchor,
  ref,
  ...props
}: ComboboxPrimitive.Popup.Props &
  Pick<
    ComboboxPrimitive.Positioner.Props,
    "side" | "align" | "sideOffset" | "alignOffset" | "anchor"
  >) {
  const overlayRef = useOverlayDensity(ref)
  return (
    <ComboboxPrimitive.Portal>
      <ComboboxPrimitive.Positioner
        side={side}
        sideOffset={sideOffset}
        align={align}
        alignOffset={alignOffset}
        anchor={anchor}
        className="isolate z-50 pointer-events-auto"
      >
        <ComboboxPrimitive.Popup
          data-slot="combobox-content"
          data-chips={!!anchor}
          className={cn("group/combobox-content relative max-h-(--available-height) w-(--anchor-width) max-w-(--available-width) min-w-[calc(var(--anchor-width)+--spacing(7))] origin-(--transform-origin) overflow-hidden rounded-md bg-popover text-popover-foreground shadow-overlay ring-1 ring-(--elevation-overlay-border) data-open:duration-(--motion-quick-in) data-closed:duration-(--motion-quick-out) data-open:ease-(--motion-ease) data-closed:ease-(--motion-ease-exit) data-[chips=true]:min-w-(--anchor-width) *:data-[slot=input-group]:m-1 *:data-[slot=input-group]:mb-0 *:data-[slot=input-group]:h-8 *:data-[slot=input-group]:border-input/30 *:data-[slot=input-group]:bg-input/30 *:data-[slot=input-group]:shadow-none *:data-[slot=input-group]:dark:shadow-none data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0", className )}
          {...props}
          ref={overlayRef}
        />
      </ComboboxPrimitive.Positioner>
    </ComboboxPrimitive.Portal>
  )
}

function ComboboxList({ className, ...props }: ComboboxPrimitive.List.Props) {
  return (
    <ComboboxPrimitive.List
      data-slot="combobox-list"
      className={cn(
        "max-h-[min(calc(--spacing(72)---spacing(9)),calc(var(--available-height)---spacing(9)))] scroll-py-1 overflow-y-auto overscroll-contain p-1 data-empty:p-0",
        className
      )}
      {...props}
    />
  )
}

function ComboboxItem({
  className,
  children,
  ...props
}: ComboboxPrimitive.Item.Props) {
  return (
    <ComboboxPrimitive.Item
      data-slot="combobox-item"
      className={cn(
        "relative flex w-full cursor-default items-center gap-(--space-md) h-(--size-item) rounded-sm py-0 pe-8 ps-(--space-sm) text-xs outline-hidden select-none data-highlighted:bg-primary data-highlighted:text-primary-foreground data-disabled:pointer-events-none data-disabled:opacity-(--state-disabled-opacity) [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      {children}
      <ComboboxPrimitive.ItemIndicator
        render={
          <span className="pointer-events-none absolute end-2 flex size-4 items-center justify-center" />
        }
      >
        <CheckIcon className="pointer-events-none" />
      </ComboboxPrimitive.ItemIndicator>
    </ComboboxPrimitive.Item>
  )
}

function ComboboxGroup({ className, ...props }: ComboboxPrimitive.Group.Props) {
  return (
    <ComboboxPrimitive.Group
      data-slot="combobox-group"
      className={cn("group/combobox-group", className)}
      {...props}
    />
  )
}

function ComboboxLabel({
  className,
  ...props
}: ComboboxPrimitive.GroupLabel.Props) {
  return (
    <ComboboxPrimitive.GroupLabel
      data-slot="combobox-label"
      className={cn("px-2 py-1.5 text-xs text-muted-foreground", className)}
      {...props}
    />
  )
}

function ComboboxCollection({ ...props }: ComboboxPrimitive.Collection.Props) {
  return (
    <ComboboxPrimitive.Collection data-slot="combobox-collection" {...props} />
  )
}

function ComboboxEmpty({ className, ...props }: ComboboxPrimitive.Empty.Props) {
  return (
    <ComboboxPrimitive.Empty
      data-slot="combobox-empty"
      className={cn(
        "hidden w-full justify-center py-2 text-center text-xs text-muted-foreground group-data-empty/combobox-content:flex",
        className
      )}
      {...props}
    />
  )
}

function ComboboxSeparator({
  className,
  ...props
}: ComboboxPrimitive.Separator.Props) {
  return (
    <ComboboxPrimitive.Separator
      data-slot="combobox-separator"
      className={cn("-mx-1 my-1 h-0 border-t border-border group-first/combobox-group:hidden", className)}
      {...props}
    />
  )
}

function ComboboxChips({
  className,
  ...props
}: React.ComponentPropsWithRef<typeof ComboboxPrimitive.Chips> &
  ComboboxPrimitive.Chips.Props) {
  return (
    <ComboboxPrimitive.Chips
      data-slot="combobox-chips"
      className={cn(
        "flex min-h-(--size-control-md) flex-wrap items-center gap-1 rounded-md border border-input bg-transparent bg-clip-padding px-2.5 py-1 text-xs focus-within:border-ring has-aria-invalid:border-destructive has-data-[slot=combobox-chip]:px-1 bg-[var(--control-input-background)] dark:has-aria-invalid:border-destructive/50 ",
        className
      )}
      {...props}
    />
  )
}

function ComboboxChip({
  className,
  children,
  showRemove = true,
  ...props
}: ComboboxPrimitive.Chip.Props & {
  showRemove?: boolean
}) {
  return (
    <ComboboxPrimitive.Chip
      data-slot="combobox-chip"
      className={cn(
        "flex h-[calc(--spacing(5.25))] w-fit items-center justify-center gap-1 rounded-sm bg-muted px-1.5 text-xs font-medium whitespace-nowrap text-foreground has-disabled:pointer-events-none has-disabled:cursor-default has-disabled:opacity-(--state-disabled-opacity) has-[.combobox-chip-remove]:pe-0",
        className
      )}
      {...props}
    >
      {children}
      {showRemove && (
        <ComboboxPrimitive.ChipRemove
          render={<Button appearance="standard" variant="ghost" size="icon-xs" className="combobox-chip-remove" />}
          className="-ms-1 opacity-50 hover:opacity-100"
          data-slot="combobox-chip-remove"
          aria-label={typeof children === "string" ? "Remove " + children : "Remove item"}
        >
          <XIcon className="pointer-events-none" />
        </ComboboxPrimitive.ChipRemove>
      )}
    </ComboboxPrimitive.Chip>
  )
}

function ComboboxChipsInput({
  className,
  ...props
}: ComboboxPrimitive.Input.Props) {
  return (
    <ComboboxPrimitive.Input
      data-slot="combobox-chip-input"
      className={cn("min-w-16 flex-1 cursor-default outline-none", className)}
      {...props}
    />
  )
}

function useComboboxAnchor() {
  return React.useRef<HTMLDivElement | null>(null)
}

export {
  Combobox,
  ComboboxInput,
  ComboboxContent,
  ComboboxList,
  ComboboxItem,
  ComboboxGroup,
  ComboboxLabel,
  ComboboxCollection,
  ComboboxEmpty,
  ComboboxSeparator,
  ComboboxChips,
  ComboboxChip,
  ComboboxChipsInput,
  ComboboxTrigger,
  ComboboxValue,
  useComboboxAnchor,
}
