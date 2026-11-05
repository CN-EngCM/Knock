import db from "./db";
import { existsSync, statSync } from "node:fs";
import { imagesOfWorkspace, removeNoteFiles } from "./notes";
import { getSetting, setSetting } from "./util/settings";
import type { Workspace } from "./schemas";
// type-only import 编译期擦除，不构成运行时循环依赖
import type { ApiResult } from "./api";

// ── 工作区：每个工作区一套独立的停靠区 ──
// builtin 行是自带的「临时工作区」：名字由渲染端按标记显示 i18n 文案（库里存空串），
// 不可删除、不可改名，排序恒在其余工作区之前。

const ACTIVE_KEY = "activeWorkspace";

type WorkspaceRow = { id: number; name: string; folder: string; builtin: number; position: number };

// better-sqlite3 的 .all()/.get() 返回 unknown[]，在 SQL 边界断言成行类型（同 experts.ts 约定）
function toWorkspace(row: WorkspaceRow): Workspace {
    return { id: row.id, name: row.name, folder: row.folder, builtin: row.builtin !== 0, position: row.position };
}

/** 工作区文件夹必须是现存目录：失效路径在启动/开终端时另有提示，创建与修改阶段直接拒绝 */
function isDirectory(folder: string): boolean {
    if (!existsSync(folder)) return false;
    try {
        return statSync(folder).isDirectory();
    } catch {
        return false;
    }
}

/** 幂等播种：builtin 行自身就是标记——它删不掉，存在即已播种，不像专家那样另记 settings 标记 */
export function ensureSeeded(): void {
    if (db.prepare("SELECT 1 FROM workspaces WHERE builtin = 1").get()) return;
    db.prepare("INSERT INTO workspaces (name, position, builtin) VALUES ('', 0, 1)").run();
}

/** 全量工作区（临时的恒在第一）+ 生效 id。activeWorkspace 无效时只读回落到临时的，不写回 */
export function listWorkspaces(): ApiResult<{ workspaces: Workspace[]; activeId: number }> {
    const rows = db.prepare("SELECT * FROM workspaces ORDER BY builtin DESC, position, id").all() as WorkspaceRow[];
    const workspaces = rows.map(toWorkspace);
    const saved = Number(getSetting(ACTIVE_KEY, "0"));
    // 读不到或指向已删除的工作区：下发临时的 id，等用户下次显式切换才落库
    const builtinId = workspaces.find((w) => w.builtin)?.id ?? 0;
    const activeId = workspaces.some((w) => w.id === saved) ? saved : builtinId;
    return { ok: true, data: { workspaces, activeId } };
}

export function createWorkspace(name: string, folder: string): ApiResult<{ id: number }> {
    if (!isDirectory(folder)) return { ok: false, error: { kind: "bad-request" } };
    // 新工作区排到最后：MAX(position)+1（与 experts 同款）
    const info = db
        .prepare(
            "INSERT INTO workspaces (name, folder, position, builtin) " +
                "VALUES (?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM workspaces), 0)",
        )
        .run(name, folder);
    return { ok: true, data: { id: Number(info.lastInsertRowid) } };
}

export function renameWorkspace(id: number, name: string): ApiResult<null> {
    const row = db.prepare("SELECT builtin FROM workspaces WHERE id = ?").get(id) as { builtin: number } | undefined;
    if (!row) return { ok: false, error: { kind: "not-found" } };
    if (row.builtin !== 0) return { ok: false, error: { kind: "bad-request" } };
    db.prepare("UPDATE workspaces SET name = ? WHERE id = ?").run(name, id);
    return { ok: true, data: null };
}

// 修改工作区文件夹：只影响之后新开的终端/命令，已开面板各自持有自己的 cwd
export function updateWorkspaceFolder(id: number, folder: string): ApiResult<null> {
    const row = db.prepare("SELECT builtin FROM workspaces WHERE id = ?").get(id) as { builtin: number } | undefined;
    if (!row) return { ok: false, error: { kind: "not-found" } };
    if (row.builtin !== 0) return { ok: false, error: { kind: "bad-request" } };
    if (!isDirectory(folder)) return { ok: false, error: { kind: "bad-request" } };
    db.prepare("UPDATE workspaces SET folder = ? WHERE id = ?").run(folder, id);
    return { ok: true, data: null };
}

// 只删工作区行：停靠区面板是运行时状态，由渲染端先逐个关闭；条目与便签行由外键 ON DELETE CASCADE 一起删，
// 便签图片文件级联管不到，所以先取出文件清单，删行后尽力删文件（删失败不报错）
export function deleteWorkspace(id: number): ApiResult<null> {
    const row = db.prepare("SELECT builtin FROM workspaces WHERE id = ?").get(id) as { builtin: number } | undefined;
    if (!row) return { ok: false, error: { kind: "not-found" } };
    if (row.builtin !== 0) return { ok: false, error: { kind: "bad-request" } };
    const noteImages = imagesOfWorkspace(id);
    db.prepare("DELETE FROM workspaces WHERE id = ?").run(id);
    void removeNoteFiles(noteImages);
    return { ok: true, data: null };
}

/** 生效工作区存 settings 表；临时的也可设为当前，因此不校验 builtin */
export function setActiveWorkspace(id: number): ApiResult<null> {
    const exists = db.prepare("SELECT 1 FROM workspaces WHERE id = ?").get(id);
    if (!exists) return { ok: false, error: { kind: "not-found" } };
    setSetting(ACTIVE_KEY, String(id));
    return { ok: true, data: null };
}
