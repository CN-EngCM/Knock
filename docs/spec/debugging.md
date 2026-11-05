# 调试与界面自动化

启动真实窗口调试、写界面自动化脚本时读这里。脚本和产物放哪儿见 [AGENTS.md](../../AGENTS.md)「文件放哪儿」。

## 启动真实窗口

- 应用有单实例锁，调试前可以直接结束已运行的实例，不必另搭夹具。
- 启动 Electron 前若终端带着 `ELECTRON_RUN_AS_NODE=1`（部分代理/IDE 环境会注入），先 `Remove-Item Env:ELECTRON_RUN_AS_NODE`，否则 `electron .` 会按 Node 模式跑，主进程 import `BrowserWindow` 直接报错。
- 窗口默认隐藏，起完再跑一个 `electron .` 触发 `second-instance` 即可呼出。
- 需要自动化接管时，构建后用 `electron . --remote-debugging-port=9222` 启动，再 `npx playwright cli attach --cdp=http://127.0.0.1:9222`。
- 用 Playwright CLI 截图时带上路径：`--filename=test-output/<主题>/<名字>.png`。

## 隔离数据

**会写数据的自动化操作不要碰真实数据**，隔离到 `test-output/<主题>/appdata/`：

1. 在其中建 `Knock/` 目录，放好 `data-location.json`（内容 `{"dir":"<这个 Knock 目录的绝对路径>"}`）和一个空的 `mypage.db`。缺任何一个都会弹原生对话框，卡住自动化。
2. 把环境变量 `APPDATA` 指向 `appdata/`，启动时带 `--user-data-dir=<这个 Knock 目录>`。这样能和正在跑的实例共存。
3. 以上在 Windows 实测可用。macOS 的数据根取自主目录，对应改 `HOME`，尚未实测。

`tests/scripts/launch-isolated.cjs` 已经把这些做好了，直接用它：

```bash
node tests/scripts/launch-isolated.cjs <主题> --port=9222   # 构建到 test-output/<主题>/out 并启动，可加 --no-build
node tests/scripts/launch-isolated.cjs <主题> --stop        # 只结束该主题启动的实例
node tests/scripts/cdp.cjs 9222 eval "window.knock.setPinned(true)"
node tests/scripts/cdp.cjs 9222 shot test-output/<主题>/<名字>.png
npx electron tests/scripts/gen-gallery-images.cjs test-output/<主题>/images --count=30 --size=6000x4000
node tests/scripts/test-site.cjs                            # 网址导入的本地测试站，路由见文件开头
```

- **结束实例不要按进程名或窗口标题**：隔离实例和正在用的敲敲同名同标题，会误伤。实例经改数据目录重启后进程号会变，按调试端口查到进程号，核对命令行后再结束。
- 开始自动化前先 `window.knock.setPinned(true)`，否则失焦就隐藏。
- `launch-isolated` 关掉了 Chromium 的窗口遮挡判断。自己手动启动时要注意：窗口被盖住就不渲染，懒加载的图不触发，缩略图也不生成。
- 隐藏窗口、未关后台节流时，页面线程里的部分异步操作可能一直不返回，写探测脚本时给每一步加超时。
- 调用 `galleryChromeSync`、`galleryChromeClear` 会操作 9333 端口上真实的专用 Chrome，自动化里不要随手调。
- 实际点复制按钮会写系统剪贴板，隔离实例和真实应用共用一个，只查权限状态即可。
