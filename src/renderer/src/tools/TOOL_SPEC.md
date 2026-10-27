# 内置工具设计规范

> 版本：v1（2026-08-27，从 json / qr / scan / files / translate 五个工具的实现提炼成文）
> 适用范围：以后新增或改动的一切内置工具。规范与现有代码一一对应；两者冲突时先改这里的对应条目，再动代码。

## 1. 工具的两种形态

动笔前先判定形态，它决定了要不要动 src/main/server/：

| 形态 | 例子里 | 判定 |
| --- | --- | --- |
| 纯前端工具 | json / qr / scan | 渲染进程自己能完成：纯计算、纯 JS 库、剪贴板、摄像头 |
| 带主进程的工具 | files / translate | 需要 Node 能力：子进程、文件系统、不受 CORS 的网络请求、密钥、settings 表 |

判定标准只有一条：**需要 Node API、密钥或跨域请求，就必须走主进程**。渲染进程没有 Node 环境（硬性规则 1），qrcode / @zxing 这类纯 JS 库则直接留在前端。

## 2. id 与注册（唯一事实来源链）

新增工具按固定顺序改三处，漏一处 `pnpm typecheck` 即报错：

1. `src/main/server/schemas.ts`：`TOOL_IDS` 尾部追加 id（小写短词）。工具别名按 `toolAlias:<id>` 存库，id 词汇必须前后端共享，所以事实来源在 schemas 而非 registry。带主进程的工具把请求/配置的 zod schema 也写在这里。
2. `src/renderer/src/tools/registry.ts`：`TOOLS` 数组追加一条 `ToolMeta`（必填 `icon`：Lucide 图标组件，工具首页卡片与工具菜单共用）。
3. `src/renderer/src/i18n/zh.ts` 与 `en.ts` **同时**补 `tool.<id>.name` / `tool.<id>.desc`（en 用 `Record<MessageKey, string>` 强制对齐）。

`acceptsText` 只给「能吃文本素材」的工具标（见 §4）。

## 3. 组件契约（src/renderer/src/tools/）

- 文件放 `src/renderer/src/tools/<Name>Tool.tsx`：语义名 + Tool 后缀（先例：id 是 `files`，文件叫 `FileSearchTool.tsx`），**默认导出**组件（React.lazy 的要求）。
- props 签名固定为 `{ initialInput?: string | null; openSettings?: () => void }`——registry 的 `ToolMeta.Component` 类型就是它，多传的 props 没人给你传进去。
  - `openSettings` 由 App → DockZone 透传，供「缺配置」类状态直达设置页；用不上的工具不接。
- 组件在 registry 里一律 `lazy(() => import(...))`；工具的重依赖在组件文件里**静态 import** 即可——chunk 本身就是懒加载的，关闭即整体卸载。
- 生命周期铁律：**关闭 tab = 卸载组件**，状态与代码库一起释放，重开回初始态；切换 tab 是 `display:none` 保活，草稿不丢。禁止做「重开还原上次内容」——每次启动从空开始是用户决策。
- 终端是可多开的工具：注册表只提供入口信息，`Component` 为 `null`，由 App 每次新建独立会话，开成独立 dock 面板（xterm 实例归 termStore，见 components/DockTerm.tsx）。工具菜单、首页卡片和工具搜索共用该入口；关闭面板结束对应会话。
- 唯一例外（同为用户决策，2026-08）：AI 助手的会话经模块级内存 store（`src/renderer/src/tools/aiSessions.ts`）在关 tab 后保留、流继续推进、重开恢复；应用重启仍从空开始（不落盘）。

## 4. 素材注入（acceptsText）

搜索框推荐区会把呼出时限内复制的文本注入工具。约定：

- 文本输入框的值一律来自 `useToolInput(id, initialInput)`（toolInput.ts），它把「挂载吃 pending」与「实时事件」两条通道对组件透明。**不要**自己监听 `TOOL_INPUT_EVENT` 或读模块级 pending——那两个通道的时序坑已经收口在 hook 里。
- `initialInput` 只是 props 契约的一部分（兼容直接挂载的场景），正常链路下素材走 pending 通道；组件只管把它透传给 `useToolInput` 第二参。

