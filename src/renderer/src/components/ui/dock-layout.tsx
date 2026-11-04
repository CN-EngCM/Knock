import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type FunctionComponent } from "react"
import { Pin, X } from "lucide-react"
import { DockviewReact, type IDockviewReactProps } from "dockview-react"
import type {
  BuiltInContextMenuItem,
  DockviewApi,
  DockviewGroupPanel,
  DockviewHeaderPosition,
  DockviewTheme,
  GetTabContextMenuItemsParams,
  IDockviewPanelHeaderProps,
  IWatermarkPanelProps,
  ReactContextMenuItemConfig,
} from "dockview-react"
import { cn } from "@/lib/utils"
import "dockview-react/dist/styles/dockview.css"
import "./dock-layout.css"

export type {
  BuiltInContextMenuItem,
  DockviewApi,
  DockviewDidDropEvent,
  DockviewGroupPanel,
  DockviewHeaderPosition,
  DockviewReadyEvent,
  DockviewTheme,
  DockviewWillDropEvent,
  FloatingGroupOptions,
  GetTabContextMenuItemsParams,
  IWatermarkPanelProps,
  IDockviewHeaderActionsProps,
  IDockviewPanelHeaderProps,
  IDockviewPanelProps,
  ReactContextMenuItemConfig,
  SerializedDockview,
} from "dockview-react"

/** GaN.UI 暗色停靠皮肤：gan-surface-dark 在局部作用域提供暗色令牌 */
export const ganDockviewThemeDark: DockviewTheme = {
  name: "gan-dark",
  className: "gan-dockview gan-dockview-dark gan-surface-dark",
  colorScheme: "dark",
}

/** GaN.UI 浅色停靠皮肤：gan-surface-light 在局部作用域提供浅色令牌 */
export const ganDockviewThemeLight: DockviewTheme = {
  name: "gan-light",
  className: "gan-dockview gan-dockview-light gan-surface-light",
  colorScheme: "light",
}

/** 标签栏位置变化事件；标签栏方向属于组，不触发官方通用布局事件 */
export interface DockLayoutHeaderPositionChangeEvent {
  groupId: string
  position: DockviewHeaderPosition
}

/** 读取应用当前外观；通过监听根元素 class 变化即时响应切换 */
function useApplicationDark(): boolean {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"))
  useEffect(() => {
    const root = document.documentElement
    const update = () => setDark(root.classList.contains("dark"))
    const observer = new MutationObserver(update)
    observer.observe(root, { attributes: true, attributeFilter: ["class"] })
    return () => observer.disconnect()
  }, [])
  return dark
}

function usePanelTitle(api: IDockviewPanelHeaderProps["api"]): string {
  const [title, setTitle] = useState(() => api.title ?? "")
  useEffect(() => {
    const disposable = api.onDidTitleChange(event => setTitle(event.title))
    setTitle(api.title ?? "")
    return () => disposable.dispose()
  }, [api])
  return title
}

const PanelLockContext = createContext<{
  lockedPanels: ReadonlySet<string>
  toggle(id: string): void
} | null>(null)

/** 菜单项的 DOM 标识只需在页面内唯一，用于 aria-activedescendant 指向当前项 */
let menuSeq = 0

/** 固定状态标记：只在固定时出现，不可点击；固定与取消固定走标签右键菜单 */
function PanelLockMark({ id }: { id: string }) {
  const locks = useContext(PanelLockContext)
  if (!locks?.lockedPanels.has(id)) return null
  return <span className="gan-panel-lock" role="img" aria-label="已固定" title="已固定"><Pin aria-hidden="true" /></span>
}

/**
 * 默认标签：标题、固定状态标记与关闭按钮，继承官方标签的显隐与焦点行为。
 * 关闭按钮是真实按钮，提供中文可访问名与键盘激活；中键点击标签关闭；
 * 固定与取消固定在标签右键菜单里，标签上只在固定时显示一个不可点击的图钉。
 */
export function GanDockviewTab({ api }: IDockviewPanelHeaderProps) {
  const title = usePanelTitle(api)
  const locks = useContext(PanelLockContext)
  const middleButtonPressed = useRef(false)
  const closePanel = (event: { preventDefault(): void }) => {
    event.preventDefault()
    api.close()
  }
  return (
    <div
      className="dv-default-tab"
      onPointerDownCapture={event => {
        if (event.button === 1 && locks?.lockedPanels.has(api.id) && !(event.target as Element).closest("button")) {
          middleButtonPressed.current = true
          event.preventDefault()
          event.stopPropagation()
        }
      }}
      onPointerDown={event => { middleButtonPressed.current = event.button === 1 }}
      onPointerUp={event => {
        if (middleButtonPressed.current && event.button === 1) closePanel(event)
        middleButtonPressed.current = false
      }}
      onPointerLeave={() => { middleButtonPressed.current = false }}
    >
      <span className="dv-default-tab-content">{title}</span>
      <PanelLockMark id={api.id} />
      <button
        type="button"
        className="dv-default-tab-action gan-tab-close"
        aria-label={`关闭${title}`}
        onPointerDown={event => event.preventDefault()}
        onClick={closePanel}
      >
        <X aria-hidden="true" className="gan-tab-close-icon" />
      </button>
    </div>
  )
}

/**
 * 修改组的标签栏位置，读取实际生效值并在变化后通知调用方。
 * 右键菜单与业务侧方向选择器共用此入口，避免两套写入逻辑。
 */
export function setDockGroupHeaderPosition(
  group: DockviewGroupPanel,
  position: DockviewHeaderPosition,
  onPositionChange?: (event: DockLayoutHeaderPositionChangeEvent) => void,
): DockviewHeaderPosition {
  const before = group.api.getHeaderPosition()
  group.api.setHeaderPosition(position)
  const after = group.api.getHeaderPosition()
  if (after !== before) onPositionChange?.({ groupId: group.id, position: after })
  return after
}

