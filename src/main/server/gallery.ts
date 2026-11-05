import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { readFile, rename, rm, rmdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import { promisify } from "node:util";
import { BrowserWindow, clipboard, dialog, session, shell } from "electron";
import db from "./db";
import { IMPORT_PARTITION } from "./chromeLogin";
import { dataDir } from "./util/dataDir";
import { GALLERY_NAME } from "./util/dataLocation";
import { withNativeDialog } from "./util/nativeDialog";
import { getSetting, setSetting } from "./util/settings";
import {
    GALLERY_FORMATS,
    type GalleryCandidate,
    type GalleryDownloadInput,
    type GalleryGroup,
    type GalleryImage,
    type GalleryImportCandidatesInput,
    type GalleryImportStats,
    type GalleryOverview,
    type GalleryPageResult,
    type GalleryQueryInput,
} from "./schemas";
// type-only import 编译期擦除，不构成运行时循环依赖（同 experts.ts）
import type { ApiResult } from "./api";

// ── 图库（工具 gallery 的后端）：图片字节级复制进数据目录 gallery/<组文件夹>/，行里只存元数据 ──
// 去重以 sha256 为准（同内容全库只收一份，一图一行一组，故按分组落子目录无共享冲突）；
// file 列存「组文件夹/文件名」相对路径（分隔符固定 /，join 拼接自动适配平台），组文件夹名由
// 组名清洗而来。缩略图由渲染端 Worker 生成、经 gallerySaveThumb 落盘到 .thumbs/（按 id
// 寻址，不分目录），主进程只读写字节不解码；经 mpimg:// 协议按 id 直读（注册见 src/main/app.ts）。文件名只作显示与磁盘名，不参与寻址——协议按整数
// id 找行，文件夹名写入前已清洗非法字符，行内相对路径不会逃出 gallery/。

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

// 目录只算一次、只 mkdir 一次：数据目录运行期不变（改目录后会重启），而每张图的
// 每次读写都要取这两个路径，反复 mkdir 是白花的同步 IO
let galleryDirCache: string | undefined;
let thumbsDirCache: string | undefined;

function galleryDir(): string {
    if (!galleryDirCache) {
        galleryDirCache = join(dataDir(), GALLERY_NAME);
        mkdirSync(galleryDirCache, { recursive: true });
    }
    return galleryDirCache;
}

function thumbsDir(): string {
    if (!thumbsDirCache) {
        thumbsDirCache = join(galleryDir(), ".thumbs");
        mkdirSync(thumbsDirCache, { recursive: true });
    }
    return thumbsDirCache;
}

// better-sqlite3 的 .all()/.get() 返回 unknown[]，在 SQL 边界断言成行类型（同 api.ts 的 as* 约定）。
// inWall 在 SQL 里是 EXISTS 的 0/1，查询收尾处再折成 boolean
type ImageRow = Omit<GalleryImage, "tags" | "inWall"> & { inWall: number };

/** 幂等播种内置收件箱：name 固定存「收件箱」，渲染端对 inbox=1 的组用 i18n 键显示，DB 名不参与展示 */
function ensureInbox(): void {
    db.prepare(
        "INSERT INTO gallery_groups (name, inbox, created_at) SELECT '收件箱', 1, ? " +
            "WHERE NOT EXISTS (SELECT 1 FROM gallery_groups WHERE inbox = 1)",
    ).run(Date.now());
}

// 导入/删除等热路径循环里反复用的语句提为模块级复用（better-sqlite3 不缓存
// prepared statement，函数内每次调用都重新编译）；就近声明，读函数不用跳转
const stmtGroupById = db.prepare("SELECT id, inbox FROM gallery_groups WHERE id = ?");
const stmtGroupName = db.prepare("SELECT name FROM gallery_groups WHERE id = ?");
const stmtGroupFilePrefix = db.prepare("SELECT file FROM gallery_images WHERE group_id = ? LIMIT 1");
const stmtShaExists = db.prepare("SELECT 1 FROM gallery_images WHERE sha256 = ?");
const stmtImageExists = db.prepare("SELECT 1 FROM gallery_images WHERE id = ?");
const stmtFileTaken = db.prepare("SELECT 1 FROM gallery_images WHERE file = ?");

function getGroup(id: number): { id: number; inbox: number } | undefined {
    return stmtGroupById.get(id) as { id: number; inbox: number } | undefined;
}

// ── 组文件夹：图片按分组名落 gallery/<组文件夹>/，不再平级堆在 gallery/ 根 ──

/** 组名 → 磁盘文件夹名：剔除 Windows 非法字符与控制字符（字符集对齐 nameFromUrl 的
 *  清洗先例）、压缩空白、去尾部点；开头的点换成 _（防隐藏目录、防与 .thumbs 撞名）。
 *  清洗后为空、或撞 Windows 保留名（CON/NUL/COM1…）时兜底 group-<id> */
function sanitizeFolderName(groupId: number, name: string): string {
    const f = name
        .replace(/[\\/:*?"<>|\x00-\x1f]/g, "")
        .replace(/^\.+/, "_")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/\.+$/, "")
        .slice(0, 50);
    return !f || /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(f) ? `group-${groupId}` : f;
}

/** 文件夹名是否已被占用：目录存在且非空（空目录无害，可复用）。读失败（权限等，
 *  非「不存在」）保守视为占用 */
function folderTaken(dir: string): boolean {
    try {
        return readdirSync(dir).length > 0;
    } catch (e) {
        return (e as NodeJS.ErrnoException).code !== "ENOENT";
    }
}

/** 现算组文件夹名（并确保目录存在），不信任行内前缀：组名清洗而来，与其他组的
 *  现存目录撞名则兜底 group-<id>（DB 允许重名组，磁盘不允许混居）。同一组无图期间
 *  现算结果可能因他组先占了目录而变，但无图 = 无文件，只影响未来写入，一致性无损 */
function computeGroupFolder(groupId: number): string {
    const name = stmtGroupName.get(groupId) as { name: string } | undefined;
    let f = name ? sanitizeFolderName(groupId, name.name) : `group-${groupId}`;
    if (folderTaken(join(galleryDir(), f))) f = `group-${groupId}`;
    mkdirSync(join(galleryDir(), f), { recursive: true });
    return f;
}

/** 组的磁盘文件夹名：组已有图片则以行内 file 前缀为准——磁盘现状优先，改名/移动后的
 *  寻址恒定。前缀只对含 / 的行可信（含 / = 已是「组文件夹/文件名」形态）；不含 / 的
 *  平级残留行 split 会把整个文件名当前缀（首版迁移的真实事故），必须走现算 */
function groupFolder(groupId: number): string {
    const row = stmtGroupFilePrefix.get(groupId) as { file: string } | undefined;
    if (row && row.file.includes("/")) return row.file.split("/")[0];
    return computeGroupFolder(groupId);
}

/** 一次性归位迁移（模块加载即执行，幂等可重跑；全部行归位后写 galleryFoldersMigrated
 *  标记，之后每次启动直接跳过，不再全表扫描 + 逐行 stat）：
 *  - 平级旧行（file 不含 /）：rename 进组文件夹并回写相对路径；
 *  - 坏行（含 / 但前缀在磁盘上不是目录）：首版迁移 bug 的善后——当时把组内第一张图的
 *    文件名当成了组文件夹写进 file，rename 全部 ENOENT、磁盘未动，文件其实还在
 *    gallery/ 根；还原成 basename 后按平级行归位；
 *  - 好行（含 / 且前缀是磁盘目录）：已就位，跳过（顺带为本组后续行锚定文件夹名）。
 *  rename 失败时：源文件确实没了（ENOENT）照常回写行（与「磁盘文件被外部删→404」
 *  既有语义一致）；被占用等暂时性失败跳过该行不回写，下次启动仍会重试 */
(function migrateFlatToGroupFolders(): void {
    if (getSetting("galleryFoldersMigrated", "") === "1") return;
    const rows = db.prepare("SELECT id, file, group_id FROM gallery_images ORDER BY group_id, id").all() as {
        id: number;
        file: string;
        group_id: number;
    }[];
    const upd = db.prepare("UPDATE gallery_images SET file = ? WHERE id = ?");
    // 组 → 已确认的文件夹名：好行的前缀 / 本组首张归位后的名字，同组后续行直接沿用
    const folders = new Map<number, string>();
    let moved = 0;
    let skippedRows = 0;
    for (const r of rows) {
        let base = r.file;
        if (r.file.includes("/")) {
            const prefix = r.file.slice(0, r.file.indexOf("/"));
            let prefixIsDir = false;
            try {
                prefixIsDir = statSync(join(galleryDir(), prefix)).isDirectory();
            } catch {
                /* 不存在/不可 stat = 坏行 */
            }
            if (prefixIsDir) {
                folders.set(r.group_id, prefix); // 好行：已就位，顺带锚定本组文件夹名
                continue;
            }
            base = r.file.slice(r.file.indexOf("/") + 1); // 坏行：文件实为 gallery/ 根下的 basename
        }
        const folder = folders.get(r.group_id) ?? computeGroupFolder(r.group_id);
        folders.set(r.group_id, folder);
        const rel = `${folder}/${base}`;
        try {
            renameSync(join(galleryDir(), base), join(galleryDir(), rel));
        } catch (e) {
            if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
                skippedRows++; // 暂时性失败：这次不算归位，不写标记，下次启动重试
                continue;
            }
        }
        upd.run(rel, r.id);
        moved++;
    }
    if (moved > 0) console.log(`[gallery] 归位迁移 ${moved} 张图片进组文件夹`);
    if (skippedRows === 0) setSetting("galleryFoldersMigrated", "1");
})();

/** 删原图与缩略图（缩略图按源格式定名：jpg 存 .jpg，其余 .png，svg 不生成）。
 *  rm 失败只当垃圾残留不报错——行已删/将删，磁盘孤儿不是错误源（同 changeDataDir 清理哲学） */
async function removeImageFiles(id: number, file: string, format: string): Promise<void> {
    try {
        await rm(join(galleryDir(), file), { force: true });
        if (format !== "svg") await rm(thumbPath(id, format), { force: true });
    } catch {
        /* 残留文件不挡流程 */
    }
}

// ── 分组 ──

// 图库密码（工具级一个，不是每组一个）：明文存 settings 表（用户决策）。防的是
// 旁人临时操作界面瞥一眼，不防能开库的人——因此改密/清除不校验旧密码。
const GALLERY_PASSWORD_KEY = "galleryPassword";

/** 是否处于解锁视角：没设密码（私密体系未启用）恒开；设了则要求密码匹配 */
function unlockedView(password?: string): boolean {
    const real = getSetting(GALLERY_PASSWORD_KEY, "");
    return real === "" || password === real;
}

/** 是否已设图库密码（渲染端据此决定锁定开关显隐） */
export function passwordState(): ApiResult<{ has: boolean }> {
    return { ok: true, data: { has: getSetting(GALLERY_PASSWORD_KEY, "") !== "" } };
}

/** 设置/修改（非 null）/清除（null）图库密码 */
export function setLibraryPassword(password: string | null): ApiResult<null> {
    setSetting(GALLERY_PASSWORD_KEY, password ?? "");
    return { ok: true, data: null };
}

/** 解锁校验：密码匹配即放行。解锁态存渲染端组件 state（工具关闭即回到锁定），
 *  后端无会话——后续列表/查询由渲染端自行携带密码 */
export function unlockLibrary(password: string): ApiResult<null> {
    if (getSetting(GALLERY_PASSWORD_KEY, "") === "") return badRequest; // 没设密码没什么可解锁
    return password === getSetting(GALLERY_PASSWORD_KEY, "")
        ? { ok: true, data: null }
        : { ok: false, error: { kind: "gallery", code: "wrong-password" } };
}

/** 分组标记/取消私密。锁定与否不影响标记本身；收件箱同改名/删除一律拒绝 */
export function setGroupPrivate(id: number, isPrivate: boolean): ApiResult<null> {
    const row = getGroup(id);
    if (!row) return notFound;
    if (row.inbox !== 0) return badRequest;
    db.prepare("UPDATE gallery_groups SET private = ? WHERE id = ?").run(isPrivate ? 1 : 0, id);
    return { ok: true, data: null };
}

export function listGroups(password?: string): ApiResult<GalleryGroup[]> {
    ensureInbox();
    // 锁定视角直接不下发私密分组行——渲染端无需（也不该）自行过滤
    const rows = db
        .prepare(
            `SELECT id, name, inbox, private FROM gallery_groups ${
                unlockedView(password) ? "" : "WHERE private = 0"
            } ORDER BY inbox DESC, id ASC`,
        )
        .all() as { id: number; name: string; inbox: number; private: number }[];
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
            private: r.private !== 0,
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

/** 收件箱是内置组：改名/删除一律拒绝（渲染端按 inbox 字段隐藏入口，这里兜底）。
 *  改名连带把组文件夹一起 rename 并回写行内 file 前缀——先挪磁盘再改行（挪失败即报错，
 *  行不动，下次重试）；行 UPDATE 与文件夹 rename 之间的崩溃窗口是已知取舍（个人工具，
 *  404 兜底），先物理后 DB 让「行永远指向真实位置」的概率最大化 */
export function renameGroup(id: number, name: string): ApiResult<null> {
    const row = getGroup(id);
    if (!row) return notFound;
    if (row.inbox !== 0) return badRequest;
    const prefixRow = stmtGroupFilePrefix.get(id) as { file: string } | undefined;
    if (prefixRow) {
        const old = prefixRow.file.split("/")[0];
        let folder = sanitizeFolderName(id, name);
        if (folder !== old && folderTaken(join(galleryDir(), folder))) folder = `group-${id}`;
        if (folder !== old) {
            try {
                renameSync(join(galleryDir(), old), join(galleryDir(), folder));
            } catch (e) {
                return { ok: false, error: { kind: "failed", path: String(e) } };
            }
        }
        db.transaction(() => {
            db.prepare("UPDATE gallery_groups SET name = ? WHERE id = ?").run(name, id);
            // 前缀整体替换：substr 跳过「旧前缀/」，新前缀作参拼进
            db.prepare("UPDATE gallery_images SET file = ? || substr(file, ?) WHERE group_id = ?").run(
                `${folder}/`,
                old.length + 2,
                id,
            );
        })();
    } else {
        // 组内无图：没有文件夹可挪（目录只在有图时才会建）
        db.prepare("UPDATE gallery_groups SET name = ? WHERE id = ?").run(name, id);
    }
    return { ok: true, data: null };
}

export async function deleteGroup(id: number): Promise<ApiResult<null>> {
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
    for (const img of images) await removeImageFiles(img.id, img.file, img.format);
    // 组目录收尾：文件都删净了顺手移走空目录；非空（个别文件删失败/异常残留）留着当垃圾
    if (images.length > 0) {
        try {
            await rmdir(join(galleryDir(), images[0].file.split("/")[0]));
        } catch {
            /* 非空/被占用：残留不挡流程 */
        }
    }
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
    if (input.group === "wall") {
        // 画廊视图：成员籍交集。私密图仅解锁视角下发（画廊是用户主动策展的，
        // 解锁后要能放进放映——与「全部」解锁也不混入私密的规则刻意不同）
        where.push("id IN (SELECT image_id FROM gallery_wall)");
        if (!unlockedView(input.password)) {
            where.push("group_id NOT IN (SELECT id FROM gallery_groups WHERE private = 1)");
        }
    } else if (input.group !== "all") {
        // 私密分组在锁定视角下拒绝（渲染端锁定时根本拿不到该组，属兜底）；
        // 组不存在照走空结果（与既有行为一致）
        const grp = db.prepare("SELECT private FROM gallery_groups WHERE id = ?").get(input.group) as
            { private: number } | undefined;
        if (grp && grp.private !== 0 && !unlockedView(input.password)) {
            return { ok: false, error: { kind: "gallery", code: "locked" } };
        }
        where.push("group_id = ?");
        params.push(input.group);
    } else {
        // 主流图库式隔离：私密内容永不进「全部」/搜索——解锁与否都不混入，
        // 「全部」的计数与内容稳定不跳变，想看私密走侧栏底部的锁入口
        where.push("group_id NOT IN (SELECT id FROM gallery_groups WHERE private = 1)");
    }
    if (input.search) {
        where.push("title LIKE ? ESCAPE '\\'");
        params.push(`%${escapeLike(input.search)}%`);
    }
    if (input.tags.length > 0) {
        // 多标签交集（AND）：同图须命中全部所选 tag 才进结果。入参先去重——重复词会让
        // HAVING 计数永不命中（表主键保证同图同 tag 只有一行）；计数直接用去重后的
        // tags.length（数字插值，无用户输入参与拼接）
        const tags = [...new Set(input.tags)];
        const marks = tags.map(() => "?").join(", ");
        where.push(
            `id IN (SELECT image_id FROM gallery_tags WHERE tag IN (${marks}) ` +
                `GROUP BY image_id HAVING COUNT(*) = ${tags.length})`,
        );
        params.push(...tags);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    // ORDER BY 取自固定词表，无用户输入参与拼接。画廊的「时间」序 = 加入顺序（position，
    // 即放映顺序）——对画廊来说 created_at（图片导入时间）反而是错的维度
    const orderBy =
        input.group === "wall" && input.sort === "time"
            ? "(SELECT position FROM gallery_wall WHERE image_id = gallery_images.id) ASC"
            : ORDER_BY[input.sort];

    const total = (db.prepare(`SELECT COUNT(*) AS n FROM gallery_images ${whereSql}`).get(...params) as { n: number })
        .n;
    const rows = db
        .prepare(
            `SELECT id, group_id AS groupId, title, bytes, width, height, format, source_path AS sourcePath, created_at AS createdAt,
                    EXISTS(SELECT 1 FROM gallery_wall WHERE image_id = id) AS inWall
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
    return {
        ok: true,
        data: { total, items: rows.map((r) => ({ ...r, inWall: r.inWall !== 0, tags: tagsOf.get(r.id) ?? [] })) },
    };
}

// ── 画廊（放映墙）──
// 跨分组的成员籍叠加：图片仍属原分组（gallery_images.group_id 不动），这里只记在册状态。
// 快照语义：整组加入收的是那一刻的成员，之后组内增删不自动跟随（再整组加入 = 幂等并集）。
// 图片删除/分组删除时 FK ON DELETE CASCADE 自动移出画廊（foreign_keys 已开，见 db.ts）。

/** 画廊可见计数（侧栏行）：锁定视角剔除私密组的图——与画廊查询同一隔离边界 */
function wallCount(password?: string): ApiResult<{ count: number }> {
    const privateFilter = unlockedView(password)
        ? ""
        : " AND group_id NOT IN (SELECT id FROM gallery_groups WHERE private = 1)";
    const n = (
        db
            .prepare(
                `SELECT COUNT(*) AS n FROM gallery_images
                 WHERE id IN (SELECT image_id FROM gallery_wall)${privateFilter}`,
            )
            .get() as { n: number }
    ).n;
    return { ok: true, data: { count: n } };
}

/** 批量加入画廊（ids 须已过 zod 校验）；已在册/不存在的 id 幂等跳过，返回真正新增数 */
function wallAddInner(ids: number[]): { added: number } {
    const exists = db.prepare("SELECT 1 FROM gallery_images WHERE id = ?");
    const ins = db.prepare("INSERT OR IGNORE INTO gallery_wall (image_id, position, added_at) VALUES (?, ?, ?)");
    let pos = (db.prepare("SELECT IFNULL(MAX(position), 0) AS m FROM gallery_wall").get() as { m: number }).m;
    let added = 0;
    db.transaction(() => {
        for (const id of ids) {
            if (!exists.get(id)) continue; // 行已不存在（渲染端列表过期）：跳过不炸
            const r = ins.run(id, pos + 1, Date.now());
            if (r.changes > 0) {
                pos += 1;
                added += 1;
            }
        }
    })();
    return { added };
}

export function wallAdd(ids: number[]): ApiResult<{ added: number }> {
    return { ok: true, data: wallAddInner(ids) };
}

/** 整组加入（含收件箱）：服务端直接取组内成员入册，免去渲染端翻页收集 id */
export function wallAddGroup(groupId: number): ApiResult<{ added: number }> {
    if (!getGroup(groupId)) return notFound;
    const ids = db.prepare("SELECT id FROM gallery_images WHERE group_id = ?").all(groupId) as { id: number }[];
    return { ok: true, data: wallAddInner(ids.map((r) => r.id)) };
}

export function wallRemove(ids: number[]): ApiResult<null> {
    const del = db.prepare("DELETE FROM gallery_wall WHERE image_id = ?");
    db.transaction(() => {
        for (const id of ids) del.run(id);
    })();
    return { ok: true, data: null };
}

export function allTags(): ApiResult<string[]> {
    // 标签池全量返回，不按私密过滤（用户决策）：私密只隔离图片内容（「全部」/搜索/
    // 锁定下的分组列表），标签词本身仍可见——共用标签不消失，私密组内打标签也有建议。
    // 点中只有私密图命中的标签时，「全部」过滤结果为空，属预期
    const rows = db.prepare("SELECT DISTINCT tag FROM gallery_tags ORDER BY tag").all() as { tag: string }[];
    return { ok: true, data: rows.map((r) => r.tag) };
}

// ── 导入（文件 / 剪贴板）──

/** 扩展名归一：小写、去点；jpeg 归一为 jpg（格式词汇见 GALLERY_FORMATS） */
function normalizeExt(path: string): string {
    const e = extname(path).replace(/^\./, "").toLowerCase();
    return e === "jpeg" ? "jpg" : e;
}

/** gallery/<组文件夹>/ 内最终相对路径（组文件夹/文件名）：磁盘或 DB 撞名则在扩展名前插
 *  " (2)"、" (3)"…。DB 的 file 列同查一把——防「行还在、磁盘文件已被外部删掉」时重用
 *  同名撞 UNIQUE 约束 */
function uniqueName(folder: string, original: string): string {
    const ext = extname(original);
    const stem = original.slice(0, original.length - ext.length);
    let rel = `${folder}/${original}`;
    for (let n = 2; existsSync(join(galleryDir(), rel)) || stmtFileTaken.get(rel); n++) {
        rel = `${folder}/${stem} (${n})${ext}`;
    }
    return rel;
}

function shaExists(sha: string): boolean {
    return !!stmtShaExists.get(sha);
}

const stmtInsertImage = db.prepare(
    "INSERT INTO gallery_images (group_id, title, file, sha256, bytes, width, height, format, source_path, created_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
);

/** 在组文件夹里新建文件并返回相对路径：用 wx（已存在就失败）独占创建。
 *  uniqueName 的存在性检查与真正写入之间隔着 await，并发导入可能挑中同一个名字，
 *  不独占的话后写的会悄悄盖掉先写的 */
async function writeNewFile(folder: string, original: string, buf: Buffer): Promise<string> {
    for (;;) {
        const rel = uniqueName(folder, original);
        try {
            await writeFile(join(galleryDir(), rel), buf, { flag: "wx" });
            return rel;
        } catch (e) {
            if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
        }
    }
}

/** 落库（import 与 paste 共用的收尾路径）；文件已写好，buf 已经过 hash 去重判定。
 *  size 由「已探过尺寸的调用方」（网址导入候选）传入，缺省读文件头取（不解码）。
 *  异步写文件之后可能有并发导入抢先入库同一内容（sha256 或 file 列 UNIQUE 冲突）：
 *  入库失败就把刚写的文件删掉，返回 false 由调用方计入跳过 */
async function saveImage(
    groupId: number,
    title: string,
    file: string,
    sha: string,
    buf: Buffer,
    sourcePath: string,
    size?: { width: number; height: number },
): Promise<boolean> {
    const s = size ?? imageSize(buf);
    try {
        stmtInsertImage.run(
            groupId,
            title,
            file,
            sha,
            buf.length,
            s.width,
            s.height,
            normalizeExt(file),
            sourcePath,
            Date.now(),
        );
        return true;
    } catch {
        await rm(join(galleryDir(), file), { force: true }).catch(() => {});
        return false;
    }
}

export async function importFiles(files: string[], groupId: number): Promise<ApiResult<GalleryImportStats>> {
    ensureInbox();
    if (!getGroup(groupId)) return notFound;
    const folder = groupFolder(groupId);
    let imported = 0;
    let skipped = 0;
    // 一张一张顺序 await：同时读多张大图会把内存和磁盘都顶满
    for (const f of files) {
        const ext = normalizeExt(f);
        if (!(GALLERY_FORMATS as readonly string[]).includes(ext)) {
            skipped++;
            continue;
        }
        let buf: Buffer;
        try {
            buf = await readFile(f);
        } catch {
            skipped++; // 读不到（已删除/无权限）不算错误，计入跳过
            continue;
        }
        const sha = createHash("sha256").update(buf).digest("hex");
        if (shaExists(sha)) {
            skipped++; // 内容去重：同内容全库只收一份
            continue;
        }
        const name = await writeNewFile(folder, basename(f), buf);
        if (await saveImage(groupId, basename(f), name, sha, buf, f)) imported++;
        else skipped++;
    }
    return { ok: true, data: { imported, skipped } };
}

/** 剪贴板落图文件名：本地时间戳；同一秒多张由 uniqueName 加序号区分 */
function pasteName(): string {
    const p = (n: number) => String(n).padStart(2, "0");
    const d = new Date();
    return `paste-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.png`;
}

export async function pasteFromClipboard(groupId: number): Promise<ApiResult<GalleryImportStats>> {
    const img = clipboard.readImage();
    if (img.isEmpty()) return { ok: false, error: { kind: "gallery", code: "no-image" } };
    if (!getGroup(groupId)) return notFound;
    const buf = img.toPNG();
    const sha = createHash("sha256").update(buf).digest("hex");
    if (shaExists(sha)) return { ok: true, data: { imported: 0, skipped: 1 } };
    const original = pasteName();
    const name = await writeNewFile(groupFolder(groupId), original, buf);
    return (await saveImage(groupId, original, name, sha, buf, ""))
        ? { ok: true, data: { imported: 1, skipped: 0 } }
        : { ok: true, data: { imported: 0, skipped: 1 } };
}

// ── 从网址导入 ──
// 三段式 RPC（开始/抓页+下载/入库）由渲染端驱动：主进程只维护一个暂存会话——
// 候选字节落 os.tmpdir() 固定子目录（编号命名），确认入库才进 gallery/ 目录，
// 开始前与关闭/取消时由渲染端调 collectReset 清场（暂存 + 隐藏窗口），异常残留等下次清。

const STAGING_NAME = "knock-gallery-candidates";
const PAGE_TIMEOUT_MS = 15000;
const STABLE_MS = 2000; // 页面加载完后再等多久，让 JS/字体与视口附近图片的布局稳定
const COLLECT_RESERVE_MS = 1500; // 总时限里留给 DOM 采集脚本本身的时间
const RENDER_IDLE_MS = 30000; // 隐藏窗口空闲多久自动销毁
// 伪装常规浏览器 UA：不少站点对非浏览器 UA 直接 403（自报取器名会被拦）
const BROWSER_UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const PAGE_ACCEPT = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
const IMAGE_ACCEPT = "image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// 受限站登录态所在的抓取会话分区（cookie 由 server/chromeLogin.ts 从专用 Chrome 同步进来）。
// fromPartition 幂等：与隐藏渲染窗口、chromeLogin 里的写入方共享同一个 session 实例，
// 所以不在模块顶层持有，用到时再取（不用就不创建）
const importSession = () => session.fromPartition(IMPORT_PARTITION);

// ── 代理回退（仅 win 读注册表；mac 无对应注册表恒直连，个人工具够用）──
// 要处理的核心场景：代理客户端在跑但「系统代理」开关没开（ProxyEnable=0）——浏览器走插件
// 代理能上网，而 Chromium 默认读系统设置=直连，撞墙（典型：pixiv 直连超时）。ProxyEnable=1
// 时 session 默认就走系统代理，不用处理。所以只管「直连失败」：读注册表 ProxyServer，给抓取
// 分区 setProxy 后重试一次。规则对 session.fetch 和同分区的隐藏窗口同时生效；
// 重试成功后固定走代理（免得每个请求先超时一次），重试也失败就还原，不让死站拖累后续

const execFileAsync = promisify(execFile);
let proxyConfirmed = false; // 走代理已确认能通：固定下来
let proxyTrial: Promise<void> | null = null; // 试用中的 setProxy，并发失败的请求共用这一次
let proxyTrialRuns = 0; // 正在用代理重试的请求数

/** 注册表里的 ProxyServer（语法与 Chromium proxyRules 同源，原样传）；没配/非 win 返回 null */
async function registryProxyServer(): Promise<string | null> {
    if (process.platform !== "win32") return null;
    try {
        const { stdout } = await execFileAsync(
            "reg",
            ["query", "HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Internet Settings", "/v", "ProxyServer"],
            { encoding: "utf8", windowsHide: true },
        );
        return /ProxyServer\s+REG_SZ\s+(\S+)/.exec(stdout)?.[1] ?? null;
    } catch {
        return null;
    }
}

/** 先直连跑一次；抛错就换注册表代理再跑一次（fetch 与隐藏窗口加载共用） */
async function withProxyFallback<T>(run: () => Promise<T>): Promise<T> {
    try {
        return await run();
    } catch (e) {
        if (proxyConfirmed) throw e;
        const server = await registryProxyServer();
        if (!server) throw e;
        const ses = importSession();
        // 代理规则是整个分区共用的：并发下载同时失败时只设一次，最后一个重试结束才决定要不要还原。
        // 各还原各的话，一张坏图的重试失败会撤掉别的请求正在试用、甚至已确认能通的代理
        proxyTrial ??= ses.setProxy({ proxyRules: server });
        proxyTrialRuns++;
        try {
            await proxyTrial;
            const result = await run();
            proxyConfirmed = true;
            return result;
        } catch {
            throw e;
        } finally {
            if (--proxyTrialRuns === 0) {
                proxyTrial = null;
                if (!proxyConfirmed) await ses.setProxy({ mode: "system" });
            }
        }
    }
}

/** 暂存记录：编号 → 来源与探得的元数据（入库与缩略图寻址都靠它） */
const staged = new Map<number, { url: string; format: string; width: number; height: number }>();
let stagingSeq = 0;

/** 页面上每个图片 URL 的实际显示尺寸（隐藏窗口渲染探得，随暂存会话一同清场） */
const displaySizes = new Map<string, { w: number; h: number }>();

function stagingDir(): string {
    const dir = join(tmpdir(), STAGING_NAME);
    mkdirSync(dir, { recursive: true });
    return dir;
}

function wipeStaging(): void {
    staged.clear();
    stagingSeq = 0;
    displaySizes.clear();
    try {
        rmSync(join(tmpdir(), STAGING_NAME), { recursive: true, force: true });
    } catch {
        /* 清不掉只留临时目录垃圾，不挡流程 */
    }
}

/** 会话清场：清暂存 + 销毁隐藏窗口（会话开始前、关闭、取消、入库完成都调） */
export function collectReset(): ApiResult<null> {
    wipeStaging();
    destroyRenderWin();
    return { ok: true, data: null };
}

/** 带超时、防盗链头与分区 cookie 的 GET，read 在超时覆盖范围内读响应（响应体读完才清定时器，
 *  否则中途挂住的下载会永远卡着）。走 session.fetch：和隐藏窗口同一个 Chromium 网络栈，
 *  cookie/代理都自动共用。Accept 区分页面/图片：CDN 按 Accept 做内容协商。
 *  实测要点：res.url 恒为空串不可用；referrerPolicy 不传 unsafe-url 时 https 来源请求
 *  http 目标会被拦（ERR_BLOCKED_BY_CLIENT）；没同步过登录态就是匿名请求 */
async function getWithTimeout<T>(
    url: string,
    timeoutMs: number,
    referer: string,
    accept: string,
    read: (res: Response) => Promise<T>,
): Promise<T> {
    // 每次尝试（直连、代理重试）各自重新计时；定时器留到 read 读完才清。
    // 代理回退只包 fetch：连接阶段失败换代理才有意义，响应已经来了、读体时挂住换代理也没用
    let timer: NodeJS.Timeout | undefined;
    let controller: AbortController | undefined;
    const attempt = () => {
        clearTimeout(timer);
        controller = new AbortController();
        const { signal } = controller;
        timer = setTimeout(() => controller?.abort(), timeoutMs);
        return importSession().fetch(url, {
            signal,
            credentials: "include",
            redirect: "follow",
            referrerPolicy: "unsafe-url",
            headers: { "user-agent": BROWSER_UA, accept, ...(referer ? { referer } : {}) },
        });
    };
    try {
        return await read(await withProxyFallback(attempt));
    } finally {
        clearTimeout(timer);
        // 读完后 abort 是空操作；提前返回（超限、只看响应头）时靠它真正断开连接——
        // 实测 reader.cancel() 不会关连接，服务端会一直往一个没人读的连接里写
        controller?.abort();
    }
}

/** 探测 URL 本身是不是图片直链：只看响应头的 content-type，不读响应体（返回后由 getWithTimeout 断开连接）。
 *  失败不算大事（渲染端照样走渲染收集），但分清「探测失败」与「不是图片」 */
export async function probeUrl(url: string): Promise<ApiResult<{ isImage: boolean }>> {
    try {
        const isImage = await getWithTimeout(
            url,
            PAGE_TIMEOUT_MS,
            "",
            PAGE_ACCEPT,
            async (res) => res.ok && (res.headers.get("content-type") ?? "").startsWith("image/"),
        );
        return { ok: true, data: { isImage } };
    } catch {
        return { ok: false, error: { kind: "gallery", code: "fetch" } };
    }
}

/** 下载一张图的字节。体积上限：先看 content-length，缺失/说谎时边读边累计，超限立刻
 *  返回（不把超大文件读完，连接由 getWithTimeout 断开）。失败原因返回字符串，成功返回字节与 Content-Type */
async function downloadBytes(
    url: string,
    timeoutMs: number,
    referer: string,
    maxBytes: number,
): Promise<{ buf: Buffer; mime: string } | "fetch" | "too-large"> {
    return getWithTimeout(url, timeoutMs, referer, IMAGE_ACCEPT, async (res) => {
        if (!res.ok) return "fetch";
        if (Number(res.headers.get("content-length") ?? 0) > maxBytes) return "too-large";
        const chunks: Buffer[] = [];
        let total = 0;
        const reader = res.body?.getReader();
        while (reader) {
            const { done, value } = await reader.read();
            if (done) break;
            total += value.length;
            if (total > maxBytes) return "too-large";
            chunks.push(Buffer.from(value.buffer, value.byteOffset, value.length));
        }
        const mime = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
        return { buf: Buffer.concat(chunks), mime };
    });
}

/** 渲染侧 document.title 的清洗：去内嵌标签、压空白、解码常见实体，截断 50（对齐分组名 schema 上限）；
 *  网址导入单独成组的组名首选 */
function cleanTitle(raw: string): string | null {
    const s = raw
        .replace(/<[^>]*>/g, "")
        .replace(/\s+/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#0?39;/g, "'")
        .replace(/&nbsp;/gi, " ")
        .trim()
        .slice(0, 50);
    return s || null;
}

/** Content-Type → 格式（与 MIME 表互逆；octet-stream 等不在此列，靠魔数/URL 扩展名兜底） */
const MIME_TO_FORMAT: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/bmp": "bmp",
    "image/svg+xml": "svg",
};

// ── 隐藏渲染窗口：模块级只留一个，翻页之间复用，空闲 RENDER_IDLE_MS 自动销毁 ──

let renderWin: BrowserWindow | null = null;
let renderIdleTimer: NodeJS.Timeout | undefined;

function getRenderWin(): BrowserWindow {
    clearTimeout(renderIdleTimer);
    if (!renderWin || renderWin.isDestroyed()) {
        renderWin = new BrowserWindow({
            show: false,
            width: 1280,
            height: 900,
            // 挂抓取分区：受限站在隐藏渲染里也带登录态（同步过 cookie 时），与 fetch 链路同源
            webPreferences: { nodeIntegration: false, contextIsolation: true, partition: IMPORT_PARTITION },
        });
        renderWin.webContents.setWindowOpenHandler(() => ({ action: "deny" })); // 页面脚本不得借隐藏窗口弹任何窗
    }
    return renderWin;
}

/** 销毁隐藏窗口（默认当前这个）；传入的若已不是当前窗口，只销毁它自己，不动新建的 */
function destroyRenderWin(win: BrowserWindow | null = renderWin): void {
    if (renderWin === win) {
        clearTimeout(renderIdleTimer);
        renderWin = null;
    }
    if (win && !win.isDestroyed()) win.destroy();
}

/** 加载页面，等到 dom-ready 就算成功。不用 loadURL 的 Promise：它等 did-finish-load 才兑现，
 *  图多/有永不返回的图的页面会一直挂着。真正的导航失败（DNS、连接被拒等）靠 did-fail-load
 *  的主框架失败报出；-3（ERR_ABORTED）是被新导航打断或转成下载，不算失败 */
function loadUntilDomReady(win: BrowserWindow, url: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const wc = win.webContents;
        const onReady = () => {
            wc.off("did-fail-load", onFail);
            resolve();
        };
        const onFail = (_e: unknown, code: number, desc: string, _url: string, isMainFrame: boolean) => {
            if (!isMainFrame || code === -3) return;
            wc.off("dom-ready", onReady);
            wc.off("did-fail-load", onFail);
            reject(new Error(`${desc} (${code})`));
        };
        wc.once("dom-ready", onReady);
        wc.on("did-fail-load", onFail);
        win.loadURL(url, { userAgent: BROWSER_UA }).catch(() => {}); // 失败由 did-fail-load 报告
    });
}

/** 等页面停止加载（成功或失败都算），最多等 ms 毫秒；慢页面等不到就直接往下走 */
function waitStopLoading(win: BrowserWindow, ms: number): Promise<void> {
    const wc = win.webContents;
    if (!wc.isLoading()) return Promise.resolve();
    return new Promise((resolve) => {
        const done = () => {
            clearTimeout(timer);
            wc.off("did-stop-loading", done);
            resolve();
        };
        const timer = setTimeout(done, ms);
        wc.once("did-stop-loading", done);
    });
}

/** 渲染收集页面：隐藏窗口真实加载后，从 DOM 一次性收「图片 URL 全集 + 各 URL 的实际
 *  显示尺寸 + <title> + 下一页链接」，结果并进会话 displaySizes。SPA 站（pixiv 等）的
 *  作品图是 JS 插入的，静态 HTML 里只有页脚图标——渲染后的 DOM 才是全量，这是把旧
 *  「只量显示尺寸」的渲染升级为收集主路径的原因。约定：
 *  - 图片允许真实加载（实测教训：images:false 下进入懒加载视口的图会「尝试加载→失败」
 *    进入破损态，渲染成 alt 文本行盒——buondua 页面前 7 张量出 467×24 即此）。开加载后：
 *    进视口的图按真实内在尺寸布局（= 真实浏览器），远处懒图不下载、按 width/height 属性
 *    撑盒（属性即网站声明的显示意图），两者都正确；带宽代价只有视口附近的少量图。
 *  - 未加载图的高度若仍是属性原值而宽度被 CSS 改过，按属性纵横比折算（未加载图高度不缩）。
 *  - 矮盒（h<60）一律按未知丢弃：图标、真细横条、以及任何布局残迹。
 *  - <img> 的 srcset 各档共享同一布局盒（currentSrc 只选一档，不补齐则其余档
 *    永远配不上显示尺寸）；全部绝对化后再当键。
 *  - <a> 包着的 <img>：缩略图的显示尺寸归给链接目标（大图直链的「显示尺寸」就是它缩略图的）。
 *  - 同一 URL 出现多处取最大显示尺寸（既是缩略图又是正文大图 = 算显示过大的）。
 *  - 页面脚本真实执行：nodeIntegration 关、弹窗全拦。窗口翻页间复用、空闲销毁，失败/超时
 *    先销毁再返回 fetch 错误，细节写主进程控制台，pnpm dev 终端可排查。
 *  - 总时限 PAGE_TIMEOUT_MS：只等 dom-ready，到点用已加载的 DOM 收集，慢页面不报错。 */
export async function renderPage(url: string): Promise<ApiResult<GalleryPageResult>> {
    const win = getRenderWin();
    try {
        // 整段（加载 + 布局稳定 + DOM 采集）统一 15s 上限：页面挂死不泄漏窗口，输了的 Promise 由 race 吞掉
        const started = Date.now();
        const work = (async () => {
            // 只等 dom-ready 就往下走：图多的页面等 did-finish-load 常超时，到点用已加载的 DOM 收集即可
            await withProxyFallback(() => loadUntilDomReady(win, url));
            // 等 JS/字体与视口附近的图片布局稳定（SPA 插图稍慢）：先等页面加载完（最多等到截止前留出采集时间），
            // 加载完再多等 2 秒；慢页面等不到加载完就用已有的 DOM
            const left = (reserve: number) => Math.max(0, PAGE_TIMEOUT_MS - reserve - (Date.now() - started));
            await waitStopLoading(win, left(COLLECT_RESERVE_MS + STABLE_MS));
            await sleep(Math.min(STABLE_MS, left(COLLECT_RESERVE_MS)));
            // 必须走 mainFrame：webContents.executeJavaScript 会等页面加载完成，慢页面会一直等下去。
            // 脚本 async 化后 stringify 必须在函数体内做（对 Promise 同步 stringify 得 undefined）
            return (await win.webContents.mainFrame.executeJavaScript(`(async () => {
                    const IMG_RE = /\\.(?:jpe?g|png|gif|webp|bmp|svg)(?:$|[?#])/i;
                    const abs = (u) => {
                        try {
                            const a = new URL(u, document.baseURI);
                            return (a.protocol === "http:" || a.protocol === "https:") ? a.href : "";
                        } catch { return ""; }
                    };
                    const box = (img) => {
                        const r = img.getBoundingClientRect();
                        let w = Math.round(r.width), h = Math.round(r.height);
                        if (w <= 0 || h <= 0) return null;
                        const aw = parseInt(img.getAttribute("width"), 10);
                        const ah = parseInt(img.getAttribute("height"), 10);
                        const hasAttrs = Number.isFinite(aw) && Number.isFinite(ah) && aw > 0 && ah > 0;
                        if (hasAttrs) {
                            // 未加载的图高度若仍是属性原值（CSS height:auto），宽度被 CSS 改过也不会
                            // 按纵横比缩——量出 467×1537 而真实显示是 467×701。按属性纵横比折算。
                            if (h === ah && w !== aw) h = Math.round(w * ah / aw);
                        }
                        // 矮盒一律不信（实测出现过带属性仍量出 467×24 的）：alt 文本行盒、
                        // 轮播中途/折叠容器的布局残迹、真细横条，一律按未知处理
                        if (h < 60) return null;
                        return { w, h };
                    };
                    // URL 全集（含懒加载属性与 srcset 各档，未必有布局盒）+ 有盒者的尺寸表（同 URL 取最大）
                    const urls = new Set();
                    const sizes = new Map();
                    const record = (rawUrl, b) => {
                        const u = abs(rawUrl);
                        if (!u) return;
                        urls.add(u);
                        if (b) {
                            const old = sizes.get(u);
                            if (!old || b.w * b.h > old.w * old.h) sizes.set(u, b);
                        }
                    };
                    for (const img of document.images) {
                        const b = box(img);
                        record(img.currentSrc || img.src, b);
                        for (const attr of ["data-src", "data-original"]) {
                            const v = img.getAttribute(attr);
                            if (v) record(v, null);
                        }
                        for (const p of (img.getAttribute("srcset") || "").split(",")) {
                            const u = p.trim().split(/\\s+/)[0];
                            if (u) record(u, b);
                        }
                    }
                    // <a> 直链大图（href 指向图片扩展名）：内部缩略图的显示尺寸归给链接目标
                    for (const a of document.links) {
                        const href = a.getAttribute("href") || "";
                        if (!IMG_RE.test(href)) continue;
                        for (const img of a.querySelectorAll("img")) record(href, box(img));
                    }
                    const sameHost = (href) => {
                        try {
                            const u = new URL(href, location.href);
                            return (u.protocol === "http:" || u.protocol === "https:") && u.host === location.host ? u.href : "";
                        } catch { return ""; }
                    };
                    // 翻页：rel=next 优先，其次锚文本整体匹配常见字样（只认同 host：跨 host 的多半是推荐位/广告）
                    let nextUrl = "";
                    for (const el of document.querySelectorAll("a[rel=next], link[rel=next]")) {
                        const h = sameHost(el.getAttribute("href") || "");
                        if (h) { nextUrl = h; break; }
                    }
                    if (!nextUrl) {
                        const NEXT_RE = /^(?:(?:下一页|下页|后一页|next page|next)\\s*[›»→]?|[›»→])$/i;
                        for (const a of document.links) {
                            const t = (a.textContent || "").replace(/<[^>]*>/g, "").replace(/\\s+/g, " ").trim().toLowerCase();
                            if (!NEXT_RE.test(t)) continue;
                            const h = sameHost(a.getAttribute("href") || "");
                            if (h) { nextUrl = h; break; }
                        }
                    }
                    // ── pixiv 特化（用户决策的例外，仅此一个站点分支）：作品页的 <img> 只有
                    // master1200 缩版，原图（img-original）只在 /ajax/illust 里，多页作品的
                    // 其余页更是完全不在 DOM。同源 fetch 带分区 cookie（匿名访问 urls 全 null），
                    // 代理/UA/登录态全部继承渲染窗口，零额外机制
                    if (location.host === "www.pixiv.net") {
                        const m = /^\\/artworks\\/(\\d+)/.exec(location.pathname);
                        if (m) {
                            try {
                                const aj = await fetch("/ajax/illust/" + m[1], { headers: { accept: "application/json" }, credentials: "include" });
                                const b = (await aj.json()).body;
                                if (b && b.urls && b.urls.original) {
                                    record(b.urls.original, null);
                                    if ((b.pageCount || 1) > 1) {
                                        const rp = await fetch("/ajax/illust/" + m[1] + "/pages", { headers: { accept: "application/json" }, credentials: "include" });
                                        const jp = await rp.json();
                                        for (const p of jp.body || []) {
                                            if (p.urls && p.urls.original) record(p.urls.original, null);
                                        }
                                    }
                                    // 原图在手：清掉同作品的缩版（master/custom-thumb/square），免得重复入库；
                                    // 推荐区其他作品的缩略不受影响（id 不同），靠尺寸过滤自行取舍
                                    for (const u of Array.from(urls)) {
                                        if (u.includes("/" + m[1] + "_") && !u.includes("/img-original/")) urls.delete(u);
                                    }
                                }
                            } catch (e) { /* ajax 失败照常走 DOM 收集的结果 */ }
                        }
                    }
                    return JSON.stringify({
                        urls: Array.from(urls),
                        sizes: Array.from(sizes, ([src, b]) => ({ src: src, w: b.w, h: b.h })),
                        nextUrl: nextUrl,
                        title: document.title,
                    });
                })()`)) as string;
        })();
        work.catch(() => {}); // 输了竞速后窗口被销毁，它随后的报错没人接，吞掉免得变成未处理的拒绝
        const raw = await Promise.race([work, new Promise<null>((r) => setTimeout(() => r(null), PAGE_TIMEOUT_MS))]);
        if (!raw) {
            console.warn(`[gallery] 渲染收集超时 ${url}`);
            destroyRenderWin(win); // 超时的窗口状态不明，下次重建
            return { ok: false, error: { kind: "gallery", code: "fetch" } };
        }
        const data = JSON.parse(raw) as {
            urls: string[];
            sizes: { src: string; w: number; h: number }[];
            nextUrl: string;
            title: string;
        };
        for (const it of data.sizes) {
            if (!it.src || it.w <= 0 || it.h <= 0) continue;
            const old = displaySizes.get(it.src);
            if (!old || it.w * it.h > old.w * old.h) displaySizes.set(it.src, { w: it.w, h: it.h });
        }
        console.log(`[gallery] 渲染收集 ${data.urls.length} 张（含显示尺寸 ${data.sizes.length}）← ${url}`);
        return {
            ok: true,
            data: {
                imageUrls: data.urls,
                nextUrl: data.nextUrl || null,
                title: cleanTitle(data.title || ""),
            },
        };
    } catch (e) {
        console.warn(`[gallery] 渲染收集失败 ${url}:`, e);
        destroyRenderWin(win);
        return { ok: false, error: { kind: "gallery", code: "fetch" } };
    } finally {
        // 成功时留着窗口给下一页复用；空闲到点自动销毁（失败路径已销毁，这里什么都不会留）
        if (renderWin === win) renderIdleTimer = setTimeout(() => destroyRenderWin(win), RENDER_IDLE_MS);
    }
}

/** 魔数嗅探真实格式：CDN 在 .jpg URL 下按 Chrome UA 内容协商回 webp 是常态，
 *  按 URL 扩展名定格式会让 mime 说谎，浏览器拒解码 → 无缩略图。认不出返回空串 */
function sniffFormat(buf: Buffer): string {
    if (buf.length >= 12) {
        if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
        if (
            buf[0] === 0x89 &&
            buf[1] === 0x50 &&
            buf[2] === 0x4e &&
            buf[3] === 0x47 &&
            buf[4] === 0x0d &&
            buf[5] === 0x0a &&
            buf[6] === 0x1a &&
            buf[7] === 0x0a
        )
            return "png";
        if (buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP")
            return "webp";
        if (buf.subarray(0, 3).toString("latin1") === "GIF") return "gif";
        if (buf.subarray(0, 2).toString("latin1") === "BM") return "bmp";
    }
    if (/^\s*(?:<\?xml[\s\S]{0,256}?<svg|<svg)/i.test(buf.subarray(0, 512).toString("latin1"))) return "svg";
    return "";
}

/** webp 尺寸解析：按 RIFF chunk 走到 VP8X / VP8 / VP8L 读画布尺寸。
 *  手工按位拼，避免 32 位位运算截断（VP8L 的字段跨 4 字节边界） */
function webpSize(buf: Buffer): { width: number; height: number } | null {
    let off = 12; // 跳过 RIFF 头 + WEBP 标识
    while (off + 8 <= buf.length) {
        const tag = buf.subarray(off, off + 4).toString("latin1");
        const size = buf.readUIntLE(off + 4, 3); // chunk 长度 3 字节 LE，块体按偶数对齐
        const body = off + 8;
        if (tag === "VP8X" && body + 10 <= buf.length) {
            return { width: 1 + buf.readUIntLE(body + 4, 3), height: 1 + buf.readUIntLE(body + 7, 3) };
        }
        if (
            tag === "VP8 " &&
            body + 10 <= buf.length &&
            buf[body + 3] === 0x9d &&
            buf[body + 4] === 0x01 &&
            buf[body + 5] === 0x2a
        ) {
            return { width: buf.readUInt16LE(body + 6) & 0x3fff, height: buf.readUInt16LE(body + 8) & 0x3fff };
        }
        if (tag === "VP8L" && body + 5 <= buf.length && buf[body] === 0x2f) {
            // 签名 0x2f 后是 LSB-first 位流：14bit 宽-1、14bit 高-1 依次打包（跨字节）
            const v = buf[body + 1] | (buf[body + 2] << 8) | (buf[body + 3] << 16) | (buf[body + 4] << 24);
            return { width: 1 + (v & 0x3fff), height: 1 + ((v >>> 14) & 0x3fff) };
        }
        off = body + size + (size % 2);
    }
    return null;
}

/** 读文件头取图片宽高（入库只要尺寸，不必把整张图解码）。按魔数嗅出的格式分派；
 *  svg 是矢量、读不出或文件截断的一律 0×0（前端按无尺寸处理）。
 *  已知取舍：JPEG 的 EXIF 方向不处理，竖拍照片存的是传感器的横向尺寸 */
function imageSize(buf: Buffer): { width: number; height: number } {
    const none = { width: 0, height: 0 };
    try {
        switch (sniffFormat(buf)) {
            case "jpg": {
                // 逐段扫到 SOF（帧头）：段 = 0xFF + 标记 + 2 字节长度。C4/C8/CC 不是 SOF 但落在同一区间
                let off = 2;
                while (off + 4 <= buf.length) {
                    if (buf[off] !== 0xff) {
                        off++;
                        continue;
                    }
                    const m = buf[off + 1];
                    if (m === 0xff) {
                        off++; // 填充字节
                    } else if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) {
                        off += 2; // 无长度的独立标记
                    } else if (m === 0xda) {
                        return none; // 到了图像数据还没见 SOF：坏文件
                    } else if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
                        return { height: buf.readUInt16BE(off + 5), width: buf.readUInt16BE(off + 7) };
                    } else {
                        off += 2 + buf.readUInt16BE(off + 2);
                    }
                }
                return none;
            }
            case "png":
                return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
            case "gif":
                return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
            case "bmp":
                // BMP 高度为负表示自上而下存储，取绝对值
                return { width: buf.readInt32LE(18), height: Math.abs(buf.readInt32LE(22)) };
            case "webp":
                return webpSize(buf) ?? none;
            default:
                return none;
        }
    } catch {
        return none; // 读越界 = 文件头被截断
    }
}

/** 简单并发池：结果保持输入顺序（个人工具不引 p-limit） */
async function pooled<T, R>(items: readonly T[], limit: number, job: (item: T) => Promise<R>): Promise<R[]> {
    const results = new Array<R>(items.length);
    let next = 0;
    async function worker(): Promise<void> {
        while (next < items.length) {
            const i = next++;
            results[i] = await job(items[i]);
        }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return results;
}

export async function downloadCandidates(
    input: GalleryDownloadInput,
): Promise<ApiResult<{ items: GalleryCandidate[] }>> {
    const items = await pooled(input.urls, input.concurrency, async (url): Promise<GalleryCandidate> => {
        try {
            const got = await downloadBytes(url, input.timeoutMs, input.referer, input.maxBytes);
            if (got === "fetch" || got === "too-large") return { ok: false, url, reason: got };
            const { buf, mime } = got;
            if (buf.length === 0) return { ok: false, url, reason: "not-image" };
            let pathname = "";
            try {
                pathname = new URL(url).pathname;
            } catch {
                /* schema 已保证 http(s) URL，走不到 */
            }
            const ext = normalizeExt(pathname);
            // 真实格式以魔数为准，认不出退 URL 扩展名再退 Content-Type（CDN 常回 octet-stream）
            const format =
                sniffFormat(buf) ||
                ((GALLERY_FORMATS as readonly string[]).includes(ext) ? ext : "") ||
                (MIME_TO_FORMAT[mime] ?? "");
            if (!format) return { ok: false, url, reason: "not-image" };
            // 尺寸读文件头（参与尺寸过滤的关键），不解码
            const size = imageSize(buf);
            // 显示尺寸合理性校验：盒子的宽高比与文件真实宽高比差 3 倍以上（如 467×24 对
            // 2505×1536）按未知处理——布局残迹逃过矮盒防线时在此兜底；真实 CSS 裁切
            // （方图网格等）落在宽容带内不受影响。文件尺寸未知（svg 等）时显示盒是唯一依据，照收
            const disp = displaySizes.get(url);
            let displayW = 0;
            let displayH = 0;
            if (disp && disp.w > 0 && disp.h > 0) {
                if (size.width > 0 && size.height > 0) {
                    const fileAspect = size.width / size.height;
                    const boxAspect = disp.w / disp.h;
                    if (boxAspect >= fileAspect * 0.3 && boxAspect <= fileAspect * 3) {
                        displayW = disp.w;
                        displayH = disp.h;
                    }
                } else {
                    displayW = disp.w;
                    displayH = disp.h;
                }
            }
            const inLibrary = shaExists(createHash("sha256").update(buf).digest("hex"));
            const n = ++stagingSeq;
            await writeFile(join(stagingDir(), `${n}.${format}`), buf);
            staged.set(n, { url, format, width: size.width, height: size.height });
            return {
                ok: true,
                index: n,
                url,
                format,
                width: size.width,
                height: size.height,
                bytes: buf.length,
                displayW,
                displayH,
                inLibrary,
            };
        } catch {
            return { ok: false, url, reason: "fetch" };
        }
    });
    return { ok: true, data: { items } };
}

/** 候选落库名：URL 末段（pathname 无 query）作文件名，无有效扩展名或为空时补格式扩展名；
 *  URL 扩展名与真实格式不符（.jpg URL 回 webp 字节）时换真实扩展名——磁盘名说谎会让
 *  系统看图程序认错。Windows 非法字符剔除、超长截断，撞名由 uniqueName 兜底 */
function nameFromUrl(url: string, format: string): string {
    let stem = "";
    try {
        stem = decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "");
    } catch {
        /* 编码异常走兜底名 */
    }
    stem = stem
        .replace(/[\\/:*?"<>|]/g, "")
        .replace(/\.+$/, "")
        .trim()
        .slice(0, 80);
    const ext = normalizeExt(stem);
    if ((GALLERY_FORMATS as readonly string[]).includes(ext)) {
        if (ext === format) return stem;
        return `${stem.slice(0, stem.length - extname(stem).length)}.${format}`;
    }
    return `${stem || "image"}.${format}`;
}

export async function importCandidates(input: GalleryImportCandidatesInput): Promise<ApiResult<GalleryImportStats>> {
    if (!getGroup(input.groupId)) return notFound;
    const folder = groupFolder(input.groupId);
    let imported = 0;
    let skipped = 0;
    for (const n of input.indices) {
        const rec = staged.get(n);
        if (!rec) {
            skipped++; // 编号不在当前会话（渲染端状态不一致）
            continue;
        }
        let buf: Buffer;
        try {
            buf = await readFile(join(stagingDir(), `${n}.${rec.format}`));
        } catch {
            skipped++; // 暂存文件丢失
            continue;
        }
        const sha = createHash("sha256").update(buf).digest("hex");
        if (shaExists(sha)) {
            skipped++; // 内容去重：同内容全库只收一份
            continue;
        }
        const original = nameFromUrl(rec.url, rec.format);
        const name = await writeNewFile(folder, original, buf);
        const saved = await saveImage(input.groupId, original, name, sha, buf, rec.url, {
            width: rec.width,
            height: rec.height,
        });
        if (saved) imported++;
        else skipped++;
    }
    return { ok: true, data: { imported, skipped } };
}

// ── 图片批量操作 ──

export function setImageTags(id: number, tags: string[]): ApiResult<null> {
    if (!stmtImageExists.get(id)) return notFound;
    const list = [...new Set(tags)];
    db.transaction(() => {
        db.prepare("DELETE FROM gallery_tags WHERE image_id = ?").run(id);
        const ins = db.prepare("INSERT INTO gallery_tags (image_id, tag) VALUES (?, ?)");
        for (const t of list) ins.run(id, t);
    })();
    return { ok: true, data: null };
}

/** 批量给多张图添加标签（并集幂等）：表主键 (image_id, tag) 让 INSERT OR IGNORE 天然
 *  去重；一个事务一次往返（取代渲染端对每张图 N 次串行调用的旧法）。
 *  行已不存在的 id 静默跳过（同 wallAddInner：渲染端列表过期不炸） */
export function addTagsToImages(ids: number[], tags: string[]): ApiResult<null> {
    const list = [...new Set(tags)];
    const ins = db.prepare("INSERT OR IGNORE INTO gallery_tags (image_id, tag) VALUES (?, ?)");
    db.transaction(() => {
        for (const id of ids) {
            if (!stmtImageExists.get(id)) continue;
            for (const t of list) ins.run(id, t);
        }
    })();
    return { ok: true, data: null };
}

/** 词级删除：从所有图片上移除某个标签（侧栏 chips 右键入口，影响全库，
 *  渲染端配确认框）。没有图片再用它后，标签池自动收缩 */
export function deleteTag(tag: string): ApiResult<null> {
    db.prepare("DELETE FROM gallery_tags WHERE tag = ?").run(tag);
    return { ok: true, data: null };
}

/** 移动分组：行改 group_id 之外，文件也要从原组文件夹 rename 进目标组文件夹（含缩略图
 *  无需动——按 id 寻址）。目标相对路径经 uniqueName 避让目标组已有文件；逐行处理不包
 *  大事务——先物理 rename 再改行（同 renameGroup 的顺序约定），rename 被占用等暂时性
 *  失败则跳过该行（图留在原组，可重试），源文件确实没了（ENOENT）照常改行（404 兜底） */
export async function moveImages(ids: number[], groupId: number): Promise<ApiResult<null>> {
    if (!getGroup(groupId)) return notFound;
    const folder = groupFolder(groupId);
    const selFile = db.prepare("SELECT file FROM gallery_images WHERE id = ?");
    const upd = db.prepare("UPDATE gallery_images SET group_id = ?, file = ? WHERE id = ?");
    for (const id of ids) {
        const row = selFile.get(id) as { file: string } | undefined;
        if (!row) continue;
        const rel = uniqueName(folder, row.file.slice(row.file.indexOf("/") + 1));
        try {
            await rename(join(galleryDir(), row.file), join(galleryDir(), rel));
        } catch (e) {
            if ((e as NodeJS.ErrnoException).code !== "ENOENT") continue;
        }
        upd.run(groupId, rel, id);
    }
    return { ok: true, data: null };
}

const stmtImageForDelete = db.prepare("SELECT id, file, format FROM gallery_images WHERE id = ?");
const stmtDeleteImage = db.prepare("DELETE FROM gallery_images WHERE id = ?");

export async function deleteImages(ids: number[]): Promise<ApiResult<null>> {
    // 同 deleteGroup 的顺序约定：行删了就再也找不到磁盘上的图，先在事务里收集清单并删行，
    // 文件 IO 放事务外（不占事务持锁时间，也不卡主进程）
    const files: { id: number; file: string; format: string }[] = [];
    db.transaction(() => {
        for (const id of ids) {
            const row = stmtImageForDelete.get(id) as { id: number; file: string; format: string } | undefined;
            if (!row) continue;
            files.push(row);
            stmtDeleteImage.run(id);
        }
    })();
    for (const f of files) await removeImageFiles(f.id, f.file, f.format);
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

/** 原生多选文件框（图库导入入口）；取消返回 []。过滤名只用扩展名串，主进程不引入界面文案（见 pickFile 先例）。
 *  withNativeDialog 抑制主窗口失焦自动隐藏（见 util/nativeDialog.ts） */
export async function pickFiles(): Promise<ApiResult<string[]>> {
    const r = await withNativeDialog(() =>
        dialog.showOpenDialog({
            properties: ["openFile", "multiSelections"],
            filters: [{ name: GALLERY_FORMATS.join(";"), extensions: [...GALLERY_FORMATS] }],
        }),
    );
    return { ok: true, data: r.canceled ? [] : r.filePaths };
}

// ── mpimg:// 协议取字节（注册见 src/main/app.ts）──

function thumbPath(id: number, format: string): string {
    return join(thumbsDir(), format === "jpg" ? `${id}.jpg` : `${id}.png`);
}

/** 协议处理器入口：按 id 取原图或缩略图字节；行不存在/文件读不到返回 null（→ 404）。
 *  thumb 只读现成文件，没有就 null：缩略图由渲染端 Worker 生成并经 gallerySaveThumb 落盘，
 *  主进程不解码，也不回退成原图（原图动辄数 MB，网格里全回原图会拖垮内存）。
 *  svg 是矢量，thumb 直接回原图 */
export async function serveImage(kind: "orig" | "thumb", id: number): Promise<{ buf: Buffer; mime: string } | null> {
    const row = db.prepare("SELECT file, format FROM gallery_images WHERE id = ?").get(id) as
        { file: string; format: string } | undefined;
    if (!row) return null;
    try {
        if (kind === "thumb" && row.format !== "svg") {
            return { buf: await readFile(thumbPath(id, row.format)), mime: row.format === "jpg" ? MIME.jpg : MIME.png };
        }
        return { buf: await readFile(join(galleryDir(), row.file)), mime: MIME[row.format] ?? MIME.jpg };
    } catch {
        return null; // 缩略图还没生成 / 磁盘文件被外部删除等：404
    }
}

/** mpimg://cand/<n>：网址导入候选，直接回暂存的原图（对话框是临时的，不值得再生成缩略图）；
 *  编号不在会话里/文件没了返回 null（→ 404） */
export async function serveCandidate(n: number): Promise<{ buf: Buffer; mime: string } | null> {
    const rec = staged.get(n);
    if (!rec) return null;
    try {
        return { buf: await readFile(join(stagingDir(), `${n}.${rec.format}`)), mime: MIME[rec.format] ?? MIME.jpg };
    } catch {
        return null;
    }
}

/** 渲染端 Worker 生成的缩略图字节落盘（文件名规则同 thumbPath：jpg 存 .jpg，其余 .png）。
 *  svg 不生成缩略图，拒绝；行不存在回 not-found */
export async function saveThumb(id: number, bytes: Uint8Array): Promise<ApiResult<null>> {
    const row = db.prepare("SELECT format FROM gallery_images WHERE id = ?").get(id) as { format: string } | undefined;
    if (!row) return notFound;
    if (row.format === "svg") return badRequest;
    try {
        await writeFile(thumbPath(id, row.format), bytes);
    } catch (e) {
        return { ok: false, error: { kind: "failed", path: String(e) } };
    }
    return { ok: true, data: null };
}

/** 工具打开/刷新时一次取全侧栏需要的数据（分组、标签池、是否设密码、画廊计数），
 *  省掉四次 IPC 往返；各部分沿用原接口的口径（锁定视角过滤等） */
export function overview(password?: string): ApiResult<GalleryOverview> {
    const groups = listGroups(password);
    const tags = allTags();
    const has = passwordState();
    const wall = wallCount(password);
    if (!groups.ok) return groups;
    if (!tags.ok) return tags;
    if (!has.ok) return has;
    if (!wall.ok) return wall;
    return {
        ok: true,
        data: { groups: groups.data, tags: tags.data, hasPassword: has.data.has, wallCount: wall.data.count },
    };
}
