# 数据与存储规格

长期规格，描述数据存在哪、哪些不落库。改表结构、settings 键或数据目录逻辑时在同一次改动里更新这里；工作规则和命令见 [AGENTS.md](../../AGENTS.md)。

## 数据目录

- SQLite（WAL），默认与 Electron userData 同目录：Windows `%APPDATA%\Knock\mypage.db`，macOS/Linux 对应 Application Support / .config 下的 `Knock`。
- 实际位置由默认根下 `data-location.json` 指针文件决定，设置里可更改并自动迁移。首次启动弹原生引导选位置。
- 旧目录名 MyPage 的一次性升级迁移在 `src/main/server/util/dataLocation.ts`。
- 指针文件内容是 `{"dir": "<数据目录>"}`；刚改过数据目录时多一个 `moveFrom`（旧目录），见下面「浏览器数据」。
- 库结构升级是单向的：旧版本程序打开升级过的库可能启动失败，换最新版本即可。

## 浏览器数据

Chromium 的会话数据（缓存、cookie、`localStorage`、网页面板的 `persist:web` 分区、图库抓取的 `persist:gallery-import` 分区）统一存在 `<数据目录>/browser-data/`，不散在系统里。做法：`src/main/index.ts` 在拿到单实例锁之后、app ready 之前设 `app.setPath("sessionData", ...)`；网页和图库都用普通的 `persist:` 分区，分区会自动落在它下面的 `Partitions/`。

- **默认根里仍有几个极小的文件**：指针、锁文件、`Local State`。应用要先读指针才知道数据目录在哪，没法全放进去。
- **ready 之前要知道数据目录**：全新安装和旧名升级这两种「这次启动才写指针」的情形，引导完成后重启一次（`index.ts`），之后从第一帧起就生效；老用户没有这一步。指针有效但数据目录里没有 `mypage.db`（比如移动硬盘没插）时同样不设，走恢复流程。
- **老版本的散落文件**：旧版把这些 Chromium 文件直接放在默认根里。新版首次启动时，若 `browser-data` 还不存在，`settleBrowserData` 按 `LEGACY_CHROMIUM_NAMES` 这份写死的清单一次性搬进去，搬失败只写日志。
- **改数据目录时，`browser-data` 与 `chrome-profile` 不当场复制，重启后再搬。** 原因：它们正被进程占着，实测 cookie 文件独占，关掉所有网页也不放（整目录复制报 `EACCES`，单文件复制报 `EBUSY`，目录改名报 `EPERM`），Electron 又没有销毁会话的接口。做法：
  - `changeDataDir` 其余数据照旧复制，只在指针里记 `moveFrom`（旧目录），再把会话数据刷盘（`webView.ts` 的 `flushBrowserData`，cookie 默认攒一阵才写、`app.exit` 不等）后重启；
  - 下次启动在 Chromium 起来之前，`settleBrowserData` 把旧目录的这两个目录搬进新目录（同盘改名，跨盘复制再删），然后清掉 `moveFrom`；
  - 搬失败只写日志，网页数据和界面存储从空开始；标记不管成败都清掉，不反复重试；新目录里已有同名目录时不覆盖；
  - `changeDataDir` 收尾清旧目录用 `removeDataFiles`（只删库、favicons、gallery、notes），不碰这两个目录。
- 缓存也在里面，数据目录会随网页浏览变大。没有「清除浏览数据」入口，要清就关掉应用后删 `browser-data/`。

## settings 表

