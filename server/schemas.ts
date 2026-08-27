import { z } from "zod";

// ── 请求体 schema（zod）──
// zod 在 RPC 边界把来自渲染进程的未知参数收窄成可信类型；
// server/api.ts 的处理器入口用它做校验，非法参数返回 bad-request，
// 且类型自动流向渲染进程的 client（MpApi 单一契约）。

// 条目类型：网页收藏 / 本机应用 / 本机文件或文件夹
export const kindSchema = z.enum(["bookmark", "app", "file"]);

export const createGroupSchema = z.object({
    name: z.string().trim().min(1).max(50),
});

// 目前分组只有 name 可改，直接复用创建 schema
export const updateGroupSchema = createGroupSchema;

export const createItemSchema = z.object({
    group_id: z.number().int().positive(),
    kind: kindSchema,
    title: z.string().trim().min(1).max(100),
    target: z.string().trim().min(1).max(1000),
    // app 专用启动参数；其余类型为 null
    args: z.string().trim().max(1000).nullish(),
});

// PATCH：所有字段可选，只更新传入的部分
export const updateItemSchema = createItemSchema.partial();

// 拖拽排序：两数组均可选，按显示顺序传 id，position 由服务端按下标写入
export const orderSchema = z.object({
    groups: z.array(z.number().int().positive()).optional(),
    items: z.array(z.object({ id: z.number().int().positive(), group_id: z.number().int().positive() })).optional(),
});

// 启动条目：只传 id，目标路径等以数据库为准
export const launchSchema = z.object({ id: z.number().int().positive() });

// 书签导入：整个导出 HTML 的文本（Chrome 导出通常几百 KB，上限 10MB 兜底）
export const importSchema = z.object({
    html: z
        .string()
        .min(1)
        .max(10 * 1024 * 1024),
});

// ── 终端会话（v2.2）──
// 输入分片走 IPC，单次上限 8KB（整屏粘贴也远小于此，防误传大负载）
export const ptyWriteSchema = z.object({ id: z.number().int().positive(), data: z.string().max(8192) });
export const ptyResizeSchema = z.object({
    id: z.number().int().positive(),
    cols: z.number().int().min(2).max(500),
    rows: z.number().int().min(2).max(300),
});

// 开机自启开关
export const autostartSchema = z.object({ enabled: z.boolean() });

// 呼出时剪贴板素材的时限（秒）：0 = 关闭自动粘贴
export const clipPasteSchema = z.object({ seconds: z.number().int().min(0).max(60) });

// ── 终端设置（v2.3）──
// shell 用 id 存 settings 表：'auto' = 平台默认探测（Windows pwsh→powershell→cmd，
// 其余 $SHELL→bash），具体 id 由 server/pty.ts 在运行时探测可用性（探不到不出现在下拉里）。
export const SHELL_IDS = ["auto", "pwsh", "powershell", "cmd", "zsh", "bash", "fish", "sh"] as const;
export type ShellId = (typeof SHELL_IDS)[number];

// PATCH：三个字段都可选，只更新传入的部分；font 允许空串 = 回退默认等宽字体栈
export const termPatchSchema = z.object({
    shell: z.enum(SHELL_IDS).optional(),
    font: z.string().trim().max(200).optional(),
    fontSize: z.number().int().min(8).max(32).optional(),
});
export type TermPatch = z.infer<typeof termPatchSchema>;

/** 设置页下拉选项：path 是探测到的绝对路径（'auto' 没有） */
export type ShellOption = { id: ShellId; path?: string };

/** 终端设置全量（读回形状）：shells 附带当前平台实际可用的候选 */
export type TermConfig = { shell: ShellId; font: string; fontSize: number; shells: ShellOption[] };

// ── 内置工具别名（v2.3）──
// id 集合是前后端共享词汇（同 HOTKEY_IDS/SHELL_IDS 的「唯一事实来源」模式）：
// 渲染端工具注册表（src/tools/registry.ts）的 ToolId 以此为约束。
export const TOOL_IDS = ["json", "qr", "scan", "files", "translate"] as const;
export type ToolId = (typeof TOOL_IDS)[number];

