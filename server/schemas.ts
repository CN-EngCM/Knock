import { z } from "zod";

// ── 请求体 schema（zod）──
// zod 在 RPC 边界把来自渲染进程的未知参数收窄成可信类型；
// server/api.ts 的处理器入口用它做校验，非法参数返回 bad-request，
// 且类型自动流向渲染进程的 client（MpApi 单一契约）。

// 条目类型：网页收藏 / 本机应用 / 本机文件或文件夹 / 终端命令
export const kindSchema = z.enum(["bookmark", "app", "file", "command"]);

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
    // app: 启动参数；command: 工作目录（可空，空 = 用户主目录）；其余类型为 null
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
// spawn 可选载荷：终端命令条目带 cwd（工作目录）与 label（会话标签 = 条目标题）；
// 状态栏「＋新会话」不传，cwd 缺省主目录、label 用 shell 标签（见 pty.spawnSession）
export const ptySpawnSchema = z.object({
    cwd: z.string().trim().max(1000).optional(),
    label: z.string().trim().max(100).optional(),
});
export type PtySpawnInput = z.infer<typeof ptySpawnSchema>;
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

// PATCH：shell/字号可选，只更新传入的部分（字体已独立为 fontPatchSchema，见下）
export const termPatchSchema = z.object({
    shell: z.enum(SHELL_IDS).optional(),
    fontSize: z.number().int().min(8).max(32).optional(),
});
export type TermPatch = z.infer<typeof termPatchSchema>;

/** 设置页下拉选项：path 是探测到的绝对路径（'auto' 没有） */
export type ShellOption = { id: ShellId; path?: string };

/** 终端设置全量（读回形状）：shells 附带当前平台实际可用的候选 */
export type TermConfig = { shell: ShellId; fontSize: number; shells: ShellOption[] };

// ── 字体设置 ──
// 界面/等宽两个字体走同一套 schema：字体族名允许空格（如 Comic Sans MS），
// 因此只 trim + 限长，不做字符白名单；空串 = 用内置默认字体栈。
export const fontPatchSchema = z.object({
    uiFont: z.string().trim().max(200).optional(),
    monoFont: z.string().trim().max(200).optional(),
});
export type FontPatch = z.infer<typeof fontPatchSchema>;

/** 字体设置读回形状（设置页编辑态用；空串 = 用默认字体栈） */
export type FontConfig = { uiFont: string; monoFont: string };

// ── 内置工具别名（v2.3）──
// id 集合是前后端共享词汇（同 HOTKEY_IDS/SHELL_IDS 的「唯一事实来源」模式）：
// 渲染端工具注册表（src/tools/registry.ts）的 ToolId 以此为约束。
export const TOOL_IDS = ["json", "qr", "scan", "files", "translate", "ai"] as const;
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

// ── AI 助手（工具 ai）──
// 供应商词汇：v1 只做 OpenAI 兼容的 DeepSeek / 智谱两家（新增协议要动 server/ai.ts）；
// 渲染端下拉的词汇表在 src/tools/AiTool.tsx / AiSection.tsx 手工对齐
// （渲染进程禁止运行时 import server/ 的值，zod 在主进程仍会兜底校验）。
export const AI_PROVIDER_IDS = ["deepseek", "zhipu"] as const;
export type AiProviderId = (typeof AI_PROVIDER_IDS)[number];

// 思考强度词汇表（前后端共享，同 TOOL_IDS 的「唯一事实来源」模式；渲染端下拉手工复制）。
// 两家供应商的参数同名 reasoning_effort，取值交集为 low/high/max——DeepSeek 另收 medium，
// 智谱拒绝 medium（实测 400 code 1210「该模型始终思考，不支持关闭思考；请使用 low、high 或 max」，
// 其中 low ≈ 关思考）。词表统一取交集、请求体直传不做映射；default = 不发送该参数（用服务端默认强度）。
export const AI_EFFORT_IDS = ["default", "low", "high", "max"] as const;
export type AiEffortId = (typeof AI_EFFORT_IDS)[number];

// 一套模型配置 = 供应商 + 模型 id + API 密钥。id 是本地标识（UUID），不参与展示
// ——对外显示「供应商 · 模型id」；密钥只进 settings 表，经 client 往返仅存于内存。
export const aiModelConfigSchema = z.object({
    id: z.string().min(1).max(64),
    provider: z.enum(AI_PROVIDER_IDS),
    model: z.string().trim().min(1).max(100),
    apiKey: z.string().trim().min(1).max(200),
});
export type AiModelConfig = z.infer<typeof aiModelConfigSchema>;

/** 整表存储上限 20 套，防 settings 表被塞爆 */
export const aiModelsSchema = z.array(aiModelConfigSchema).max(20);

// 专家六字段（无别名、无排序——按创建顺序即 position）；modelId 空串 = 未绑定模型
export const createExpertSchema = z.object({
    name: z.string().trim().min(1).max(50),
    prompt: z.string().trim().min(1).max(8000),
    multi: z.boolean(),
    recommend: z.boolean(),
    // 思考强度：AI_EFFORT_IDS 词汇表，default = 不发参（见上方注释）
    effort: z.enum(AI_EFFORT_IDS),
    modelId: z.string().trim().max(64),
});
export type CreateExpertInput = z.infer<typeof createExpertSchema>;

// PATCH：全部字段可选只更新传入部分（与 updateItem 同款），id+patch 合并校验
const expertPatchSchema = createExpertSchema.partial();
export const updateExpertSchema = z.object({
    id: z.number().int().positive(),
    patch: expertPatchSchema,
});
export type UpdateExpertInput = z.infer<typeof expertPatchSchema>;

// 单条消息上限 20000 字符 ≈ 长译文/长代码的合理量级；整段 history 上限 200 条兜底。
// effort 必填：渲染端总是有值（专家配置带默认 default），主进程据此决定是否携带 reasoning_effort
export const aiChatSchema = z.object({
    modelId: z.string().trim().min(1).max(64),
    system: z.string().trim().max(8000),
    effort: z.enum(AI_EFFORT_IDS),
    messages: z
        .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(20000) }))
        .min(1)
        .max(200),
});
export type AiChatInput = z.infer<typeof aiChatSchema>;

export const aiChatStopSchema = z.object({ streamId: z.number().int().positive() });

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

export type Expert = {
    id: number;
    name: string;
    prompt: string;
    multi: boolean;
    recommend: boolean;
    /** 思考强度（AI_EFFORT_IDS 词汇）；default = 请求不带 reasoning_effort */
    effort: AiEffortId;
    /** 绑定的 aiModelConfig.id；空串 = 未绑定 */
    modelId: string;
    position: number;
};
