import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api, type Note } from "@/api/client";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { useI18n } from "@/i18n/useI18n";
import { NoteInput } from "./notes/NoteInput";
import { NoteItem } from "./notes/NoteItem";
import { NOTE_TEXT_MAX_CHARS } from "./notes/limits";
import { readImages, useNoteDraft } from "./notes/useNoteDraft";
import { ToolWorkspaceContext, useToolFocus, useToolInput } from "./toolInput";

// 便签：记下项目里一闪而过的想法和临时数据，每个工作区一份，互相看不到。
// 一条 = 一段文字 + 多张图片，文字原样显示（不渲染 Markdown），图片排在文字下面。
// 草稿（含图片）只活在组件里：切工作区还在，关面板就丢，符合「工具每次从空开始」的约定。
// （不接 initialInput：DockZone 不会传它，搜索框的内容走 useToolInput 的注入通道。）

const UNDO_MS = 5000;

type PendingDelete = { timer: ReturnType<typeof setTimeout>; toastId: string | number };

export default function NotesTool() {
    const { t } = useI18n();
    const workspaceId = useContext(ToolWorkspaceContext);
    const draft = useNoteDraft();
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const [notes, setNotes] = useState<Note[] | null>(null);
    const [saving, setSaving] = useState(false);
    const [dragOver, setDragOver] = useState(false);
    // 点删除后先在界面上藏起来，5 秒后才真正删；撤销就把它放回来
    const [hidden, setHidden] = useState<ReadonlySet<number>>(() => new Set());
    const pendingDeletes = useRef(new Map<number, PendingDelete>());

    const focusInput = useCallback((toEnd = false) => {
        // 等一帧：面板刚被激活时 display 还没切回来，focus 会落空
        requestAnimationFrame(() => {
            const el = textareaRef.current;
            if (!el) return;
            el.focus();
            if (toEnd) el.setSelectionRange(el.value.length, el.value.length);
        });
    }, []);

    const reload = useCallback(async () => {
        if (workspaceId === null) return;
        const r = await api.notesList(workspaceId);
        if (r.ok) setNotes(r.data);
        else toast.error(t("toast.error"));
    }, [workspaceId, t]);
    useEffect(() => {
        void reload();
        // 只在工作区变化时重拉；t 变化（切语言）不需要
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [workspaceId]);

    // 从任何入口打开面板都把焦点放进输入框：首次挂载一次，已开着的面板再被打开时由聚焦事件触发
    useEffect(() => focusInput(), [focusInput]);
    useToolFocus("notes", focusInput);

    // 搜索框带入：用 seq 边沿追加到草稿（不覆盖），handledSeq 避开 StrictMode 重复执行
    const { text: injected, seq } = useToolInput("notes");
    const handledSeq = useRef(0);
    useEffect(() => {
        if (seq <= handledSeq.current) return;
        handledSeq.current = seq;
        if (injected !== "") draft.appendText(injected);
        focusInput(true);
        // draft 每次渲染都是新对象，这里只认 seq 的变化
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [seq]);

    async function saveNew() {
        if (saving || draft.isEmpty || workspaceId === null) return;
        if (draft.text.length > NOTE_TEXT_MAX_CHARS) {
            toast.error(t("notes.err.text"));
            return;
        }
        setSaving(true);
        try {
            const r = await api.noteCreate({
                workspaceId,
                text: draft.text,
                images: await readImages(draft.added),
            });
            if (!r.ok) {
                toast.error(t("toast.error"));
                return;
            }
            setNotes((cur) => [r.data, ...(cur ?? [])]);
            draft.reset();
            focusInput(); // 点保存按钮时焦点在按钮上，保存后让它回到输入框
        } catch {
            // 待存图片的源文件在保存前被删或挪走时读不出来；草稿留着，用户可以去掉那张再存
            toast.error(t("notes.err.read"));
        } finally {
            setSaving(false);
        }
    }

    // ── 删除 + 撤销：界面先藏，到时间才调 noteDelete；撤销就取消定时器 ──
    async function commitDelete(id: number) {
        const pending = pendingDeletes.current.get(id);
        if (!pending) return;
        clearTimeout(pending.timer);
        pendingDeletes.current.delete(id);
        toast.dismiss(pending.toastId);
        const r = await api.noteDelete(id);
        if (!r.ok && r.error.kind !== "not-found") toast.error(t("toast.error"));
        setNotes((cur) => cur?.filter((n) => n.id !== id) ?? null);
        setHidden((cur) => {
            const next = new Set(cur);
            next.delete(id);
            return next;
        });
    }

    function undoDelete(id: number) {
        const pending = pendingDeletes.current.get(id);
        if (!pending) return;
        clearTimeout(pending.timer);
        pendingDeletes.current.delete(id);
        setHidden((cur) => {
            const next = new Set(cur);
            next.delete(id);
            return next;
        });
    }

    function requestDelete(note: Note) {
        setHidden((cur) => new Set(cur).add(note.id));
        const toastId = toast(t("notes.deleted"), {
            duration: UNDO_MS,
            action: { label: t("notes.undo"), onClick: () => undoDelete(note.id) },
        });
        const timer = setTimeout(() => void commitDelete(note.id), UNDO_MS);
        pendingDeletes.current.set(note.id, { timer, toastId });
    }

    // 关面板（组件卸载）时还没到时间的删除立刻执行，不然撤销入口没了便签却还在
    useEffect(() => {
        const pendings = pendingDeletes.current;
        return () => {
            for (const [id, pending] of pendings) {
                clearTimeout(pending.timer);
                toast.dismiss(pending.toastId);
                void api.noteDelete(id);
            }
            pendings.clear();
        };
    }, []);

    const visible = (notes ?? []).filter((n) => !hidden.has(n.id));

    return (
        <div
            className="relative flex h-full flex-col"
            // 文件拖到面板任意位置都加到顶部输入区；落在编辑中条目的输入区上时由它自己接走（见 NoteInput）。
            // 必须接住 dragover/drop，否则 Electron 会把文件当链接直接导航过去
            onDragOver={(e) => {
                if (!Array.from(e.dataTransfer.types).includes("Files")) return;
                e.preventDefault();
                setDragOver(true);
            }}
            onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOver(false);
            }}
            // 捕获阶段先复位高亮：落在输入区上时子层 stopPropagation，根的 onDrop 收不到（同图库）
            onDropCapture={() => setDragOver(false)}
            onDrop={(e) => {
                if (!Array.from(e.dataTransfer.types).includes("Files")) return;
                e.preventDefault();
                draft.addFiles(Array.from(e.dataTransfer.files));
            }}
        >
            <div className="flex-none px-3 pt-3 pb-2">
                <NoteInput draft={draft} textareaRef={textareaRef} saving={saving} onSave={() => void saveNew()} />
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto px-3 pb-3">
                {notes !== null && visible.length === 0 && (
                    <Empty className="py-8">
                        <EmptyHeader>
                            <EmptyTitle>{t("notes.empty")}</EmptyTitle>
                            <EmptyDescription className="text-[12px] text-dim-foreground">
                                {t("notes.emptyHint")}
                            </EmptyDescription>
                        </EmptyHeader>
                    </Empty>
                )}
                {visible.map((note) => (
                    <NoteItem key={note.id} note={note} onDelete={requestDelete} onChanged={() => void reload()} />
                ))}
            </div>

            {dragOver && (
                <div className="pointer-events-none absolute inset-2 grid place-items-center rounded-md border border-dashed border-primary bg-(--state-selected)/60 text-xs text-foreground">
                    {t("notes.dropHint")}
                </div>
            )}
        </div>
    );
}