/** 空白分组内容的 props：只在组内没有面板时渲染，group 必有值 */
export type DockEmptyGroupProps = IWatermarkPanelProps & { group: NonNullable<IWatermarkPanelProps["group"]> }

/**
 * 默认空白分组：组内最后一个面板关闭或移走后保留原位与原尺寸，组头随之隐藏；
 * 内容区右上角是关闭入口，位置与组标题栏关闭按钮一致。面板拖入后组头恢复。
 * 边缘组变空时由官方自动收起，不提供关闭。
 */
export function GanDockviewEmptyGroup({ group, containerApi }: DockEmptyGroupProps) {
  return (
    <div className="gan-empty-group">
      {group.api.location.type === "grid" && <button
        type="button"
        className="gan-empty-group-close"
        aria-label="关闭空白分组"
        title="关闭空白分组"
        onPointerDown={event => event.preventDefault()}
        onClick={() => containerApi.removeGroup(group)}
      ><X aria-hidden="true" className="gan-tab-close-icon" /></button>}
      <span className="gan-empty-group-title">空白分组</span>
      <span className="gan-empty-group-hint">拖入面板，或关闭此分组</span>
    </div>
  )
}

const DockSurfaceContext = createContext<{
  watermark?: IDockviewReactProps["watermarkComponent"]
  emptyGroup: FunctionComponent<DockEmptyGroupProps>
}>({ emptyGroup: GanDockviewEmptyGroup })

/** 官方用同一个水印组件渲染整个停靠区为空与单个空组两种状态，按有无 group 分派 */
function DockWatermarkHost(props: IWatermarkPanelProps) {
  const surface = useContext(DockSurfaceContext)
  if (props.group) {
    const EmptyGroup = surface.emptyGroup
    return <EmptyGroup {...props} group={props.group} />
  }
  const Watermark = surface.watermark
  return Watermark ? <Watermark {...props} /> : null
}

/** dockview-core 8.6 内部网格的最小结构；官方未导出这些类型 */
interface GridBranchInternal {
  children: readonly unknown[]
  getChildSize(index: number): number
  resizeChild(index: number, size: number): void
}

interface GridviewInternal {
  removeView(location: number[], sizing?: { type: string }): unknown
  getNode(location: number[]): [unknown[], unknown]
  hasMaximizedView(): boolean
  exitMaximizedView(): void
}

function getMainGridview(api: DockviewApi): GridviewInternal | null {
  const gridview = (api as unknown as { component?: { gridview?: Partial<GridviewInternal> } }).component?.gridview
  if (!gridview || typeof gridview.removeView !== "function" || typeof gridview.getNode !== "function") return null
  if (typeof gridview.hasMaximizedView !== "function" || typeof gridview.exitMaximizedView !== "function") return null
  return gridview as GridviewInternal
}

/**
 * 官方移除网格组时固定使用 Sizing.Distribute，同一分割内剩余的组会被重新
 * 平均分配。这里改为按原尺寸比例分配空出的空间，剩余组之间的比例保持不变。
 * 只拦截主网格的平均分配移除；浮动窗口内网格与其他尺寸策略保持官方行为。
 * 内部结构不符时不做任何改动。返回值用于还原。
 * 依赖 dockview-core 8.6.2 的内部结构，升级后重跑 tests/dock-layout.spec.ts 的空白分组用例与 tests/dock-layout-shell.spec.ts。
 */
function keepProportionsOnRemoval(api: DockviewApi): () => void {
  const gridview = getMainGridview(api)
  if (!gridview) return () => undefined
  const removeView = gridview.removeView
  gridview.removeView = (location, sizing) => {
    if (sizing?.type !== "distribute") return removeView.call(gridview, location, sizing)
    // 最大化时其他组处于隐藏状态，读到的尺寸不可用，先恢复再记录。
    if (gridview.hasMaximizedView()) gridview.exitMaximizedView()
    const index = location[location.length - 1]
    const parent = gridview.getNode(location.slice(0, -1))[1] as GridBranchInternal
    const sizes = parent.children.map((_, childIndex) => parent.getChildSize(childIndex))
    // 不传尺寸策略：空出的空间先整体落到末位子节点，其余子节点保持原尺寸。
    // 只剩两个子节点时父分割会并入上层，剩下的一个占满原位置，上层尺寸由官方逐项还原。
    const result = removeView.call(gridview, location)
    const removedSize = sizes.splice(index, 1)[0]
    const last = sizes.length - 1
    if (sizes.length < 2) return result
    const remaining = sizes.reduce((sum, size) => sum + size, 0)
    if (remaining <= 0) return result
    const scale = (remaining + removedSize) / remaining
    // resizeChild 优先从末位子节点取用差额。此时空出的空间都在末位，依次把前面的
    // 子节点放大到目标，所需空间都从末位的余量中取回，末位最后恰好落在目标上。
    for (let childIndex = 0; childIndex < last; childIndex++) {
      parent.resizeChild(childIndex, Math.round(sizes[childIndex] * scale))
    }
    return result
  }
  return () => { gridview.removeView = removeView }
}

/** 标签右键菜单的一项：官方内置项名称、分隔线，或自定义项 */
export type DockLayoutTabMenuItem = BuiltInContextMenuItem | ReactContextMenuItemConfig
type TabMenuItem = DockLayoutTabMenuItem

