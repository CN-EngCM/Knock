import type { MpApi } from "../../server/api";
import type { PtyEvent } from "../../server/pty";
import type { AiEvent } from "../../server/ai";

// 类型再导出：前端组件从这里拿行类型，避免各处写 '../../server/...' 的深路径
export type {
    Group,
    Item,
    Kind,
    HotkeyId,
    CreateItemInput,
    UpdateItemInput,
    OrderInput,
    ShellId,
    ShellOption,
    TermConfig,
    TermPatch,
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
} from "../../server/schemas";
export type { ApiResult, ApiError, ImportStats } from "../../server/api";
export type { Shortcut } from "../../server/shortcuts";
export type { FileHit } from "../../server/everything";
export type { TranslateResult } from "../../server/youdao";
export type { PtyEvent } from "../../server/pty";
export type { AiEvent } from "../../server/ai";

declare global {
    interface Window {
        knock: {
            invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
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
    createGroup: (name) => invoke("createGroup", name),
    renameGroup: (id, name) => invoke("renameGroup", id, name),
    deleteGroup: (id) => invoke("deleteGroup", id),
    createItem: (input) => invoke("createItem", input),
    updateItem: (id, patch) => invoke("updateItem", id, patch),
    deleteItem: (id) => invoke("deleteItem", id),
    reorder: (payload) => invoke("reorder", payload),
    launch: (id) => invoke("launch", id),
    importBookmarks: (html) => invoke("importBookmarks", html),
    getAutostart: () => invoke("getAutostart"),
    setAutostart: (enabled) => invoke("setAutostart", enabled),
    getHotkey: () => invoke("getHotkey"),
    setHotkey: (hotkey) => invoke("setHotkey", hotkey),
    listShortcuts: (refresh) => invoke("listShortcuts", refresh),
    getFavicon: (domain) => invoke("getFavicon", domain),
    ptySpawn: (opts) => invoke("ptySpawn", opts),
    ptyWrite: (id, data) => invoke("ptyWrite", id, data),
    ptyResize: (id, cols, rows) => invoke("ptyResize", id, cols, rows),
    ptyKill: (id) => invoke("ptyKill", id),
    getTermConfig: () => invoke("getTermConfig"),
    setTermConfig: (patch) => invoke("setTermConfig", patch),
    getFontConfig: () => invoke("getFontConfig"),
    setFontConfig: (patch) => invoke("setFontConfig", patch),
    getToolAliases: () => invoke("getToolAliases"),
    setToolAliases: (patch) => invoke("setToolAliases", patch),
    getClipPaste: () => invoke("getClipPaste"),
    setClipPaste: (seconds) => invoke("setClipPaste", seconds),
    fileSearch: (input) => invoke("fileSearch", input),
    openPath: (path) => invoke("openPath", path),
    revealPath: (path) => invoke("revealPath", path),
    statPath: (path) => invoke("statPath", path),
    pickDirectory: () => invoke("pickDirectory"),
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
};

/** 终端输出流订阅（preload 事件通道，不走 MpApi 的请求-响应契约）；返回退订函数 */
export function onPtyEvent(cb: (e: PtyEvent) => void): () => void {
    return window.knock.onPtyEvent(cb);
}

/** AI 对话增量流订阅（mp:ai-event 事件通道）；返回退订函数 */
export function onAiEvent(cb: (e: AiEvent) => void): () => void {
    return window.knock.onAiEvent(cb);
}
