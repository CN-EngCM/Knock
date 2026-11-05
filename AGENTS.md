# AGENTS.md

本文件给 AI 编码代理（及新协作者）提供本仓库的工作须知，也是项目演进的唯一事实来源（v2.0–v2.2 需求已全部实施，历史需求/计划文档已删，需要时从 git 历史查阅）。



## 项目是什么

敲敲（Knock）：个人启动器（网页收藏 / 本机应用 / 文件快捷方式 / 终端命令）。Electron 托盘常驻，**双击 Ctrl** 呼出主窗口，无 TCP 端口、无 HTTP 服务、单机单用户。同时是 TypeScript 学习项目——可读性优先，禁止过度设计与炫技，这是硬约束。

界面为 GaN.UI 中性灰体系（来源仓库 `D:\MyCode\GaN.UI`，源码基线 v1.5.4（提交 `0edf835`），组件复制于 `src/renderer/src/components/ui/`，令牌与材质全在 `src/renderer/src/index.css`）：**深浅双主题**，深色默认（冷调石墨）、浅色为「薄雾」（淡蓝灰底，色系经上游承自 Darwin 取色），强调色（深 `#0a84ff` / 浅 `#4f46e5`），字体 Outfit（可变）+ IBM Plex Mono（woff2 内嵌于 `src/renderer/src/assets/fonts/`，**不引入 MiSans、不引入 Geist**）。主题唯一权威来源是 settings 表 `theme` 键（dark/light）：主进程开窗前直读定窗口 `backgroundColor`；渲染端 `index.html` 内联脚本经 preload 的 sendSync 同步桥（`getThemeSync`）在首帧前给 `<html>` 套 `.dark` 类，切换时顶栏/设置分段控件即点即换并经 `mp:set-theme` 通知主进程更新窗口外观。窗口**无边框**（`frame:false`），窗口边缘圆角与描边全归 OS 不自画，拖拽区覆盖整个顶栏的品牌和空白区域，搜索框、按钮和弹出内容保留 `app-no-drag` 以正常接收输入事件。主结构：顶栏（品牌拖拽区 + 搜索（候选只收全局条目，工作区条目只在工具栏出现）+ 工具集菜单/钉住/置顶/侧栏开关/主题切换/设置常驻；钉住=失焦不自动隐藏且双击 Ctrl 不再收起、跨重启保持，置顶是钉住下的子状态、仅本次运行有效，未钉住时置顶按钮禁用）+ 左侧快捷启动列表（固定宽度 246px，与工具区直接相邻，只显示 `workspace_id` 为空的全局条目；标题行右侧一个「＋」直接打开添加条目弹窗，没有添加菜单与排序开关；列表主体为扁平列表（`LauncherList`，`role="listbox"` + `aria-activedescendant`，焦点常驻容器、↑↓/Home/End/Enter 导航，不再依赖 GaN.UI Tree），无分组、无拖拽，行高 26px 单行，条目行类型图标＋标题、target 悬停提示；顺序固定为 网页收藏 → 应用 → 文件/文件夹 → 终端命令，同类型按标题升序（中文按拼音、忽略大小写），规则只在 `lib/itemOrder.ts` 定义，侧栏与搜索候选共用，新增条目按规则归位而非追加末尾；单击条目即启动（500ms 同条目防抖吞掉连点与双击）、回车同打开；右键菜单为打开/编辑/移动到工作区/删除，目录条目另给「在此打开终端」，无多选，改名一律走弹窗）+ 侧栏顶部工作区块（在快捷启动列表上方，标题行＋新建按钮，行高 32px 单行；列表高度可拖拽并记住：默认 192px（六行）、最小一行、上限为侧栏高度的 70%，双击拖拽条复位，高度存 localStorage，超出就在区块内部滚动；每行左侧一道竖色条，普通工作区按 id 取固定调色板、自带的「临时工作区」取中性灰且不可改名删除、不给右键菜单，当前行另铺同色低透明度底色并套上/左/下三边 1px 同色内描边（右边不画，避免与停靠区左描边并成双线；配色与描边强度只在 `lib/workspaceColor.ts` 和 index.css 的 `--ws-stroke` 令牌里定义），行内显示工作区名与该工作区停靠区里的窗口数（工具＋终端面板总数，悬停提示完整说法）；普通工作区创建时必须选一个现存文件夹，临时工作区没有文件夹，行悬停提示里带完整文件夹路径，右键菜单为重命名/修改文件夹/删除）+ 工作区顶部工具栏（`WorkspaceToolbar`，只在普通工作区、停靠区上方渲染，高 36px 横贯；条目是该工作区专属的快捷启动（`items.workspace_id` = 工作区 id），排序与左栏共用 `sortItems`（类型 → 标题拼音）；条目最前面另有一个固定的「打开当前文件夹」（工作区 folder 非空时显示，不进 items 表）；图标＋标题横向排列，放不下横向滚动，「＋」固定右端，没有条目时只留「＋」；单击行为与左栏一致，右键菜单含打开/在此打开终端/编辑/移动到工作区/删除；临时工作区不渲染）+ 右侧停靠区（GaN.UI `DockLayout`，业务封装 `DockZone.tsx`，底座 dockview-react）：整个停靠区四周有一圈当前工作区标识色的 1px 描边（侧栏原来那条右边线由它兼任，aside 不再自带 border-r），活动标签朝外那侧的标识线在深色主题下也取同一颜色（main 上覆盖 `--dock-focus-top-line` / `--dock-focus-mark`，浅色主题保持原有的白色高光）：每个工作区一套独立的 `DockLayout` 实例，同一时刻只显示当前工作区那套，其余留在 DOM 里以 `display:none` 隐藏（切换不结束任何终端进程、不丢 xterm 回滚缓冲）；工具与终端会话都是停靠面板，id 约定 `tool:<ToolId>`（单实例）与 `term:<会话号>`（多实例），唯一性只在各自实例内成立，不同工作区出现同 id 不冲突；拖标签自由分屏成组、浮动、最大化与中文右键菜单（批量关闭直接执行，终端面板关闭即结束 pty 并释放 xterm 实例；终端标签的 × 与中键关闭先弹确认，右键菜单关闭不确认）；激活权威是 dockview api（App 经 `whenDockApi` 命令桥开/关/激活，队列按工作区分开，桥在该工作区实例就绪前排队）；组头不挂动作区（开工具走顶栏「工具集」菜单，关面板走标签上的 × 与标签右键菜单）；停靠区铺满工作区、不再外套留白与细边框卡片（形状与层次归 dock 皮肤：组间距 `groupGap={4}`、缝色取 `--dock-gap`、组描边取 `--dock-group-border`），深浅主题经 `DockLayout` 自带的 html 类监听自动跟随；dock 随首个面板打开懒加载并常驻，从未开过面板或面板清空时显示 `ToolHome`（前者在 dock 外直渲染避免加载 dockview，后者作水印组件）；删除工作区时先逐个关闭该实例里的面板再删数据行，反过来面板移除善后不触发，pty 会变成没人管的孤儿进程；布局不持久化）。

