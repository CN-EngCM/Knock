import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { toast } from "sonner";
import { useI18n } from "@/i18n/useI18n";
import { useToolInput } from "./toolInput";

// 二维码生成：qrcode 库（纯 JS）在本 chunk 内静态引入——chunk 本身
// 就是被 ToolsZone 懒加载的，关闭工具即整体卸载。
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

    const btn = "tbtn border border-line px-3 py-1 text-[12px] hover:bg-faint";
    const field = "border border-line bg-bg px-2 py-1 font-mono text-[12.5px] text-text outline-none";

    return (
        <div className="flex h-full gap-4 p-4">
            <div className="flex min-w-0 flex-1 flex-col gap-3 text-[12.5px]">
                <label className="flex items-center gap-2.5">
                    <span className="w-12 flex-none text-muted">{t("qr.content")}</span>
                    <input
                        type="text"
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        className={`min-w-0 flex-1 ${field}`}
                    />
                </label>
                <div className="flex flex-wrap items-center gap-2.5">
                    <span className="flex items-center gap-2.5">
                        <span className="w-12 flex-none text-muted">{t("qr.size")}</span>
                        <select value={size} onChange={(e) => setSize(Number(e.target.value))} className={field}>
                            {[128, 216, 512].map((s) => (
                                <option key={s} value={s}>
                                    {s} px
                                </option>
                            ))}
                        </select>
                    </span>
                    <span className="flex items-center gap-2.5">
                        <span className="flex-none text-muted">{t("qr.ec")}</span>
                        <select value={ec} onChange={(e) => setEc(e.target.value as typeof ec)} className={field}>
                            {(["L", "M", "Q", "H"] as const).map((v) => (
                                <option key={v} value={v}>
                                    {v}
                                </option>
                            ))}
                        </select>
                    </span>
                </div>
                <div className="flex gap-2 text-[12px]">
                    <button type="button" className={btn} onClick={copyImage}>
                        [ {t("qr.copy")} ]
                    </button>
                    <button type="button" className={btn} onClick={save}>
                        [ {t("qr.save")} ]
                    </button>
                </div>
                {!text.trim() && <span className="text-[11.5px] text-muted">{t("qr.empty")}</span>}
            </div>
            <div className="flex flex-none items-start justify-center">
                {url ? (
                    <img
                        src={url}
                        alt="QR"
                        style={{ width: size }}
                        className="max-w-full border border-line bg-white p-1"
                    />
                ) : (
                    <div
                        className="flex items-center justify-center border border-dashed border-line text-[11.5px] text-muted"
                        style={{ width: size, height: size }}
                    >
                        {t("qr.empty")}
                    </div>
                )}
            </div>
        </div>
    );
}
