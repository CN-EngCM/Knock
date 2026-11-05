import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { ImagePlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/i18n/useI18n";
import { TipButton } from "../TipButton";
import { NOTE_IMAGE_ACCEPT } from "./limits";
import type { NoteDraft } from "./useNoteDraft";

// 便签输入区：顶部新建和条目编辑共用同一个组件，草稿状态由调用方的 useNoteDraft 持有。
// 保存键是 Ctrl+回车（macOS 上 Cmd+回车也行），回车只换行；Esc 只在编辑态（有 onCancel）取消。
// 编辑态不做「失去焦点自动保存」：点 × 或选文件都会让输入框失焦，容易误存。

const MAX_HEIGHT_PX = 320;
const isMac = /Mac/i.test(navigator.platform);

type Props = {
    draft: NoteDraft;
    textareaRef: RefObject<HTMLTextAreaElement | null>;
    saving: boolean;
    onSave: () => void;
    /** 只有编辑态传：显示取消按钮并响应 Esc */
    onCancel?: () => void;
};

function hasFiles(e: React.DragEvent): boolean {
    return Array.from(e.dataTransfer.types).includes("Files");
}

export function NoteInput({ draft, textareaRef, saving, onSave, onCancel }: Props) {
    const { t } = useI18n();
    const fileInput = useRef<HTMLInputElement>(null);
    const [dragOver, setDragOver] = useState(false);

    // 高度随内容增长，到上限后在框里滚动
    useLayoutEffect(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.style.height = "auto";
        el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT_PX)}px`;
    }, [draft.text, textareaRef]);

    function onKeyDown(e: React.KeyboardEvent) {
        // 输入法选词时的回车和 Esc 是给输入法的，不能触发保存或取消
        if (e.nativeEvent.isComposing || e.keyCode === 229) return;
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            onSave();
        } else if (e.key === "Escape" && onCancel) {
            e.preventDefault();
            onCancel();
        }
    }

    // 粘贴只归这个输入框：不 stopPropagation 的话，ScanTool 挂在 window 上的 paste 监听也会收到。
    // 剪贴板有文字时走默认粘贴：从 Excel、Word 复制会同时带文字和图片，那种情况只要文字。
    // 否则取文件，非图片也交给 addFiles，由它提示格式不支持
    function onPaste(e: React.ClipboardEvent) {
        e.stopPropagation();
        if (e.clipboardData.getData("text/plain") !== "") return;
        const files = Array.from(e.clipboardData.files);
        if (files.length === 0) return;
        e.preventDefault();
        draft.addFiles(files);
    }

    return (
        <div
            className={`flex flex-col gap-2 rounded-md ${dragOver ? "ring-1 ring-primary" : ""}`}
            onKeyDown={onKeyDown}
            // 拖到输入区上就加到这个输入区（编辑中的条目或顶部）；拖到别处由面板根节点交给顶部输入区
            onDragOver={(e) => {
                if (!hasFiles(e)) return;
                e.preventDefault();
                e.stopPropagation();
                setDragOver(true);
            }}
            onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOver(false);
            }}
            onDrop={(e) => {
                if (!hasFiles(e)) return;
                e.preventDefault();
                e.stopPropagation();
                setDragOver(false);
                draft.addFiles(Array.from(e.dataTransfer.files));
            }}
        >
            <Textarea
                ref={textareaRef}
                value={draft.text}
                onChange={(e) => draft.setText(e.target.value)}
                onPaste={onPaste}
                spellCheck={false}
                placeholder={t("notes.placeholder")}
                aria-label={t("notes.placeholder")}
                className="min-h-[56px] resize-none select-text font-mono text-[12.5px]"
            />

            {(draft.kept.length > 0 || draft.added.length > 0) && (
                <div className="flex flex-wrap gap-2">
                    {draft.kept.map((img) => (
                        <Thumb
                            key={`k${img.id}`}
                            src={`mpimg://note/${img.id}`}
                            label={t("notes.removeImage")}
                            onRemove={() => draft.removeKept(img.id)}
                        />
                    ))}
                    {draft.added.map((img) => (
                        <Thumb
                            key={`a${img.key}`}
                            src={img.url}
                            label={t("notes.removeImage")}
                            onRemove={() => draft.removeAdded(img.key)}
                        />
                    ))}
                </div>
            )}

            <div className="flex items-center gap-2">
                <TipButton
                    label={t("notes.addImage")}
                    aria-label={t("notes.addImage")}
                    type="button"
                    appearance="standard"
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    onClick={() => fileInput.current?.click()}
                >
                    <ImagePlus className="size-4" />
                </TipButton>
                <input
                    ref={fileInput}
                    type="file"
                    multiple
                    accept={NOTE_IMAGE_ACCEPT}
                    className="hidden"
                    onChange={(e) => {
                        draft.addFiles(Array.from(e.target.files ?? []));
                        e.target.value = ""; // 允许连续选同一个文件
                        textareaRef.current?.focus();
                    }}
                />
                <span className="min-w-0 flex-1 truncate text-[11px] text-dim-foreground">
                    {isMac ? "⌘" : "Ctrl"}+Enter {t("notes.hintSave")}
                </span>
                {onCancel && (
                    <Button type="button" appearance="standard" variant="outline" size="sm" onClick={onCancel}>
                        {t("common.cancel")}
                    </Button>
                )}
                <Button
                    type="button"
                    appearance="standard"
                    variant="primary"
                    size="sm"
                    disabled={draft.isEmpty || saving}
                    onClick={onSave}
                >
                    {t("common.save")}
                </Button>
            </div>
        </div>
    );
}

/** 保存前的小图：右上角 × 去掉 */
function Thumb({ src, label, onRemove }: { src: string; label: string; onRemove: () => void }) {
    return (
        <div className="relative size-14 flex-none">
            <img src={src} alt="" className="size-full rounded-md border border-line object-cover" />
            <Button
                type="button"
                appearance="standard"
                variant="ghost"
                size="icon"
                aria-label={label}
                className="absolute -top-1.5 -right-1.5 size-4 rounded-full bg-background text-muted-foreground shadow-sm enabled:hover:text-foreground"
                onClick={onRemove}
            >
                <X className="size-3" />
            </Button>
        </div>
    );
}