## 常用命令

```bash
pnpm dev        # electron-vite 三段构建；界面热更新，主进程改动自动重启，预加载改动自动刷新页面
pnpm typecheck  # tsc --noEmit，改完代码必须先过这个
pnpm format     # prettier --write .，改完代码必须跑（风格：双引号/分号/缩进4/行宽 120，见 .prettierrc）
pnpm build      # electron-vite build → out/main、out/preload、out/renderer
pnpm dist:win   # build + electron-builder → Windows 目录版（release/win-unpacked/，无单文件 exe）
pnpm dist:mac   # build + electron-builder → macOS 目录版（release/mac/，arm64，未签名）
```

- 只用 pnpm，版本 **≥11**（`pnpm-workspace.yaml` 用了 v11 的 `allowBuilds` 供应链放行；v9 及更旧会报 packages 字段错误）。`allowBuilds` 与 `nodeLinker: hoisted`（electron-builder 需要扁平 node_modules）都是必要的，别删。
- **`dependencies` 只放原生模块**（better-sqlite3 / uiohook-napi / node-pty），其余纯 JS 依赖一律 `devDependencies`——electron-vite 会把它们打进产物，electron-builder 只按 dependencies 收 node_modules，放错位置包体积会暴涨 ~40MB。`tw-animate-css` 与 `shadcn`（只取其 `shadcn/tailwind.css` 自定义变体）是 GaN.UI 样式的必要依赖，也属此类。
- `pnpm dev` 的渲染服务器监听 `127.0.0.1`，优先使用 5173；端口被占用时自动换端口，electron-vite 经 `ELECTRON_RENDERER_URL` 将实际地址传给主进程。没有开发服务器地址时，主进程加载 `out/renderer/index.html`。
- 使用 electron-vite 5.x 与 Vite 7.x；`electron.vite.config.ts` 分别配置 main / preload / renderer，主进程为 ESM，预加载脚本为单文件 CommonJS，以兼容 `sandbox: true`。
- **node-pty 是 NAPI 单二进制**（`prebuilds/` 随 npm 包分发，ABI 无关），不需要 electron-deps.mjs 做 ABI 切换；electron-vite 默认将 `dependencies` 排除在代码打包之外，electron-builder 必须 asarUnpack（见 electron-builder.yml）。
- `postinstall` 会跑 `scripts/electron-deps.mjs`：把 better-sqlite3 的原生 binding 换成 **Electron ABI** 的预编译。pnpm 默认装的是 Node ABI，直接跑会报 NODE_MODULE_VERSION 不匹配。
- **调试真实窗口**：应用有单实例锁，调试前可以直接结束已运行的实例，不必另搭夹具。启动 Electron 前若终端带着 `ELECTRON_RUN_AS_NODE=1`（部分代理/IDE 环境会注入），先 `Remove-Item Env:ELECTRON_RUN_AS_NODE`，否则 `electron .` 会按 Node 模式跑，主进程 import `BrowserWindow` 直接报错。窗口默认隐藏，起完再跑一个 `electron .` 触发 `second-instance` 即可呼出；需要自动化接管时，构建后用 `electron . --remote-debugging-port=9222` 启动，再 `npx playwright cli attach --cdp=http://127.0.0.1:9222`。

