import * as React from "react"
import { getPlatform, usePlatform, type Platform } from "@/lib/platform"

/**
 * 快捷键语法：用 `+` 连接修饰键与主键，大小写不敏感，例如 `mod+shift+k`、`mod+enter`、`alt+f4`、`mod++`。
 *
 * 修饰键：`mod`（mac 为 ⌘，其他平台为 Ctrl）、`ctrl`/`control`、`alt`/`option`/`opt`、`shift`、
 * `meta`/`cmd`/`command`/`win`/`super`（物理 Meta：mac 的 ⌘，Windows 的 Win，Linux 的 Super）。
 * 仅修饰键也合法（`mod`、`shift`），用于单独显示键帽。
 * 主键：单个字符（`k`、`/`、`,`、`1`），或 `enter`、`esc`、`backspace`、`delete`、`tab`、`space`、
 * `up`/`down`/`left`/`right`、`home`、`end`、`pageup`、`pagedown`、`insert`、`f1`–`f24`、`plus`、`minus`。
 */
export interface ParsedShortcut {
  mod: boolean
  ctrl: boolean
  alt: boolean
  shift: boolean
  meta: boolean
  /** 对应 `KeyboardEvent.key` 的小写形式，例如 "k"、"enter"、"escape"、"arrowup"、" "；仅修饰键时为空串 */
  key: string
}

/** 一个键帽：`text` 为屏幕显示，`label` 为朗读用的完整名称 */
export interface ShortcutPart {
  text: string
  label: string
  modifier: boolean
}

const modifierAliases: Record<string, "mod" | "ctrl" | "alt" | "shift" | "meta"> = {
  mod: "mod",
  ctrl: "ctrl",
  control: "ctrl",
  alt: "alt",
  option: "alt",
  opt: "alt",
  shift: "shift",
  meta: "meta",
  cmd: "meta",
  command: "meta",
  win: "meta",
  windows: "meta",
  super: "meta",
}

const keyAliases: Record<string, string> = {
  return: "enter",
  esc: "escape",
  del: "delete",
  spacebar: " ",
  space: " ",
  up: "arrowup",
  down: "arrowdown",
  left: "arrowleft",
  right: "arrowright",
  pgup: "pageup",
  pgdn: "pagedown",
  ins: "insert",
  plus: "+",
  minus: "-",
  comma: ",",
  period: ".",
  slash: "/",
  backslash: "\\",
}

const namedKeys = new Set([
  "enter", "escape", "backspace", "delete", "tab", " ", "arrowup", "arrowdown", "arrowleft", "arrowright",
  "home", "end", "pageup", "pagedown", "insert",
])

function isNamedKey(key: string) {
  return namedKeys.has(key) || /^f([1-9]|1\d|2[0-4])$/.test(key)
}

/** 解析快捷键字符串；缺少主键或含未知修饰键时返回 null */
export function parseShortcut(keys: string): ParsedShortcut | null {
  const source = keys.trim()
  if (!source) return null

  let key: string
  let tokens: string[]
  if (source === "+") {
    key = "+"
    tokens = []
  } else if (source.endsWith("++")) {
    key = "+"
    tokens = source.slice(0, -2).split("+")
  } else {
    const parts = source.split("+")
    const last = parts.pop()!.trim().toLowerCase()
    // 末项是修饰键名时视为仅修饰键（如 "mod"、"mod+shift"），用于单独显示键帽。
    if (modifierAliases[last]) {
      key = ""
      tokens = [...parts, last]
    } else {
      key = keyAliases[last] ?? last
      tokens = parts
    }
  }
  if (!key && tokens.length === 0) return null
  // 主键只能是单个字符或具名键；其他文本（例如整句说明）不当作快捷键。
  if (key.length > 1 && !isNamedKey(key)) return null

  const result: ParsedShortcut = { mod: false, ctrl: false, alt: false, shift: false, meta: false, key }
  for (const token of tokens) {
    const modifier = modifierAliases[token.trim().toLowerCase()]
    if (!modifier) return null
    result[modifier] = true
  }
  return result
}

/** 普通文本是否按快捷键语法书写：不含空白，且带修饰键或本身是具名键（Enter、F2 等） */
export function isShortcutSpec(text: string): boolean {
  if (/\s/.test(text)) return false
  const parsed = parseShortcut(text)
  if (!parsed) return false
  return parsed.mod || parsed.ctrl || parsed.alt || parsed.shift || parsed.meta || isNamedKey(parsed.key)
}

const macSymbols = { ctrl: "⌃", alt: "⌥", shift: "⇧", meta: "⌘" }

const macKeyText: Record<string, string> = {
  enter: "↩",
  escape: "⎋",
  backspace: "⌫",
  delete: "⌦",
  tab: "⇥",
  home: "↖",
  end: "↘",
  pageup: "⇞",
  pagedown: "⇟",
  insert: "Ins",
}

