import db from "./db";
import { getSetting, setSetting } from "./util/settings";
import type { AiEffortId, CreateExpertInput, Expert, UpdateExpertInput } from "./schemas";
// type-only import 编译期擦除，不构成运行时循环依赖
import type { ApiResult } from "./api";

// ── AI 专家：提示词预设的存取 ──
// 专家行是用户数据，与 items 同一待遇；出厂三条只在首次启动播种一次——
// 播种标记落 settings 表，防止「删光后重启又复活」。

const SEED_FLAG = "aiExpertsSeeded";

type ExpertRow = {
    id: number;
    name: string;
    prompt: string;
    multi: number;
    recommend: number;
    effort: string;
    model_id: string;
    position: number;
};

/** 出厂专家（中文提示词是数据不是 UI 文案，不走 i18n）；均未绑定模型，引导用户去设置配置 */
const SEED_EXPERTS = [
    {
        name: "翻译润色",
        prompt: "你是专业翻译。将用户提供的文本在中英文之间互译：中文译成英文，英文译成中文，其他语言译成中文。只输出译文本身，不要附加解释。",
        multi: false,
        recommend: true,
        effort: "default",
    },
    {
        name: "代码解释",
        prompt: "你是资深程序员。解释用户给出的代码：它做什么、关键逻辑、有什么坑。回答用中文，简洁分点。",
        multi: false,
        recommend: false,
        effort: "default",
    },
    {
        name: "头脑风暴伙伴",
        prompt: "你是头脑风暴伙伴。与用户多轮对话，围绕他提出的想法追问、给角度、提反例，帮助他把想法想清楚。语气平等直接，不要一味附和。",
        multi: true,
        recommend: false,
        effort: "default",
    },
] as const;

// better-sqlite3 的 .all()/.get() 返回 unknown[]，在 SQL 边界断言成行类型（同 api.ts 的 as* 约定）
function toExpert(row: ExpertRow): Expert {
    return {
        id: row.id,
        name: row.name,
        prompt: row.prompt,
        multi: row.multi !== 0,
        recommend: row.recommend !== 0,
        // 列值由 zod 校验过的写路径与 DEFAULT 'default' 保证落在词表内，边界处断言一次
        effort: row.effort as AiEffortId,
        modelId: row.model_id,
        position: row.position,
    };
}

export function getExpertById(id: number): Expert | undefined {
    const row = db.prepare("SELECT * FROM experts WHERE id = ?").get(id) as ExpertRow | undefined;
    return row && toExpert(row);
}

/** 幂等播种：settings 标记不存在时插入出厂专家并写标记（api.ts 模块加载时调一次） */
export function ensureSeeded(): void {
    if (getSetting(SEED_FLAG, "") === "1") return;
    const insert = db.prepare(
        "INSERT INTO experts (name, prompt, multi, recommend, effort, model_id, position) VALUES (?, ?, ?, ?, ?, '', ?)",
    );
    db.transaction(() => {
        SEED_EXPERTS.forEach((e, index) =>
            insert.run(e.name, e.prompt, e.multi ? 1 : 0, e.recommend ? 1 : 0, e.effort, index),
        );
        setSetting(SEED_FLAG, "1");
    })();
}

export function listExperts(): ApiResult<Expert[]> {
    const rows = db.prepare("SELECT * FROM experts ORDER BY position, id").all() as ExpertRow[];
    return { ok: true, data: rows.map(toExpert) };
}

export function createExpert(input: CreateExpertInput): ApiResult<Expert> {
    // 新专家排到最后：MAX(position)+1（与 groups/items 同款）
    const info = db
        .prepare(
            "INSERT INTO experts (name, prompt, multi, recommend, effort, model_id, position) " +
                "VALUES (?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM experts))",
        )
        .run(input.name, input.prompt, input.multi ? 1 : 0, input.recommend ? 1 : 0, input.effort, input.modelId);
    const created = getExpertById(Number(info.lastInsertRowid));
    if (!created) return { ok: false, error: { kind: "not-found" } };
    return { ok: true, data: created };
}

/** PATCH 用「读旧行 → 合并 → 整行写回」；缺行按 not-found 返回 */
export function updateExpert(id: number, patch: UpdateExpertInput): ApiResult<Expert> {
    const row = getExpertById(id);
    if (!row) return { ok: false, error: { kind: "not-found" } };
    const next = {
        name: patch.name ?? row.name,
        prompt: patch.prompt ?? row.prompt,
        multi: patch.multi ?? row.multi,
        recommend: patch.recommend ?? row.recommend,
        effort: patch.effort ?? row.effort,
        modelId: patch.modelId === undefined ? row.modelId : patch.modelId,
    };
    db.prepare(
        "UPDATE experts SET name = ?, prompt = ?, multi = ?, recommend = ?, effort = ?, model_id = ? WHERE id = ?",
    ).run(next.name, next.prompt, next.multi ? 1 : 0, next.recommend ? 1 : 0, next.effort, next.modelId, id);
    const updated = getExpertById(id);
    if (!updated) return { ok: false, error: { kind: "not-found" } };
    return { ok: true, data: updated };
}

export function deleteExpert(id: number): ApiResult<null> {
    const info = db.prepare("DELETE FROM experts WHERE id = ?").run(id);
    return info.changes === 0 ? { ok: false, error: { kind: "not-found" } } : { ok: true, data: null };
}