## 架构（electron-vite 三段式）

```text
src/main/index.ts      主进程：窗口/托盘/热键/自启 + IPC 注册 + mpimg:// 协议（图库图片按 id 直读）；加载 server 业务逻辑
src/preload/index.ts   唯一暴露面：通用 invoke(channel, ...args) + 事件订阅（打开设置 / 呼出含剪贴板素材 / 终端输出 / AI 增量）+ filePathFor（webUtils 桥，拖拽 File 换本机路径）
src/main/clipWatch.ts 剪贴板轮询打点「最后复制时间」，供呼出时判素材时限
src/main/server/api.ts         ★ MpApi 接口 = 前后端唯一契约；apiHandlers 处理器表逐方法实现
src/main/server/*.ts           业务模块（db/launcher/shortcuts/autostart/pty/gallery/chromeLogin/workspaces），纯函数风格
src/renderer/         渲染进程入口 index.html；src/ 下为 React 界面，api/client.ts 按 MpApi 逐方法转发 invoke
src/renderer/src/tools/            内置工具：registry.ts 注册表（acceptsText 标记；组件一律 React.lazy，关闭即卸载）+ toolInput.ts（素材注入：挂载初值 + 事件双通道）；设计规范见同目录 TOOL_SPEC.md
src/renderer/src/components/       布局组件（SearchBox / LauncherList / WorkspaceBar / WorkspaceToolbar / MoveToWorkspaceMenu / DockZone / DockTerm / ToolHome / ToolsMenu / termStore）
src/renderer/src/components/ui/    GaN.UI v1.5.4 原样复制的组件（button/input/input-group/label/textarea/select/switch/dialog/alert-dialog/context-menu/menu/tooltip/kbd/empty/spinner/sonner/tabs/badge/card/field/item/marker/separator/toolbar/statusbar/progress/toggle/toggle-group/titlebar/action-bar/tree/drag/direction/combobox/dock-layout（含 dock-layout.css） 等）；cn 用本项目 lib/utils 的 clsx+tailwind-merge，未引入 cn 包
src/renderer/src/lib/            上游支撑模块（platform / shortcut / density / scroll，上游原样）+ 项目自有的 lib
```

