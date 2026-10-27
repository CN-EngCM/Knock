import * as React from "react"
import { inheritOverlayDensity, trackOverlayOrigins, type OverlayDensityOptions } from "@/lib/density"

// 越早登记越好：浮层挂载前的最近交互才能当起源兜底。
trackOverlayOrigins()

function assignRef<T>(ref: React.Ref<T> | undefined, node: T | null) {
  if (typeof ref === "function") return ref(node)
  if (ref) (ref as React.RefObject<T | null>).current = node
}

/**
 * 浮层内容的 ref：挂载时（提交阶段、绘制之前，不会闪一帧）把起源处的密度写到内容根上，
 * 同时转发调用方自己的 `ref`。规则见 `src/lib/density.ts` 的 `inheritOverlayDensity`。
 * `originRef` 给没有 aria 关联的自研浮层（如 Menu 的触发器）。
 */
export function useOverlayDensity<T extends HTMLElement>(
  ref?: React.Ref<T>,
  { hover, originRef }: { hover?: boolean; originRef?: React.RefObject<Element | null> } = {},
) {
  return React.useCallback(
    (node: T | null) => {
      const cleanup = assignRef(ref, node)
      if (node) {
        const options: OverlayDensityOptions = { hover, origin: originRef?.current }
        inheritOverlayDensity(node, options)
      }
      // 调用方的回调 ref 可能返回清理函数（React 19）；否则卸载时按惯例传 null。
      return () => {
        if (typeof cleanup === "function") cleanup()
        else if (node) assignRef(ref, null)
      }
    },
    [ref, hover, originRef],
  )
}
