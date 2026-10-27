import * as React from "react"
import { ArrowDown } from "lucide-react"
import { cn } from "@/lib/utils"
import { resolveScrollBehavior } from "@/lib/scroll"
import { useMessageScrollerItems } from "./message-scroller-items"

type MessageScrollerAlign = "start" | "center" | "end" | "nearest"
type MessageScrollerInitialPosition = "start" | "end" | "last-anchor"
type MessageScrollerAnchorRole = "user" | "assistant" | "marker" | "none"
type MessageScrollerDirection = "up" | "down" | "none"
type MessageScrollerCommandReason = "not-found" | "not-mounted" | "no-anchor"

interface MessageScrollerTurn {
  /** Stable turn id: data-turn-id, then data-message-id, then a generated index. */
  id: string
  /** data-message-id of the same direct child, when present. */
  messageId: string | null
  /** data-message-role of the same direct child, when present. */
  role: string | null
  /** Zero-based position among the resolved turn anchors. */
  index: number
}

interface MessageScrollerScrollState {
  atStart: boolean
  atEnd: boolean
  canScrollUp: boolean
  canScrollDown: boolean
  direction: MessageScrollerDirection
  /** First turn anchor starting inside the viewport, else the last intersecting. */
  visibleTurn: MessageScrollerTurn | null
  /** Last turn anchor at or above the top edge; falls back to visibleTurn. */
  anchoredTurn: MessageScrollerTurn | null
  /** First [data-message-id] row intersecting the viewport. */
  visibleMessageId: string | null
  /** Geometry snapshot at emit time; call getScrollState() for fresh values. */
  scrollTop: number
  scrollHeight: number
  clientHeight: number
}

interface MessageScrollerScrollOptions {
  /** Alignment target. Defaults to "start" for turns and messages. */
  align?: MessageScrollerAlign
  behavior?: ScrollBehavior
  /** Overrides previousContextPeek for this command; only used by turn commands. */
  previousContextPeek?: number
}

interface MessageScrollerCommandResult {
  ok: boolean
  reason?: MessageScrollerCommandReason
  target?: string
  align?: MessageScrollerAlign
  behavior?: ScrollBehavior
  /** Resolved scrollTop, clamped to the viewport range. */
  top?: number
  turn?: MessageScrollerTurn
}

interface MessageScrollerHandle {
  /** Jump to a [data-message-id] row anywhere inside the content. */
  scrollToMessage: (id: string | number, options?: MessageScrollerScrollOptions) => Promise<MessageScrollerCommandResult>
  /** Jump to a resolved turn anchor by turn id, message id or zero-based index. */
  scrollToTurn: (target: string | number, options?: MessageScrollerScrollOptions) => Promise<MessageScrollerCommandResult>
  /** Open the historical transcript at the newest turn anchor. */
  scrollToLatestAnchor: (options?: MessageScrollerScrollOptions) => Promise<MessageScrollerCommandResult>
  /** Absolute start (scrollTop 0) and pause follow. */
  scrollToStart: (options?: MessageScrollerScrollOptions) => Promise<MessageScrollerCommandResult>
  /** Absolute end and resume follow. */
  scrollToEnd: (options?: MessageScrollerScrollOptions) => Promise<MessageScrollerCommandResult>
  getVisibleTurn: () => MessageScrollerTurn | null
  getScrollState: () => MessageScrollerScrollState
  getViewport: () => HTMLDivElement | null
  getMessageElement: (id: string | number) => HTMLElement | null
}

