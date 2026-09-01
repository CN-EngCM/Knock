import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import { BrowserWindow, clipboard, dialog, nativeImage, shell } from "electron";
import type { NativeImage } from "electron";
import db from "./db";
import { dataDir } from "./util/dataDir";
import { GALLERY_NAME } from "./util/dataLocation";
import { getSetting, setSetting } from "./util/settings";
import {
    GALLERY_FORMATS,
    type GalleryCandidate,
    type GalleryDownloadInput,
    type GalleryGroup,
    type GalleryImage,
    type GalleryImportCandidatesInput,
    type GalleryImportStats,
    type GalleryPageResult,
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

/** 落盘 + 落库（import 与 paste 共用的收尾路径）；buf 已经过 hash 去重判定。
 *  size 由「已探过尺寸的调用方」（网址导入候选）传入免二次解码；缺省现读 */
function saveImage(
    groupId: number,
    title: string,
    file: string,
    sha: string,
    buf: Buffer,
    sourcePath: string,
    size?: { width: number; height: number },
): void {
    // svg / 解不动的图存 0×0，前端按无尺寸处理
    let s = size;
    if (!s) {
        const img = nativeImage.createFromPath(join(galleryDir(), file));
        s = img.isEmpty() ? { width: 0, height: 0 } : img.getSize();
    }
    db.prepare(
        "INSERT INTO gallery_images (group_id, title, file, sha256, bytes, width, height, format, source_path, created_at) " +
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(groupId, title, file, sha, buf.length, s.width, s.height, normalizeExt(file), sourcePath, Date.now());
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

// ── 从网址导入 ──
// 三段式 RPC（开始/抓页+下载/入库）由渲染端驱动：主进程只维护一个暂存会话——
// 候选字节落 os.tmpdir() 固定子目录（编号命名），确认入库才进 gallery/ 目录，
// 关闭/取消由渲染端调 collectDiscard 清场，异常残留等下次 collectStart 兜底清。

const STAGING_NAME = "knock-gallery-candidates";
const PAGE_TIMEOUT_MS = 15000;
// 伪装常规浏览器 UA：不少站点对非浏览器 UA 直接 403（favicon 取器名会被拦）
const BROWSER_UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const PAGE_ACCEPT = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
const IMAGE_ACCEPT = "image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8";

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

export function collectStart(): ApiResult<null> {
    wipeStaging();
    return { ok: true, data: null };
}

export function collectDiscard(): ApiResult<null> {
    wipeStaging();
    return { ok: true, data: null };
}

/** 带超时与防盗链头的 GET（超时模式抄 favicon.ts：AbortController + finally 清定时器）。
 *  Accept 区分页面/图片：CDN 按 Accept 做内容协商，图片请求带浏览器式的值才拿得到一致变体 */
async function fetchWithTimeout(url: string, timeoutMs: number, referer: string, accept: string): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, {
            signal: controller.signal,
            redirect: "follow",
            headers: { "user-agent": BROWSER_UA, accept, ...(referer ? { referer } : {}) },
        });
    } finally {
        clearTimeout(timer);
    }
}

// ── 页面解析（正则实现，不引 HTML 解析库：覆盖 <img>/srcset/懒加载/直链 <a> 够用）──