| 键 | 内容 |
| --- | --- |
| `hotkey` | 呼出热键预设 |
| `hotkeyBlockApps` | 呼出热键屏蔽名单：程序文件名的 JSON 字符串数组（小写、带 `.exe`、去重），缺省 `[]`；每次呼出现读，不缓存 |
| `termShell` / `termFontSize` | 终端程序 / 字号 |
| `uiFont` / `monoFont` | 界面字体 / 等宽字体（旧键 `termFont` 由 `fontsMigrated` 标记迁到 `monoFont`） |
| `toolAlias:<id>` | 工具别名 |
| `clipPasteWindow` | 剪贴板素材时限，单位秒，0 = 关 |
| `scratchAutoClose` | 临时工作区小工具自动关闭时长，单位分钟，0 = 关，缺省 10；库里不是 0–1440 的整数时读回默认 |
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
- `workspaces`：工作区（名字、文件夹、排序、builtin 标记；临时工作区 folder 为空串）。`color` 列（`TEXT`，可空）：用户选的标识色 `#rrggbb`（统一存小写），NULL = 渲染端按 id 从调色板自动取；老库用 `PRAGMA` 探测后 `ALTER` 补列，已有工作区全为 NULL、颜色不变。存色值不存调色板下标，调色板以后增删不影响已选的。主进程只校验格式，不认调色板（调色板只在渲染端 `lib/workspaceColor.ts`）；临时工作区拒改。
- `items`：`workspace_id` 记条目归属，空 = 左侧快捷启动，数字 = 该工作区的工具栏；删除工作区时外键级联删条目。旧库只加列不回填，已有条目全部留在左侧。`icon` 列存图标名，空 = 自动匹配：不带前缀是图标包（Material Icon Theme）里的名字，带「库名:」前缀是其他图标库（如 `mdi:home`、`logos:github-icon`，库清单见 `ui.md`「图标库」）；旧版在这列存过网站图标的缓存文件名，现已不用，渲染端认不得的值一律当「自动」，所以无需迁移。主进程只校验格式（可选的 `库名:` 前缀加上字母数字和 `_.-`，名字部分 ≤64），不认图标名（图标包和图标库只在渲染端）。`auto_close` 列（`INTEGER NOT NULL DEFAULT 0`）：仅终端命令有意义，1 = 命令成功后自动关掉终端面板；老库用 `PRAGMA` 探测后 `ALTER` 补列，已有条目全为 0。对外字段是布尔 `autoClose`，SQLite 读出来是 0/1，主进程统一转成布尔再给渲染端；条目弹窗只在类型为终端命令时给这个开关，其他类型一律存 0。
- `gallery_groups` / `gallery_images` / `gallery_tags` / `gallery_wall`：图库（工具 gallery）的分组、图片元数据、图片 tag、图片墙。
- `notes` / `note_images`：便签（工具 notes）。`notes.workspace_id` 外键级联到 `workspaces`；库被「没有工作区」的分支打开过时这一列会被删掉，本分支启动时探测到缺列就重建 `notes`（关外键重建，避免级联清空 `note_images`），旧便签并进临时工作区，`idx_notes_ws` 索引必须在补列之后才建，放进建表语句会让启动直接报 `no such column`。`created_at` / `updated_at` 是毫秒时间戳；`note_images` 存格式（jpg/png/gif/webp/bmp，主进程按文件头判定）与顺序，外键级联到 `notes`。`note_images.id` 用 `AUTOINCREMENT` 不复用，这样 `mpimg://note/<id>` 不会命中旧图缓存，别改掉。文字不 trim 原样存，全是空白时存空串。

## 便签文件

- 图片字节原样写进数据目录 `notes/<图片id>.<format>`，与图库完全分开，经 `mpimg://note/<图片id>` 读取，不走 IPC 传字节（`mpimg` 的 host 除 `orig|thumb|cand` 外多一个 `note`）。
- 为什么这样存：放项目文件夹的话，临时工作区没有文件夹，改工作区文件夹后便签会「丢」，密钥还可能被误提交进 git；放图库会混进分组和去重规则，删除互相牵扯；图片放 SQLite 的话，一条能有多张图，库涨得快，读写也都压在主进程上。
- 外键级联只删行不删文件，所以删便签、删工作区时代码先查出文件再删行、之后尽力删文件，删失败不报错。保存失败不留半截：先写行再写文件，文件写失败就删掉本次的行和已写文件。
- `notes/` 与 `gallery/`、favicons 同在改数据目录的三处：`util/dataLocation.ts` 的 `migrateDataFiles`、`removeDbArtifacts`，和 `api.ts` 的 `changeDataDir`（它自己单独复制 favicons、gallery、notes，新增数据目录别漏）。`browser-data` 与 `chrome-profile` 是例外，见上一节：不复制，重启后搬。

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

界面语言、布局偏好（工作区块列表高度）、停靠区布局（键 `mypage-dock-layout:<工作区 id>`，每个工作区一份，删工作区时清掉）、翻译语言和图库操作偏好存这里，键名统一 `mypage-` 开头。换 origin 会重置，已知。它存在 `browser-data` 里，改数据目录时跟着搬。

## 不落库的运行时状态

工作区目录落库，但工作区内已打开的工具面板和终端会话是运行时状态，**每次启动从空开始（用户决策，勿加还原）**。dock 布局只记格子的排法（存 localStorage，见上节），不记里面的面板。
