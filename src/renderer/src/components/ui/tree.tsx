import * as React from "react"
import { ChevronRight, RotateCcw } from "lucide-react"
import { cn } from "@/lib/utils"
import { inputSurface } from "@/components/ui/input"
import { useDirection } from "@/components/ui/direction"
import { getPlatform } from "@/lib/platform"
import { useVirtualRows } from "@/hooks/use-virtual-rows"
import { useSizeToken } from "@/hooks/use-size-token"
import { DragProvider, useDragHandle, useDropTarget, DragPreview, type DragEndEvent, type Insertion, type UseDragHandleResult, type UseDropTargetResult } from "@/components/ui/drag"
import type { KeyboardCoordinateGetter } from "@dnd-kit/core"
import { Spinner } from "@/components/ui/spinner"

export interface TreeNode {
  id: string
  label: React.ReactNode
  icon?: React.ReactNode
  children?: TreeNode[]
  /** 子节点未知（懒加载）时声明 true；箭头照常显示。 */
  hasChildren?: boolean
  disabled?: boolean
  /** 业务数据，拖拽等回调原样带回。 */
  data?: unknown
}

export type TreeSelectionMode = "single" | "multiple"
export type TreeDropPosition = "before" | "after" | "inside"

export interface TreeLabels {
  loading: string
  retry: string
  loadError: string
  collapse: string
  expand: string
  rename: string
  dragHandle: (label: string) => string
}

const defaultLabels: TreeLabels = {
  loading: "加载中…",
  retry: "重试",
  loadError: "加载失败",
  collapse: "折叠",
  expand: "展开",
  rename: "重命名",
  dragHandle: label => `拖动 ${label} 以移动`,
}

export interface TreeRenameOptions {
  enabled?: boolean
  validate?: (value: string, node: TreeNode) => string | null
  onRename: (node: TreeNode, value: string) => void
}

export interface TreeDndOptions {
  reorder?: boolean
  moveInto?: boolean
  canDrop?: (drag: TreeNode, target: TreeNode, position: TreeDropPosition) => boolean
  onMove: (drag: TreeNode, target: TreeNode, position: TreeDropPosition) => void
}

export interface TreeRowContext {
  node: TreeNode
  depth: number
  expanded: boolean
  hasChildren: boolean
  selected: boolean
  active: boolean
  loading: boolean
}

export interface TreeProps {
  nodes: TreeNode[]
  expandedIds?: string[]
  defaultExpandedIds?: string[]
  onExpandedChange?: (ids: string[]) => void
  selectedIds?: string[]
  defaultSelectedIds?: string[]
  onSelectedChange?: (ids: string[]) => void
  selectionMode?: TreeSelectionMode
  activeId?: string | null
  onActiveChange?: (id: string | null) => void
  onActivate?: (node: TreeNode) => void
  loadChildren?: (node: TreeNode) => Promise<TreeNode[]>
  onLoadError?: (node: TreeNode, error: unknown) => void
  rename?: TreeRenameOptions
  dnd?: TreeDndOptions
  virtual?: boolean | { estimateRowHeight?: number; overscan?: number }
  indentGuides?: boolean
  /** 行高（px）。省略时跟随密度档（令牌 `--size-tree-row`：compact 20 / regular 22 / comfortable 26）；传数值则固定为该值，不随密度变化。 */
  rowHeight?: number
  indent?: number
  renderRow?: (context: TreeRowContext) => React.ReactNode
  labels?: Partial<TreeLabels>
  label?: string
  className?: string
}

interface FlatRow {
  node: TreeNode
  depth: number
  parentId: string | null
  posinset: number
  setsize: number
  hasChildren: boolean
  expanded: boolean
}

function textOf(label: React.ReactNode): string {
  return typeof label === "string" ? label : ""
}

function childrenOf(node: TreeNode, loaded: Record<string, TreeNode[] | undefined>): TreeNode[] | undefined {
  return node.children ?? loaded[node.id]
}

function hasChildrenOf(node: TreeNode, loaded: Record<string, TreeNode[] | undefined>): boolean {
  const resolved = node.children ?? loaded[node.id]
  if (resolved) return resolved.length > 0
  return node.hasChildren === true
}

function flatten(nodes: TreeNode[], expanded: Set<string>, loaded: Record<string, TreeNode[] | undefined>, depth: number, parentId: string | null, acc: FlatRow[]) {
  nodes.forEach((node, index) => {
    const hasChildren = hasChildrenOf(node, loaded)
    const isExpanded = expanded.has(node.id)
    acc.push({ node, depth, parentId, posinset: index + 1, setsize: nodes.length, hasChildren, expanded: isExpanded })
    if (isExpanded) {
      const children = childrenOf(node, loaded)
      if (children?.length) flatten(children, expanded, loaded, depth + 1, node.id, acc)
    }
  })
}

