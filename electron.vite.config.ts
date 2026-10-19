import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
    main: {},
    preload: {
        build: {
            // 沙箱中的预加载脚本需要单个 CommonJS 文件。
            externalizeDeps: false,
            rollupOptions: {
                output: {
                    format: "cjs",
                    entryFileNames: "index.cjs",
                },
            },
        },
    },
    renderer: {
        plugins: [react(), tailwindcss()],
        base: "./",
        resolve: {
            alias: { "@": fileURLToPath(new URL("./src/renderer/src", import.meta.url)) },
        },
        server: {
            host: "127.0.0.1",
            port: 5173,
        },
        build: {
            minify: true,
        },
    },
});
