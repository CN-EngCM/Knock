import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // v2.0：生产态渲染页面由 Electron loadFile 以 file:// 加载，
  // 必须用相对路径引用产物资源（默认的绝对路径 /assets/... 会 404）。
  base: './',
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    // 显式绑定 IPv4 回环：wait-on 探测 127.0.0.1、主进程 loadURL 也用 127.0.0.1，
    // 避免本机 localhost 解析成 ::1 时两边对不上（Vite 7 默认只听 IPv6）。
    host: '127.0.0.1',
    port: 5173,
    // v2.0 无独立后端端口：RPC 走 IPC 桥接（见 src/api/client.ts），
    // 不再需要把 /api 代理到本地 Hono 服务。
  },
})
