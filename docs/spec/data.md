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
| `galleryFoldersMigrated` | 图库文件归位迁移已完成，"1" 后启动不再跑；有文件被占用没归位时不写，下次重试 |
| `window_state` | 窗口尺寸与最大化状态 |

自启不存这里，交给系统登录项（`app.setLoginItemSettings`，见 `src/main/server/autostart.ts`）。

## 其他表

- `experts`：AI 专家（提示词预设）。
- `workspaces`：工作区（名字、文件夹、排序、builtin 标记；临时工作区 folder 为空串）。
- `items`：`workspace_id` 记条目归属，空 = 左侧快捷启动，数字 = 该工作区的工具栏；删除工作区时外键级联删条目。旧库只加列不回填，已有条目全部留在左侧。
- `gallery_groups` / `gallery_images` / `gallery_tags` / `gallery_wall`：图库（工具 gallery）的分组、图片元数据、图片 tag、图片墙。
- `notes` / `note_images`：便签（工具 notes）。`notes.workspace_id` 外键级联到 `workspaces`，`created_at` / `updated_at` 是毫秒时间戳；`note_images` 存格式（jpg/png/gif/webp/bmp，主进程按文件头判定）与顺序，外键级联到 `notes`。`note_images.id` 用 `AUTOINCREMENT` 不复用，这样 `mpimg://note/<id>` 不会命中旧图缓存，别改掉。文字不 trim 原样存，全是空白时存空串。

## 便签文件

- 图片字节原样写进数据目录 `notes/<图片id>.<format>`，与图库完全分开，经 `mpimg://note/<图片id>` 读取，不走 IPC 传字节（`mpimg` 的 host 除 `orig|thumb|cand` 外多一个 `note`）。
- 为什么这样存：放项目文件夹的话，临时工作区没有文件夹，改工作区文件夹后便签会「丢」，密钥还可能被误提交进 git；放图库会混进分组和去重规则，删除互相牵扯；图片放 SQLite 的话，一条能有多张图，库涨得快，读写也都压在主进程上。
- 外键级联只删行不删文件，所以删便签、删工作区时代码先查出文件再删行、之后尽力删文件，删失败不报错。保存失败不留半截：先写行再写文件，文件写失败就删掉本次的行和已写文件。
- `notes/` 与 `gallery/`、favicons 同在改数据目录的三处：`util/dataLocation.ts` 的 `migrateDataFiles`、`removeDbArtifacts`，和 `api.ts` 的 `changeDataDir`（它自己单独复制 favicons、gallery、notes，新增数据目录别漏）。

## 图库文件

- 图片**字节级复制**进数据目录 `gallery/<组文件夹>/` 子目录。组文件夹由组名清洗而来，`file` 列存「组文件夹/文件名」相对路径。
- sha256 全库去重；入库时的宽高靠读文件头拿到，不解码（jpg、png、gif、bmp、webp；svg 和读不出的存 0×0，已有的 0×0 行不回填）。
- 缩略图放 `.thumbs/`，按 id 寻址，不分目录：jpg 存 `.jpg`，其余存 `.png` 保透明，svg 不生成。主进程不解码：渲染端的 Worker（`tools/gallery/thumbWorker.ts`）生成后经 `gallerySaveThumb` 存盘。
- 渲染端经 `mpimg://orig|thumb/<id>` 协议读取。`thumb` 没有文件时回 404，渲染端生成后再请求，不回退原图；svg 的 `thumb` 直接回原图。协议开了 `corsEnabled`，响应带 `access-control-allow-origin: *`，页面和 Worker 都能 fetch；它只注册在默认 session，网址导入的隐藏窗口用另一个分区，碰不到。
- 网址导入的候选 `mpimg://cand/<n>` 直接回暂存原图，暂存目录在系统临时目录，入库才进 `gallery/`。

主进程同时管热键、全部 IPC 和终端输入输出，所以图库不在主进程解码，文件操作也都走 `fs/promises`。这样定的依据（Windows 实测，2400 万像素 JPEG）：

- `nativeImage` 解一张要约 125ms，而且解不了 WebP、GIF、BMP。
- `nativeImage.createThumbnailFromPath` 名义上异步，实际同样卡住主线程，不要换回它。
- 在页面线程生成缩略图最长占 49ms，隐藏窗口里还可能卡住不返回，所以放进 Worker，不占主进程。
- `gallery/` 与 favicons 同在 dataLocation 的具名迁移/清理清单里，改数据目录会整体跟随。

## 渲染端 localStorage

界面语言、布局偏好（快捷启动列表显隐、工作区块列表高度）、翻译语言和图库操作偏好存这里，键名统一 `mypage-` 开头。换 origin 会重置，已知。

## 不落库的运行时状态

工作区目录落库，但工作区内已打开的工具面板、终端会话和 dock 布局都是运行时状态，**每次启动从空开始（用户决策，勿加还原）**。
