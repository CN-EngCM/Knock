import * as React from "react"
import { readSizeToken, subscribeDensity } from "@/lib/density"

/**
 * 像素令牌（如 `--size-tree-row`）在 `ref` 元素上的计算值，密度变化时重新读取。
 * 给虚拟化的行高估算用：行高由 CSS 令牌决定，JS 估算必须读同一个值，密度切换后才不会错位。
 * 首帧在布局阶段读取并同步重渲染，先于绘制；元素尚未挂载时返回 `fallback`。
 */
export function useSizeToken(ref: React.RefObject<Element | null>, name: string, fallback: number): number {
  const [size, setSize] = React.useState(fallback)
  React.useLayoutEffect(() => {
    const read = () => setSize(readSizeToken(ref.current, name, fallback))
    read()
    // 只有 `data-density` 变在元素自身或祖先上才会改变它的令牌值，其余变化不必重读计算样式。
    return subscribeDensity((records) => {
      const element = ref.current
      if (!element || records.some((record) => record.target.contains(element))) read()
    })
  }, [ref, name, fallback])
  return size
}
