# 内置工具设计规范

> 版本：v1（2026-08-27，从 json / qr / scan / files / translate 五个工具的实现提炼成文）
> 适用范围：以后新增或改动的一切内置工具。规范与现有代码一一对应；两者冲突时先改这里的对应条目，再动代码。

## 1. 工具的两种形态

动笔前先判定形态，它决定了要不要动 server/：

| 形态 | 例子里 | 判定 |
| --- | --- | --- |
| 纯前端工具 | json / qr / scan | 渲染进程自己能完成：纯计算、纯 JS 库、剪贴板、摄像头 |
| 带主进程的工具 | files / translate | 需要 Node 能力：子进程、文件系统、不受 CORS 的网络请求、密钥、settings 表 |

判定标准只有一条：**需要 Node API、密钥或跨域请求，就必须走主进程**。渲染进程没有 Node 环境（硬性规则 1），qrcode / @zxing 这类纯 JS 库则直接留在前端。

## 2. id 与注册（唯一事实来源链）

新增工具按固定顺序改三处，漏一处 `pnpm typecheck` 即报错：

1. `server/schemas.ts`：`TOOL_IDS` 尾部追加 id（小写短词）。工具别名按 `toolAlias:<id>` 存库，id 词汇必须前后端共享，所以事实来源在 schemas 而非 registry。带主进程的工具把请求/配置的 zod schema 也写在这里。
2. `src/tools/registry.ts`：`TOOLS` 数组追加一条 `ToolMeta`。
3. `src/i18n/zh.ts` 与 `en.ts` **同时**补 `tool.<id>.name` / `tool.<id>.desc`（en 用 `Record<MessageKey, string>` 强制对齐）。

`acceptsText` 只给「能吃文本素材」的工具标（见 §4）。

## 3. 组件契约（src/tools/）

- 文件放 `src/tools/<Name>Tool.tsx`：语义名 + Tool 后缀（先例：id 是 `files`，文件叫 `FileSearchTool.tsx`），**默认导出**组件（React.lazy 的要求）。
- props 签名固定为 `{ initialInput?: string | null; openSettings?: () => void }`——registry 的 `ToolMeta.Component` 类型就是它，多传的 props 没人给你传进去。
  - `openSettings` 由 App → ToolsZone 透传，供「缺配置」类状态直达设置页；用不上的工具不接。
- 组件在 registry 里一律 `lazy(() => import(...))`；工具的重依赖在组件文件里**静态 import** 即可——chunk 本身就是懒加载的，关闭即整体卸载。
- 生命周期铁律：**关闭 tab = 卸载组件**，状态与代码库一起释放，重开回初始态；切换 tab 是 `display:none` 保活，草稿不丢。禁止做「重开还原上次内容」——每次启动从空开始是用户决策。

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

## 6. 带主进程的工具（server/）

- 业务模块放 `server/<name>.ts`，纯函数风格；失败返回判别联合（参考 `youdao.ts` 的 `YoudaoResult`），不抛异常。
- 接口三连是全项目固定动作：`MpApi`（server/api.ts）→ 同文件 `apiHandlers` → `src/api/client.ts` 转发，三方签名由类型串起来。
- 入参 zod schema 放 schemas.ts，处理器入口 `guard()` 校验；schema 顺带兜住注入面（如 files 的 exts 只放行 `[a-z0-9]`，防注入 Everything 语法）。
- 返回 `ApiResult<T>`。新错误 kind 的命名：依赖名或场景名的小写单词（`everything` / `youdao` / `not-configured`），要附带信息就带字段（`code` / `path`），并在 `ApiError` 的注释里补一行语义。
- **密钥只存 settings 表**，不进渲染包；网络请求一律主进程发（CORS 与密钥安全双重要求）。
- 渲染端需要与 schema 对齐的词汇表（如语言下拉）时**手工复制一份**——渲染进程禁止运行时 import server/ 的值，zod 在主进程兜底。
- 外部依赖不可用属可预期错误，走工具内的行内引导，不要只 toast：files 的 Everything 引导页（官网 + 重试）、translate 的 `noConfig` 态（`openSettings` 直达设置）是两个范式。
- 平台受限的工具做双层守卫：前端进 `winOnly` 之类的提示态后不再发请求，主进程对非目标平台返回错误兜底。

## 7. 交互与 UI 约定

- **状态机**：`"idle" | "loading" | "done" | "error"` 为基线，按需加工具特定态（`winOnly` / `noConfig`），一个 useState 字符串判别联合，渲染按态分支。
- **异步竞态**（输入驱动请求的工具必备）：防抖 300–600ms + `seq` ref 序号，晚归旧包直接丢弃；清理函数取消定时器；输入清空时推进序号并回 idle。FileSearchTool / TranslateTool 是同款范式。
- **操作反馈**：sonner toast；成功用具体文案，失败兜底 `toast.error`。复制走 `navigator.clipboard` + try/catch。
- **视觉骨架**（与现有工具保持一致，具体值可微调但不要另起炉灶）：
  - 根容器吃满 `h-full`；默认纵向流 `flex flex-col gap-2 p-3`，表单/画布类可 `p-4`（qr 先例）；
  - 结果区 `min-h-0 flex-1 overflow-auto`，工具条 `flex-none`；
  - 按钮 `tbtn border border-line px-2.5 py-1 text-[12px] hover:bg-faint`，文案格式 `[ xxx ]`；
  - 输入框 `border-line bg-bg font-mono text-[12.5px]` 家族。
- **键盘**：Enter 执行首选项/打开，Ctrl+Enter 绕过防抖立即提交（translate 先例），列表用方向键移动选中。

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
