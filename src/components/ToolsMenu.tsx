import { LayoutGrid, Plus } from "lucide-react";
import { TOOLS, type ToolId } from "@/tools/registry";
import { MenuTrigger, MenuContent, MenuItem } from "@/components/ui/menu";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/useI18n";

// 工具下拉：内置工具的可见入口（顶栏按钮 + tab 行的 ＋ 共用）。
// 已打开的工具行尾亮蓝点（点它只是切到该 tab），未打开显示一句描述。
type Props = {
    open: ToolId[];
    onOpen: (id: ToolId) => void;
    /** header = 顶栏带文字按钮；tab = tab 行的 ＋ 图标按钮 */
    placement?: "header" | "tab";
};

export function ToolsMenu({ open, onOpen, placement = "header" }: Props) {
    const { t } = useI18n();
    return (
        <MenuTrigger align="end">
            {placement === "header" ? (
                <Button size="default" className="gap-1.5" aria-label={t("tools.menu")}>
                    <LayoutGrid className="size-3.5" />
                    <span>{t("tools.menu")}</span>
                </Button>
            ) : (
                <Button
                    variant="ghost"
                    size="icon"
                    className="size-6"
                    aria-label={t("tools.menu")}
                    title={t("tools.menu")}
                >
                    <Plus className="size-3.5" />
                </Button>
            )}
            <MenuContent className="w-[248px]">
                {TOOLS.map((tool) => {
                    const Icon = tool.icon;
                    const opened = open.includes(tool.id);
                    return (
                        <MenuItem
                            key={tool.id}
                            onSelect={() => onOpen(tool.id)}
                            className={opened ? "text-foreground" : undefined}
                        >
                            <Icon className="flex-none text-muted-foreground" />
                            <span className="min-w-0 flex-1 truncate">{t(tool.nameKey)}</span>
                            <span
                                className={`ms-auto ps-4 text-[10px] ${opened ? "text-primary" : "text-dim-foreground"}`}
                            >
                                {opened ? `● ${t("tools.opened")}` : t(tool.descKey)}
                            </span>
                        </MenuItem>
                    );
                })}
            </MenuContent>
        </MenuTrigger>
    );
}
