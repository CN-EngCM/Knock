import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { api } from "@/api/client";
import { useI18n } from "@/i18n/useI18n";
import { FormRow } from "./settings/shared";

// 名称上限与 createWorkspaceSchema 保持一致（工作区名 40 字）
const NAME_MAX = 40;

// 从文件夹路径取名字：去掉末尾斜杠后取最后一段；盘符根目录（D:\）取到 "D:"
function folderBasename(path: string): string {
    const trimmed = path.replace(/[\\/]+$/, "");
    return trimmed.split(/[\\/]/).pop() ?? "";
}

type Props = {
    open: boolean;
    /** 打开时的默认名称（调用方已按「工作区 N」算好未占用编号） */
    initialName: string;
    onClose: () => void;
    onSubmit: (name: string, folder: string) => Promise<void>;
};

/**
 * 新建工作区弹窗：名称 + 文件夹。
 * 文件夹必须选现存目录（选目录框本身只返回存在的目录，路径存在性由主进程再校验一次）。
 * 名称没被手动改过时跟随文件夹 basename，省去重复输入。
 */
export function WorkspaceDialog({ open, initialName, onClose, onSubmit }: Props) {
    const { t } = useI18n();
    const [name, setName] = useState("");
    const [folder, setFolder] = useState("");
    // 用户是否手动改过名称：改过之后选文件夹不再覆盖，避免把已取好的名字冲掉
    const [nameTouched, setNameTouched] = useState(false);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!open) return;
        setName(initialName);
        setFolder("");
        setNameTouched(false);
    }, [open, initialName]);

    async function browseFolder() {
        const r = await api.pickDirectory();
        if (!r.ok || r.data === null) return;
        setFolder(r.data);
        if (nameTouched) return;
        const base = folderBasename(r.data);
        // 盘符根目录这类取不到名字的路径保持原默认名
        if (base) setName(base.slice(0, NAME_MAX));
    }

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (!name.trim() || !folder.trim()) {
            toast.error(t("toast.error"));
            return;
        }
        setSaving(true);
        try {
            await onSubmit(name.trim(), folder);
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
                    <DialogTitle>{t("ws.createTitle")}</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="grid gap-4">
                    <FormRow>
                        <FieldLabel htmlFor="workspace-dialog-name">{t("common.name")}</FieldLabel>
                        <Input
                            id="workspace-dialog-name"
                            value={name}
                            onChange={(e) => {
                                setName(e.target.value);
                                setNameTouched(true);
                            }}
                            autoFocus
                            required
                            maxLength={NAME_MAX}
                        />
                    </FormRow>

                    <FormRow>
                        <FieldLabel htmlFor="workspace-dialog-folder">{t("ws.folder")}</FieldLabel>
                        <div className="flex gap-2">
                            <Input
                                id="workspace-dialog-folder"
                                value={folder}
                                readOnly
                                placeholder={t("ws.folderPlaceholder")}
                                className="flex-1"
                            />
                            <Button
                                type="button"
                                appearance="standard"
                                variant="outline"
                                size="default"
                                className="flex-none whitespace-nowrap"
                                onClick={() => void browseFolder()}
                            >
                                {t("btn.browse")}
                            </Button>
                        </div>
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
                            disabled={saving || !folder.trim()}
                        >
                            {t("common.create")}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
