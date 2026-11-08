# 敲敲 / Knock

个人启动器：网页收藏 / 本机应用 / 文件快捷方式 / 终端命令。Electron 托盘常驻，**双击 Ctrl**（macOS 默认双击 Command）敲两下，随叫随到。

## 使用

| 操作 | 方式 |
| --- | --- |
| 呼出 / 隐藏主窗口 | 双击 Ctrl，macOS 默认双击 Command（可在设置页改：双击 Alt/Shift、Alt+Space 等）；macOS 需先授予「辅助功能」权限 |
| 搜索 | 呼出后直接打字：下拉候选含全局条目与内置工具（支持别名），`↑↓` 选择、`Enter` 打开；`/` 随时聚焦搜索框 |
| 快捷启动 | 左侧列表放网页 / 应用 / 文件 / 终端命令，单击或回车打开，按类型和标题自动排序；网页交给系统浏览器；右键可编辑、删除 |
| 剪贴板素材流 | 复制内容后 5 秒内呼出，自动以素材块进入搜索框，下拉置顶推荐可处理它的工具（如 JSON / 网址），`Enter` 一键注入；时限可在设置页调整（0 = 关闭） |
| 内置工具 | JSON 格式化、文件全盘搜索（Windows 走 Everything，macOS 走 Spotlight）、有道翻译、二维码生成、条码识别、AI 助手、本地图库；从搜索候选或顶栏「工具集」菜单打开，别名在设置页维护 |
| 页内终端 | 每个会话是右侧标签区里的一个标签，与工具标签并列，可开多个；终端程序（pwsh / powershell / cmd / zsh / bash 等）在设置页选；关闭标签即结束会话 |
| 隐藏窗口 | 失焦自动隐藏；系统关闭操作（如 Alt+F4）也只是隐藏，程序继续常驻；钉住后失焦不隐藏，再按热键也不收起；隐藏期间终端会话与内容保留 |
| 退出程序 | 托盘图标右键 → 退出（唯一退出入口） |
| 开机自启 | 设置页开关；自启后只进托盘不弹窗 |

启动总是从干净状态开始：不自动开终端会话、不还原上次打开的工具，右侧显示工具首页。钉住状态和侧栏布局偏好（宽度、是否收成图标条）仍会记住。

数据默认存放在 `%APPDATA%\Knock\`（macOS/Linux 对应 Application Support / .config 下的 `Knock`），内含 `mypage.db`。首次启动可选位置，之后可在设置页更改并自动迁移。

## 开发

```bash
pnpm install      # postinstall 会自动把 better-sqlite3 对齐到 Electron ABI
pnpm dev          # 界面热更新；主进程改动自动重启；预加载脚本改动自动刷新页面
pnpm typecheck    # TS 类型检查
```

架构要点：业务逻辑是 `src/main/server/api.ts` 里的一张处理器表（标准 `ipcMain.handle`，**无 TCP 端口、无框架依赖**），`MpApi` 接口是前后端唯一契约——主进程实现与渲染进程 `client.ts` 都按它写，签名不一致编译期报错；错误走 `ApiResult` 判别联合。参数在处理器入口做 zod 校验。

构建使用 electron-vite 5.x + Vite 7.x，三段配置集中在 `electron.vite.config.ts`：

```text
src/main/index.ts       主进程入口，业务模块在 src/main/server/
src/preload/index.ts    预加载脚本，向界面暴露受限的调用接口
src/renderer/index.html 渲染进程入口，React 代码在 src/renderer/src/
```

开发服务器默认监听 `127.0.0.1:5173`，端口被占用时自动调整并传给主进程。主进程保持 ESM，预加载脚本构建为单个 CommonJS 文件，保留沙箱隔离。

## 构建与打包

```bash
pnpm build        # 三段产物：out/main、out/preload、out/renderer
pnpm dist:win     # 构建 + electron-builder → release/win-unpacked/
pnpm dist:mac     # 构建 + electron-builder → release/mac/
```

产物：`release/win-unpacked/`（约 270MB，已裁剪；其中 224MB 是 Electron 本体，属地板价）。整个目录放到任意固定位置运行；**移动程序目录后自启会失效**，重新在设置页开启一次即可。

> **注意**：打包时 `release/win-unpacked/` 会被整个删除后重建，**不要把数据目录设在 `release/` 下面**，否则数据库和图库会一起被删，且不进回收站、git 也救不回来。

体积裁剪（已内置，无需手动）：

- `dependencies` 只保留三个原生模块（better-sqlite3 / uiohook-napi / node-pty），纯 JS 依赖全在 devDependencies——它们已被 electron-vite 打进产物，node_modules 里不留副本
- `electron-builder.yml` 反选掉原生模块的源码与其他平台预编译
- `scripts/afterPack.cjs` 删多余 locales（留中英）、19MB 的 Chromium 许可证汇编、WebGPU 专用的 dxcompiler/dxil（本应用纯 DOM 用不到）

## 维护备注

- **升级 Electron 版本前**先确认 better-sqlite3 发布了对应 ABI 的预编译（通常落后一个大版本，当前锁 42.x；见 `scripts/electron-deps.mjs` 注释）。
- 呼出热键的双击检测依赖 uiohook-napi（NAPI 接口，ABI 无关），隔离在 `src/main/hotkey.ts`；若上游失修可退化为纯组合键模式（`globalShortcut`）。
- 重新生成托盘图标（暖黑底纸白 `$`，纯 Node 无依赖）：`node scripts/gen-icon.mjs`。
