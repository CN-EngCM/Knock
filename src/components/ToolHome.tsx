import { TOOLS, type ToolId } from "@/tools/registry";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { useI18n } from "@/i18n/useI18n";

type Props = {
    /** 点卡片开工具 tab（与工具菜单同一条路径，不带素材） */
    onOpen: (id: ToolId) => void;
};

// 工具首页：右列无激活页签时的工作区内容（纯界面导航——不建会话、不新增工具 id）。
// 卡片网格 + 快捷键提示，替代旧版 ASCII 字符画。
export function ToolHome({ onOpen }: Props) {
    const { t } = useI18n();
    return (
        // h-full 把高度锚到 ToolsZone 的定位父容器（flex-1 已给出确定高度）：
        // 没有 h-full 时根节点按内容展开、溢出工作区且无法滚动
        <section className="flex h-full justify-center overflow-y-auto" aria-label={t("tools.home")}>
            <div className="w-full max-w-[760px] px-8 pb-6 pt-9">
                <div className="mb-1.5 flex items-baseline justify-between gap-4">
                    <h2 className="text-xl font-medium tracking-wide">{t("home.title")}</h2>
                    <span className="text-[11px] text-dim-foreground">{t("home.sub")}</span>
                </div>
                <p className="mb-6 text-xs text-muted-foreground">{t("home.desc")}</p>
                <div className="grid grid-cols-2 gap-x-4">
                    {TOOLS.map((tool) => {
                        const Icon = tool.icon;
                        return (
                            <button
                                key={tool.id}
                                type="button"
                                onClick={() => onOpen(tool.id)}
                                className="group flex min-h-[74px] items-center gap-3 border-b border-line px-2 py-3 text-left transition-colors hover:rounded-[5px] hover:bg-hover"
                            >
                                <span className="grid size-8 flex-none place-items-center rounded-md border border-border bg-background text-muted-foreground transition-colors group-hover:text-primary">
                                    <Icon className="size-4" />
                                </span>
                                <span className="flex min-w-0 flex-col gap-0.5">
                                    <span className="text-xs font-medium">{t(tool.nameKey)}</span>
                                    <span className="truncate text-[11px] text-dim-foreground">{t(tool.descKey)}</span>
                                </span>
                            </button>
                        );
                    })}
                </div>
                <div className="mt-7 flex flex-wrap justify-center gap-x-4 gap-y-1.5 text-[11px] text-dim-foreground">
                    <span className="flex items-center gap-1.5">
                        <Kbd>/</Kbd>
                        {t("home.kbd.search")}
                    </span>
                    <span className="flex items-center gap-1.5">
                        <KbdGroup>
                            <Kbd>↑</Kbd>
                            <Kbd>↓</Kbd>
                        </KbdGroup>
                        {t("home.kbd.select")}
                    </span>
                    <span className="flex items-center gap-1.5">
                        <Kbd>Enter</Kbd>
                        {t("home.kbd.open")}
                    </span>
                </div>
            </div>
        </section>
    );
}