type MessageScrollerProps<T = unknown> = React.ComponentProps<"div"> & {
  autoScroll?: boolean
  defaultAutoScroll?: boolean
  onAutoScrollChange?: (autoScroll: boolean) => void
  initialPosition?: MessageScrollerInitialPosition
  bottomThreshold?: number
  contentClassName?: string
  scrollButtonLabel?: string
  /**
   * Role whose direct children settle as turn anchors. `"marker"` matches
   * data-message-role="marker"; explicit `data-turn-anchor` rows always count.
   */
  turnAnchorRole?: MessageScrollerAnchorRole
  /** Additional selector merged with explicit and role based turn anchors. */
  turnAnchorSelector?: string
  /** Pixels of the previous turn kept above a "start" aligned turn. */
  previousContextPeek?: number
  onVisibleTurnChange?: (turn: MessageScrollerTurn | null) => void
  onScrollStateChange?: (state: MessageScrollerScrollState) => void
  onCommandResult?: (result: MessageScrollerCommandResult) => void
  commandRef?: React.Ref<MessageScrollerHandle>
  /**
   * Virtualized, data-driven alternative to `children`: mutually exclusive with it (a dev-mode
   * console.error fires if both are passed, and `items` wins). Rows are measured and recycled
   * through `useVirtualRows`, so arbitrary child DOM structure and the `[overflow-anchor:none]`
   * pixel-anchor prepend path are not available in this mode.
   */
  items?: readonly T[]
  renderItem?: (item: T, index: number) => React.ReactNode
  /**
   * The key index and turn anchors derived from `getItemKey` / `getItemMessageId` / `getItemRole`
   * are rebuilt when `items` or `turnAnchorRole` change, not when these callbacks change identity
   * (inline arrows are fine). Swapping a callback's logic while keeping the same `items` array
   * takes effect on the next `items` change.
   */
  getItemKey?: (item: T, index: number) => string
  getItemMessageId?: (item: T, index: number) => string | undefined
  /** Turn-anchor role for this item; matched against `turnAnchorRole` same as data-message-role. */
  getItemRole?: (item: T, index: number) => string | undefined
  /** First-frame row height estimate; real height is measured once rendered. Default 72. */
  estimateItemHeight?: number
}

type TurnAnchor = { turn: MessageScrollerTurn; element: HTMLElement }
type ProgrammaticScrollMode = "position" | "end"
type ProgrammaticScrollState = {
  token: number
  mode: ProgrammaticScrollMode
  userInterrupted: boolean
  lastTop: number
  requestedTop?: number
}

const emptyScrollState: MessageScrollerScrollState = {
  atStart: true,
  atEnd: true,
  canScrollUp: false,
  canScrollDown: false,
  direction: "none",
  visibleTurn: null,
  anchoredTurn: null,
  visibleMessageId: null,
  scrollTop: 0,
  scrollHeight: 0,
  clientHeight: 0,
}

function clampScrollTop(top: number, viewport: HTMLDivElement) {
  const max = Math.max(0, viewport.scrollHeight - viewport.clientHeight)
  return Math.min(Math.max(0, Number.isFinite(top) ? top : 0), max)
}

function scrollViewportTo(viewport: HTMLDivElement, top: number, behavior: ScrollBehavior) {
  const target = clampScrollTop(top, viewport)
  if (behavior !== "smooth" || Math.abs(viewport.scrollTop - target) <= 1) {
    viewport.scrollTop = target
    return Promise.resolve()
  }
  return new Promise<void>(resolve => {
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = () => {
      if (settled) return
      settled = true
      if (timer !== undefined) clearTimeout(timer)
      viewport.removeEventListener("scrollend", finish)
      resolve()
    }
    viewport.addEventListener("scrollend", finish)
    timer = setTimeout(finish, 700)
    viewport.scrollTo({ top: target, behavior: "smooth" })
  })
}

function sameScrollState(previous: MessageScrollerScrollState, next: MessageScrollerScrollState) {
  return previous.atStart === next.atStart
    && previous.atEnd === next.atEnd
    && previous.canScrollUp === next.canScrollUp
    && previous.canScrollDown === next.canScrollDown
    && previous.direction === next.direction
    && (previous.visibleTurn?.id ?? null) === (next.visibleTurn?.id ?? null)
    && (previous.anchoredTurn?.id ?? null) === (next.anchoredTurn?.id ?? null)
    && previous.visibleMessageId === next.visibleMessageId
}

