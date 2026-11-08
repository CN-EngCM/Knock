import type { Item } from "@/api/client";
import { fileIconUrl, folderIconUrl, hasIcon, namedIconUrl } from "@/lib/fileIcon";

// 快捷启动条目的图标取自 Material Icon Theme 图标包，列表和搜索候选长得一样。用户手选了图标（item.icon）就用手选的；没选（自动）时，
// 网页、应用、终端命令没有文件名可匹配，各用包里固定的一张，文件类条目按目标的文件名 / 文件夹名匹配。
const FIXED_ICON = { bookmark: "http", app: "exe", command: "console" } as const;

/** 路径最后一段；末尾带分隔符（`D:\docs\`）时取它前面那段，否则文件夹图标会匹配到空名字 */
function baseName(path: string): string {
    return path.split(/[\\/]/).filter(Boolean).pop() ?? "";
}

function iconUrl(item: Item, isDir: boolean, light: boolean): string {
    // 库里的图标名认不得（旧版遗留、包升级删了）就当没选，走自动
    if (item.icon && hasIcon(item.icon)) return namedIconUrl(item.icon, light);
    if (item.kind !== "file") return namedIconUrl(FIXED_ICON[item.kind], light);
    const name = baseName(item.target);
    return isDir ? folderIconUrl(name, false, light) : fileIconUrl(name, light);
}

/**
 * 行首类型图标，18px。`isDir` 来自 App 的目录判定（只有 file 类才会是 true），
 * 判定结果回来之前文件夹条目会先按文件显示，回来后换成文件夹图标。
 */
export function KindIcon({ item, isDir, light }: { item: Item; isDir: boolean; light: boolean }) {
    return <img src={iconUrl(item, isDir, light)} alt="" className="size-[18px] flex-none" />;
}

/** 本机文件夹的图标，按文件夹名匹配 */
export function FolderIcon({ path, light }: { path: string; light: boolean }) {
    return <img src={folderIconUrl(baseName(path), false, light)} alt="" className="size-[18px] flex-none" />;
}
