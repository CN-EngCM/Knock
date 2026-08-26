// 主进程/preload 的 esbuild 打包脚本。
// - main   → out/main.mjs（ESM；Electron 28+ 支持 ESM 入口）
//   banner 注入 __dirname（ESM 没有它，业务代码沿用 CommonJS 习惯写法）
// - preload → out/preload.cjs（沙箱 preload 只支持 CommonJS）
// 原生模块（better-sqlite3 / uiohook-napi / node-pty）标记 external，
// 运行时从 node_modules 解析——asar 内由 electron-builder unpack。
import { build } from "esbuild";
import { rmSync } from "node:fs";

const common = {
    bundle: true,
    platform: "node",
    target: "node20",
    external: ["electron", "better-sqlite3", "uiohook-napi", "node-pty"],
    sourcemap: false,
    logLevel: "info",
};

rmSync("out", { recursive: true, force: true });

await build({
    ...common,
    entryPoints: ["electron/main.ts"],
    outfile: "out/main.mjs",
    format: "esm",
    banner: {
        // ESM 没有 __dirname，注入一个（业务代码沿用 CommonJS 习惯写法）。
        // 用动态 import 拿模块对象，避免静态 import 与打包产物的具名导入撞标识符。
        js: "const __dirname = (await import('node:path')).dirname((await import('node:url')).fileURLToPath(import.meta.url));",
    },
});

await build({
    ...common,
    entryPoints: ["electron/preload.ts"],
    outfile: "out/preload.cjs",
    format: "cjs",
});
