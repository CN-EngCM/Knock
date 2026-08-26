import db from "./db";
import { autostartStatus, disableAutostart, enableAutostart } from "./autostart";
import { parseNetscapeBookmarks } from "./bookmarks";
import { loadFavicon } from "./favicon";
import { applyHotkey, currentHotkey } from "../electron/hotkey";
import { launchItem } from "./launcher";
import { killSession, readTermConfig, resizeSession, spawnSession, writeSession } from "./pty";
import { scanShortcuts, type Shortcut } from "./shortcuts";
import { getSetting, setSetting } from "./util/settings";
import {
    clipPasteSchema,
    createGroupSchema,
    createItemSchema,
    importSchema,
    HOTKEY_IDS,
    orderSchema,
    ptyResizeSchema,
    ptyWriteSchema,
    termPatchSchema,
    toolAliasPatchSchema,
    updateGroupSchema,
    updateItemSchema,
    TOOL_IDS,
    type Group,
    type HotkeyId,
    type Item,
    type CreateItemInput,
    type OrderInput,
    type TermConfig,
    type TermPatch,
    type ToolAliases,
    type ToolAliasPatch,
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
    | { kind: "not-found" } // 目标分组/条目不存在，或 favicon 未命中
    | { kind: "conflict" } // 组合键被占用 / 自启写入失败
    | { kind: "missing"; path: string } // 启动目标路径不存在
    | { kind: "failed"; path: string }; // 启动器执行失败

/** 统一返回形状：可预期错误走 error 分支（判别联合），不靠抛异常 */
export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError };

export type ImportStats = { createdGroups: number; importedItems: number; skipped: number };

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
    ptySpawn(): Promise<ApiResult<{ id: number; label: string }>>;
    ptyWrite(id: number, data: string): Promise<ApiResult<null>>;
    ptyResize(id: number, cols: number, rows: number): Promise<ApiResult<null>>;
    ptyKill(id: number): Promise<ApiResult<null>>;
    // ── 终端设置（v2.3）：shell 只对新建会话生效，字体/字号作用于全部已有会话 ──
    getTermConfig(): Promise<ApiResult<TermConfig>>;
    setTermConfig(patch: TermPatch): Promise<ApiResult<TermConfig>>;
    // ── 内置工具别名（v2.3）：别名参与顶栏搜索的工具候选匹配 ──
    getToolAliases(): Promise<ApiResult<ToolAliases>>;
    setToolAliases(patch: ToolAliasPatch): Promise<ApiResult<ToolAliases>>;
    // ── 剪贴板素材时限（v2.3）：呼出时最近一次复制落在时限内才自动进搜索框 ──
    getClipPaste(): Promise<ApiResult<{ seconds: number }>>;
    setClipPaste(seconds: number): Promise<ApiResult<{ seconds: number }>>;
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
        if (item.kind === "bookmark") return badRequest; // 书签应前端打开，走到这里是误用
        const err = await launchItem(item);
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
        // applyHotkey 失败 = 组合键被其他程序占用；旧热键保持不变
        const r = applyHotkey(hotkey);
        if (!r.ok) return { ok: false, error: { kind: "conflict" } };
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

    // ── 终端会话：spawn 失败（shell 丢失等）按 not-found 语义返回 ──
    ptySpawn: async () => {
        try {
            return { ok: true, data: spawnSession() };
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

    // ── 终端设置：键值落在 settings 表，读回形状见 pty.readTermConfig ──
    getTermConfig: async () => ({ ok: true, data: readTermConfig() }),
    setTermConfig: async (patch) => {
        const v = guard(termPatchSchema, patch);
        if (!v) return badRequest;
        if (v.shell !== undefined) setSetting("termShell", v.shell);
        if (v.font !== undefined) setSetting("termFont", v.font);
        if (v.fontSize !== undefined) setSetting("termFontSize", String(v.fontSize));
        return { ok: true, data: readTermConfig() };
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
