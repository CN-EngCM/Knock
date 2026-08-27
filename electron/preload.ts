import { contextBridge, ipcRenderer } from "electron";
import type { PtyEvent } from "../server/pty";
import type { AiEvent } from "../server/ai";

// ── 渲染进程的唯一暴露面：进程边界即安全边界 ──
// 不开 nodeIntegration，页面只能通过这几个白名单接口接触主进程：
//   invoke         —— 发起 RPC（channel 必须是 server/api.ts 注册过的处理器名，
//                     参数由处理器入口的 zod 校验兜底）
//   onOpenSettings —— 订阅托盘菜单「设置」事件
//   onFocusSearch  —— 订阅窗口呼出事件（双击 Ctrl 等，渲染端聚焦搜索框）
//   onPtyEvent     —— 订阅终端输出流（v2.2：pty data/exit 下行事件），返回退订函数：
//                     React 开发态 StrictMode 会把 effect 跑两遍，没有退订就会
//                     挂两个监听器，每份数据写两遍 xterm（表现为终端整屏双行）。
//   onAiEvent      —— 订阅 AI 对话增量流（delta/done/abort/error），返回退订函数，理由同上。
// 沙箱 preload 只允许 CJS 子集，esbuild 打成 out/preload.cjs。
// PtyEvent / AiEvent 都是 type import（编译期擦除），不会把 server 代码带进渲染进程。

contextBridge.exposeInMainWorld("knock", {
    invoke: (channel: string, ...args: unknown[]): Promise<unknown> => ipcRenderer.invoke(channel, ...args),
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
