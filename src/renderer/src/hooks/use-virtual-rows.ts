import * as React from "react"
import { useVirtualizer } from "@tanstack/react-virtual"
import { resolveScrollBehavior } from "@/lib/scroll"

export interface VirtualRowsOptions {
  count: number
  getScrollElement: () => HTMLElement | null
  /** Estimated row height in fixed mode; first-frame estimate in dynamic mode. */
  estimateRowHeight: number
  /** true measures each row's real height via measureRow / ResizeObserver. */
  dynamic?: boolean
  /** Rows rendered beyond the viewport on each side. Default 8. */
  overscan?: number
  getItemKey?: (index: number) => string | number
  /** Returns focus to the scroll viewport when a focused row is recycled. Default true. */
  rescueFocus?: boolean
}

export interface VirtualRowItem {
  index: number
  key: string | number
  start: number
  size: number
}

export interface VirtualRows {
  items: VirtualRowItem[]
  totalSize: number
  /** Already converted to a placeholder row height. */
  paddingStart: number
  paddingEnd: number
  /** Ref callback for each rendered row; only measures in dynamic mode, otherwise a no-op. */
  measureRow: (node: HTMLElement | null) => void
  scrollToIndex: (index: number, options?: { align?: "start" | "center" | "end" | "auto"; behavior?: ScrollBehavior }) => void
  scrollBy: (delta: number) => void
  /**
   * Layout offset for any index, using cached/estimated sizes for the whole list — unlike
   * `items`, this isn't limited to the currently-rendered/overscanned range. Used to re-anchor
   * scroll position across a count change (e.g. prepending older rows) even when the anchor
   * row isn't currently mounted.
   */
  getOffsetForIndex: (index: number) => number | undefined
}

