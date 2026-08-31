import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { clipboard, dialog, nativeImage, shell } from "electron";
import db from "./db";
import { dataDir } from "./util/dataDir";
import { GALLERY_NAME } from "./util/dataLocation";
import {
    GALLERY_FORMATS,
    type GalleryGroup,
    type GalleryImage,
    type GalleryImportStats,
    type GalleryQueryInput,
} from "./schemas";
// type-only import 编译期擦除，不构成运行时循环依赖（同 experts.ts）
import type { ApiResult } from "./api";

// ── 图库（工具 gallery 的后端）：图片字节级复制进数据目录 gallery/，行里只存元数据 ──
// 去重以 sha256 为准（同内容全库只收一份）；缩略图按需生成落盘 .thumbs/，
// 经 mpimg:// 协议按 id 直读（注册见 electron/main.ts）。文件名/basename 只作
// 显示与磁盘名，不参与寻址——协议按整数 id 找行，天然无路径穿越。

// 缩略图长边上限：网格里看足够清晰，原图再大也不浪费磁盘
const THUMB_EDGE = 320;

const MIME: Record<string, string> = {
    jpg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    bmp: "image/bmp",
    svg: "image/svg+xml",
};

const notFound = { ok: false, error: { kind: "not-found" } } as const;
const badRequest = { ok: false, error: { kind: "bad-request" } } as const;

function galleryDir(): string {
    const dir = join(dataDir(), GALLERY_NAME);
    mkdirSync(dir, { recursive: true });
    return dir;
}

function thumbsDir(): string {
    const dir = join(galleryDir(), ".thumbs");
    mkdirSync(dir, { recursive: true });
    return dir;
}

// better-sqlite3 的 .all()/.get() 返回 unknown[]，在 SQL 边界断言成行类型（同 api.ts 的 as* 约定）
type ImageRow = Omit<GalleryImage, "tags">;

/** 幂等播种内置收件箱：name 固定存「收件箱」，渲染端对 inbox=1 的组用 i18n 键显示，DB 名不参与展示 */
function ensureInbox(): void {
    db.prepare(
        "INSERT INTO gallery_groups (name, inbox, created_at) SELECT '收件箱', 1, ? " +
            "WHERE NOT EXISTS (SELECT 1 FROM gallery_groups WHERE inbox = 1)",
    ).run(Date.now());
}

function getGroup(id: number): { id: number; inbox: number } | undefined {
    return db.prepare("SELECT id, inbox FROM gallery_groups WHERE id = ?").get(id) as
        { id: number; inbox: number } | undefined;
}

/** 删原图与缩略图（缩略图按源格式定名：jpg 存 .jpg，其余 .png，svg 不生成）。
 *  rm 失败只当垃圾残留不报错——行已删/将删，磁盘孤儿不是错误源（同 changeDataDir 清理哲学） */
function removeImageFiles(id: number, file: string, format: string): void {
    try {
        rmSync(join(galleryDir(), file), { force: true });
        if (format !== "svg") rmSync(join(thumbsDir(), format === "jpg" ? `${id}.jpg` : `${id}.png`), { force: true });
    } catch {
        /* 残留文件不挡流程 */
    }
}

// ── 分组 ──

export function listGroups(): ApiResult<GalleryGroup[]> {
    ensureInbox();
    const rows = db.prepare("SELECT id, name, inbox FROM gallery_groups ORDER BY inbox DESC, id ASC").all() as {
        id: number;
        name: string;
        inbox: number;
    }[];
    // count 一把查询后 JS 拼装：个人工具规模，比按行关联子查询直白
    const counts = new Map<number, number>();
    for (const r of db.prepare("SELECT group_id, COUNT(*) AS n FROM gallery_images GROUP BY group_id").all() as {
        group_id: number;
        n: number;
    }[]) {
        counts.set(r.group_id, r.n);
    }
    return {
        ok: true,
        data: rows.map((r) => ({
            id: r.id,
            name: r.name,
            inbox: r.inbox !== 0,
            count: counts.get(r.id) ?? 0,
        })),
    };
}

export function createGroup(name: string): ApiResult<{ id: number }> {
    const info = db
        .prepare("INSERT INTO gallery_groups (name, inbox, created_at) VALUES (?, 0, ?)")
        .run(name, Date.now());
    return { ok: true, data: { id: Number(info.lastInsertRowid) } };
}