const IMG_EXT_RE = /\.(?:jpe?g|png|gif|webp|bmp|svg)(?:$|[?#])/i;
// 词与箭头可组合（「下一页 ›」「next →」都是常见写法），也认单箭头锚文本
const NEXT_TEXT_RE = /^(?:(?:下一页|下页|后一页|next page|next)\s*[›»→]?|[›»→])$/i;

/** 取标签属性值：覆盖双引号/单引号/裸值三种形态，并解码常见实体——
 *  src 里的「?a=1&amp;b=2」若保留 &amp;，与 DOM 侧 img.src 的「&」不一致，
 *  显示尺寸表就永远配不上对。名字前锚定空白，防「src=」误中「data-src=」的尾巴 */
function attrValue(tag: string, name: string): string | null {
    const m = new RegExp(`(?:^|\\s)${name}(?:\\s*=\\s*)(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
    const v = m ? (m[1] ?? m[2] ?? m[3] ?? null) : null;
    if (v == null) return null;
    return v.replace(/&(amp|lt|gt|quot|#39);/g, (_, e: string) =>
        e === "amp" ? "&" : e === "lt" ? "<" : e === "gt" ? ">" : e === "quot" ? '"' : "'",
    );
}

function resolveUrl(href: string, base: string): string | null {
    try {
        const u = new URL(href, base);
        return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
    } catch {
        return null;
    }
}

/** 页面里的图片地址（绝对化 + 去重，按出现顺序）：
 *  <img> 的 src / srcset / data-src / data-original（懒加载占位），外加 <a href> 指向图片扩展名 */
function collectImageUrls(html: string, base: string): string[] {
    const out = new Set<string>();
    for (const tag of html.match(/<img\b[^>]*>/gi) ?? []) {
        for (const attr of ["src", "data-src", "data-original"]) {
            const v = attrValue(tag, attr);
            if (v) {
                const abs = resolveUrl(v, base);
                if (abs) out.add(abs);
            }
        }
        // srcset：逗号分隔的「URL 描述」列表，每段取第一个空白前的 URL（多档分辨率全收，下载后按尺寸筛）
        const ss = attrValue(tag, "srcset");
        if (ss) {
            for (const part of ss.split(",")) {
                const u = part.trim().split(/\s+/)[0];
                if (u) {
                    const abs = resolveUrl(u, base);
                    if (abs) out.add(abs);
                }
            }
        }
    }
    for (const m of html.matchAll(/<a\b[^>]*>/gi)) {
        const href = attrValue(m[0], "href");
        if (href && IMG_EXT_RE.test(href)) {
            const abs = resolveUrl(href, base);
            if (abs) out.add(abs);
        }
    }
    return [...out];
}

/** 「下一页」链接：rel=next（link/a）优先，其次锚文本整体匹配常见字样（去内嵌标签，
 *  防正文里出现「下一页」三个字误中）。只认同 host 目标——跨 host 的多半是推荐位/广告 */
function findNextUrl(html: string, base: string): string | null {
    const sameHost = (href: string): string | null => {
        try {
            const u = new URL(href, base);
            if ((u.protocol !== "http:" && u.protocol !== "https:") || u.host !== new URL(base).host) return null;
            return u.href;
        } catch {
            return null;
        }
    };
    for (const m of html.matchAll(/<(?:link|a)\b[^>]*>/gi)) {
        const rel = attrValue(m[0], "rel");
        if (rel && rel.split(/\s+/).some((v) => v.toLowerCase() === "next")) {
            const href = attrValue(m[0], "href");
            if (href) {
                const abs = sameHost(href);
                if (abs) return abs;
            }
        }
    }
    for (const m of html.matchAll(/<a\b[^>]*href\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)[^>]*>([\s\S]*?)<\/a>/gi)) {
        const text = (m[1] ?? "")
            .replace(/<[^>]*>/g, "")
            .replace(/\s+/g, " ")
            .trim()
            .toLowerCase();
        if (!NEXT_TEXT_RE.test(text)) continue;
        const href = attrValue(m[0], "href");
        if (href) {
            const abs = sameHost(href);
            if (abs) return abs;
        }
    }
    return null;
}

/** <title> 文本：去内嵌标签、压空白、解码常见实体，截断 50（对齐分组名 schema 上限）；
 *  网址导入单独成组的组名首选 */
function pageTitle(html: string): string | null {
    const m = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
    if (!m) return null;
    const s = m[1]
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

export async function fetchPage(url: string): Promise<ApiResult<GalleryPageResult>> {
    let html = "";
    try {
        const res = await fetchWithTimeout(url, PAGE_TIMEOUT_MS, "", PAGE_ACCEPT);
        if (!res.ok) return { ok: false, error: { kind: "gallery", code: "fetch" } };
        const mime = res.headers.get("content-type") ?? "";
        // 直链兼容：URL 本身就是图片 → 单张候选，无翻页语义
        if (mime.startsWith("image/"))
            return { ok: true, data: { imageUrls: [res.url], nextUrl: null, isImage: true, title: null } };
        if (!/text\/html|application\/xhtml/.test(mime)) {
            return { ok: false, error: { kind: "gallery", code: "fetch" } };
        }
        html = await res.text();
        // res.url 是重定向后的最终地址，相对路径以它为基准
        return {
            ok: true,
            data: {
                imageUrls: collectImageUrls(html, res.url),
                nextUrl: findNextUrl(html, res.url),
                isImage: false,
                title: pageTitle(html),
            },
        };
    } catch {
        return { ok: false, error: { kind: "gallery", code: "fetch" } };
    }
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

/** 隐藏窗口渲染页面，读每个图片 URL 在页面上的**实际显示尺寸**（CSS 布局结果，
 *  静态解析拿不到），结果并进会话 displaySizes。约定：
 *  - 图片允许真实加载（实测教训：images:false 下进入懒加载视口的图会「尝试加载→失败」
 *    进入破损态，渲染成 alt 文本行盒——buondua 页面前 7 张量出 467×24 即此）。开加载后：
 *    进视口的图按真实内在尺寸布局（= 真实浏览器），远处懒图不下载、按 width/height 属性
 *    撑盒（属性即网站声明的显示意图），两者都正确；带宽代价只有视口附近的少量图。
 *  - 未加载图的高度若仍是属性原值而宽度被 CSS 改过，按属性纵横比折算（未加载图高度不缩）。
 *  - 矮盒（h<60）一律按未知丢弃：图标、真细横条、以及任何布局残迹。
 *  - <img> 的 srcset 各档共享同一布局盒（正则侧收全档候选，currentSrc 只选一档，
 *    不补齐则其余档永远配不上显示尺寸）；全部绝对化后再当键。
 *  - <a> 包着的 <img>：缩略图的显示尺寸归给链接目标（大图直链的「显示尺寸」就是它缩略图的）。
 *  - 同一 URL 出现多处取最大显示尺寸（既是缩略图又是正文大图 = 算显示过大的）。
 *  - 页面脚本真实执行：nodeIntegration 关、弹窗全拦，用完即销毁；失败/超时静默降级
 *    （结果写主进程控制台，pnpm dev 终端可排查）。 */
export async function pageDisplaySizes(url: string): Promise<ApiResult<null>> {
    const win = new BrowserWindow({
        show: false,
        width: 1280,
        height: 900,
        webPreferences: { nodeIntegration: false, contextIsolation: true },
    });
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" })); // 页面脚本不得借隐藏窗口弹任何窗
    try {
        // 整段（加载 + 布局稳定 + DOM 采集）统一 15s 上限：页面挂死不泄漏窗口，输了的 Promise 由 race 吞掉
        const raw = await Promise.race([
            (async () => {
                await win.loadURL(url, { userAgent: BROWSER_UA });
                await new Promise((r) => setTimeout(r, 1200)); // 等 JS/字体与视口附近的图片布局稳定
                return (await win.webContents.executeJavaScript(`JSON.stringify((() => {
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
                    return [
                        ...Array.from(document.images).flatMap((img) => {
                            const b = box(img);
                            if (!b) return [];
                            // currentSrc/src 已是绝对地址；srcset 原始值需按 baseURI 绝对化
                            const srcs = new Set([img.currentSrc || img.src]);
                            for (const p of (img.getAttribute("srcset") || "").split(",")) {
                                const u = p.trim().split(/\\s+/)[0];
                                if (u) srcs.add(u);
                            }
                            return Array.from(srcs, (src) => {
                                try { return { src: new URL(src, document.baseURI).href, w: b.w, h: b.h }; }
                                catch { return { src: "", w: b.w, h: b.h }; }
                            });
                        }),
                        ...Array.from(document.links).flatMap((a) =>
                            Array.from(a.querySelectorAll("img"), (img) => {
                                const b = box(img);
                                return b ? [{ src: a.href, w: b.w, h: b.h }] : [];
                            }),
                        ),
                    ];
                })())`)) as string;
            })(),
            new Promise<string>((r) => setTimeout(() => r("[]"), PAGE_TIMEOUT_MS)),
        ]);
        let added = 0;
        for (const it of JSON.parse(raw) as { src: string; w: number; h: number }[]) {
            if (!it.src || it.w <= 0 || it.h <= 0) continue;
            const old = displaySizes.get(it.src);
            if (!old || it.w * it.h > old.w * old.h) {
                displaySizes.set(it.src, { w: it.w, h: it.h });
                added++;
            }
        }
        console.log(`[gallery] 显示尺寸 ${added} 条 ← ${url}`);
    } catch (e) {
        console.warn(`[gallery] 显示尺寸渲染失败（降级为未知） ${url}:`, e);
    } finally {
        win.destroy();
    }
    return { ok: true, data: null };
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

/** webp 尺寸解析（nativeImage 解不了 webp）：按 RIFF chunk 走到 VP8X / VP8 / VP8L 读画布尺寸。
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
            const res = await fetchWithTimeout(url, input.timeoutMs, input.referer, IMAGE_ACCEPT);
            if (!res.ok) return { ok: false, url, reason: "fetch" };
            const buf = Buffer.from(await res.arrayBuffer());
            if (buf.length === 0) return { ok: false, url, reason: "not-image" };
            if (buf.length > input.maxBytes) return { ok: false, url, reason: "too-large" };
            const mime = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
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
            // 尺寸优先走 Electron 解码器；webp 解不了用头解析兜底（参与尺寸过滤的关键）
            const img = nativeImage.createFromBuffer(buf);
            let size = { width: 0, height: 0 };
            if (!img.isEmpty()) size = img.getSize();
            else if (format === "webp") size = webpSize(buf) ?? size;
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
            writeFileSync(join(stagingDir(), `${n}.${format}`), buf);
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

export function importCandidates(input: GalleryImportCandidatesInput): ApiResult<GalleryImportStats> {
    if (!getGroup(input.groupId)) return notFound;
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
            buf = readFileSync(join(stagingDir(), `${n}.${rec.format}`));
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
        const name = uniqueName(original);
        writeFileSync(join(galleryDir(), name), buf);
        saveImage(input.groupId, original, name, sha, buf, rec.url, {
            width: rec.width,
            height: rec.height,
        });
        imported++;
    }
    return { ok: true, data: { imported, skipped } };
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

/** 词级删除：从所有图片上移除某个标签（侧栏 chips 右键入口，影响全库，
 *  渲染端配确认框）。没有图片再用它后，标签池自动收缩 */
export function deleteTag(tag: string): ApiResult<null> {
    db.prepare("DELETE FROM gallery_tags WHERE tag = ?").run(tag);
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

/** 长边压到 THUMB_EDGE 等比（不足阈值的不放大，放大不增信息量）：jpg 存 JPEG(85)、
 *  其余存 PNG 保透明（gif 取首帧）。库内图与网址导入候选用同一份缩图规则 */
function shrink(img: NativeImage, format: string): Buffer {
    const { width, height } = img.getSize();
    const long = Math.max(width, height);
    const thumb =
        long > THUMB_EDGE
            ? img.resize({
                  width: Math.round((width * THUMB_EDGE) / long),
                  height: Math.round((height * THUMB_EDGE) / long),
              })
            : img;
    return format === "jpg" ? thumb.toJPEG(85) : thumb.toPNG();
}

/** 按需生成缩略图：源解不动（isEmpty）返回 null，调用方回退原图字节。
 *  已知取舍：nativeImage 对 jpg 的 EXIF 方向不保证与 <img> 一致，个别竖拍照片缩略图
 *  方向可能不一致——个人工具接受，不值得为此引入完整解码器。 */
function makeThumb(id: number, format: string, origPath: string): { buf: Buffer; mime: string } | null {
    const img = nativeImage.createFromPath(origPath);
    if (img.isEmpty()) return null;
    const out = shrink(img, format);
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

/** mpimg://cand/<n>：网址导入候选的缩略图（与库内图同款按需生成策略，
 *  缩略图落暂存目录 <n>.t.(jpg|png)，会话清场一并删）；行不存在返回 null（→ 404） */
export function serveCandidate(n: number): { buf: Buffer; mime: string } | null {
    const rec = staged.get(n);
    if (!rec) return null;
    const origPath = join(stagingDir(), `${n}.${rec.format}`);
    try {
        if (rec.format === "svg") return { buf: readFileSync(origPath), mime: MIME.svg };
        const thumbPath = join(stagingDir(), rec.format === "jpg" ? `${n}.t.jpg` : `${n}.t.png`);
        try {
            return { buf: readFileSync(thumbPath), mime: rec.format === "jpg" ? MIME.jpg : MIME.png };
        } catch {
            // 还没生成过：现生成（源解不动回退原图字节）
            const img = nativeImage.createFromPath(origPath);
            if (img.isEmpty()) return { buf: readFileSync(origPath), mime: MIME[rec.format] ?? MIME.jpg };
            const out = shrink(img, rec.format);
            try {
                writeFileSync(thumbPath, out);
            } catch {
                /* 落盘失败不影响本次返回，下次再生成 */
            }
            return { buf: out, mime: rec.format === "jpg" ? MIME.jpg : MIME.png };
        }
    } catch {
        return null;
    }
}
