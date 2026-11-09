import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { StatusBar, StatusBarItem } from "@/components/ui/statusbar";
import { Textarea } from "@/components/ui/textarea";
import { Toolbar, ToolbarGroup, ToolbarSeparator } from "@/components/ui/toolbar";
import { useI18n } from "@/i18n/useI18n";
import { useToolInput } from "./toolInput";

// JSON 格式化 / 压缩：纯前端实现，无依赖。
// 关闭工具即卸载本组件，输入内容随之丢弃（重开回到初始态）。
// initialInput = 搜索框素材注入（呼出时时限内复制的文本 → 推荐本工具 → 选中注入）。

const AUTO_FORMAT_MS = 300;

/** 报错的位置：行列（从 1 数）、末尾缺内容、或者定不了位 */
type JsonError = { line: number; col: number } | "end" | "unknown";

/** 把 JSON.parse 的英文报错换成位置。V8 的报错里多半有「position N」，行列自己按原文算，不信它括号里的；
 *  只有「末尾缺内容」和定不了位的两种情况没有行列 */
function locateError(input: string, e: unknown): { error: JsonError; pos: number | null } {
    const message = e instanceof Error ? e.message : String(e);
    if (/end of JSON input/i.test(message)) return { error: "end", pos: input.length };
    const m = /position (\d+)/.exec(message);
    if (!m) return { error: "unknown", pos: null };
    const pos = Number(m[1]);
    const before = input.slice(0, pos);
    // 列号 = 到上一个换行的距离；没有换行时 lastIndexOf 是 -1，刚好得到从 1 数的列
    return { error: { line: before.split("\n").length, col: pos - before.lastIndexOf("\n") }, pos };
}

export default function JsonTool({ initialInput }: { initialInput?: string | null }) {
    const { t } = useI18n();
    const { text: input, setText: setInput } = useToolInput("json", initialInput);
    const [output, setOutput] = useState("");
    const [error, setError] = useState<JsonError | null>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);

    // mode：format / minify 是用户点了按钮；auto 是输入停顿后自动格式化。
    // 出错时光标只在点按钮那种情况下才跳到出错处：自动格式化是边打边触发的，跳了会把正在打的字打断
    const run = useCallback((text: string, mode: "format" | "minify" | "auto") => {
        try {
            const v = JSON.parse(text);
            setOutput(JSON.stringify(v, null, mode === "minify" ? 0 : 2));
            setError(null);
        } catch (e) {
            const { error: located, pos } = locateError(text, e);
            setError(located);
            const el = inputRef.current;
            if (mode === "auto" || pos === null || !el) return;
            el.focus();
            el.setSelectionRange(pos, Math.min(pos + 1, text.length));
            // Chrome 设了选区也不会滚过去：失焦再聚焦一次，才会把出错的位置滚进视野
            el.blur();
            el.focus();
        }
    }, []);

    // 输入停顿后自动格式化：贴进来就能看到结果，错了只在状态条提示。空输入回到初始态
    useEffect(() => {
        if (input.trim() === "") {
            setOutput("");
            setError(null);
            return;
        }
        const timer = setTimeout(() => run(input, "auto"), AUTO_FORMAT_MS);
        return () => clearTimeout(timer);
    }, [input, run]);

    async function copy() {
        if (!output) return;
        try {
            await navigator.clipboard.writeText(output);
            toast.success(t("json.copied"));
        } catch {
            toast.error(t("toast.error"));
        }
    }

    const errorText =
        error === null
            ? null
            : error === "unknown"
              ? t("json.errUnknown")
              : error === "end"
                ? t("json.errEnd")
                : t("json.errAt").replace("{line}", String(error.line)).replace("{col}", String(error.col));

    return (
        <div className="flex h-full flex-col">
            {/* 工具栏：主操作蓝实心，次操作描边，轻量动作 ghost；状态文案跟在尾部 */}
            <Toolbar className="gan-no-drag gap-2 px-3.5">
                <ToolbarGroup>
                    <Button appearance="standard" variant="primary" size="sm" onClick={() => run(input, "format")}>
                        {t("json.format")}
                    </Button>
                    <Button appearance="standard" variant="outline" size="sm" onClick={() => run(input, "minify")}>
                        {t("json.minify")}
                    </Button>
                </ToolbarGroup>
                <ToolbarSeparator />
                <ToolbarGroup>
                    <Button appearance="standard" variant="outline" size="sm" onClick={copy}>
                        {t("json.copy")}
                    </Button>
                    <Button
                        type="button"
                        appearance="standard"
                        variant="ghost"
                        size="xs"
                        className="h-auto px-0 text-[11px] text-muted-foreground enabled:hover:text-foreground"
                        onClick={() => {
                            setInput("");
                            setOutput("");
                            setError(null);
                        }}
                    >
                        {t("json.clear")}
                    </Button>
                </ToolbarGroup>
                {input && (
                    <StatusBar className="h-full min-w-0 grow shrink border-t-0 bg-transparent px-0">
                        <StatusBarItem
                            className={`truncate text-[11.5px] ${errorText ? "text-destructive" : "text-dim-foreground"}`}
                        >
                            {errorText ?? (output ? t("json.ok") : "")}
                        </StatusBarItem>
                    </StatusBar>
                )}
            </Toolbar>
            {/* 双栏编辑器：左输入右结果，弱分隔线隔开；结果区用井底区分。
                整栏 Textarea 覆盖圆角与内阴影，避免编辑区看起来像内嵌卡片 */}
            <div className="flex min-h-0 flex-1">
                <Textarea
                    ref={inputRef}
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
