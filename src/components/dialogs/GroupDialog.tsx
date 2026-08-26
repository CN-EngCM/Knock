import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/i18n/useI18n";

type Props = {
    open: boolean;
    /** 编辑时传入；新建时为 null */
    initialName: string | null;
    onClose: () => void;
    onSubmit: (name: string) => Promise<void>;
};

// 分组新建 / 重命名共用一个弹窗，仅标题和初始值不同
export function GroupDialog({ open, initialName, onClose, onSubmit }: Props) {
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
            <DialogContent className="font-mono">
                <DialogHeader>
                    <DialogTitle>{initialName === null ? t("group.new") : t("group.rename")}</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="grid gap-4">
                    <div className="grid grid-cols-[5.5rem_1fr] items-center gap-3">
                        <Label htmlFor="group-name">{t("group.name")}</Label>
                        <Input
                            id="group-name"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            autoFocus
                            required
                            maxLength={50}
                        />
                    </div>
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={onClose}>
                            {t("common.cancel")}
                        </Button>
                        <Button type="submit" disabled={saving}>
                            {initialName === null ? t("common.create") : t("common.save")}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
