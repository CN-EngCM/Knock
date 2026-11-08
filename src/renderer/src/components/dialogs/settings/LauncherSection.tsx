import { useMemo, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FieldDescription } from "@/components/ui/field";
import type { FolderAction, Item } from "@/api/client";
import { KindIcon } from "@/lib/kindIcon";
import { sortItems } from "@/lib/itemOrder";
import { useI18n } from "@/i18n/useI18n";
import { FolderActionDialog } from "../FolderActionDialog";

/** 动作个数上限，与主进程 folderActionsSchema 一致（渲染进程不能 import 它的值） */
const MAX_FOLDER_ACTIONS = 10;

type Props = {
    items: Item[];
    /** 目标经运行时确认是本机目录的条目 id：决定显示文件夹图标 */
    dirIds: ReadonlySet<number>;
    light: boolean;
    onAdd: () => void;
    onEdit: (item: Item) => void;
    onDelete: (item: Item) => void;
    /** 文件夹动作列表（null = 还没拉到）与整份保存：返回 false = 没存成（App 已 toast） */
    folderActions: FolderAction[] | null;
    onSaveFolderActions: (actions: FolderAction[]) => Promise<boolean>;
};

/** 快速启动分节：条目的新增、编辑、删除只在这里（主界面没有侧栏了）。
 *  顺序与搜索下拉一致（sortItems）；条目弹窗和删除确认框由 App 持有，叠在设置页上面。
 *  下半段是文件夹动作（文件夹条目按 → 的子菜单项），列表小，弹窗由本组件自己持有 */
export function LauncherSection({
    items,
    dirIds,
    light,
    onAdd,
    onEdit,
    onDelete,
    folderActions,
    onSaveFolderActions,
}: Props) {
    const { t } = useI18n();
    const sorted = useMemo(() => sortItems(items), [items]);
    const actions = folderActions ?? [];
    // 弹窗状态：index 是正在编辑的第几个，-1 = 新增，null = 没开
    const [editing, setEditing] = useState<number | null>(null);

    // 新增追加到最后，编辑原地替换；弹窗在 ok 时才关，所以这里把保存结果原样交回去
    function submitAction(action: FolderAction): Promise<boolean> {
        const next =
            editing === null || editing < 0
                ? [...actions, action]
                : actions.map((a, i) => (i === editing ? action : a));
        return onSaveFolderActions(next);
    }

    return (
        <>
            <div className="flex items-start justify-between gap-3">
                <FieldDescription className="px-1 text-small text-dim-foreground">
                    {t("settings.launcher.hint")}
                </FieldDescription>
                <Button
                    type="button"
                    appearance="standard"
                    variant="outline"
                    size="sm"
                    className="flex-none"
                    onClick={onAdd}
                >
                    <Plus className="size-3.5" />
                    {t("settings.launcher.add")}
                </Button>
            </div>

            {sorted.length === 0 ? (
                <p className="px-1 py-4 text-center text-xs text-dim-foreground">{t("settings.launcher.empty")}</p>
            ) : (
                // 列宽必须是 minmax(0,1fr)：网格默认的列按内容撑宽，一条很长的路径会把整页撑出横向滚动条，
                // 行里 truncate 的省略号也就没机会生效
                <ul className="grid grid-cols-[minmax(0,1fr)] gap-0.5">
                    {sorted.map((item) => (
                        <li
                            key={item.id}
                            className="flex h-8 items-center gap-2.5 rounded-sm px-2 hover:bg-(--state-hover)"
                        >
                            <KindIcon item={item} isDir={dirIds.has(item.id)} light={light} />
                            <span className="max-w-[40%] flex-none truncate text-xs">{item.title}</span>
                            <span
                                title={item.target}
                                className="min-w-0 flex-1 truncate font-mono text-[11px] text-dim-foreground"
                            >
                                {item.target}
                            </span>
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="size-6"
                                onClick={() => onEdit(item)}
                                aria-label={`${t("menu.edit")} ${item.title}`}
                                title={t("menu.edit")}
                            >
                                <Pencil className="size-3.5" />
                            </Button>
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="size-6"
                                onClick={() => onDelete(item)}
                                aria-label={`${t("menu.delete")} ${item.title}`}
                                title={t("menu.delete")}
                            >
                                <Trash2 className="size-3.5" />
                            </Button>
                        </li>
                    ))}
                </ul>
            )}

            <div className="mt-3 flex items-start justify-between gap-3 border-t border-line pt-4">
                <div className="grid gap-1 px-1">
                    <h3 className="text-xs font-medium">{t("settings.folderActions")}</h3>
                    <FieldDescription className="text-small text-dim-foreground">
                        {t("settings.folderActions.hint")}
                    </FieldDescription>
                </div>
                <Button
                    type="button"
                    appearance="standard"
                    variant="outline"
                    size="sm"
                    className="flex-none"
                    disabled={actions.length >= MAX_FOLDER_ACTIONS}
                    title={actions.length >= MAX_FOLDER_ACTIONS ? t("settings.folderActions.full") : undefined}
                    onClick={() => setEditing(-1)}
                >
                    <Plus className="size-3.5" />
                    {t("settings.folderActions.add")}
                </Button>
            </div>

            {actions.length === 0 ? (
                <p className="px-1 py-4 text-center text-xs text-dim-foreground">{t("settings.folderActions.empty")}</p>
            ) : (
                <ul className="grid grid-cols-[minmax(0,1fr)] gap-0.5">
                    {actions.map((a, i) => (
                        <li
                            // 动作没有 id，列表又是整份替换，用序号当 key 就够
                            key={i}
                            className="flex h-8 items-center gap-2.5 rounded-sm px-2 hover:bg-(--state-hover)"
                        >
                            <span className="max-w-[40%] flex-none truncate text-xs">{a.name}</span>
                            <span
                                title={a.command}
                                className="min-w-0 flex-1 truncate font-mono text-[11px] text-dim-foreground"
                            >
                                {a.command}
                            </span>
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="size-6"
                                onClick={() => setEditing(i)}
                                aria-label={`${t("menu.edit")} ${a.name}`}
                                title={t("menu.edit")}
                            >
                                <Pencil className="size-3.5" />
                            </Button>
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="size-6"
                                onClick={() => void onSaveFolderActions(actions.filter((_, j) => j !== i))}
                                aria-label={`${t("menu.delete")} ${a.name}`}
                                title={t("menu.delete")}
                            >
                                <Trash2 className="size-3.5" />
                            </Button>
                        </li>
                    ))}
                </ul>
            )}

            <FolderActionDialog
                open={editing !== null}
                action={editing !== null && editing >= 0 ? (actions[editing] ?? null) : null}
                onClose={() => setEditing(null)}
                onSubmit={submitAction}
            />
        </>
    );
}
