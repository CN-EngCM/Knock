import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
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

    return (
        <div className="flex h-full flex-col">
            {/* 工具栏：主操作蓝实心，次操作描边，轻量动作用 tbtn */}
            <div className="flex min-h-[46px] flex-none items-center gap-2 border-b border-line bg-panel px-3.5">
                <Button appearance="standard" variant="primary" size="sm" onClick={() => run(false)}>
                    {t("json.format")}
                </Button>
                <Button appearance="standard" variant="outline" size="sm" onClick={() => run(true)}>
                    {t("json.minify")}
                </Button>
                <Button appearance="standard" variant="outline" size="sm" onClick={copy}>
                    {t("json.copy")}
                </Button>
                <button
                    type="button"
                    className="tbtn"
                    onClick={() => {
                        setInput("");
                        setOutput("");
                        setError(null);
                    }}
                >
                    {t("json.clear")}
                </button>
                {input && (
                    <span className={`text-[11.5px] ${error ? "text-destructive" : "text-dim-foreground"}`}>
                        {error ?? (output ? t("json.ok") : "")}
                    </span>
                )}
            </div>
            {/* 双栏编辑器：左输入右结果，弱分隔线隔开；结果区用井底区分。
                整栏 Textarea 覆盖圆角与内阴影，避免编辑区看起来像内嵌卡片 */}
            <div className="flex min-h-0 flex-1">
                <Textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    spellCheck={false}
                    placeholder={t("json.input")}
                    className="min-w-0 flex-1 resize-none rounded-none p-3 font-mono text-[12.5px] shadow-none focus:bg-[var(--control-input-focus-background)] focus-visible:outline-none! dark:shadow-none"
                />
                <div className="min-w-0 flex-1 overflow-auto border-l border-line bg-well p-3 font-mono text-[12.5px]">
                    <pre className="whitespace-pre text-foreground">{output}</pre>
                </div>
            </div>
        </div>
    );
}