/** 收件箱是内置组：改名/删除一律拒绝（渲染端按 inbox 字段隐藏入口，这里兜底） */
export function renameGroup(id: number, name: string): ApiResult<null> {
    const row = getGroup(id);
    if (!row) return notFound;
    if (row.inbox !== 0) return badRequest;
    db.prepare("UPDATE gallery_groups SET name = ? WHERE id = ?").run(name, id);
    return { ok: true, data: null };
}

export function deleteGroup(id: number): ApiResult<null> {
    const row = getGroup(id);
    if (!row) return notFound;
    if (row.inbox !== 0) return badRequest;
    // 先查文件清单再删行：行没了就再也找不到磁盘上的图了。
    // 删组行即可——images 与 tag 都由 FK ON DELETE CASCADE 级联清掉
    const images = db.prepare("SELECT id, file, format FROM gallery_images WHERE group_id = ?").all(id) as {
        id: number;
        file: string;
        format: string;
    }[];
    db.prepare("DELETE FROM gallery_groups WHERE id = ?").run(id);
    for (const img of images) removeImageFiles(img.id, img.file, img.format);
    return { ok: true, data: null };
}

// ── 图片查询 ──

/** LIKE 通配符转义（配 ESCAPE '\'）：用户输入按字面子串匹配 */
function escapeLike(s: string): string {
    return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

const ORDER_BY = {
    time: "created_at DESC, id DESC",
    name: "title COLLATE NOCASE ASC, id ASC",
    size: "bytes DESC, id DESC",
} as const;

export function queryImages(input: GalleryQueryInput): ApiResult<{ total: number; items: GalleryImage[] }> {
    // where 片段与参数严格按同一顺序推进（group → search → tags），别打乱
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (input.group !== "all") {
        where.push("group_id = ?");
        params.push(input.group);
    }
    if (input.search) {
        where.push("title LIKE ? ESCAPE '\\'");
        params.push(escapeLike(input.search));
    }
    if (input.tags.length > 0) {
        const marks = input.tags.map(() => "?").join(", ");
        where.push(`id IN (SELECT image_id FROM gallery_tags WHERE tag IN (${marks}))`);
        params.push(...input.tags);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    // ORDER BY 取自固定词表，无用户输入参与拼接
    const orderBy = ORDER_BY[input.sort];

    const total = (db.prepare(`SELECT COUNT(*) AS n FROM gallery_images ${whereSql}`).get(...params) as { n: number })
        .n;
    const rows = db
        .prepare(
            `SELECT id, group_id AS groupId, title, bytes, width, height, format, source_path AS sourcePath, created_at AS createdAt
             FROM gallery_images ${whereSql} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
        )
        .all(...params, input.limit, input.offset) as ImageRow[];

    // 页内图片的 tags：id 集合再查一把，JS 拼回
    const tagsOf = new Map<number, string[]>();
    if (rows.length > 0) {
        const marks = rows.map(() => "?").join(", ");
        const tagRows = db
            .prepare(`SELECT image_id, tag FROM gallery_tags WHERE image_id IN (${marks}) ORDER BY tag`)
            .all(...rows.map((r) => r.id)) as { image_id: number; tag: string }[];
        for (const r of tagRows) {
            const list = tagsOf.get(r.image_id) ?? [];
            list.push(r.tag);
            tagsOf.set(r.image_id, list);
        }
    }
    return { ok: true, data: { total, items: rows.map((r) => ({ ...r, tags: tagsOf.get(r.id) ?? [] })) } };
}

export function allTags(): ApiResult<string[]> {
    const rows = db.prepare("SELECT DISTINCT tag FROM gallery_tags ORDER BY tag").all() as { tag: string }[];
    return { ok: true, data: rows.map((r) => r.tag) };
}

// ── 导入（文件 / 剪贴板）──

/** 扩展名归一：小写、去点；jpeg 归一为 jpg（格式词汇见 GALLERY_FORMATS） */
function normalizeExt(path: string): string {
    const e = extname(path).replace(/^\./, "").toLowerCase();
    return e === "jpeg" ? "jpg" : e;
}

/** gallery/ 内最终文件名：磁盘撞名则在扩展名前插 " (2)"、" (3)"…。
 *  DB 的 file 列同查一把——防「行还在、磁盘文件已被外部删掉」时重用同名撞 UNIQUE 约束 */
function uniqueName(original: string): string {
    const ext = extname(original);
    const stem = original.slice(0, original.length - ext.length);
    const fileTaken = db.prepare("SELECT 1 FROM gallery_images WHERE file = ?");
    let candidate = original;
    for (let n = 2; existsSync(join(galleryDir(), candidate)) || fileTaken.get(candidate); n++) {
        candidate = `${stem} (${n})${ext}`;
    }
    return candidate;
}

function shaExists(sha: string): boolean {
    return !!db.prepare("SELECT 1 FROM gallery_images WHERE sha256 = ?").get(sha);
}

/** 落盘 + 落库（import 与 paste 共用的收尾路径）；buf 已经过 hash 去重判定 */
function saveImage(groupId: number, title: string, file: string, sha: string, buf: Buffer, sourcePath: string): void {
    // 尺寸用 Electron 解码器现读：svg / 解不动的图存 0×0，前端按无尺寸处理
    const img = nativeImage.createFromPath(join(galleryDir(), file));
    const size = img.isEmpty() ? { width: 0, height: 0 } : img.getSize();
    db.prepare(
        "INSERT INTO gallery_images (group_id, title, file, sha256, bytes, width, height, format, source_path, created_at) " +
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(groupId, title, file, sha, buf.length, size.width, size.height, normalizeExt(file), sourcePath, Date.now());
}

export function importFiles(files: string[], groupId: number): ApiResult<GalleryImportStats> {
    ensureInbox();
    if (!getGroup(groupId)) return notFound;
    let imported = 0;
    let skipped = 0;
    for (const f of files) {
        const ext = normalizeExt(f);
        if (!(GALLERY_FORMATS as readonly string[]).includes(ext)) {
            skipped++;
            continue;
        }
        let buf: Buffer;
        try {
            buf = readFileSync(f);
        } catch {
            skipped++; // 读不到（已删除/无权限）不算错误，计入跳过
            continue;
        }
        const sha = createHash("sha256").update(buf).digest("hex");
        if (shaExists(sha)) {
            skipped++; // 内容去重：同内容全库只收一份
            continue;
        }
        const name = uniqueName(basename(f));
        writeFileSync(join(galleryDir(), name), buf);
        saveImage(groupId, basename(f), name, sha, buf, f);
        imported++;
    }
    return { ok: true, data: { imported, skipped } };
}

/** 剪贴板落图文件名：本地时间戳；同一秒多张由 uniqueName 加序号区分 */
function pasteName(): string {
    const p = (n: number) => String(n).padStart(2, "0");
    const d = new Date();
    return `paste-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.png`;
}

export function pasteFromClipboard(groupId: number): ApiResult<GalleryImportStats> {
    const img = clipboard.readImage();
    if (img.isEmpty()) return { ok: false, error: { kind: "gallery", code: "no-image" } };
    if (!getGroup(groupId)) return notFound;
    const buf = img.toPNG();
    const sha = createHash("sha256").update(buf).digest("hex");
    if (shaExists(sha)) return { ok: true, data: { imported: 0, skipped: 1 } };
    const name = uniqueName(pasteName());
    writeFileSync(join(galleryDir(), name), buf);
    saveImage(groupId, name, name, sha, buf, "");
    return { ok: true, data: { imported: 1, skipped: 0 } };
}

// ── 图片批量操作 ──

export function setImageTags(id: number, tags: string[]): ApiResult<null> {
    if (!db.prepare("SELECT 1 FROM gallery_images WHERE id = ?").get(id)) return notFound;
    const list = [...new Set(tags)];
    db.transaction(() => {
        db.prepare("DELETE FROM gallery_tags WHERE image_id = ?").run(id);
        const ins = db.prepare("INSERT INTO gallery_tags (image_id, tag) VALUES (?, ?)");
        for (const t of list) ins.run(id, t);
    })();
    return { ok: true, data: null };
}

export function moveImages(ids: number[], groupId: number): ApiResult<null> {
    if (!getGroup(groupId)) return notFound;
    const upd = db.prepare("UPDATE gallery_images SET group_id = ? WHERE id = ?");
    db.transaction(() => {
        for (const id of ids) upd.run(groupId, id);
    })();
    return { ok: true, data: null };
}

export function deleteImages(ids: number[]): ApiResult<null> {
    const get = db.prepare("SELECT id, file, format FROM gallery_images WHERE id = ?") as {
        get: (id: number) => { id: number; file: string; format: string } | undefined;
    };
    const del = db.prepare("DELETE FROM gallery_images WHERE id = ?");
    db.transaction(() => {
        for (const id of ids) {
            const row = get.get(id);
            if (!row) continue;
            removeImageFiles(row.id, row.file, row.format);
            del.run(id);
        }
    })();
    return { ok: true, data: null };
}

// ── 系统动作：图片按 id 寻址，磁盘路径（数据目录/文件名）不出主进程，
//    打开与定位由这里代劳（渲染端无路径可拼）──

/** 用系统默认看图程序打开；openPath 返回空串即成功 */
export async function openImage(id: number): Promise<ApiResult<null>> {
    const row = db.prepare("SELECT file FROM gallery_images WHERE id = ?").get(id) as { file: string } | undefined;
    if (!row) return notFound;
    const err = await shell.openPath(join(galleryDir(), row.file));
    return err ? { ok: false, error: { kind: "failed", path: err } } : { ok: true, data: null };
}

/** 在资源管理器/Finder 中定位 */
export function revealImage(id: number): ApiResult<null> {
    const row = db.prepare("SELECT file FROM gallery_images WHERE id = ?").get(id) as { file: string } | undefined;
    if (!row) return notFound;
    shell.showItemInFolder(join(galleryDir(), row.file));
    return { ok: true, data: null };
}

/** 原生多选文件框（图库导入入口）；取消返回 []。过滤名只用扩展名串，主进程不引入界面文案（见 pickFile 先例） */
export async function pickFiles(): Promise<ApiResult<string[]>> {
    const r = await dialog.showOpenDialog({
        properties: ["openFile", "multiSelections"],
        filters: [{ name: GALLERY_FORMATS.join(";"), extensions: [...GALLERY_FORMATS] }],
    });
    return { ok: true, data: r.canceled ? [] : r.filePaths };
}

// ── mpimg:// 协议取字节（注册见 electron/main.ts）──

function thumbPath(id: number, format: string): string {
    return join(thumbsDir(), format === "jpg" ? `${id}.jpg` : `${id}.png`);
}

function readThumb(id: number, format: string): { buf: Buffer; mime: string } | null {
    try {
        return { buf: readFileSync(thumbPath(id, format)), mime: format === "jpg" ? MIME.jpg : MIME.png };
    } catch {
        return null; // 还没生成过，调用方按需生成
    }
}

/** 按需生成缩略图：长边压到 320 等比（不足阈值的不放大，放大不增信息量），jpg 存 JPEG(85)、
 *  其余存 PNG 保透明（gif 取首帧）。源解不动（isEmpty）返回 null，调用方回退原图字节。
 *  已知取舍：nativeImage 对 jpg 的 EXIF 方向不保证与 <img> 一致，个别竖拍照片缩略图
 *  方向可能不一致——个人工具接受，不值得为此引入完整解码器。 */
function makeThumb(id: number, format: string, origPath: string): { buf: Buffer; mime: string } | null {
    const img = nativeImage.createFromPath(origPath);
    if (img.isEmpty()) return null;
    const { width, height } = img.getSize();
    const long = Math.max(width, height);
    const thumb =
        long > THUMB_EDGE
            ? img.resize({
                  width: Math.round((width * THUMB_EDGE) / long),
                  height: Math.round((height * THUMB_EDGE) / long),
              })
            : img;
    const out = format === "jpg" ? thumb.toJPEG(85) : thumb.toPNG();
    try {
        writeFileSync(thumbPath(id, format), out);
    } catch {
        /* 落盘失败不影响本次返回，下次再生成 */
    }
    return { buf: out, mime: format === "jpg" ? MIME.jpg : MIME.png };
}

/** 协议处理器入口：按 id 取原图或缩略图字节；行不存在/文件读不到返回 null（→ 404） */
export function serveImage(kind: "orig" | "thumb", id: number): { buf: Buffer; mime: string } | null {
    const row = db.prepare("SELECT file, format FROM gallery_images WHERE id = ?").get(id) as
        { file: string; format: string } | undefined;
    if (!row) return null;
    const origPath = join(galleryDir(), row.file);
    // thumb 对 svg 直接回原图：矢量天然可缩放，不生成位图缩略图
    if (kind === "thumb" && row.format !== "svg") {
        const thumb = readThumb(id, row.format) ?? makeThumb(id, row.format, origPath);
        if (thumb) return thumb;
    }
    try {
        return { buf: readFileSync(origPath), mime: MIME[row.format] ?? MIME.jpg };
    } catch {
        return null; // 磁盘文件被外部删除等：404
    }
}
