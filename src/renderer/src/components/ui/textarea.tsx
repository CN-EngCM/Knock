import * as React from "react"
import { cn } from "@/lib/utils"
import { inputSurface } from "@/components/ui/input"
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return <textarea data-slot="textarea" className={cn(inputSurface, "flex min-h-16 w-full px-2 py-1.5 leading-5 disabled:cursor-default", className)} {...props} />
}
export { Textarea }