/** Shared `@tanstack/react-virtual` wrapper used by DataTable, MessageScroller and Tree. */
export function useVirtualRows(options: VirtualRowsOptions): VirtualRows {
  const { count, getScrollElement: getScrollElementProp, estimateRowHeight, dynamic = false, overscan = 8, getItemKey, rescueFocus = true } = options
  // count 为 0 即未启用（如 Tree 未开虚拟化、MessageScroller 的 children 模式）：不挂虚拟器，
  // 否则 virtual-core 仍会在滚动元素上挂滚动监听与 ResizeObserver，滚动时白白重渲染宿主。
  const enabled = count > 0
  // 调用方常传内联函数；经 ref 转发，让下面依赖它的 effect 与虚拟器选项保持稳定引用。
  const getScrollElementRef = React.useRef(getScrollElementProp)
  getScrollElementRef.current = getScrollElementProp
  const getScrollElement = React.useCallback(() => getScrollElementRef.current(), [])
  const estimateRef = React.useRef(estimateRowHeight)
  estimateRef.current = estimateRowHeight
  const getItemKeyRef = React.useRef(getItemKey)
  getItemKeyRef.current = getItemKey

  // getItemKey's identity is one of virtual-core's own memoization keys (getMeasurementOptions):
  // a fresh inline closure on every render — which every caller here passes — would invalidate
  // and rebuild the full measurement cache on every render, not just on real list changes. Route
  // it through a stable wrapper the same way estimateRowHeight already goes through estimateRef.
  const stableGetItemKey = React.useCallback(
    (index: number) => getItemKeyRef.current?.(index) ?? index,
    [],
  )

  const virtualizer = useVirtualizer({
    enabled,
    count,
    getScrollElement,
    estimateSize: () => estimateRef.current,
    overscan,
    getItemKey: stableGetItemKey,
  })

  // 估算行高变了（密度切换、调用方改 rowHeight）：virtual-core 缓存着按旧估算算出的每行尺寸与偏移，
  // 必须清掉重算，否则滚动到底部的位置会按旧行高错位。首次挂载不需要，估算本来就是当前值。
  const lastEstimateRef = React.useRef(estimateRowHeight)
  React.useLayoutEffect(() => {
    if (lastEstimateRef.current === estimateRowHeight) return
    lastEstimateRef.current = estimateRowHeight
    virtualizer.measure()
  }, [estimateRowHeight, virtualizer])

  const virtualItems = virtualizer.getVirtualItems()
  const totalSize = virtualizer.getTotalSize()
  const first = virtualItems[0]
  const last = virtualItems[virtualItems.length - 1]
  const paddingStart = first ? first.start : 0
  const paddingEnd = last ? Math.max(0, totalSize - last.end) : totalSize

  const items = React.useMemo<VirtualRowItem[]>(
    () => virtualItems.map(item => ({ index: item.index, key: item.key as string | number, start: item.start, size: item.size })),
    // virtual-core returns a stable array identity only when the visible range is unchanged;
    // re-deriving on every render here would defeat memoization for consumers, so key off its own identity.
    [virtualItems],
  )

  const measureRow = React.useCallback((node: HTMLElement | null) => {
    if (dynamic) virtualizer.measureElement(node)
  }, [dynamic, virtualizer])

  const scrollToIndex = React.useCallback((index: number, scrollOptions?: { align?: "start" | "center" | "end" | "auto"; behavior?: ScrollBehavior }) => {
    virtualizer.scrollToIndex(index, { align: scrollOptions?.align, behavior: resolveScrollBehavior(scrollOptions?.behavior) })
  }, [virtualizer])

  const scrollBy = React.useCallback((delta: number) => {
    virtualizer.scrollBy(delta, { behavior: "auto" })
  }, [virtualizer])

  const getOffsetForIndex = React.useCallback((index: number) => {
    return virtualizer.getOffsetForIndex(index, "start")?.[0]
  }, [virtualizer])

  // 焦点救援：持焦点的行被回收（滚出渲染范围，或列表变化把它移除）后，焦点交还滚动视口，不落到 <body>。
  // 两种浏览器行为都要接住：
  // - Chromium 在移除持焦点的节点前同步派发 focusout（relatedTarget 为 null，目标此刻仍在文档中），
  //   于是在 focusout 里排一个微任务，本次提交结束后目标已脱离文档、焦点在 body 上，即为被回收；
  // - Firefox 移除时不派发 focusout，hadFocusRef 仍为 true，由下面的 layout effect 在行列表提交后补救。
  // 只救虚拟化的行：enabledRef 是上一次提交时的状态，行数从 n 变 0 的那次移除发生在它更新之前，仍读到 true。
  const hadFocusRef = React.useRef(false)
  const enabledRef = React.useRef(enabled)
  React.useLayoutEffect(() => { enabledRef.current = enabled })
  React.useEffect(() => {
    if (!rescueFocus) return
    const element = getScrollElement()
    if (!element) return
    const onFocusIn = () => { hadFocusRef.current = true }
    const onFocusOut = (event: FocusEvent) => {
      const next = event.relatedTarget
      if (next instanceof Node && (next === element || element.contains(next))) return
      hadFocusRef.current = false
      const target = event.target
      if (next !== null || !enabledRef.current || !(target instanceof Node) || target === element) return
      queueMicrotask(() => {
        if (target.isConnected || !element.isConnected) return
        const active = document.activeElement
        if (!active || active === document.body) element.focus({ preventScroll: true })
      })
    }
    element.addEventListener("focusin", onFocusIn)
    element.addEventListener("focusout", onFocusOut)
    return () => {
      element.removeEventListener("focusin", onFocusIn)
      element.removeEventListener("focusout", onFocusOut)
    }
  }, [rescueFocus, getScrollElement])

  React.useLayoutEffect(() => {
    if (!rescueFocus || !hadFocusRef.current) return
    const element = getScrollElement()
    if (!element) return
    const active = typeof document !== "undefined" ? document.activeElement : null
    if (!active || active === document.body) element.focus({ preventScroll: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, rescueFocus, getScrollElement])

  return { items, totalSize, paddingStart, paddingEnd, measureRow, scrollToIndex, scrollBy, getOffsetForIndex }
}
