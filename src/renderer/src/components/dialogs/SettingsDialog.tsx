import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
    type FolderAction,
    type FontConfig,
    type Item,
    type FontPatch,
    type TermConfig,
    type TermPatch,
    type ThemeId,
    type ToolAliasPatch,
    type ToolAliases,
} from "@/api/client";
import { useWindowRoom } from "@/lib/windowRoom";
import { useI18n } from "@/i18n/useI18n";
import type { Lang } from "@/i18n";
import { BasicSection } from "./settings/BasicSection";
import { LauncherSection } from "./settings/LauncherSection";
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
    /** 终端设置：shell 候选与当前值；提交走 onTermPatch（App 负责落库与回填） */
    termCfg: TermConfig | null;
    onTermPatch: (patch: TermPatch) => Promise<boolean>;
    /** 字体设置（界面/等宽）：提交走 onFontPatch（App 负责落库、回填与写 CSS 变量） */
    fontCfg: FontConfig | null;
    onFontPatch: (patch: FontPatch) => Promise<boolean>;
    /** 工具别名：提交走 onToolAlias（App 负责落库与回填，SearchBox 随之生效） */
    toolAliases: ToolAliases | null;
    onToolAlias: (patch: ToolAliasPatch) => Promise<boolean>;
    /** 快捷启动条目与目录判定：「快速启动」分节列出它们；新增、编辑、删除都交给 App（条目弹窗叠在设置页上面） */
    items: Item[];
    dirIds: ReadonlySet<number>;
    onAddItem: () => void;
    onEditItem: (item: Item) => void;
    onDeleteItem: (item: Item) => void;
    /** 文件夹动作（文件夹条目 → 子菜单项）：整份保存交给 App，SearchBox 随之生效 */
    folderActions: FolderAction[] | null;
    onSaveFolderActions: (actions: FolderAction[]) => Promise<boolean>;
    /** 打开时直接定位的分节（工具内「打开设置」引导；缺省回基础设置） */
    initialSection?: SectionId;
};

// 分节导航定义：新增设置分节 = 这里加一项 + dialogs/settings/ 下加分节组件 + 下方渲染分支补一段
const SECTION_DEFS = [
    { id: "basic", labelKey: "settings.basic" },
    { id: "launcher", labelKey: "settings.launcher" },
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
    termCfg,
    onTermPatch,
    fontCfg,
    onFontPatch,
    toolAliases,
    onToolAlias,
    items,
    dirIds,
    onAddItem,
    onEditItem,
    onDeleteItem,
    folderActions,
    onSaveFolderActions,
    initialSection,
}: Props) {
    const { t } = useI18n();
    // 窗口收成一条时，设置页（560px 高、最多占窗口 85%）放不下：打开期间撑开窗口，关了缩回去
    useWindowRoom(open ? 680 : 0);
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

                {/* 两栏：左=分节导航（SECTION_DEFS 驱动），右=当前分节内容。
                    forceMount 让各分节常驻，切走再切回不丢未提交的表单草稿；
                    非激活面板由库的 data-[state=inactive]:hidden 隐藏。 */}
                <Tabs
                    orientation="vertical"
                    value={sec}
                    onValueChange={(value) => setSec(value as SectionId)}
                    className="flex min-h-0 flex-1 gap-0"
                >
                    {/* 定宽 144px（沿用原导航宽度）由 w-36 保持；表面继续用侧栏的 canvas + 右分隔线 */}
                    <TabsList className="w-36 flex-none flex-col gap-0.5 rounded-none border-e border-line bg-canvas p-2 dark:bg-canvas">
                        {SECTION_DEFS.map((s) => (
                            <TabsTrigger key={s.id} value={s.id}>
                                {t(s.labelKey)}
                            </TabsTrigger>
                        ))}
                    </TabsList>
                    <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-5">
                        <TabsContent value="basic" forceMount className="grid content-start gap-3">
                            <BasicSection
                                lang={lang}
                                onChangeLang={onChangeLang}
                                platform={platform}
                                theme={theme}
                                onTheme={onTheme}
                                termCfg={termCfg}
                                onTermPatch={onTermPatch}
                                fontCfg={fontCfg}
                                onFontPatch={onFontPatch}
                            />
                        </TabsContent>
                        <TabsContent value="launcher" forceMount className="grid content-start gap-3">
                            <LauncherSection
                                items={items}
                                dirIds={dirIds}
                                light={theme === "light"}
                                onAdd={onAddItem}
                                onEdit={onEditItem}
                                onDelete={onDeleteItem}
                                folderActions={folderActions}
                                onSaveFolderActions={onSaveFolderActions}
                            />
                        </TabsContent>
                        <TabsContent value="tools" forceMount className="grid content-start gap-3">
                            <ToolsSection toolAliases={toolAliases} onToolAlias={onToolAlias} />
                        </TabsContent>
                        <TabsContent value="translate" forceMount className="grid content-start gap-3">
                            <TranslateSection />
                        </TabsContent>
                        <TabsContent value="ai" forceMount className="grid content-start gap-3">
                            <AiSection />
                        </TabsContent>
                        <TabsContent value="gallery" forceMount className="grid content-start gap-3">
                            <GallerySection />
                        </TabsContent>
                    </div>
                </Tabs>

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
