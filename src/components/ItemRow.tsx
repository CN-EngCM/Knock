import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { useEffect, useState } from "react";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/context-menu";
import { api, type Item } from "@/api/client";
import { useI18n } from "@/i18n/useI18n";

// 终端风行前缀：web / app / file，对应三种条目类型
const TAG: Record<Item["kind"], string> = { bookmark: "web", app: "app", file: "file" };

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
                /* 拉取失败 = 无图标，退回纯文字行 */
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

/** 16px favicon：加载中占位、失败整体隐藏（保持原 <img> 行为） */
function FaviconImg({ domain }: { domain: string }) {
    const url = useFavicon(domain);
    if (url === null) return null;
    if (url === undefined) return <span className="size-4 flex-none" aria-hidden />;
    return <img src={url} alt="" className="size-4 flex-none rounded-[2px]" />;
}

type Props = {
    item: Item;
    editing: boolean;
    /** 编辑模式多选：勾中状态与切换回调（仅 editing 时渲染勾选框） */
    selected?: boolean;
    onToggleSelect?: (id: number) => void;
    /** 普通模式点击：bookmark 新开标签页；app/file 走后端启动器 */
    onOpen: (item: Item) => void;
    onEdit: (item: Item) => void;
    onDelete: (item: Item) => void;
};

export function ItemRow({ item, editing, selected, onToggleSelect, onOpen, onEdit, onDelete }: Props) {
    const { t } = useI18n();
    // 编辑模式下整行可拖拽排序；点击不被拖拽吞掉靠 lib/dnd 的 4px 位移阈值
    const sortable = useSortable({ id: item.id, disabled: !editing });
    const style = {
        transform: CSS.Transform.toString(sortable.transform),
        transition: sortable.transition,
    };

    // 文字统一 12.5px：与组内「new」按钮/空态文案同基准，行高压到 ~19px
    const rowClass =
        "rowbtn group flex w-full items-center gap-2 border border-transparent px-2 py-1 font-mono text-[12.5px] text-left " +
        "hover:border-line hover:bg-faint";

    const host = faviconHost(item);

    const content = (
        <>
            <span className="w-9 flex-none text-[11.5px] text-muted">{TAG[item.kind]}</span>
            {host && <FaviconImg domain={host} />}
            <span className="min-w-0 flex-1 truncate text-text">{item.title}</span>
            {editing && <GripVertical className="size-3.5 flex-none text-muted" aria-hidden />}
            <span className="flex-none text-dim opacity-0 transition-opacity group-hover:opacity-100" aria-hidden>
                ❯
            </span>
        </>
    );

    // 三种形态：编辑模式（勾选框 + 点击=编辑，可拖拽）/ 普通模式 bookmark（真链接）/ 普通模式 app+file
    // 编辑态把勾选框放在按钮外层 wrapper 里：交互元素不嵌套，点击也不会冒泡成「编辑」
    const row = editing ? (
        <div ref={sortable.setNodeRef} style={style} className="flex w-full items-center gap-1">
            <input
                type="checkbox"
                checked={!!selected}
                onChange={() => onToggleSelect?.(item.id)}
                aria-label={item.title}
                className="ml-1 size-3 flex-none accent-text"
            />
            <button
                type="button"
                {...sortable.attributes}
                {...sortable.listeners}
                onClick={() => onEdit(item)}
                className={`${rowClass} min-w-0 flex-1`}
            >
                {content}
            </button>
        </div>
    ) : item.kind === "bookmark" ? (
        <a href={item.target} target="_blank" rel="noreferrer" className={rowClass}>
            {content}
        </a>
    ) : (
        <button type="button" onClick={() => onOpen(item)} className={rowClass}>
            {content}
        </button>
    );

    // 右键菜单随时可用（不限编辑模式）
    return (
        <ContextMenu>
            <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
            <ContextMenuContent>
                {item.kind === "bookmark" && (
                    <ContextMenuItem onClick={() => window.open(item.target, "_blank", "noreferrer")}>
                        {t("menu.open")}
                    </ContextMenuItem>
                )}
                <ContextMenuItem onClick={() => onEdit(item)}>{t("menu.edit")}</ContextMenuItem>
                <ContextMenuItem variant="destructive" onClick={() => onDelete(item)}>
                    {t("menu.delete")}
                </ContextMenuItem>
            </ContextMenuContent>
        </ContextMenu>
    );
}
