import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
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
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{t("import.title")}</DialogTitle>
                    <DialogDescription>{t("import.step1")}</DialogDescription>
                </DialogHeader>

                {/* 文件选择：库 Input type=file 自带 file-selector-button 样式；
                    Label 关联后点文案也能打开文件框，选中文件名在下方回显 */}
                <Field>
                    <FieldLabel htmlFor="import-file">{t("import.pick")}</FieldLabel>
                    <Input id="import-file" type="file" accept=".html,.htm" onChange={handleFile} />
                    {fileName && <FieldDescription className="truncate text-foreground">{fileName}</FieldDescription>}
                </Field>

                {result && (
                    <Alert>
                        <AlertDescription>
                            {t("import.createdGroups")} {result.createdGroups} · {t("import.imported")}{" "}
                            {result.importedItems} · {t("import.skipped")} {result.skipped}
                        </AlertDescription>
                    </Alert>
                )}

                <DialogFooter>
                    <Button type="button" appearance="standard" variant="outline" size="default" onClick={onClose}>
                        {t("common.cancel")}
                    </Button>
                    <Button
                        type="button"
                        appearance="standard"
                        variant="primary"
                        size="default"
                        onClick={handleImport}
                        disabled={running || !html}
                    >
                        {running ? t("import.running") : t("import.run")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
