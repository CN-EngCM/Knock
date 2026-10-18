import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { PtyEvent } from "../server/pty";
import type { AiEvent } from "../server/ai";

// ── 渲染进程的唯一暴露面：进程边界即安全边界 ──
// 不开 nodeIntegration，页面只能通过这几个白名单接口接触主进程：
//   invoke         —— 发起 RPC（channel 必须是 server/api.ts 注册过的处理器名，
//                     参数由处理器入口的 zod 校验兜底）
//   hideWindow     —— 渲染进程启动成功后请求隐藏窗口（首个渲染→主进程方向的 send，
//                     fire-and-forget，无需返回值）
//   setPinned      —— 钉子按钮同步失焦自动隐藏的豁免状态（mp:set-pinned，同上）
//   onOpenSettings —— 订阅托盘菜单「设置」事件
//   onFocusSearch  —— 订阅窗口呼出事件（双击 Ctrl 等，渲染端聚焦搜索框）
//   onPtyEvent     —— 订阅终端输出流（v2.2：pty data/exit 下行事件），返回退订函数：
//                     React 开发态 StrictMode 会把 effect 跑两遍，没有退订就会
//                     挂两个监听器，每份数据写两遍 xterm（表现为终端整屏双行）。
//   onAiEvent      —— 订阅 AI 对话增量流（delta/done/abort/error），返回退订函数，理由同上。
//   filePathFor    —— 拖拽导入取本机路径：Electron 32+ 渲染进程 File 对象不再带 .path，
//                     必须经 webUtils 在 preload 里换（页面自己拿不到）。
// 沙箱 preload 只允许 CJS 子集，esbuild 打成 out/preload.cjs。
// PtyEvent / AiEvent 都是 type import（编译期擦除），不会把 server 代码带进渲染进程。

contextBridge.exposeInMainWorld("knock", {
    invoke: (channel: string, ...args: unknown[]): Promise<unknown> => ipcRenderer.invoke(channel, ...args),
    /** 首帧前同步取持久化主题（index.html 内联脚本用；值来自主进程已读的 settings 表） */
    getThemeSync: (): "dark" | "light" => ipcRenderer.sendSync("mp:get-theme-sync") ?? "dark",
    hideWindow: (): void => {
        ipcRenderer.send("mp:hide-window");
    },
    setPinned: (v: boolean): void => {
        ipcRenderer.send("mp:set-pinned", v);
    },
    setTheme: (theme: "dark" | "light"): void => {
        ipcRenderer.send("mp:set-theme", theme);
    },
    filePathFor: (file: File): string => webUtils.getPathForFile(file),
    onOpenSettings: (cb: () => void): void => {
        ipcRenderer.on("mp:open-settings", () => cb());
    },
    onFocusSearch: (cb: (clip: string | null) => void): (() => void) => {
        const handler = (_e: unknown, clip: string | null) => cb(clip);
        ipcRenderer.on("mp:focus-search", handler);
        return () => ipcRenderer.removeListener("mp:focus-search", handler);
    },
    onPtyEvent: (cb: (e: PtyEvent) => void): (() => void) => {
        const handler = (_e: unknown, ev: PtyEvent) => cb(ev);
        ipcRenderer.on("mp:pty-event", handler);
        return () => ipcRenderer.removeListener("mp:pty-event", handler);
    },
    onAiEvent: (cb: (e: AiEvent) => void): (() => void) => {
        const handler = (_e: unknown, ev: AiEvent) => cb(ev);
        ipcRenderer.on("mp:ai-event", handler);
        return () => ipcRenderer.removeListener("mp:ai-event", handler);
    },
});