function MessageScroller<T = unknown>({ children, className, contentClassName, autoScroll, defaultAutoScroll = true, onAutoScrollChange, initialPosition = "end", bottomThreshold = 32, scrollButtonLabel = "Scroll to latest message", turnAnchorRole = "user", turnAnchorSelector, previousContextPeek = 0, onVisibleTurnChange, onScrollStateChange, onCommandResult, commandRef, onScroll, onPointerDownCapture, onWheelCapture, onTouchStartCapture, onKeyDownCapture, ref, dir, items, renderItem, getItemKey, getItemMessageId, getItemRole, estimateItemHeight = 72, ...props }: MessageScrollerProps<T>) {
  const itemsMode = items !== undefined
  const itemsModeRef = React.useRef(itemsMode)
  itemsModeRef.current = itemsMode
  const warnedItemsChildrenRef = React.useRef(false)
  if (import.meta.env.DEV && itemsMode && children !== undefined && !warnedItemsChildrenRef.current) {
    warnedItemsChildrenRef.current = true
    console.error("MessageScroller: `items` and `children` are mutually exclusive; `children` is ignored while `items` is set.")
  }
  const viewportRef = React.useRef<HTMLDivElement>(null)
  const contentRef = React.useRef<HTMLDivElement>(null)
  // Pixel anchor used by prepend history loads. Kept separate from turn anchors.
  const prependAnchorRef = React.useRef<{ element: Element; top: number } | null>(null)
  const initialRef = React.useRef(false)
  const programmaticRef = React.useRef(false)
  const programmaticTokenRef = React.useRef(0)
  const programmaticStateRef = React.useRef<ProgrammaticScrollState | null>(null)
  const frameRef = React.useRef(0)
  const stateRef = React.useRef<MessageScrollerScrollState | null>(null)
  const directionRef = React.useRef<MessageScrollerDirection>("none")
  const lastScrollTopRef = React.useRef(0)
  const [internalAuto, setInternalAuto] = React.useState(defaultAutoScroll && initialPosition === "end")
  const [atBottom, setAtBottom] = React.useState(initialPosition === "end")
  const follow = autoScroll ?? internalAuto
  const followRef = React.useRef(follow)
  followRef.current = follow
  const autoScrollRef = React.useRef(autoScroll)
  autoScrollRef.current = autoScroll
  const autoScrollChangeRef = React.useRef(onAutoScrollChange)
  autoScrollChangeRef.current = onAutoScrollChange
  const bottomThresholdRef = React.useRef(bottomThreshold)
  bottomThresholdRef.current = bottomThreshold
  const turnAnchorRoleRef = React.useRef(turnAnchorRole)
  turnAnchorRoleRef.current = turnAnchorRole
  const turnAnchorSelectorRef = React.useRef(turnAnchorSelector)
  turnAnchorSelectorRef.current = turnAnchorSelector
  const previousContextPeekRef = React.useRef(previousContextPeek)
  previousContextPeekRef.current = previousContextPeek
  const visibleTurnChangeRef = React.useRef(onVisibleTurnChange)
  visibleTurnChangeRef.current = onVisibleTurnChange
  const scrollStateChangeRef = React.useRef(onScrollStateChange)
  scrollStateChangeRef.current = onScrollStateChange
  const commandResultRef = React.useRef(onCommandResult)
  commandResultRef.current = onCommandResult

  const itemsScroller = useMessageScrollerItems<T>(
    { items, getItemKey, getItemMessageId, getItemRole, estimateItemHeight, turnAnchorRole, initialPosition, bottomThreshold },
    { viewportRef, contentRef, followRef, programmaticRef, bottomThresholdRef, previousContextPeekRef, readDirection, beginProgrammaticScroll, endProgrammaticScroll, setFollowing, finishCommand, syncAtBottom, scheduleStateUpdate },
  )
  const { virtualRows } = itemsScroller

  function rememberAnchor() {
    if (itemsModeRef.current) itemsScroller.rememberAnchor()
    else rememberPrependAnchor()
  }

  // The live-edge scrollTop target: the virtualizer's total size in items mode, else the DOM height.
  function getScrollEnd(viewport: HTMLDivElement) {
    return itemsModeRef.current ? itemsScroller.getTotalSize() : viewport.scrollHeight
  }

  function collectTurnAnchors(): TurnAnchor[] {
    const content = contentRef.current
    if (!content) return []
    const role = turnAnchorRoleRef.current
    const extraSelector = turnAnchorSelectorRef.current?.trim()
    const anchors: TurnAnchor[] = []
    let index = 0
    for (const child of Array.from(content.children)) {
      const element = child as HTMLElement
      if (element.getAttribute("data-turn-anchor") === "false") continue
      const roleValue = element.getAttribute("data-message-role")
      const explicit = element.hasAttribute("data-turn-anchor")
      const roleMatch = role !== "none" && roleValue === role
      let selectorMatch = false
      if (!explicit && !roleMatch && extraSelector) {
        try {
          selectorMatch = element.matches(extraSelector)
        } catch {
          selectorMatch = false
        }
      }
      if (!explicit && !roleMatch && !selectorMatch) continue
      const messageId = element.getAttribute("data-message-id")
      const turnId = element.getAttribute("data-turn-id") ?? messageId ?? `turn-${index}`
      anchors.push({ turn: { id: turnId, messageId, role: roleValue, index }, element })
      index += 1
    }
    return anchors
  }

  function findMessageElement(id: string | number): HTMLElement | null {
    const content = contentRef.current
    if (!content) return null
    const wanted = String(id)
    for (const node of Array.from(content.querySelectorAll<HTMLElement>("[data-message-id]"))) {
      if (node.getAttribute("data-message-id") === wanted) return node
    }
    return null
  }

  function firstVisibleMessageId(viewport: HTMLDivElement) {
    const content = contentRef.current
    if (!content) return null
    const viewportRect = viewport.getBoundingClientRect()
    for (const node of Array.from(content.querySelectorAll<HTMLElement>("[data-message-id]"))) {
      const rect = node.getBoundingClientRect()
      if (rect.bottom > viewportRect.top && rect.top < viewportRect.bottom) return node.getAttribute("data-message-id")
    }
    return null
  }

  // Commits the direction when asked; the DOM and items state readers share it.
  function readDirection(scrollTop: number, commit: boolean) {
    if (commit) {
      if (scrollTop > lastScrollTopRef.current + 0.5) directionRef.current = "down"
      else if (scrollTop < lastScrollTopRef.current - 0.5) directionRef.current = "up"
      lastScrollTopRef.current = scrollTop
    }
    return directionRef.current
  }

  function computeScrollState(commitDirection: boolean): MessageScrollerScrollState {
    const viewport = viewportRef.current
    if (!viewport) return emptyScrollState
    if (itemsModeRef.current) return itemsScroller.computeScrollState(viewport, commitDirection)
    const scrollTop = viewport.scrollTop
    const direction = readDirection(scrollTop, commitDirection)
    const threshold = Math.max(0, bottomThresholdRef.current)
    const viewportRect = viewport.getBoundingClientRect()
    const anchors = collectTurnAnchors()
    let startingInView: MessageScrollerTurn | null = null
    let lastIntersecting: MessageScrollerTurn | null = null
    let anchoredTurn: MessageScrollerTurn | null = null
    for (const { turn, element } of anchors) {
      const rect = element.getBoundingClientRect()
      if (!startingInView && rect.top >= viewportRect.top - 2 && rect.top < viewportRect.bottom) startingInView = turn
      if (rect.bottom > viewportRect.top && rect.top < viewportRect.bottom) lastIntersecting = turn
      if (rect.top <= viewportRect.top + 2) anchoredTurn = turn
    }
    const visibleTurn = startingInView ?? lastIntersecting
    if (!anchoredTurn) anchoredTurn = visibleTurn
    const atStart = scrollTop <= 1
    const atEnd = viewport.scrollHeight - scrollTop - viewport.clientHeight <= threshold
    return {
      atStart,
      atEnd,
      canScrollUp: !atStart,
      canScrollDown: !atEnd,
      direction,
      visibleTurn,
      anchoredTurn,
      visibleMessageId: firstVisibleMessageId(viewport),
      scrollTop,
      scrollHeight: viewport.scrollHeight,
      clientHeight: viewport.clientHeight,
    }
  }

  function emitScrollState() {
    const next = computeScrollState(true)
    const previous = stateRef.current
    stateRef.current = next
    if (!previous || !sameScrollState(previous, next)) scrollStateChangeRef.current?.(next)
    if (!previous || (previous.visibleTurn?.id ?? null) !== (next.visibleTurn?.id ?? null)) visibleTurnChangeRef.current?.(next.visibleTurn)
  }

  function scheduleStateUpdate() {
    if (typeof window === "undefined" || frameRef.current !== 0) return
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = 0
      emitScrollState()
    })
  }

  function rememberPrependAnchor() {
    const viewport = viewportRef.current, content = contentRef.current
    if (!viewport || !content) return
    const top = viewport.getBoundingClientRect().top
    const element = Array.from(content.children).find(child => child.getBoundingClientRect().bottom > top)
    prependAnchorRef.current = element ? { element, top: element.getBoundingClientRect().top - top } : null
  }

  function readAtBottom(viewport: HTMLDivElement) {
    return viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= Math.max(0, bottomThresholdRef.current)
  }

  function syncAtBottom(viewport: HTMLDivElement) {
    const bottom = readAtBottom(viewport)
    setAtBottom(previous => previous === bottom ? previous : bottom)
    return bottom
  }

  function applyFollowOrPrepend() {
    const viewport = viewportRef.current
    if (!viewport) return
    if (programmaticRef.current) {
      // A smooth end command owns the viewport until its landing event. Keep
      // the command suppressed while React/ResizeObserver reports growth;
      // endProgrammaticScroll performs one bounded catch-up to the newest
      // end before releasing the suppression.
      return
    }
    if (followRef.current) viewport.scrollTop = viewport.scrollHeight
    else {
      const anchor = prependAnchorRef.current
      if (anchor?.element.isConnected) {
        const delta = anchor.element.getBoundingClientRect().top - viewport.getBoundingClientRect().top - anchor.top
        // Reassign even for a zero delta so a browser initiated scroll cannot
        // keep drifting between commits. Command driven smooth scrolls are
        // excluded by programmaticRef above and resume after it clears.
        viewport.scrollTop += delta
      }
    }
    rememberPrependAnchor()
    syncAtBottom(viewport)
    scheduleStateUpdate()
  }

  function positionInitial() {
    const viewport = viewportRef.current
    if (!viewport) return
    if (initialPosition === "end") viewport.scrollTop = viewport.scrollHeight
    else if (initialPosition === "start") viewport.scrollTop = 0
    else {
      const anchors = collectTurnAnchors()
      const latest = anchors[anchors.length - 1]
      if (latest) {
        const peek = Math.max(0, previousContextPeekRef.current)
        const top = viewport.scrollTop + latest.element.getBoundingClientRect().top - viewport.getBoundingClientRect().top - peek
        viewport.scrollTop = clampScrollTop(top, viewport)
      } else {
        viewport.scrollTop = viewport.scrollHeight
      }
    }
    syncAtBottom(viewport)
    rememberPrependAnchor()
    scheduleStateUpdate()
  }

  function setFollowing(next: boolean) {
    if (autoScrollRef.current === undefined) {
      followRef.current = next
      setInternalAuto(next)
    } else {
      // Optimistic until the controlled prop renders again; also prevents
      // duplicate change callbacks while a command driven scroll is running.
      followRef.current = next
    }
    autoScrollChangeRef.current?.(next)
  }

  function finishCommand(result: MessageScrollerCommandResult) {
    commandResultRef.current?.(result)
    return result
  }

  function beginProgrammaticScroll(mode: ProgrammaticScrollMode = "position", requestedTop?: number) {
    programmaticTokenRef.current += 1
    programmaticRef.current = true
    programmaticStateRef.current = {
      token: programmaticTokenRef.current,
      mode,
      userInterrupted: false,
      lastTop: viewportRef.current?.scrollTop ?? 0,
      requestedTop,
    }
    return programmaticTokenRef.current
  }

  function settleProgrammaticEnd(token: number) {
    const viewport = viewportRef.current
    const state = programmaticStateRef.current
    if (!viewport || !state || state.token !== token || state.mode !== "end" || state.userInterrupted) return
    const target = followRef.current
      ? clampScrollTop(viewport.scrollHeight, viewport)
      : clampScrollTop(state.requestedTop ?? viewport.scrollTop, viewport)
    if (Math.abs(viewport.scrollTop - target) > 0.5) viewport.scrollTop = target
    state.lastTop = viewport.scrollTop
  }

  function markProgrammaticUserInterruption() {
    if (!programmaticRef.current) return
    const state = programmaticStateRef.current
    if (!state) return
    state.userInterrupted = true
  }

  function trackProgrammaticScroll(viewport: HTMLDivElement) {
    const state = programmaticStateRef.current
    if (!programmaticRef.current || !state) return
    // A smooth scrollToEnd is monotonic toward the live edge. A reverse
    // movement is therefore a reader gesture even when a consumer changes
    // scrollTop directly instead of dispatching pointer/wheel events first.
    if (state.mode === "end" && viewport.scrollTop < state.lastTop - 1) state.userInterrupted = true
    state.lastTop = viewport.scrollTop
  }

  function endProgrammaticScroll(token: number) {
    if (programmaticTokenRef.current !== token) return
    const state = programmaticStateRef.current
    if (state?.mode === "end") {
      if (state.userInterrupted && followRef.current) setFollowing(false)
      else settleProgrammaticEnd(token)
    }
    if (typeof window === "undefined") {
      programmaticRef.current = false
      programmaticStateRef.current = null
      return
    }
    // Keep suppression through the scroll event that the browser dispatches
    // for this jump; otherwise landing within bottomThreshold looks like a
    // manual return to the bottom and re-enables follow mode.
    window.requestAnimationFrame(() => {
      if (programmaticTokenRef.current !== token) return
      const current = programmaticStateRef.current
      if (current?.mode === "end" && !current.userInterrupted) settleProgrammaticEnd(token)
      programmaticRef.current = false
      programmaticStateRef.current = null
      const viewport = viewportRef.current
      if (viewport) {
        rememberAnchor()
        syncAtBottom(viewport)
        scheduleStateUpdate()
      }
    })
  }

  function resolveAlignedTop(viewport: HTMLDivElement, element: HTMLElement, align: MessageScrollerAlign, peek: number) {
    const viewportRect = viewport.getBoundingClientRect()
    const rect = element.getBoundingClientRect()
    const current = viewport.scrollTop
    const start = current + rect.top - viewportRect.top - peek
    const margin = 0.5
    let resolved: MessageScrollerAlign = align
    let top: number
    if (align === "center") top = current + rect.top - viewportRect.top - (viewport.clientHeight - rect.height) / 2
    else if (align === "end") top = current + rect.top - viewportRect.top - viewport.clientHeight + rect.height
    else if (align === "nearest") {
      const fullyVisible = rect.top >= viewportRect.top - margin && rect.bottom <= viewportRect.bottom + margin
      if (fullyVisible) {
        resolved = "nearest"
        top = current
      } else if (rect.top < viewportRect.top) {
        resolved = "start"
        top = start
      } else {
        resolved = "end"
        top = current + rect.top - viewportRect.top - viewport.clientHeight + rect.height
      }
    } else {
      resolved = "start"
      top = start
    }
    return { top: clampScrollTop(top, viewport), align: resolved }
  }

  async function scrollElement(element: HTMLElement, options: MessageScrollerScrollOptions | undefined, target: string, turn?: MessageScrollerTurn) {
    const viewport = viewportRef.current
    if (!viewport) return finishCommand({ ok: false, reason: "not-mounted", target })
    const align = options?.align ?? "start"
    const peek = turn ? Math.max(0, options?.previousContextPeek ?? previousContextPeekRef.current) : 0
    const { top, align: resolvedAlign } = resolveAlignedTop(viewport, element, align, peek)
    const behavior = resolveScrollBehavior(options?.behavior)
    const token = beginProgrammaticScroll()
    setFollowing(false)
    try {
      await scrollViewportTo(viewport, top, behavior)
    } finally {
      endProgrammaticScroll(token)
    }
    rememberPrependAnchor()
    syncAtBottom(viewport)
    scheduleStateUpdate()
    return finishCommand({ ok: true, target, align: resolvedAlign, behavior, top: viewport.scrollTop, turn })
  }

  async function scrollToMessage(id: string | number, options?: MessageScrollerScrollOptions) {
    if (itemsModeRef.current) return itemsScroller.commands.scrollToMessage(id, options)
    const viewport = viewportRef.current
    if (!viewport) return finishCommand({ ok: false, reason: "not-mounted", target: String(id), align: options?.align })
    const element = findMessageElement(id)
    if (!element) return finishCommand({ ok: false, reason: "not-found", target: String(id), align: options?.align })
    return scrollElement(element, options, String(id))
  }

  async function scrollToTurn(target: string | number, options?: MessageScrollerScrollOptions) {
    if (itemsModeRef.current) return itemsScroller.commands.scrollToTurn(target, options)
    const viewport = viewportRef.current
    if (!viewport) return finishCommand({ ok: false, reason: "not-mounted", target: String(target), align: options?.align })
    const anchors = collectTurnAnchors()
    if (anchors.length === 0) return finishCommand({ ok: false, reason: "no-anchor", target: String(target), align: options?.align })
    const anchor = typeof target === "number"
      ? anchors[target]
      : anchors.find(item => item.turn.id === target || item.turn.messageId === target)
    if (!anchor) return finishCommand({ ok: false, reason: "not-found", target: String(target), align: options?.align })
    return scrollElement(anchor.element, options, anchor.turn.id, anchor.turn)
  }

  async function scrollToLatestAnchor(options?: MessageScrollerScrollOptions) {
    if (itemsModeRef.current) return itemsScroller.commands.scrollToLatestAnchor(options)
    const viewport = viewportRef.current
    if (!viewport) return finishCommand({ ok: false, reason: "not-mounted", target: "latest-anchor" })
    const anchors = collectTurnAnchors()
    const anchor = anchors[anchors.length - 1]
    if (!anchor) return finishCommand({ ok: false, reason: "no-anchor", target: "latest-anchor" })
    return scrollElement(anchor.element, { align: "start", ...options }, anchor.turn.id, anchor.turn)
  }

  async function scrollToStart(options?: MessageScrollerScrollOptions) {
    const viewport = viewportRef.current
    if (!viewport) return finishCommand({ ok: false, reason: "not-mounted", target: "start" })
    const behavior = resolveScrollBehavior(options?.behavior)
    const token = beginProgrammaticScroll()
    setFollowing(false)
    try {
      await scrollViewportTo(viewport, 0, behavior)
    } finally {
      endProgrammaticScroll(token)
    }
    rememberAnchor()
    syncAtBottom(viewport)
    scheduleStateUpdate()
    return finishCommand({ ok: true, target: "start", align: "start", behavior, top: viewport.scrollTop })
  }

  async function scrollToEnd(options?: MessageScrollerScrollOptions) {
    const viewport = viewportRef.current
    if (!viewport) return finishCommand({ ok: false, reason: "not-mounted", target: "end" })
    const behavior = resolveScrollBehavior(options?.behavior)
    const requestedTop = clampScrollTop(getScrollEnd(viewport), viewport)
    const token = beginProgrammaticScroll("end", requestedTop)
    setFollowing(true)
    try {
      await scrollViewportTo(viewport, requestedTop, behavior)
    } finally {
      endProgrammaticScroll(token)
    }
    rememberAnchor()
    syncAtBottom(viewport)
    scheduleStateUpdate()
    return finishCommand({ ok: true, target: "end", align: "end", behavior, top: viewport.scrollTop })
  }

  const handleRef = React.useRef<MessageScrollerHandle | null>(null)
  if (!handleRef.current) {
    handleRef.current = {
      scrollToMessage,
      scrollToTurn,
      scrollToLatestAnchor,
      scrollToStart,
      scrollToEnd,
      getVisibleTurn: () => computeScrollState(false).visibleTurn,
      getScrollState: () => computeScrollState(false),
      getViewport: () => viewportRef.current,
      getMessageElement: findMessageElement,
    }
  }
  React.useImperativeHandle(commandRef, () => handleRef.current as MessageScrollerHandle, [])

  React.useLayoutEffect(() => {
    if (itemsModeRef.current) return
    const viewport = viewportRef.current, content = contentRef.current
    if (!viewport || !content) return
    if (!initialRef.current) {
      initialRef.current = true
      positionInitial()
    } else {
      applyFollowOrPrepend()
    }
    const observer = new ResizeObserver(() => applyFollowOrPrepend())
    observer.observe(content)
    observer.observe(viewport)
    scheduleStateUpdate()
    return () => observer.disconnect()
    // initialPosition/bottomThreshold intentionally re-run only for the
    // positioning contract; every later commit is handled by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bottomThreshold, initialPosition])

  // Run after every React commit as well as streamed DOM size changes.
  React.useLayoutEffect(() => {
    if (itemsModeRef.current) return
    applyFollowOrPrepend()
  })

  // Re-publish the subscription when the turn contract changes.
  React.useLayoutEffect(() => {
    scheduleStateUpdate()
  }, [turnAnchorRole, turnAnchorSelector])

  React.useEffect(() => () => {
    programmaticTokenRef.current += 1
    programmaticRef.current = false
    programmaticStateRef.current = null
    if (frameRef.current !== 0) window.cancelAnimationFrame(frameRef.current)
    frameRef.current = 0
  }, [])

  return <div data-slot="message-scroller" data-auto-scroll={follow} data-at-bottom={atBottom} dir={dir} className={cn("relative h-[190px] min-h-0 overflow-hidden", className)}>
    <div data-slot="message-scroller-viewport" dir={dir} role="region" aria-label="Messages" tabIndex={0} ref={node => { viewportRef.current = node; if (typeof ref === "function") return ref(node); if (ref) ref.current = node }} className="h-full overflow-auto overscroll-contain [overflow-anchor:none]" {...props}
      onPointerDownCapture={event => { markProgrammaticUserInterruption(); onPointerDownCapture?.(event) }}
      onWheelCapture={event => { markProgrammaticUserInterruption(); onWheelCapture?.(event) }}
      onTouchStartCapture={event => { markProgrammaticUserInterruption(); onTouchStartCapture?.(event) }}
      onKeyDownCapture={event => {
        if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)) markProgrammaticUserInterruption()
        onKeyDownCapture?.(event)
      }}
      onScroll={event => {
      const viewport = event.currentTarget
      trackProgrammaticScroll(viewport)
      const bottom = readAtBottom(viewport)
      setAtBottom(previous => previous === bottom ? previous : bottom)
      if (!programmaticRef.current && bottom !== followRef.current) {
        if (autoScroll === undefined) {
          followRef.current = bottom
          setInternalAuto(bottom)
        }
        autoScrollChangeRef.current?.(bottom)
      }
      rememberAnchor()
      scheduleStateUpdate()
      onScroll?.(event)
    }}>
      <div data-slot="message-scroller-content" role="log" aria-live="polite" aria-relevant="additions text" ref={contentRef} className={cn("flex min-h-full flex-col p-3", !itemsMode && "gap-3", contentClassName)}>
        {itemsMode ? <>
          {virtualRows.paddingStart > 0 && <div aria-hidden="true" style={{ height: virtualRows.paddingStart }} />}
          {virtualRows.items.map(entry => {
            const item = items?.[entry.index]
            if (item === undefined) return null
            return <div key={entry.key} data-index={entry.index} ref={virtualRows.measureRow} className="pb-3 last:pb-0">
              {renderItem?.(item, entry.index)}
            </div>
          })}
          {virtualRows.paddingEnd > 0 && <div aria-hidden="true" style={{ height: virtualRows.paddingEnd }} />}
        </> : children}
      </div>
    </div>
    {!atBottom && <button type="button" data-slot="message-scroller-button" aria-label={scrollButtonLabel} className="absolute bottom-2 end-2 flex size-[22px] items-center justify-center rounded-md border border-border bg-background text-foreground shadow-raised cursor-default select-none" onClick={() => {
      const viewport = viewportRef.current
      const token = beginProgrammaticScroll("end", viewport ? clampScrollTop(getScrollEnd(viewport), viewport) : undefined)
      setFollowing(true)
      if (viewport) viewport.scrollTop = getScrollEnd(viewport)
      rememberAnchor()
      if (viewport) syncAtBottom(viewport)
      scheduleStateUpdate()
      endProgrammaticScroll(token)
    }}><ArrowDown aria-hidden="true" className="size-3.5" /></button>}
  </div>
}

export { MessageScroller }
export type { MessageScrollerProps, MessageScrollerHandle, MessageScrollerScrollState, MessageScrollerScrollOptions, MessageScrollerCommandResult, MessageScrollerTurn, MessageScrollerAlign, MessageScrollerAnchorRole, MessageScrollerInitialPosition, MessageScrollerDirection, MessageScrollerCommandReason }
