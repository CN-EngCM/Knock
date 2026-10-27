import { TOOLS, type ToolId } from "@/tools/registry";
import { Button } from "@/components/ui/button";
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { useI18n } from "@/i18n/useI18n";

type Props = {
    /** 点卡片开工具 tab（与工具菜单同一条路径，不带素材） */
    onOpen: (id: ToolId) => void;
};

// 无标签时提供工具入口，终端卡片与菜单共用新建会话流程。
export function ToolHome({ onOpen }: Props) {
    const { t } = useI18n();
    return (
        // h-full 把高度锚到定位父容器（flex-1 已给出确定高度）：
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
                            <Item key={tool.id} asChild size="sm" className="min-h-[74px] border-0 p-0">
                                <Button
                                    variant="ghost"
                                    className="h-auto min-h-[74px] w-full justify-start gap-3 rounded-md border-b border-line px-2 py-3 text-left"
                                    onClick={() => onOpen(tool.id)}
                                >
                                    <ItemMedia variant="icon">
                                        <Icon />
                                    </ItemMedia>
                                    <ItemContent className="gap-0.5">
                                        <ItemTitle>{t(tool.nameKey)}</ItemTitle>
                                        <ItemDescription className="line-clamp-1 text-[11px] text-dim-foreground">
                                            {t(tool.descKey)}
                                        </ItemDescription>
                                    </ItemContent>
                                </Button>
                            </Item>
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
