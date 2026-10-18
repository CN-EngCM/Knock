import * as React from "react";
import { Toaster as Sonner, type ToasterProps } from "sonner";
import { CircleCheck, Info, TriangleAlert, OctagonX, LoaderCircle } from "lucide-react";
import { cn } from "@/lib/utils";

// 跟随应用主题：监听 html 的 dark 类，主题切换时即时更新。
function useAppTheme(): "dark" | "light" {
    const [theme, setTheme] = React.useState<"dark" | "light">(() =>
        document.documentElement.classList.contains("dark") ? "dark" : "light",
    );
    React.useEffect(() => {
        const root = document.documentElement;
        const sync = () => setTheme(root.classList.contains("dark") ? "dark" : "light");
        const observer = new MutationObserver(sync);
        observer.observe(root, { attributes: true, attributeFilter: ["class"] });
        return () => observer.disconnect();
    }, []);
    return theme;
}

function Toaster({ theme, className, style, toastOptions, icons, ...props }: ToasterProps) {
    const appTheme = useAppTheme();
    return (
        <Sonner
            theme={theme ?? appTheme}
            className={cn("toaster group", theme != null && "toaster-explicit", className)}
            closeButton
            icons={{
                success: <CircleCheck className="size-4" />,
                info: <Info className="size-4" />,
                warning: <TriangleAlert className="size-4" />,
                error: <OctagonX className="size-4" />,
                loading: <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />,
                ...icons,
            }}
            style={
                {
                    "--normal-bg": theme == null ? "var(--muted)" : undefined,
                    "--normal-text": theme == null ? "var(--foreground)" : undefined,
                    "--normal-border": theme == null ? "var(--border)" : undefined,
                    "--border-radius": "var(--radius)",
                    "--font-sans": "var(--font-sans)",
                    ...style,
                } as React.CSSProperties
            }
            toastOptions={{
                ...toastOptions,
                style: {
                    fontFamily: "var(--font-sans)",
                    fontSize: 12,
                    transitionDuration: "var(--motion-duration)",
                    animationDuration: "var(--motion-duration)",
                    transitionTimingFunction: "var(--motion-ease)",
                    boxShadow: "var(--shadow-toast, 0 6px 22px rgb(0 0 0 / 46.7%), 0 1px 3px rgb(0 0 0 / 26.7%))",
                    ...toastOptions?.style,
                },
                classNames: {
                    toast: "cursor-default motion-reduce:transition-none! motion-reduce:animate-none!",
                    ...toastOptions?.classNames,
                },
            }}
            {...props}
        />
    );
}
export { Toaster };
export { toast } from "sonner";
