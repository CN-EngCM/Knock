import * as React from "react"
import { cn } from "@/lib/utils"

export const inputSurface = "cursor-default rounded-[4px] border-0 bg-[var(--control-input-background)] text-xs text-foreground shadow-[inset_0_1px_2px_#0001,inset_0_0_0_0.5px_var(--control-input-edge),0_1px_0_#ffffffd9] dark:shadow-[inset_0_1px_2px_#0003,inset_0_0_0_0.5px_var(--control-input-edge),0_0.5px_0_#ffffff12] placeholder:text-muted-foreground disabled:opacity-(--state-disabled-opacity) aria-invalid:[outline-style:solid] aria-invalid:outline-1 aria-invalid:outline-destructive"
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return <input type={type} data-slot="input" className={cn(inputSurface, "h-(--size-control-md) w-full min-w-0 px-(--space-md) py-1 data-[slot=input]:focus:bg-[var(--control-input-focus-background)] file:me-(--space-md) file:h-(--size-input-button) file:align-top file:rounded-[3px] file:border file:border-[var(--file-button-edge)] file:bg-linear-to-b file:from-[var(--file-button-top)] file:to-[var(--file-button-bottom)] file:px-(--space-md) file:py-0 file:text-xs file:font-medium file:leading-[calc(var(--size-input-button)-1px)] file:text-foreground file:shadow-[inset_0_0.5px_0_#ffffff26,inset_0_-0.5px_0_#00000028,0_0.5px_0_#00000030] disabled:cursor-default", type === "file" && "h-(--size-input-file) p-[3px] leading-(--size-input-button)", className)} {...props} />
}
export { Input }
