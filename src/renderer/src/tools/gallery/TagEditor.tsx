import { useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
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

// 标签编辑面板：图片单张 / 批量添加 / 分组 tag 三种场景共用（差异全在调用方的 onSave 里）
export function TagEditor({ title, hint, initialTags, pool, onSave, onClose }: Props) {
    const { t } = useI18n();
    const [tags, setTags] = useState<string[]>(initialTags);
    const [draft, setDraft] = useState("");
    const [busy, setBusy] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    function addTag(raw: string) {
        const v = raw.trim();
        if (!v) return;
        setTags((prev) => (prev.includes(v) || prev.length >= MAX_TAGS ? prev : [...prev, v]));
    }

    function onDraftChange(v: string) {
        // 中/英文逗号即提交：把逗号前的片段收进 chips，支持一次粘「a,b,c」
        if (/[,，]/.test(v)) {
            v.split(/[,，]/).forEach((part) => addTag(part));
            setDraft("");
            return;
        }
        setDraft(v);
    }

    function onDraftKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
        if (e.key === "Enter") {
            e.preventDefault();
            addTag(draft);
            setDraft("");
        } else if (e.key === "Backspace" && draft === "") {
            // 空输入退格 = 删最后一个 chip（常见 tag 输入框约定）
            setTags((prev) => prev.slice(0, -1));
        }
    }

    // 建议列表：全局 tag 池去掉已有的，再按输入包含过滤
    const suggestions = useMemo(() => {
        const rest = pool.filter((p) => !tags.includes(p));
        const q = draft.trim().toLowerCase();
        return (q ? rest.filter((p) => p.toLowerCase().includes(q)) : rest).slice(0, 12);
    }, [pool, tags, draft]);

    function save() {
        if (busy) return;
        setBusy(true);
        void onSave(tags).then((ok) => {
            setBusy(false);
            if (ok) onClose();
        });
    }

    const chip =
        "flex items-center gap-1 rounded-[3px] border border-line px-1.5 py-0.5 text-[12px] text-muted-foreground";

    return (
        <Dialog open onOpenChange={(v) => !v && onClose()}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    {hint && <DialogDescription>{hint}</DialogDescription>}
                </DialogHeader>

                <div className="flex flex-col gap-2">
                    {tags.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                            {tags.map((tag) => (
                                <span key={tag} className={chip}>
                                    {tag}
                                    <button
                                        type="button"
                                        aria-label={tag}
                                        onClick={() => setTags((prev) => prev.filter((x) => x !== tag))}
                                        className="text-dim-foreground hover:text-foreground"
                                    >
                                        <X size={11} />
                                    </button>
                                </span>
                            ))}
                        </div>
                    )}
                    <Input
                        ref={inputRef}
                        value={draft}
                        onChange={(e) => onDraftChange(e.target.value)}
                        onKeyDown={onDraftKeyDown}
                        spellCheck={false}
                        placeholder={t("gallery.tags.placeholder")}
                        className="h-8 w-full"
                    />
                    {suggestions.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                            {suggestions.map((p) => (
                                <Button
                                    key={p}
                                    type="button"
                                    appearance="standard"
                                    variant="outline"
                                    size="xs"
                                    className="px-1.5"
                                    onClick={() => {
                                        addTag(p);
                                        inputRef.current?.focus();
                                    }}
                                >
                                    + {p}
                                </Button>
                            ))}
                        </div>
                    )}
                </div>

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
