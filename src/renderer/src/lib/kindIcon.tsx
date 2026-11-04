import type { Item, Kind } from "@/api/client";
import appWindowIcon from "@/assets/icons/app-window.svg";
import folderIcon from "@/assets/icons/folder.svg";
import globeIcon from "@/assets/icons/globe.svg";
import terminalIcon from "@/assets/icons/terminal.svg";

// 四类各一个拟物图形，不区分具体站点或程序：图标只回答「这是什么类型」，
// 认哪一条靠后面的标题。
const KIND_ICON: Record<Kind, string> = {
    bookmark: globeIcon,
    app: appWindowIcon,
    file: folderIcon,
    command: terminalIcon,
};

/** 行首类型图标：18px 彩色拟物图，颜色由图形自带，不随主题变化 */
export function KindIcon({ item }: { item: Item }) {
    return <img src={KIND_ICON[item.kind]} alt="" className="size-[18px] flex-none" />;
}
