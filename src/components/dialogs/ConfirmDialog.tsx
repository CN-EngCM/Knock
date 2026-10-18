import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { useI18n } from "@/i18n/useI18n";

type Props = {
    open: boolean;
    title: string;
    description?: string;
    onClose: () => void;
    onConfirm: () => Promise<void>;
};

// 通用确认弹窗：用于删除等不可逆操作的二次确认
export function ConfirmDialog({ open, title, description, onClose, onConfirm }: Props) {
    const { t } = useI18n();
    const [busy, setBusy] = useState(false);

    async function handleConfirm() {
        setBusy(true);
        try {
            await onConfirm();
            onClose();
        } finally {
            setBusy(false);
        }
    }

    return (
        <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    {description && <DialogDescription>{description}</DialogDescription>}
                </DialogHeader>
                <DialogFooter>
                    <Button type="button" appearance="standard" variant="outline" size="default" onClick={onClose}>
                        {t("common.cancel")}
                    </Button>
                    <Button
                        type="button"
                        appearance="standard"
                        variant="destructive"
                        size="default"
                        onClick={handleConfirm}
                        disabled={busy}
                    >
                        {t("common.delete")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