const otherKeyText: Record<string, string> = {
  enter: "Enter",
  escape: "Esc",
  backspace: "Backspace",
  delete: "Del",
  tab: "Tab",
  home: "Home",
  end: "End",
  pageup: "PgUp",
  pagedown: "PgDn",
  insert: "Ins",
}

const sharedKeyText: Record<string, string> = {
  " ": "Space",
  arrowup: "↑",
  arrowdown: "↓",
  arrowleft: "←",
  arrowright: "→",
}

const keyLabels: Record<string, string> = {
  enter: "Enter",
  escape: "Escape",
  backspace: "Backspace",
  delete: "Delete",
  tab: "Tab",
  " ": "Space",
  arrowup: "Up Arrow",
  arrowdown: "Down Arrow",
  arrowleft: "Left Arrow",
  arrowright: "Right Arrow",
  home: "Home",
  end: "End",
  pageup: "Page Up",
  pagedown: "Page Down",
  insert: "Insert",
  "+": "Plus",
  "-": "Minus",
}

function keyText(key: string, platform: Platform) {
  if (sharedKeyText[key]) return sharedKeyText[key]
  const named = (platform === "mac" ? macKeyText : otherKeyText)[key]
  if (named) return named
  return key.toUpperCase()
}

/**
 * 拆成键帽序列。修饰键顺序 mac 为 ⌃⌥⇧⌘（Apple 约定），其他平台为 Ctrl、Alt、Shift、Win/Super；
 * 无法解析时返回只含原文的单个键帽。
 */
export function getShortcutParts(keys: string, platform: Platform = getPlatform()): ShortcutPart[] {
  const parsed = parseShortcut(keys)
  if (!parsed) return [{ text: keys, label: keys, modifier: false }]

  const mac = platform === "mac"
  const ctrl = parsed.ctrl || (parsed.mod && !mac)
  const meta = parsed.meta || (parsed.mod && mac)
  const parts: ShortcutPart[] = []

  if (ctrl) parts.push({ text: mac ? macSymbols.ctrl : "Ctrl", label: "Control", modifier: true })
  if (parsed.alt) parts.push({ text: mac ? macSymbols.alt : "Alt", label: mac ? "Option" : "Alt", modifier: true })
  if (parsed.shift) parts.push({ text: mac ? macSymbols.shift : "Shift", label: "Shift", modifier: true })
  if (meta) {
    parts.push({
      text: mac ? macSymbols.meta : platform === "windows" ? "Win" : "Super",
      label: mac ? "Command" : platform === "windows" ? "Windows" : "Super",
      modifier: true,
    })
  }
  if (parsed.key) parts.push({ text: keyText(parsed.key, platform), label: keyLabels[parsed.key] ?? keyText(parsed.key, platform), modifier: false })
  return parts
}

/** 显示文案：mac `⌘⇧K`，Windows/Linux `Ctrl+Shift+K` */
export function formatShortcut(keys: string, platform: Platform = getPlatform()): string {
  const parts = getShortcutParts(keys, platform)
  return parts.map((part) => part.text).join(platform === "mac" ? "" : "+")
}

/** 朗读文案：例如 `Command Shift K`、`Control Shift K` */
export function formatShortcutLabel(keys: string, platform: Platform = getPlatform()): string {
  return getShortcutParts(keys, platform).map((part) => part.label).join(" ")
}

type ShortcutEvent = Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey">

/**
 * 判断键盘事件是否匹配快捷键。修饰键必须完全一致（多按一个修饰键不匹配）；
 * `mod` 在 mac 对应 metaKey，其他平台对应 ctrlKey。
 * 带 Alt/Shift 时 `event.key` 可能变成特殊字符（mac 的 Option+B 为 "∫"），字母和数字回退用 `event.code` 比对。
 */
export function matchesShortcut(event: ShortcutEvent, keys: string, platform: Platform = getPlatform()): boolean {
  const parsed = parseShortcut(keys)
  if (!parsed?.key) return false

  const mac = platform === "mac"
  const ctrl = parsed.ctrl || (parsed.mod && !mac)
  const meta = parsed.meta || (parsed.mod && mac)
  if (event.ctrlKey !== ctrl || event.metaKey !== meta || event.altKey !== parsed.alt || event.shiftKey !== parsed.shift) return false

  const key = event.key.toLowerCase()
  if (key === parsed.key) return true
  if ((event.altKey || event.shiftKey) && parsed.key.length === 1) {
    if (/[a-z]/.test(parsed.key)) return event.code === `Key${parsed.key.toUpperCase()}`
    if (/\d/.test(parsed.key)) return event.code === `Digit${parsed.key}` || event.code === `Numpad${parsed.key}`
  }
  return false
}

/** 菜单、命令面板等快捷键槽：字符串按快捷键语法渲染成当前平台文案，其他内容原样返回 */
export function useShortcutText<T extends React.ReactNode>(children: T): T | string {
  const platform = usePlatform()
  return typeof children === "string" && isShortcutSpec(children) ? formatShortcut(children, platform) : children
}
