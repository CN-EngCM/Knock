import Database from "better-sqlite3";
import { join } from "node:path";
import { dataDir } from "./util/dataDir";

// SQLite 连接（better-sqlite3 是同步 API，个人工具规模下最简单可靠）。
// WAL 模式提升读写并发表现，对单用户应用无副作用。
const db = new Database(join(dataDir(), "mypage.db"));
db.pragma("journal_mode = WAL");
// 开启外键约束（SQLite 默认关闭）：删除分组时级联删除其条目
db.pragma("foreign_keys = ON");

// 建表语句（幂等）。
// kind 用 CHECK 约束收窄为三种条目类型的联合，脏数据在数据库层就被挡住。
db.exec(`
  CREATE TABLE IF NOT EXISTS groups (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    name     TEXT    NOT NULL,
    position INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS items (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id  INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    kind      TEXT    NOT NULL CHECK (kind IN ('bookmark', 'app', 'file')),
    title     TEXT    NOT NULL,
    target    TEXT    NOT NULL,          -- bookmark: URL / app: 程序路径 / file: 文件或文件夹路径
    args      TEXT,                      -- app 专用：启动参数，可空
    icon      TEXT,                      -- 图标缓存文件名；空 = 用首字母回退
    position  INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  -- AI 助手（工具 ai）的专家：提示词预设。出厂三条由 server/experts.ts 播种——
  -- 不能在这里插（播种要写 settings 标记，db.ts 调 util/settings 会循环依赖）
  CREATE TABLE IF NOT EXISTS experts (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    name     TEXT    NOT NULL,
    prompt   TEXT    NOT NULL,
    multi    INTEGER NOT NULL DEFAULT 0,
    recommend INTEGER NOT NULL DEFAULT 0,
    effort   TEXT    NOT NULL DEFAULT 'default',  -- 思考强度词汇（见 schemas.AI_EFFORT_IDS）
    model_id TEXT    NOT NULL DEFAULT '',
    position INTEGER NOT NULL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_experts_pos ON experts(position);

  CREATE INDEX IF NOT EXISTS idx_items_group ON items(group_id, position);
`);

// 存量库幂等迁移：effort 列是后加的，CREATE IF NOT EXISTS 对已存在的表不补列，
// 老库必须用 ALTER 补上。PRAGMA 探测列存在性后再动（列已在则跳过，重启可重入）。
const expertCols = db.prepare("PRAGMA table_info(experts)").all() as { name: string }[];
if (!expertCols.some((c) => c.name === "effort")) {
    db.exec("ALTER TABLE experts ADD COLUMN effort TEXT NOT NULL DEFAULT 'default'");
}

export default db;
