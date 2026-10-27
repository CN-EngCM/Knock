/**
 * 密度档：控件、行、栏的高度与间距。取值与令牌见 `src/index.css` 的 `--size-*` / `--space-*`，
 * 行为约定见 docs/design.md“密度档”。字号、图标、圆角、边框宽度与指示件尺寸不随密度变化。
 *
 * 密度写在元素的 `data-density` 属性上，令牌随继承就近生效：根元素设一次即全局，
 * 任意子树再写一次就是局部覆盖（嵌套时取最近的那个）。`regular` 是原尺寸，也是默认值。
 */

export type Density = "compact" | "regular" | "comfortable"

export const densities: readonly Density[] = ["compact", "regular", "comfortable"]

export const densityStorageKey = "gan-ui.preview-density"

/** 预览与测试用的 URL 查询参数名：`?density=compact|regular|comfortable` */
export const densityQueryParam = "density"

export function isDensity(value: unknown): value is Density {
  return value === "compact" || value === "regular" || value === "comfortable"
}

/**
 * 应用密度档。`regular` 移除属性（等同未设置，令牌回到根上的默认值）；
 * 在子树上调用 `applyDensity("regular", element)` 会移除局部覆盖，让它回到外层的密度。
 * 要在 compact 的外层里强制切回原尺寸，直接给该元素写 `data-density="regular"`。
 */
export function applyDensity(density: Density, element: HTMLElement = document.documentElement) {
  if (density === "regular") element.removeAttribute("data-density")
  else element.setAttribute("data-density", density)
}

/** 读取元素当前生效的密度（最近的带 `data-density` 的祖先，没有则是 regular）。 */
export function getDensity(element: Element = document.documentElement): Density {
  const value = element.closest("[data-density]")?.getAttribute("data-density")
  return isDensity(value) ? value : "regular"
}

/** 初始密度：`?density=` 优先（不写入存储），其次存储的偏好，默认 regular。 */
export function getInitialDensity(): Density {
  const queryDensity = new URLSearchParams(window.location.search).get(densityQueryParam)
  if (isDensity(queryDensity)) return queryDensity

  try {
    const stored = window.localStorage.getItem(densityStorageKey)
    if (isDensity(stored)) return stored
  } catch {
    // 隐私限制可能导致浏览器存储不可用。
  }
  return "regular"
}

export function persistDensity(density: Density) {
  try {
    window.localStorage.setItem(densityStorageKey, density)
  } catch {
    // 存储不可用时只保留本次会话的效果。
  }
}

const densityListeners = new Set<(records: MutationRecord[]) => void>()
let densityObserver: MutationObserver | null = null

/**
 * 订阅页面内任何位置的密度变化（`data-density` 属性的增删改，含局部覆盖）。
 * 虚拟化与按像素计算的逻辑借此重新读取令牌；返回取消订阅函数。
 * 所有订阅者共用一个文档级观察器：首个订阅时连接，最后一个退订时断开。
 * 监听者会收到变化记录，可据 `record.target` 判断变化是否落在自己所在的子树上。
 */
export function subscribeDensity(listener: (records: MutationRecord[]) => void): () => void {
  if (typeof MutationObserver === "undefined") return () => {}
  densityListeners.add(listener)
  if (!densityObserver) {
    densityObserver = new MutationObserver((records) => {
      for (const notify of [...densityListeners]) notify(records)
    })
    densityObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-density"], subtree: true })
  }
  return () => {
    densityListeners.delete(listener)
    if (densityListeners.size === 0) {
      densityObserver?.disconnect()
      densityObserver = null
    }
  }
}

/**
 * 读取元素上某个像素令牌的计算值（如 `--size-tree-row`）。令牌是字面像素，
 * 所以直接解析即可；取不到（元素尚未挂载、SSR）时返回 `fallback`。
 */
export function readSizeToken(element: Element | null | undefined, name: string, fallback: number): number {
  if (!element || typeof getComputedStyle !== "function") return fallback
  const value = Number.parseFloat(getComputedStyle(element).getPropertyValue(name))
  return Number.isFinite(value) ? value : fallback
}

