import type { Item, Kind } from "@/api/client";

// 类型顺序：网页收藏 → 应用 → 文件/文件夹 → 终端命令。
// 侧栏与搜索候选共用这一份，新加条目也要按它归位，而不是追加到末尾。
const KIND_ORDER: Record<Kind, number> = { bookmark: 0, app: 1, file: 2, command: 3 };

/**
 * 条目固定顺序：先按类型，同类型按标题（中文按拼音、忽略大小写），
 * 标题完全相同时再按 id 升序，保证同一份数据每次得到同样的次序。
 * 返回新数组，不改入参。
 */
export function sortItems(items: Item[]): Item[] {
    return [...items].sort(
        (a, b) =>
            KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
            a.title.localeCompare(b.title, "zh-Hans-CN", { sensitivity: "base" }) ||
            a.id - b.id,
    );
}
