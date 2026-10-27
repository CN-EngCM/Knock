// Internal to MessageScroller (not exported from the package entry): everything items mode adds on
// top of the shared scroller core — data-derived turns, virtualizer wiring, index-based commands,
// prepend anchoring and follow-the-end. Scroll state, programmatic-scroll bookkeeping and the DOM
// mode stay in message-scroller.tsx and reach this hook through `ItemsHost`.
import * as React from "react"
import { resolveScrollBehavior } from "@/lib/scroll"
import { useVirtualRows } from "@/hooks/use-virtual-rows"
import type {
  MessageScrollerAnchorRole,
  MessageScrollerCommandResult,
  MessageScrollerDirection,
  MessageScrollerInitialPosition,
  MessageScrollerScrollOptions,
  MessageScrollerScrollState,
  MessageScrollerTurn,
} from "./message-scroller"

interface ItemsHost {
  viewportRef: React.RefObject<HTMLDivElement | null>
  contentRef: React.RefObject<HTMLDivElement | null>
  followRef: React.RefObject<boolean>
  programmaticRef: React.RefObject<boolean>
  bottomThresholdRef: React.RefObject<number>
  previousContextPeekRef: React.RefObject<number>
  readDirection: (scrollTop: number, commit: boolean) => MessageScrollerDirection
  beginProgrammaticScroll: () => number
  endProgrammaticScroll: (token: number) => void
  setFollowing: (next: boolean) => void
  finishCommand: (result: MessageScrollerCommandResult) => MessageScrollerCommandResult
  syncAtBottom: (viewport: HTMLDivElement) => boolean
  scheduleStateUpdate: () => void
}

interface ItemsOptions<T> {
  items: readonly T[] | undefined
  getItemKey?: (item: T, index: number) => string
  getItemMessageId?: (item: T, index: number) => string | undefined
  getItemRole?: (item: T, index: number) => string | undefined
  estimateItemHeight: number
  turnAnchorRole: MessageScrollerAnchorRole
  initialPosition: MessageScrollerInitialPosition
  bottomThreshold: number
}

// virtualizer.scrollToIndex/scrollBy are fire-and-forget; wait for the browser's scrollend (or a
// timeout fallback) so command Promises still resolve once the jump has settled.
function waitForScrollEnd(viewport: HTMLDivElement, behavior: ScrollBehavior) {
  if (behavior !== "smooth") return Promise.resolve()
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
  })
}

