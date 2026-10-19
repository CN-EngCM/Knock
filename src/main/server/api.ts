import db from "./db";
import Database from "better-sqlite3";
// 专家出厂播种：模块加载时执行一次（幂等），比放 db.ts 干净——db.ts 调 util/settings 会循环依赖
import { ensureSeeded } from "./experts";
import { autostartStatus, disableAutostart, enableAutostart } from "./autostart";
import { parseNetscapeBookmarks } from "./bookmarks";
import { searchEverything, type FileHit, type FileSearchOptions } from "./everything";
import { searchSpotlight } from "./spotlight";
import { loadFavicon } from "./favicon";
import { applyHotkey, currentHotkey } from "../hotkey";
import { launchItem } from "./launcher";
import { killSession, readTermConfig, resizeSession, spawnSession, writeSession } from "./pty";
import { scanShortcuts, type Shortcut } from "./shortcuts";
import { getSetting, setSetting } from "./util/settings";
import { dataDir } from "./util/dataDir";
import { withNativeDialog } from "./util/nativeDialog";
import {
    DB_NAME,
    FAVICONS_NAME,
    GALLERY_NAME,
    canAcceptAsDataDir,
    defaultDataRoot,
    removeDbArtifacts,
    samePath,
    writePointer,
} from "./util/dataLocation";
import { currentWindowState } from "../windowState";
import { testModel as aiTestModel, startChat, stopChat } from "./ai";
import { createExpert, deleteExpert, listExperts, updateExpert } from "./experts";
import {
    addTagsToImages as galleryAddTagsToImages,
    allTags as galleryAllTags,
    collectDiscard as galleryCollectDiscard,
    collectStart as galleryCollectStart,
    createGroup as galleryCreateGroup,
    deleteGroup as galleryDeleteGroup,
    deleteImages as galleryDeleteImages,
    downloadCandidates as galleryDownloadCandidates,
    fetchPage as galleryFetchPage,
    importCandidates as galleryImportCandidates,
    importFiles as galleryImport,
    listGroups as galleryListGroups,
    moveImages as galleryMove,
    renderPage as galleryRenderPage,
    passwordState as galleryPasswordState,
    pasteFromClipboard as galleryPaste,
    pickFiles as galleryPickFiles,
    openImage as galleryOpenImage,
    queryImages as galleryQuery,
    renameGroup as galleryRenameGroup,
    setImageTags as gallerySetImageTags,
    setGroupPrivate as gallerySetGroupPrivate,
    setLibraryPassword as gallerySetPassword,
    deleteTag as galleryDeleteTag,
    revealImage as galleryRevealImage,
    unlockLibrary as galleryUnlock,
    wallAdd as galleryWallAdd,
    wallAddGroup as galleryWallAddGroup,
    wallCount as galleryWallCount,
    wallRemove as galleryWallRemove,
} from "./gallery";
import {
    chromeClear as galleryChromeClear,
    chromeLogin as galleryChromeLogin,
    chromeSync as galleryChromeSync,
} from "./chromeLogin";
import { youdaoTranslate, type TranslateResult } from "./youdao";
import { app, clipboard, dialog } from "electron";
import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
    aiChatSchema,
    aiChatStopSchema,
    aiModelConfigSchema,
    aiModelsSchema,
    changeDataDirSchema,
    clipPasteSchema,
    createExpertSchema,
    createGroupSchema,
    createItemSchema,
    galleryGroupSchema,
    galleryIdsSchema,
    galleryImportSchema,
    galleryDownloadSchema,
    galleryImportCandidatesSchema,
    galleryPageSchema,
    galleryOptionalPasswordSchema,
    galleryPasswordSchema,
    galleryQuerySchema,
    galleryTagSchema,
    galleryTagsSchema,
    fileSearchSchema,
    fontPatchSchema,
    importSchema,
    pathArgSchema,
    pickFileSchema,
    translateConfigPatchSchema,
    translateSchema,
    HOTKEY_IDS,
    orderSchema,
    ptyResizeSchema,
    ptySpawnSchema,
    ptyWriteSchema,
    termPatchSchema,
    themeSchema,
    toolAliasPatchSchema,
    updateExpertSchema,
    updateGroupSchema,
    updateItemSchema,
    TOOL_IDS,
    type AiModelConfig,
    type AiChatInput,
    type CreateExpertInput,
    type UpdateExpertInput,
    type Expert,
    type FontConfig,
    type FontPatch,
    type GalleryCandidate,
    type GalleryDownloadInput,
    type GalleryGroup,
    type GalleryImage,
    type GalleryImportCandidatesInput,
    type GalleryImportStats,
    type GalleryPageResult,
    type GalleryQueryInput,
    type Group,
    type HotkeyId,
    type Item,
    type CreateItemInput,
    type FileSearchInput,
    type OrderInput,
    type PtySpawnInput,
    type TermConfig,
    type TermPatch,
    type ThemeId,
    type ToolAliases,
    type ToolAliasPatch,
    type TranslateConfig,
    type TranslateConfigPatch,
    type TranslateInput,
    type UpdateItemInput,
} from "./schemas";

// ── 渲染进程 API 契约（v2.1：标准 Electron IPC，替代 v2.0 的 Hono 假 HTTP）──
//
// MpApi 是前后端唯一事实来源：主进程的处理器表（apiHandlers）按它逐方法实现，
// 渲染进程的 client.ts 按它逐方法包装 invoke——两边签名不一致都在编译期报错。
// 参数一律在各处理器入口做 zod 校验（渲染进程拿不到 Node，但 channel 是通用
// 转发，入参必须当作不可信数据对待）。

export type ApiError =
    | { kind: "bad-request" } // 入参校验失败
    | { kind: "not-found" } // 目标分组/条目/专家不存在，或 favicon、AI 模型配置未命中
    | { kind: "conflict" } // 组合键被占用 / 自启写入失败
    | { kind: "unauthorized" } // macOS 辅助功能未授权：双击热键的键盘钩子无法启动（主进程已弹引导）
    | { kind: "missing"; path: string } // 启动目标路径不存在
    | { kind: "failed"; path: string } // 启动器执行失败
    | { kind: "everything" } // Everything 未运行（es.exe 退出码 8）或当前平台不支持
    | { kind: "youdao"; code: string } // 有道接口错误：code 为官方 errorCode，或 network（连不上/超时/响应异常）
    | { kind: "ai"; status?: number } // LLM 上游错误：status=HTTP 状态码，缺省=网络层失败或首字节超时
    | { kind: "not-configured" } // 翻译密钥未配置（settings 表缺 youdaoAppKey/youdaoAppSecret）
    | { kind: "gallery"; code: "no-image" | "fetch" | "locked" | "wrong-password" | "no-chrome" | "chrome" | "rm" } // 图库：剪贴板无图；抓页失败；查询私密分组未携有效密码；解锁密码不匹配；未装 Chrome；专用 Chrome 拉起/CDP 失败；登录态 profile 删不掉（Chrome 未关净）
    | { kind: "data-dir"; reason: "same" | "occupied" | "failed" }; // 数据目录迁移：same=与当前相同；occupied=目标非空；failed=备份/校验失败（旧数据未动，可重试）