**改接口的固定动作**：`MpApi`（src/main/server/api.ts）→ `apiHandlers` 同文件实现 → `src/renderer/src/api/client.ts` 转发。三方签名由类型串起来，漏一处 `pnpm typecheck` 即报错。

**GaN.UI 同步约定**：`components/ui/` 与上游支撑模块（`lib/platform|shortcut|density|scroll`、`hooks/use-overlay-density|use-size-token`）保持上游原样（2 空格、无分号），`.prettierignore` 已排除，改它们等于放弃下次整文件 diff。本地只有三处差异，别的都要么回上游、要么放业务层：① `lib/utils.ts` 用 `extendTailwindMerge` 把 `micro/caption/small/control/readout/display` 登记进 font-size 组（替代上游的 `cn` 包）；② `index.css` 同时定义 `gan-drag`/`gan-no-drag` 与项目现有的 `app-drag`/`app-no-drag`；③ `dialog.tsx` 保留 `onInteractOutside` 阻断（防误触丢表单草稿）。AI 会话区的 `MessageScroller` 经 `hooks/use-virtual-rows` 依赖 `@tanstack/react-virtual`，停靠区经 `ui/dock-layout` 依赖 `dockview-react`（按上游钉死 `8.6.2`），标签编辑经 `ui/combobox` 依赖 `@base-ui/react`，均为 devDependency。

错误约定：可预期错误一律返回 `ApiResult<T>` 判别联合（`{ok:false, error:{kind:...}}`），不靠抛异常、没有状态码。入参在各处理器入口做 zod 校验（schema 在 src/main/server/schemas.ts）。

## 硬性规则

1. **渲染进程（src/renderer/）禁止运行时 import src/main/ 或 src/preload/ 的代码**——渲染进程没有 Node 环境。只允许 `import type`（编译期擦除，安全）。
2. **Electron 锁在 42.x**：better-sqlite3 的预编译通常落后最新 Electron 一个大版本。升级前先确认预编译存在，否则 electron-deps.mjs 会拉不到二进制。
3. **UI 文案一律走 i18n 字典**（src/renderer/src/i18n/）：zh.ts 是 key 的事实来源，en.ts 用 `Record<MessageKey, string>` 强制对齐，两边必须同时改。界面语言与注释都用中文。
4. **注释解释「为什么」**，不复述代码；重点写类型设计意图与平台差异坑。
5. 单仓库单 package，不引新框架/新抽象层；能十行解决不写一百行。
6. **禁止自动 git commit / push**，除非用户明确允许；工作改完停在未提交状态由用户处置。
7. 无测试框架。验证方式 = `pnpm typecheck` + `pnpm format` + `pnpm dev` 人工过一遍改动路径。打包（`pnpm dist:win` / `pnpm dist:mac`）由使用者手动执行，代理只保证 `pnpm build` 通过。
8. **内置工具的新增与修改遵循 [src/renderer/src/tools/TOOL_SPEC.md](src/renderer/src/tools/TOOL_SPEC.md)**（形态判定、id 注册链、素材注入、状态分层、错误与 UI 约定），先读规范再动手。

## 数据与平台

