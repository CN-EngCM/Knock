import type { Item } from "@/api/client";
import { fileIconUrl, folderIconUrl } from "@/lib/fileIcon";
import { isKnownIcon, itemIconUrl, useIconSets } from "@/lib/iconSets";

// 快捷启动条目的图标默认取自文件树同一个图标包（Material Icon Theme），列表、工具栏、搜索候选
// 与文件树里的同一个文件长得一样。用户手选了图标（item.icon，可能是带前缀的新图标库，见 lib/iconSets.ts）
// 就用手选的；没选（自动）时，网页、应用、终端命令没有文件名可匹配，各用包里固定的一张，
// 文件类条目按目标的文件名 / 文件夹名匹配。
const FIXED_ICON = { bookmark: "http", app: "exe", command: "console" } as const;

/** 路径最后一段；末尾带分隔符（`D:\docs\`）时取它前面那段，否则文件夹图标会匹配到空名字 */
function baseName(path: string): string {
    return path.split(/[\\/]/).filter(Boolean).pop() ?? "";
}

/**
 * 条目能直接定下来的图标名：手选的优先，没选（或库里的名字认不得，如旧版遗留、包升级删了）
 * 就用该类型固定的一张。文件类要按目标的文件名 / 文件夹名匹配，没有固定名，返回 null。
 * 开成停靠面板的网页、终端命令条目，标签图标就取这个名字。
 */
export function itemIconName(item: Item): string | null {
    if (item.icon && isKnownIcon(item.icon)) return item.icon;
    return item.kind === "file" ? null : FIXED_ICON[item.kind];
}

function iconUrl(item: Item, isDir: boolean, light: boolean): string {
    const named = itemIconName(item);
    if (named) return itemIconUrl(named, light);
    const name = baseName(item.target);
    return isDir ? folderIconUrl(name, false, light) : fileIconUrl(name, light);
}

/**
 * 行首类型图标，18px。`isDir` 来自 App 的目录判定（只有 file 类才会是 true），
 * 判定结果回来之前文件夹条目会先按文件显示，回来后换成文件夹图标。
 */
export function KindIcon({ item, isDir, light }: { item: Item; isDir: boolean; light: boolean }) {
    // 手选了新图标库里的图标时，库载入完要重画；不订阅的话占位图会一直留着
    useIconSets();
    return <img src={iconUrl(item, isDir, light)} alt="" className="size-[18px] flex-none" />;
}

/** 本机文件夹的图标，按文件夹名匹配，与文件树里同一个文件夹一致 */
export function FolderIcon({ path, light }: { path: string; light: boolean }) {
    return <img src={folderIconUrl(baseName(path), false, light)} alt="" className="size-[18px] flex-none" />;
}