/** 统一返回形状：可预期错误走 error 分支（判别联合），不靠抛异常 */
export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError };

export type ImportStats = { createdGroups: number; importedItems: number; skipped: number };

// 专家出厂播种（幂等）：主进程业务装载的必经之路就是本模块，
// 在此显式调一次，避免依赖各 entry 的 import 次序
ensureSeeded();

export interface MpApi {
    session(): Promise<ApiResult<{ platform: NodeJS.Platform }>>;
    getData(): Promise<ApiResult<{ groups: Group[]; items: Item[] }>>;
    createGroup(name: string): Promise<ApiResult<{ id: number }>>;
    renameGroup(id: number, name: string): Promise<ApiResult<null>>;
    deleteGroup(id: number): Promise<ApiResult<null>>;
    createItem(input: CreateItemInput): Promise<ApiResult<{ id: number }>>;
    updateItem(id: number, patch: UpdateItemInput): Promise<ApiResult<null>>;
    deleteItem(id: number): Promise<ApiResult<null>>;
    reorder(payload: OrderInput): Promise<ApiResult<null>>;
    launch(id: number): Promise<ApiResult<null>>;
    importBookmarks(html: string): Promise<ApiResult<ImportStats>>;
    getAutostart(): Promise<ApiResult<{ supported: boolean; enabled: boolean }>>;
    setAutostart(enabled: boolean): Promise<ApiResult<{ enabled: boolean }>>;
    getHotkey(): Promise<ApiResult<{ hotkey: HotkeyId; presets: readonly HotkeyId[] }>>;
    setHotkey(hotkey: HotkeyId): Promise<ApiResult<{ hotkey: HotkeyId }>>;
    listShortcuts(refresh: boolean): Promise<ApiResult<{ shortcuts: Shortcut[] }>>;
    /** favicon 二进制：bytes 经 IPC 结构化克隆传回，渲染进程拼 Blob */
    getFavicon(domain: string): Promise<ApiResult<{ mime: string; bytes: Uint8Array<ArrayBuffer> }>>;
    // ── 终端会话（v2.2）：数据流不在此契约里，经 preload 的 onPtyEvent 事件通道下行 ──
    // opts 供终端命令条目传入 cwd/label；不传时 cwd 缺省主目录、label 用 shell 标签。
    // cwd 指定了但目录不存在 → missing（带路径，前端 toast），不建会话
    ptySpawn(opts?: PtySpawnInput): Promise<ApiResult<{ id: number; label: string }>>;
    ptyWrite(id: number, data: string): Promise<ApiResult<null>>;
    ptyResize(id: number, cols: number, rows: number): Promise<ApiResult<null>>;
    ptyKill(id: number): Promise<ApiResult<null>>;
    // ── 剪贴板（终端复制/粘贴用）：主进程 electron.clipboard 读写。打包后页面是
    //    file:// 非安全上下文，渲染进程没有 navigator.clipboard，只能经 IPC 走这里 ──
    clipboardRead(): Promise<string>;
    clipboardWrite(text: string): Promise<ApiResult<null>>;
    // ── 终端设置（v2.3）：shell 只对新建会话生效，字号作用于全部已有会话 ──
    getTermConfig(): Promise<ApiResult<TermConfig>>;
    setTermConfig(patch: TermPatch): Promise<ApiResult<TermConfig>>;
    // ── 字体设置（v2.4）：界面字体 + 等宽字体（终端/ASCII/JSON/代码块共用等宽栈）；
    //    空串 = 用内置默认字体栈，改完即生效（渲染端写 CSS 变量）──
    getFontConfig(): Promise<ApiResult<FontConfig>>;
    setFontConfig(patch: FontPatch): Promise<ApiResult<FontConfig>>;
    // ── 内置工具别名（v2.3）：别名参与顶栏搜索的工具候选匹配 ──
    getToolAliases(): Promise<ApiResult<ToolAliases>>;
    setToolAliases(patch: ToolAliasPatch): Promise<ApiResult<ToolAliases>>;
    // ── 剪贴板素材时限（v2.3）：呼出时最近一次复制落在时限内才自动进搜索框 ──
    getClipPaste(): Promise<ApiResult<{ seconds: number }>>;
    setClipPaste(seconds: number): Promise<ApiResult<{ seconds: number }>>;
    // ── 界面主题：唯一权威来源是 settings 表 theme 键；主进程开窗前另经
    //    server/util/settings 直读同一键定窗口底色/系统边线，渲染端首帧前套 .dark ──
    getTheme(): Promise<ApiResult<{ theme: ThemeId }>>;
    setTheme(theme: ThemeId): Promise<ApiResult<{ theme: ThemeId }>>;
    // ── 文件搜索（工具 files）：es.exe 查询 Everything；打开/定位是结果行的动作，不经 DB 条目 ──
    fileSearch(input: FileSearchInput): Promise<ApiResult<{ hits: FileHit[] }>>;
    openPath(path: string): Promise<ApiResult<null>>;
    revealPath(path: string): Promise<ApiResult<null>>;
    /** 路径探测（搜索框直达动作）：只回答「存在与否 + 是否目录」；不存在走 not-found */
    statPath(path: string): Promise<ApiResult<{ isDir: boolean }>>;
    /** 原生目录选择框（条目编辑「浏览…」用）：取消返回 null */
    pickDirectory(): Promise<ApiResult<string | null>>;
    /** 原生文件选择框（条目编辑目标「浏览…」用）：app = 过滤可执行文件，path = 文件/文件夹皆可选；取消返回 null */
    pickFile(purpose: "app" | "path"): Promise<ApiResult<string | null>>;
    // ── 数据目录（设置页展示与迁移）：目录由默认根下的指针文件决定（dataLocation.ts）──
    /** dir = 当前生效数据目录；isDefault = 是否就在默认根（决定「恢复默认」按钮显隐） */
    getDataDir(): Promise<ApiResult<{ dir: string; isDefault: boolean }>>;
    /** 迁移数据目录：null = 恢复默认。成功即 relaunch+exit（本调用不会有返回）；失败返回 error，可原样重试 */
    changeDataDir(target: string | null): Promise<ApiResult<null>>;
    // ── 有道翻译（工具 translate）：请求在主进程发（渲染进程直连被 CORS 拦，密钥也不进渲染包）；
    //    密钥存 settings 表，每次翻译现读现签，设置页改完即生效 ──
    translate(input: TranslateInput): Promise<ApiResult<TranslateResult>>;
    getTranslateConfig(): Promise<ApiResult<TranslateConfig>>;
    setTranslateConfig(patch: TranslateConfigPatch): Promise<ApiResult<TranslateConfig>>;
    // ── AI 助手（工具 ai）──
    // 模型配置整表存 settings 键 aiModels（JSON），每次对话/测试现读，改完即生效
    getAiModels(): Promise<ApiResult<AiModelConfig[]>>;
    setAiModels(models: AiModelConfig[]): Promise<ApiResult<null>>;
    /** 测试连接：测的是当前编辑值（不落库），mini 非流式请求 */
    aiTestModel(cfg: AiModelConfig): Promise<ApiResult<null>>;
    // 专家 CRUD：存 experts 表，按创建顺序（position）返回
    listExperts(): Promise<ApiResult<Expert[]>>;
    createExpert(input: CreateExpertInput): Promise<ApiResult<Expert>>;
    updateExpert(id: number, patch: UpdateExpertInput): Promise<ApiResult<Expert>>;
    deleteExpert(id: number): Promise<ApiResult<null>>;
    /** 对话增量走 mp:ai-event 事件下行（照 pty 模式），此契约只交付 streamId；模型 id 未命中按 not-found */
    aiChat(input: AiChatInput): Promise<ApiResult<{ streamId: number }>>;
    aiChatStop(streamId: number): Promise<ApiResult<null>>;
    // ── 图库（工具 gallery）：图片字节级复制进数据目录 gallery/，sha256 全库去重；
    //    图片经 mpimg:// 协议按 id 直读（注册见 src/main/index.ts），不经 IPC 传字节 ──
    /** 分组列表：锁定视角（未携有效密码）不下发私密分组行 */
    galleryGroups(password?: string): Promise<ApiResult<GalleryGroup[]>>;
    galleryCreateGroup(name: string): Promise<ApiResult<{ id: number }>>;
    galleryRenameGroup(id: number, name: string): Promise<ApiResult<null>>;
    galleryDeleteGroup(id: number): Promise<ApiResult<null>>;
    /** 分组标记/取消私密（私密生效前提：已设图库密码） */
    gallerySetGroupPrivate(id: number, isPrivate: boolean): Promise<ApiResult<null>>;
    /** 图库密码（工具级一个，明文本地存 settings 表）：是否已设（锁定开关显隐的依据） */
    galleryPasswordState(): Promise<ApiResult<{ has: boolean }>>;
    /** 设置（非 null）/清除（null）图库密码；改密不校验旧密码（明文威胁模型，见 gallery.ts） */
    gallerySetPassword(password: string | null): Promise<ApiResult<null>>;
    /** 解锁校验，密码不匹配返回 wrong-password */
    galleryUnlock(password: string): Promise<ApiResult<null>>;
    galleryImages(input: GalleryQueryInput): Promise<ApiResult<{ total: number; items: GalleryImage[] }>>;
    /** 标签池：全量（私密只隔离图片内容，不隔离标签词——共用标签不消失） */
    galleryAllTags(): Promise<ApiResult<string[]>>;
    galleryImport(files: string[], groupId: number): Promise<ApiResult<GalleryImportStats>>;
    galleryPaste(groupId: number): Promise<ApiResult<GalleryImportStats>>;
    gallerySetImageTags(id: number, tags: string[]): Promise<ApiResult<null>>;
    /** 批量给多张图添加标签（并集幂等，单事务）；单张整体替换用 gallerySetImageTags */
    galleryAddTagsToImages(ids: number[], tags: string[]): Promise<ApiResult<null>>;
    /** 词级删除：从所有图片移除该标签（渲染端配确认框） */
    galleryDeleteTag(tag: string): Promise<ApiResult<null>>;
    galleryMoveImages(ids: number[], groupId: number): Promise<ApiResult<null>>;
    galleryDeleteImages(ids: number[]): Promise<ApiResult<null>>;
    galleryPickFiles(): Promise<ApiResult<string[]>>;
    /** 系统默认程序打开 / 资源管理器定位：磁盘路径不出主进程，按 id 代劳 */
    galleryOpenImage(id: number): Promise<ApiResult<null>>;
    galleryRevealImage(id: number): Promise<ApiResult<null>>;
    // ── 画廊（放映墙）：跨分组成员籍（图片仍属原分组）；快照语义，重复加入幂等并集 ──
    /** 批量加入画廊，返回真正新增数（渲染端 toast 区分「已加入 n 张」与「已在画廊」） */
    galleryWallAdd(ids: number[]): Promise<ApiResult<{ added: number }>>;
    /** 整组加入画廊（服务端直取组内成员，含收件箱） */
    galleryWallAddGroup(groupId: number): Promise<ApiResult<{ added: number }>>;
    /** 从画廊移除（只动成员籍，图片本体不动） */
    galleryWallRemove(ids: number[]): Promise<ApiResult<null>>;
    /** 画廊可见计数（侧栏行；锁定视角剔除私密组的图） */
    galleryWallCount(password?: string): Promise<ApiResult<{ count: number }>>;
    // ── 从网址导入：渲染端驱动翻页/分批下载（进度与取消自然落在渲染端循环里），
    //    主进程只维护一个暂存会话（候选字节在 os.tmpdir，入库才进 gallery/）──
    galleryCollectStart(): Promise<ApiResult<null>>;
    galleryCollectDiscard(): Promise<ApiResult<null>>;
    /** 静态抓页：直链判定（isImage）与渲染失败时的兜底解析 */
    galleryFetchPage(url: string): Promise<ApiResult<GalleryPageResult>>;
    /** 渲染收集（主路径）：隐藏窗口真实加载后从 DOM 收图片 URL 全集/显示尺寸/标题/下页；
     *  SPA 站（pixiv 等）作品图靠 JS 插入，静态 HTML 里没有 */
    galleryRenderPage(url: string): Promise<ApiResult<GalleryPageResult>>;
    galleryDownloadCandidates(input: GalleryDownloadInput): Promise<ApiResult<{ items: GalleryCandidate[] }>>;
    galleryImportCandidates(input: GalleryImportCandidatesInput): Promise<ApiResult<GalleryImportStats>>;
    // ── 受限站登录态：专用 Chrome 实例（独立持久 profile）+ CDP 同步 cookie，见 server/chromeLogin.ts ──
    /** 拉起（或复用在跑的）专用 Chrome 打开该页，用户在其中登录 */
    galleryChromeLogin(url: string): Promise<ApiResult<null>>;
    /** 把专用 Chrome 里「访问该 URL 会带的 cookie」同步进抓取分区，返回写入条数 */
    galleryChromeSync(url: string): Promise<ApiResult<{ count: number }>>;
    /** 清除登录态：关专用 Chrome、删其 profile、清抓取分区 cookie */
    galleryChromeClear(): Promise<ApiResult<null>>;
}

