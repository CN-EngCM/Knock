import { useCallback, useEffect, useRef, useState } from 'react'
import { Terminal as XTerm, type ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { toast } from 'sonner'
import { api, onPtyEvent } from '@/api/client'
import { useI18n } from '@/i18n/useI18n'
import type { ThemeMode } from '@/theme'

// 右下终端区：每个 pty 会话一个 xterm 实例，容器随 tab 切换 display:none 保活
// （切 tab 不丢回滚缓冲；关 tab = ptyKill + dispose，会话真正结束）。
// 组件本身常驻（区域隐藏只是 CSS display:none），因此窗口藏进托盘再呼出，
// 会话与屏幕内容都还在——这正是「页内终端」的核心价值。

type Session = { id: number; label: string }

// 主题从 CSS 令牌读：auto 模式下系统切换令牌即变，跟随零成本
function themeFromVars(): ITheme {
  const cs = getComputedStyle(document.documentElement)
  const v = (n: string) => cs.getPropertyValue(n).trim()
  return {
    background: v('--panel'),
    foreground: v('--text'),
    cursor: v('--text'),
    cursorAccent: v('--bg'),
    selectionBackground: v('--glow'),
  }
}

const FONT = '"Cascadia Mono", Consolas, "Sarasa Mono SC", ui-monospace, monospace'

type Props = {
  theme: ThemeMode
  /** 区域当前是否可见（隐藏时跳过 fit：0 尺寸会让 addon 抛错） */
  visible: boolean
  /** 终端字体（font-family 值，空串 = 用上面的默认栈）与字号，来自设置 */
  font: string
  fontSize: number
  /** 外部请求新会话的信号量：只在递增时动作（无会话时从状态栏重新呼出用） */
  spawnReq: number
  /** 会话数上报：App 据此在 0 时隐藏整个终端区 */
  onSessionCount: (n: number) => void
  onHide: () => void
}

export function TerminalZone({ theme, visible, font, fontSize, spawnReq, onSessionCount, onHide }: Props) {
  const { t } = useI18n()
  const [sessions, setSessions] = useState<Session[]>([])
  const [activeId, setActiveId] = useState<number | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const terms = useRef(new Map<number, XTerm>())
  const fits = useRef(new Map<number, FitAddon>())
  const containers = useRef(new Map<number, HTMLElement>())
  const sessionsRef = useRef<Session[]>([])
  const activeIdRef = useRef<number | null>(null)
  // attach 是稳定回调（不随字体设置变身份），建实例时从 ref 读当前字体
  const fontRef = useRef({ font, fontSize })

  useEffect(() => {
    sessionsRef.current = sessions
  }, [sessions])

  useEffect(() => {
    activeIdRef.current = activeId
  }, [activeId])

  const disposeTerm = useCallback((id: number) => {
    terms.current.get(id)?.dispose()
    terms.current.delete(id)
    fits.current.delete(id)
    containers.current.delete(id)
  }, [])

  // fit 后把新尺寸同步给 pty；容器不可见（display:none）时直接跳过
  const fitAndSync = useCallback((id: number) => {
    const term = terms.current.get(id)
    const fit = fits.current.get(id)
    const el = containers.current.get(id)
    if (!term || !fit || !el || el.offsetParent === null) return
    try {
      fit.fit()
    } catch {
      /* 隐藏瞬间的 0 尺寸，忽略 */
    }
    void api.ptyResize(id, term.cols, term.rows)
  }, [])

  // 会话容器挂载 → 建 xterm 实例并接好输入输出
  const attach = useCallback(
    (el: HTMLElement | null, id: number) => {
      if (!el) {
        containers.current.delete(id)
        return
      }
      containers.current.set(id, el)
      if (terms.current.has(id)) return
      const term = new XTerm({
        fontFamily: fontRef.current.font || FONT,
        fontSize: fontRef.current.fontSize,
        lineHeight: 1.2,
        cursorBlink: true,
        scrollback: 5000,
        theme: themeFromVars(),
      })
      const fit = new FitAddon()
      term.loadAddon(fit)
      term.open(el)
      term.onData((d) => void api.ptyWrite(id, d))
      terms.current.set(id, term)
      fits.current.set(id, fit)
      // 容器有尺寸后再 fit（rAF 等一帧布局）
      requestAnimationFrame(() => {
        fitAndSync(id)
        term.focus()
      })
    },
    [fitAndSync],
  )

  const spawn = useCallback(async () => {
    const r = await api.ptySpawn()
    if (!r.ok) {
      toast.error(t('toast.error'))
      return
    }
    setSessions((prev) => [...prev, { id: r.data.id, label: r.data.label }])
    setActiveId(r.data.id)
  }, [t])

  const kill = useCallback(
    (id: number) => {
      void api.ptyKill(id)
      disposeTerm(id)
      const next = sessionsRef.current.filter((s) => s.id !== id)
      setSessions(next)
      setActiveId((cur) => (cur === id ? (next.at(-1)?.id ?? null) : cur))
    },
    [disposeTerm],
  )

  // pty 输出/退出事件：id 分发到对应 xterm。
  // 必须在 cleanup 里退订（见 preload 注释）：StrictMode 的双跑 effect
  // 会叠加监听器，双份 write 就是「终端每行显示两遍」的根因。
  useEffect(() => {
    const off = onPtyEvent((e) => {
      if (e.type === 'data') {
        terms.current.get(e.id)?.write(e.data)
        return
      }
      // shell 自己退出（exit / 进程崩溃）：渲染端被动清理
      disposeTerm(e.id)
      const next = sessionsRef.current.filter((s) => s.id !== e.id)
      setSessions(next)
      setActiveId((cur) => (cur === e.id ? (next.at(-1)?.id ?? null) : cur))
    })
    return off
  }, [disposeTerm])

  // 区域尺寸变化 → 只 fit 当前可见的会话（隐藏容器 fit 无意义）
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const ro = new ResizeObserver(() => {
      if (activeId !== null) fitAndSync(activeId)
    })
    ro.observe(root)
    return () => ro.disconnect()
  }, [activeId, fitAndSync])

  // 切 tab / 区域从隐藏恢复：重新 fit + 聚焦
  useEffect(() => {
    if (!visible || activeId === null) return
    const id = activeId
    requestAnimationFrame(() => {
      fitAndSync(id)
      terms.current.get(id)?.focus()
    })
  }, [activeId, visible, fitAndSync])

  // 主题切换 → 全部会话重设配色（auto 模式跟随系统令牌，见 themeFromVars 注释）
  useEffect(() => {
    if (theme === undefined) return
    const th = themeFromVars()
    for (const term of terms.current.values()) term.options.theme = th
  }, [theme])

  // 字体设置变化 → 已有会话同步重设（xterm 支持运行期改 fontFamily/fontSize），改完重新 fit
  useEffect(() => {
    fontRef.current = { font, fontSize }
    for (const term of terms.current.values()) {
      term.options.fontFamily = font || FONT
      term.options.fontSize = fontSize
    }
    requestAnimationFrame(() => {
      const id = activeIdRef.current
      if (id !== null) fitAndSync(id)
    })
  }, [font, fontSize, fitAndSync])

  // 会话数上报：归零时 App 隐藏整个终端区（本组件常驻不卸载，隐藏不丢会话状态）
  useEffect(() => {
    onSessionCount(sessions.length)
  }, [sessions.length, onSessionCount])

  // 外部（状态栏按钮）请求开新会话：只在信号量递增时动作，初始 0 不触发。
  // spawn 故意不进依赖——它随语言切换变身份，进依赖会在切语言时凭空开一个会话。
  useEffect(() => {
    if (spawnReq > 0) void spawn()
  }, [spawnReq])

  return (
    <div ref={rootRef} className="flex h-full min-h-0 flex-col bg-panel">
      <div className="flex flex-none items-stretch gap-0.5 border-b border-line px-2 text-[12.5px]">
        {sessions.map((s) => (
          <span
            key={s.id}
            onClick={() => setActiveId(s.id)}
            className={`mb-[-1px] flex cursor-default select-none items-center border-b pb-1 pt-1.5 ${
              activeId === s.id
                ? 'border-text text-text'
                : 'border-transparent text-muted hover:border-line hover:text-dim'
            } px-2.5`}
          >
            {s.label}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                kill(s.id)
              }}
              className="ml-1.5 px-1 text-[11px] hover:bg-faint hover:text-text"
              title={t('menu.delete')}
            >
              ×
            </button>
          </span>
        ))}
        <button
          type="button"
          onClick={() => void spawn()}
          className="flex items-center px-2.5 text-muted hover:text-text"
          title={t('term.new')}
        >
          ＋
        </button>
        <span className="flex-1" />
        <button type="button" className="tbtn self-center px-1" onClick={onHide} title={t('btn.terminal')}>
          ×
        </button>
      </div>
      <div className="relative min-h-0 flex-1">
        {sessions.map((s) => (
          <div
            key={s.id}
            ref={(el) => attach(el, s.id)}
            className="absolute inset-0 p-1"
            style={{ display: activeId === s.id ? undefined : 'none' }}
          />
        ))}
        {/* 无会话时整个区域由 App 隐藏（display:none），这里不再放空态提示 */}
      </div>
    </div>
  )
}
