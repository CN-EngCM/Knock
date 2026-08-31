import { useEffect, useRef, useState } from "react";
import { ArrowLeftRight } from "lucide-react";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api, type ApiResult, type TranslateResult, type YoudaoLangId } from "@/api/client";
import { useI18n } from "@/i18n/useI18n";
import { useToolInput } from "./toolInput";
import { youdaoErrKey } from "./youdaoErr";

// 有道翻译：请求经主进程（渲染进程直连被 CORS 拦，密钥也不进渲染包）。
// 输入防抖自动翻译，序号丢弃晚归结果（与 files 工具同款竞态约定）；
// 语言方向是个人偏好，存 localStorage（不属「运行时状态勿还原」范围）。
// 密钥未配置时行内引导直达设置页（openSettings 由 App 经 ToolsZone 传入）。

const DEBOUNCE_MS = 600;
const LS_FROM = "mypage-translate-from";
const LS_TO = "mypage-translate-to";

// 语言词汇表：须与 server/schemas.YOUDAO_LANG_IDS 手工对齐（渲染进程禁止运行时
// import server/ 的值，zod 在主进程仍会兜底校验）
const LANGS: readonly YoudaoLangId[] = [
    "zh-CHS",
    "zh-CHT",
    "en",
    "ja",
    "ko",
    "fr",
    "de",
    "ru",
    "es",
    "pt",
    "it",
    "ar",
    "th",
    "vi",
];
type FromId = "auto" | YoudaoLangId;

function loadLang(key: string, fallback: string, allowAuto: boolean): string {
    try {
        const v = localStorage.getItem(key);
        if ((allowAuto && v === "auto") || (LANGS as readonly string[]).includes(v ?? "")) return v as string;
    } catch {
        /* localStorage 不可用时用默认方向 */
    }
    return fallback;
}

