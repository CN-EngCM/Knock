import * as React from "react"
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useDndContext,
  useDndMonitor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type Active,
  type Announcements,
  type DndContextProps,
  type DragCancelEvent,
  type DragMoveEvent,
  type DragEndEvent,
  type DragStartEvent,
  type KeyboardCoordinateGetter,
  type ScreenReaderInstructions,
  type UniqueIdentifier,
} from "@dnd-kit/core"
import { cn } from "@/lib/utils"
import { prefersReducedMotion } from "@/lib/scroll"

type DropState = "over" | "invalid"
type Insertion = "before" | "after" | "inside"

export interface DragLabels {
  /** 屏幕阅读器在元素获得拖拽焦点时朗读的操作说明。 */
  instructions: string
  onDragStart: (args: { active: Active }) => string
  onDragOver: (args: { active: Active; over: { id: UniqueIdentifier } | null }) => string
  onDragEnd: (args: { active: Active; over: { id: UniqueIdentifier } | null }) => string
  onDragCancel: (args: { active: Active }) => string
}

const defaultLabels: DragLabels = {
  instructions: "按空格键或回车键拾起可拖拽项；拾起后用方向键移动，再次按空格键放下，按 Esc 取消。",
  onDragStart: ({ active }) => `已拾起可拖拽项 ${active.id}。`,
  onDragOver: ({ active, over }) => over ? `${active.id} 移动到 ${over.id} 上方。` : `${active.id} 不在任何投放区上方。`,
  onDragEnd: ({ active, over }) => over ? `${active.id} 已放下到 ${over.id}。` : `${active.id} 已放下，未命中投放区。`,
  onDragCancel: ({ active }) => `已取消拖拽 ${active.id}。`,
}

// 传感器选项必须引用稳定：dnd-kit 的 useSensor 以 [sensor, options] 为 memo 依赖，每次渲染传新对象会让
// DndContext 的 activators 变化，进而让所有 useDraggable/useDroppable 消费者（如 Tree 的行）绕过自身 memo 重渲染。
const pointerSensorOptions = { activationConstraint: { distance: 4 } }

export interface DragProviderProps extends Pick<DndContextProps, "onDragStart" | "onDragEnd" | "onDragCancel" | "onDragOver" | "onDragMove" | "modifiers" | "collisionDetection"> {
  children: React.ReactNode
  labels?: Partial<DragLabels>
  /** 拖到视口边缘时自动滚动，默认开启。 */
  autoScroll?: boolean
  /**
   * 键盘拖拽坐标计算。省略时用 dnd-kit KeyboardSensor 自带的（方向键每次移动固定像素），
   * 本文件因此不依赖 `@dnd-kit/sortable`。用 SortableContext/useSortable 排序时传它的
   * `sortableKeyboardCoordinates`，方向键才会逐项跳到相邻条目；它基于矩形过滤 + closestCorners
   * 猜测方向，不接 SortableContext 的小行高列表上不可靠，Tree 用自己的 coordinateGetter（见 tree.tsx）。
   */
  coordinateGetter?: KeyboardCoordinateGetter
}

/**
 * 应用内拖拽的统一入口：预置指针（4px 激活距离，不抢单击/行选择）与键盘传感器、
 * 中文屏幕阅读器播报，并用 closestCenter 做碰撞检测。dockview-react 用 createPortal
 * 挂载面板内容，单个 Provider 放在 DockLayout 外层即可覆盖全部面板。
 */
function DragProvider({ children, labels, autoScroll = true, collisionDetection = closestCenter, coordinateGetter, ...props }: DragProviderProps) {
  const keyboardSensorOptions = React.useMemo(() => ({ coordinateGetter }), [coordinateGetter])
  const pointerSensor = useSensor(PointerSensor, pointerSensorOptions)
  const keyboardSensor = useSensor(KeyboardSensor, keyboardSensorOptions)
  const sensors = useSensors(pointerSensor, keyboardSensor)

  // labels 常是调用方的内联对象：播报函数经 ref 读取最新文案，accessibility 对象本身只随说明文字变化。
  const copy = { ...defaultLabels, ...labels }
  const copyRef = React.useRef(copy)
  copyRef.current = copy
  const instructions = copy.instructions
  const accessibility = React.useMemo(() => {
    const screenReaderInstructions: ScreenReaderInstructions = { draggable: instructions }
    const announcements: Announcements = {
      onDragStart: ({ active }) => copyRef.current.onDragStart({ active }),
      onDragOver: ({ active, over }) => copyRef.current.onDragOver({ active, over }),
      onDragEnd: ({ active, over }) => copyRef.current.onDragEnd({ active, over }),
      onDragCancel: ({ active }) => copyRef.current.onDragCancel({ active }),
    }
    return { announcements, screenReaderInstructions }
  }, [instructions])

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      autoScroll={autoScroll}
      accessibility={accessibility}
      {...props}
    >
      {children}
    </DndContext>
  )
}

export interface UseDragHandleOptions {
  id: UniqueIdentifier
  data?: Record<string, unknown>
  disabled?: boolean
}

export interface UseDragHandleResult {
  attributes: ReturnType<typeof useDraggable>["attributes"]
  listeners: ReturnType<typeof useDraggable>["listeners"]
  /** 绑定到被拖拽的行/卡片本身。 */
  setNodeRef: (element: HTMLElement | null) => void
  /** 只想让把手（而非整行）响应指针/键盘拾取时，绑定到把手元素。 */
  setActivatorNodeRef: (element: HTMLElement | null) => void
  isDragging: boolean
}

