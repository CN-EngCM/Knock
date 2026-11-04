# GaN.UI 功能缺口记录

> 用途：登记敲敲（Knock）在组件统一过程中遇到的「库没有、或库有但能力不足」的点，供日后回灌 [GaN.UI](../../GaN.UI)（源码基线 v1.5.4，HEAD `0edf835`）。
> 记录原则：只登记**可通用化**的能力缺口；纯业务语义（终端、图片浏览器、图库选择模型）标记为「业务自留」，不进库。
> 配套基线见 [GaN.UI-组件同步基线.md](GaN.UI-组件同步基线.md)。

## 一、组件能力缺口（建议入库）

| 编号 | 缺口                                                                 | 敲敲现状                                                                     | 库组件现状                                                                                    | 建议库侧补什么                                                                                     | 影响面                     |
| ---- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------- |
| G1   | `ToggleGroup` 无法表达「再次点击当前项切换方向/取消」                 | 文件搜索的类型与排序按钮：同项再点一次切升/降序（`FileSearchTool.tsx:179-210`） | `ToggleGroup type="single"` 的 `onValueChange` 只给值与空串，重复点击被 radix 吞掉             | 增加 `onItemActivate`/`allowRepeat` 类回调，或在 `Scope`/`Scopebar` 上提供「激活即回调」钩子        | 文件搜索排序、可预见的其他筛选器；P2 已用受控 `value` + 空串回调在调用点实现 |
| G2   | `Item` 缺选中态与行级槽位                                            | 启动项行已随启动列表迁 Tree（选中/把手/右键由 tree 行自带）；工具首页卡片与图库分组栏仍按 `Item` 组合（`ToolHome.tsx`、`GroupSidebar.tsx`） | `Item` 只有内容布局，无 `selected`/`aria-current`，hover 仅在 `asChild` 时存在，无把手/右键插槽 | 增加 `selected`/`current` 状态与 `ItemHandle`/`ItemActions` 槽位，或在文档中给出受认可的组合写法     | 工具首页卡片、图库分组栏、可预见的其他行式列表 |
| G3   | `Combobox` 不支持分隔符批量输入                                     | **已落地**：`TagEditor.tsx` 用 `Combobox multiple` + `ComboboxChips`，逗号切分与「回车收下输入原文」由薄包装补齐，末项删除用组件自带行为 | `ComboboxChips` 只提供逐项增删，无分隔符解析                                                  | 增加 `separators`（默认 `,`）与「输入原文即新值」的提交策略；匹配策略支持「包含」而非仅前缀                | 已接入；库侧若补 separators，可去掉 TagEditor 里的逗号切分 |
| G4   | 缺「非模态、不夺焦、锚定在输入框内」的搜索下拉                       | 顶栏搜索：输入即出结果、焦点始终留在输入框、↑↓/Enter/Esc 自管（`SearchBox.tsx:232-353`） | `Popover` 打开会抢焦点；`Command` 自带 filter 与模态语义，需 `shouldFilter=false` 全接管        | 提供 `Combobox`/`Popover` 的 `nonModal` + `anchor` 模式，或独立 `SearchSuggest` 组合件              | 顶栏搜索、文件搜索、URL 导入搜索 |
| G5   | `ScrollArea` / `MessageScroller` 视口新增 tab 停靠点                 | `/` 聚焦搜索、键盘滚动路径依赖容器不进入 tab 序列                            | Radix 视口 `tabIndex=0`，且 Root 的 props 不透传到视口；`MessageScroller` 的 viewport 同理      | 暴露 `viewportTabIndex` 或默认 `-1` 并提供「可键盘滚动」的显式开关                                 | 全部滚动容器 5 处；P2 已核实 5 处全部退回原生 `overflow-y-auto`，`ui/scroll-area.tsx` 因此未纳入工程；AI 会话区接受了 `MessageScroller` 的 tab 停靠点（换取底部吸附与虚拟化） |
| G6   | `Titlebar` 高度固定 34/68px                                          | 顶栏为 61px，品牌区 178px、搜索井 34px、右侧 4 颗按钮（`App.tsx:493-558`）    | 高度来自 `--size-titlebar` 与 large 变体，无业务高度入口                                       | 增加 `height`/`size` 自定义或文档说明覆写方式；品牌区给出「logo + wordmark」插槽约定                | 顶栏                       |
| G7   | `Field` 没有定宽标签列                                               | 设置与表单统一 `grid-cols-[6rem_1fr]`，标签列定宽（`shared.tsx:4`，26 处）    | `Field` horizontal 是 `flex-auto`；`InspectorListItem` 是右对齐两栏，语义不同                  | 增加 `Field` 的 `labelWidth` 变体（`auto` / 定宽）                                                  | 设置 5 节、8 个对话框      |
| G8   | `Disclosure` 头部本身是 `<button>`，无法安全承载拖把手与右键          | 原分组头消费方 `GroupPanel.tsx` 已随启动列表迁 Tree 移除（组行改由 tree 行 + `renderRow` 组合）；缺口本身保留登记 | 头部即按钮，再嵌按钮构成嵌套交互；无把手槽、无右键钩子                                          | 头部改为可组合子元素（`DisclosureTrigger` + `DisclosureHandle`），或声明「含交互子元素」用法        | 可折叠面板（图库分组栏等） |
| G9   | 拖拽体系只有 draggable/droppable/overlay，**没有排序**                | 启动项与分组排序已由 Tree 自带 dnd（before/after/inside 插入模型）承担，`@dnd-kit/sortable` 依赖已移除；库侧缺口保留登记 | `drag.tsx` 明确不依赖 sortable，无排序策略与键盘排序                                            | 增加基于 dnd-kit sortable 的 `SortableList` 组合件（含键盘排序与 a11y 播报）                        | 可预见的标签排序等（启动列表已由 Tree dnd 覆盖） |
| G10  | 部分组件要求 radix-ui ≥ 1.8                                          | 本项目锁 `radix-ui@1.6.7`，`popover.tsx` 用了 1.8 才有的 `Popover.Title`/`Description`，编译直接失败 | v1.0.0 的 `package.json` 声明 `radix-ui@^1.8.1`；`popover`/`command` 等组件按 1.8 写               | 在 README/接入文档标注「哪些组件需要 radix 1.8」；或把 1.8 才用的 API 降级为兼容写法                | 引入 `popover`/`command` 等组件前必须先升级 radix；本次已放弃 `popover` |
| G11  | `Tree` 点行只做选中，无「点行切换展开」开关                          | 启动列表组行要单击折叠/展开（选中高亮顺带保留），只能挂在 `renderRow` 内容层 `onClick` 上（`LauncherTree.tsx` 的 `GroupRowContent`） | `handleRowClick` 仅选中/激活；展开只有箭头按钮（stopPropagation）、方向键、`*`、拖拽悬停四条路径，`TreeProps` 无 `toggleOnClick` 类选项 | 增加 `toggleOnClick?: boolean`（仅对有子节点的行生效，在 `handleRowClick` 里分支调 `toggleExpanded`），或提供 `onRowClick` 钩子 | 启动列表组行、可预见的文件树 |
| G12  | `DockLayout` 组头右端没有可用的动作区                                 | 工具入口改放顶栏「工具集」菜单；组头不再放任何按钮，关闭走标签 × 与标签右键菜单 | v1.5.4 删掉了默认的 `GanDockviewHeaderActions`、`singleTabMode` 与 `.gan-group-actions` / `.gan-group-close` 等类名，`rightHeaderActionsComponent` 仍在但失去皮肤约定，自绘会没有对齐与间距 | 提供公开的组头动作插槽（含样式与对齐约定），或明确文档化「组头不放动作」 | 需要「开工具 / 关闭整组」这类组级入口的停靠布局 |

