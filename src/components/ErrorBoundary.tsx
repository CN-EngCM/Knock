import { Component, type ReactNode } from 'react'

// 错误边界：任何子树渲染抛错时兜底，避免整页白屏。
// 放在 I18nProvider 外层（崩溃时可能连 i18n 都不可用），文案直接双语写死。
type Props = { children: ReactNode }
type State = { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  // React 约定：渲染错误交给这里返回新 state
  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-bg px-6 text-center font-mono">
        <p className="text-[15px] text-text">──[ 页面出错 / Something went wrong ]──</p>
        <p className="max-w-[520px] break-all text-[12.5px] text-muted">{String(this.state.error)}</p>
        <button
          className="border border-line px-4 py-2 text-[13px] text-dim hover:text-text"
          onClick={() => window.location.reload()}
        >
          [ 刷新 / Reload ]
        </button>
      </div>
    )
  }
}
