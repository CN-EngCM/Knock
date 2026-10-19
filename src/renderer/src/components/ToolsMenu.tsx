import { Plus } from "lucide-react";
import { TOOLS, type ToolId } from "@/tools/registry";
import { MenuTrigger, MenuContent, MenuItem } from "@/components/ui/menu";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/useI18n";

// 单个标签的工具显示已打开状态；终端每次选择都会新建会话。
type Props = {
    open: ToolId[];
    onOpen: (id: ToolId) => void;
};

export function ToolsMenu({ open, onOpen }: Props) {
    const { t } = useI18n();
    return (
        <MenuTrigger align="end">
            <Button
                variant="ghost"
                size="icon"
                className="size-[21px]"
                aria-label={t("tools.menu")}
                title={t("tools.menu")}
            >
                <Plus className="size-3.5" />
            </Button>
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
