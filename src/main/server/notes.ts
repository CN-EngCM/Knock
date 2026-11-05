import { existsSync, mkdirSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { shell } from "electron";
import db from "./db";
import { sniffFormat } from "./gallery";
import { dataDir } from "./util/dataDir";
import { NOTES_NAME } from "./util/dataLocation";
import { NOTE_FORMATS, NOTE_MAX_IMAGES, type Note, type NoteImage } from "./schemas";
// type-only import 编译期擦除，不构成运行时循环依赖（同 gallery.ts）
import type { ApiResult } from "./api";

// ── 便签（工具 notes 的后端）──
// 一条便签 = 一段文字 + 多张图片。图片字节原样写进数据目录 notes/<图片id>.<format>，
// 行里只存格式与顺序；经 mpimg://note/<图片id> 读取，不走 IPC 传字节。
// 主进程不解码：格式靠文件头判定。每个工作区一份，按 workspace_id 隔离。

const MIME: Record<string, string> = {
    jpg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    bmp: "image/bmp",
};

const notFound = { ok: false, error: { kind: "not-found" } } as const;
const badRequest = { ok: false, error: { kind: "bad-request" } } as const;
const failed = { ok: false, error: { kind: "failed", path: "" } } as const;

// 数据目录运行期不变，目录只算一次、只 mkdir 一次（同图库）
let notesDirCache: string | undefined;
function notesDir(): string {
    if (!notesDirCache) {
        notesDirCache = join(dataDir(), NOTES_NAME);
        mkdirSync(notesDirCache, { recursive: true });
    }
    return notesDirCache;
}

function imagePath(image: NoteImage): string {
    return join(notesDir(), `${image.id}.${image.format}`);
}

/** 尽力删文件：删失败（被占用、已不存在）不影响业务结果 */
export async function removeNoteFiles(images: NoteImage[]): Promise<void> {
    for (const image of images) await rm(imagePath(image), { force: true }).catch(() => {});
}

/** 文件头判定格式；认不出或不在白名单（svg 等）返回 null */
function formatOf(bytes: Uint8Array): string | null {
    const f = sniffFormat(Buffer.from(bytes.buffer, bytes.byteOffset, Math.min(bytes.length, 512)));
    return (NOTE_FORMATS as readonly string[]).includes(f) ? f : null;
}

// better-sqlite3 的 .all()/.get() 返回 unknown[]，在 SQL 边界断言成行类型（同 api.ts 约定）
type NoteRow = { id: number; text: string; createdAt: number };
type ImageRow = { id: number; noteId: number; format: string };

export function listNotes(workspaceId: number): ApiResult<Note[]> {
    const rows = db
        .prepare(
            "SELECT id, text, created_at AS createdAt FROM notes WHERE workspace_id = ? ORDER BY created_at DESC, id DESC",
        )
        .all(workspaceId) as NoteRow[];
    const images = db
        .prepare(
            "SELECT i.id, i.note_id AS noteId, i.format FROM note_images i JOIN notes n ON n.id = i.note_id " +
                "WHERE n.workspace_id = ? ORDER BY i.note_id, i.position",
        )
        .all(workspaceId) as ImageRow[];
    const byNote = new Map<number, NoteImage[]>();
    for (const img of images) {
        const list = byNote.get(img.noteId) ?? [];
        list.push({ id: img.id, format: img.format });
        byNote.set(img.noteId, list);
    }
    return { ok: true, data: rows.map((r) => ({ ...r, images: byNote.get(r.id) ?? [] })) };
}

export function countNotes(workspaceId: number): ApiResult<number> {
    const row = db.prepare("SELECT COUNT(*) AS n FROM notes WHERE workspace_id = ?").get(workspaceId) as { n: number };
    return { ok: true, data: row.n };
}

/** 文字全是空白时存空串；其余原样存（不 trim） */
function normalizeText(text: string): string {
    return text.trim() === "" ? "" : text;
}

export async function createNote(workspaceId: number, text: string, images: Uint8Array[]): Promise<ApiResult<Note>> {
    const body = normalizeText(text);
    if (body === "" && images.length === 0) return badRequest;
    const formats: string[] = [];
    for (const bytes of images) {
        const f = formatOf(bytes);
        if (!f) return badRequest;
        formats.push(f);
    }
    if (!db.prepare("SELECT 1 FROM workspaces WHERE id = ?").get(workspaceId)) return notFound;

    // 先写行（拿到图片 id 才有文件名），再写文件，文件失败就撤销本次的行
    const now = Date.now();
    const created = db.transaction(() => {
        const noteId = Number(
            db
                .prepare("INSERT INTO notes (workspace_id, text, created_at, updated_at) VALUES (?, ?, ?, ?)")
                .run(workspaceId, body, now, now).lastInsertRowid,
        );
        const insert = db.prepare("INSERT INTO note_images (note_id, format, position) VALUES (?, ?, ?)");
        const list: NoteImage[] = formats.map((format, position) => ({
            id: Number(insert.run(noteId, format, position).lastInsertRowid),
            format,
        }));
        return { noteId, list };
    })();

    try {
        for (const [i, image] of created.list.entries()) await writeFile(imagePath(image), images[i]);
    } catch (e) {
        console.error("[notes] write image failed:", e);
        db.prepare("DELETE FROM notes WHERE id = ?").run(created.noteId); // 外键级联删图片行
        await removeNoteFiles(created.list);
        return failed;
    }
    return { ok: true, data: { id: created.noteId, text: body, createdAt: now, images: created.list } };
}

export async function updateNote(
    id: number,
    text: string,
    keepImageIds: number[],
    newImages: Uint8Array[],
): Promise<ApiResult<null>> {
    const body = normalizeText(text);
    if (body === "" && keepImageIds.length + newImages.length === 0) return badRequest;
    if (keepImageIds.length + newImages.length > NOTE_MAX_IMAGES) return badRequest;
    if (new Set(keepImageIds).size !== keepImageIds.length) return badRequest;
    if (!db.prepare("SELECT 1 FROM notes WHERE id = ?").get(id)) return notFound;

    const current = db
        .prepare("SELECT id, format FROM note_images WHERE note_id = ? ORDER BY position")
        .all(id) as NoteImage[];
    // 保留的图片必须是这条便签自己的，防止拿别人的图片 id 来挂
    if (!keepImageIds.every((k) => current.some((c) => c.id === k))) return badRequest;
    const removed = current.filter((c) => !keepImageIds.includes(c.id));

    const formats: string[] = [];
    for (const bytes of newImages) {
        const f = formatOf(bytes);
        if (!f) return badRequest;
        formats.push(f);
    }

    // 第一步只加新图的行并写文件：这一步失败可以原样撤销，旧内容一点没动
    const insert = db.prepare("INSERT INTO note_images (note_id, format, position) VALUES (?, ?, ?)");
    const added: NoteImage[] = db.transaction(() =>
        formats.map((format) => ({ id: Number(insert.run(id, format, 9999).lastInsertRowid), format })),
    )();
    try {
        for (const [i, image] of added.entries()) await writeFile(imagePath(image), newImages[i]);
    } catch (e) {
        console.error("[notes] write image failed:", e);
        for (const image of added) db.prepare("DELETE FROM note_images WHERE id = ?").run(image.id);
        await removeNoteFiles(added);
        return failed;
    }

    // 第二步一个事务收尾：改字、删被去掉的图、按「保留的在前、新图在后」重排
    db.transaction(() => {
        db.prepare("UPDATE notes SET text = ?, updated_at = ? WHERE id = ?").run(body, Date.now(), id);
        for (const image of removed) db.prepare("DELETE FROM note_images WHERE id = ?").run(image.id);
        const setPosition = db.prepare("UPDATE note_images SET position = ? WHERE id = ?");
        [...keepImageIds, ...added.map((a) => a.id)].forEach((imageId, position) => setPosition.run(position, imageId));
    })();
    await removeNoteFiles(removed);
    return { ok: true, data: null };
}

export async function deleteNote(id: number): Promise<ApiResult<null>> {
    const images = db.prepare("SELECT id, format FROM note_images WHERE note_id = ?").all(id) as NoteImage[];
    const info = db.prepare("DELETE FROM notes WHERE id = ?").run(id);
    if (info.changes === 0) return notFound;
    await removeNoteFiles(images);
    return { ok: true, data: null };
}

/** 删工作区前取出它名下所有图片：外键级联只删行，文件要自己清（先取、删行后再调 removeNoteFiles） */
export function imagesOfWorkspace(workspaceId: number): NoteImage[] {
    return db
        .prepare("SELECT i.id, i.format FROM note_images i JOIN notes n ON n.id = i.note_id WHERE n.workspace_id = ?")
        .all(workspaceId) as NoteImage[];
}

/** 用系统默认程序打开；openPath 返回空串即成功 */
export async function openImage(imageId: number): Promise<ApiResult<null>> {
    const row = db.prepare("SELECT id, format FROM note_images WHERE id = ?").get(imageId) as NoteImage | undefined;
    if (!row) return notFound;
    const file = imagePath(row);
    if (!existsSync(file)) return notFound;
    const err = await shell.openPath(file);
    return err ? { ok: false, error: { kind: "failed", path: err } } : { ok: true, data: null };
}

/** mpimg://note/<图片id>：行不存在或文件读不到返回 null（→ 404） */
export async function serveNoteImage(imageId: number): Promise<{ buf: Buffer; mime: string } | null> {
    const row = db.prepare("SELECT id, format FROM note_images WHERE id = ?").get(imageId) as NoteImage | undefined;
    if (!row) return null;
    try {
        return { buf: await readFile(imagePath(row)), mime: MIME[row.format] ?? MIME.png };
    } catch {
        return null;
    }
}
