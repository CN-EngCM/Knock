# AGENTS.md

本仓库的工作须知。每次会话都会加载，只放每次都要知道的规则和去哪儿查。历史需求文档已删，需要时查 git 历史。

## 项目是什么

敲敲（Knock）：个人启动器（网页收藏 / 本机应用 / 文件快捷方式 / 终端命令）。Electron 托盘常驻，**双击 Ctrl** 呼出主窗口，无 TCP 端口、无 HTTP 服务、单机单用户。同时是 TypeScript 学习项目——可读性优先，禁止过度设计与炫技，这是硬约束。

## 动手前先读

| 要做的事 | 先读 |
| --- | --- |
| 改界面、交互、工作区、停靠区、终端面板，或动 GaN.UI 组件 | [docs/spec/ui.md](docs/spec/ui.md) |
| 改表结构、settings 键、数据目录、图库存储 | [docs/spec/data.md](docs/spec/data.md) |
| 新增或修改内置工具 | [TOOL_SPEC.md](src/renderer/src/tools/TOOL_SPEC.md) |
| 启动真实窗口调试、写界面自动化脚本 | [docs/spec/debugging.md](docs/spec/debugging.md) |

## 硬性规则

1. **渲染进程（src/renderer/）禁止运行时 import src/main/ 或 src/preload/**，只允许 `import type`：渲染进程没有 Node 环境。
2. **Electron 锁在 42.x**：better-sqlite3 的预编译通常落后一个大版本，升级前先确认预编译存在。
3. **UI 文案一律走 i18n**（src/renderer/src/i18n/）：zh.ts 是 key 的事实来源，en.ts 必须同时改。界面语言与注释都用中文。
4. **注释解释「为什么」**，不复述代码。
5. 单仓库单 package，不引新框架/新抽象层；能十行解决不写一百行。
6. **禁止自动 git commit / push**，除非用户明确允许。
7. 无测试框架，要引入先问用户。改完代码跑 `pnpm typecheck`、`pnpm format`，再 `pnpm dev` 人工过一遍。打包由使用者手动执行，代理只保证 `pnpm build` 通过。
8. **行为变了，规格同步改**：改了界面行为或数据结构，在同一次改动里更新 `docs/spec/`。产品细节不往本文堆。

不要改回去的决策：

- 工具面板和终端会话每次启动从空开始，不做还原。停靠布局只还原「格子怎么排」（还原出来是一排空格子），不还原里面的面板。
- 窗口边缘圆角与描边全归 OS，不自画。
- 字体只用 Outfit + IBM Plex Mono，不引入 MiSans、Geist。

## 命令与依赖

```bash
pnpm dev        # 界面热更新，主进程改动自动重启，预加载改动自动刷新页面
pnpm typecheck  # 改完代码必须先过
pnpm format     # 改完代码必须跑
pnpm build      # 产物在 out/
pnpm dist:win   # 打包目录版到 release/win-unpacked/（dist:mac 到 release/mac/）
```

- 只用 pnpm，版本 **≥11**。`pnpm-workspace.yaml` 里的 `allowBuilds` 和 `nodeLinker: hoisted` 都是必要的，别删。
- **`dependencies` 只放原生模块**（better-sqlite3 / uiohook-napi / node-pty / koffi），其余一律 `devDependencies`：electron-vite 会把它们打进产物，放错位置包体积暴涨约 40MB。
- `postinstall`（`scripts/electron-deps.mjs`）负责把 better-sqlite3 换成 Electron ABI 的预编译，报 `NODE_MODULE_VERSION` 不匹配就是这步没生效。

## 架构

```text
src/main/index.ts                主进程入口：单实例锁 + scheme 注册 + 启动失败提示
src/main/dataBoot.ts             开库前确定数据目录，所以 app.ts 在它之后才动态加载
src/main/app.ts                  应用主体：窗口/托盘/热键 + IPC 注册 + mpimg:// 协议
src/main/webView.ts              应用内网页（<webview>）的会话与安全：分区、权限、UA、新窗口转发
src/main/server/api.ts           ★ MpApi 接口 = 前后端唯一契约；apiHandlers 逐方法实现
src/main/server/schemas.ts       zod schema 与前后端共享的 id 词汇（HOTKEY_IDS / TOOL_IDS）
src/main/server/*.ts             业务模块，纯函数风格
src/preload/index.ts             渲染进程的唯一暴露面
src/renderer/src/api/client.ts   按 MpApi 逐方法转发 invoke
src/renderer/src/tools/          内置工具
src/renderer/src/components/     业务组件；ui/ 下是 GaN.UI 原样组件
scripts/                         构建、打包和资源生成脚本（测试脚本不放这里）
```

- **改接口**：`MpApi` → 同文件的 `apiHandlers` → `client.ts` 转发。漏一处 `pnpm typecheck` 即报错。
- **错误约定**：可预期错误返回 `ApiResult<T>` 判别联合（`{ok:false, error:{kind:...}}`），不靠抛异常。入参在处理器入口做 zod 校验。
- **GaN.UI**：`components/ui/` 与上游支撑模块（清单见 `.prettierignore`）保持上游原样，改了就没法整文件比对下次同步。
- **跨平台**：开发平台是 Windows 与 macOS。平台差异集中在 `src/main/server/` 的 shortcuts、everything、spotlight、launcher、autostart、pty、foreground 和 api.ts 的 revealPath，以及 `src/main/` 的 tray、hotkey，其余保持跨平台写法。
- **清理目录前先看数据在哪**：数据目录以默认根（Windows `%APPDATA%\Knock\`）下的 `data-location.json` 为准，用户可设到任何位置。打包会整个删掉 `release/win-unpacked/` 再重建，数据放在里面会被一起删。Chromium 的缓存、cookie、`localStorage` 与网页登录态在 `<数据目录>/browser-data/`，默认根里只剩指针和几个锁文件，别把指针当垃圾清掉；改数据目录时这个目录（连同 `chrome-profile`）重启后才搬，见 [docs/spec/data.md](docs/spec/data.md)。

## 文件放哪儿

| 东西 | 位置 | 入库 |
| --- | --- | --- |
| 以后还会再跑的测试脚本、本地假服务 | `tests/scripts/` | 是 |
| 测试输入素材 | `tests/fixtures/` | 是 |
| 运行产物：截图、日志、临时数据目录 | `test-output/<主题>/` | 否，随时可删 |
| 只跑一次的脚本 | 代理或系统的临时目录 | 否 |
| 设计文档 | `docs/design/YYYY-MM-DD-<主题>.md`，配图放同名目录 | 是，验收后删 |
| 实施文档 | `docs/plans/YYYY-MM-DD-<主题>.md` | 是，验收后删 |
| 长期规格 | `docs/spec/`、`TOOL_SPEC.md` | 是，跟代码同步 |

- 根目录的文档只留 `README.md`、`AGENTS.md`、`THIRD_PARTY_NOTICES.md`。除 `TOOL_SPEC.md` 外，`src/` 下不放文档。
- **测试脚本**用 `.mjs` 或 `.cjs`，`node` 直接跑（不参与 typecheck，不进安装包）。文件名用英文小写加短横线，开头注释写测什么、怎么跑。真实密钥不进 `tests/`。
- **产物**不写到根目录、`src/`、`tests/`、`out/`、`dist/`、`release/`。要长期留的图放设计文档的配图目录。
- **设计与实施文档**：用户要求，或改动跨多模块、动数据结构或 `MpApi`、有方案要取舍时才写。设计文档写目标、方案、放弃的方案及原因；实施文档写可打勾的步骤、涉及文件、验收方式。同一件事的两份同名，主题用简短中文，已有同主题文档就接着写，方案变了同步改。代理工具生成的计划也放这里。
- **收尾**：用户验收后，把还成立的结论并入 `docs/spec/`、`TOOL_SPEC.md` 或本文，再删掉文档和配图。
