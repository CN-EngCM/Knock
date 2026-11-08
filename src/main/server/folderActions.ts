import { folderActionsSchema, type FolderAction } from "./schemas";
import { getSetting, setSetting } from "./util/settings";

// 文件夹动作列表，存 settings 表的 folderActions（JSON 数组）。
// 键不存在 = 用预置两项；用户一保存就整份写入，删光存 []（不会被预置顶回来）。
const KEY = "folderActions";

const DEFAULT_ACTIONS: FolderAction[] = [
    { name: "opencode", command: "opencode", autoClose: false },
    { name: "Claude Code", command: "claude", autoClose: false },
];

export function readFolderActions(): FolderAction[] {
    const raw = getSetting(KEY, "");
    if (raw === "") return DEFAULT_ACTIONS;
    try {
        const r = folderActionsSchema.safeParse(JSON.parse(raw));
        return r.success ? r.data : DEFAULT_ACTIONS; // 库里的值被手改坏了，当作没存过
    } catch {
        return DEFAULT_ACTIONS;
    }
}

export function writeFolderActions(actions: FolderAction[]): void {
    setSetting(KEY, JSON.stringify(actions));
}