## 5. 状态分层（三层，别放错层）

| 层 | 放什么 | 例子 |
| --- | --- | --- |
| 组件 state | 输入草稿、结果集、过滤/排序选择、选中行——关闭即丢，不还原 | files 的 `hits` / `exts` |
| localStorage（渲染进程） | 跨会话的个人偏好，键名 `mypage-<tool>-<key>`，读写都 try/catch | translate 的语言方向 |
| settings 表（主进程） | 主进程要读的配置（密钥等），经 `get/set<XxxConfig>` RPC 读写；主进程每次现读，设置页改完即生效 | youdao 密钥 |

判断口诀：**主进程需要知道的进 settings，只有界面记得住的进 localStorage，两边都不需要的一律组件 state**。

## 6. 带主进程的工具（src/main/server/）

- 业务模块放 `src/main/server/<name>.ts`，纯函数风格；失败返回判别联合（参考 `youdao.ts` 的 `YoudaoResult`），不抛异常。
- 接口三连是全项目固定动作：`MpApi`（src/main/server/api.ts）→ 同文件 `apiHandlers` → `src/renderer/src/api/client.ts` 转发，三方签名由类型串起来。
- 入参 zod schema 放 schemas.ts，处理器入口 `guard()` 校验；schema 顺带兜住注入面（如 files 的 exts 只放行 `[a-z0-9]`，防注入 Everything 语法）。
- 返回 `ApiResult<T>`。新错误 kind 的命名：依赖名或场景名的小写单词（`everything` / `youdao` / `not-configured`），要附带信息就带字段（`code` / `path`），并在 `ApiError` 的注释里补一行语义。
- **密钥只存 settings 表**，不进渲染包；网络请求一律主进程发（CORS 与密钥安全双重要求）。
- 渲染端需要与 schema 对齐的词汇表（如语言下拉）时**手工复制一份**——渲染进程禁止运行时 import src/main/server/ 的值，zod 在主进程兜底。
- 外部依赖不可用属可预期错误，走工具内的行内引导，不要只 toast：files 的 Everything 引导页（官网 + 重试）、translate 的 `noConfig` 态（`openSettings` 直达设置）是两个范式。
- 平台受限的工具做双层守卫：前端进 `winOnly` 之类的提示态后不再发请求，主进程对非目标平台返回错误兜底。
- 带配置的工具新增设置分节时，在 `src/renderer/src/components/dialogs/settings/` 下加一个分节组件 + `SettingsDialog.tsx` 的 `SECTION_DEFS` 登记一行。

## 7. 交互与 UI 约定