/** 合并默认文案；内容未变时沿用上一份对象，行组件的 memo 才不会被每次渲染新建的 copy 击穿。 */
function useStableLabels(labels: Partial<TreeLabels> | undefined): TreeLabels {
  const ref = React.useRef<TreeLabels>(defaultLabels)
  const next = { ...defaultLabels, ...labels }
  if ((Object.keys(next) as (keyof TreeLabels)[]).some(key => next[key] !== ref.current[key])) ref.current = next
  return ref.current
}

/**
 * 树视图：扁平行 + aria-activedescendant（不用 roving tabindex、不渲染嵌套 role="group"）。
 * 这是虚拟化与懒加载下唯一自洽的结构：焦点常驻容器，行被回收/折叠不丢焦点；层级靠
 * aria-level/aria-posinset/aria-setsize 表达。长期约定见 docs/design.md「关键尺寸与行为」。
 */
function Tree({
  nodes,
  expandedIds,
  defaultExpandedIds,
  onExpandedChange,
  selectedIds,
  defaultSelectedIds,
  onSelectedChange,
  selectionMode = "single",
  activeId: activeIdProp,
  onActiveChange,
  onActivate,
  loadChildren,
  onLoadError,
  rename,
  dnd,
  virtual,
  indentGuides = true,
  rowHeight: rowHeightProp,
  indent = 12,
  renderRow,
  labels,
  label = "树",
  className,
}: TreeProps) {
  const dir = useDirection()
  const rtl = dir === "rtl"
  const copy = useStableLabels(labels)
  const treeId = React.useId()
  const containerRef = React.useRef<HTMLDivElement>(null)
  // 行高默认读 --size-tree-row 的计算值：行样式与虚拟化估算用同一个数，密度变化后一起更新。
  const tokenRowHeight = useSizeToken(containerRef, "--size-tree-row", 22)
  const rowHeight = rowHeightProp ?? tokenRowHeight
  const rowNodesRef = React.useRef(new Map<string, HTMLElement>())

  const [internalExpanded, setInternalExpanded] = React.useState<string[]>(() => defaultExpandedIds ?? [])
  const [internalSelected, setInternalSelected] = React.useState<string[]>(() => defaultSelectedIds ?? [])
  const [internalActive, setInternalActive] = React.useState<string | null>(null)
  const [loadedChildren, setLoadedChildren] = React.useState<Record<string, TreeNode[] | undefined>>({})
  const [loadState, setLoadState] = React.useState<Record<string, "loading" | { error: unknown } | undefined>>({})
  const [renamingId, setRenamingId] = React.useState<string | null>(null)
  const [renameValue, setRenameValue] = React.useState("")
  const [renameError, setRenameError] = React.useState<string | null>(null)

  const expandedArray = expandedIds ?? internalExpanded
  const expandedSet = React.useMemo(() => new Set(expandedArray), [expandedArray])
  const selectedArray = selectedIds ?? internalSelected
  const selectedSet = React.useMemo(() => new Set(selectedArray), [selectedArray])

  const flatRows = React.useMemo(() => {
    const acc: FlatRow[] = []
    flatten(nodes, expandedSet, loadedChildren, 0, null, acc)
    return acc
  }, [nodes, expandedSet, loadedChildren])

  const rowsById = React.useMemo(() => {
    const map = new Map<string, FlatRow>()
    for (const row of flatRows) map.set(row.node.id, row)
    return map
  }, [flatRows])

  const activeId = activeIdProp !== undefined ? activeIdProp : internalActive
  const resolvedActiveId = activeId && rowsById.has(activeId) ? activeId : (flatRows[0]?.node.id ?? null)

  const loadChildrenRef = React.useRef(loadChildren)
  loadChildrenRef.current = loadChildren
  const onLoadErrorRef = React.useRef(onLoadError)
  onLoadErrorRef.current = onLoadError
  const anchorRef = React.useRef<string | null>(null)

  function commitExpanded(next: Set<string>) {
    const ids = [...next]
    if (expandedIds === undefined) setInternalExpanded(ids)
    onExpandedChange?.(ids)
  }

  function commitSelected(ids: string[]) {
    if (selectedIds === undefined) setInternalSelected(ids)
    onSelectedChange?.(ids)
  }

  function setActive(id: string | null) {
    if (activeIdProp === undefined) setInternalActive(id)
    onActiveChange?.(id)
  }

  async function loadNode(node: TreeNode) {
    const loader = loadChildrenRef.current
    if (!loader) return
    setLoadState(state => ({ ...state, [node.id]: "loading" }))
    try {
      const children = await loader(node)
      setLoadedChildren(current => ({ ...current, [node.id]: children }))
      setLoadState(state => { const next = { ...state }; delete next[node.id]; return next })
    } catch (error) {
      setLoadState(state => ({ ...state, [node.id]: { error } }))
      onLoadErrorRef.current?.(node, error)
    }
  }

  function setExpanded(id: string, expand: boolean) {
    setExpandedMany([id], expand)
  }

  // 多个 id 一次提交：逐个调 setExpanded 时每次都基于同一份 expandedSet，后一次会覆盖前一次。
  function setExpandedMany(ids: string[], expand: boolean) {
    if (ids.length === 0) return
    const next = new Set(expandedSet)
    for (const id of ids) {
      if (expand) next.add(id); else next.delete(id)
    }
    commitExpanded(next)
    if (!expand) return
    for (const id of ids) {
      // 展开只会发生在可见行上（点击箭头、键盘、拖拽悬停、"*"），rowsById 已够用。
      const node = rowsById.get(id)?.node
      if (node && !childrenOf(node, loadedChildren) && node.hasChildren && loadState[id] !== "loading") void loadNode(node)
    }
  }

  function toggleExpanded(row: FlatRow) {
    if (!row.hasChildren) return
    setExpanded(row.node.id, !row.expanded)
  }

  function retryLoad(node: TreeNode) {
    void loadNode(node)
  }

  function scrollRowIntoView(id: string) {
    const index = flatRows.findIndex(row => row.node.id === id)
    if (index < 0) return
    // useVirtualRows is always called (count: 0 when virtual is off), so virtualRows itself is
    // never falsy — branch on virtualEnabled, not on the hook result, or the DOM fallback below
    // (needed for non-virtual trees, which is most of them) is permanently dead code.
    if (virtualEnabled) virtualRows.scrollToIndex(index, { align: "auto" })
    else rowNodesRef.current.get(id)?.scrollIntoView({ block: "nearest" })
  }

  function moveActive(id: string | null, { extend = false }: { extend?: boolean } = {}) {
    if (!id) return
    if (extend && selectionMode === "multiple" && anchorRef.current) selectRange(anchorRef.current, id)
    else anchorRef.current = id
    setActive(id)
    scrollRowIntoView(id)
  }

  function selectRange(fromId: string, toId: string) {
    const fromIndex = flatRows.findIndex(row => row.node.id === fromId)
    const toIndex = flatRows.findIndex(row => row.node.id === toId)
    if (fromIndex < 0 || toIndex < 0) return
    const [start, end] = fromIndex <= toIndex ? [fromIndex, toIndex] : [toIndex, fromIndex]
    commitSelected(flatRows.slice(start, end + 1).filter(row => !row.node.disabled).map(row => row.node.id))
  }

  function toggleSelected(id: string) {
    const next = new Set(selectedSet)
    if (next.has(id)) next.delete(id); else next.add(id)
    commitSelected([...next])
  }

  function isModPressed(event: React.MouseEvent | React.KeyboardEvent) {
    return getPlatform() === "mac" ? event.metaKey : event.ctrlKey
  }

  function handleRowClick(row: FlatRow, event: React.MouseEvent) {
    if (row.node.disabled) return
    setActive(row.node.id)
    if (selectionMode === "multiple" && event.shiftKey && anchorRef.current) selectRange(anchorRef.current, row.node.id)
    else if (selectionMode === "multiple" && isModPressed(event)) { toggleSelected(row.node.id); anchorRef.current = row.node.id }
    else { commitSelected([row.node.id]); anchorRef.current = row.node.id }
    scrollRowIntoView(row.node.id)
  }

  function startRename(row: FlatRow) {
    if (!rename?.enabled || row.node.disabled) return
    setRenamingId(row.node.id)
    setRenameValue(textOf(row.node.label))
    setRenameError(null)
  }

  function cancelRename() {
    setRenamingId(null)
    setRenameError(null)
    requestAnimationFrame(() => containerRef.current?.focus({ preventScroll: true }))
  }

  function commitRename(row: FlatRow) {
    const validate = rename?.validate
    const error = validate ? validate(renameValue, row.node) : null
    if (error) { setRenameError(error); return }
    rename?.onRename(row.node, renameValue)
    setRenamingId(null)
    setRenameError(null)
    setActive(row.node.id)
    requestAnimationFrame(() => containerRef.current?.focus({ preventScroll: true }))
  }

  const typeaheadRef = React.useRef({ buffer: "", timer: 0 as unknown as ReturnType<typeof setTimeout> })

  function handleTypeahead(char: string) {
    const state = typeaheadRef.current
    window.clearTimeout(state.timer)
    state.buffer += char.toLowerCase()
    state.timer = setTimeout(() => { state.buffer = "" }, 500)
    const activeIndex = flatRows.findIndex(row => row.node.id === resolvedActiveId)
    const order = [...flatRows.slice(activeIndex + 1), ...flatRows.slice(0, activeIndex + 1)]
    const match = order.find(row => !row.node.disabled && textOf(row.node.label).toLowerCase().startsWith(state.buffer))
    if (match) moveActive(match.node.id)
  }

  function expandSiblings(row: FlatRow) {
    setExpandedMany(flatRows.filter(sibling => sibling.parentId === row.parentId && sibling.hasChildren && !sibling.expanded).map(sibling => sibling.node.id), true)
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (renamingId) return
    // A drag handle inside the row handles its own Space/Enter/Arrow keys (dnd-kit's
    // KeyboardSensor) and calls preventDefault when it does; skip tree navigation/selection
    // for that same bubbled event so picking up or dropping a row doesn't also move the cursor.
    if (event.defaultPrevented) return
    const activeIndex = flatRows.findIndex(row => row.node.id === resolvedActiveId)
    const activeRow = activeIndex >= 0 ? flatRows[activeIndex] : undefined
    const forward = rtl ? "ArrowLeft" : "ArrowRight"
    const backward = rtl ? "ArrowRight" : "ArrowLeft"

    if (event.key === "ArrowDown") { event.preventDefault(); const next = flatRows[activeIndex + 1]; if (next) moveActive(next.node.id, { extend: event.shiftKey }); return }
    if (event.key === "ArrowUp") { event.preventDefault(); const next = flatRows[activeIndex - 1]; if (next) moveActive(next.node.id, { extend: event.shiftKey }); return }
    if (event.key === "Home") { event.preventDefault(); const first = flatRows[0]; if (first) moveActive(first.node.id, { extend: event.shiftKey }); return }
    if (event.key === "End") { event.preventDefault(); const last = flatRows[flatRows.length - 1]; if (last) moveActive(last.node.id, { extend: event.shiftKey }); return }
    if (event.key === forward) {
      event.preventDefault()
      if (!activeRow) return
      if (activeRow.hasChildren && !activeRow.expanded) setExpanded(activeRow.node.id, true)
      else if (activeRow.expanded) { const child = flatRows[activeIndex + 1]; if (child?.parentId === activeRow.node.id) moveActive(child.node.id) }
      return
    }
    if (event.key === backward) {
      event.preventDefault()
      if (!activeRow) return
      if (activeRow.expanded) setExpanded(activeRow.node.id, false)
      else if (activeRow.parentId) moveActive(activeRow.parentId)
      return
    }
    if (event.key === "*") { event.preventDefault(); if (activeRow) expandSiblings(activeRow); return }
    if (event.key === "Enter") { event.preventDefault(); if (activeRow && !activeRow.node.disabled) onActivate?.(activeRow.node); return }
    if (event.key === "F2") { event.preventDefault(); if (activeRow) startRename(activeRow); return }
    if (event.key === " ") {
      event.preventDefault()
      if (!activeRow || activeRow.node.disabled) return
      if (selectionMode === "multiple") { toggleSelected(activeRow.node.id); anchorRef.current = activeRow.node.id }
      else { commitSelected([activeRow.node.id]); anchorRef.current = activeRow.node.id }
      return
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) { handleTypeahead(event.key) }
  }

  const virtualConfig = typeof virtual === "object" ? virtual : undefined
  const virtualEnabled = !!virtual
  const virtualRows = useVirtualRows({
    count: virtualEnabled ? flatRows.length : 0,
    getScrollElement: () => containerRef.current,
    estimateRowHeight: virtualConfig?.estimateRowHeight ?? rowHeight,
    overscan: virtualConfig?.overscan ?? 8,
    getItemKey: index => flatRows[index]?.node.id ?? index,
  })

  // A caller driving `activeId` externally can point it at a row outside the currently rendered/
  // overscanned window; without this, aria-activedescendant would reference a DOM id that isn't
  // mounted. moveActive/handleRowClick already call scrollRowIntoView for the internal paths, but
  // nothing reacted to the controlled prop itself.
  React.useEffect(() => {
    if (activeIdProp === undefined || activeIdProp === null) return
    scrollRowIntoView(activeIdProp)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIdProp])

  const flatRowsRef = React.useRef(flatRows)
  flatRowsRef.current = flatRows
  // dnd-kit's own `sortableKeyboardCoordinates` picks a direction by filtering every registered
  // droppable's rect against the dragged row's current rect, then guesses among survivors with
  // closestCorners — at a 22px row height that guess and the DndContext's own closestCenter
  // collision pass (which actually decides `over`) can disagree, intermittently landing back on
  // the drag source itself. Tree already has an authoritative visible-row order (flatRows), so
  // just jump straight to the previous/next row's own measured rect instead of guessing from pixels.
  const treeCoordinateGetter = React.useCallback<KeyboardCoordinateGetter>((event, { active, context }) => {
    if (event.code !== "ArrowUp" && event.code !== "ArrowDown") return undefined
    const rows = flatRowsRef.current
    const activeIndex = rows.findIndex(row => row.node.id === active)
    if (activeIndex < 0) return undefined
    const targetRow = rows[event.code === "ArrowUp" ? activeIndex - 1 : activeIndex + 1]
    if (!targetRow) return undefined
    // context.droppableRects is dnd-kit's own measurement cache, refreshed on drag start — a key
    // press landing before that pass finishes (easy to hit with no natural pause between pickup
    // and the first move) would find it empty. Reading the DOM node directly has no such lag.
    const rect = context.droppableRects.get(targetRow.node.id) ?? rowNodesRef.current.get(targetRow.node.id)?.getBoundingClientRect()
    if (!rect) return undefined
    event.preventDefault()
    return { x: rect.left, y: rect.top }
  }, [])

  const dndEnabled = !!dnd
  const dndPositions = React.useMemo<Insertion[]>(() => {
    const positions: Insertion[] = []
    if (dnd?.reorder) { positions.push("before", "after") }
    if (dnd?.moveInto) positions.push("inside")
    return positions.length ? positions : ["inside"]
  }, [dnd?.reorder, dnd?.moveInto])
  const insertionMapRef = React.useRef(new Map<string, Insertion | null>())

  function isDropForbidden(dragId: string, targetId: string) {
    if (dragId === targetId) return true
    let cursor = rowsById.get(targetId)
    while (cursor) {
      if (cursor.node.id === dragId) return true
      cursor = cursor.parentId ? rowsById.get(cursor.parentId) : undefined
    }
    return false
  }

  function handleDragEnd(event: DragEndEvent) {
    const overId = event.over?.id
    const dragNode = (event.active.data.current as { node?: TreeNode } | undefined)?.node
    if (!dragNode || typeof overId !== "string") return
    const targetRow = rowsById.get(overId)
    if (!targetRow || isDropForbidden(dragNode.id, overId)) return
    const position = insertionMapRef.current.get(overId) ?? "inside"
    if (dnd?.canDrop && !dnd.canDrop(dragNode, targetRow.node, position)) return
    dnd?.onMove(dragNode, targetRow.node, position)
  }

  // 传给行的回调必须稳定，行组件的 React.memo 才有意义：行 id 作参数，处理函数每次渲染写进 ref，
  // 稳定包装在事件触发时读最新的那份。这样选中/活动行变化只会重渲染受影响的行。
  const rowHandlersRef = React.useRef<RowHandlers>(null as unknown as RowHandlers)
  rowHandlersRef.current = {
    click: (id, event) => { const row = rowsById.get(id); if (row) handleRowClick(row, event) },
    toggleExpand: id => { const row = rowsById.get(id); if (row) toggleExpanded(row) },
    retry: id => { const row = rowsById.get(id); if (row) retryLoad(row.node) },
    startRename: id => { const row = rowsById.get(id); if (row) startRename(row) },
    commitRename: id => { const row = rowsById.get(id); if (row) commitRename(row) },
    cancelRename,
    autoExpand: id => { const row = rowsById.get(id); if (row?.hasChildren && !row.expanded) setExpanded(id, true) },
    canAcceptDrop: (dragNode, target) => {
      if (isDropForbidden(dragNode.id, target.id)) return false
      const canDrop = dnd?.canDrop
      if (!canDrop) return true
      return dndPositions.some(position => canDrop(dragNode, target, position))
    },
  }
  const rowActions = React.useMemo<RowActions>(() => ({
    onClick: (id, event) => rowHandlersRef.current.click(id, event),
    onToggleExpand: id => rowHandlersRef.current.toggleExpand(id),
    onRetry: id => rowHandlersRef.current.retry(id),
    onDoubleClick: id => rowHandlersRef.current.startRename(id),
    onRenameCommit: id => rowHandlersRef.current.commitRename(id),
    onRenameCancel: () => rowHandlersRef.current.cancelRename(),
    onAutoExpand: id => rowHandlersRef.current.autoExpand(id),
    canAcceptDrop: (dragNode, target) => rowHandlersRef.current.canAcceptDrop(dragNode, target),
    onInsertionChange: (id, insertion) => { insertionMapRef.current.set(id, insertion) },
    registerNode: (id, node) => { if (node) rowNodesRef.current.set(id, node); else rowNodesRef.current.delete(id) },
  }), [])

  function renderRowItem(row: FlatRow, virtualItem?: { start: number; size: number }) {
    const id = row.node.id
    const renaming = renamingId === id
    return <TreeRow
      key={id}
      treeId={treeId}
      row={row}
      rtl={rtl}
      indent={indent}
      indentGuides={indentGuides}
      rowHeight={rowHeight}
      virtualStart={virtualItem?.start}
      virtualSize={virtualItem?.size}
      active={id === resolvedActiveId}
      selected={selectedSet.has(id)}
      loading={loadState[id] === "loading"}
      loadError={(loadState[id] as { error: unknown } | undefined)?.error}
      renaming={renaming}
      // 改名输入态只下发给正在改名的行，输入时不会牵动其他行。
      renameValue={renaming ? renameValue : ""}
      renameError={renaming ? renameError : null}
      onRenameValueChange={setRenameValue}
      actions={rowActions}
      copy={copy}
      renderRow={renderRow}
      dndEnabled={dndEnabled}
      dndPositions={dndPositions}
    />
  }

  const treeNode = (
    <div
      ref={containerRef}
      id={treeId}
      role="tree"
      dir={dir}
      aria-label={label}
      aria-multiselectable={selectionMode === "multiple" || undefined}
      tabIndex={flatRows.length ? 0 : -1}
      aria-activedescendant={resolvedActiveId ? `${treeId}-${resolvedActiveId}` : undefined}
      onKeyDown={handleKeyDown}
      className={cn("relative overflow-auto text-xs outline-none", className)}
      style={virtualEnabled ? { maxHeight: 320 } : undefined}
    >
      {virtualEnabled ? (
        <div style={{ height: virtualRows.totalSize, position: "relative" }}>
          {virtualRows.items.map(item => {
            const row = flatRows[item.index]
            return row ? renderRowItem(row, item) : null
          })}
        </div>
      ) : flatRows.map(row => renderRowItem(row))}
    </div>
  )

  // 行内的拖拽 hooks（useDraggable/useDroppable/useDndMonitor）都要求 DndContext 祖先，且每行
  // 挂载都会向 DndContext 派发注册；所以只有传了 dnd 才包 DragProvider 并渲染可拖拽行，
  // 否则就是不带任何 dnd-kit 开销的普通行。
  if (!dndEnabled) return treeNode
  return <DragProvider onDragEnd={handleDragEnd} coordinateGetter={treeCoordinateGetter}>
    {treeNode}
    <DragPreview>{active => {
      const node = (active.data.current as { node?: TreeNode } | undefined)?.node
      return node ? <>{node.icon}<span>{node.label}</span></> : null
    }}</DragPreview>
  </DragProvider>
}

