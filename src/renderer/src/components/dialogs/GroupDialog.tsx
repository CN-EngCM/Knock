import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/i18n/useI18n";
import { FormRow } from "./settings/shared";

type Props = {
    open: boolean;
    /** 编辑时传入；新建时为 null */
    initialName: string | null;
    /** 标题与字段文案可由调用方覆盖：工作区改名也复用这个弹窗，默认按分组口径 */
    title?: string;
    label?: string;
    maxLength?: number;
    onClose: () => void;
    onSubmit: (name: string) => Promise<void>;
};

// 分组新建 / 重命名共用一个弹窗，仅标题和初始值不同；工作区改名也复用这个形态，文案由调用方覆盖
export function GroupDialog({ open, initialName, title, label, maxLength = 50, onClose, onSubmit }: Props) {
    const { t } = useI18n();
    const [name, setName] = useState("");
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (open) setName(initialName ?? "");
    }, [open, initialName]);

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (!name.trim()) {
            toast.error(t("toast.error"));
            return;
        }
        setSaving(true);
        try {
            await onSubmit(name.trim());
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
                    <DialogTitle>{title ?? (initialName === null ? t("group.new") : t("group.rename"))}</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="grid gap-4">
                    <FormRow>
                        <FieldLabel htmlFor="group-name">{label ?? t("group.name")}</FieldLabel>
                        <Input
                            id="group-name"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            autoFocus
                            required
                            maxLength={maxLength}
                        />
                    </FormRow>
                    <DialogFooter>
                        <Button type="button" appearance="standard" variant="outline" size="default" onClick={onClose}>
                            {t("common.cancel")}
                        </Button>
                        <Button type="submit" appearance="standard" variant="primary" size="default" disabled={saving}>
                            {initialName === null ? t("common.create") : t("common.save")}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
