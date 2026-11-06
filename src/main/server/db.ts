import Database from "better-sqlite3";
import { join } from "node:path";
import { dataDir } from "./util/dataDir";

// SQLite 连接（better-sqlite3 是同步 API，个人工具规模下最简单可靠）。
// WAL 模式提升读写并发表现，对单用户应用无副作用。
const db = new Database(join(dataDir(), "mypage.db"));
db.pragma("journal_mode = WAL");
// 开启外键约束（SQLite 默认关闭）：删除图库分组/图片时级联删除其附属行
db.pragma("foreign_keys = ON");

// 建表语句（幂等）。
// kind 用 CHECK 约束收窄为四种条目类型的联合，脏数据在数据库层就被挡住。
db.exec(`
  CREATE TABLE IF NOT EXISTS items (
    id     INTEGER PRIMARY KEY AUTOINCREMENT,
    kind   TEXT    NOT NULL CHECK (kind IN ('bookmark', 'app', 'file', 'command')),
    title  TEXT    NOT NULL,
    target TEXT    NOT NULL,          -- bookmark: URL / app: 程序路径 / file: 文件或文件夹路径 / command: 命令行
    args   TEXT,                      -- app: 启动参数 / command: 工作目录，可空
    -- 图标包（Material Icon Theme）里的图标名，空 = 自动匹配。旧版这里存过网站图标的缓存文件名，
    -- 现已不用；渲染端认不得的值一律当「自动」，所以老库不用迁移
    icon   TEXT,
    -- 空 = 左侧快捷启动；非空 = 该工作区的快捷启动工具栏。workspaces 表在后面才建，
    -- SQLite 允许外键前向引用，只要插数据时父表已存在
    workspace_id INTEGER REFERENCES workspaces(id) ON DELETE CASCADE
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

  -- 工作区：每个工作区一套独立的停靠区。builtin = 1 是自带的「临时工作区」：
  -- 显示名走渲染端 i18n，库里 name 存空串；不可删除/改名，排序恒在第一。
  -- 播种按 builtin 行存在与否幂等（见 server/workspaces.ts）
  CREATE TABLE IF NOT EXISTS workspaces (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    name     TEXT    NOT NULL,
    folder   TEXT    NOT NULL DEFAULT '',  -- 工作区文件夹；临时工作区为空串
    position INTEGER NOT NULL DEFAULT 0,
    builtin  INTEGER NOT NULL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_workspaces_pos ON workspaces(position);

  -- 图库（工具 gallery）：gallery_ 前缀避开启动器既有的 items 表。
  -- 图片字节级复制进数据目录 gallery/<组文件夹>/（server/gallery.ts），行里只存元数据；
  -- 图片经 mpimg:// 协议按 id 直读（注册见 src/main/app.ts），不经 IPC 传字节
  CREATE TABLE IF NOT EXISTS gallery_groups (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL,
    inbox      INTEGER NOT NULL DEFAULT 0,   -- 1 = 内置收件箱（不可删/改名/打 tag）
    private    INTEGER NOT NULL DEFAULT 0,   -- 1 = 私密分组：图库锁定（未携有效密码）时不随列表下发
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_gallery_groups_inbox ON gallery_groups(inbox, id);

  CREATE TABLE IF NOT EXISTS gallery_images (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id    INTEGER NOT NULL REFERENCES gallery_groups(id) ON DELETE CASCADE,
    title       TEXT    NOT NULL,            -- 原文件名（显示/搜索）
    file        TEXT    NOT NULL UNIQUE,     -- gallery/ 内相对路径「组文件夹/文件名」（撞名加序号后）
    sha256      TEXT    NOT NULL UNIQUE,     -- 内容去重：同内容全库只收一份
    bytes       INTEGER NOT NULL,
    width       INTEGER NOT NULL DEFAULT 0,  -- svg 解不出尺寸存 0
    height      INTEGER NOT NULL DEFAULT 0,
    format      TEXT    NOT NULL,            -- 归一小写；jpeg 归一为 jpg
    source_path TEXT    NOT NULL DEFAULT '', -- 导入来源路径（图片信息展示用）
    created_at  INTEGER NOT NULL             -- 导入时间戳 ms
  );
  CREATE INDEX IF NOT EXISTS idx_gallery_images_group ON gallery_images(group_id, id);
  CREATE INDEX IF NOT EXISTS idx_gallery_images_created ON gallery_images(created_at);

  CREATE TABLE IF NOT EXISTS gallery_tags (
    image_id INTEGER NOT NULL REFERENCES gallery_images(id) ON DELETE CASCADE,
    tag      TEXT    NOT NULL,
    PRIMARY KEY (image_id, tag)
  );
  CREATE INDEX IF NOT EXISTS idx_gallery_tags_tag ON gallery_tags(tag);

  -- 画廊（放映墙）：跨分组的成员籍叠加——图片仍属原分组，这里只记「在不在画廊」。
  -- position = 加入顺序（放映顺序，同批按入参顺序递增）；图片删除时 FK 级联自动移出
  CREATE TABLE IF NOT EXISTS gallery_wall (
    image_id INTEGER PRIMARY KEY REFERENCES gallery_images(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    added_at INTEGER NOT NULL
  );

  -- 便签（工具 notes）：每个工作区一份，删工作区时外键级联删行（图片文件由 server/notes.ts 另行清理）。
  -- 图片文件在数据目录 notes/<图片id>.<format>，与图库完全分开，经 mpimg://note/<图片id> 读取
  CREATE TABLE IF NOT EXISTS notes (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    text         TEXT    NOT NULL DEFAULT '',
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_notes_ws ON notes(workspace_id, created_at DESC, id DESC);

  CREATE TABLE IF NOT EXISTS note_images (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,  -- 不复用 id：mpimg://note/<id> 不会命中旧图缓存
    note_id  INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    format   TEXT    NOT NULL,                  -- jpg/png/gif/webp/bmp，由主进程按文件头判定
    position INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_note_images_note ON note_images(note_id, position);

  -- 分组级 tag 已随功能移除：旧库顺手清表（幂等），新库不再创建
  DROP TABLE IF EXISTS gallery_group_tags;
`);

