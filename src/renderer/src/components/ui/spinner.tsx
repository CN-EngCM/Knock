import * as React from "react"
import { LoaderCircle } from "lucide-react"
import { cn } from "@/lib/utils"
function Spinner({ className, label = "Loading", decorative = false, ...props }: React.ComponentProps<"svg"> & { label?: string; decorative?: boolean }) {
  return <LoaderCircle data-slot="spinner" role={decorative ? undefined : "status"} aria-label={decorative ? undefined : label} aria-hidden={decorative || undefined} className={cn("size-4 shrink-0 animate-spin [--icon-stroke:1.5px] motion-reduce:animate-none", className)} {...props} />
}
export { Spinner }
