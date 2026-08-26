import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { api, type Shortcut } from '@/api/client'
import { useI18n } from '@/i18n/useI18n'

type Props = {
  open: boolean
  onClose: () => void
  /** 选中一条快捷方式：回填 target（.lnk 路径）与标题 */
  onPick: (shortcut: Shortcut) => void
}

// Windows 开始菜单/桌面快捷方式选择器（列表来自 GET /api/shortcuts）
export function ShortcutPickerDialog({ open, onClose, onPick }: Props) {
  const { t } = useI18n()
  const [shortcuts, setShortcuts] = useState<Shortcut[] | null>(null)
  const [query, setQuery] = useState('')

  // 打开时拉取一次（服务端有进程内缓存，重复打开不重扫）
  useEffect(() => {
    if (!open) return
    setShortcuts(null)
    setQuery('')
    api
      .listShortcuts(false)
      .then((r) => setShortcuts(r.ok ? r.data.shortcuts : []))
      .catch(() => {
        toast.error(t('toast.error'))
        setShortcuts([])
      })
  }, [open, t])

  const q = query.trim().toLowerCase()
  const visible = (shortcuts ?? []).filter(
    (s) => !q || s.name.toLowerCase().includes(q) || s.target.toLowerCase().includes(q),
  )

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="font-mono sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{t('picker.title')}</DialogTitle>
        </DialogHeader>

        <Input
          placeholder={t('picker.placeholder')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />

        <div className="max-h-[50vh] overflow-y-auto border border-line">
          {shortcuts === null && (
            <div className="px-3 py-6 text-center text-[13px] text-muted">{t('picker.loading')}</div>
          )}
          {shortcuts !== null && visible.length === 0 && (
            <div className="px-3 py-6 text-center text-[13px] text-muted">{t('picker.empty')}</div>
          )}
          {visible.map((s) => (
            <button
              key={s.lnk}
              type="button"
              onClick={() => {
                onPick(s)
                onClose()
              }}
              className="flex w-full flex-col gap-0.5 border-b border-line px-3 py-2 text-left last:border-b-0 hover:bg-faint"
            >
              <span className="truncate text-[13.5px] text-text">{s.name}</span>
              {s.target && <span className="truncate text-[11.5px] text-muted">{s.target}</span>}
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
