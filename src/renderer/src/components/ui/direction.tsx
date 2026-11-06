import * as React from "react"
import { Direction as DirectionPrimitive } from "radix-ui"

type DirectionValue = "ltr" | "rtl"
const DirectionContext = React.createContext<DirectionValue | undefined>(undefined)
/** Bridges DOM direction and the existing Radix controls, including their portal content. */
function DirectionProvider({ dir, children, ...props }: React.ComponentProps<"div"> & { dir: DirectionValue }) {
  return <DirectionContext.Provider value={dir}><DirectionPrimitive.Provider dir={dir}><div data-slot="direction" dir={dir} {...props}>{children}</div></DirectionPrimitive.Provider></DirectionContext.Provider>
}
function useDirection(explicitDirection?: DirectionValue): DirectionValue {
  const inherited = React.useContext(DirectionContext)
  return explicitDirection ?? inherited ?? "ltr"
}
const Direction = DirectionProvider
export { Direction, DirectionProvider, useDirection }
export type { DirectionValue }
