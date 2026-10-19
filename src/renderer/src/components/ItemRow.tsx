import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { AppWindow, Folder, Globe, GripVertical, SquareTerminal } from "lucide-react";
import { useEffect, useState } from "react";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/context-menu";
import { api, type Item } from "@/api/client";
import { useI18n } from "@/i18n/useI18n";

// 从书签 URL 提取主机名作为图标缓存键；解析失败返回 null（不显示图标）
function faviconHost(item: Item): string | null {
    if (item.kind !== "bookmark") return null;
    try {
        return new URL(item.target).hostname;
    } catch {
        return null;
    }
}

// v2.0 无 TCP 端口，<img src="/api/favicon/..."> 相对 URL 直连已不可行，
// 改为经 IPC 桥取 blob 再转 objectURL。domain → objectURL（null = 失败）
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
    if (url === undefined) return <span className="size-4 flex-none" aria-hidden />;
    return <img src={url} alt="" className="size-4 flex-none rounded-[2px]" />;
}

/** 行首类型图标：书签有 favicon 用 favicon（失败回退地球仪），其余按条目类型取 Lucide 图标 */
function KindIcon({ item }: { item: Item }) {
    const host = faviconHost(item);
    const Icon = item.kind === "app" ? AppWindow : item.kind === "file" ? Folder : SquareTerminal;
    const fallback = <Globe className="size-3.5 text-muted-foreground" aria-hidden />;
    if (host) return <FaviconImg domain={host} fallback={fallback} />;
    return <Icon className="size-3.5 text-muted-foreground" aria-hidden />;
}

type Props = {
    item: Item;
    /** 点击直接打开；编辑与删除由右键菜单提供 */
    onOpen: (item: Item) => void;
    onEdit: (item: Item) => void;
    onDelete: (item: Item) => void;
};

export function ItemRow({ item, onOpen, onEdit, onDelete }: Props) {
    const { t } = useI18n();
    // 只有把手接收拖动事件，点击内容不会误触排序。
    const sortable = useSortable({ id: item.id });
    const style = {
        transform: CSS.Transform.toString(sortable.transform),
        transition: sortable.transition,
    };

    // 行样式:38px 宽松点击区(启动列表保留宽松密度),悬停浮填充
    const rowClass =
        "rowbtn flex h-[38px] w-full items-center gap-2.5 rounded-[4px] border border-transparent pl-2 pr-7 text-left transition-colors group-hover:bg-hover";

    const content = (
        <>
            <span className="grid size-[25px] flex-none place-items-center rounded-[5px] border border-border bg-panel">
                <KindIcon item={item} />
            </span>
            <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
                <span className="w-full truncate text-xs text-foreground">{item.title}</span>
                <span className="w-full truncate text-[10px] leading-tight text-dim-foreground">{item.target}</span>
            </span>
        </>
    );

    const row =
        item.kind === "bookmark" ? (
            <a
                href={item.target}
                target="_blank"
                rel="noreferrer"
                className={rowClass}
                // 原生链接双击会开出两个标签：普通左键改走 onOpen（App 里有同条目防抖）；
                // 带修饰键保持浏览器原生行为，中键不触发 click 天然无此问题
                onClick={(e) => {
                    if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
                    e.preventDefault();
                    onOpen(item);
                }}
            >
                {content}
            </a>
        ) : (
            <button type="button" onClick={() => onOpen(item)} className={rowClass}>
                {content}
            </button>
        );

    return (
        <ContextMenu>
            <ContextMenuTrigger asChild>
                <div ref={sortable.setNodeRef} style={style} className="group relative w-full">
                    {row}
                    <button
                        type="button"
                        ref={sortable.setActivatorNodeRef}
                        {...sortable.attributes}
                        {...sortable.listeners}
                        aria-label={t("item.reorder")}
                        title={t("item.reorder")}
                        className="absolute right-1 top-1/2 grid size-6 -translate-y-1/2 touch-none place-items-center rounded-[3px] text-dim-foreground opacity-0 hover:bg-hover group-hover:opacity-100 focus-visible:opacity-100"
                    >
                        <GripVertical className="size-3.5 cursor-grab" aria-hidden />
                    </button>
                </div>
            </ContextMenuTrigger>
            <ContextMenuContent>
                {item.kind === "bookmark" && (
                    // 走 onOpen（App 的 openItem）：与左键同款防抖 + 打开后隐藏窗口
                    <ContextMenuItem onClick={() => onOpen(item)}>{t("menu.open")}</ContextMenuItem>
                )}
                <ContextMenuItem onClick={() => onEdit(item)}>{t("menu.edit")}</ContextMenuItem>
                <ContextMenuItem variant="destructive" onClick={() => onDelete(item)}>
                    {t("menu.delete")}
                </ContextMenuItem>
            </ContextMenuContent>
        </ContextMenu>
    );
}
