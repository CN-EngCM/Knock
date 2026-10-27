import * as React from "react"

/** 桌面平台：决定快捷键符号、Titlebar 窗口按钮位置与对话框按钮顺序 */
export type Platform = "mac" | "windows" | "linux"

export const platforms: readonly Platform[] = ["mac", "windows", "linux"]

/** 预览与测试用的 URL 查询参数名：`?platform=mac|windows|linux` */
export const platformQueryParam = "platform"

export function isPlatform(value: unknown): value is Platform {
  return value === "mac" || value === "windows" || value === "linux"
}

/**
 * 根据浏览器环境检测平台。
 * 优先 `navigator.userAgentData.platform`，回退 `navigator.platform`，最后看 userAgent；
 * iOS/iPadOS 归为 mac，Android/ChromeOS 归为 linux，无法判断（如 SSR）时按 windows。
 */
export function detectPlatform(nav?: Pick<Navigator, "platform" | "userAgent"> & { userAgentData?: { platform?: string } }): Platform {
  const source = nav ?? (typeof navigator === "undefined" ? undefined : (navigator as Navigator & { userAgentData?: { platform?: string } }))
  if (!source) return "windows"

  const candidates = [source.userAgentData?.platform, source.platform, source.userAgent]
  for (const hint of candidates) {
    if (!hint) continue
    if (/mac|iphone|ipad|ipod|darwin/i.test(hint)) return "mac"
    if (/win/i.test(hint)) return "windows"
    if (/linux|android|cros|x11|bsd/i.test(hint)) return "linux"
  }
  return "windows"
}

/** 读取 URL 查询参数 `?platform=`，非法值返回 null */
export function getPlatformFromQuery(search?: string): Platform | null {
  const source = search ?? (typeof window === "undefined" ? "" : window.location.search)
  const value = new URLSearchParams(source).get(platformQueryParam)
  return isPlatform(value) ? value : null
}

let overridePlatform: Platform | null = null
let resolvedPlatform: Platform | null = null
const listeners = new Set<() => void>()

/**
 * 当前生效的平台（非 React 环境使用，例如 `formatShortcut` 缺省参数）。
 * 优先级：`setPlatform` 显式设置 > URL `?platform=` > 自动检测。
 */
export function getPlatform(): Platform {
  return overridePlatform ?? (resolvedPlatform ??= getPlatformFromQuery() ?? detectPlatform())
}

/** 全局覆盖平台（预览站开关用）；传 null 恢复为查询参数或自动检测 */
export function setPlatform(platform: Platform | null) {
  if (overridePlatform === platform) return
  const before = getPlatform()
  overridePlatform = platform
  if (before !== getPlatform()) listeners.forEach((listener) => listener())
}

export function subscribePlatform(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const PlatformContext = React.createContext<Platform | null>(null)

/**
 * 为子树显式指定平台。省略 `platform` 时沿用外层 Provider，再回退到全局的
 * URL 查询参数或自动检测，因此业务应用通常无需包裹；需要局部预览其他平台、
 * 或由 Electron 主进程传入 `process.platform` 映射结果时才使用。
 */
function PlatformProvider({ platform, children }: { platform?: Platform; children?: React.ReactNode }) {
  const parent = React.useContext(PlatformContext)
  return <PlatformContext.Provider value={platform ?? parent}>{children}</PlatformContext.Provider>
}

/** 读取当前平台：最近的 PlatformProvider > 全局（`setPlatform` / `?platform=` / 自动检测） */
function usePlatform(): Platform {
  const context = React.useContext(PlatformContext)
  const global = React.useSyncExternalStore(subscribePlatform, getPlatform, getPlatform)
  return context ?? global
}

export { PlatformProvider, usePlatform }