export default function TranslateTool({
    initialInput,
    openSettings,
}: {
    initialInput?: string | null;
    openSettings?: () => void;
}) {
    const { t } = useI18n();
    const { text, setText } = useToolInput("translate", initialInput);
    const [from, setFrom] = useState<FromId>(() => loadLang(LS_FROM, "auto", true) as FromId);
    const [to, setTo] = useState<YoudaoLangId>(() => loadLang(LS_TO, "en", false) as YoudaoLangId);
    const [result, setResult] = useState<TranslateResult | null>(null);
    // idle=无输入；loading；done；error=有道/网络错误；noConfig=密钥未配置（引导去设置）
    const [status, setStatus] = useState<"idle" | "loading" | "done" | "error" | "noConfig">("idle");
    const [errCode, setErrCode] = useState("");
    const seq = useRef(0);

    // 语言选择落盘（换 origin 会重置，与主题/布局同款已知限制）
    function pickFrom(v: FromId) {
        setFrom(v);
        try {
            localStorage.setItem(LS_FROM, v);
        } catch {
            /* 忽略存储失败 */
        }
    }
    function pickTo(v: YoudaoLangId) {
        setTo(v);
        try {
            localStorage.setItem(LS_TO, v);
        } catch {
            /* 忽略存储失败 */
        }
    }

    /** 请求结果落地：序号对不上 = 晚归旧包，直接丢弃 */
    function applyResult(my: number, r: ApiResult<TranslateResult>) {
        if (my !== seq.current) return;
        if (r.ok) {
            setResult(r.data);
            setStatus("done");
        } else if (r.error.kind === "not-configured") {
            setStatus("noConfig");
        } else {
            // bad-request 理论上到不了（输入已被本组件约束），也并进错误码展示兜底
            setErrCode(r.error.kind === "youdao" ? r.error.code : "bad-request");
            setStatus("error");
        }
    }

    // 翻译主链路：空输入回初始态；非空防抖后请求
    useEffect(() => {
        const q = text.trim();
        if (q === "") {
            seq.current++;
            setResult(null);
            setStatus("idle");
            return;
        }
        setStatus("loading");
        const timer = setTimeout(() => {
            const my = ++seq.current;
            void api.translate({ text: q, from, to }).then((r) => applyResult(my, r));
        }, DEBOUNCE_MS);
        return () => clearTimeout(timer);
    }, [text, from, to]);

    function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
        if (e.key !== "Enter" || !(e.ctrlKey || e.metaKey)) return;
        e.preventDefault();
        const q = text.trim();
        if (q === "") return;
        // 立即翻译：序号推进，防抖链路上尚未发出的定时器请求会被清理函数取消，
        // 已发出的晚归包被 applyResult 丢弃
        const my = ++seq.current;
        setStatus("loading");
        void api.translate({ text: q, from, to }).then((r) => applyResult(my, r));
    }

    // ⇄ 交换方向：to 必然是新 from；from=auto 交换不出确定目标——
    // 已检测过用检测语言，否则退回简体中文（界面语言默认）
    function swap() {
        const nextFrom: FromId = to;
        const d = result?.detected ?? "";
        const nextTo: YoudaoLangId =
            from === "auto" ? ((LANGS as readonly string[]).includes(d) ? (d as YoudaoLangId) : "zh-CHS") : from;
        pickFrom(nextFrom);
        pickTo(nextTo);
    }

    async function copyResult() {
        if (!result?.text) return;
        try {
            await navigator.clipboard.writeText(result.text);
            toast.success(t("json.copied"));
        } catch {
            toast.error(t("toast.error"));
        }
    }

    function clearInput() {
        setText("");
    }

    const btn = "tbtn border border-line px-2.5 py-1 text-[12px] hover:bg-faint";

    return (
        <div className="flex h-full flex-col gap-2 p-3">
            <div className="flex flex-none items-center gap-2">
                <Select value={from} onValueChange={(v) => pickFrom(v as FromId)}>
                    <SelectTrigger className="w-36">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="auto">{t("translate.lang.auto")}</SelectItem>
                        {LANGS.map((l) => (
                            <SelectItem key={l} value={l}>
                                {t(`translate.lang.${l}`)}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                <button type="button" className={btn} title={t("translate.swap")} onClick={swap}>
                    <ArrowLeftRight size={13} />
                </button>
                <Select value={to} onValueChange={(v) => pickTo(v as YoudaoLangId)}>
                    <SelectTrigger className="w-36">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {LANGS.map((l) => (
                            <SelectItem key={l} value={l}>
                                {t(`translate.lang.${l}`)}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>

            <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={onKeyDown}
                spellCheck={false}
                placeholder={t("translate.placeholder")}
                className="h-36 flex-none resize-none border border-line bg-bg px-2.5 py-1.5 text-[12.5px] text-text outline-none placeholder:text-muted"
            />

            <div className="min-h-0 flex-1 overflow-auto border-t border-line pt-2">
                {status === "idle" && (
                    <div className="px-1 py-6 text-center text-[12px] text-muted">{t("translate.hint")}</div>
                )}

                {status === "loading" && (
                    <div className="px-1 py-6 text-center text-[12px] text-muted">{t("translate.loading")}</div>
                )}

                {status === "noConfig" && (
                    <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
                        <span className="text-[13px] text-text">{t("translate.noConfig")}</span>
                        <button type="button" className={btn} onClick={() => openSettings?.()}>
                            [ {t("translate.openSettings")} ]
                        </button>
                    </div>
                )}

                {status === "error" && (
                    <div className="px-1 py-6 text-center text-[12.5px] text-dim">
                        {(() => {
                            const k = youdaoErrKey(errCode);
                            return k ? t(k) : `${t("translate.errFallback")}: ${errCode}`;
                        })()}
                    </div>
                )}

                {status === "done" && result && (
                    <div className="flex flex-col gap-2 px-1">
                        <div className="whitespace-pre-wrap break-words text-[14px] leading-relaxed text-text">
                            {result.text}
                        </div>
                        {result.dictUrl && (
                            <a
                                href={result.dictUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="w-fit text-[12px] text-dim underline hover:text-text"
                            >
                                {t("translate.dict")}
                            </a>
                        )}
                    </div>
                )}
            </div>

            <div className="flex flex-none items-center justify-between gap-2">
                <span className="min-w-0 truncate text-[11px] text-muted">
                    {status === "done" && result
                        ? `${t("translate.detected")}: ${
                              (LANGS as readonly string[]).includes(result.detected)
                                  ? t(`translate.lang.${result.detected as YoudaoLangId}`)
                                  : result.detected
                          }`
                        : ""}
                </span>
                <span className="flex flex-none items-center gap-2">
                    <button type="button" className={btn} onClick={clearInput}>
                        [ {t("translate.clear")} ]
                    </button>
                    <button type="button" className={btn} onClick={() => void copyResult()}>
                        [ {t("translate.copy")} ]
                    </button>
                </span>
            </div>
        </div>
    );
}
