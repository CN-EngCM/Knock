import * as React from "react"
import { cn } from "@/lib/utils"
import { usePlatform, type Platform } from "@/lib/platform"
import { formatShortcut, formatShortcutLabel, getShortcutParts } from "@/lib/shortcut"

/**
 * 键帽。传 children 时原样显示（向后兼容）；传 `keys`（如 "mod+shift+k"）时按平台渲染成一个键帽，
 * mac 为 `⌘⇧K`，Windows/Linux 为 `Ctrl+Shift+K`。需要逐键单独成帽时用 `Shortcut`。
 */
function Kbd({ className, keys, platform, children, ...props }: React.ComponentProps<"kbd"> & {
  /** 平台无关的快捷键写法，例如 "mod+k"；设置后忽略 children */
  keys?: string
  /** 覆盖当前平台，缺省取 PlatformProvider / 自动检测 */
  platform?: Platform
}) {
  const contextPlatform = usePlatform()
  const resolved = platform ?? contextPlatform
  const shortcut = keys != null
  return <kbd data-slot="kbd" aria-label={shortcut ? formatShortcutLabel(keys, resolved) : undefined} className={cn("inline-flex h-5 min-w-5 cursor-default items-center justify-center rounded-[3px] border border-black/20 bg-white px-[5px] font-mono text-small leading-none text-muted-foreground shadow-raised dark:bg-white/[0.04] select-none [&_svg]:size-3", className)} {...props}>{shortcut ? formatShortcut(keys, resolved) : children}</kbd>
}
function KbdGroup({ className, ...props }: React.ComponentProps<"span">) { return <span data-slot="kbd-group" className={cn("inline-flex items-center gap-1", className)} {...props} /> }

/** 按平台把快捷键拆成一组键帽：`<Shortcut keys="mod+k" />` 在 mac 显示 ⌘ K，在 Windows/Linux 显示 Ctrl K，整组带朗读名称 */
function Shortcut({ keys, platform, ...props }: Omit<React.ComponentProps<typeof KbdGroup>, "children"> & {
  /** 平台无关的快捷键写法，例如 "mod+shift+k" */
  keys: string
  /** 覆盖当前平台，缺省取 PlatformProvider / 自动检测 */
  platform?: Platform
}) {
  const contextPlatform = usePlatform()
  const resolved = platform ?? contextPlatform
  return <KbdGroup aria-label={formatShortcutLabel(keys, resolved)} {...props}>
    {getShortcutParts(keys, resolved).map((part, index) => <Kbd key={`${index}-${part.text}`}>{part.text}</Kbd>)}
  </KbdGroup>
}
export { Kbd, KbdGroup, Shortcut }
