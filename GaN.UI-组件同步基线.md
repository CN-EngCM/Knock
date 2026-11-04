# GaN.UI 组件同步基线

> 组件来源：`D:\MyCode\GaN.UI`，当前基线 **v1.5.4**（`0edf835`），tag `v1.5.4`。
> 组件副本在 `src/renderer/src/components/ui/`，令牌与材质在 `src/renderer/src/index.css`。
> 库能力缺口见 [GaN.UI-功能缺口记录.md](GaN.UI-功能缺口记录.md)。

## 1. 基线快照

| 项         | 取值                                                                                          |
| ---------- | --------------------------------------------------------------------------------------------- |
| 上游版本   | v1.5.4（2026-11，提交 `0edf835`）                                                             |
| 复制组件   | 43 件（42 件 long-lived + `combobox`），逐字节取上游源文件                                    |
| 支撑模块   | `lib/platform.tsx` `lib/shortcut.ts` `lib/density.ts` `lib/scroll.ts` `hooks/use-overlay-density.ts` `hooks/use-size-token.ts` `hooks/use-virtual-rows.ts` |
| 副本格式   | 上游原样：2 空格缩进、无分号、LF 内容；`.prettierignore` 已排除，`pnpm format` 不碰          |
| 深浅主题   | 深色固定石墨（`#26272b`）、浅色固定薄雾（`#eaeff5`），不用上游其余 10 套配色                  |
| 密度       | 只有 regular 一档，不启用 `data-density` 切换                                                 |
| 依赖       | `dockview-react` 钉死 `8.6.2`；`@tanstack/react-virtual`（MessageScroller）、`@base-ui/react`（Combobox）均在 `devDependencies` |

## 2. 本地差异（除这三处，其余一律回上游或放业务层）

| #   | 文件                        | 差异                                                                                  | 原因                                                       |
| --- | --------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| ①   | `src/renderer/src/lib/utils.ts` | `extendTailwindMerge` 把 `micro/caption/small/control/readout/display` 登记进 font-size 组 | 替代上游 `cn` 包；不登记会让 `text-small` 被当成文字颜色     |
| ②   | `src/renderer/src/index.css`    | 同时定义 `gan-drag`/`gan-no-drag` 与项目自有的 `app-drag`/`app-no-drag`                | 调用点沿用旧类名，不做全库改名                             |
| ③   | `src/renderer/src/components/ui/dialog.tsx` | 保留 `onInteractOutside={(e) => e.preventDefault()}` 与注释                | 防误触遮罩丢掉未保存的表单草稿                             |

令牌层不是本地差异：浅色用的是上游「薄雾」整套取值（见 3.2），只是把该配色的变量写进了 `:root`，没有引入上游的 `data-light-palette` 多配色机制。

## 3. 令牌层

### 3.1 结构

`index.css` 顺序固定：`@import` 三条 → 四个本地 `@font-face` → `@custom-variant dark` → `@theme`（字体栈）→ `@theme static`（字号档）→ `@theme inline`（颜色与阴影映射）→ `:root`（浅色令牌）→ `.dark`（深色令牌）→ 与主题无关的动效/图标线宽/滚动条令牌 → `:root` + `.dark` 成对的语义令牌（state / elevation / dock / 控件材质 / 气泡 / 拖拽）→ regular 密度尺寸 → `@layer base` → `@layer components`。

### 3.2 浅色取薄雾、深色取石墨

浅色 `:root` 里约 90 个颜色与材质令牌取薄雾（`--background #eaeff5`、`--primary #4f46e5`、`--ring` 由主色合成等），其余与主题无关的令牌保持上游结构。深色 `.dark` 就是上游默认的石墨。

有一处取值按本项目观感微调：`--well-top` / `--well-bottom`（标题栏搜索井的渐变）改成 `#dbe1e9` / `#d5dbe3`。薄雾原值在井底比所在高度的标题栏更浅，浅色下搜索井会与标题栏连成一片；改后井的渐变方向与标题栏一致、整体低约 10 级明度，凹陷感与深色主题统一。

同一套取值必须同步到主进程：`src/main/index.ts` 的 `THEME_BG.light = "#eaeff5"`、`THEME_BORDER.light = "#caced4"`（后者是 `--window-border` 投到浅色底上的等视觉实色，DWM 的 COLORREF 不吃透明度）。

### 3.3 停靠皮肤令牌

`--dock-*` 分两段：浅色在 `:root`（`--dock-focus-tab` 等是深色底浅色字，焦点标签在浅色下是一块深色标签），深色在 `.dark`（焦点标签等同普通当前页签，另在朝外一边画主色标记）。两组都必须齐，缺任何一个会让焦点页签取到无效值。

## 4. 同步流程

1. 在上游确认目标 tag 与提交号，读 `git log <旧基线>..<新基线> -- src/components/ui src/index.css src/lib src/hooks`。
2. 只对**本项目已复制**的文件做替换：`git show <新基线>:src/components/ui/<file>` 原样落盘（保持上游字节），不手改、不重排。
3. 令牌层按 3.2/3.3 对齐：先看上游浅色基础块与 `.dark` 基础块新增了什么，再看目标配色块覆盖了哪些。
4. 三处本地差异逐条复核：`lib/utils.ts` 的字号档是否仍与上游字号档一致、`index.css` 的拖拽类别名是否还在、`dialog.tsx` 的遮罩补丁是否要重贴。
5. 上游删掉的导出/类名/属性，改法写进业务层（如 `DockZone.tsx`），不往 `components/ui` 里打补丁。
6. `pnpm typecheck` → `pnpm format` → `pnpm build`，再 `pnpm dev` 人工过 5 节的清单。

## 5. 验证清单

静态：

- `pnpm typecheck` 通过；`pnpm format` 不产生 `components/ui` 改动。
- `pnpm build` 通过。
- 令牌无悬空引用：`rg -n 'var\(--[a-z-]+\)' src/renderer/src/components/ui/dock-layout.css` 里出现的变量必须在 `index.css` 有定义。

界面（深浅两套各过一遍）：

| 区域     | 动作                                                       | 通过条件                                         |
| -------- | ---------------------------------------------------------- | ------------------------------------------------ |
| 顶栏     | 工具集菜单开工具、钉住/侧栏/主题/设置四颗按钮、拖拽移动窗口 | 菜单能开工具与新建终端会话，已打开项有标记       |
| 浅色外观 | 切换主题                                                   | 底色为薄雾蓝灰，选中态与焦点环跟随靛蓝主色       |
| 停靠区   | 开多个面板、拖标签分屏、浮动、最大化、右键菜单             | 焦点标签深底浅字；关闭走标签 × 或右键            |
| 终端     | 新建会话、输入、复制粘贴、切主题                           | pty 尺寸与配色热更新正常                         |
| 启动列表 | 折叠分组、回车、拖拽排序、右键改名                         | 组行回车只切换展开；条目回车即启动               |
| 图库标签 | 编辑标签：输入新标签、逗号批量、选候选、删 chip            | 三种场景都能保存，失败留窗可重试                 |
| 对话框   | 各对话框开合                                               | 点遮罩不关闭，Esc 关闭                           |

## 6. 已知边界

- 不复制上游 48 个未使用的组件（`calendar`/`chart`/`data-table`/`dock-workbench` 等），需要时按第 4 节流程单件引入。
- 组头不设动作区：上游 v1.5.4 删掉了组头右端的默认动作组件与配套类名，本项目把工具入口收到顶栏「工具集」，关闭走标签 × 与右键菜单。
- 多配色机制（`data-light-palette`）不引入：本项目只有薄雾一套浅色，加机制等于养没人用的分支。
