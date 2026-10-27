// 安装期自愈两件套（每次 pnpm install 后作为 postinstall 跑一次）：
//
// 1. electron 二进制：pnpm 重链 node_modules 时会跳过它认为「已构建」的 electron
//    下载脚本，但链接过程可能已抹掉 dist/（pnpm dev 报 "Error: Electron uninstall"）。
//    path.txt 由 electron 的 install.js 落盘，是各平台通用的「二进制已就位」标记；
//    缺了就重跑 electron 自己的 install.js（走本地缓存，秒级）。
// 2. better-sqlite3 原生 binding：pnpm 默认按系统 Node 的 ABI 下载预编译，而
//    Electron 的 ABI 不同，直接运行会报 "NODE_MODULE_VERSION ... was compiled
//    against a different Node.js version"。用 prebuild-install 重拉 Electron 版
//    预编译（better-sqlite3 依赖里自带该工具）。
//
// 注意：better-sqlite3 的预编译通常落后最新 Electron 大版本一档——
// 升级 Electron 前先确认它有对应预编译，否则锁在旧一档（如 43 → 42）。
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "package.json"));

const electronDir = join(root, "node_modules", "electron");
if (existsSync(electronDir) && !existsSync(join(electronDir, "path.txt"))) {
    console.log("electron: dist 缺失，重新下载二进制 ...");
    execFileSync(process.execPath, [join(electronDir, "install.js")], { stdio: "inherit" });
}

const sqliteDir = dirname(require.resolve("better-sqlite3/package.json"));
const prebuildInstall = require.resolve("prebuild-install/bin.js", { paths: [sqliteDir] });
const electronVersion = JSON.parse(readFileSync(join(root, "node_modules/electron/package.json"))).version;

console.log(`better-sqlite3: 拉取 Electron ${electronVersion} 预编译 ...`);
execFileSync(process.execPath, [prebuildInstall, "-r", "electron", "-t", electronVersion], {
    cwd: sqliteDir,
    stdio: "inherit",
});
console.log("完成");