function useMessageScrollerItems<T>(options: ItemsOptions<T>, host: ItemsHost) {
  const { items, getItemKey, getItemMessageId, getItemRole, estimateItemHeight, turnAnchorRole, initialPosition, bottomThreshold } = options
  const itemsMode = items !== undefined
  const itemsRef = React.useRef(items)
  itemsRef.current = items
  const getItemKeyRef = React.useRef(getItemKey)
  getItemKeyRef.current = getItemKey
  const getItemMessageIdRef = React.useRef(getItemMessageId)
  getItemMessageIdRef.current = getItemMessageId
  const getItemRoleRef = React.useRef(getItemRole)
  getItemRoleRef.current = getItemRole

  // Turn anchors and the message-id / key indexes are derived from data, not DOM queries. The
  // callbacks go through refs (same contract as getItemKey for the virtualizer: a pure function of
  // the item) so inline arrows don't re-run this O(n) pass on every scroll-driven render; it only
  // re-derives when `items` or `turnAnchorRole` change.
  const itemTurns = React.useMemo(() => {
    const anchors: { turn: MessageScrollerTurn; index: number }[] = []
    const anchorByIndex = new Map<number, MessageScrollerTurn>()
    const messageIndex = new Map<string, number>()
    const keyIndex = new Map<string | number, number>()
    if (!itemsMode) return { anchors, anchorByIndex, messageIndex, keyIndex }
    const getKey = getItemKeyRef.current
    const getMessageId = getItemMessageIdRef.current
    const getRole = getItemRoleRef.current
    let anchorIndex = 0
    ;(items ?? []).forEach((item, index) => {
      if (getKey) {
        const key = getKey(item, index)
        if (!keyIndex.has(key)) keyIndex.set(key, index)
      }
      const messageId = getMessageId?.(item, index)
      if (messageId !== undefined) messageIndex.set(messageId, index)
      const role = getRole?.(item, index) ?? null
      if (turnAnchorRole !== "none" && role === turnAnchorRole) {
        const turnId = messageId ?? `turn-${anchorIndex}`
        const turn: MessageScrollerTurn = { id: turnId, messageId: messageId ?? null, role, index: anchorIndex }
        anchors.push({ turn, index })
        anchorByIndex.set(index, turn)
        anchorIndex += 1
      }
    })
    return { anchors, anchorByIndex, messageIndex, keyIndex }
  }, [itemsMode, items, turnAnchorRole])
  const itemTurnsRef = React.useRef(itemTurns)
  itemTurnsRef.current = itemTurns

  const getScrollElement = React.useCallback(() => host.viewportRef.current, [host.viewportRef])
  const virtualRows = useVirtualRows({
    count: items?.length ?? 0,
    getScrollElement,
    estimateRowHeight: estimateItemHeight,
    dynamic: true,
    getItemKey: index => {
      const item = itemsRef.current?.[index]
      return getItemKeyRef.current && item !== undefined ? getItemKeyRef.current(item, index) : index
    },
  })
  const virtualRowsRef = React.useRef(virtualRows)
  virtualRowsRef.current = virtualRows

  // Counterpart of the DOM mode's prependAnchorRef: remembers which item key sits at the top of the
  // viewport (and its pixel offset) so a prepend/append while not following can be compensated by
  // looking that key up again and restoring the same offset, instead of reading a DOM rect.
  const anchorKeyRef = React.useRef<string | number | null>(null)
  const anchorOffsetRef = React.useRef(0)
  const initialRef = React.useRef(false)
  // The items identity/length the anchor was last reconciled against: positions only need
  // restoring when the list itself changed, not on every scroll- or measurement-driven render
  // (virtual-core already compensates size changes above the fold on its own).
  const reconciledItemsRef = React.useRef<readonly T[] | undefined>(undefined)
  const reconciledLengthRef = React.useRef(-1)

  function rememberAnchor() {
    const viewport = host.viewportRef.current
    const getKey = getItemKeyRef.current
    const list = itemsRef.current
    if (!viewport || !getKey || !list) { anchorKeyRef.current = null; return }
    const rows = virtualRowsRef.current.items
    const visible = rows.find(entry => entry.start - viewport.scrollTop >= -1) ?? rows[rows.length - 1]
    const item = visible ? list[visible.index] : undefined
    if (!visible || item === undefined) { anchorKeyRef.current = null; return }
    anchorKeyRef.current = getKey(item, visible.index)
    anchorOffsetRef.current = visible.start - viewport.scrollTop
  }

  function stickToEnd(viewport: HTMLDivElement) {
    // scrollTop clamps to the real maximum, so compare against that, not totalSize.
    if (viewport.scrollTop < viewport.scrollHeight - viewport.clientHeight - 0.5) viewport.scrollTop = virtualRowsRef.current.totalSize
  }

  function restoreAnchor(viewport: HTMLDivElement) {
    const key = anchorKeyRef.current
    if (key === null) return
    const index = itemTurnsRef.current.keyIndex.get(key)
    if (index === undefined) return
    // Use the layout-wide offset, not the currently-rendered/overscanned rows: a prepend typically
    // shifts the anchor well outside the stale (pre-scroll) viewport.
    const offset = virtualRowsRef.current.getOffsetForIndex(index)
    if (offset === undefined) return
    const top = Math.max(0, offset - anchorOffsetRef.current)
    if (Math.abs(viewport.scrollTop - top) > 0.5) viewport.scrollTop = top
  }

  function publish(viewport: HTMLDivElement) {
    host.syncAtBottom(viewport)
    host.scheduleStateUpdate()
  }

  // After every React commit: keep the end pinned while following, otherwise re-find the anchor
  // only if the list changed.
  function applyCommit() {
    const viewport = host.viewportRef.current
    if (!viewport || host.programmaticRef.current) return
    const length = items?.length ?? 0
    const listChanged = reconciledItemsRef.current !== items || reconciledLengthRef.current !== length
    reconciledItemsRef.current = items
    reconciledLengthRef.current = length
    if (host.followRef.current) stickToEnd(viewport)
    else if (listChanged) restoreAnchor(viewport)
    rememberAnchor()
    publish(viewport)
  }

  // Streamed row growth or a viewport resize: only the live edge needs pinning here. A reader
  // paused above it is already held by virtual-core's own above-the-fold size compensation, and
  // list changes are handled by applyCommit, so there is nothing left to restore.
  function applyResize() {
    const viewport = host.viewportRef.current
    if (!viewport || host.programmaticRef.current) return
    if (host.followRef.current) stickToEnd(viewport)
    publish(viewport)
  }

  function positionInitial() {
    const viewport = host.viewportRef.current
    if (!viewport) return
    reconciledItemsRef.current = items
    reconciledLengthRef.current = items?.length ?? 0
    if (initialPosition === "end") viewport.scrollTop = virtualRowsRef.current.totalSize
    else if (initialPosition === "start") viewport.scrollTop = 0
    else {
      const anchors = itemTurnsRef.current.anchors
      const latest = anchors[anchors.length - 1]
      if (latest) {
        virtualRowsRef.current.scrollToIndex(latest.index, { align: "start" })
        const peek = Math.max(0, host.previousContextPeekRef.current)
        if (peek > 0) viewport.scrollTop = Math.max(0, viewport.scrollTop - peek)
      } else {
        viewport.scrollTop = virtualRowsRef.current.totalSize
      }
    }
    host.syncAtBottom(viewport)
    rememberAnchor()
    host.scheduleStateUpdate()
  }

  function computeScrollState(viewport: HTMLDivElement, commitDirection: boolean): MessageScrollerScrollState {
    const scrollTop = viewport.scrollTop
    const direction = host.readDirection(scrollTop, commitDirection)
    const threshold = Math.max(0, host.bottomThresholdRef.current)
    const totalSize = virtualRowsRef.current.totalSize
    const { anchorByIndex } = itemTurnsRef.current
    const list = itemsRef.current
    const getMessageId = getItemMessageIdRef.current
    let startingInView: MessageScrollerTurn | null = null
    let lastIntersecting: MessageScrollerTurn | null = null
    let anchoredTurn: MessageScrollerTurn | null = null
    let visibleMessageId: string | null = null
    for (const entry of virtualRowsRef.current.items) {
      const top = entry.start - scrollTop
      const bottom = top + entry.size
      const turn = anchorByIndex.get(entry.index)
      if (turn) {
        if (!startingInView && top >= -2 && top < viewport.clientHeight) startingInView = turn
        if (bottom > 0 && top < viewport.clientHeight) lastIntersecting = turn
        if (top <= 2) anchoredTurn = turn
      }
      if (visibleMessageId === null && bottom > 0 && top < viewport.clientHeight) {
        const item = list?.[entry.index]
        visibleMessageId = item !== undefined ? getMessageId?.(item, entry.index) ?? null : null
      }
    }
    const visibleTurn = startingInView ?? lastIntersecting
    if (!anchoredTurn) anchoredTurn = visibleTurn
    const atStart = scrollTop <= 1
    const atEnd = totalSize - scrollTop - viewport.clientHeight <= threshold
    return {
      atStart,
      atEnd,
      canScrollUp: !atStart,
      canScrollDown: !atEnd,
      direction,
      visibleTurn,
      anchoredTurn,
      visibleMessageId,
      scrollTop,
      scrollHeight: totalSize,
      clientHeight: viewport.clientHeight,
    }
  }

  // Index-first lookup, then delegate the offset to the virtualizer's own scrollToIndex instead of
  // a DOM element. Return shape and ok/reason contract match the DOM mode.
  async function scrollToIndexCommand(index: number, scrollOptions: MessageScrollerScrollOptions | undefined, target: string, turn?: MessageScrollerTurn) {
    const viewport = host.viewportRef.current
    if (!viewport) return host.finishCommand({ ok: false, reason: "not-mounted", target, align: scrollOptions?.align })
    const align = scrollOptions?.align ?? "start"
    const behavior = resolveScrollBehavior(scrollOptions?.behavior)
    const token = host.beginProgrammaticScroll()
    host.setFollowing(false)
    virtualRowsRef.current.scrollToIndex(index, { align: align === "nearest" ? "auto" : align, behavior })
    try {
      await waitForScrollEnd(viewport, behavior)
    } finally {
      host.endProgrammaticScroll(token)
    }
    rememberAnchor()
    publish(viewport)
    return host.finishCommand({ ok: true, target, align, behavior, top: viewport.scrollTop, turn })
  }

  async function scrollToMessage(id: string | number, scrollOptions?: MessageScrollerScrollOptions) {
    if (!host.viewportRef.current) return host.finishCommand({ ok: false, reason: "not-mounted", target: String(id), align: scrollOptions?.align })
    const index = itemTurnsRef.current.messageIndex.get(String(id))
    if (index === undefined) return host.finishCommand({ ok: false, reason: "not-found", target: String(id), align: scrollOptions?.align })
    return scrollToIndexCommand(index, scrollOptions, String(id))
  }

  async function scrollToTurn(target: string | number, scrollOptions?: MessageScrollerScrollOptions) {
    if (!host.viewportRef.current) return host.finishCommand({ ok: false, reason: "not-mounted", target: String(target), align: scrollOptions?.align })
    const anchors = itemTurnsRef.current.anchors
    if (anchors.length === 0) return host.finishCommand({ ok: false, reason: "no-anchor", target: String(target), align: scrollOptions?.align })
    const anchor = typeof target === "number"
      ? anchors[target]
      : anchors.find(entry => entry.turn.id === target || entry.turn.messageId === target)
    if (!anchor) return host.finishCommand({ ok: false, reason: "not-found", target: String(target), align: scrollOptions?.align })
    return scrollToIndexCommand(anchor.index, scrollOptions, anchor.turn.id, anchor.turn)
  }

  async function scrollToLatestAnchor(scrollOptions?: MessageScrollerScrollOptions) {
    if (!host.viewportRef.current) return host.finishCommand({ ok: false, reason: "not-mounted", target: "latest-anchor" })
    const anchors = itemTurnsRef.current.anchors
    const anchor = anchors[anchors.length - 1]
    if (!anchor) return host.finishCommand({ ok: false, reason: "no-anchor", target: "latest-anchor" })
    return scrollToIndexCommand(anchor.index, { align: "start", ...scrollOptions }, anchor.turn.id, anchor.turn)
  }

  // Mount and resize contract of the DOM mode's effect, driven by virtualizer measurements.
  React.useLayoutEffect(() => {
    if (!itemsMode) return
    const viewport = host.viewportRef.current, content = host.contentRef.current
    if (!viewport || !content) return
    if (!initialRef.current) {
      initialRef.current = true
      positionInitial()
    } else {
      applyCommit()
    }
    const observer = new ResizeObserver(() => applyResize())
    observer.observe(content)
    observer.observe(viewport)
    host.scheduleStateUpdate()
    return () => observer.disconnect()
    // Re-runs only for the positioning contract; every later commit is handled by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemsMode, bottomThreshold, initialPosition])

  // Runs after every commit (new/measured items, follow toggles).
  React.useLayoutEffect(() => {
    if (!itemsMode) return
    applyCommit()
  })

  return {
    virtualRows,
    rememberAnchor,
    computeScrollState,
    getTotalSize: () => virtualRowsRef.current.totalSize,
    commands: { scrollToMessage, scrollToTurn, scrollToLatestAnchor },
  }
}

export { useMessageScrollerItems }
export type { ItemsHost }
