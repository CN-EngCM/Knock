import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyDescription } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { namedIconUrl, searchIcons } from "@/lib/fileIcon";
import { useI18n } from "@/i18n/useI18n";

type Props = {
    open: boolean;
    onClose: () => void;
    /** 当前选中的图标名；null = 自动 */
    current: string | null;
    /** 浅色主题：有专为浅底画的款式的图标会换成它 */
    light: boolean;
    /** 选中一个图标，或 null = 恢复自动。选完对话框自己关 */
    onPick: (iconId: string | null) => void;
};

// 条目图标选择器：图标包（Material Icon Theme）全部可选图标的网格，上方搜索框，下方「恢复自动」。
// 图标只显示不写名字（九百多个，名字放不下），悬停看名字；想按名字或扩展名找就用搜索。
export function IconPickerDialog({ open, onClose, current, light, onPick }: Props) {
    const { t } = useI18n();
    const [query, setQuery] = useState("");
    useEffect(() => {
        if (open) setQuery("");
    }, [open]);

    const icons = useMemo(() => searchIcons(query), [query]);

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

                <Input
                    placeholder={t("iconPicker.placeholder")}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    autoFocus
                />

                {/* 图标是独立的 svg 文件，loading="lazy" 让滚到才请求，九百多个不会一次全发 */}
                <div className="max-h-[50vh] overflow-y-auto border border-line p-1.5">
                    {icons.length === 0 ? (
                        <Empty className="px-3 py-6">
                            <EmptyDescription>{t("iconPicker.empty")}</EmptyDescription>
                        </Empty>
                    ) : (
                        <div className="grid grid-cols-[repeat(auto-fill,minmax(40px,1fr))] gap-1">
                            {icons.map((id) => (
                                <button
                                    key={id}
                                    type="button"
                                    title={id}
                                    aria-label={id}
                                    aria-pressed={id === current}
                                    onClick={() => pick(id)}
                                    className="grid h-10 place-items-center rounded-sm hover:bg-(--state-hover) aria-pressed:bg-(--state-selected)"
                                >
                                    <img src={namedIconUrl(id, light)} alt="" loading="lazy" className="size-6" />
                                </button>
                            ))}
                        </div>
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
