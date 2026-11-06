import {
    cpSync,
    existsSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    renameSync,
    rmSync,
    statSync,
    writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

// ── 数据目录指针（数据目录的唯一事实来源）──
// 默认根下固定放一个 data-location.json，内容是当前数据目录的绝对路径：
//   无指针 = 从未启动过（首次引导一生只弹一次的依据——选默认也写指针）；
//   有指针 = 数据就在指针指向的目录。
// 本模块必须保持纯 fs：禁止 import db / dataDir——dataDir 要读指针并兜底默认根，
// 而 db 在 import 链上同步开库，反向依赖会把开库时机拖回模块求值期，
// 启动引导（src/main/dataBoot.ts）就再也没机会在开库前弹对话框了。

/** 业务数据文件名：db 主库 / WAL / SHM、图标缓存目录、图库目录与 Chrome 专用 profile，迁移与清理都围绕它们 */
export const DB_NAME = "mypage.db";
export const FAVICONS_NAME = "favicons";
export const GALLERY_NAME = "gallery";
// 便签图片目录（server/notes.ts）
export const NOTES_NAME = "notes";
// 受限站登录态（专用 Chrome 实例的持久 profile，见 server/chromeLogin.ts）
export const CHROME_PROFILE_NAME = "chrome-profile";
// Chromium 会话数据（缓存、cookie、localStorage 和网页分区），经 app.setPath("sessionData") 收进数据目录
export const BROWSER_DATA_NAME = "browser-data";

// 旧版本把 Chromium 的这些文件直接散在默认根里；新版第一次启动时一次性搬进 browser-data。
// 清单是写死的名字：Local State、锁文件、指针不在其内，它们必须留在默认根
const LEGACY_CHROMIUM_NAMES = [
    "Cache",
    "Code Cache",
    "GPUCache",
    "DawnGraphiteCache",
    "DawnWebGPUCache",
    "Shared Dictionary",
    "blob_storage",
    "Local Storage",
    "Session Storage",
    "IndexedDB",
    "Service Worker",
    "WebStorage",
    "SharedStorage",
    "SharedStorage-wal",
    "Network",
    "Partitions",
    "Dictionaries",
    "DIPS",
    "DIPS-wal",
];

const POINTER_NAME = "data-location.json";

// 平台应用数据基点（原 dataDir() 的平台分支）：新旧两个数据根共用
function appDataBase(): string {
    if (process.platform === "win32") return process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
    if (process.platform === "darwin") return join(homedir(), "Library", "Application Support");
    return process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
}

/** 默认数据根：与 Electron userData 同目录（Knock）。Chromium 缓存与业务数据
 *  井水不犯河水——本模块只认具名文件（db / favicons / 指针），其余一概不碰 */
export function defaultDataRoot(): string {
    return join(appDataBase(), "Knock");
}

/** 旧默认数据根（项目早期目录名 MyPage）：仅供一次性升级迁移判定，新代码勿引用 */
export function legacyDataRoot(): string {
    return join(appDataBase(), "MyPage");
}

export function pointerPath(): string {
    return join(defaultDataRoot(), POINTER_NAME);
}

function readPointerAt(file: string): string | null {
    try {
        const raw = JSON.parse(readFileSync(file, "utf8")) as { dir?: unknown };
        return typeof raw?.dir === "string" && raw.dir ? raw.dir : null;
    } catch {
        return null;
    }
}

/** 读指针：缺失 / 损坏一律返回 null（视同「从未启动」，下次启动走首次引导） */
export function readPointer(): string | null {
    return readPointerAt(pointerPath());
}

/** 旧根处的指针（中间版本可能写过）：升级迁移时原样搬到新根或随旧数据清理 */
function legacyPointerPath(): string {
    return join(legacyDataRoot(), POINTER_NAME);
}

/** 写指针（只在引导 / 迁移的成功路径上调用）；默认根必须存在才能放下指针文件。
 *  moveFrom 只在改数据目录时传：旧目录里的 browser-data 与 chrome-profile 此刻被进程占着搬不动，
 *  记下来，等下次启动在 Chromium 起来之前搬（见 settleBrowserData） */
export function writePointer(dir: string, moveFrom?: string): void {
    mkdirSync(defaultDataRoot(), { recursive: true });
    writeFileSync(pointerPath(), JSON.stringify(moveFrom ? { dir, moveFrom } : { dir }));
}

/** 指针里记的「待搬来源目录」；没有或损坏返回 null */
function readMoveFrom(): string | null {
    try {
        const raw = JSON.parse(readFileSync(pointerPath(), "utf8")) as { moveFrom?: unknown };
        return typeof raw?.moveFrom === "string" && raw.moveFrom ? raw.moveFrom : null;
    } catch {
        return null;
    }
}

/** 路径等同判断：resolve 归一化后比较；Windows 文件系统大小写不敏感，一并折掉 */
export function samePath(a: string, b: string): boolean {
    const norm = (p: string) => {
        const r = resolve(p);
        return process.platform === "win32" ? r.toLowerCase() : r;
    };
    return norm(a) === norm(b);
}

/**
 * 新数据目录的准入校验：「空或不存在」。
 * 目标 = 默认根时容忍指针文件本身——恢复默认时指针一定已在那里。
 * 目录读不了（权限等）按不可用处理。
 */
export function targetIsEmpty(dir: string): boolean {
    if (!existsSync(dir)) return true;
    let entries: string[];
    try {
        entries = readdirSync(dir);
    } catch {
        return false;
    }
    const toleratePointer = samePath(dir, defaultDataRoot());
    return entries.filter((e) => !(toleratePointer && e === POINTER_NAME)).length === 0;
}

/**
 * changeDataDir 的目标准入：自定义目录严格沿用 targetIsEmpty；默认根例外——
 * 只要求里面没有旧 mypage.db。默认根常混有 Electron 历史版本留下的
 * Cache / Preferences 等杂项（与具名数据文件互不相干），若同样按非空拒绝，
 * 「恢复默认」在这类机器上将永远失败。
 */
export function canAcceptAsDataDir(dir: string): boolean {
    if (samePath(dir, defaultDataRoot())) return !existsSync(join(dir, DB_NAME));
    return targetIsEmpty(dir);
}

/**
 * 目录间的整体搬迁（纯 fs，调用方保证此刻 db 尚未打开或已关闭）：
 * 复制 db+wal+shm+favicons → 校验文件齐全且 db 大小一致 → 写指针 → 删源目录处的
 * 旧数据（只删具名文件）。任何一步失败抛异常，由调用方清理残留并兜底。
 */
export function migrateDataFiles(from: string, target: string): void {
    const dbFiles: [string, string][] = [];
    for (const name of [DB_NAME, `${DB_NAME}-wal`, `${DB_NAME}-shm`]) {
        const src = join(from, name);
        if (existsSync(src)) dbFiles.push([src, join(target, name)]);
    }
    const faviconsSrc = join(from, FAVICONS_NAME);
    const hasFavicons = existsSync(faviconsSrc);
    const gallerySrc = join(from, GALLERY_NAME);
    const hasGallery = existsSync(gallerySrc);
    const notesSrc = join(from, NOTES_NAME);
    const hasNotes = existsSync(notesSrc);
    const chromeSrc = join(from, CHROME_PROFILE_NAME);
    const hasChrome = existsSync(chromeSrc);

    mkdirSync(target, { recursive: true });
    for (const [src, dst] of dbFiles) cpSync(src, dst);
    if (hasFavicons) cpSync(faviconsSrc, join(target, FAVICONS_NAME), { recursive: true });
    if (hasGallery) cpSync(gallerySrc, join(target, GALLERY_NAME), { recursive: true });
    if (hasNotes) cpSync(notesSrc, join(target, NOTES_NAME), { recursive: true });
    if (hasChrome) cpSync(chromeSrc, join(target, CHROME_PROFILE_NAME), { recursive: true });

    // 校验：复制的文件齐全，且主库大小与源一致（不一致 = 复制中途出错，库不完整）
    for (const [, dst] of dbFiles) {
        if (!existsSync(dst)) throw new Error(`copy missing: ${dst}`);
    }
    if (statSync(join(from, DB_NAME)).size !== statSync(join(target, DB_NAME)).size) {
        throw new Error("db size mismatch after copy");
    }

    writePointer(target);

    // 删源目录处的旧数据；只删具名文件，指针文件与其他内容不受影响
    removeDbArtifacts(from);
}

/**
 * 一次性升级：默认根从旧名 MyPage 改为 Knock（只在新指针不存在时介入）。
 *   旧指针指向自定义目录 → 数据不在默认根，指针原样搬到新位置；
 *   旧根有库 → 整体迁到新默认根（删旧根具名数据，Chromium 杂项不动）；
 *   迁移失败 → 指针指回旧根兜底（数据原地可用），下次启动重试；
 *   两边都无数据 → 返回 false，交给首次引导。
 */
export function upgradeLegacyData(): boolean {
    if (existsSync(pointerPath())) return true;
    const legacy = legacyDataRoot();
    const old = readPointerAt(legacyPointerPath());
    if (old && !samePath(old, legacy)) {
        writePointer(old);
        rmSync(legacyPointerPath(), { force: true });
        return true;
    }
    if (existsSync(join(legacy, DB_NAME))) {
        try {
            migrateDataFiles(legacy, defaultDataRoot());
            rmSync(legacyPointerPath(), { force: true });
        } catch (e) {
            console.error("[dataLocation] legacy upgrade failed, stay on legacy root:", e);
            // 清掉本次搬到新根的残留再兜底指回旧根，避免下次「恢复默认」被半成品挡住
            try {
                removeDbArtifacts(defaultDataRoot());
            } catch {
                /* 清理失败只剩垃圾文件，不挡兜底 */
            }
            writePointer(legacy);
        }
        return true;
    }
    return false;
}

/** 搬一个文件或目录：同盘直接改名；跨盘（改名报错）退回复制再删。
 *  复制中途失败要清掉不完整的目标，源保持原样，由调用方记日志 */
function moveEntry(src: string, dst: string): void {
    try {
        renameSync(src, dst);
        return;
    } catch {
        /* 跨盘或被占用：走复制 */
    }
    try {
        cpSync(src, dst, { recursive: true });
    } catch (e) {
        rmSync(dst, { recursive: true, force: true });
        throw e;
    }
    rmSync(src, { recursive: true, force: true });
}

/**
 * 启动最早期调用（app ready 之前，此刻本进程还没有 Chromium 存储占着文件）：
 *  1. 改数据目录后的待搬：把旧目录的 browser-data 与 chrome-profile 搬进新目录，之后清掉指针里的标记
 *     （不管搬没搬成都清，不反复重试；搬失败只写日志，网页数据从空开始）；
 *  2. 否则若 browser-data 还不存在：把旧版本散在默认根里的 Chromium 文件搬进来。
 * 返回 browser-data 的路径，调用方拿去 app.setPath("sessionData")。
 * 本模块保持纯 fs，所以 setPath 留给 index.ts。
 */
export function settleBrowserData(dir: string): string {
    const target = join(dir, BROWSER_DATA_NAME);
    const from = readMoveFrom();
    if (from) {
        if (!samePath(from, dir)) {
            for (const name of [BROWSER_DATA_NAME, CHROME_PROFILE_NAME]) {
                const src = join(from, name);
                const dst = join(dir, name);
                // 目标已有数据时不覆盖：宁可旧的留着，也不把新的冲掉
                if (!existsSync(src) || existsSync(dst)) continue;
                try {
                    moveEntry(src, dst);
                } catch (e) {
                    console.error(`[dataLocation] move ${name} failed:`, e);
                }
            }
        }
        writePointer(dir);
    } else if (!existsSync(target)) {
        mkdirSync(target, { recursive: true });
        const root = defaultDataRoot();
        for (const name of LEGACY_CHROMIUM_NAMES) {
            const src = join(root, name);
            if (!existsSync(src)) continue;
            try {
                moveEntry(src, join(target, name));
            } catch (e) {
                console.error(`[dataLocation] adopt ${name} failed:`, e);
            }
        }
    }
    mkdirSync(target, { recursive: true });
    return target;
}

/** 删某目录下的库文件、图标缓存、图库与便签图片（只删具名路径，目录里其他东西一概不碰）。
 *  不含 chrome-profile 与 browser-data：改数据目录时它们要留给下次启动搬走 */
export function removeDataFiles(dir: string): void {
    for (const name of [DB_NAME, `${DB_NAME}-wal`, `${DB_NAME}-shm`]) {
        rmSync(join(dir, name), { force: true });
    }
    rmSync(join(dir, FAVICONS_NAME), { recursive: true, force: true });
    rmSync(join(dir, GALLERY_NAME), { recursive: true, force: true });
    rmSync(join(dir, NOTES_NAME), { recursive: true, force: true });
}

/** removeDataFiles 加上 Chrome 专用 profile：用于「数据已复制走 / 迁移失败清残留」的收尾 */
export function removeDbArtifacts(dir: string): void {
    removeDataFiles(dir);
    // Chrome profile 可能正被专用实例锁着（迁移前用户没关）：残留不挡迁移，
    // 下次 chromeClear 或手动清理；其余具名数据此刻没有进程持有
    try {
        rmSync(join(dir, CHROME_PROFILE_NAME), { recursive: true, force: true });
    } catch {
        /* 见上 */
    }
}
