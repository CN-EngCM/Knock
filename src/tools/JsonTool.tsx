import { useState } from "react";
import { toast } from "sonner";
import { useI18n } from "@/i18n/useI18n";
import { useToolInput } from "./toolInput";

// JSON 格式化 / 压缩：纯前端实现，无依赖。
// 关闭工具即卸载本组件，输入内容随之丢弃（重开回到初始态）。
// initialInput = 搜索框素材注入（呼出时时限内复制的文本 → 推荐本工具 → 选中注入）。
export default function JsonTool({ initialInput }: { initialInput?: string | null }) {
    const { t } = useI18n();
    const { text: input, setText: setInput } = useToolInput("json", initialInput);
    const [output, setOutput] = useState("");
    // 错误只存 z 原始 message（位置信息），无敏感内容
    const [error, setError] = useState<string | null>(null);

    function run(minify: boolean) {
        try {
            const v = JSON.parse(input);
            setOutput(JSON.stringify(v, null, minify ? 0 : 2));
            setError(null);
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        }
    }

    async function copy() {
        if (!output) return;
        try {
            await navigator.clipboard.writeText(output);
            toast.success(t("json.copied"));
        } catch {
            toast.error(t("toast.error"));
        }
    }

    const btn = "tbtn border border-line px-3 py-1 text-[12px] hover:bg-faint";

    return (
        <div className="flex h-full flex-col gap-2 p-3">
            <div className="flex flex-none items-center gap-2 text-[12px]">
                <button type="button" className={btn} onClick={() => run(false)}>
                    [ {t("json.format")} ]
                </button>
                <button type="button" className={btn} onClick={() => run(true)}>
                    [ {t("json.minify")} ]
                </button>
                <button type="button" className={btn} onClick={copy}>
                    [ {t("json.copy")} ]
                </button>
                <button
                    type="button"
                    className={btn}
                    onClick={() => {
                        setInput("");
                        setOutput("");
                        setError(null);
                    }}
                >
                    [ {t("json.clear")} ]
                </button>
                {input && (
                    <span className={`text-[11.5px] ${error ? "text-destructive" : "text-muted"}`}>
                        {error ?? (output ? t("json.ok") : "")}
                    </span>
                )}
            </div>
            <div className="flex min-h-0 flex-1 gap-2">
                <textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    spellCheck={false}
                    placeholder={t("json.input")}
                    className="min-w-0 flex-1 resize-none border border-line bg-bg p-2.5 font-mono text-[12.5px] text-text outline-none placeholder:text-muted"
                />
                <div className="min-w-0 flex-1 overflow-auto border border-line bg-bg p-2.5 font-mono text-[12.5px]">
                    <pre className="whitespace-pre text-text">{output}</pre>
                </div>
            </div>
        </div>
    );
}