/** 传给行的稳定回调集合（行 id 作参数），整个 Tree 生命周期内引用不变。 */
interface RowActions {
  onClick: (id: string, event: React.MouseEvent) => void
  onDoubleClick: (id: string) => void
  onToggleExpand: (id: string) => void
  onRetry: (id: string) => void
  onRenameCommit: (id: string) => void
  onRenameCancel: () => void
  onAutoExpand: (id: string) => void
  /** 拖拽项能否放到目标行上（含禁止落入自身/后代与 canDrop 判定）。 */
  canAcceptDrop: (dragNode: TreeNode, target: TreeNode) => boolean
  onInsertionChange: (id: string, insertion: Insertion | null) => void
  registerNode: (id: string, node: HTMLElement | null) => void
}

interface RowHandlers {
  click: (id: string, event: React.MouseEvent) => void
  toggleExpand: (id: string) => void
  retry: (id: string) => void
  startRename: (id: string) => void
  commitRename: (id: string) => void
  cancelRename: () => void
  autoExpand: (id: string) => void
  canAcceptDrop: (dragNode: TreeNode, target: TreeNode) => boolean
}

interface TreeRowProps {
  treeId: string
  row: FlatRow
  rtl: boolean
  indent: number
  indentGuides: boolean
  rowHeight: number
  /** 虚拟化时的绝对定位参数；用数值而不是 style 对象，才不会每次渲染击穿 memo。 */
  virtualStart?: number
  virtualSize?: number
  active: boolean
  selected: boolean
  loading: boolean
  loadError: unknown
  renaming: boolean
  renameValue: string
  renameError: string | null
  onRenameValueChange: (value: string) => void
  actions: RowActions
  copy: TreeLabels
  renderRow?: (context: TreeRowContext) => React.ReactNode
  dndEnabled: boolean
  dndPositions: Insertion[]
}

