# M7 Electron 化实施计划

> 对应需求文档 v2.0（§3.7、§4.1、§10）。本计划为可执行清单，每步含改动文件与验收标准。
>
> **v2.1 追记（2026-08-26）**：M7.2 原设计的「IPC 桥接保留 Hono（伪 fetch → app.fetch）」
> 已在实施后简化——标准 Electron 形态（`ipcMain.handle` 处理器表 + 类型化 client）
> 取代 Hono 假 HTTP 层，单一契约见 `server/api.ts`。下文 M7.2 描述为当时的历史方案。

## 总体架构

```text
┌──────────────────────────── Electron 主进程 (out/main.mjs) ────────────────────────────┐
│  Hono app（server/app.ts，进程内调用，无端口）                                           │
│    ├─ better-sqlite3（数据沿用 %APPDATA%/MyPage/mypage.db）                              │
│    ├─ launcher / shortcuts / favicon / bookmarks（不变）                                 │
│    └─ autostart（重写：app.setLoginItemSettings）+ hotkey（新增：uiohook/globalShortcut）│
│  窗口管理（关闭=隐藏、状态记忆） / 托盘 / 单实例锁                                        │
└───────────▲──────────────────────────────────────────────────────────────────────────┘
            │ ipcRenderer.invoke('mp:request', url, init) → app.fetch(new Request(...))
┌───────────┴──────────────────────────────────────────────────────────────────────────┐
│  渲染进程（Vite 构建产物 dist/，React UI 基本不变）                                      │
│  preload 只暴露：mypage.request(url, init) + mypage.onOpenSettings(cb)                  │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

关键决策（源自需求 v2.0 §10）：

- **无 TCP**：删 `@hono/node-server` 监听与 token/Host/Origin 三层防线；`/api/session` 只回 `platform`。
- **RPC 不换**：`hono/client` 的自定义 fetch 改走 IPC，主进程序列化 Response（status/headers/body），前端零感知。
- **favicon**：`<img src="/api/favicon/x">` 改为经同一 RPC 取 blob → objectURL（模块级 Map 缓存），开发/生产同一代码路径。
- **书签打开**：渲染进程仍 `window.open`，主进程 `setWindowOpenHandler` → `shell.openExternal`（系统默认浏览器）。
- **自启**：`--hidden` 参数启动（只进托盘不弹窗）；便携版用 `PORTABLE_EXECUTABLE_DIR/FILE` 注册原始 exe 路径。

## M7.1 Electron 脚手架

- 新增 `electron/main.ts`（入口）、`electron/preload.ts`、`electron/tray.ts`、`electron/hotkey.ts`、`electron/windowState.ts`。
- `scripts/build-main.mjs`：esbuild 打包 main → `out/main.mjs`（esm）、preload → `out/preload.cjs`（cjs，沙箱 preload 只允许 CJS）；external：electron、better-sqlite3、uiohook-napi。
- 依赖：`pnpm add -D electron electron-builder esbuild wait-on`（Electron 下载慢时用 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`）；`pnpm.onlyBuiltDependencies` 放行 electron/better-sqlite3/esbuild 的安装脚本。
- package.json：`"main": "out/main.mjs"`；脚本 `dev`（vite + 构建主进程 + electron .，开发态 loadURL http://localhost:5173）、`build`、`dist`。
- 窗口：默认 1000×700 居中、常规边框；关闭=隐藏（托盘退出置 quitting 标记）；`will-navigate` 拦外部地址；单实例锁（二次启动唤起窗口）。

**验收**：`pnpm dev` 弹出 Electron 窗口且页面正常渲染（此阶段 RPC 仍不可用属预期）。

## M7.2 IPC 桥接与防线退役

- `electron/preload.ts`：`contextBridge.exposeInMainWorld('mypage', { request, onOpenSettings })`；webPreferences：`contextIsolation: true, nodeIntegration: false, sandbox: true`。
- `electron/main.ts`：`ipcMain.handle('mp:request')` 把 (url, init) 转 `Request` 交给 `app.fetch`，Response 序列化回传（body 为 string 或 ArrayBuffer，structured clone 直传）。
- `src/api/client.ts`：自定义 fetch 改调 `window.mypage.request`，重建 `Response`；删除 token 存取与 401 重试。
- `server/app.ts`：删 hostGuard、requireToken、`x-mp-token`；`/api/session` 返回 `{ platform }`。
- 删除 `server/index.ts`、`server/token.ts`；`src/App.tsx` 去掉 `setApiToken`。
- `src/components/ItemRow.tsx`：favicon 改 blob 加载；`vite.config.ts` 删 `/api` 代理、加 `base: './'`（生产态 file:// 加载相对资源）。
- `tsconfig.json` 纳入 `electron/**/*.ts` 的类型检查；preload 侧 `window.mypage` 类型声明（`src/api/client.ts` 或 d.ts）。

