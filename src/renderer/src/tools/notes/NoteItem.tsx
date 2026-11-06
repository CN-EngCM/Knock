import { useLayoutEffect, useRef, useState } from "react";
import { Copy, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, type Note } from "@/api/client";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/useI18n";
import { TipButton } from "../TipButton";
import { NoteInput } from "./NoteInput";
import { NOTE_TEXT_MAX_CHARS } from "./limits";
import { readImages, useNoteDraft } from "./useNoteDraft";

// 列表里的一条便签：时间、文字、图片。点编辑后整条换成和顶部一样的输入区。
// 图片限高显示原图，点击交给系统默认程序打开，不做应用内查看器。

const pad = (n: number) => String(n).padStart(2, "0");

/** 11-05 14:32 */
function fmtTime(ms: number): string {
    const d = new Date(ms);
    return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 复制原图：经 canvas 转 PNG 规避剪贴板对源格式的挑剔，GIF 只会得到静态图（同图库查看器） */
async function copyImageToClipboard(imageId: number): Promise<void> {
    const blob = await (await fetch(`mpimg://note/${imageId}`)).blob();
    const bmp = await createImageBitmap(blob, { imageOrientation: "from-image" });
    const canvas = document.createElement("canvas");
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    canvas.getContext("2d")?.drawImage(bmp, 0, 0);
    bmp.close();
    const png = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/png"));
    if (!png) throw new Error("toBlob");
    await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
}

type Props = {
    note: Note;
    onDelete: (note: Note) => void;
    /** 编辑保存成功后让列表重新拉取 */
    onChanged: () => void;
};

export function NoteItem({ note, onDelete, onChanged }: Props) {
    const { t } = useI18n();
    const [editing, setEditing] = useState(false);
    const [expanded, setExpanded] = useState(false);
    const [overflow, setOverflow] = useState(false);
    const textRef = useRef<HTMLDivElement>(null);

    // 折叠时文字被 line-clamp 截断，scrollHeight 比可见高度大就说明有被藏起来的行；
    // 宽度变化会改变折行，所以用 ResizeObserver 跟着重算
    useLayoutEffect(() => {
        const el = textRef.current;
        if (!el) return;
        const measure = () => {
            if (!expanded) setOverflow(el.scrollHeight > el.clientHeight + 1);
        };
        measure();
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        return () => ro.disconnect();
    }, [note.text, expanded, editing]);

    async function copyText() {
        try {
            await navigator.clipboard.writeText(note.text);
            toast.success(t("notes.copied"));
        } catch {
            toast.error(t("notes.copyFailed"));
        }
    }

    async function copyImage(imageId: number) {
        try {
            await copyImageToClipboard(imageId);
            toast.success(t("notes.imageCopied"));
        } catch {
            toast.error(t("notes.copyFailed"));
        }
    }

    async function openImage(imageId: number) {
        const r = await api.noteOpenImage(imageId);
        if (!r.ok) toast.error(t("notes.openImageFailed"));
    }

    if (editing) {
        return (
            <div className="rounded-md border border-line bg-background p-2.5">
                <NoteEditor
                    note={note}
                    onClose={() => setEditing(false)}
                    onSaved={() => {
                        setEditing(false);
                        setExpanded(false);
                        onChanged();
                    }}
                />
            </div>
        );
    }

    return (
        <div className="group rounded-md border border-line bg-background p-2.5">
            <div className="mb-1 flex items-center gap-1">
                <span className="flex-1 font-mono text-[11px] text-dim-foreground">{fmtTime(note.createdAt)}</span>
                {/* 按钮只在鼠标移上去（或键盘聚焦到它们）时显示 */}
                <div className="flex gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                    {note.text !== "" && (
                        <TipButton
                            label={t("notes.copyText")}
                            aria-label={t("notes.copyText")}
                            type="button"
                            appearance="standard"
                            variant="ghost"
                            size="icon"
                            className="size-6"
                            onClick={() => void copyText()}
                        >
                            <Copy className="size-3.5" />
                        </TipButton>
                    )}
                    <TipButton
                        label={t("notes.edit")}
                        aria-label={t("notes.edit")}
                        type="button"
                        appearance="standard"
                        variant="ghost"
                        size="icon"
                        className="size-6"
                        onClick={() => setEditing(true)}
                    >
                        <Pencil className="size-3.5" />
                    </TipButton>
                    <TipButton
                        label={t("notes.delete")}
                        aria-label={t("notes.delete")}
                        type="button"
                        appearance="standard"
                        variant="ghost"
                        size="icon"
                        className="size-6 enabled:hover:text-destructive"
                        onClick={() => onDelete(note)}
                    >
                        <Trash2 className="size-3.5" />
                    </TipButton>
                </div>
            </div>

            {note.text !== "" && (
                <>
                    {/* 全局样式默认不让选中文字，便签要能选中复制，所以显式 select-text */}
                    <div
                        ref={textRef}
                        className={`font-mono text-[12.5px] leading-5 break-words whitespace-pre-wrap text-foreground select-text ${
                            expanded ? "" : "line-clamp-10"
                        }`}
                    >
                        {note.text}
                    </div>
                    {(overflow || expanded) && (
                        <Button
                            type="button"
                            appearance="standard"
                            variant="ghost"
                            size="xs"
                            className="mt-1 h-auto px-0 text-[11px] text-muted-foreground enabled:hover:text-foreground"
                            onClick={() => setExpanded((v) => !v)}
                        >
                            {t(expanded ? "notes.collapse" : "notes.expand")}
                        </Button>
                    )}
                </>
            )}

            {note.images.length > 0 && (
                <div className={`flex flex-wrap gap-2 ${note.text !== "" ? "mt-2" : ""}`}>
                    {note.images.map((img) => (
                        <div key={img.id} className="group/img relative">
                            <img
                                src={`mpimg://note/${img.id}`}
                                alt=""
                                loading="lazy"
                                className="max-h-[120px] max-w-full cursor-pointer rounded-md border border-line object-contain"
                                onClick={() => void openImage(img.id)}
                            />
                            <TipButton
                                label={t("notes.copyImage")}
                                aria-label={t("notes.copyImage")}
                                type="button"
                                appearance="standard"
                                variant="ghost"
                                size="icon"
                                className="absolute top-1 right-1 size-6 bg-background/80 opacity-0 transition-opacity group-focus-within/img:opacity-100 group-hover/img:opacity-100"
                                onClick={() => void copyImage(img.id)}
                            >
                                <Copy className="size-3.5" />
                            </TipButton>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

/** 编辑态：只在点编辑时挂载，草稿（含图片预览地址）随它一起创建和回收 */
function NoteEditor({ note, onClose, onSaved }: { note: Note; onClose: () => void; onSaved: () => void }) {
    const { t } = useI18n();
    const draft = useNoteDraft({ text: note.text, images: note.images });
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const [saving, setSaving] = useState(false);

    // 挂载后把焦点放进输入框，光标落在文字末尾
    useLayoutEffect(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
    }, []);

    async function save() {
        if (saving || draft.isEmpty) return;
        if (draft.text.length > NOTE_TEXT_MAX_CHARS) {
            toast.error(t("notes.err.text"));
            return;
        }
        setSaving(true);
        try {
            const r = await api.noteUpdate({
                id: note.id,
                text: draft.text,
                keepImageIds: draft.kept.map((img) => img.id),
                newImages: await readImages(draft.added),
            });
            if (!r.ok) {
                toast.error(t("toast.error"));
                return;
            }
            onSaved();
        } catch {
            // 待存图片的源文件在保存前被删或挪走时读不出来；草稿留着，用户可以去掉那张再存
            toast.error(t("notes.err.read"));
        } finally {
            setSaving(false);
        }
    }

    return (
        <NoteInput
            draft={draft}
            textareaRef={textareaRef}
            saving={saving}
            onSave={() => void save()}
            onCancel={onClose}
        />
    );
}