/** 可拖拽行额外交给视图的 dnd 绑定。 */
interface RowDnd {
  setActivatorNodeRef: UseDragHandleResult["setActivatorNodeRef"]
  attributes: UseDragHandleResult["attributes"]
  listeners: UseDragHandleResult["listeners"]
  dropProps: UseDropTargetResult["dropProps"]
}

/** 行组件：memo 之后只有自己的 props 变化才重渲染；传了 dnd 才走带拖拽 hooks 的分支。 */
const TreeRow = React.memo(function TreeRow(props: TreeRowProps) {
  return props.dndEnabled ? <DraggableTreeRow {...props} /> : <PlainTreeRow {...props} />
})

function PlainTreeRow(props: TreeRowProps) {
  const { registerNode } = props.actions
  const id = props.row.node.id
  const setNodeRef = React.useCallback((element: HTMLElement | null) => registerNode(id, element), [registerNode, id])
  return <TreeRowView {...props} setNodeRef={setNodeRef} />
}

function DraggableTreeRow(props: TreeRowProps) {
  const { row, dndPositions, actions } = props
  const { node, hasChildren, expanded } = row
  const { registerNode, onInsertionChange, onAutoExpand, canAcceptDrop } = actions
  const autoExpandTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const dragHandle = useDragHandle({ id: node.id, data: { node }, disabled: node.disabled })
  const dropTarget = useDropTarget({
    id: node.id,
    data: { node },
    positions: dndPositions,
    accepts: dragged => {
      const dragNode = (dragged.data.current as { node?: TreeNode } | undefined)?.node
      return !!dragNode && canAcceptDrop(dragNode, node)
    },
  })

  React.useEffect(() => { onInsertionChange(node.id, dropTarget.insertion) }, [dropTarget.insertion, onInsertionChange, node.id])

  React.useEffect(() => {
    if (dropTarget.isOver && !dropTarget.isInvalid && hasChildren && !expanded) {
      autoExpandTimer.current = setTimeout(() => onAutoExpand(node.id), 600)
    }
    return () => clearTimeout(autoExpandTimer.current)
  }, [dropTarget.isOver, dropTarget.isInvalid, hasChildren, expanded, onAutoExpand, node.id])

  const dragSetNodeRef = dragHandle.setNodeRef
  const dropSetNodeRef = dropTarget.setNodeRef
  const setNodeRef = React.useCallback((element: HTMLElement | null) => {
    registerNode(node.id, element)
    dragSetNodeRef(element)
    dropSetNodeRef(element)
  }, [registerNode, node.id, dragSetNodeRef, dropSetNodeRef])

  const dnd: RowDnd = {
    setActivatorNodeRef: dragHandle.setActivatorNodeRef,
    attributes: dragHandle.attributes,
    listeners: dragHandle.listeners,
    dropProps: dropTarget.dropProps,
  }
  return <TreeRowView {...props} setNodeRef={setNodeRef} dnd={dnd} />
}

