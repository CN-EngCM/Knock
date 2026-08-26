// 把 better-sqlite3 的原生 binding 换成当前 Electron ABI 的预编译。
//
// 背景：pnpm 默认按系统 Node 的 ABI 下载预编译，而 Electron 的 ABI 不同，
// 直接运行会报 "NODE_MODULE_VERSION ... was compiled against a different
// Node.js version"。本脚本在每次 pnpm install 后（postinstall）跑一次，
// 用 prebuild-install 重拉 Electron 版预编译（better-sqlite3 依赖里自带该工具）。
//
// 注意：better-sqlite3 的预编译通常落后最新 Electron 大版本一档——
// 升级 Electron 前先确认它有对应预编译，否则锁在旧一档（如 43 → 42）。
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "package.json"));

const sqliteDir = dirname(require.resolve("better-sqlite3/package.json"));
const prebuildInstall = require.resolve("prebuild-install/bin.js", { paths: [sqliteDir] });
const electronVersion = JSON.parse(readFileSync(join(root, "node_modules/electron/package.json"))).version;

console.log(`better-sqlite3: 拉取 Electron ${electronVersion} 预编译 ...`);
execFileSync(process.execPath, [prebuildInstall, "-r", "electron", "-t", electronVersion], {
    cwd: sqliteDir,
    stdio: "inherit",
});
console.log("完成");