// 存量库幂等迁移：folder 列是后加的，CREATE IF NOT EXISTS 对已存在的表不补列，
// 老库必须用 ALTER 补上。PRAGMA 探测列存在性后再动（列已在则跳过，重启可重入）。
// 只补列不回填：没有文件夹的旧工作区保留空串，等用户第一次修改时再选目录。
const workspaceCols = db.prepare("PRAGMA table_info(workspaces)").all() as { name: string }[];
if (!workspaceCols.some((c) => c.name === "folder")) {
    db.exec("ALTER TABLE workspaces ADD COLUMN folder TEXT NOT NULL DEFAULT ''");
}

// 存量库幂等迁移：effort 列是后加的，CREATE IF NOT EXISTS 对已存在的表不补列，
// 老库必须用 ALTER 补上。PRAGMA 探测列存在性后再动（列已在则跳过，重启可重入）。
const expertCols = db.prepare("PRAGMA table_info(experts)").all() as { name: string }[];
if (!expertCols.some((c) => c.name === "effort")) {
    db.exec("ALTER TABLE experts ADD COLUMN effort TEXT NOT NULL DEFAULT 'default'");
}

// 存量库幂等迁移：gallery_groups 的 private 列是后加的（私密分组），PRAGMA 探测后
// ALTER 补列。同时把未发布旧方案遗留在库里的 password 列（非空 = 私密组）迁成
// private 标记后废弃——图库密码已统一存 settings 表，分组行不再存密码。
const galleryGroupCols = db.prepare("PRAGMA table_info(gallery_groups)").all() as { name: string }[];
if (!galleryGroupCols.some((c) => c.name === "private")) {
    db.exec("ALTER TABLE gallery_groups ADD COLUMN private INTEGER NOT NULL DEFAULT 0");
    if (galleryGroupCols.some((c) => c.name === "password")) {
        db.exec(`
          UPDATE gallery_groups SET private = 1 WHERE password IS NOT NULL;
          ALTER TABLE gallery_groups DROP COLUMN password;
        `);
    }
}

// 存量库幂等迁移：启动器条目从「分组 → 条目」两层结构改成扁平列表，items 不再有
// group_id/position 两列。SQLite 删列要重建表（标准做法：建新表 → 拷数据 → 删旧表 →
// 改名），因此用 PRAGMA 探测 group_id 是否存在来决定是否重建；新库由上面的 CREATE
// 直接建成扁平结构，命中跳过分支，重启可重入。
// 这同一次重建顺带解决旧库 CHECK 可能不含 'command' 的问题——约束改不了，重建新表时
// 直接写全四值，不必再单独跑一遍重建。
// groups 表是已删除的概念，任何分支都清掉：留着只会让后续维护误以为仍有分组数据。
const itemCols = db.prepare("PRAGMA table_info(items)").all() as { name: string }[];
db.transaction(() => {
    if (itemCols.some((c) => c.name === "group_id")) {
        db.exec(`
          CREATE TABLE items_new (
            id     INTEGER PRIMARY KEY AUTOINCREMENT,
            kind   TEXT    NOT NULL CHECK (kind IN ('bookmark', 'app', 'file', 'command')),
            title  TEXT    NOT NULL,
            target TEXT    NOT NULL,
            args   TEXT,
            icon   TEXT
          );
          INSERT INTO items_new (id, kind, title, target, args, icon)
            SELECT id, kind, title, target, args, icon FROM items;
          DROP TABLE items;
          ALTER TABLE items_new RENAME TO items;
        `);
    }
    // 先重建 items 再删 groups：开着外键时 DROP 父表会触发级联删除，顺序反了条目会被清空
    db.exec("DROP TABLE IF EXISTS groups");
})();

// 存量库幂等迁移：workspace_id 是后加的（条目归属工作区），建表语句对已存在的 items
// 不补列。必须放在上面的 items 重建之后：老库重建出来的 items_new 没有这一列，
// 重建后再探测才能把列补到新表上。只加列不回填，现有条目全部留在左侧快捷启动（NULL）。
const itemColsAfterRebuild = db.prepare("PRAGMA table_info(items)").all() as { name: string }[];
if (!itemColsAfterRebuild.some((c) => c.name === "workspace_id")) {
    db.exec("ALTER TABLE items ADD COLUMN workspace_id INTEGER REFERENCES workspaces(id) ON DELETE CASCADE");
}

export default db;
