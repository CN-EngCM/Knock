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
    /** 打开时的初始名称（待改名对象的当前名） */
    initialName: string;
    /** 标题与字段文案由调用方给，弹窗不内置默认值 */
    title: string;
    label: string;
    maxLength?: number;
    onClose: () => void;
    onSubmit: (name: string) => Promise<void>;
};

// 单行名称输入弹窗：打开即回填当前名，提交交给调用方落库
export function NameDialog({ open, initialName, title, label, maxLength = 50, onClose, onSubmit }: Props) {
    const { t } = useI18n();
    const [name, setName] = useState("");
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (open) setName(initialName);
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
                    <DialogTitle>{title}</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="grid gap-4">
                    <FormRow>
                        <FieldLabel htmlFor="name-dialog-input">{label}</FieldLabel>
                        <Input
                            id="name-dialog-input"
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
                            {t("common.save")}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