/** 拖拽把手：指针与键盘路径等效，isDragging 时调用方通常把原节点调暗或隐藏，交给 DragPreview 顶替视觉。 */
function useDragHandle({ id, data, disabled }: UseDragHandleOptions): UseDragHandleResult {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({ id, data, disabled })
  return { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging }
}

export interface UseDropTargetOptions {
  id: UniqueIdentifier
  data?: Record<string, unknown>
  disabled?: boolean
  /** 返回 false 时该目标进入 invalid 展示态且不计入 insertion 计算。 */
  accepts?: (active: Active) => boolean
  /** 支持的投放位置；省略时只产生 "inside"（整体高亮，不画插入线）。 */
  positions?: readonly Insertion[]
}

export interface UseDropTargetResult {
  setNodeRef: (element: HTMLElement | null) => void
  isOver: boolean
  isInvalid: boolean
  insertion: Insertion | null
  /** 直接展开到投放目标节点上：data-drop-state / data-insertion，驱动 src/index.css 里的通用样式。 */
  dropProps: { "data-drop-state"?: DropState; "data-insertion"?: Insertion }
}

/**
 * 投放区：悬停与非法态通过 data-drop-state 暴露，插入位置通过 data-insertion 暴露，
 * 具体颜色和插入线样式统一在 src/index.css 里维护，组件内不写死颜色。
 * before/after 由拖拽项当前中心点相对本目标中心点的位置实时计算。
 */
function useDropTarget({ id, data, disabled, accepts, positions = ["inside"] }: UseDropTargetOptions): UseDropTargetResult {
  // active 取自 useDroppable：它读的是 dnd-kit 内部上下文，只在 active/over 变化时更新；
  // 公共的 useDndContext 依赖 collisions，每次指针移动都是新值，会让所有投放区跟着重渲染。
  const { setNodeRef, isOver, rect, active } = useDroppable({ id, data, disabled })
  const [insertion, setInsertion] = React.useState<Insertion | null>(null)
  const acceptsRef = React.useRef(accepts)
  acceptsRef.current = accepts
  const positionsRef = React.useRef(positions)
  positionsRef.current = positions

  // 监听器保持稳定：useDndMonitor 以对象引用为依赖，每次渲染新建会反复退订/订阅。
  const monitor = React.useMemo(() => ({
    onDragMove(event: DragMoveEvent) {
      if (event.over?.id !== id) return
      const available = positionsRef.current
      const targetRect = rect.current
      const activeRect = event.active.rect.current.translated
      if (available.length <= 1 || !targetRect || !activeRect) {
        setInsertion(available[0] ?? "inside")
        return
      }
      const beforeAfter = available.filter(position => position !== "inside")
      if (beforeAfter.length < 2) {
        setInsertion(available.includes("inside") ? "inside" : (beforeAfter[0] ?? null))
        return
      }
      const activeCenter = activeRect.top + activeRect.height / 2
      const targetCenter = targetRect.top + targetRect.height / 2
      setInsertion(activeCenter < targetCenter ? "before" : "after")
    },
    onDragEnd() { setInsertion(null) },
    onDragCancel() { setInsertion(null) },
  }), [id, rect])
  useDndMonitor(monitor)

  const isInvalid = isOver && !!active && !!acceptsRef.current && !acceptsRef.current(active)
  const resolvedOver = isOver && !isInvalid
  const resolvedInsertion = resolvedOver ? insertion : null

  return {
    setNodeRef,
    isOver: resolvedOver,
    isInvalid,
    insertion: resolvedInsertion,
    dropProps: {
      "data-drop-state": isInvalid ? "invalid" : resolvedOver ? "over" : undefined,
      "data-insertion": resolvedInsertion ?? undefined,
    },
  }
}

export interface DragPreviewProps {
  /** 当前被拖拽项的渲染内容；active 为 null 时不渲染。 */
  children: (active: Active) => React.ReactNode
  /** 多选时显示“n 项”徽标。 */
  count?: number
  className?: string
}

/** DragOverlay 的桌面质感外观：半透明行卡随指针移动，不受列表自身滚动裁剪。 */
function DragPreview({ children, count, className }: DragPreviewProps) {
  const { active } = useDndContext()
  // 拖动时每帧都会渲染：减少动效偏好只在拖拽开始时读一次，不在每帧调 matchMedia。
  const [reduceMotion, setReduceMotion] = React.useState(false)
  const monitor = React.useMemo(() => ({ onDragStart() { setReduceMotion(prefersReducedMotion()) } }), [])
  useDndMonitor(monitor)
  return (
    <DragOverlay dropAnimation={reduceMotion ? null : undefined}>
      {active ? (
        <div
          data-slot="drag-preview"
          className={cn(
            "relative flex max-w-sm cursor-grabbing items-center gap-2 rounded-md border border-border bg-popover/90 px-2 py-1.5 text-xs text-popover-foreground shadow-overlay backdrop-blur-sm",
            className,
          )}
        >
          {children(active)}
          {count !== undefined && count > 1 && (
            <span
              data-slot="drag-preview-count"
              className="absolute -top-1.5 -end-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-caption font-medium text-primary-foreground"
            >
              {count} 项
            </span>
          )}
        </div>
      ) : null}
    </DragOverlay>
  )
}

export { DragProvider, useDragHandle, useDropTarget, DragPreview }
export type { Insertion, DropState, DragStartEvent, DragEndEvent, DragCancelEvent }