/** 处理器表类型：与 MpApi 逐方法对齐（参数与返回值都进入编译期检查） */
type ApiHandlers = {
    [K in keyof MpApi]: (...args: Parameters<MpApi[K]>) => Promise<Awaited<ReturnType<MpApi[K]>>>;
};

// better-sqlite3 的 .all()/.get() 返回 unknown[]，在 SQL 边界统一断言成行类型。
// （字段由 schema 与 SQL 共同保证，是全项目唯一允许 as 的地方）
const asGroups = (rows: unknown[]) => rows as Group[];
const asItems = (rows: unknown[]) => rows as Item[];

const badRequest = { ok: false, error: { kind: "bad-request" } } as const;
const notFound = { ok: false, error: { kind: "not-found" } } as const;

/** zod 校验失败 → 统一 bad-request（不透传 zod 细节给渲染进程） */
function guard<T>(
    schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false } },
    input: unknown,
) {
    const r = schema.safeParse(input);
    return r.success ? r.data : null;
}

export const apiHandlers: ApiHandlers = {
    // 运行环境探测（前端据 platform 决定是否显示 Windows 快捷方式选择器）
    session: async () => ({ ok: true, data: { platform: process.platform } }),

    // 全量数据（个人工具规模，一次取全，前端无需分页）
    getData: async () => ({
        ok: true,
        data: {
            groups: asGroups(db.prepare("SELECT * FROM groups ORDER BY position, id").all()),
            items: asItems(db.prepare("SELECT * FROM items ORDER BY position, id").all()),
        },
    }),

    createGroup: async (name) => {
        const v = guard(createGroupSchema, { name });
        if (!v) return badRequest;
        // 新分组排到最后：MAX(position)+1，空表时 COALESCE 兜底为 0
        const info = db
            .prepare(
                "INSERT INTO groups (name, position) VALUES (?, (SELECT COALESCE(MAX(position), -1) + 1 FROM groups))",
            )
            .run(v.name);
        return { ok: true, data: { id: Number(info.lastInsertRowid) } };
    },

    renameGroup: async (id, name) => {
        const v = guard(updateGroupSchema, { name });
        if (!v) return badRequest;
        const info = db.prepare("UPDATE groups SET name = ? WHERE id = ?").run(v.name, id);
        return info.changes === 0 ? notFound : { ok: true, data: null };
    },

    // 组内条目由外键 ON DELETE CASCADE 一并删除（db.ts 已开启 foreign_keys）
    deleteGroup: async (id) => {
        const info = db.prepare("DELETE FROM groups WHERE id = ?").run(id);
        return info.changes === 0 ? notFound : { ok: true, data: null };
    },

    createItem: async (input) => {
        const v = guard(createItemSchema, input);
        if (!v) return badRequest;
        const info = db
            .prepare(
                "INSERT INTO items (group_id, kind, title, target, args, position) " +
                    "VALUES (?, ?, ?, ?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM items WHERE group_id = ?))",
            )
            .run(v.group_id, v.kind, v.title, v.target, v.args ?? null, v.group_id);
        return { ok: true, data: { id: Number(info.lastInsertRowid) } };
    },

    // PATCH 用「读旧值 → 合并 → 整行写回」：逻辑直白，个人工具无并发顾虑
    updateItem: async (id, patch) => {
        const v = guard(updateItemSchema, patch);
        if (!v) return badRequest;
        const row = db.prepare("SELECT * FROM items WHERE id = ?").get(id) as Item | undefined;
        if (!row) return notFound;
        const next = {
            group_id: v.group_id ?? row.group_id,
            kind: v.kind ?? row.kind,
            title: v.title ?? row.title,
            target: v.target ?? row.target,
            args: v.args === undefined ? row.args : v.args,
        };
        db.prepare("UPDATE items SET group_id = ?, kind = ?, title = ?, target = ?, args = ? WHERE id = ?").run(
            next.group_id,
            next.kind,
            next.title,
            next.target,
            next.args,
            id,
        );
        return { ok: true, data: null };
    },

    deleteItem: async (id) => {
        const info = db.prepare("DELETE FROM items WHERE id = ?").run(id);
        return info.changes === 0 ? notFound : { ok: true, data: null };
    },

    // 拖拽排序：position 直接取数组下标，一个事务里批量写完
    reorder: async (payload) => {
        const v = guard(orderSchema, payload);
        if (!v) return badRequest;
        const updateGroup = db.prepare("UPDATE groups SET position = ? WHERE id = ?");
        const updateItem = db.prepare("UPDATE items SET position = ?, group_id = ? WHERE id = ?");
        db.transaction(() => {
            v.groups?.forEach((id, index) => updateGroup.run(index, id));
            v.items?.forEach((item, index) => updateItem.run(index, item.group_id, item.id));
        })();
        return { ok: true, data: null };
    },

    // ── 启动 / 打开（M3 核心）。书签由前端直接 window.open；应用与文件走这里 ──
    launch: async (id) => {
        if (!Number.isInteger(id) || id <= 0) return badRequest;
        const item = db.prepare("SELECT * FROM items WHERE id = ?").get(id) as Item | undefined;
        if (!item) return notFound;
        // 书签由前端 window.open、终端命令由前端驱动 pty 执行，走到这里都是误用；
        // 提前 return 后 item.kind 已窄化为 app/file，kind 显式取出才能过 launchItem 的参数类型
        if (item.kind === "bookmark" || item.kind === "command") return badRequest;
        const err = await launchItem({ kind: item.kind, target: item.target, args: item.args });
        if (err) {
            // 失败带着具体路径返回（launcher.ts 约定），前端据此提示
            return { ok: false, error: { kind: err.error, path: err.path ?? "" } };
        }
        return { ok: true, data: null };
    },

    // ── 书签导入（Chrome 导出的 Netscape HTML）──
    // 文件夹 → 同名分组合并；URL 全局去重（库内已有或文件内重复都跳过）。
    importBookmarks: async (html) => {
        const v = guard(importSchema, { html });
        if (!v) return badRequest;
        const parsed = parseNetscapeBookmarks(v.html);

        // 已有书签 URL 集合：全局去重基准
        const existingUrls = new Set(
            (db.prepare("SELECT target FROM items WHERE kind = 'bookmark'").all() as { target: string }[]).map(
                (r) => r.target,
            ),
        );

        const findGroup = db.prepare("SELECT id FROM groups WHERE name = ?");
        const insertGroup = db.prepare(
            "INSERT INTO groups (name, position) VALUES (?, (SELECT COALESCE(MAX(position), -1) + 1 FROM groups))",
        );
        const maxItemPos = db.prepare("SELECT COALESCE(MAX(position), -1) AS m FROM items WHERE group_id = ?");
        const insertItem = db.prepare(
            "INSERT INTO items (group_id, kind, title, target, args, position) VALUES (?, 'bookmark', ?, ?, NULL, ?)",
        );

        let createdGroups = 0;
        let importedItems = 0;
        let skipped = 0;

        db.transaction(() => {
            for (const [name, items] of parsed) {
                // 重名分组直接合并进既有分组
                let groupId = (findGroup.get(name) as { id: number } | undefined)?.id;
                if (groupId === undefined) {
                    groupId = Number(insertGroup.run(name).lastInsertRowid);
                    createdGroups++;
                }
                let pos = (maxItemPos.get(groupId) as { m: number }).m;
                for (const item of items) {
                    if (existingUrls.has(item.url)) {
                        skipped++;
                        continue;
                    }
                    existingUrls.add(item.url); // 文件内重复同样只收一次
                    pos++;
                    insertItem.run(groupId, item.title || item.url, item.url, pos);
                    importedItems++;
                }
            }
        })();

        return { ok: true, data: { createdGroups, importedItems, skipped } };
    },

    // ── 开机自启（仅当前用户级，可随时装卸）──
    getAutostart: async () => ({ ok: true, data: autostartStatus() }),
    setAutostart: async (enabled) => {
        if (typeof enabled !== "boolean") return badRequest;
        const result = enabled ? enableAutostart() : disableAutostart();
        if (!result.ok) return { ok: false, error: { kind: "conflict" } };
        return { ok: true, data: { enabled: autostartStatus().enabled } };
    },

    // ── 呼出热键（double-ctrl 等 5 个预设，见 schemas.HOTKEY_IDS）──
    getHotkey: async () => ({ ok: true, data: { hotkey: currentHotkey(), presets: HOTKEY_IDS } }),
    setHotkey: async (hotkey) => {
        if (!(HOTKEY_IDS as readonly string[]).includes(hotkey)) return badRequest;
        // applyHotkey 失败：组合键被占用（旧热键保持不变）或 mac 未授权辅助功能（已弹引导）
        const r = applyHotkey(hotkey);
        if (!r.ok) return { ok: false, error: { kind: r.error === "unauthorized" ? "unauthorized" : "conflict" } };
        setSetting("hotkey", hotkey);
        return { ok: true, data: { hotkey: currentHotkey() } };
    },

    // Windows 快捷方式列表（添加应用时的辅助选择器；其余平台返回空数组）
    listShortcuts: async (refresh) => {
        const shortcuts: Shortcut[] = await scanShortcuts(refresh === true);
        return { ok: true, data: { shortcuts } };
    },

    // ── favicon（书签图标）：首次请求时抓取并落盘缓存，之后直接回本地文件 ──
    // 域名参数只放行 [a-z0-9.-]，杜绝路径穿越。
    getFavicon: async (domain) => {
        const d = domain.toLowerCase();
        if (!/^[a-z0-9.-]+$/.test(d)) return badRequest;
        const icon = await loadFavicon(d);
        if (!icon) return notFound;
        return { ok: true, data: { mime: icon.mime, bytes: new Uint8Array(icon.buf) } };
    },

    // ── 终端会话：spawn 失败（shell 丢失等）按 not-found 语义返回；
    //    cwd 指定但目录不存在 → missing 带路径返回，不建会话 ──
    ptySpawn: async (opts) => {
        const v = guard(ptySpawnSchema, opts ?? {});
        if (!v) return badRequest;
        if (v.cwd) {
            const ok = await stat(v.cwd)
                .then((s) => s.isDirectory())
                .catch(() => false);
            if (!ok) return { ok: false, error: { kind: "missing", path: v.cwd } };
        }
        try {
            return { ok: true, data: spawnSession(v) };
        } catch {
            return notFound;
        }
    },
    ptyWrite: async (id, data) => {
        const v = guard(ptyWriteSchema, { id, data });
        if (!v) return badRequest;
        return writeSession(v.id, v.data) ? { ok: true, data: null } : notFound;
    },
    ptyResize: async (id, cols, rows) => {
        const v = guard(ptyResizeSchema, { id, cols, rows });
        if (!v) return badRequest;
        return resizeSession(v.id, v.cols, v.rows) ? { ok: true, data: null } : notFound;
    },
    ptyKill: async (id) => {
        if (!Number.isInteger(id) || id <= 0) return badRequest;
        return killSession(id) ? { ok: true, data: null } : notFound;
    },
    // 剪贴板读写不会失败，read 直接给裸串
    clipboardRead: async () => clipboard.readText(),
    clipboardWrite: async (text) => {
        if (typeof text !== "string") return badRequest;
        clipboard.writeText(text);
        return { ok: true, data: null };
    },

    // ── 终端设置：键值落在 settings 表，读回形状见 pty.readTermConfig ──
    getTermConfig: async () => ({ ok: true, data: readTermConfig() }),
    setTermConfig: async (patch) => {
        const v = guard(termPatchSchema, patch);
        if (!v) return badRequest;
        if (v.shell !== undefined) setSetting("termShell", v.shell);
        if (v.fontSize !== undefined) setSetting("termFontSize", String(v.fontSize));
        return { ok: true, data: readTermConfig() };
    },

    // ── 字体设置：settings 表键 uiFont / monoFont，空串 = 清除（回默认栈）──
    getFontConfig: async () => ({ ok: true, data: readFontConfig() }),
    setFontConfig: async (patch) => {
        const v = guard(fontPatchSchema, patch);
        if (!v) return badRequest;
        if (v.uiFont !== undefined) setSetting("uiFont", v.uiFont);
        if (v.monoFont !== undefined) setSetting("monoFont", v.monoFont);
        return { ok: true, data: readFontConfig() };
    },

    // ── 工具别名：每工具一条 settings 记录（toolAlias:<id>），空串 = 清除 ──
    getToolAliases: async () => ({ ok: true, data: readToolAliases() }),
    setToolAliases: async (patch) => {
        const v = guard(toolAliasPatchSchema, patch);
        if (!v) return badRequest;
        for (const [id, alias] of Object.entries(v.aliases)) setSetting(`toolAlias:${id}`, alias);
        return { ok: true, data: readToolAliases() };
    },

    // ── 剪贴板素材时限：主进程 clipWatch 每次呼出直接读库，无需通知 ──
    getClipPaste: async () => {
        const n = Number(getSetting("clipPasteWindow", "5"));
        return { ok: true, data: { seconds: Number.isFinite(n) ? Math.min(60, Math.max(0, n)) : 5 } };
    },
    setClipPaste: async (seconds) => {
        const v = guard(clipPasteSchema, { seconds });
        if (!v) return badRequest;
        setSetting("clipPasteWindow", String(v.seconds));
        return { ok: true, data: { seconds: v.seconds } };
    },

    // ── 界面主题：脏值（手改库）回落深色 ──
    getTheme: async () => ({ ok: true, data: { theme: readThemeSetting() } }),
    setTheme: async (theme) => {
        const v = guard(themeSchema, theme);
        if (!v) return badRequest;
        setSetting("theme", v);
        return { ok: true, data: { theme: v } };
    },

    // ── 文件搜索：Windows 走 Everything（es.exe），macOS 走 Spotlight（mdfind）；
    //     其余平台并入 everything 错误（前端提示页） ──
    fileSearch: async (input) => {
        const v = guard(fileSearchSchema, input);
        if (!v) return badRequest;
        if (process.platform !== "win32" && process.platform !== "darwin")
            return { ok: false, error: { kind: "everything" } };
        const opts: FileSearchOptions = {
            only: v.only,
            exts: v.exts,
            sort: v.sort,
            ascending: v.ascending,
            limit: v.limit,
        };
        const r =
            process.platform === "darwin"
                ? await searchSpotlight(v.query, opts)
                : await searchEverything(v.query, opts);
        if (r.ok) return { ok: true, data: { hits: r.hits } };
        // 搜索失败没有具体路径可言，path 置空（前端按 toast 处理）
        return r.error === "everything"
            ? { ok: false, error: { kind: "everything" } }
            : { ok: false, error: { kind: "failed", path: "" } };
    },

    // 打开搜索结果：复用启动器的「验存在 → open 默认方式」，错误语义与 launch 相同
    openPath: async (path) => {
        const v = guard(pathArgSchema, { path });
        if (!v) return badRequest;
        const err = await launchItem({ kind: "file", target: v.path, args: null });
        return err ? { ok: false, error: { kind: err.error, path: err.path ?? "" } } : { ok: true, data: null };
    },

    // 系统文件管理器中定位并选中目标；GUI 程序失败会自弹系统告警，不检查退出码
    revealPath: async (path) => {
        const v = guard(pathArgSchema, { path });
        if (!v) return badRequest;
        if (!existsSync(v.path)) return { ok: false, error: { kind: "missing", path: v.path } };
        if (process.platform === "darwin") {
            spawn("open", ["-R", v.path], { detached: true }).unref();
            return { ok: true, data: null };
        }
        // 实测坑：windowsHide 会让 explorer（GUI 程序）的窗口隐藏启动——点了没反应；
        // 文件夹行路径带尾随 \，/select 解析不动，先剥掉；盘根（D:\）剥完只剩 D:，
        // /select 无意义，直接原样传路径打开该盘
        const stripped = v.path.replace(/\\+$/, "");
        const arg = /^[A-Za-z]:$/.test(stripped) ? v.path : `/select,${stripped}`;
        spawn("explorer.exe", [arg], { detached: true }).unref();
        return { ok: true, data: null };
    },

    // 搜索框路径直达动作的探测端：只答存在性与目录性，「打开还是去所在目录」由前端决定。
    // stat 的任何失败（ENOENT / 权限 / 非法字符）对用户都是同一个事实——这个路径不可达
    statPath: async (path) => {
        const v = guard(pathArgSchema, { path });
        if (!v) return badRequest;
        try {
            return { ok: true, data: { isDir: (await stat(v.path)).isDirectory() } };
        } catch {
            return notFound;
        }
    },

    // 原生目录选择框（条目编辑「浏览…」）：取消 = data null，前端保持原值不动。
    // withNativeDialog 抑制主窗口失焦自动隐藏（见 util/nativeDialog.ts）
    pickDirectory: async () => {
        const r = await withNativeDialog(() => dialog.showOpenDialog({ properties: ["openDirectory"] }));
        return { ok: true, data: r.canceled ? null : (r.filePaths[0] ?? null) };
    },

    // 原生文件选择框：app 过滤 Windows 可执行文件（exe 直启/带参 spawn 均可，lnk 仅直启）；
    // path 同时开 openFile+openDirectory，文件与文件夹都能选。过滤名只用扩展名本身，主进程不引入界面文案。
    // macOS 不加过滤：.app 走应用选择器体验更好（文件框双击 bundle 会直接启动而不是选中），
    // 且命令行工具/脚本常无扩展名，过滤反而挡路
    pickFile: async (purpose) => {
        const v = guard(pickFileSchema, { purpose });
        if (!v) return badRequest;
        const r = await withNativeDialog(() =>
            dialog.showOpenDialog({
                properties: v.purpose === "app" ? ["openFile"] : ["openFile", "openDirectory"],
                filters:
                    v.purpose === "app" && process.platform === "win32"
                        ? [{ name: "EXE / LNK / BAT / CMD", extensions: ["exe", "lnk", "bat", "cmd"] }]
                        : undefined,
            }),
        );
        return { ok: true, data: r.canceled ? null : (r.filePaths[0] ?? null) };
    },

    // ── 数据目录行：dir 即当前生效目录（指针解析结果），isDefault 决定「恢复默认」按钮 ──
    getDataDir: async () => {
        const dir = dataDir();
        return { ok: true, data: { dir, isDefault: samePath(dir, defaultDataRoot()) } };
    },

    // ── 数据目录迁移（null = 恢复默认）──
    // 为什么不关库再复制：全仓只有一个 db 连接，关掉后所有 IPC 处理器都会打到死
    // 连接上。改用 better-sqlite3 的在线备份 db.backup()——对 WAL 活跃写入也能
    // 产出一致快照，且失败只影响目标副本，旧库毫发无损。
    changeDataDir: async (target) => {
        const v = guard(changeDataDirSchema, { target });
        if (!v) return badRequest;
        const oldDir = dataDir();
        // 入口先 resolve 归一化：相同性判断、指针写入、清理都基于统一形式
        const dest = resolve(v.target ?? defaultDataRoot());
        if (samePath(dest, oldDir)) return { ok: false, error: { kind: "data-dir", reason: "same" } };
        // 目标准入：自定义目录须「空或不存在」；默认根只要求没有旧 mypage.db
        //（它常混有 Electron 历史杂项，严格空判会让「恢复默认」永远失败）
        if (!canAcceptAsDataDir(dest)) return { ok: false, error: { kind: "data-dir", reason: "occupied" } };

        try {
            mkdirSync(dest, { recursive: true });
            const destDb = join(dest, DB_NAME);
            await db.backup(destDb);
            if (existsSync(join(oldDir, FAVICONS_NAME))) {
                cpSync(join(oldDir, FAVICONS_NAME), join(dest, FAVICONS_NAME), { recursive: true });
            }
            // 图库目录同款跟进：图片是字节级复制进数据目录的，不搬走等于全丢
            if (existsSync(join(oldDir, GALLERY_NAME))) {
                cpSync(join(oldDir, GALLERY_NAME), join(dest, GALLERY_NAME), { recursive: true });
            }

            // 校验副本可整库读，并顺手把当前窗口状态写进副本：旧库稍后会被删除，
            // 而窗口 move/resize 是 500ms 防抖落库，最后一段状态多半还没写盘——不补
            // 进副本，重启后窗口位置就丢了。（连接不能开 readonly：要写 settings 表）
            const copy = new Database(destDb);
            try {
                const check = copy.pragma("quick_check") as { quick_check: string }[];
                if (check[0]?.quick_check !== "ok") throw new Error("quick_check failed");
                copy.prepare(
                    "INSERT INTO settings (key, value) VALUES ('window_state', ?) " +
                        "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                ).run(JSON.stringify(currentWindowState()));
            } finally {
                copy.close();
            }

            // 副本验证通过才写指针：此刻起新目录成为唯一事实来源
            writePointer(dest);
        } catch (e) {
            // 3–5 步任何失败：清掉本次在目标目录产生的残留即返回。指针未写、
            // 旧库未动 → 前端解除 pending 后原样重试即可；失败原因落主进程日志
            console.error("[changeDataDir] migrate failed:", e);
            try {
                removeDbArtifacts(dest);
            } catch {
                /* 清理本身失败也按 failed 返回：不挡重试 */
            }
            return { ok: false, error: { kind: "data-dir", reason: "failed" } };
        }

        // 切换完成：关掉旧连接（全仓首次 close，此后旧连接已死）→ 删旧目录数据。
        // 只删具名文件，默认根处的指针文件天然不受影响。指针已写，清理失败忽略——
        // 残留只是垃圾不是错误源，无论成败都必须重启到新目录
        try {
            db.close();
            removeDbArtifacts(oldDir);
        } catch (e) {
            console.error("[changeDataDir] old db close/cleanup failed:", e);
        }
        app.relaunch();
        app.exit(0);
        return { ok: true, data: null }; // exit(0) 立即生效，实际到不了这里
    },

    // ── 有道翻译：失败原因按 youdao(code)/not-configured 交给前端行内释义，不抛异常 ──
    translate: async (input) => {
        const v = guard(translateSchema, input);
        if (!v) return badRequest;
        const r = await youdaoTranslate(v);
        if (r.ok) return { ok: true, data: r.data };
        if (r.error.kind === "not-configured") return { ok: false, error: { kind: "not-configured" } };
        // 网络类失败折叠成 code="network"，与官方 errorCode 走同一条释义链
        return {
            ok: false,
            error: { kind: "youdao", code: r.error.kind === "network" ? "network" : r.error.code },
        };
    },

    // ── 翻译密钥：settings 表键 youdaoAppKey / youdaoAppSecret，空串 = 清除 ──
    getTranslateConfig: async () => ({
        ok: true,
        data: { appKey: getSetting("youdaoAppKey", ""), secret: getSetting("youdaoAppSecret", "") },
    }),
    setTranslateConfig: async (patch) => {
        const v = guard(translateConfigPatchSchema, patch);
        if (!v) return badRequest;
        if (v.appKey !== undefined) setSetting("youdaoAppKey", v.appKey);
        if (v.secret !== undefined) setSetting("youdaoAppSecret", v.secret);
        return {
            ok: true,
            data: { appKey: getSetting("youdaoAppKey", ""), secret: getSetting("youdaoAppSecret", "") },
        };
    },

    // ── AI 模型配置：整表替换式保存（设置页提交全部卡片）；读回即编辑态初值 ──
    getAiModels: async () => {
        let list: unknown = [];
        try {
            list = JSON.parse(getSetting("aiModels", "[]"));
        } catch {
            /* 坏数据当空表 */
        }
        const r = aiModelsSchema.safeParse(list);
        return { ok: true, data: r.success ? r.data : [] };
    },
    setAiModels: async (models) => {
        const v = guard(aiModelsSchema, models);
        if (!v) return badRequest;
        setSetting("aiModels", JSON.stringify(v));
        return { ok: true, data: null };
    },

    // 测试连接透传上游错误（kind=ai 带 status），由前端映射成可读文案
    aiTestModel: async (cfg) => {
        const v = guard(aiModelConfigSchema, cfg);
        if (!v) return badRequest;
        return aiTestModel(v);
    },

    // ── 专家 CRUD ──
    listExperts: async () => listExperts(),
    createExpert: async (input) => {
        const v = guard(createExpertSchema, input);
        if (!v) return badRequest;
        return createExpert(v);
    },
    updateExpert: async (id, patch) => {
        const v = guard(updateExpertSchema, { id, patch });
        if (!v) return badRequest;
        return updateExpert(v.id, v.patch);
    },
    deleteExpert: async (id) => {
        if (!Number.isInteger(id) || id <= 0) return badRequest;
        return deleteExpert(id);
    },

    // 对话启动/停止：增量不在请求-响应里，经 preload 的 onAiEvent 下行（注释见 MpApi）
    aiChat: async (input) => {
        const v = guard(aiChatSchema, input);
        if (!v) return badRequest;
        return startChat(v);
    },
    aiChatStop: async (streamId) => {
        const v = guard(aiChatStopSchema, { streamId });
        if (!v) return badRequest;
        return stopChat(v.streamId);
    },

    // ── 图库：业务全在 server/gallery.ts（含 inbox 组拒绝、not-found、no-image 的判定），
    //    这里只做入口校验与转发；id 形参做 Number.isInteger 兜底（对齐 deleteExpert 先例）──
    galleryGroups: async (password) => {
        const v = guard(galleryOptionalPasswordSchema, { password });
        if (!v) return badRequest;
        return galleryListGroups(v.password);
    },
    galleryCreateGroup: async (name) => {
        const v = guard(galleryGroupSchema, { name });
        if (!v) return badRequest;
        return galleryCreateGroup(v.name);
    },
    galleryRenameGroup: async (id, name) => {
        if (!Number.isInteger(id) || id <= 0) return badRequest;
        const v = guard(galleryGroupSchema, { name });
        if (!v) return badRequest;
        return galleryRenameGroup(id, v.name);
    },
    galleryDeleteGroup: async (id) => {
        if (!Number.isInteger(id) || id <= 0) return badRequest;
        return galleryDeleteGroup(id);
    },
    gallerySetGroupPrivate: async (id, isPrivate) => {
        if (!Number.isInteger(id) || id <= 0) return badRequest;
        if (typeof isPrivate !== "boolean") return badRequest;
        return gallerySetGroupPrivate(id, isPrivate);
    },
    galleryPasswordState: async () => galleryPasswordState(),
    gallerySetPassword: async (password) => {
        if (password == null) return gallerySetPassword(null); // null = 清除密码，无需校验
        const v = guard(galleryPasswordSchema, { password });
        if (!v) return badRequest;
        return gallerySetPassword(v.password);
    },
    galleryUnlock: async (password) => {
        const v = guard(galleryPasswordSchema, { password });
        if (!v) return badRequest;
        return galleryUnlock(v.password);
    },
    galleryImages: async (input) => {
        const v = guard(galleryQuerySchema, input);
        if (!v) return badRequest;
        return galleryQuery(v);
    },
    galleryAllTags: async () => galleryAllTags(),
    galleryImport: async (files, groupId) => {
        const v = guard(galleryImportSchema, { files, groupId });
        if (!v) return badRequest;
        return galleryImport(v.files, v.groupId);
    },
    galleryPaste: async (groupId) => {
        if (!Number.isInteger(groupId) || groupId <= 0) return badRequest;
        return galleryPaste(groupId);
    },
    gallerySetImageTags: async (id, tags) => {
        if (!Number.isInteger(id) || id <= 0) return badRequest;
        const v = guard(galleryTagsSchema, { tags });
        if (!v) return badRequest;
        return gallerySetImageTags(id, v.tags);
    },
    galleryAddTagsToImages: async (ids, tags) => {
        const vi = guard(galleryIdsSchema, { ids });
        if (!vi) return badRequest;
        const vt = guard(galleryTagsSchema, { tags });
        if (!vt) return badRequest;
        return galleryAddTagsToImages(vi.ids, vt.tags);
    },
    galleryDeleteTag: async (tag) => {
        const v = guard(galleryTagSchema, { tag });
        if (!v) return badRequest;
        return galleryDeleteTag(v.tag);
    },
    galleryMoveImages: async (ids, groupId) => {
        const v = guard(galleryIdsSchema, { ids });
        if (!v) return badRequest;
        if (!Number.isInteger(groupId) || groupId <= 0) return badRequest;
        return galleryMove(v.ids, groupId);
    },
    galleryDeleteImages: async (ids) => {
        const v = guard(galleryIdsSchema, { ids });
        if (!v) return badRequest;
        return galleryDeleteImages(v.ids);
    },
    galleryPickFiles: async () => galleryPickFiles(),
    galleryOpenImage: async (id) => {
        if (!Number.isInteger(id) || id <= 0) return badRequest;
        return galleryOpenImage(id);
    },
    galleryRevealImage: async (id) => {
        if (!Number.isInteger(id) || id <= 0) return badRequest;
        return galleryRevealImage(id);
    },
    // ── 画廊：同图库其余部分，这里只做入口校验与转发 ──
    galleryWallAdd: async (ids) => {
        const v = guard(galleryIdsSchema, { ids });
        if (!v) return badRequest;
        return galleryWallAdd(v.ids);
    },
    galleryWallAddGroup: async (groupId) => {
        if (!Number.isInteger(groupId) || groupId <= 0) return badRequest;
        return galleryWallAddGroup(groupId);
    },
    galleryWallRemove: async (ids) => {
        const v = guard(galleryIdsSchema, { ids });
        if (!v) return badRequest;
        return galleryWallRemove(v.ids);
    },
    galleryWallCount: async (password) => {
        const v = guard(galleryOptionalPasswordSchema, { password });
        if (!v) return badRequest;
        return galleryWallCount(v.password);
    },
    // ── 从网址导入：同样只做入口校验与转发（业务见 server/gallery.ts 的「从网址导入」一节）──
    galleryCollectStart: async () => galleryCollectStart(),
    galleryCollectDiscard: async () => galleryCollectDiscard(),
    galleryFetchPage: async (url) => {
        const v = guard(galleryPageSchema, { url });
        if (!v) return badRequest;
        return galleryFetchPage(v.url);
    },
    galleryRenderPage: async (url) => {
        const v = guard(galleryPageSchema, { url });
        if (!v) return badRequest;
        return galleryRenderPage(v.url);
    },
    galleryDownloadCandidates: async (input) => {
        const v = guard(galleryDownloadSchema, input);
        if (!v) return badRequest;
        return galleryDownloadCandidates(v);
    },
    galleryImportCandidates: async (input) => {
        const v = guard(galleryImportCandidatesSchema, input);
        if (!v) return badRequest;
        return galleryImportCandidates(v);
    },
    // 三个登录态入口共用抓页的 httpUrl 校验（拒绝非 http(s) 的奇怪输入）
    galleryChromeLogin: async (url) => {
        const v = guard(galleryPageSchema, { url });
        if (!v) return badRequest;
        return galleryChromeLogin(v.url);
    },
    galleryChromeSync: async (url) => {
        const v = guard(galleryPageSchema, { url });
        if (!v) return badRequest;
        return galleryChromeSync(v.url);
    },
    galleryChromeClear: async () => galleryChromeClear(),
};

// 别名读回：只返回有值的键（未设置/被清空的工具不出现）
function readToolAliases(): ToolAliases {
    const out: ToolAliases = {};
    for (const id of TOOL_IDS) {
        const v = getSetting(`toolAlias:${id}`, "");
        if (v) out[id] = v;
    }
    return out;
}

// 字体设置读回：空串 = 用默认字体栈（拼接在渲染端 fonts.ts 做）
function readFontConfig(): FontConfig {
    return { uiFont: getSetting("uiFont", ""), monoFont: getSetting("monoFont", "") };
}

// 主题读回：脏值（手改库）一律回落深色
function readThemeSetting(): ThemeId {
    return getSetting("theme", "dark") === "light" ? "light" : "dark";
}

// 字体键一次性迁移（幂等，风格同 experts.ensureSeeded）：旧版等宽字体存在
// settings 键 termFont 下，且只作用于终端；字体体系改造后统一为 monoFont 键
// （界面/终端/代码块共用），非空旧值搬过去，用户已设的终端字体不丢。
// termFont 键保留在库里不再读取——个人工具不值得为省一行记录加删键逻辑。
const FONTS_MIGRATED_FLAG = "fontsMigrated";
function migrateTermFont(): void {
    if (getSetting(FONTS_MIGRATED_FLAG, "") === "1") return;
    db.transaction(() => {
        const oldFont = getSetting("termFont", "");
        if (oldFont && !getSetting("monoFont", "")) setSetting("monoFont", oldFont);
        setSetting(FONTS_MIGRATED_FLAG, "1");
    })();
}
migrateTermFont();
