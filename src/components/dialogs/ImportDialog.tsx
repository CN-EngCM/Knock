import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { api, type ImportStats } from "@/api/client";
import { useI18n } from "@/i18n/useI18n";

type Props = {
    open: boolean;
    onClose: () => void;
    /** 导入成功后刷新数据 */
    onImported: () => void;
};

type ImportResult = ImportStats;

export function ImportDialog({ open, onClose, onImported }: Props) {
    const { t } = useI18n();
    const [fileName, setFileName] = useState("");
    const [html, setHtml] = useState("");
    const [running, setRunning] = useState(false);
    const [result, setResult] = useState<ImportResult | null>(null);

    useEffect(() => {
        if (open) {
            setFileName("");
            setHtml("");
            setResult(null);
            setRunning(false);
        }
    }, [open]);

    async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
            // Chrome 导出为 UTF-8，file.text() 按 UTF-8 解码
            setHtml(await file.text());
            setFileName(file.name);
            setResult(null);
        } catch {
            toast.error(t("import.badFile"));
        }
    }

    async function handleImport() {
        if (!html) {
            toast.error(t("import.noFile"));
            return;
        }
        setRunning(true);
        try {
            const r = await api.importBookmarks(html);
            if (!r.ok) throw new Error(r.error.kind);
            setResult(r.data);
            onImported();
        } catch {
            toast.error(t("toast.error"));
        } finally {
            setRunning(false);
        }
    }

    return (
        <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
            <DialogContent className="font-mono">
                <DialogHeader>
                    <DialogTitle>{t("import.title")}</DialogTitle>
                    <DialogDescription className="text-dim">{t("import.step1")}</DialogDescription>
                </DialogHeader>

                <label className="flex cursor-pointer items-center justify-between gap-3 border border-line px-3 py-2.5 text-[13px] hover:bg-faint">
                    <span className={fileName ? "text-text" : "text-muted"}>{fileName || t("import.pick")}</span>
                    <input type="file" accept=".html,.htm" onChange={handleFile} className="hidden" />
                    <span className="text-dim">[ {t("import.pick")} ]</span>
                </label>

                {result && (
                    <div className="border border-line bg-faint px-3 py-2 text-[13px] text-dim">
                        {t("import.createdGroups")} {result.createdGroups} · {t("import.imported")}{" "}
                        {result.importedItems} · {t("import.skipped")} {result.skipped}
                    </div>
                )}

                <DialogFooter>
                    <Button type="button" variant="outline" onClick={onClose}>
                        {t("common.cancel")}
                    </Button>
                    <Button type="button" onClick={handleImport} disabled={running || !html}>
                        {running ? t("import.running") : t("import.run")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
