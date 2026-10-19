import { useCallback, useEffect, useRef, useState } from "react";
import { BarcodeFormat, BrowserMultiFormatReader } from "@zxing/library";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/useI18n";

// 条形码 / 二维码识别：@zxing/library（纯 JS）随本 chunk 懒加载。
// 输入三通道：拖拽图片文件 / Ctrl+V 粘贴截图 / 文件选择器。
type ScanResult = { text: string; format: string };

export default function ScanTool() {
    const { t } = useI18n();
    const [results, setResults] = useState<ScanResult[]>([]);
    const [dragOver, setDragOver] = useState(false);
    const fileInput = useRef<HTMLInputElement>(null);
    // reader 无状态可复用，放 ref 里避免每次渲染新建
    const reader = useRef(new BrowserMultiFormatReader());

    const decodeFile = useCallback(
        async (file: File) => {
            if (!file.type.startsWith("image/")) return;
            const url = URL.createObjectURL(file);
            try {
                const r = await reader.current.decodeFromImageUrl(url);
                // 枚举值反查名字（QR_CODE / CODE_128 / EAN_13 …），没有名字的位组合退回数字
                const num = r.getBarcodeFormat() as number;
                const format = BarcodeFormat[num] ?? String(num);
                setResults((prev) => [{ text: r.getText(), format }, ...prev].slice(0, 8));
            } catch {
                toast.error(t("scan.fail"));
            } finally {
                URL.revokeObjectURL(url);
            }
        },
        [t],
    );

    // 粘贴截图：paste 事件的 clipboardData 里取第一张图
    useEffect(() => {
        const onPaste = (e: ClipboardEvent) => {
            const item = Array.from(e.clipboardData?.items ?? []).find((i) => i.type.startsWith("image/"));
            const file = item?.getAsFile();
            if (file) void decodeFile(file);
        };
        window.addEventListener("paste", onPaste);
        return () => window.removeEventListener("paste", onPaste);
    }, [decodeFile]);

    async function copyText(text: string) {
        try {
            await navigator.clipboard.writeText(text);
            toast.success(t("json.copied"));
        } catch {
            toast.error(t("toast.error"));
        }
    }

    return (
        <div
            className="flex h-full flex-col gap-3 overflow-auto p-4"
            onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const file = e.dataTransfer.files[0];
                if (file) void decodeFile(file);
            }}
        >
            <div
                className={`flex flex-none flex-col items-center gap-3 rounded-md border border-dashed px-6 py-8 text-center ${
                    dragOver ? "border-border bg-rowsel" : "border-line"
                }`}
            >
                <span className="text-[14px] text-muted-foreground">{t("scan.drop")}</span>
                <Button appearance="standard" variant="outline" size="sm" onClick={() => fileInput.current?.click()}>
                    {t("scan.pick")}
                </Button>
                <input
                    ref={fileInput}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) void decodeFile(file);
                        e.target.value = ""; // 允许连续选择同一个文件
                    }}
                />
            </div>

            <h3 className="flex-none text-[11.5px] tracking-widest text-dim-foreground">
                {t("scan.results")} ── {results.length ? "" : t("scan.none")}
            </h3>
            {results.map((r, i) => (
                <div
                    key={`${i}-${r.text}`}
                    className="flex flex-none items-center gap-2.5 rounded-md border border-line bg-background px-2.5 py-1.5"
                >
                    <span className="kind-badge flex-none">{r.format}</span>
                    <span className="min-w-0 flex-1 truncate text-[12.5px] text-foreground">{r.text}</span>
                    <button type="button" className="tbtn" onClick={() => copyText(r.text)}>
                        {t("scan.copy")}
                    </button>
                    {/^https?:\/\//i.test(r.text) && (
                        <button
                            type="button"
                            className="tbtn"
                            onClick={() => window.open(r.text, "_blank", "noreferrer")}
                        >
                            {t("scan.open")}
                        </button>
                    )}
                </div>
            ))}
        </div>
    );
}