- **状态机**：`"idle" | "loading" | "done" | "error"` 为基线，按需加工具特定态（`winOnly` / `noConfig`），一个 useState 字符串判别联合，渲染按态分支。
- **异步竞态**（输入驱动请求的工具必备）：防抖 300–600ms + `seq` ref 序号，晚归旧包直接丢弃；清理函数取消定时器；输入清空时推进序号并回 idle。FileSearchTool / TranslateTool 是同款范式。
- **操作反馈**：sonner toast；成功用具体文案，失败兜底 `toast.error`。复制走 `navigator.clipboard` + try/catch。
- **视觉骨架**（GaN.UI 中性灰体系，令牌见 `src/renderer/src/index.css`，与现有工具保持一致，具体值可微调但不要另起炉灶）：
  - 工具区是 GaN.UI DockLayout 停靠区（components/DockZone.tsx），四周 6px 留白由 DockZone 提供，组边框与标签规格归 dock 皮肤。各工具仅负责面板内部布局，不自行追加外侧留白；
  - 根容器吃满 `h-full`；工具栏一律用 `@/components/ui/toolbar` 的 `Toolbar`（高度取 `--size-toolbar`，regular 43px）+ `ToolbarGroup` / `ToolbarSeparator`，搜索框用 `ToolbarSearch`；默认纵向流 `flex flex-col gap-2 p-3`，表单/画布类可 `p-4`（qr 先例）；
  - 结果区 `min-h-0 flex-1 overflow-auto`，工具条 `flex-none`；双栏编辑器中间用 `border-l border-line` 分隔，代码/结果区底 `bg-well`；
  - 按钮用 `@/components/ui/button` 的 Button 组件（GaN.UI v1.0.0 版）：主操作 `appearance="standard" variant="primary"`（蓝实心），次操作 `appearance="standard" variant="outline"`；工具内默认 **size sm**（h-22px，紧凑工具栏密度），弹窗底部主/次按钮用 **size default**（25px）。按钮文案直接写动词短语，不加方括号装饰；
  - 行内轻量文字动作（复制/打开/清空等）用 `Button appearance="standard" variant="ghost" size="xs"`，11px 与零内边距用 `className` 覆写（`h-auto px-0 text-[11px]`）；危险动作用 `text-destructive`，不再有 `.tbtn` / `.tbtn-danger` 应用类；
  - 图标动作（工具栏图标按钮、行内小图标操作）用 `Button size="icon"`（25px）或紧凑场景 `className="size-7"`（28px）；用 `active` 表达选中（自动写 `data-active` 与 `aria-pressed`）；悬停文案用 `Tooltip`，不要退回原生 `title`；
  - 文字档位：主 `text-foreground` / 次级 `text-muted-foreground` / 较弱 `text-dim-foreground`；悬停填充 `bg-(--state-hover)`、选中行 `bg-(--state-selected)`（库令牌，不要再引入应用层填充令牌）；
  - 空态用 `Empty` 族，加载用 `Spinner` / `Skeleton`，计数用 `Badge`，章节分隔用 `Marker structure="separator"` 或 `Separator`，底部固定信息条用 `StatusBar` + `StatusBarItem`，长任务进度用 `Progress`；
  - 表单行用 `Field` + `FieldLabel`（定宽标签列由 `shared.tsx` 的 `FormRow` 提供），`htmlFor`/`id` 必须成对，点标签要能聚焦控件；
  - 表单控件一律复用 GaN.UI 公共组件：普通单行输入用 `@/components/ui/input` 的 `Input`，固定选项选择用 `@/components/ui/select` 的 `Select`，普通多行输入用 `@/components/ui/textarea` 的 `Textarea`——输入面材质、焦点背景与错误态由组件提供，调用处只保留宽度/高度/布局类。多控件组合的复合输入（输入区内嵌按钮等）用 `@/components/ui/input-group` 的 `InputGroup` 系列，焦点与错误只由容器表达。占满整栏的编辑区 `Textarea` 覆盖 `rounded-none shadow-none dark:shadow-none`，避免内嵌卡片观感；隐藏文件入口 `input type="file"` 保留原生写法（另有可见按钮触发）。
- **键盘**：Enter 执行首选项/打开，Ctrl+Enter 绕过防抖立即提交（translate 先例），列表用方向键移动选中。
- JSON 与翻译的整栏输入区使用聚焦背景色提示，局部覆盖全局键盘焦点轮廓，避免面板内部出现蓝框；普通表单的 `Textarea` 保留公共组件的焦点提示。

## 8. i18n 约定

- `zh.ts` 是 key 的事实来源，`en.ts` 强制对齐，两边必须同时改。
- key 命名：必备 `tool.<id>.name`（显示名小写英文短词，默认与 id 相同）与 `tool.<id>.desc`；工具内部文案用 `<id>.<用途>` 扁平命名（`files.placeholder`、`translate.err.101`）。
- 错误码多的外部依赖可以配一个 `<id>Err.ts` 映射模块（code → MessageKey，未收录返回 null 由调用方兜底），参考 `youdaoErr.ts`。
- 面向用户的错误文案给「原因 + 出路」，如 `translate.err.202` 同时说明多半是密钥不对。

## 9. 新增工具收尾清单

- [ ] `TOOL_IDS` / registry `TOOLS` / zh+en 的 name & desc 三处都加了
- [ ] `pnpm typecheck` + `pnpm format` 通过
- [ ] `pnpm dev` 手过：打开 → 使用 → 关闭 → 重开（回初始态）；`acceptsText` 工具验证两条注入时序（tab 未开时注入、tab 已开时再注入）
- [ ] 带主进程的：zod 校验生效、错误态有行内引导、密钥没进渲染包
- [ ] 平台受限的：非目标平台显示提示页且不发请求