/** `extendTabContextMenu` 的上下文 */
export interface DockLayoutTabMenuContext {
  /** 面板是否已固定；读取的是实时状态，返回的函数引用稳定，可以保存起来在菜单之外查询 */
  isPanelLocked(panelId: string): boolean
}

/** 关闭当前组内的目标快照；逐个确认面板仍存在，避免批量关闭时操作已释放对象 */
function closePanels(api: DockviewApi, panels: readonly { id: string; api: { close(): void } }[]) {
  for (const panel of panels) if (api.getPanel(panel.id)) panel.api.close()
}

function buildDefaultTabMenu(
  params: GetTabContextMenuItemsParams,
  isLocked: (panelId: string) => boolean,
  toggleLock: (panelId: string) => void,
  onHeaderPositionChange?: (event: DockLayoutHeaderPositionChangeEvent) => void,
): TabMenuItem[] {
  const { panel, group, api } = params
  const panels = group.panels
  const index = panels.indexOf(panel)
  const currentPosition = group.api.getHeaderPosition()
  const verticalHeader = currentPosition === "left" || currentPosition === "right"
  const isGridGroup = group.api.location.type === "grid"
  // 边缘组的标签栏方向由其边缘位置决定（左／右边缘是纵向标签栏），
  // 允许改成其他方向会让收起窄条与边缘槽位错位，菜单不提供该动作。
  const isEdgeGroup = group.api.location.type === "edge"
  const maximized = panel.api.isMaximized()
  const locked = isLocked(panel.id)
  const floatDisabled = locked || panel.api.location.type !== "grid"
  const positions: Array<{ position: DockviewHeaderPosition; label: string }> = [
    { position: "top", label: "标签栏置顶" },
    { position: "bottom", label: "标签栏置底" },
    { position: "left", label: "标签栏置左" },
    { position: "right", label: "标签栏置右" },
  ]
  return [
    { label: "关闭", action: () => panel.api.close() },
    {
      label: "关闭其他标签",
      action: () => closePanels(api, panels.filter(item => item !== panel)),
      disabled: panels.length <= 1,
    },
    {
      label: verticalHeader ? "关闭上方标签" : "关闭左侧标签",
      action: () => closePanels(api, panels.filter((_, itemIndex) => itemIndex < index)),
      disabled: index <= 0,
    },
    {
      label: verticalHeader ? "关闭下方标签" : "关闭右侧标签",
      action: () => closePanels(api, panels.filter((_, itemIndex) => itemIndex > index)),
      disabled: index === -1 || index >= panels.length - 1,
    },
    { label: "关闭此组全部标签", action: () => closePanels(api, panels) },
    "separator",
    {
      label: locked ? "取消固定此面板" : "固定此面板",
      action: () => toggleLock(panel.id),
    },
    {
      label: maximized ? "恢复最大化" : "最大化",
      action: () => { if (maximized) panel.api.exitMaximized(); else panel.api.maximize() },
      disabled: !maximized && !isGridGroup,
    },
    {
      label: "浮动此面板",
      action: () => api.addFloatingGroup(panel),
      disabled: floatDisabled,
    },
    "separator",
    ...positions.map(({ position, label }): TabMenuItem => ({
      label: currentPosition === position ? `${label}（当前）` : label,
      action: () => setDockGroupHeaderPosition(group, position, onHeaderPositionChange),
      disabled: isEdgeGroup || currentPosition === position,
    })),
  ]
}

export type DockLayoutProps = IDockviewReactProps & {
  /** 标签栏位置在实际改变后触发；工作台等宿主用它安排布局保存 */
  onHeaderPositionChange?: (event: DockLayoutHeaderPositionChangeEvent) => void
  /**
   * 组头显隐谓词：返回 true 的组隐藏整条标签栏（如只剩占位面板的空态组）。
   * 官方 `group.header.hidden` 是组上的持久属性，面板经拖放、拆分并入后不会自动复位；
   * 本组件在每次布局与面板变化后按谓词重新校准，谓词需是纯函数；网格中的空组无论谓词如何都隐藏组头。
   * 边缘组同样会传入谓词，不希望隐藏时用 `group.api.location.type === "edge"` 返回 false。
   */
  hideGroupHeader?: (group: DockviewGroupPanel) => boolean
  /**
   * 圆角（像素，默认 0）。
   * - 标签：只圆朝外的两个角，贴着内容的两个角保持直角；有没有组间距都生效。
   * - 组（含工作台侧栏组）：四个角都圆，面板内容的角被裁掉，只在 `groupGap > 0` 时生效，没有缝时组保持直角。
   * - 浮动窗口：四个角都圆（外框、标题栏、内部组），有没有组间距都生效。
   * - 拖放落点高亮框跟着组的圆角走；右键菜单、隐藏标签列表、工作台落点方块保持各自的小圆角。
   * 写入停靠区外层容器的 `--dock-radius`；不传时也可以直接在样式里给 `.gan-dockview` 或其祖先设置该变量。
   */
  cornerRadius?: number
  /**
   * 组与组之间的间距（像素，默认 0，负数按 0 处理）。大于 0 时组之间露出 `--dock-gap` 颜色的缝，
   * 最外圈的组与停靠区边缘之间也留同宽的缝；静止分隔线由缝取代，分割条的悬停与拖动高亮仍显示在缝里；
   * 每个组带一圈 1px 淡色边框（`--dock-group-border`），活动组仍只靠活动标签上的主色线标记。
   * 浮动窗口内部、工作台侧栏沿用同一个间距。间距参与布局计算，只能通过本属性设置，
   * 不能只靠样式改（直接改 CSS 变量不会重新布局）。不传时沿用传入 `theme` 里的 `gap`（内置皮肤为 0）。
   */
  groupGap?: number
  /**
   * 移除网格组时是否按原尺寸比例分配空出的空间（默认 true）。
   * 官方固定把空间在同一分割内的剩余组之间平均分配，本组件默认改为按比例；
   * 宿主自己负责移除后的尺寸时（如 DockWorkbench 在优先级可用时）传 false，
   * 避免先比例重分、再被宿主覆盖的重复布局。传 false 即官方行为，运行期变化会即时安装或还原。
   */
  keepProportionsOnGroupRemoval?: boolean
  /**
   * 标签右键菜单的二次加工：每次弹出菜单前，收到当前菜单项（默认菜单，或 `getTabContextMenuItems` 的返回值）
   * 与被右键的标签，返回最终菜单项。用来在默认菜单上追加或删减，不必整份重写；
   * 基础菜单为空数组（调用方用它关闭菜单）时不会调用，保持无菜单。工作台用它追加「自动收起此组」。
   * 返回空数组则不弹出菜单。
   */
  extendTabContextMenu?: (items: DockLayoutTabMenuItem[], params: GetTabContextMenuItemsParams, context: DockLayoutTabMenuContext) => DockLayoutTabMenuItem[]
  /** 空白分组的内容，默认 GanDockviewEmptyGroup（提示与关闭入口） */
  emptyGroupComponent?: FunctionComponent<DockEmptyGroupProps>
  /**
   * 双击浮动窗口标题栏时的停靠目标。参数为浮动组与它浮出前所在的网格组（原组已不存在时为 undefined），
   * 返回要并入的网格组；返回 undefined 时使用默认目标：原组 → 第一个可见网格组 → 新建网格组。
   * 浮动组含固定面板时不响应双击。工作台等宿主用它把目标收窄到面板原属区域。
   */
  resolveFloatingDockTarget?: (floating: DockviewGroupPanel, originGroup: DockviewGroupPanel | undefined) => DockviewGroupPanel | undefined
}