**验收**：`pnpm typecheck` 过；`pnpm dev` 中增删改条目、拖拽排序、启动应用全部可用。

## M7.3 托盘 / 双击 Ctrl / 热键配置

- `electron/tray.ts`：图标（见 M7.5 生成的 assets/icon.png）；左键=切换显隐；右键菜单：显示主窗口 / 设置 / 退出（唯一退出入口）。「设置」经 `webContents.send('mp:open-settings')` 让前端打开设置对话框（preload 的 `onOpenSettings` 订阅）。
- `electron/hotkey.ts`：预设列表 `['double-ctrl','double-alt','double-shift','alt-space','ctrl-alt-space']`；double-* 用 uiohook-napi 监听对应键 keydown、300ms 内两次触发；组合键用 `globalShortcut.register`，注册失败返回 false 上报冲突。切换配置时先注销旧注册。
- `server/app.ts` 增 `GET /api/hotkey`、`PUT /api/hotkey`（zod 校验 preset id；409=注册冲突），存 settings 表，应用后即时生效。
- `SettingsDialog.tsx` 增「呼出热键」行（预设下拉/按钮组）；i18n 字典补 zh/en 文案。

**验收**：双击 Ctrl 显隐切换；改键为双击 Alt 立即生效；托盘菜单三项均工作；关闭按钮只隐藏、退出仅托盘可达。

## M7.4 自启改造

- 重写 `server/autostart.ts`：`app.setLoginItemSettings` + `app.getLoginItemSettings`；便携版（存在 `PORTABLE_EXECUTABLE_DIR` 时）以原始 exe 路径注册；统一带 `--hidden` 启动参数；主进程据此首启不弹窗。删除原三平台实现与 `distReady` 防呆。
- `SettingsDialog.tsx`：自启行加「便携版移动 exe 后需重新开启」提示（i18n）。

**验收**：开关自启后注册表 Run 项指向便携 exe 原始路径且带 `--hidden`；重启机器仅托盘常驻不弹窗。

## M7.5 打包：electron-builder 便携版

- `scripts/gen-icon.mjs`：纯 Node（zlib+CRC32 手写 PNG）生成 256×256 `assets/icon.png`（暖黑圆角底 + 纸白 `$`，与页面 favicon 同款）。
- `electron-builder.yml`：appId `com.mypage.app`、productName `MyPage`、win `portable` 单目标、icon assets/icon.png（≥256 自动转 ico）、asarUnpack better-sqlite3 与 uiohook-napi、输出 `release/`。
- `.npmrc` 加 `node-linker=hoisted`（pnpm 符号链接会让 electron-builder 拷贝 node_modules 出错），重装依赖。
- `postinstall: electron-builder install-app-deps`（better-sqlite3 对齐 Electron ABI）。
- 脚本：`build` = vite build + build-main；`dist` = build + electron-builder --win portable。

**验收**：`release/` 产出单 exe；在干净目录运行 exe，双击 Ctrl 呼出、数据与开发态一致（同一 %APPDATA%\MyPage）。

## M7.7 文档收尾

- README 重写：开发（pnpm dev 起 Electron）、构建、打包、自启说明。
- REQUIREMENTS.md 实施状态行更新为 M7 完成。

**验收**：新人按 README 可一次跑通 dev 与 dist。

## 风险与回退

| 风险 | 处置 |
| --- | --- |
| uiohook-napi 与当前 Electron 版本不兼容 | 隔离在 hotkey.ts 单模块；退路：仅保留组合键预设（globalShortcut），双击类标注暂不可用 |
| pnpm hoisted 重装后 better-sqlite3 ABI 变化 | install-app-deps 重下预编译；仍失败则 electron-rebuild |
| Electron 二进制下载受阻 | ELECTRON_MIRROR 走 npmmirror |
| 便携版解压目录运行导致自启路径错 | 一律用 PORTABLE_EXECUTABLE_DIR 注册原始路径（M7.4） |
