import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyDescription } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { searchIcons } from "@/lib/fileIcon";
import {
    iconSetOf,
    isIconSetLoaded,
    itemIconUrl,
    loadIconSet,
    searchSetIcons,
    useIconSets,
    type IconSetId,
} from "@/lib/iconSets";
import { useI18n } from "@/i18n/useI18n";
import type { MessageKey } from "@/i18n/zh";

type Props = {
    open: boolean;
    onClose: () => void;
    /** 当前选中的图标名；null = 自动 */
    current: string | null;
    /** 浅色主题：有专为浅底画的款式的图标会换成它，单色图标也按它取色 */
    light: boolean;
    /** 选中一个图标，或 null = 恢复自动。选完对话框自己关 */
    onPick: (iconId: string | null) => void;
};

type Tab = "file" | IconSetId;

// 五页：第一页是原有的文件类图标包（Material Icon Theme），其余是 lib/iconSets.ts 里的四个图标库
const TABS: { id: Tab; label: MessageKey }[] = [
    { id: "file", label: "iconPicker.tab.file" },
    { id: "logos", label: "iconPicker.tab.brand" },
    { id: "fluent-color", label: "iconPicker.tab.office" },
    { id: "mdi", label: "iconPicker.tab.general" },
    { id: "ix", label: "iconPicker.tab.industrial" },
];

// 新图标库一个有几千个，一次画出来太重：先画这么多，余下的点「显示更多」
const PAGE = 300;

// 条目图标选择器：顶上五个标签页切图标库，下面是搜索框和图标网格，底部「恢复自动」。
// 图标只显示不写名字（放不下），悬停看名字；文件类可以搜扩展名，其余只搜英文图标名。
export function IconPickerDialog({ open, onClose, current, light, onPick }: Props) {
    const { t } = useI18n();
    const [tab, setTab] = useState<Tab>("file");
    const [query, setQuery] = useState("");
    const [limit, setLimit] = useState(PAGE);
    const [failed, setFailed] = useState(false);
    // 图标库载入完要重搜、重画
    const setsVersion = useIconSets();

    // 每次打开：回到当前图标所在的那一页（没选或是文件类图标就是第一页），清空搜索
    useEffect(() => {
        if (!open) return;
        setTab(current ? (iconSetOf(current)?.id ?? "file") : "file");
        setQuery("");
        setLimit(PAGE);
        // 只在打开的那一刻读 current，选中后对话框就关了
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    // 切到新图标库的页就开始载入它
    useEffect(() => {
        if (!open || tab === "file") return;
        setFailed(false);
        loadIconSet(tab).catch(() => setFailed(true));
    }, [open, tab]);

    const icons = useMemo(
        () => (tab === "file" ? searchIcons(query) : searchSetIcons(tab, query)),
        // setsVersion 变了说明有库载入完，要重搜
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [tab, query, setsVersion],
    );
    // 文件类图标包九百多个，全画（图标是独立文件，loading="lazy" 滚到才请求）；新图标库分页
    const shown = tab === "file" ? icons : icons.slice(0, limit);
    const loading = tab !== "file" && !failed && !isIconSetLoaded(tab);

    function pick(iconId: string | null) {
        onPick(iconId);
        onClose();
    }

    return (
        <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
            <DialogContent className="sm:max-w-[560px]">
                <DialogHeader>
                    <DialogTitle>{t("iconPicker.title")}</DialogTitle>
                </DialogHeader>

                <Tabs
                    value={tab}
                    onValueChange={(v) => {
                        setTab(v as Tab);
                        setLimit(PAGE);
                    }}
                >
                    <TabsList>
                        {TABS.map((x) => (
                            <TabsTrigger key={x.id} value={x.id}>
                                {t(x.label)}
                            </TabsTrigger>
                        ))}
                    </TabsList>
                </Tabs>

                <Input
                    placeholder={t(tab === "file" ? "iconPicker.placeholder" : "iconPicker.placeholderName")}
                    value={query}
                    onChange={(e) => {
                        setQuery(e.target.value);
                        setLimit(PAGE);
                    }}
                    autoFocus
                />

                <div className="max-h-[50vh] min-h-40 overflow-y-auto border border-line p-1.5">
                    {loading ? (
                        <div className="grid place-items-center py-10">
                            <Spinner decorative className="text-muted-foreground" />
                        </div>
                    ) : failed ? (
                        <Empty className="px-3 py-6">
                            <EmptyDescription>{t("iconPicker.loadFailed")}</EmptyDescription>
                        </Empty>
                    ) : icons.length === 0 ? (
                        <Empty className="px-3 py-6">
                            <EmptyDescription>{t("iconPicker.empty")}</EmptyDescription>
                        </Empty>
                    ) : (
                        <>
                            <div className="grid grid-cols-[repeat(auto-fill,minmax(40px,1fr))] gap-1">
                                {shown.map((id) => (
                                    <button
                                        key={id}
                                        type="button"
                                        title={id}
                                        aria-label={id}
                                        aria-pressed={id === current}
                                        onClick={() => pick(id)}
                                        className="grid h-10 place-items-center rounded-sm hover:bg-(--state-hover) aria-pressed:bg-(--state-selected)"
                                    >
                                        <img src={itemIconUrl(id, light)} alt="" loading="lazy" className="size-6" />
                                    </button>
                                ))}
                            </div>
                            {shown.length < icons.length && (
                                <Button
                                    type="button"
                                    appearance="standard"
                                    variant="outline"
                                    size="default"
                                    className="mt-1.5 w-full"
                                    onClick={() => setLimit((n) => n + PAGE)}
                                >
                                    {t("iconPicker.more").replace("{n}", String(icons.length - shown.length))}
                                </Button>
                            )}
                        </>
                    )}
                </div>

                <DialogFooter>
                    <Button
                        type="button"
                        appearance="standard"
                        variant="outline"
                        size="default"
                        onClick={() => pick(null)}
                    >
                        {t("iconPicker.reset")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
