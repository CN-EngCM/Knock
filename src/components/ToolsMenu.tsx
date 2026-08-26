import { useEffect, useRef, useState } from 'react'
import { TOOLS, type ToolId } from '@/tools/registry'
import { useI18n } from '@/i18n/useI18n'

// 搜索行右侧的「工具 ▾」下拉：内置工具的唯一入口。
// ● = 已打开（点它只是切到该 tab），○ = 未打开（点它在工具区开新 tab）。
type Props = {
  open: ToolId[]
  onOpen: (id: ToolId) => void
}

export function ToolsMenu({ open, onOpen }: Props) {
  const { t } = useI18n()
  const [show, setShow] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)

  // 打开状态下点外部 / Esc 关闭；菜单未打开时不挂监听
  useEffect(() => {
    if (!show) return
    const close = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setShow(false)
    }
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShow(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', esc)
    }
  }, [show])

  return (
    <div ref={wrap} className="relative flex-none">
      <button
        type="button"
        aria-expanded={show}
        className="tbtn border border-line px-2.5 py-1 text-[12.5px] hover:bg-faint"
        onClick={() => setShow((v) => !v)}
      >
        [ {t('tools.menu')} ▾ ]
      </button>
      {show && (
        <div className="absolute right-0 top-[calc(100%+8px)] z-50 min-w-80 border border-line bg-panel p-1 shadow-xl">
          {TOOLS.map((tool) => (
            <button
              key={tool.id}
              type="button"
              className="flex w-full items-baseline justify-between gap-6 whitespace-nowrap px-2.5 py-1.5 text-left text-[12.5px] text-dim hover:bg-faint hover:text-text"
              onClick={() => {
                onOpen(tool.id)
                setShow(false)
              }}
            >
              <span>
                {open.includes(tool.id) ? '●' : '○'} {t(tool.nameKey)}
              </span>
              <span className="text-[11.5px] text-muted">{t(tool.descKey)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
