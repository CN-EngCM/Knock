# AGENTS.md

本文件给 AI 编码代理（及新协作者）提供本仓库的工作须知，也是项目演进的唯一事实来源（v2.0–v2.2 需求已全部实施，历史需求/计划文档已删，需要时从 git 历史查阅）。

## Guidelines

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

### 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

### 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

## 项目是什么

敲敲（Knock）：个人启动器（网页收藏 / 本机应用 / 文件快捷方式 / 终端命令）。Electron 托盘常驻，**双击 Ctrl** 呼出主窗口，无 TCP 端口、无 HTTP 服务、单机单用户。同时是 TypeScript 学习项目——可读性优先，禁止过度设计与炫技，这是硬约束。

## 常用命令

```bash
pnpm dev        # Vite(127.0.0.1:5173) + Electron 窗口；改前端热更新，改主进程代码需重启
pnpm typecheck  # tsc --noEmit，改完代码必须先过这个
pnpm format     # prettier --write .，改完代码必须跑（风格：双引号/分号/缩进4/行宽 120，见 .prettierrc）
pnpm build      # vite build（dist/）+ esbuild 主进程（out/）
pnpm dist       # build + electron-builder → 目录版（release/win-unpacked/，无单文件 exe）
```

- 只用 pnpm。`pnpm-workspace.yaml` 里的 `allowBuilds`（供应链放行清单）与 `nodeLinker: hoisted`（electron-builder 需要扁平 node_modules）都是必要的，别删。
- **`dependencies` 只放原生模块**（better-sqlite3 / uiohook-napi / node-pty），其余纯 JS 依赖一律 `devDependencies`——Vite/esbuild 会把它们打进产物，electron-builder 只按 dependencies 收 node_modules，放错位置包体积会暴涨 ~40MB。
- **node-pty 是 NAPI 单二进制**（`prebuilds/` 随 npm 包分发，ABI 无关），不需要 electron-deps.mjs 做 ABI 切换，但 esbuild 必须标 external、electron-builder 必须 asarUnpack（见 scripts/build-main.mjs 与 electron-builder.yml）。
- `postinstall` 会跑 `scripts/electron-deps.mjs`：把 better-sqlite3 的原生 binding 换成 **Electron ABI** 的预编译。pnpm 默认装的是 Node ABI，直接跑会报 NODE_MODULE_VERSION 不匹配。

## 架构（标准 Electron 三层）

```text
electron/main.ts      主进程：窗口/托盘/热键/自启 + IPC 注册；加载 server 业务逻辑
electron/preload.ts   唯一暴露面：通用 invoke(channel, ...args) + 三个事件订阅（打开设置 / 呼出含剪贴板素材 / 终端输出）
electron/clipWatch.ts 剪贴板轮询打点「最后复制时间」，供呼出时判素材时限
server/api.ts         ★ MpApi 接口 = 前后端唯一契约；apiHandlers 处理器表逐方法实现
server/*.ts           业务模块（db/launcher/favicon/shortcuts/bookmarks/autostart/pty），纯函数风格
src/                  渲染进程 React 界面；src/api/client.ts 按 MpApi 逐方法转发 invoke
src/tools/            内置工具：registry.ts 注册表（acceptsText 标记；组件一律 React.lazy，关闭即卸载）+ toolInput.ts（素材注入：挂载初值 + 事件双通道）；设计规范见同目录 TOOL_SPEC.md
src/components/       布局组件（SearchBox / GroupPanel / ToolsZone / TerminalZone / AsciiSplash / Splitter）
src/lib/dnd.ts        拖拽传感器统一配置，所有 DndContext 必须用它（dnd-kit 默认传感器会吞掉拖拽元素内的点击）
```

**改接口的固定动作**：`MpApi`（server/api.ts）→ `apiHandlers` 同文件实现 → `src/api/client.ts` 转发。三方签名由类型串起来，漏一处 `pnpm typecheck` 即报错。

错误约定：可预期错误一律返回 `ApiResult<T>` 判别联合（`{ok:false, error:{kind:...}}`），不靠抛异常、没有状态码。入参在各处理器入口做 zod 校验（schema 在 server/schemas.ts）。

## 硬性规则

1. **渲染进程（src/）禁止运行时 import server/ 或 electron/ 的代码**——渲染进程没有 Node 环境。只允许 `import type`（编译期擦除，安全）。
2. **Electron 锁在 42.x**：better-sqlite3 的预编译通常落后最新 Electron 一个大版本。升级前先确认预编译存在，否则 electron-deps.mjs 会拉不到二进制。
3. **UI 文案一律走 i18n 字典**（src/i18n/）：zh.ts 是 key 的事实来源，en.ts 用 `Record<MessageKey, string>` 强制对齐，两边必须同时改。界面语言与注释都用中文。
4. **注释解释「为什么」**，不复述代码；重点写类型设计意图与平台差异坑。
5. 单仓库单 package，不引新框架/新抽象层；能十行解决不写一百行。
6. **禁止自动 git commit / push**，除非用户明确允许；工作改完停在未提交状态由用户处置。
7. 无测试框架。验证方式 = `pnpm typecheck` + `pnpm format` + `pnpm dev` 人工过一遍改动路径。打包（`pnpm dist`）由使用者手动执行，代理只保证 `pnpm build` 通过。
8. **内置工具的新增与修改遵循 [src/tools/TOOL_SPEC.md](src/tools/TOOL_SPEC.md)**（形态判定、id 注册链、素材注入、状态分层、错误与 UI 约定），先读规范再动手。

## 数据与平台

- SQLite（WAL）数据目录默认与 Electron userData 同目录（Windows `%APPDATA%\Knock\mypage.db`，macOS/Linux 对应 Application Support / .config 下的 `Knock`）；实际位置由默认根下 `data-location.json` 指针文件决定，设置里可更改并自动迁移（首次启动弹原生引导选位置；旧目录名 MyPage 的一次性升级迁移在 server/util/dataLocation.ts）。`settings` 表存：热键、自启、终端程序/字体/字号、工具别名（`toolAlias:<id>`）、剪贴板素材时限（`clipPasteWindow`，秒，0=关）、有道密钥（`youdaoAppKey` / `youdaoAppSecret`）、AI 模型配置 JSON（`aiModels`）、出厂专家播种标记（`aiExpertsSeeded`）。另有 `experts` 表存 AI 专家（提示词预设）。
- 主题、界面语言、布局偏好（侧栏宽/终端高/终端开关）存渲染进程 localStorage（换 origin 会重置，已知）。已打开工具与终端会话是运行时状态，**每次启动从空开始（用户决策，勿加还原）**。
- 开发主力平台 Windows；平台相关代码集中在 server/shortcuts.ts（仅 Windows 快捷方式扫描）、server/autostart.ts 与 server/pty.ts（默认 shell 探测），其余保持跨平台写法。
- 热键双击检测依赖 uiohook-napi（NAPI 接口，ABI 无关），隔离在 electron/hotkey.ts；预设 id 唯一来源在 schemas.`HOTKEY_IDS`，工具 id 同理（schemas.`TOOL_IDS`，registry 的 ToolId 以它为约束）。

