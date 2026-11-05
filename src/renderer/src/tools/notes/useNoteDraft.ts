import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { NoteImage } from "@/api/client";
import { useI18n } from "@/i18n/useI18n";
import { isSupportedImage, NOTE_IMAGE_MAX_BYTES, NOTE_MAX_IMAGES } from "./limits";

// 便签输入区的草稿：顶部新建和条目编辑共用。
// 图片统一成 File（粘贴、拖拽、选文件拿到的都是 File），保存时才转成字节发给主进程。

/** 待保存的新图：url 是给小图预览用的本地地址，不用了要 revoke */
export type PendingImage = { key: number; file: File; url: string };

export function useNoteDraft(initial?: { text: string; images: NoteImage[] }) {
    const { t } = useI18n();
    const [text, setText] = useState(initial?.text ?? "");
    // 编辑态里原有的图片：只有 × 能去掉，保留的会按这个顺序排在新图前面
    const [kept, setKept] = useState<NoteImage[]>(initial?.images ?? []);
    const [added, setAdded] = useState<PendingImage[]>([]);
    // addFiles 在事件里连续调用时拿不到刚 setState 的值，上限判断读 ref
    const addedRef = useRef(added);
    const keptRef = useRef(kept);
    const nextKey = useRef(0);
    keptRef.current = kept;

    useEffect(() => {
        return () => addedRef.current.forEach((img) => URL.revokeObjectURL(img.url));
    }, []);

    function commitAdded(next: PendingImage[]) {
        addedRef.current = next;
        setAdded(next);
    }

    function addFiles(files: File[]) {
        const room = NOTE_MAX_IMAGES - keptRef.current.length - addedRef.current.length;
        const accepted: PendingImage[] = [];
        let badFormat = false;
        let tooBig = false;
        let tooMany = false;
        for (const file of files) {
            if (!isSupportedImage(file)) badFormat = true;
            else if (file.size > NOTE_IMAGE_MAX_BYTES) tooBig = true;
            else if (accepted.length >= room) tooMany = true;
            else accepted.push({ key: nextKey.current++, file, url: URL.createObjectURL(file) });
        }
        if (badFormat) toast.error(t("notes.err.format"));
        if (tooBig) toast.error(t("notes.err.size"));
        if (tooMany) toast.error(t("notes.err.count"));
        if (accepted.length > 0) commitAdded([...addedRef.current, ...accepted]);
    }

    function removeAdded(key: number) {
        const hit = addedRef.current.find((img) => img.key === key);
        if (hit) URL.revokeObjectURL(hit.url);
        commitAdded(addedRef.current.filter((img) => img.key !== key));
    }

    function removeKept(id: number) {
        setKept((cur) => cur.filter((img) => img.id !== id));
    }

    /** 搜索框带入：已有草稿时换行追加，不覆盖 */
    function appendText(extra: string) {
        setText((cur) => (cur === "" ? extra : `${cur}\n${extra}`));
    }

    /** 保存成功后清空 */
    function reset() {
        addedRef.current.forEach((img) => URL.revokeObjectURL(img.url));
        commitAdded([]);
        setKept([]);
        setText("");
    }

    // 文字全是空白且没有任何图片 = 空草稿，不能保存
    const isEmpty = text.trim() === "" && kept.length === 0 && added.length === 0;

    return { text, setText, kept, added, addFiles, removeAdded, removeKept, appendText, reset, isEmpty };
}

export type NoteDraft = ReturnType<typeof useNoteDraft>;

/** 待存新图转成字节：经 IPC 发给主进程 */
export async function readImages(images: PendingImage[]): Promise<Uint8Array[]> {
    return Promise.all(images.map(async (img) => new Uint8Array(await img.file.arrayBuffer())));
}