// 别名是「空格/逗号分隔的多值字符串」，渲染端自行拆分参与搜索匹配
export const toolAliasPatchSchema = z.object({
    aliases: z.record(z.enum(TOOL_IDS), z.string().trim().max(200)),
});
// zod 的 record 推导要求全键齐全，而补丁只带被改的键——手动标注为 Partial
export type ToolAliasPatch = { aliases: Partial<Record<ToolId, string>> };
/** toolId → 别名串（只含有值的键，空 = 未设别名） */
export type ToolAliases = Partial<Record<ToolId, string>>;

// ── 文件搜索（工具 files：Everything 对接，仅 Windows）──
// only/exts 是查询修饰符，主进程据此拼 Everything 原生语法（/ad、ext:a;b）
export const FILE_SORT_IDS = ["name", "size", "dm"] as const;
export type FileSortId = (typeof FILE_SORT_IDS)[number];

export const fileSearchSchema = z.object({
    query: z.string().trim().min(1).max(500),
    only: z.enum(["all", "file", "folder"]),
    // 后缀只放行小写字母数字（前端 chips 提供固定集合，此处兜底防注入 Everything 语法）
    exts: z.array(z.string().regex(/^[a-z0-9]{1,10}$/)).max(20),
    sort: z.enum(FILE_SORT_IDS),
    ascending: z.boolean(),
    limit: z.number().int().min(1).max(500),
});
export type FileSearchInput = z.infer<typeof fileSearchSchema>;

// 打开/定位动作的目标路径（文件搜索结果的行级动作，不走 DB 条目）
export const pathArgSchema = z.object({ path: z.string().trim().min(1).max(1000) });

// ── 有道文本翻译（工具 translate）──
// 语言代码取有道常用子集（官方完整表 100+，个人使用足够）；渲染端下拉的
// 词汇表在 src/tools/TranslateTool.tsx 手工对齐（渲染进程禁止运行时 import server/ 的值）。
export const YOUDAO_LANG_IDS = [
    "zh-CHS",
    "zh-CHT",
    "en",
    "ja",
    "ko",
    "fr",
    "de",
    "ru",
    "es",
    "pt",
    "it",
    "ar",
    "th",
    "vi",
] as const;
export type YoudaoLangId = (typeof YOUDAO_LANG_IDS)[number];

// 单次上限 5000 字符是接口硬限制（超长报 103）；from 额外允许 auto（服务端检测），to 不允许
export const translateSchema = z.object({
    text: z.string().trim().min(1).max(5000),
    from: z.enum(["auto", ...YOUDAO_LANG_IDS]),
    to: z.enum(YOUDAO_LANG_IDS),
});
export type TranslateInput = z.infer<typeof translateSchema>;

// 密钥补丁：两字段可选只更新传入部分；空串 = 清除（工具随之进入未配置态）
export const translateConfigPatchSchema = z.object({
    appKey: z.string().trim().max(64).optional(),
    secret: z.string().trim().max(128).optional(),
});
export type TranslateConfigPatch = z.infer<typeof translateConfigPatchSchema>;
/** 密钥读回形状（设置页编辑态用；是否已配置由「两者非空」判断） */
export type TranslateConfig = { appKey: string; secret: string };

// ── 呼出热键预设 ──
// id 是前后端唯一事实来源：前端下拉框、zod 校验、electron/hotkey.ts 的
// 机制分发（double-* 走 uiohook 双击检测，其余走 globalShortcut）共用这一份。
export const HOTKEY_IDS = ["double-ctrl", "double-alt", "double-shift", "alt-space", "ctrl-alt-space"] as const;
export type HotkeyId = (typeof HOTKEY_IDS)[number];

export const hotkeySchema = z.object({ hotkey: z.enum(HOTKEY_IDS) });

// ── RPC 输入类型（由 zod schema 推导，主进程处理器与渲染进程共用）──
export type CreateItemInput = z.infer<typeof createItemSchema>;
export type UpdateItemInput = z.infer<typeof updateItemSchema>;
export type OrderInput = z.infer<typeof orderSchema>;

// ── 行类型（与 SQLite 查询结果一一对应，前端经类型化 RPC 复用）──

export type Kind = z.infer<typeof kindSchema>;

export type Group = {
    id: number;
    name: string;
    position: number;
};

export type Item = {
    id: number;
    group_id: number;
    kind: Kind;
    title: string;
    target: string;
    args: string | null;
    icon: string | null;
    position: number;
};
