import { useState } from "react";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useWindowRoom } from "@/lib/windowRoom";
import { useI18n } from "@/i18n/useI18n";

type Props = {
    open: boolean;
    title: string;
    description?: string;
    /** 确认按钮文案；缺省为「删除」 */
    confirmLabel?: string;
    onClose: () => void;
    onConfirm: () => Promise<void>;
};

// 通用确认弹窗：用于删除等不可逆操作的二次确认。
// 用 AlertDialog 表达 alertdialog 语义：遮罩点击被库拦截，关闭路径只剩 Esc、取消与确认；
// 初始焦点由库落到 Cancel（取消在前，主操作在后）。
export function ConfirmDialog({ open, title, description, confirmLabel, onClose, onConfirm }: Props) {
    const { t } = useI18n();
    const [busy, setBusy] = useState(false);
    // 窗口收成一条时，确认框放不下：打开期间撑开窗口
    useWindowRoom(open ? 280 : 0);

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
        <AlertDialog open={open} onOpenChange={(v) => !v && onClose()}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>{title}</AlertDialogTitle>
                    {description && <AlertDialogDescription>{description}</AlertDialogDescription>}
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                    {/* preventDefault：Action 默认点击即关，这里压住关闭，等异步删除完成再由 onClose 收尾（与旧行为一致） */}
                    <AlertDialogAction
                        variant="destructive"
                        disabled={busy}
                        onClick={(e) => {
                            e.preventDefault();
                            void handleConfirm();
                        }}
                    >
                        {confirmLabel ?? t("common.delete")}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
