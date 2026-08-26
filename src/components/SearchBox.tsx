import { useEffect, useMemo, useRef, useState } from 'react'
import { TOOLS, type ToolId } from '@/tools/registry'
import type { Group, Item, ToolAliases } from '@/api/client'
import { useI18n } from '@/i18n/useI18n'

// ── 顶栏搜索框（v2.3）：输入即出下拉候选 + 剪贴板素材流 ──
// 候选 = 匹配条目（标题/目标）+ 匹配的内置工具（名称/描述/id/别名）。
// 素材流：呼出窗口时主进程带来时限内的剪贴板文本（mp:focus-search 的
// payload），以只读 chip 呈现在输入框内；chip 在场时下拉顶部固定显示
// 「推荐工具」（能吃文本的工具，嗅探置顶），选中后把素材注入工具输入框。
// 无 chip 且手打 query 无任何命中时，query 升格为素材参与注入。
// 键盘：↑↓ 移动高亮、Enter 打开/注入高亮项、Esc 先清 chip 再清 query。

// 终端风行前缀：web / app / file，对应三种条目类型；工具行前缀用「工具」
const TAG: Record<Item['kind'], string> = { bookmark: 'web', app: 'app', file: 'file' }

const MAX_CANDIDATES = 9
const CHIP_MAX_CHARS = 32

type Candidate =
  | { kind: 'item'; item: Item; groupName: string }
  | { kind: 'tool'; id: ToolId; name: string; desc: string }

type Props = {
  groups: Group[]
  items: Item[]
  /** 工具别名（设置页维护）：别名命中也算工具候选 */
  toolAliases: ToolAliases
  onOpenItem: (item: Item) => void
  /** input 非 null 时 = 带素材打开工具（App 层负责注入通道） */
  onOpenTool: (id: ToolId, input: string | null) => void
}

