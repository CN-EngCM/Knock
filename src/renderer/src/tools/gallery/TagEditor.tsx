import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    Combobox,
    ComboboxChip,
    ComboboxChips,
    ComboboxChipsInput,
    ComboboxContent,
    ComboboxEmpty,
    ComboboxItem,
    ComboboxList,
    ComboboxValue,
    useComboboxAnchor,
} from "@/components/ui/combobox";
import { useI18n } from "@/i18n/useI18n";

type Props = {
    title: string;
    /** 提示行（批量模式显示「将添加到 M 张」）；不传则不显示 */
    hint?: string;
    /** 初值：单对象编辑=现有 tags（替换语义）；批量添加=空（并集语义由调用方实现） */
    initialTags: string[];
    /** 建议池：galleryAllTags（已在现有 tags 里的不再出现） */
    pool: string[];
    /** 保存：返回 true = 成功（面板关闭），false = 失败（面板留着可重试） */
    onSave: (tags: string[]) => Promise<boolean>;
    onClose: () => void;
};

// 与 server/schemas.galleryTagsSchema 的单次上限一致
const MAX_TAGS = 50;

// 标签编辑面板：图片单张 / 批量添加 / 分组 tag 三种场景共用（差异全在调用方的 onSave 里）。
// 输入框是 Combobox 的 chips 输入：候选来自全局 tag 池，回车收下的是输入框里的原文——
// 这样「选已有标签」和「输入新标签」是同一个动作。
export function TagEditor({ title, hint, initialTags, pool, onSave, onClose }: Props) {
    const { t } = useI18n();
    const [tags, setTags] = useState<string[]>(initialTags);
    const [draft, setDraft] = useState("");
    const [busy, setBusy] = useState(false);
    const anchor = useComboboxAnchor();

    const full = tags.length >= MAX_TAGS;

    // 选中候选或删 chip 之后输入框要清空：草稿由我们控制，不交给组件内部状态
    function onTagsChange(next: string[]) {
        setTags(next);
        setDraft("");
    }

    function addTag(raw: string) {
        const v = raw.trim();
        if (!v) return;
        setTags((prev) => (prev.includes(v) || prev.length >= MAX_TAGS ? prev : [...prev, v]));
    }

    // 中/英文逗号即提交：把逗号前的片段收进 chips，支持一次粘「a,b,c」
    function onDraftChange(next: string) {
        if (/[,，]/.test(next)) {
            next.split(/[,，]/).forEach(addTag);
            setDraft("");
            return;
        }
        setDraft(next);
    }

    function onDraftKeyDown(e: React.KeyboardEvent) {
        if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
        e.preventDefault();
        addTag(draft);
        setDraft("");
    }

    function save() {
        if (busy) return;
        setBusy(true);
        void onSave(tags).then((ok) => {
            setBusy(false);
            if (ok) onClose();
        });
    }

    return (
        <Dialog open onOpenChange={(v) => !v && onClose()}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    {hint && <DialogDescription>{hint}</DialogDescription>}
                </DialogHeader>

                <Combobox
                    multiple
                    items={pool}
                    value={tags}
                    onValueChange={onTagsChange}
                    inputValue={draft}
                    onInputValueChange={onDraftChange}
                >
                    <ComboboxChips ref={anchor} className="w-full" aria-label={title}>
                        <ComboboxValue>
                            {(values: string[]) => (
                                <>
                                    {values.map((v) => (
                                        <ComboboxChip key={v}>{v}</ComboboxChip>
                                    ))}
                                    <ComboboxChipsInput
                                        placeholder={t("gallery.tags.placeholder")}
                                        aria-label={t("gallery.tags.placeholder")}
                                        disabled={busy || full}
                                        onKeyDown={onDraftKeyDown}
                                    />
                                </>
                            )}
                        </ComboboxValue>
                    </ComboboxChips>
                    <ComboboxContent anchor={anchor}>
                        <ComboboxEmpty>{t("gallery.tags.noMatch")}</ComboboxEmpty>
                        <ComboboxList>
                            {(item: string) => (
                                <ComboboxItem key={item} value={item}>
                                    {item}
                                </ComboboxItem>
                            )}
                        </ComboboxList>
                    </ComboboxContent>
                </Combobox>

                <DialogFooter>
                    <Button type="button" appearance="standard" variant="outline" size="sm" onClick={onClose}>
                        {t("common.cancel")}
                    </Button>
                    <Button
                        type="button"
                        appearance="standard"
                        variant="primary"
                        size="sm"
                        disabled={busy}
                        onClick={save}
                    >
                        {t("common.save")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