- SQLite（WAL）数据目录默认与 Electron userData 同目录（Windows `%APPDATA%\Knock\mypage.db`，macOS/Linux 对应 Application Support / .config 下的 `Knock`）；实际位置由默认根下 `data-location.json` 指针文件决定，设置里可更改并自动迁移（首次启动弹原生引导选位置；旧目录名 MyPage 的一次性升级迁移在 src/main/server/util/dataLocation.ts）。`settings` 表存：热键、自启、终端程序/字体/字号、工具别名（`toolAlias:<id>`）、剪贴板素材时限（`clipPasteWindow`，秒，0=关）、有道密钥（`youdaoAppKey` / `youdaoAppSecret`）、AI 模型配置 JSON（`aiModels`）、界面主题（`theme`，dark 默认/light，唯一权威来源）、当前工作区（`activeWorkspace`，存工作区 id）、钉住状态（`pinned`，"1"/"0"，置顶不落库）、出厂专家播种标记（`aiExpertsSeeded`）。另有 `experts` 表存 AI 专家（提示词预设）、`workspaces` 表存工作区（名字、文件夹、排序、builtin 标记；临时工作区 folder 为空串）、`items` 表的 `workspace_id` 记条目归属（空 = 左侧快捷启动，数字 = 该工作区的工具栏；删除工作区时外键级联删条目）。旧库只加列不回填，已有条目全部留在左侧；工作区内的面板与会话是运行时状态不落库。图库（工具 gallery）三张 `gallery_*` 表存分组/图片元数据与图片 tag，图片**字节级复制**进数据目录 `gallery/<组文件夹>/` 子目录（组名清洗而来，`file` 列存「组文件夹/文件名」相对路径；sha256 全库去重、缩略图按需生成于 `.thumbs/`，按 id 寻址不分目录），渲染端经 `mpimg://orig|thumb/<id>` 协议直读；`gallery/` 与 favicons 同在 dataLocation 的具名迁移/清理清单里，改数据目录会整体跟随。
- 界面语言、布局偏好（快捷启动列表显隐、工作区块列表高度）存渲染进程 localStorage（换 origin 会重置，已知）。工作区目录落库（见上），但已打开的工具面板与终端会话是运行时状态，**每次启动从空开始（用户决策，勿加还原）**。终端工具在工作区里打开时 cwd 取该工作区文件夹；工作区里的终端命令条目工作目录留空时同样继承工作区文件夹，显式填了就用填的；左侧命令条目留空仍走主目录。改工作区文件夹只影响之后新开的会话。终端工具入口 id 为 `terminal`（属于 ToolId），每个终端会话使用独立数字 id，开成独立 dock 面板（`term:<会话号>`）与其他工具并列：面板 × 关闭即结束 pty；新建会话将 `TERM` 设为 `xterm-256color`、`COLORTERM` 设为 `truecolor`，并清除继承的 `NO_COLOR`，避免启动环境禁用彩色输出；xterm 实例归 `termStore.ts`（与面板生命周期解耦：面板拖动重组只重挂 DOM 不丢回滚缓冲，会话结束才 dispose；实例未就绪前的 pty 输出由它缓冲回放），主题切换经 html 类监听热更新 xterm 配色（不重建进程不清缓冲）。
- 开发平台 Windows 与 macOS；平台相关代码集中在：src/main/server/shortcuts.ts（win 扫开始菜单/桌面 .lnk，mac 扫 /Applications 等处 .app）、src/main/server/everything.ts 与 src/main/server/spotlight.ts（文件搜索双后端：win 走 Everything/es.exe，mac 走 mdfind）、src/main/server/launcher.ts（mac 的 .app 带参走 open -a）、src/main/server/autostart.ts 与 src/main/server/pty.ts（默认 shell 探测）、src/main/server/api.ts 的 revealPath（explorer /select vs open -R）、src/main/tray.ts（mac 托盘模板图），其余保持跨平台写法。
- 热键双击检测依赖 uiohook-napi（NAPI 接口，ABI 无关），隔离在 src/main/hotkey.ts；**macOS 需「辅助功能」授权**（启动时检测，未授权弹原生引导并报 `unauthorized`，授权后重启生效），mac 默认预设为双击 Command（libuiohook 键名 Meta）。预设 id 唯一来源在 schemas.`HOTKEY_IDS`，工具 id 同理（schemas.`TOOL_IDS`，registry 的 ToolId 以它为约束）。

