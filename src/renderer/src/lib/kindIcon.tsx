import { useEffect, useState } from "react";
import { AppWindow, Folder, Globe, SquareTerminal } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { api, type Item } from "@/api/client";

// 从书签 URL 提取主机名作为图标缓存键；解析失败返回 null（不显示图标）
function faviconHost(item: Item): string | null {
    if (item.kind !== "bookmark") return null;
    try {
        return new URL(item.target).hostname;
    } catch {
        return null;
    }
}

// 无 TCP 端口，经 IPC 桥取 blob 再转 objectURL。domain → objectURL（null = 失败）
// 会话级缓存，同一域名的图标只拉一次。
const faviconCache = new Map<string, string | null>();

function useFavicon(domain: string): string | null | undefined {
    const cached = faviconCache.get(domain);
    const [url, setUrl] = useState<string | null | undefined>(cached);
    useEffect(() => {
        if (faviconCache.has(domain)) {
            setUrl(faviconCache.get(domain));
            return;
        }
        let alive = true;
        (async () => {
            let next: string | null = null;
            try {
                const r = await api.getFavicon(domain);
                if (r.ok) next = URL.createObjectURL(new Blob([r.data.bytes], { type: r.data.mime }));
            } catch {
                /* 拉取失败 = 无图标，退回类型图标 */
            }
            faviconCache.set(domain, next);
            if (alive) setUrl(next);
        })();
        return () => {
            alive = false;
        };
    }, [domain]);
    return url;
}

/** 16px favicon：加载中占位、失败渲染回退（类型图标） */
function FaviconImg({ domain, fallback }: { domain: string; fallback: React.ReactNode }) {
    const url = useFavicon(domain);
    if (url === null) return <>{fallback}</>;
    if (url === undefined) return <Skeleton className="size-4 flex-none" />;
    return <img src={url} alt="" className="size-4 flex-none rounded-[2px]" />;
}

/** 行首类型图标：书签有 favicon 用 favicon（失败回退地球仪），其余按条目类型取 Lucide 图标 */
export function KindIcon({ item }: { item: Item }) {
    const host = faviconHost(item);
    const Icon = item.kind === "app" ? AppWindow : item.kind === "file" ? Folder : SquareTerminal;
    const fallback = <Globe className="size-3.5 text-muted-foreground" aria-hidden />;
    if (host) return <FaviconImg domain={host} fallback={fallback} />;
    return <Icon className="size-3.5 text-muted-foreground" aria-hidden />;
}
