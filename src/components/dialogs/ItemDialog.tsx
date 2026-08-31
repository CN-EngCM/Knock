import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ShortcutPickerDialog } from "./ShortcutPickerDialog";
import { api, type Group, type Item, type Kind } from "@/api/client";
import { useI18n } from "@/i18n/useI18n";

// 表单值：提交前保证 args 为 null（而非空串），与数据库约定一致
export type ItemFormValues = {
    kind: Kind;
    title: string;
    target: string;
    args: string | null;
    group_id: number;
};

type Props = {
    open: boolean;
    groups: Group[];
    /** 编辑时传入；新建时为 null */
    item: Item | null;
    /** 新建时的预选分组 */
    defaultGroupId?: number;
    /** 服务端平台（win32 才显示快捷方式选择器） */
    platform: string;
    onClose: () => void;
    onSubmit: (values: ItemFormValues) => Promise<void>;
};

export function ItemDialog({ open, groups, item, defaultGroupId, platform, onClose, onSubmit }: Props) {
    const { t } = useI18n();
    const [kind, setKind] = useState<Kind>("bookmark");
    const [title, setTitle] = useState("");
    const [target, setTarget] = useState("");
    const [args, setArgs] = useState("");
    const [groupId, setGroupId] = useState<number>(groups[0]?.id ?? 0);
    const [saving, setSaving] = useState(false);
    const [pickerOpen, setPickerOpen] = useState(false);

    // 每次打开时用 item / 默认值重置表单（编辑回填）
    useEffect(() => {
        if (!open) return;
        setKind(item?.kind ?? "bookmark");
        setTitle(item?.title ?? "");
        setTarget(item?.target ?? "");
        setArgs(item?.args ?? "");
        setGroupId(item?.group_id ?? defaultGroupId ?? groups[0]?.id ?? 0);
    }, [open, item, defaultGroupId, groups]);

    const targetLabel =
        kind === "bookmark"
            ? t("item.target.bookmark")
            : kind === "app"
              ? t("item.target.app")
              : kind === "command"
                ? t("item.target.command")
                : t("item.target.file");

    // 目录选择框：成功回填工作目录；取消（null）与失败都保持原值不动
    async function browseDir() {
        const r = await api.pickDirectory();
        if (r.ok && r.data !== null) setArgs(r.data);
    }

    // 目标选择框：app = 选可执行文件，file = 文件/文件夹皆可选；取消与失败保持原值不动
    async function browseTarget() {
        const r = await api.pickFile(kind === "app" ? "app" : "path");
        if (!r.ok || r.data === null) return;
        setTarget(r.data);
        // 标题为空时跟随文件名（与快捷方式选择器行为一致）
        if (!title.trim()) {
            const base = r.data.split(/[\\/]/).pop() ?? "";
            setTitle(base.replace(/\.[^.]+$/, ""));
        }
    }

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        // 必填兜底：标题与目标不能为空
        if (!title.trim() || !target.trim() || !groupId) {
            toast.error(t("toast.error"));
            return;
        }
        setSaving(true);
        try {
            await onSubmit({
                kind,
                title: title.trim(),
                // 书签缺协议时自动补 https://（否则 href 会变成站内相对路径）
                target:
                    kind === "bookmark" && !/^https?:\/\//i.test(target.trim())
                        ? `https://${target.trim()}`
                        : target.trim(),
                // 仅 app/command 复用 args 列（启动参数 / 工作目录），其余类型一律置 null
                args: (kind === "app" || kind === "command") && args.trim() ? args.trim() : null,
                group_id: groupId,
            });
            onClose();
        } catch {
            toast.error(t("toast.error"));
        } finally {
            setSaving(false);
        }
    }

    return (
        <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{item ? t("item.edit") : t("item.new")}</DialogTitle>
                </DialogHeader>

                <form onSubmit={handleSubmit} className="grid gap-4">
                    <div className="grid grid-cols-[5.5rem_1fr] items-center gap-3">
                        <Label htmlFor="item-kind">{t("item.kind")}</Label>
                        <Select value={kind} onValueChange={(v) => setKind(v as Kind)}>
                            <SelectTrigger id="item-kind" className="w-full">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="bookmark">{t("item.kind.bookmark")}</SelectItem>
                                <SelectItem value="app">{t("item.kind.app")}</SelectItem>
                                <SelectItem value="file">{t("item.kind.file")}</SelectItem>
                                <SelectItem value="command">{t("item.kind.command")}</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="grid grid-cols-[5.5rem_1fr] items-center gap-3">
                        <Label htmlFor="item-title">{t("item.title")}</Label>
                        <Input
                            id="item-title"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            required
                            maxLength={100}
                        />
                    </div>

                    <div className="grid grid-cols-[5.5rem_1fr] items-center gap-3">
                        <Label htmlFor="item-target">{t("item.target")}</Label>
                        <div className="flex gap-2">
                            <Input
                                id="item-target"
                                placeholder={targetLabel}
                                value={target}
                                onChange={(e) => setTarget(e.target.value)}
                                required
                                maxLength={1000}
                                className="flex-1"
                            />
                            {kind === "app" && platform === "win32" && (
                                <Button
                                    type="button"
                                    variant="outline"
                                    className="flex-none whitespace-nowrap"
                                    onClick={() => setPickerOpen(true)}
                                >
                                    {t("item.pickShortcut")}
                                </Button>
                            )}
                            {(kind === "app" || kind === "file") && (
                                <Button
                                    type="button"
                                    variant="outline"
                                    className="flex-none whitespace-nowrap"
                                    onClick={() => void browseTarget()}
                                >
                                    {t("btn.browse")}
                                </Button>
                            )}
                        </div>
                    </div>

                    {/* args 列被 app（启动参数）与 command（工作目录）复用；command 额外给「浏览…」 */}
                    {(kind === "app" || kind === "command") && (
                        <div className="grid grid-cols-[5.5rem_1fr] items-center gap-3">
                            <Label htmlFor="item-args">{kind === "app" ? t("item.args") : t("item.cwd")}</Label>
                            <div className="flex gap-2">
                                <Input
                                    id="item-args"
                                    value={args}
                                    onChange={(e) => setArgs(e.target.value)}
                                    maxLength={1000}
                                    className="flex-1"
                                />
                                {kind === "command" && (
                                    <Button
                                        type="button"
                                        variant="outline"
                                        className="flex-none whitespace-nowrap"
                                        onClick={() => void browseDir()}
                                    >
                                        {t("btn.browse")}
                                    </Button>
                                )}
                            </div>
                        </div>
                    )}

                    <div className="grid grid-cols-[5.5rem_1fr] items-center gap-3">
                        <Label htmlFor="item-group">{t("item.group")}</Label>
                        <Select value={String(groupId)} onValueChange={(v) => setGroupId(Number(v))}>
                            <SelectTrigger id="item-group" className="w-full">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {groups.map((g) => (
                                    <SelectItem key={g.id} value={String(g.id)}>
                                        {g.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={onClose}>
                            {t("common.cancel")}
                        </Button>
                        <Button type="submit" disabled={saving}>
                            {item ? t("common.save") : t("common.create")}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>

            {/* Windows 专属：从开始菜单/桌面快捷方式列表回填路径 */}
            <ShortcutPickerDialog
                open={pickerOpen}
                onClose={() => setPickerOpen(false)}
                onPick={(s) => {
                    setTarget(s.lnk);
                    // 标题为空或仍是上次回填值时，跟随快捷方式名
                    if (!title.trim()) setTitle(s.name);
                }}
            />
        </Dialog>
    );
}
