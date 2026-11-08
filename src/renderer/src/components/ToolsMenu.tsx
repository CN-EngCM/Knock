import { LayoutGrid } from "lucide-react";
import { TOOLS, type ToolId } from "@/tools/registry";
import { Badge } from "@/components/ui/badge";
import { MenuTrigger, MenuContent, MenuItem } from "@/components/ui/menu";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useI18n } from "@/i18n/useI18n";

// 顶栏「工具集」：工具入口的唯一起点。终端每次选择都新建会话；
// openTools 是当前已开着标签的工具，菜单里打「已打开」。
type Props = {
    openTools: ToolId[];
    onOpen: (id: ToolId) => void;
};

export function ToolsMenu({ openTools, onOpen }: Props) {
    const { t } = useI18n();
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
                                const opened = openTools.includes(tool.id);
                                return (
                                    <MenuItem
                                        key={tool.id}
                                        onSelect={() => onOpen(tool.id)}
                                        className={opened ? "text-foreground" : undefined}
                                    >
                                        <img src={tool.icon} alt="" className="size-4 flex-none" />
                                        {/* 名字不许缩、描述才缩：Badge 默认 shrink-0 且不换行，描述一长
                                            就会把名字挤成 0 宽。所以名字 flex-none，Badge 改成可收缩，文字在里面截断 */}
                                        <span className="flex-none">{t(tool.nameKey)}</span>
                                        <Badge
                                            variant="ghost"
                                            className={`ms-auto min-w-0 shrink ps-2 ${opened ? "text-primary" : "text-dim-foreground"}`}
                                        >
                                            <span className="truncate">
                                                {opened ? `● ${t("tools.opened")}` : t(tool.descKey)}
                                            </span>
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
