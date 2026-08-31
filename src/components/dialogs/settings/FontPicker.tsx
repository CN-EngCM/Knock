import { useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DEFAULT_MONO_STACK, DEFAULT_SANS_STACK, withFallback } from "@/lib/fonts";
import { useI18n } from "@/i18n/useI18n";
import { CommitInput } from "./shared";

// TS 5.8 的 lib.dom 尚未收录 queryLocalFonts（实验性 API，Electron 42 的 Chromium 已实装），
// 这里声明渲染端用到的最小形状。它要求用户手势激活，挂载时调用会被拒——
// 因此延迟到下拉首次展开（必然是手势上下文）时才调。
declare global {
    interface Window {
        queryLocalFonts?: () => Promise<{ family: string }[]>;
    }
}

// 本机字体家族的模块级缓存：两个 FontPicker 共享，避免重复枚举。
// undefined = 尚未拉取；null = 拉取失败（权限被拒 / API 缺失），退化为纯手填。
let cachedFamilies: string[] | null | undefined;

// select 哨兵值：Radix Select 的 value 不接受空串，用冒号前缀避免与真实字体名撞车
// （同 AiTool 的 NO_MODEL 做法）
const DEFAULT_OPT = ":default";
const CUSTOM_OPT = ":custom";

// 预览样本是字形展示不是 UI 文案，故作常量不进 i18n：特意混排中英、易混淆字形（0/O、1/l/I）与 URL
const FONT_SAMPLE = "中英混排 AaBbGg 0O1lIi | http://…";

type Props = {
    /** true = 等宽字体（预览按等宽默认栈回退），false = 界面字体 */
    mono?: boolean;
    /** 当前生效值（空串 = 用默认栈）；提交后由父级落库回填 */
    value: string;
    /** 下拉即选即交 / 手填失焦交；提交失败时父级不回填，控件随 props 自动还原 */
    onCommit: (v: string) => void;
};

/** 字体设置控件（界面/等宽共用）：本机字体下拉 + 「自定义…」手填 + 当前生效栈样例预览 */
export function FontPicker({ mono = false, value, onCommit }: Props) {
    const { t } = useI18n();
    const [families, setFamilies] = useState<string[] | null | undefined>(cachedFamilies);
    // 「自定义…」手填态：仅在字体枚举成功时作为补充入口存在
    const [customizing, setCustomizing] = useState(false);
    const [draft, setDraft] = useState(value);

    /** 展开下拉时才枚举本机字体（见 window.queryLocalFonts 声明处的手势约束） */
    function ensureFamilies() {
        if (cachedFamilies !== undefined) {
            setFamilies(cachedFamilies);
            return;
        }
        void (async () => {
            try {
                const query = window.queryLocalFonts;
                if (!query) throw new Error("unsupported");
                const fonts = await query.call(window);
                cachedFamilies = [...new Set(fonts.map((f) => f.family))].sort((a, b) => a.localeCompare(b));
            } catch {
                cachedFamilies = null;
            }
            setFamilies(cachedFamilies);
        })();
    }

    function pick(v: string) {
        if (v === DEFAULT_OPT) {
            onCommit("");
        } else if (v === CUSTOM_OPT) {
            setDraft(value); // 从当前值起手改
            setCustomizing(true);
        } else {
            onCommit(v);
        }
    }

    /** 手填提交：trim 后交父级并退出手填态（值是否可用由预览与回填结果呈现） */
    function commitCustom() {
        setCustomizing(false);
        onCommit(draft.trim());
    }

    const listReady = Array.isArray(families);
    // 当前值不在（已枚举的）家族列表里：历史手填值或尚未枚举——补一项让下拉能显示选中态
    const showCurrentItem = value !== "" && (!listReady || !families.includes(value));

    return (
        <div className="min-w-0">
            {families !== null && (
                <Select
                    value={value === "" ? DEFAULT_OPT : value}
                    onValueChange={pick}
                    onOpenChange={(open) => open && ensureFamilies()}
                >
                    <SelectTrigger className="w-full">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value={DEFAULT_OPT}>{t("settings.font.default")}</SelectItem>
                        {listReady &&
                            families.map((f) => (
                                <SelectItem key={f} value={f}>
                                    {f}
                                </SelectItem>
                            ))}
                        {showCurrentItem && <SelectItem value={value}>{value}</SelectItem>}
                        <SelectItem value={CUSTOM_OPT}>{t("settings.font.custom")}</SelectItem>
                    </SelectContent>
                </Select>
            )}
            {/* 纯手填兜底（枚举不可用）或「自定义…」手填态 */}
            {(families === null || customizing) && (
                <CommitInput
                    value={draft}
                    onChange={setDraft}
                    onCommit={commitCustom}
                    placeholder={t("settings.font.customPlaceholder")}
                    className={families !== null ? "mt-1.5" : undefined}
                />
            )}
            {/* 样例按「即将生效」的栈渲染（用户值 + 默认栈回退），改动回填后即时可见 */}
            <div
                className="mt-1.5 truncate text-[12px] text-muted"
                style={{ fontFamily: withFallback(value, mono ? DEFAULT_MONO_STACK : DEFAULT_SANS_STACK) }}
            >
                {FONT_SAMPLE}
            </div>
        </div>
    );
}