function TreeRowView({
  treeId, row, rtl, indent, indentGuides, rowHeight, virtualStart, virtualSize, active, selected, loading, loadError,
  renaming, renameValue, renameError, onRenameValueChange, actions, copy, renderRow, setNodeRef, dnd,
}: TreeRowProps & { setNodeRef: (element: HTMLElement | null) => void; dnd?: RowDnd }) {
  const { node, depth, hasChildren, expanded, posinset, setsize } = row
  const { onClick, onDoubleClick, onToggleExpand, onRetry, onRenameCommit, onRenameCancel } = actions
  const renameInputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => { if (renaming) { renameInputRef.current?.focus(); renameInputRef.current?.select() } }, [renaming])

  const rowId = `${treeId}-${node.id}`
  const inset = depth * indent + 6
  const virtualStyle: React.CSSProperties | undefined = virtualStart === undefined ? undefined
    : { position: "absolute", insetInlineStart: 0, insetInlineEnd: 0, top: 0, transform: `translateY(${virtualStart}px)`, height: virtualSize }

  const context: TreeRowContext = { node, depth, expanded, hasChildren, selected, active, loading }

  return <div
    id={rowId}
    ref={setNodeRef}
    role="treeitem"
    aria-level={depth + 1}
    aria-posinset={posinset}
    aria-setsize={setsize}
    aria-expanded={hasChildren ? expanded : undefined}
    aria-selected={selected}
    aria-disabled={node.disabled || undefined}
    data-active={active || undefined}
    data-depth={depth}
    data-loading={loading || undefined}
    {...dnd?.dropProps}
    style={{ height: rowHeight, paddingInlineStart: inset, ...virtualStyle }}
    className={cn(
      "group/tree-row relative flex cursor-default select-none items-center gap-(--space-xs) rounded-sm pe-(--space-md) text-foreground",
      selected ? "bg-(--state-selected) text-(--state-selected-foreground)" : "hover:bg-(--state-hover)",
      node.disabled && "pointer-events-none opacity-(--state-disabled-opacity)",
    )}
    onClick={event => onClick(node.id, event)}
    onDoubleClick={() => onDoubleClick(node.id)}
  >

    {indentGuides && Array.from({ length: depth }, (_, level) => (
      <span key={level} aria-hidden="true" className="absolute top-0 bottom-0 w-0 border-s border-line" style={{ insetInlineStart: level * indent + 6 }} />
    ))}

    {dnd && <button
      type="button"
      aria-label={copy.dragHandle(textOf(node.label))}
      className="flex size-3.5 shrink-0 cursor-grab touch-none items-center justify-center text-muted-foreground/0 group-hover/tree-row:text-muted-foreground/60 active:cursor-grabbing"
      ref={dnd.setActivatorNodeRef}
      {...dnd.attributes}
      {...dnd.listeners}
      tabIndex={active ? 0 : -1}
      onClick={event => event.stopPropagation()}
    ><svg viewBox="0 0 16 16" width="10" height="10" fill="currentColor" aria-hidden="true"><circle cx="5" cy="4" r="1.1" /><circle cx="5" cy="8" r="1.1" /><circle cx="5" cy="12" r="1.1" /><circle cx="11" cy="4" r="1.1" /><circle cx="11" cy="8" r="1.1" /><circle cx="11" cy="12" r="1.1" /></svg></button>}

    {loading ? <Spinner decorative className="size-3 shrink-0" /> : hasChildren ? (
      <button
        type="button"
        tabIndex={-1}
        aria-label={expanded ? copy.collapse : copy.expand}
        onClick={event => { event.stopPropagation(); onToggleExpand(node.id) }}
        className="flex size-3.5 shrink-0 items-center justify-center text-muted-foreground"
      ><ChevronRight aria-hidden="true" className={cn("size-3 transition-transform duration-(--motion-quick-in) ease-(--motion-ease)", expanded && "rotate-90", rtl && !expanded && "rotate-180")} /></button>
    ) : <span className="size-3.5 shrink-0" aria-hidden="true" />}

    {loadError !== undefined ? (
      <span className="flex min-w-0 flex-1 items-center gap-(--space-sm)">
        {node.icon && <span className="flex size-3.5 shrink-0 items-center justify-center text-muted-foreground [&_svg]:size-3.5">{node.icon}</span>}
        <span className="min-w-0 flex-1 truncate">{node.label}</span>
        <span className="shrink-0 truncate text-destructive">{copy.loadError}</span>
        <button type="button" onClick={event => { event.stopPropagation(); onRetry(node.id) }} className="inline-flex shrink-0 items-center gap-1 text-destructive underline underline-offset-2"><RotateCcw aria-hidden="true" className="size-3" />{copy.retry}</button>
      </span>
    ) : renaming ? (
      <span className="flex min-w-0 flex-1 flex-col">
        <input
          ref={renameInputRef}
          data-slot="input"
          aria-label={copy.rename}
          aria-invalid={!!renameError}
          value={renameValue}
          onClick={event => event.stopPropagation()}
          onChange={event => onRenameValueChange(event.target.value)}
          onKeyDown={event => {
            event.stopPropagation()
            if (event.key === "Enter") { event.preventDefault(); onRenameCommit(node.id) }
            else if (event.key === "Escape") { event.preventDefault(); onRenameCancel() }
          }}
          onBlur={() => onRenameCommit(node.id)}
          className={cn(inputSurface, "h-(--size-control-xs) px-1 text-small")}
        />
        {renameError && <span role="alert" className="mt-0.5 text-caption text-destructive">{renameError}</span>}
      </span>
    ) : renderRow ? renderRow(context) : <>
      {node.icon && <span className="flex size-3.5 shrink-0 items-center justify-center text-muted-foreground [&_svg]:size-3.5">{node.icon}</span>}
      <span className="min-w-0 flex-1 truncate">{node.label}</span>
    </>}
  </div>
}

export { Tree }
