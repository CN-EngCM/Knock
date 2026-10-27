import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription } from "@/components/ui/empty";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useI18n } from "@/i18n/useI18n";
import { useToolInput } from "./toolInput";

// 二维码生成：qrcode 库（纯 JS）在本 chunk 内静态引入——chunk 本身
// 就是被 dock 面板懒加载的，关闭面板即整体卸载。
// 模块颜色固定黑白：扫码器对深底浅码的识别远差于白底黑码，不随主题翻转。
// initialInput = 搜索框素材注入（如呼出时限内复制的 URL）。
export default function QrTool({ initialInput }: { initialInput?: string | null }) {
    const { t } = useI18n();
    const { text, setText } = useToolInput("qr", initialInput ?? "https://");
    const [size, setSize] = useState(216);
    const [ec, setEc] = useState<"L" | "M" | "Q" | "H">("M");
    const [url, setUrl] = useState("");

    useEffect(() => {
        let alive = true;
        if (!text.trim()) {
            setUrl("");
            return;
        }
        QRCode.toDataURL(text, { width: size, margin: 2, errorCorrectionLevel: ec })
            .then((u) => {
                if (alive) setUrl(u);
            })
            .catch(() => {
                /* 内容编码失败（极少）按空预览处理 */
                if (alive) setUrl("");
            });
        return () => {
            alive = false;
        };
    }, [text, size, ec]);

    async function copyImage() {
        if (!url) return;
        try {
            const blob = await (await fetch(url)).blob();
            await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
            toast.success(t("qr.copied"));
        } catch {
            toast.error(t("toast.error"));
        }
    }

    function save() {
        if (!url) return;
        const a = document.createElement("a");
        a.href = url;
        a.download = "qrcode.png";
        a.click();
        toast.success(t("qr.saved"));
    }

    return (
        <div className="flex h-full gap-4 p-4">
            <div className="flex min-w-0 flex-1 flex-col gap-3 text-[12.5px]">
                <Field orientation="horizontal" className="gap-2.5">
                    <FieldLabel
                        htmlFor="qr-content"
                        className="w-12 flex-none! justify-start text-[12.5px] font-normal text-dim-foreground"
                    >
                        {t("qr.content")}
                    </FieldLabel>
                    <Input
                        id="qr-content"
                        type="text"
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        className="min-w-0 flex-1"
                    />
                </Field>
                <div className="flex flex-wrap items-center gap-2.5">
                    <Field orientation="horizontal" className="w-auto gap-2.5">
                        <FieldLabel className="w-12 flex-none! justify-start text-[12.5px] font-normal text-dim-foreground">
                            {t("qr.size")}
                        </FieldLabel>
                        <Select value={String(size)} onValueChange={(v) => setSize(Number(v))}>
                            <SelectTrigger size="sm" aria-label={t("qr.size")}>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {[128, 216, 512].map((s) => (
                                    <SelectItem key={s} value={String(s)}>
                                        {s} px
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </Field>
                    <Field orientation="horizontal" className="w-auto gap-2.5">
                        <FieldLabel className="flex-none! justify-start text-[12.5px] font-normal text-dim-foreground">
                            {t("qr.ec")}
                        </FieldLabel>
                        <Select value={ec} onValueChange={(v) => setEc(v as typeof ec)}>
                            <SelectTrigger size="sm" aria-label={t("qr.ec")}>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {(["L", "M", "Q", "H"] as const).map((v) => (
                                    <SelectItem key={v} value={v}>
                                        {v}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </Field>
                </div>
                <div className="flex gap-2 text-[12px]">
                    <Button appearance="standard" variant="outline" size="sm" onClick={copyImage}>
                        {t("qr.copy")}
                    </Button>
                    <Button appearance="standard" variant="outline" size="sm" onClick={save}>
                        {t("qr.save")}
                    </Button>
                </div>
                {!text.trim() && <span className="text-[11.5px] text-dim-foreground">{t("qr.empty")}</span>}
            </div>
            <div className="flex flex-none items-start justify-center">
                {url ? (
                    <img
                        src={url}
                        alt="QR"
                        style={{ width: size }}
                        className="max-w-full rounded-md border border-border bg-white p-1"
                    />
                ) : (
                    <Empty className="justify-center border-line" style={{ width: size, height: size }}>
                        <EmptyDescription className="text-[11.5px] text-dim-foreground">
                            {t("qr.empty")}
                        </EmptyDescription>
                    </Empty>
                )}
            </div>
        </div>
    );
}
