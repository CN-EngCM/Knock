import type { DirEntry } from "@/api/client";

/**
 * 同层排序：目录在前，文件在后，各自按名称升序（中文按拼音、忽略大小写）。
 * 主进程只管读，排序放这里，与 itemOrder.ts 同一套口径。返回新数组，不改入参。
 */
export function sortEntries(entries: DirEntry[]): DirEntry[] {
    return [...entries].sort(
        (a, b) =>
            Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name, "zh-Hans-CN", { sensitivity: "base" }),
    );
}