/**
 * 停靠工作区容器，封装 DockviewReact 的统一主题与容器约束。
 * 面板内容、onReady 初始化与事件用法保持官方 API；父容器需提供明确高度。
 * 未传 theme 时跟随应用外观并在切换时即时更新；默认标签、中文右键菜单与
 * 溢出列表可访问名称使用 GaN.UI 约定，均可通过同名 props 覆盖。
 * 单面板组沿用官方紧凑单标签（`singleTabMode` 默认 "default"），外观与多面板组一致；
 * 标签栏在上方时（含浮动窗口）单个标签铺满整行。圆角由 `cornerRadius` 设置、组间距由 `groupGap` 设置，默认都是 0（直角、无缝）。
 * 组内最后一个面板关闭或移走后组保留为空白分组（`closeEmptyGroups` 默认 false），
 * 其他组尺寸不变；空白分组被主动关闭时，空间按比例分给同一分割内的其余组。
 */
export function DockLayout({
  theme,
  dndStrategy = "pointer",
  defaultTabComponent = GanDockviewTab,
  getTabContextMenuItems,
  extendTabContextMenu,
  onHeaderPositionChange,
  hideGroupHeader,
  cornerRadius,
  groupGap,
  keepProportionsOnGroupRemoval = true,
  closeEmptyGroups = false,
  watermarkComponent,
  emptyGroupComponent = GanDockviewEmptyGroup,
  resolveFloatingDockTarget,
  className,
  onReady,
  ...props
}: DockLayoutProps) {
  const applicationDark = useApplicationDark()
  const baseTheme = theme ?? (applicationDark ? ganDockviewThemeDark : ganDockviewThemeLight)
  // 间距交给官方主题的 gap：它同时写进主网格、浮动窗口内部网格与边缘组（工作台侧栏）。
  // 合并后的主题对象保持引用稳定，避免每次渲染都触发官方 updateTheme。
  const effectiveGap = Math.max(0, groupGap ?? baseTheme.gap ?? 0) || 0
  const resolvedTheme = useMemo<DockviewTheme>(
    () => baseTheme.gap === effectiveGap ? baseTheme : { ...baseTheme, gap: effectiveGap },
    [baseTheme, effectiveGap],
  )
  const rootRef = useRef<HTMLDivElement>(null)
  const [api, setApi] = useState<DockviewApi | null>(null)
  const [lockedPanels, setLockedPanels] = useState<ReadonlySet<string>>(() => new Set())
  const lockedPanelsRef = useRef(lockedPanels)
  const headerPositionCallbackRef = useRef(onHeaderPositionChange)
  headerPositionCallbackRef.current = onHeaderPositionChange
  const headerPositionsRef = useRef(new Map<string, DockviewHeaderPosition>())
  const hideGroupHeaderRef = useRef(hideGroupHeader)
  hideGroupHeaderRef.current = hideGroupHeader
  const contextMenuPanelRef = useRef<string | null>(null)
  // 标签栏方向变化不一定触发布局事件，方向观察器据此通知覆盖层圆角重新计算
  const overlayCornersRef = useRef<(() => void) | null>(null)
  const resolveFloatingDockTargetRef = useRef(resolveFloatingDockTarget)
  resolveFloatingDockTargetRef.current = resolveFloatingDockTarget
  const toggle = useCallback((id: string) => {
    const next = new Set(lockedPanelsRef.current)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    lockedPanelsRef.current = next
    setLockedPanels(next)
  }, [])

  const notifyHeaderPosition = useCallback((event: DockLayoutHeaderPositionChangeEvent) => {
    if (headerPositionsRef.current.get(event.groupId) === event.position) return
    headerPositionsRef.current.set(event.groupId, event.position)
    headerPositionCallbackRef.current?.(event)
  }, [])

  const defaultTabMenu = useCallback((params: GetTabContextMenuItemsParams) => {
    return buildDefaultTabMenu(params, id => lockedPanelsRef.current.has(id), toggle, notifyHeaderPosition)
  }, [notifyHeaderPosition, toggle])

  // 调用方菜单完整覆盖默认项；只有真的会弹出菜单时才记录被右键的标签，
  // 供关闭菜单后回焦。返回空数组抑制菜单时不能留下错误的回焦目标。
  const extendTabContextMenuRef = useRef(extendTabContextMenu)
  extendTabContextMenuRef.current = extendTabContextMenu
  const menuContext = useMemo<DockLayoutTabMenuContext>(() => ({ isPanelLocked: id => lockedPanelsRef.current.has(id) }), [])
  const resolveTabMenu = useCallback((params: GetTabContextMenuItemsParams) => {
    const base = getTabContextMenuItems ? getTabContextMenuItems(params) : defaultTabMenu(params)
    const extend = extendTabContextMenuRef.current
    const items = extend && base.length > 0 ? extend(base, params, menuContext) : base
    if (items.length > 0) contextMenuPanelRef.current = params.panel.id
    return items
  }, [defaultTabMenu, getTabContextMenuItems, menuContext])

  useEffect(() => {
    if (!api) return
    const subscriptions = [
      api.onWillDragPanel(event => {
        if (lockedPanelsRef.current.has(event.panel.id)) event.nativeEvent.preventDefault()
      }),
      api.onWillDragGroup(event => {
        if (event.group.panels.some(panel => lockedPanelsRef.current.has(panel.id))) event.nativeEvent.preventDefault()
      }),
      api.onDidRemovePanel(panel => {
        if (lockedPanelsRef.current.has(panel.id)) toggle(panel.id)
      }),
    ]
    // 在拖动识别前拦截固定面板，也覆盖浮动窗口的独立移动手势。
    const preventLockedDrag = (event: PointerEvent) => {
      if (!(event.target instanceof Element)) return
      const target = event.target
      if (target.closest(".gan-panel-lock")) {
        event.preventDefault()
        event.stopPropagation()
        return
      }
      const floating = target.closest(".dv-resize-container")
      const floatingHasPinnedPanel = () => floating && api.groups.some(group =>
        floating.contains(group.element) && group.panels.some(panel => lockedPanelsRef.current.has(panel.id)),
      )
      if (target.closest("button, input, textarea, select, a")) {
        if (event.shiftKey && floatingHasPinnedPanel()) event.stopPropagation()
        return
      }
      const tab = target.closest<HTMLElement>(".dv-tab")
      const panelId = tab?.dataset.tabPanelId
      const pinnedTab = panelId && lockedPanelsRef.current.has(panelId)
      // 默认标签自行接收中键关闭，同时在捕获阶段阻止拖动源启动。
      if (pinnedTab && event.button === 1 && target.closest(".dv-default-tab")) return
      const handle = target.closest(".dv-void-container, .dv-floating-titlebar")
      const pinnedGroup = !tab && (handle || (floating && event.shiftKey)) && api.groups.some(group =>
        (floating ? floating.contains(group.element) : group.element.contains(target)) &&
        group.panels.some(panel => lockedPanelsRef.current.has(panel.id)),
      )
      if (!pinnedTab && !pinnedGroup) return
      event.preventDefault()
      event.stopPropagation()
      if (pinnedTab && event.button === 0) {
        api.getPanel(panelId)?.api.setActive()
        tab?.focus({ preventScroll: true })
      }
    }
    const root = rootRef.current
    root?.addEventListener("pointerdown", preventLockedDrag, true)
    return () => {
      subscriptions.forEach(subscription => subscription.dispose())
      root?.removeEventListener("pointerdown", preventLockedDrag, true)
    }
  }, [api, toggle])

  // 每个组（含浮动组）是一个“面板”，`src/lib/panel-focus.ts` 据此让非活动组里的选中降为中性色。
  // 属性写在 dockview 的组元素上，通用跟踪器因此不需要认识 `.dv-*` 选择器。
  useEffect(() => {
    if (!api) return
    const mark = (group: DockviewGroupPanel) => group.element.setAttribute("data-panel-scope", "")
    api.groups.forEach(mark)
    const subscriptions = [api.onDidAddGroup(mark), api.onDidLayoutFromJSON(() => api.groups.forEach(mark))]
    return () => subscriptions.forEach(subscription => subscription.dispose())
  }, [api])

  useEffect(() => {
    if (!api || !keepProportionsOnGroupRemoval) return
    return keepProportionsOnRemoval(api)
  }, [api, keepProportionsOnGroupRemoval])

  // 浮动窗口回原位：浮出时记录来源网格组，双击浮动窗口标题栏并回该组。
  // 记录只在内存中，布局恢复后不再有原组，回退到第一个可见网格组。
  useEffect(() => {
    if (!api) return
    const root = rootRef.current
    if (!root) return
    const origins = new Map<string, string>()
    const subscriptions = [
      api.onDidMovePanel(({ from, to }) => {
        // 整组浮出时 from 与 to 是同一个组，没有可回的原组；浮动窗口之间的移动不改写来源
        if (to === from || to.api.location.type !== "floating" || from.api.location.type !== "grid") return
        if (!origins.has(to.id)) origins.set(to.id, from.id)
      }),
      api.onDidRemoveGroup(group => { origins.delete(group.id) }),
    ]
    const onDoubleClick = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return
      const titlebar = event.target.closest(".dv-floating-titlebar")
      if (!titlebar || event.target.closest("button, input, textarea, select, a")) return
      const container = titlebar.closest(".dv-resize-container")
      if (!container) return
      const members = api.groups.filter(group => group.api.location.type === "floating" && container.contains(group.element))
      if (members.length === 0) return
      // 固定的面板不能被移动，含固定面板的浮动窗口保持原状
      if (members.some(group => group.panels.some(panel => lockedPanelsRef.current.has(panel.id)))) return
      const originId = origins.get(members[0].id)
      const origin = api.groups.find(group => group.id === originId && group.api.location.type === "grid")
      const target = resolveFloatingDockTargetRef.current?.(members[0], origin)
        ?? origin
        ?? api.groups.find(group => group.api.location.type === "grid" && group.api.isVisible)
      event.preventDefault()
      for (const member of members) {
        if (target) member.api.moveTo({ group: target, position: "center" })
        else member.api.moveTo({ position: "right" })
      }
    }
    root.addEventListener("dblclick", onDoubleClick)
    return () => {
      subscriptions.forEach(subscription => subscription.dispose())
      root.removeEventListener("dblclick", onDoubleClick)
    }
  }, [api])

  // 组头显隐校准：网格中的空组与谓词命中的组隐藏组头，其余显示。只在值不一致时写入，
  // 写入引发的下一轮事件会自然收敛，不会循环。浮动窗口没有可保留的网格位置，
  // 变空后在本轮操作结束时移除。
  const syncGroupHeaders = useCallback((target: DockviewApi) => {
    const shouldHide = hideGroupHeaderRef.current
    const emptyFloating: DockviewGroupPanel[] = []
    for (const group of target.groups) {
      const location = group.api.location.type
      const empty = group.panels.length === 0
      if (empty && location === "floating") emptyFloating.push(group)
      const hidden = (empty && location === "grid") || !!shouldHide?.(group)
      if (group.header.hidden !== hidden) group.header.hidden = hidden
    }
    if (emptyFloating.length > 0) queueMicrotask(() => {
      for (const group of emptyFloating) {
        if (target.groups.includes(group) && group.panels.length === 0) target.removeGroup(group)
      }
    })
  }, [])

  useEffect(() => {
    if (api) syncGroupHeaders(api)
  }, [api, hideGroupHeader, syncGroupHeaders])

  useEffect(() => {
    if (!api) return
    const sync = () => syncGroupHeaders(api)
    const subscriptions = [
      api.onDidLayoutChange(sync),
      api.onDidAddPanel(sync),
      api.onDidRemovePanel(sync),
      api.onDidMovePanel(sync),
    ]
    return () => subscriptions.forEach(subscription => subscription.dispose())
  }, [api, syncGroupHeaders])

  // 组件自有的 DOM 增强，共用根节点上的一个 MutationObserver：
  // - 右键菜单：官方只渲染不可聚焦的 div 项，这里补上菜单焦点、方向键与
  //   Enter/Space 执行，并在菜单关闭后把焦点还给仍存在的标签；
  // - 溢出入口：官方入口是可点击的 div，文字只有隐藏数量。补上中文名称与键盘激活，
  //   隐藏标签的计算仍由 Dockview 负责；
  // - 标签栏方向：官方只有横纵轴互换时才发 onDidHeaderDirectionChange，上下或左右互换不会触发。
  //   观察组容器的实际方向类，覆盖菜单、演示选择器与外部直接调用官方接口三种写入路径。
  // 面板内容（`.dv-content-container`，renderer 为 always 时在 `.dv-render-overlay`）由 React 渲染，
  // 计时器、流式文本、列表滚动都会频繁改动其子树，回调一进来就跳过这些记录，不对它们做任何查询。
  // 溢出数量是官方对入口内 span 整体赋 textContent，会替换子节点，只产生 childList 记录，不需要观察 characterData。
  useEffect(() => {
    const root = rootRef.current
    if (!api || !root) return
    const contentSelector = ".dv-content-container, .dv-render-overlay"
    const hasWithin = (node: Element, selector: string) => node.matches(selector) || node.querySelector(selector) !== null

    // 标签栏方向
    const syncAll = () => {
      for (const group of api.groups) {
        const position = group.api.getHeaderPosition()
        if (headerPositionsRef.current.get(group.id) === position) continue
        headerPositionsRef.current.set(group.id, position)
        headerPositionCallbackRef.current?.({ groupId: group.id, position })
      }
    }
    headerPositionsRef.current.clear()
    for (const group of api.groups) headerPositionsRef.current.set(group.id, group.api.getHeaderPosition())

    // 右键菜单
    const restoreFocus = () => {
      const panelId = contextMenuPanelRef.current
      contextMenuPanelRef.current = null
      if (!panelId || !root.isConnected) return
      window.setTimeout(() => {
        const active = document.activeElement
        if (active && active !== document.body && active.isConnected && !active.closest(".dv-context-menu")) return
        const tab = root.querySelector<HTMLElement>(`.dv-tab[data-tab-panel-id="${CSS.escape(panelId)}"]`)
        if (tab) tab.focus({ preventScroll: true })
        else root.querySelector<HTMLElement>(".dv-groupview.dv-active-group .dv-tab.dv-active-tab")?.focus({ preventScroll: true })
      }, 0)
    }
    const enhanceMenu = (menu: HTMLElement) => {
      if (menu.dataset.ganMenuReady === "true") return
      menu.dataset.ganMenuReady = "true"
      menu.tabIndex = -1
      menu.setAttribute("aria-label", "标签菜单")
      // 官方在下一帧把菜单推回停靠区内（上下各留 10px）；菜单比停靠区还高时顶部会被推出去裁掉。
      // 这里先按停靠区高度限制菜单，超出部分在菜单内滚动。
      const area = menu.closest(".dv-popover-anchor")?.parentElement
      if (area) menu.style.setProperty("--gan-menu-room", `${Math.max(area.clientHeight - 20, 120)}px`)
      const items = Array.from(menu.querySelectorAll<HTMLElement>(".dv-context-menu-item"))
        .filter(item => item.getAttribute("aria-disabled") !== "true")
      items.forEach((item, index) => {
        item.tabIndex = -1
        if (!item.id) item.id = `gan-dock-tab-menu-${menuSeq++}-${index}`
      })
      let active = -1
      const focusItem = (index: number) => {
        if (items.length === 0) return
        active = (index + items.length) % items.length
        menu.setAttribute("aria-activedescendant", items[active].id)
        items[active].focus({ preventScroll: true })
      }
      menu.addEventListener("keydown", event => {
        if (event.key === "ArrowDown") { event.preventDefault(); focusItem(active + 1) }
        else if (event.key === "ArrowUp") { event.preventDefault(); focusItem(active - 1) }
        else if (event.key === "Home") { event.preventDefault(); focusItem(0) }
        else if (event.key === "End") { event.preventDefault(); focusItem(items.length - 1) }
        else if ((event.key === "Enter" || event.key === " ") && active >= 0) {
          event.preventDefault()
          event.stopPropagation()
          items[active].click()
        }
      })
      menu.focus({ preventScroll: true })
    }

    // 溢出入口
    const updateLabel = (dropdown: HTMLElement) => {
      const count = dropdown.querySelector("span")?.textContent?.trim() ?? ""
      const label = count ? `显示隐藏的标签（${count}）` : "显示隐藏的标签"
      dropdown.setAttribute("aria-label", label)
      dropdown.title = label
    }
    // 同一停靠区内可能有多个溢出入口；aria-expanded 只跟随最近一次点击的入口。
    let activeDropdown: HTMLElement | null = null
    const enhanceDropdown = (dropdown: HTMLElement) => {
      updateLabel(dropdown)
      if (dropdown.dataset.ganOverflowReady === "true") return
      dropdown.dataset.ganOverflowReady = "true"
      dropdown.setAttribute("role", "button")
      dropdown.setAttribute("aria-expanded", "false")
      dropdown.tabIndex = 0
      dropdown.addEventListener("click", () => {
        if (activeDropdown && activeDropdown !== dropdown) activeDropdown.setAttribute("aria-expanded", "false")
        activeDropdown = dropdown
      })
      dropdown.addEventListener("keydown", event => {
        if (event.key !== "Enter" && event.key !== " ") return
        event.preventDefault()
        event.stopPropagation()
        dropdown.click()
      })
    }
    const scan = (scope: ParentNode) => scope.querySelectorAll<HTMLElement>(".dv-tabs-overflow-dropdown-default").forEach(enhanceDropdown)
    scan(root)

    const observer = new MutationObserver(mutations => {
      let headerChanged = false
      let opened = false
      let closed = false
      const countChanged = new Set<HTMLElement>()
      for (const mutation of mutations) {
        const target = mutation.target
        if (!(target instanceof Element)) continue
        if (mutation.type === "attributes") {
          // 只关心组容器自身的类变化；标签悬停、拖动状态等子树类变化不触发同步。
          if (target.classList.contains("dv-groupview")) headerChanged = true
          continue
        }
        if (target.closest(contentSelector)) continue
        for (const node of mutation.addedNodes) {
          if (!(node instanceof Element) || node.matches(contentSelector)) continue
          if (node.matches(".dv-context-menu")) enhanceMenu(node as HTMLElement)
          else node.querySelectorAll<HTMLElement>(".dv-context-menu").forEach(enhanceMenu)
          if (node.matches(".dv-tabs-overflow-dropdown-default")) enhanceDropdown(node as HTMLElement)
          else scan(node)
          if (hasWithin(node, ".dv-tabs-overflow-container")) opened = true
        }
        for (const node of mutation.removedNodes) {
          if (!(node instanceof Element) || node.matches(contentSelector)) continue
          if (hasWithin(node, ".dv-context-menu")) restoreFocus()
          if (hasWithin(node, ".dv-tabs-overflow-container")) closed = true
        }
        const dropdown = target.closest<HTMLElement>(".dv-tabs-overflow-dropdown-default")
        if (dropdown) countChanged.add(dropdown)
      }
      if (opened) activeDropdown?.setAttribute("aria-expanded", "true")
      else if (closed) {
        activeDropdown?.setAttribute("aria-expanded", "false")
        activeDropdown = null
      }
      countChanged.forEach(updateLabel)
      if (headerChanged) {
        syncAll()
        overlayCornersRef.current?.()
      }
    })
    observer.observe(root, { childList: true, attributes: true, attributeFilter: ["class"], subtree: true })
    const subscriptions = [
      api.onDidAddGroup(group => { headerPositionsRef.current.set(group.id, group.api.getHeaderPosition()) }),
      api.onDidRemoveGroup(group => { headerPositionsRef.current.delete(group.id) }),
    ]
    return () => {
      observer.disconnect()
      subscriptions.forEach(subscription => subscription.dispose())
    }
  }, [api])

  // renderer: "always" 的面板内容画在组之外的 .dv-render-overlay 上，不受组与浮动窗口圆角的裁切。
  // 这里标出覆盖层与组（有间距时）或浮动窗口重合的角，样式按标记给这些角加圆角；
  // 内容区与标签栏相接的两个角必须保持直角，所以不能四角一起圆。
  // 只比较内容区与外框的几何位置，不依赖标签栏方向，四个方向与组内标签栏隐藏时都成立。
  // 面板到覆盖层的对应关系取自 dockview-core 8.6.2 的内部结构（panel.view.content.element 的父节点），
  // 结构不符时找不到覆盖层，不加圆角也不报错；升级后重跑 tests/dock-layout.spec.ts 的覆盖层贴角用例。
  useEffect(() => {
    const root = rootRef.current
    const shell = root?.querySelector(".dv-shell")
    if (!api || !root || !shell) return
    let frame = 0
    const overlayOf = (panel: DockviewGroupPanel["panels"][number]) => {
      const content = (panel as unknown as { view?: { content?: { element?: HTMLElement } } }).view?.content?.element
      const overlay = content?.parentElement
      return overlay?.classList.contains("dv-render-overlay") ? overlay : null
    }
    const sync = () => {
      frame = 0
      if (!shell.querySelector(":scope > .dv-render-overlay")) return
      const spaced = root.hasAttribute("data-group-gap")
      for (const group of api.groups) {
        const overlays = group.panels.map(overlayOf).filter((overlay): overlay is HTMLElement => overlay !== null)
        if (overlays.length === 0) continue
        const clips: DOMRect[] = []
        if (spaced) clips.push(group.element.getBoundingClientRect())
        const floating = group.element.closest(".dv-resize-container")
        if (floating) clips.push(floating.getBoundingClientRect())
        const content = group.element.querySelector(":scope > .dv-content-container")?.getBoundingClientRect()
        const corners = new Set<string>()
        if (content && content.width > 0 && content.height > 0) {
          // 窗口外框带 1px 边框，内容区的角比外框内缩 1px，留 2px 容差
          const near = (a: number, b: number) => Math.abs(a - b) <= 2
          for (const clip of clips) {
            if (near(content.left, clip.left) && near(content.top, clip.top)) corners.add("tl")
            if (near(content.right, clip.right) && near(content.top, clip.top)) corners.add("tr")
            if (near(content.right, clip.right) && near(content.bottom, clip.bottom)) corners.add("br")
            if (near(content.left, clip.left) && near(content.bottom, clip.bottom)) corners.add("bl")
          }
        }
        const value = Array.from(corners).join(" ")
        for (const overlay of overlays) {
          if (value) {
            if (overlay.getAttribute("data-gan-corners") !== value) overlay.setAttribute("data-gan-corners", value)
          } else overlay.removeAttribute("data-gan-corners")
        }
      }
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(sync) }
    overlayCornersRef.current = schedule
    // 浮动窗口与新增面板的最终尺寸由官方在后续帧里布局，布局事件到达时内容区可能还没到位；
    // 覆盖层的尺寸是官方按内容区量出来写入的，它一变就重新计算。
    const resizeObserver = new ResizeObserver(schedule)
    shell.querySelectorAll(":scope > .dv-render-overlay").forEach(overlay => resizeObserver.observe(overlay))
    schedule()
    // 覆盖层直接挂在停靠区根节点下，只观察它的直接子节点，面板内容的变化不会进来
    const observer = new MutationObserver(records => {
      for (const record of records) {
        record.addedNodes.forEach(node => { if (node instanceof Element && node.matches(".dv-render-overlay")) resizeObserver.observe(node) })
        record.removedNodes.forEach(node => { if (node instanceof Element) resizeObserver.unobserve(node) })
      }
      schedule()
    })
    observer.observe(shell, { childList: true })
    const subscriptions = [
      api.onDidLayoutChange(schedule),
      api.onDidAddPanel(schedule),
      api.onDidMovePanel(schedule),
    ]
    return () => {
      overlayCornersRef.current = null
      if (frame) cancelAnimationFrame(frame)
      observer.disconnect()
      resizeObserver.disconnect()
      subscriptions.forEach(subscription => subscription.dispose())
    }
  }, [api, effectiveGap])

  // 布局前写入，首帧即按指定圆角绘制；不传时移除，交给样式里的 --dock-radius（默认 0）。
  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return
    if (cornerRadius === undefined) root.style.removeProperty("--dock-radius")
    else root.style.setProperty("--dock-radius", `${Math.max(0, cornerRadius)}px`)
  }, [cornerRadius])

  // 有间距时在外层容器上打标记并写入间距值：样式据此切换外观（单个组没有拆分时官方不会加 has-margin 类），
  // 并用同样宽度的内边距在最外圈留缝。写在布局之前，缝的宽度与官方 gap 同一帧生效。
  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return
    if (effectiveGap > 0) {
      root.setAttribute("data-group-gap", "")
      root.style.setProperty("--dock-gap-size", `${effectiveGap}px`)
    } else {
      root.removeAttribute("data-group-gap")
      root.style.removeProperty("--dock-gap-size")
    }
  }, [effectiveGap])

  const surface = useMemo(
    () => ({ watermark: watermarkComponent, emptyGroup: emptyGroupComponent }),
    [watermarkComponent, emptyGroupComponent],
  )
  // 值引用稳定：宿主每次渲染（工作台里页面会高频更新）都不应让所有页签与固定标记跟着重渲染。
  const locks = useMemo(() => ({ lockedPanels, toggle }), [lockedPanels, toggle])

  return (
    <PanelLockContext.Provider value={locks}>
      <DockSurfaceContext.Provider value={surface}>
        <DockviewReact
          ref={rootRef}
          theme={resolvedTheme}
          dndStrategy={dndStrategy}
          closeEmptyGroups={closeEmptyGroups}
          watermarkComponent={DockWatermarkHost}
          defaultTabComponent={defaultTabComponent}
          getTabContextMenuItems={resolveTabMenu}
          className={cn("min-h-0 min-w-0", className)}
          {...props}
          onReady={event => { setApi(event.api); onReady(event) }}
        />
      </DockSurfaceContext.Provider>
    </PanelLockContext.Provider>
  )
}
