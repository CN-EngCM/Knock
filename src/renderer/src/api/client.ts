import type { MpApi } from "../../../main/server/api";
import type { PtyEvent } from "../../../main/server/pty";
import type { AiEvent } from "../../../main/server/ai";
import type { ThemeId } from "../../../main/server/schemas";

// 类型再导出：前端组件从这里拿行类型，避免组件重复引用主进程模块的深路径
export type {
    Item,
    Workspace,
    Note,
    NoteImage,
    Kind,
    HotkeyId,
    CreateItemInput,
    UpdateItemInput,
    ShellId,
    ShellOption,
    TermConfig,
    TermPatch,
    ThemeId,
    FontConfig,
    FontPatch,
    ToolId,
    ToolAliases,
    ToolAliasPatch,
    FileSearchInput,
    FileSortId,
    TranslateConfig,
    TranslateConfigPatch,
    TranslateInput,
    YoudaoLangId,
    AiModelConfig,
    AiProviderId,
    AiEffortId,
    AiChatInput,
    CreateExpertInput,
    UpdateExpertInput,
    Expert,
    GalleryGroup,
    GalleryImage,
    GalleryImportStats,
    GalleryOverview,
    GalleryQueryInput,
    GalleryPageResult,
    GalleryCandidate,
    GalleryDownloadInput,
    GalleryImportCandidatesInput,
} from "../../../main/server/schemas";
export type { ApiResult, ApiError } from "../../../main/server/api";
export type { Shortcut } from "../../../main/server/shortcuts";
export type { FileHit } from "../../../main/server/everything";
export type { DirEntry } from "../../../main/server/fileTree";
export type { TranslateResult } from "../../../main/server/youdao";
export type { PtyEvent } from "../../../main/server/pty";
export type { AiEvent } from "../../../main/server/ai";

declare global {
    interface Window {
        knock: {
            invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
            /** 首帧前同步取持久化主题（index.html 内联脚本用） */
            getThemeSync: () => "dark" | "light";
            hideWindow: () => void;
            setPinned: (v: boolean) => void;
            setTopmost: (v: boolean) => void;
            /** 主题切换即时同步：主进程更新窗口底色与系统边线（持久化另走 api.setTheme） */
            setTheme: (theme: ThemeId) => void;
            /** 拖拽导入取本机路径：Electron 32+ 渲染进程 File 不再带 .path，经 webUtils 在 preload 换 */
            filePathFor: (file: File) => string;
            onOpenSettings: (cb: () => void) => void;
            onFocusSearch: (cb: (clip: string | null) => void) => () => void;
            onPtyEvent: (cb: (e: PtyEvent) => void) => () => void;
            onAiEvent: (cb: (e: AiEvent) => void) => () => void;
        };
    }
}

// preload 的通用 invoke 在这里是 unknown ↔ unknown，用一次断言收窄成
// 「按 MpApi 的方法名与参数调用、返回对应 Promise」——调用点的类型安全
// 由下方 api 对象的 `: MpApi` 标注兜底（实现与契约不符编译期即报错）。
const invoke = window.knock.invoke as <K extends keyof MpApi>(
    channel: K,
    ...args: Parameters<MpApi[K]>
) => Promise<Awaited<ReturnType<MpApi[K]>>>;

