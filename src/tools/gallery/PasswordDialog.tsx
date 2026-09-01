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
    title: string;
    /** 提示行；不传则不显示 */
    hint?: string;
    /** 确定按钮文案（解锁场景传「解锁」，设置/修改用通用「保存」） */
    confirmLabel: string;
    /** 提交：返回 true = 成功（关闭），false = 失败（保留输入可重试） */
    onSubmit: (password: string) => Promise<boolean>;
    onClose: () => void;
};

// 图库密码框：解锁 / 设置（含未设密码时右键设私密的联动）场景共用（差异全在调用方的 onSubmit）
export function PasswordDialog({ title, hint, confirmLabel, onSubmit, onClose }: Props) {
    const { t } = useI18n();
    const [pw, setPw] = useState("");
    const [busy, setBusy] = useState(false);

    function submit() {
        if (busy || !pw) return;
        setBusy(true);
        void onSubmit(pw).then((ok) => {
            setBusy(false);
            if (ok) onClose();
        });
    }

    return (
        <Dialog open onOpenChange={(v) => !v && onClose()}>
            <DialogContent className="sm:max-w-sm">
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    {hint && <DialogDescription>{hint}</DialogDescription>}
                </DialogHeader>

                <input
                    autoFocus
                    type="password"
                    value={pw}
                    onChange={(e) => setPw(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") submit();
                    }}
                    spellCheck={false}
                    placeholder={t("gallery.pw.placeholder")}
                    className="h-8 w-full border border-line bg-bg px-2 text-[12.5px] text-text outline-none placeholder:text-muted focus:border-dim"
                />

                <DialogFooter>
                    <Button type="button" variant="outline" onClick={onClose}>
                        {t("common.cancel")}
                    </Button>
                    <Button type="button" disabled={busy || !pw} onClick={submit}>
                        {confirmLabel}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
