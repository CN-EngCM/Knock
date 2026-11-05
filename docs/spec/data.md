# 数据与存储规格

长期规格，描述数据存在哪、哪些不落库。改表结构、settings 键或数据目录逻辑时在同一次改动里更新这里；工作规则和命令见 [AGENTS.md](../../AGENTS.md)。

## 数据目录

- SQLite（WAL），默认与 Electron userData 同目录：Windows `%APPDATA%\Knock\mypage.db`，macOS/Linux 对应 Application Support / .config 下的 `Knock`。
- 实际位置由默认根下 `data-location.json` 指针文件决定，设置里可更改并自动迁移。首次启动弹原生引导选位置。
- 旧目录名 MyPage 的一次性升级迁移在 `src/main/server/util/dataLocation.ts`。
- 库结构升级是单向的：旧版本程序打开升级过的库可能启动失败，换最新版本即可。

## settings 表

| 键 | 内容 |
| --- | --- |
| `hotkey` | 呼出热键预设 |
| `termShell` / `termFontSize` | 终端程序 / 字号 |
| `uiFont` / `monoFont` | 界面字体 / 等宽字体（旧键 `termFont` 由 `fontsMigrated` 标记迁到 `monoFont`） |
| `toolAlias:<id>` | 工具别名 |
| `clipPasteWindow` | 剪贴板素材时限，单位秒，0 = 关 |
| `youdaoAppKey` / `youdaoAppSecret` | 有道密钥 |
| `aiModels` | AI 模型配置 JSON |
| `aiExpertsSeeded` | 出厂专家播种标记 |
| `theme` | 界面主题，dark 默认 / light，唯一权威来源 |
| `activeWorkspace` | 当前工作区 id |
| `pinned` | 钉住状态，"1"/"0"（置顶不落库） |
| `galleryPassword` | 图库密码 |
| `window_state` | 窗口尺寸与最大化状态 |

自启不存这里，交给系统登录项（`app.setLoginItemSettings`，见 `src/main/server/autostart.ts`）。

## 其他表

- `experts`：AI 专家（提示词预设）。
- `workspaces`：工作区（名字、文件夹、排序、builtin 标记；临时工作区 folder 为空串）。
- `items`：`workspace_id` 记条目归属，空 = 左侧快捷启动，数字 = 该工作区的工具栏；删除工作区时外键级联删条目。旧库只加列不回填，已有条目全部留在左侧。
- `gallery_groups` / `gallery_images` / `gallery_tags` / `gallery_wall`：图库（工具 gallery）的分组、图片元数据、图片 tag、图片墙。

## 图库文件

- 图片**字节级复制**进数据目录 `gallery/<组文件夹>/` 子目录。组文件夹由组名清洗而来，`file` 列存「组文件夹/文件名」相对路径。
- sha256 全库去重；缩略图按需生成于 `.thumbs/`，按 id 寻址，不分目录。
- 渲染端经 `mpimg://orig|thumb/<id>` 协议直读。
- `gallery/` 与 favicons 同在 dataLocation 的具名迁移/清理清单里，改数据目录会整体跟随。

## 渲染端 localStorage

界面语言、布局偏好（快捷启动列表显隐、工作区块列表高度）、翻译语言和图库操作偏好存这里，键名统一 `mypage-` 开头。换 origin 会重置，已知。

## 不落库的运行时状态

工作区目录落库，但工作区内已打开的工具面板、终端会话和 dock 布局都是运行时状态，**每次启动从空开始（用户决策，勿加还原）**。
