import { useContext } from 'react'
import { I18nContext, type I18n } from './index'

// 自定义 hook：必须包裹在 I18nProvider 内使用，否则直接抛错提示调用位置。
// 独立成文件的原因见 ./index.tsx 注释（Fast Refresh 混合导出限制）。
export function useI18n(): I18n {
  const value = useContext(I18nContext)
  if (!value) throw new Error('useI18n 必须在 <I18nProvider> 内使用')
  return value
}
