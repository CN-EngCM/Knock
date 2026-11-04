import { LayoutGrid } from "lucide-react";
import { TOOLS, type ToolId } from "@/tools/registry";
import { Badge } from "@/components/ui/badge";
import { MenuTrigger, MenuContent, MenuItem } from "@/components/ui/menu";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useI18n } from "@/i18n/useI18n";

// 顶栏「工具集」：工具入口的唯一起点，停靠组头不再挂 + 号。终端每次选择都新建会话；
// 已打开状态在菜单展开时现取，避免把 dock 面板列表提升成全局状态。
type Props = {
    getOpenTools: () => ToolId[];
    onOpen: (id: ToolId) => void;
};

export function ToolsMenu({ getOpenTools, onOpen }: Props) {
    const { t } = useI18n();
    const open = getOpenTools();
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                {/* MenuTrigger 会把第一个子元素当作触发器克隆，直接放 Tooltip 会丢点击/焦点属性；
                    这里用 span 承接 tooltip 的悬停与焦点事件，菜单锚点仍是内部的 Button。 */}
                <span className="inline-flex">
                    <MenuTrigger align="end">
                        <Button variant="ghost" size="icon" className="size-7" aria-label={t("tools.menu")}>
                            <LayoutGrid className="size-4" />
                        </Button>
                        <MenuContent className="w-[248px]">
                            {TOOLS.map((tool) => {
                                const opened = open.includes(tool.id);
                                return (
                                    <MenuItem
                                        key={tool.id}
                                        onSelect={() => onOpen(tool.id)}
                                        className={opened ? "text-foreground" : undefined}
                                    >
                                        <img src={tool.icon} alt="" className="size-4 flex-none" />
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
