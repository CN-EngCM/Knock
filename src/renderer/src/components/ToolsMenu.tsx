import { Plus } from "lucide-react";
import { TOOLS, type ToolId } from "@/tools/registry";
import { Badge } from "@/components/ui/badge";
import { MenuTrigger, MenuContent, MenuItem } from "@/components/ui/menu";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useI18n } from "@/i18n/useI18n";

// 单个标签的工具显示已打开状态；终端每次选择都会新建会话。
type Props = {
    open: ToolId[];
    onOpen: (id: ToolId) => void;
};

export function ToolsMenu({ open, onOpen }: Props) {
    const { t } = useI18n();
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                {/* MenuTrigger 会把第一个子元素当作触发器克隆，直接放 Tooltip 会丢点击/焦点属性；
                    这里用 span 承接 tooltip 的悬停与焦点事件，菜单锚点仍是内部的 Button。 */}
                <span className="inline-flex">
                    <MenuTrigger align="end">
                        <Button variant="ghost" size="icon" className="size-[21px]" aria-label={t("tools.menu")}>
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
                                        <Badge
                                            variant="ghost"
                                            className={`ms-auto ps-2 ${opened ? "text-primary" : "text-dim-foreground"}`}
                                        >
                                            {opened ? `● ${t("tools.opened")}` : t(tool.descKey)}
                                        </Badge>
                                    </MenuItem>
                                );
                            })}
                        </MenuContent>
                    </MenuTrigger>
                </span>
            </TooltipTrigger>
            <TooltipContent>{t("tools.menu")}</TooltipContent>
        </Tooltip>
    );
}
