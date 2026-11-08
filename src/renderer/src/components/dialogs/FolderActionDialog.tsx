import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type { FolderAction } from "@/api/client";
import { useI18n } from "@/i18n/useI18n";
import { FormRow } from "./settings/shared";

type Props = {
    open: boolean;
    /** 编辑时传入；新建时为 null */
    action: FolderAction | null;
    onClose: () => void;
    /** 返回 false = 没存成（App 已 toast），弹窗留着让用户改；返回 true 才关 */
    onSubmit: (action: FolderAction) => Promise<boolean>;
};

/** 新增 / 编辑一个文件夹动作。只从设置页发起，设置页一直开在后面，所以不用再单独撑窗口。
 *  长度上限与主进程 folderActionSchema 保持一致（渲染进程不能 import 它的值）。
 *  命令用单行输入框，本身就挡住了换行，不用另外校验 */
export function FolderActionDialog({ open, action, onClose, onSubmit }: Props) {
    const { t } = useI18n();
    const [name, setName] = useState("");
    const [command, setCommand] = useState("");
    const [autoClose, setAutoClose] = useState(false);
    const [saving, setSaving] = useState(false);

    // 每次打开时用 action / 默认值重置表单（编辑回填）
    useEffect(() => {
        if (!open) return;
        setName(action?.name ?? "");
        setCommand(action?.command ?? "");
        setAutoClose(action?.autoClose ?? false);
    }, [open, action]);

    // 全是空白也算没填：保存按钮直接灰掉，不用再弹错误
    const valid = name.trim() !== "" && command.trim() !== "";

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (!valid) return;
        setSaving(true);
        try {
            const ok = await onSubmit({ name: name.trim(), command: command.trim(), autoClose });
            if (ok) onClose();
        } finally {
            setSaving(false);
        }
    }

    return (
        <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{action ? t("folderAction.edit") : t("folderAction.new")}</DialogTitle>
                </DialogHeader>

                <form onSubmit={handleSubmit} className="grid gap-4">
                    <FormRow>
                        <FieldLabel htmlFor="folder-action-name">{t("folderAction.name")}</FieldLabel>
                        <Input
                            id="folder-action-name"
                            placeholder={t("folderAction.name.placeholder")}
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            required
                            maxLength={30}
                        />
                    </FormRow>

                    <FormRow>
                        <FieldLabel htmlFor="folder-action-command">{t("folderAction.command")}</FieldLabel>
                        <Input
                            id="folder-action-command"
                            placeholder={t("folderAction.command.placeholder")}
                            value={command}
                            onChange={(e) => setCommand(e.target.value)}
                            required
                            maxLength={500}
                        />
                    </FormRow>

                    <FormRow>
                        <FieldLabel htmlFor="folder-action-autoclose">{t("item.autoClose")}</FieldLabel>
                        <span className="flex min-h-[25px] items-center gap-2.5">
                            <Switch id="folder-action-autoclose" checked={autoClose} onCheckedChange={setAutoClose} />
                            <label
                                htmlFor="folder-action-autoclose"
                                className="cursor-pointer text-xs font-normal text-muted-foreground"
                            >
                                {t("item.autoClose.hint")}
                            </label>
                        </span>
                    </FormRow>

                    <DialogFooter>
                        <Button type="button" appearance="standard" variant="outline" size="default" onClick={onClose}>
                            {t("common.cancel")}
                        </Button>
                        <Button
                            type="submit"
                            appearance="standard"
                            variant="primary"
                            size="default"
                            disabled={!valid || saving}
                        >
                            {action ? t("common.save") : t("common.create")}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
