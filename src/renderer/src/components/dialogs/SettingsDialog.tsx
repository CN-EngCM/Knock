import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
    type AiModelConfig,
    type FontConfig,
    type FontPatch,
    type TermConfig,
    type TermPatch,
    type ThemeId,
    type ToolAliasPatch,
    type ToolAliases,
    type TranslateConfig,
    type TranslateConfigPatch,
} from "@/api/client";
import { useI18n } from "@/i18n/useI18n";
import type { Lang } from "@/i18n";
import { BasicSection } from "./settings/BasicSection";
import { ToolsSection } from "./settings/ToolsSection";
import { TranslateSection } from "./settings/TranslateSection";
import { AiSection } from "./settings/AiSection";
import { GallerySection } from "./settings/GallerySection";

type Props = {
    open: boolean;
    onClose: () => void;
    lang: Lang;
    onChangeLang: (lang: Lang) => void;
    platform: string;
    /** 界面主题（App 状态）：提交走 onTheme（App 负责落库与全局换装） */
    theme: ThemeId;
    onTheme: (theme: ThemeId) => void;
    /** 从设置里打开书签导入 */
    onOpenImport: () => void;
    /** 终端设置：shell 候选与当前值；提交走 onTermPatch（App 负责落库与回填） */
    termCfg: TermConfig | null;
    onTermPatch: (patch: TermPatch) => Promise<boolean>;
    /** 字体设置（界面/等宽）：提交走 onFontPatch（App 负责落库、回填与写 CSS 变量） */
    fontCfg: FontConfig | null;
    onFontPatch: (patch: FontPatch) => Promise<boolean>;
    /** 工具别名：提交走 onToolAlias（App 负责落库与回填，SearchBox 随之生效） */
    toolAliases: ToolAliases | null;
    onToolAlias: (patch: ToolAliasPatch) => Promise<boolean>;
    /** 剪贴板素材时限（秒，0 = 关闭）：主进程呼出时直接读库，此处仅编辑态 */
    clipSec: number | null;
    onClipSec: (seconds: number) => Promise<boolean>;
    /** 有道翻译密钥：提交走 onTranslateCfg（App 负责落库与回填） */
    translateCfg: TranslateConfig | null;
    onTranslateCfg: (patch: TranslateConfigPatch) => Promise<boolean>;
    /** AI 模型配置整表：提交走 onAiModels（App 负责落库与回填） */
    aiModels: AiModelConfig[] | null;
    onAiModels: (list: AiModelConfig[]) => Promise<boolean>;
    /** 打开时直接定位的分节（工具内「打开设置」引导；缺省回基础设置） */
    initialSection?: SectionId;
};

// 分节导航定义：新增设置分节 = 这里加一项 + dialogs/settings/ 下加分节组件 + 下方渲染分支补一段
const SECTION_DEFS = [
    { id: "basic", labelKey: "settings.basic" },
    { id: "tools", labelKey: "settings.tools" },
    { id: "translate", labelKey: "settings.translate" },
    { id: "ai", labelKey: "settings.ai" },
    { id: "gallery", labelKey: "settings.gallery" },
] as const;
export type SectionId = (typeof SECTION_DEFS)[number]["id"];

// 外壳只管结构：弹窗骨架、分节导航、按 sec 渲染对应分节组件。
// 各分节的表单状态/数据拉取/提交逻辑内聚在 settings/ 下的组件里，随开关挂卸载。
export function SettingsDialog({
    open,
    onClose,
    lang,
    onChangeLang,
    platform,
    theme,
    onTheme,
    onOpenImport,
    termCfg,
    onTermPatch,
    fontCfg,
    onFontPatch,
    toolAliases,
    onToolAlias,
    clipSec,
    onClipSec,
    translateCfg,
    onTranslateCfg,
    aiModels,
    onAiModels,
    initialSection,
}: Props) {
    const { t } = useI18n();
    const [sec, setSec] = useState<SectionId>("basic");

    // 打开时回到定位分节（或第一个分节）
    useEffect(() => {
        if (!open) return;
        setSec(initialSection ?? "basic");
    }, [open, initialSection]);

    return (
        <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
            {/* 固定高度让各分节高度一致（切分节不跳动）；flex 能覆盖基类 grid 是因为 cn() 基于 tailwind-merge 同组后者胜 */}
            <DialogContent className="flex h-[560px] max-h-[85vh] flex-col gap-0 p-0 sm:max-w-[680px]">
                <DialogHeader className="border-b border-border bg-panel px-4 py-3">
                    <DialogTitle>{t("settings.title")}</DialogTitle>
                </DialogHeader>

                {/* 两栏：左=分节导航（SECTION_DEFS 驱动），右=当前分节内容 */}
                <div className="flex min-h-0 flex-1">
                    <nav className="flex w-36 flex-none flex-col gap-0.5 border-e border-line bg-canvas p-2">
                        {SECTION_DEFS.map((s) => (
                            <button
                                key={s.id}
                                type="button"
                                onClick={() => setSec(s.id)}
                                aria-pressed={sec === s.id}
                                className={`min-h-8 rounded-[4px] px-2.5 text-left text-xs transition-colors ${
                                    sec === s.id
                                        ? "bg-rowsel text-primary"
                                        : "text-muted-foreground hover:bg-hover hover:text-foreground"
                                }`}
                            >
                                {t(s.labelKey)}
                            </button>
                        ))}
                    </nav>
                    <div className="grid min-h-0 min-w-0 flex-1 content-start gap-3 overflow-y-auto p-5">
                        {sec === "basic" && (
                            <BasicSection
                                lang={lang}
                                onChangeLang={onChangeLang}
                                platform={platform}
                                theme={theme}
                                onTheme={onTheme}
                                onOpenImport={onOpenImport}
                                termCfg={termCfg}
                                onTermPatch={onTermPatch}
                                fontCfg={fontCfg}
                                onFontPatch={onFontPatch}
                                clipSec={clipSec}
                                onClipSec={onClipSec}
                            />
                        )}
                        {sec === "tools" && <ToolsSection toolAliases={toolAliases} onToolAlias={onToolAlias} />}
                        {sec === "translate" && (
                            <TranslateSection translateCfg={translateCfg} onTranslateCfg={onTranslateCfg} />
                        )}
                        {sec === "ai" && <AiSection aiModels={aiModels} onAiModels={onAiModels} />}
                        {sec === "gallery" && <GallerySection />}
                    </div>
                </div>

                {/* mx-0 mb-0 覆盖公共 Footer 配合默认 p-5 的 -mx-5 -mb-5（本弹窗 p-0，不覆盖会伸出弹窗边缘） */}
                <DialogFooter className="mx-0 mb-0 px-4 py-2.5">
                    <Button type="button" appearance="standard" variant="primary" onClick={onClose}>
                        {t("common.close")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