/** 极轻内容嗅探：http(s) → qr 置顶（URL 可能也是合法 JSON 串，先判 URL）；JSON.parse 成功 → json 置顶 */
function sniffTop(src: string): ToolId | null {
  if (/^https?:\/\//i.test(src)) return 'qr'
  try {
    JSON.parse(src)
    return 'json'
  } catch {
    return null
  }
}

/** chip 单行展示：空白折叠 + 按码点截断 */
function chipLabel(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  const chars = [...flat]
  return chars.length > CHIP_MAX_CHARS ? chars.slice(0, CHIP_MAX_CHARS).join('') + '…' : flat
}

export function SearchBox({ groups, items, toolAliases, onOpenItem, onOpenTool }: Props) {
  const { t } = useI18n()
  const [query, setQuery] = useState('')
  const [clip, setClip] = useState<string | null>(null)
  const [focused, setFocused] = useState(false)
  const [hi, setHi] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  // 双击 Ctrl 呼出：清空搜索词、装上剪贴板素材（null = 超时/关闭）、聚焦输入框
  useEffect(() => {
    return window.knock.onFocusSearch((text) => {
      setQuery('')
      setClip(text)
      inputRef.current?.focus()
    })
  }, [])

  // 匹配源：素材 chip 优先（chip 在场时用完整剪贴板文本去匹配条目/工具）
  const q = (clip ?? query).trim().toLowerCase()

  const { matches, recActive } = useMemo(() => {
    const out: Candidate[] = []
    if (q) {
      const gname = new Map(groups.map((g) => [g.id, g.name]))
      for (const item of items) {
        if (item.title.toLowerCase().includes(q) || item.target.toLowerCase().includes(q)) {
          out.push({ kind: 'item', item, groupName: gname.get(item.group_id) ?? '' })
          if (out.length >= MAX_CANDIDATES) break
        }
      }
      for (const tool of TOOLS) {
        if (out.length >= MAX_CANDIDATES) break
        const name = t(tool.nameKey)
        const desc = t(tool.descKey)
        const aliases = (toolAliases[tool.id] ?? '').split(/[\s,，]+/).filter(Boolean)
        const hit =
          name.toLowerCase().includes(q) ||
          tool.id.includes(q) ||
          desc.toLowerCase().includes(q) ||
          aliases.some((a) => a.toLowerCase().includes(q))
        if (hit) out.push({ kind: 'tool', id: tool.id, name, desc })
      }
    }
    // 推荐区激活：有素材 chip，或手打 query 什么都没命中（query 升格为素材）
    return { matches: out, recActive: clip !== null || (q.length > 0 && out.length === 0) }
  }, [q, clip, groups, items, t, toolAliases])

  // 推荐工具：能吃文本素材的工具，按嗅探结果置顶
  const recTools = useMemo(() => {
    const list = TOOLS.filter((x) => x.acceptsText)
    const top = sniffTop((clip ?? query).trim())
    return top ? [...list].sort((a, b) => (a.id === top ? -1 : b.id === top ? 1 : 0)) : list
  }, [clip, query])

  // 候选组装：推荐区置顶；下方命中区里去掉已在推荐区的工具（避免重复行）
  const candidates = useMemo(() => {
    if (!recActive) return matches
    const rec: Candidate[] = recTools.map((tool) => ({
      kind: 'tool',
      id: tool.id,
      name: t(tool.nameKey),
      desc: t(tool.descKey),
    }))
    return [...rec, ...matches.filter((m) => m.kind === 'item' || !TOOLS.find((x) => x.id === m.id)?.acceptsText)]
  }, [recActive, matches, recTools, t])

  // 注入源：素材 chip 优先；无 chip 且无命中（升格）时用手打 query；其余不注入
  const injectSource = clip ?? (recActive && query.trim() ? query : null)

  // 匹配源 / 素材变化后高亮回到第一项（chip 在场即推荐工具，Enter 直接注入）
  useEffect(() => setHi(0), [q, clip])

  const open = q.length > 0 && focused

  function select(c: Candidate) {
    if (c.kind === 'item') {
      onOpenItem(c.item)
    } else {
      const accepts = TOOLS.find((x) => x.id === c.id)?.acceptsText
      onOpenTool(c.id, accepts ? injectSource : null)
    }
    setQuery('')
    setClip(null)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHi((h) => Math.min(h + 1, candidates.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHi((h) => Math.max(h - 1, 0))
    } else if (e.key === 'Enter') {
      const c = candidates[hi]
      if (c) select(c)
    } else if (e.key === 'Escape') {
      // 先清素材 chip，再清普通 query
      if (clip !== null) setClip(null)
      else setQuery('')
    }
  }

  return (
    <div className="relative flex min-w-40 flex-1 items-center rounded-sm border border-line bg-panel px-2 py-1 transition-colors focus-within:border-dim">
      {/* 素材 chip：只读，键入即弃（见 onChange），× 手动移除 */}
      {clip !== null && (
        <span className="mr-1.5 flex max-w-[70%] min-w-0 flex-none items-center gap-1.5 truncate rounded-xs border border-dashed border-line bg-faint px-1.5 py-0.5 text-[13px] text-dim">
          <span aria-hidden>❐</span>
          <span className="truncate">{chipLabel(clip)}</span>
          <button
            type="button"
            className="flex-none px-0.5 text-muted hover:text-text"
            aria-label={t('common.delete')}
            onClick={() => setClip(null)}
          >
            ×
          </button>
        </span>
      )}
      <input
        ref={inputRef}
        id="search"
        type="text"
        value={query}
        onChange={(e) => {
          // 第一个键入字符 = 用户接管输入框，素材让位
          if (clip !== null) setClip(null)
          setQuery(e.target.value)
        }}
        onKeyDown={onKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={t('search.placeholder')}
        aria-label={t('search.placeholder')}
        autoComplete="off"
        spellCheck={false}
        className="min-w-0 flex-1 border-0 bg-transparent p-0 font-mono text-[15px] text-text outline-none placeholder:text-muted"
      />
      {open && (
        <div className="absolute left-0 right-0 top-full z-50 max-h-80 overflow-y-auto rounded-sm border border-line bg-panel py-1 shadow-xl">
          {recActive && candidates.length > 0 && (
            <div className="px-2.5 pb-0.5 pt-1 text-[10.5px] text-muted">── {t('search.recommended')} ──</div>
          )}
          {candidates.length === 0 ? (
            <span className="block px-2.5 py-1.5 font-mono text-[12.5px] text-muted">{t('search.noHit')}</span>
          ) : (
            candidates.map((c, i) => {
              const sel = hi === i
              return (
                <button
                  key={c.kind === 'item' ? `i${c.item.id}` : `t${c.id}`}
                  type="button"
                  // 阻止 mousedown 默认行为保住输入框焦点，避免点击候选前下拉先因失焦消失
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setHi(i)}
                  onClick={() => select(c)}
                  // 高亮行用反色（文字色做底）——与全站 ::selection 同一语言，最醒目
                  className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left font-mono text-[13px] ${
                    sel ? 'bg-text text-bg' : 'text-dim'
                  }`}
                >
                  <span className={`w-9 flex-none text-[11.5px] ${sel ? 'text-bg/60' : 'text-muted'}`}>
                    {c.kind === 'tool' ? t('tools.menu') : TAG[c.item.kind]}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{c.kind === 'tool' ? c.name : c.item.title}</span>
                  <span
                    className={`max-w-[40%] flex-none truncate text-[11.5px] ${
                      sel ? 'text-bg/60' : 'text-muted'
                    }`}
                  >
                    {c.kind === 'tool' ? c.desc : c.groupName}
                  </span>
                </button>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}