/*
 * 浮层继承起源处的密度。菜单、Select、Popover、Dialog 等会 portal 到 `body`，
 * 写在触发器所在子树上的局部 `data-density` 因此进不去浮层；这里在浮层内容挂载时找到“起源元素”，
 * 取它最近的 `data-density`，仅当它与浮层所在处不同时才写到内容根上（局部无覆盖时不写任何属性）。
 * 不要求调用方改用新组件：裸写在任意元素上的 `data-density` 都会被继承。
 */

type Interaction = { target: Element; time: number }

/** 最近一次按下 / 右键 / 聚焦的目标（点击类浮层的兜底起源）。 */
let lastPress: Interaction | null = null
/** 最近一次指针移入的目标（只给悬停类浮层兜底）。 */
let lastHover: Interaction | null = null
let tracking = false

/**
 * 在文档上以捕获阶段记录最近的交互目标，供没有 `aria-controls` 的浮层（右键区域、悬停提示、
 * Base UI 的 Combobox、受控打开的对话框）反查起源。幂等，只登记一次；每个事件只做一次赋值，开销可忽略。
 */
export function trackOverlayOrigins() {
  if (tracking || typeof document === "undefined") return
  tracking = true
  const options: AddEventListenerOptions = { capture: true, passive: true }
  const press = (event: Event) => {
    if (event.target instanceof Element) lastPress = { target: event.target, time: event.timeStamp }
  }
  const hover = (event: Event) => {
    if (event.target instanceof Element) lastHover = { target: event.target, time: event.timeStamp }
  }
  document.addEventListener("pointerdown", press, options)
  document.addEventListener("contextmenu", press, options)
  document.addEventListener("focusin", press, options)
  document.addEventListener("pointerover", hover, options)
}

export interface OverlayDensityOptions {
  /** 已知的起源元素（自研 Menu 的触发器）；优先于一切反查。 */
  origin?: Element | null
  /** 悬停类浮层（Tooltip、HoverCard）：最近的指针移入也算候选。 */
  hover?: boolean
}

/**
 * 找浮层内容的起源元素，按优先级：
 * 1. 调用方显式给的 `origin`；
 * 2. 触发器上的 `aria-controls`（Radix 的菜单、Select、Popover、Dialog）或 `aria-describedby`（Tooltip）
 *    指向内容或其内部 tooltip/listbox 的 id；
 * 3. 最近的交互目标（pointerdown、contextmenu、focusin，悬停类再加 pointerover），取较新者，
 *    已脱离文档或落在浮层自身内部的不算。
 */
function findOverlayOrigin(node: HTMLElement, { origin, hover }: OverlayDensityOptions): Element | null {
  if (origin?.isConnected) return origin

  const ids = [node.id, node.querySelector("[id][role='tooltip'], [id][role='listbox']")?.id]
  for (const id of ids) {
    if (!id) continue
    const escaped = CSS.escape(id)
    const trigger = document.querySelector(`[aria-controls~="${escaped}"], [aria-describedby~="${escaped}"]`)
    if (trigger && !node.contains(trigger)) return trigger
  }

  let best: Interaction | null = null
  for (const entry of [lastPress, hover ? lastHover : null]) {
    if (!entry || !entry.target.isConnected || node.contains(entry.target)) continue
    if (!best || entry.time > best.time) best = entry
  }
  return best?.target ?? null
}

/**
 * 让浮层内容根继承起源处的密度：起源的密度与浮层所在处（挂载后的父级）不同才写 `data-density`。
 * 元素上已有 `data-density`（调用方显式写了，或此前已解析过）时不动。regular 也会显式写出，
 * 才能在外层是 compact 时保持原尺寸。
 */
export function inheritOverlayDensity(node: HTMLElement, options: OverlayDensityOptions = {}) {
  if (node.hasAttribute("data-density")) return
  const origin = findOverlayOrigin(node, options)
  if (!origin) return
  const density = getDensity(origin)
  if (density !== getDensity(node.parentElement ?? document.documentElement)) node.setAttribute("data-density", density)
}