// 渲染进程 API：每个方法一行转发到主进程处理器（server/api.ts 的 apiHandlers）。
// 契约、处理器、此处三方的名字与签名由 MpApi 串成一条类型链。
export const api: MpApi = {
    session: () => invoke("session"),
    getData: () => invoke("getData"),
    getWorkspaces: () => invoke("getWorkspaces"),
    createWorkspace: (name, folder) => invoke("createWorkspace", name, folder),
    renameWorkspace: (id, name) => invoke("renameWorkspace", id, name),
    updateWorkspaceFolder: (id, folder) => invoke("updateWorkspaceFolder", id, folder),
    deleteWorkspace: (id) => invoke("deleteWorkspace", id),
    setActiveWorkspace: (id) => invoke("setActiveWorkspace", id),
    createItem: (input) => invoke("createItem", input),
    updateItem: (id, patch) => invoke("updateItem", id, patch),
    moveItem: (id, workspaceId) => invoke("moveItem", id, workspaceId),
    deleteItem: (id) => invoke("deleteItem", id),
    launch: (id) => invoke("launch", id),
    getAutostart: () => invoke("getAutostart"),
    setAutostart: (enabled) => invoke("setAutostart", enabled),
    getHotkey: () => invoke("getHotkey"),
    setHotkey: (hotkey) => invoke("setHotkey", hotkey),
    listShortcuts: (refresh) => invoke("listShortcuts", refresh),
    ptySpawn: (opts) => invoke("ptySpawn", opts),
    ptyWrite: (id, data) => invoke("ptyWrite", id, data),
    ptyResize: (id, cols, rows) => invoke("ptyResize", id, cols, rows),
    ptyKill: (id) => invoke("ptyKill", id),
    clipboardRead: () => invoke("clipboardRead"),
    clipboardWrite: (text) => invoke("clipboardWrite", text),
    getTermConfig: () => invoke("getTermConfig"),
    setTermConfig: (patch) => invoke("setTermConfig", patch),
    getFontConfig: () => invoke("getFontConfig"),
    setFontConfig: (patch) => invoke("setFontConfig", patch),
    getToolAliases: () => invoke("getToolAliases"),
    setToolAliases: (patch) => invoke("setToolAliases", patch),
    getClipPaste: () => invoke("getClipPaste"),
    setClipPaste: (seconds) => invoke("setClipPaste", seconds),
    getTheme: () => invoke("getTheme"),
    setTheme: (theme) => invoke("setTheme", theme),
    getPinState: () => invoke("getPinState"),
    fileSearch: (input) => invoke("fileSearch", input),
    openPath: (path) => invoke("openPath", path),
    revealPath: (path) => invoke("revealPath", path),
    statPath: (path) => invoke("statPath", path),
    listDir: (workspaceId, dir) => invoke("listDir", workspaceId, dir),
    pickDirectory: (defaultPath) => invoke("pickDirectory", defaultPath),
    pickFile: (purpose, defaultPath) => invoke("pickFile", purpose, defaultPath),
    getDataDir: () => invoke("getDataDir"),
    changeDataDir: (target) => invoke("changeDataDir", target),
    translate: (input) => invoke("translate", input),
    getTranslateConfig: () => invoke("getTranslateConfig"),
    setTranslateConfig: (patch) => invoke("setTranslateConfig", patch),
    getAiModels: () => invoke("getAiModels"),
    setAiModels: (models) => invoke("setAiModels", models),
    aiTestModel: (cfg) => invoke("aiTestModel", cfg),
    listExperts: () => invoke("listExperts"),
    createExpert: (input) => invoke("createExpert", input),
    updateExpert: (id, patch) => invoke("updateExpert", id, patch),
    deleteExpert: (id) => invoke("deleteExpert", id),
    aiChat: (input) => invoke("aiChat", input),
    aiChatStop: (streamId) => invoke("aiChatStop", streamId),
    galleryGroups: (password) => invoke("galleryGroups", password),
    galleryCreateGroup: (name) => invoke("galleryCreateGroup", name),
    galleryRenameGroup: (id, name) => invoke("galleryRenameGroup", id, name),
    galleryDeleteGroup: (id) => invoke("galleryDeleteGroup", id),
    gallerySetGroupPrivate: (id, isPrivate) => invoke("gallerySetGroupPrivate", id, isPrivate),
    galleryPasswordState: () => invoke("galleryPasswordState"),
    gallerySetPassword: (password) => invoke("gallerySetPassword", password),
    galleryUnlock: (password) => invoke("galleryUnlock", password),
    galleryImages: (input) => invoke("galleryImages", input),
    galleryAllTags: () => invoke("galleryAllTags"),
    galleryOverview: (password) => invoke("galleryOverview", password),
    gallerySaveThumb: (id, bytes) => invoke("gallerySaveThumb", id, bytes),
    galleryImport: (files, groupId) => invoke("galleryImport", files, groupId),
    galleryPaste: (groupId) => invoke("galleryPaste", groupId),
    gallerySetImageTags: (id, tags) => invoke("gallerySetImageTags", id, tags),
    galleryAddTagsToImages: (ids, tags) => invoke("galleryAddTagsToImages", ids, tags),
    galleryDeleteTag: (tag) => invoke("galleryDeleteTag", tag),
    galleryMoveImages: (ids, groupId) => invoke("galleryMoveImages", ids, groupId),
    galleryDeleteImages: (ids) => invoke("galleryDeleteImages", ids),
    galleryPickFiles: () => invoke("galleryPickFiles"),
    galleryOpenImage: (id) => invoke("galleryOpenImage", id),
    galleryRevealImage: (id) => invoke("galleryRevealImage", id),
    galleryWallAdd: (ids) => invoke("galleryWallAdd", ids),
    galleryWallAddGroup: (groupId) => invoke("galleryWallAddGroup", groupId),
    galleryWallRemove: (ids) => invoke("galleryWallRemove", ids),
    galleryCollectReset: () => invoke("galleryCollectReset"),
    galleryProbeUrl: (url) => invoke("galleryProbeUrl", url),
    galleryRenderPage: (url) => invoke("galleryRenderPage", url),
    galleryDownloadCandidates: (input) => invoke("galleryDownloadCandidates", input),
    galleryImportCandidates: (input) => invoke("galleryImportCandidates", input),
    galleryChromeLogin: (url) => invoke("galleryChromeLogin", url),
    galleryChromeSync: (url) => invoke("galleryChromeSync", url),
    galleryChromeClear: () => invoke("galleryChromeClear"),
    notesList: (workspaceId) => invoke("notesList", workspaceId),
    notesCount: (workspaceId) => invoke("notesCount", workspaceId),
    noteCreate: (input) => invoke("noteCreate", input),
    noteUpdate: (input) => invoke("noteUpdate", input),
    noteDelete: (id) => invoke("noteDelete", id),
    noteOpenImage: (imageId) => invoke("noteOpenImage", imageId),
};

/** 终端输出流订阅（preload 事件通道，不走 MpApi 的请求-响应契约）；返回退订函数 */
export function onPtyEvent(cb: (e: PtyEvent) => void): () => void {
    return window.knock.onPtyEvent(cb);
}

/** AI 对话增量流订阅（mp:ai-event 事件通道）；返回退订函数 */
export function onAiEvent(cb: (e: AiEvent) => void): () => void {
    return window.knock.onAiEvent(cb);
}