## 二、业务自留（不回灌，仅登记理由）

| 编号 | 项目                       | 敲敲位置                                             | 为什么不进库                                                         |
| ---- | -------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------- |
| B1   | xterm 终端宿主             | `TerminalZone.tsx:208-219`                           | 依赖 pty 尺寸同步、主题变量热更新、选区复制语义，属终端集成而非 UI 原语 |
| B2   | 图片视口舞台（缩放/平移/旋转） | `Viewer.tsx:72-154/242-284`                      | 视口变换模型（fit/1:1/滚轮/pointer capture）不是布局组件               |
| B3   | 幻灯片放映引擎             | `Slideshow.tsx:132-207/239-249`                      | 分页、定时、全屏、闲置隐藏，属于播放器逻辑                             |
| B4   | 图库多选语义               | `GalleryTool.tsx:222-279`                            | single/toggle/shift-range + Ctrl+A/Esc 的域模型，可复用性差             |
| B5   | 增量渲染与无限加载         | `ImageGrid.tsx:104-128`、`GalleryTool.tsx:191-218`   | 哨兵 + `content-visibility` 的图片网格策略，与虚拟化不是同一模型        |
| B6   | OS 文件拖放导入            | `GalleryTool.tsx:373-389`、`GroupSidebar.tsx:93-113` | 库的拖拽只服务 dnd-kit 内部；外部 Files 接收涉及 DataTransfer 与安全边界 |
| B7   | 图片网格本体               | `ImageGrid.tsx:136-205`                              | 无 Grid 原语的需求，且与框选、懒加载、选择态强耦合                     |
| B8   | 键盘/焦点接管             | `Viewer.tsx:106-136`、`Slideshow.tsx:183-207`        | Esc/方向键/滚轮属于业务快捷键层，全局监听不适合放进组件                 |
| B9   | canvas → PNG 复制原图      | `Viewer.tsx:174-190`                                 | 业务副作用，不是 UI 能力                                               |
| B10  | 品牌标（4 格 logo + 字标） | `App.tsx:494-506`                                    | 品牌资产，不属于通用组件                                               |

## 三、登记流程

1. 新增缺口先判断是否**重复出现**或**可被其他项目复用**；只有「是」才进第一节。
2. 每条缺口写明：触发场景、现状代码位置、库组件现状、期望 API、影响面。
3. 回灌完成后，在本表该行标记 `已入库（版本号）`，并在升级方案的对应位置改成直接引用库组件。
4. 纯业务项（第二节）只在「库忽然长出同能力」时复核，避免库被业务形态污染。

## 四、落地约定

- **业务自留件留在所属功能目录**（`tools/`、`tools/gallery/`、`components/`），不另建 `components/app/` 层：这些件只有一个消费方，物理搬移只产生 diff、不产生收益；边界靠本文件登记 + AGENTS 的同步约定维持。哪天出现第二个消费方（例如图片舞台被第二个工具复用），再按需抽到公共层。
- 业务自留件同样只吃库令牌（`--state-*` / `--elevation-*` / `--size-*` / `--space-*`），不得新增自有色值令牌。
- **接入成本备忘**：`MessageScroller` 经 `hooks/use-virtual-rows` 静态依赖 `@tanstack/react-virtual`；`Combobox` 依赖 `@base-ui/react`；停靠区依赖 `dockview-react`（钉死 `8.6.2`，与上游一致，因为 `keepProportionsOnGroupRemoval` 读 dockview 内部字段）。三者都是 `devDependencies`。

