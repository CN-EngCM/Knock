import * as React from "react"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheck, Info, TriangleAlert, OctagonX, LoaderCircle } from "lucide-react"
import { cn } from "@/lib/utils"

// 跟随应用主题：监听 html 的 dark 类，主题切换时即时更新。
// 应用偏好为 system 时，applyPreviewTheme 会随系统外观同步 dark 类，这里无需单独处理系统外观；
// 显式传入 theme="system" 时则交给 Sonner 自己监听 prefers-color-scheme。
function useAppTheme(): "dark" | "light" {
  const [theme, setTheme] = React.useState<"dark" | "light">(() =>
    document.documentElement.classList.contains("dark") ? "dark" : "light",
  )
  React.useEffect(() => {
    const root = document.documentElement
    const sync = () => setTheme(root.classList.contains("dark") ? "dark" : "light")
    const observer = new MutationObserver(sync)
    observer.observe(root, { attributes: true, attributeFilter: ["class"] })
    return () => observer.disconnect()
  }, [])
  return theme
}

function Toaster({ theme, className, style, toastOptions, icons, ...props }: ToasterProps) {
  const appTheme = useAppTheme()
  return <Sonner theme={theme ?? appTheme} className={cn("toaster group", theme != null && "toaster-explicit", className)} closeButton
    icons={{ success: <CircleCheck className="size-4" />, info: <Info className="size-4" />, warning: <TriangleAlert className="size-4" />, error: <OctagonX className="size-4" />, loading: <LoaderCircle className="size-4 animate-spin [--icon-stroke:1.5px] motion-reduce:animate-none" />, ...icons }}
    style={{ "--normal-bg": theme == null ? "var(--muted)" : undefined, "--normal-text": theme == null ? "var(--foreground)" : undefined, "--normal-border": theme == null ? "var(--border)" : undefined, "--border-radius": "var(--radius)", ...style } as React.CSSProperties}
    toastOptions={{ ...toastOptions, style: { fontFamily: "var(--font-sans)", fontSize: 12, transitionDuration: "var(--motion-standard-in)", animationDuration: "var(--motion-standard-in)", transitionTimingFunction: "var(--motion-ease)", boxShadow: "var(--shadow-toast)", ...toastOptions?.style }, classNames: { toast: "cursor-default motion-reduce:transition-none! motion-reduce:animate-none!", ...toastOptions?.classNames } }}
    {...props}
  />
}
export { Toaster }
export { toast } from "sonner"
