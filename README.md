# 敲敲 / Knock

个人启动器：本机文件 / 网页收藏 / 应用快捷启动。Electron 托盘常驻，**双击 Ctrl** 敲两下，随叫随到。需求见 [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md)。

## 使用

| 操作 | 方式 |
| --- | --- |
| 呼出 / 隐藏主窗口 | 双击 Ctrl（可在设置页改：双击 Alt/Shift、Alt+Space 等） |
| 搜索 | 呼出后直接打字：下拉候选含条目与内置工具（支持别名），`↑↓` 选择、`Enter` 打开；`/` 随时聚焦搜索框 |
| 剪贴板素材流 | 复制内容后 5 秒内呼出，自动以素材块进入搜索框，下拉置顶推荐可处理它的工具（如 JSON / 网址），`Enter` 一键注入；时限可在设置页调整（0 = 关闭） |
| 内置工具 | json 格式化、二维码生成、条码识别；从搜索候选或右上「工具 ▾」打开，别名在设置页维护 |
| 页内终端 | 多会话 tab（pwsh / powershell / cmd 等，设置页可选）；无会话时终端区自动隐藏，状态栏图标一键重开 |
| 关闭窗口 | 点关闭按钮 = 隐藏（程序继续常驻）；隐藏期间终端会话与内容保留 |
| 退出程序 | 托盘图标右键 → 退出（唯一退出入口） |
| 开机自启 | 设置页开关；自启后只进托盘不弹窗 |

启动总是从干净状态开始：不自动开终端会话、不还原上次打开的工具，右侧显示 ASCII 空态。布局偏好（侧栏宽度、终端高度）仍会记住。

数据存放于用户数据目录下的 `MyPage/`（Windows `%APPDATA%\MyPage`，内含 `mypage.db`；目录名沿用项目旧名，未随更名迁移）。

## 开发

```bash
pnpm install      # postinstall 会自动把 better-sqlite3 对齐到 Electron ABI
pnpm dev          # Vite(5173) + Electron 窗口，改前端热更新；改主进程代码需重启
pnpm typecheck    # TS 类型检查
```

架构要点：业务逻辑是 `server/api.ts` 里的一张处理器表（标准 `ipcMain.handle`，**无 TCP 端口、无框架依赖**），`MpApi` 接口是前后端唯一契约——主进程实现与渲染进程 `client.ts` 都按它写，签名不一致编译期报错；错误走 `ApiResult` 判别联合。参数在处理器入口做 zod 校验。主进程/preload 由 esbuild 打到 `out/`（`scripts/build-main.mjs`）。

## 构建与打包

```bash
pnpm dist         # vite build + esbuild 主进程 + electron-builder → release/ 目录版
```

产物：`release/win-unpacked/`（约 270MB，已裁剪；其中 224MB 是 Electron 本体，属地板价）。整个目录放到任意固定位置运行；**移动程序目录后自启会失效**，重新在设置页开启一次即可。

体积裁剪（已内置，无需手动）：

- `dependencies` 只保留两个原生模块（better-sqlite3 / uiohook-napi），纯 JS 依赖全在 devDependencies——它们已被 Vite/esbuild 打进产物，node_modules 里不留副本
- `electron-builder.yml` 反选掉原生模块的源码与其他平台预编译
- `scripts/afterPack.cjs` 删多余 locales（留中英）、19MB 的 Chromium 许可证汇编、WebGPU 专用的 dxcompiler/dxil（本应用纯 DOM 用不到）

## 维护备注

- **升级 Electron 版本前**先确认 better-sqlite3 发布了对应 ABI 的预编译（通常落后一个大版本，当前锁 42.x；见 `scripts/electron-deps.mjs` 注释）。
- 呼出热键的双击检测依赖 uiohook-napi（NAPI 接口，ABI 无关），隔离在 `electron/hotkey.ts`；若上游失修可退化为纯组合键模式（`globalShortcut`）。
- 重新生成托盘图标（暖黑底纸白 `$`，纯 Node 无依赖）：`node scripts/gen-icon.mjs`。
