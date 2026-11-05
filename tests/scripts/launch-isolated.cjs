// 用隔离数据启动真实窗口，供调试和界面自动化使用，不碰真实数据（做法见 docs/spec/debugging.md）。
// 运行：node tests/scripts/launch-isolated.cjs <主题> [--port=9222] [--no-build]
//       node tests/scripts/launch-isolated.cjs <主题> --stop（只结束该主题启动的那个实例）
// 构建到 test-output/<主题>/out，数据放 test-output/<主题>/appdata/Knock，可与正在跑的实例共存。
// 窗口失焦会自动隐藏，自动化开始前先执行 window.knock.setPinned(true)。前台常驻，Ctrl+C 结束。
// 结束实例一律走 --stop：实例和真实应用同名同标题，按进程名或窗口标题结束会误伤正在用的敲敲。
const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const args = process.argv.slice(2);
const topic = args.find((a) => !a.startsWith("--"));
if (!topic) {
    console.error("用法：node tests/scripts/launch-isolated.cjs <主题> [--port=9222] [--no-build]");
    process.exit(2);
}
const port = (args.find((a) => a.startsWith("--port=")) ?? "--port=9222").slice("--port=".length);
const root = path.resolve(__dirname, "..", "..");
const base = path.join(root, "test-output", topic);
const outDir = path.join(base, "out");
const appData = path.join(base, "appdata");
const dataDir = path.join(appData, "Knock");
const pidFile = path.join(base, "electron.pid");

if (args.includes("--stop")) {
    if (!fs.existsSync(pidFile)) {
        console.log("[launch] 没有记录中的实例");
        process.exit(0);
    }
    const pid = Number(fs.readFileSync(pidFile, "utf8"));
    try {
        process.kill(pid);
        console.log(`[launch] 已结束实例 ${pid}`);
    } catch {
        console.log(`[launch] 实例 ${pid} 已不在运行`);
    }
    fs.rmSync(pidFile, { force: true });
    process.exit(0);
}

// 分主题构建到各自目录：并行调试时不会互相覆盖 out/
if (!args.includes("--no-build")) {
    const r = spawnSync("pnpm", ["exec", "electron-vite", "build", "--outDir", outDir], {
        cwd: root,
        stdio: "inherit",
        shell: true,
    });
    if (r.status !== 0) process.exit(r.status ?? 1);
}

// 指针文件和库文件缺一个都会弹原生对话框，卡住自动化
fs.mkdirSync(dataDir, { recursive: true });
fs.writeFileSync(path.join(dataDir, "data-location.json"), JSON.stringify({ dir: dataDir }));
const dbFile = path.join(dataDir, "mypage.db");
if (!fs.existsSync(dbFile)) fs.writeFileSync(dbFile, "");

const env = { ...process.env, APPDATA: appData };
// 部分环境会注入这个变量，留着 Electron 就按 Node 模式跑了
delete env.ELECTRON_RUN_AS_NODE;

const electronPath = require(path.join(root, "node_modules", "electron"));
const child = spawn(
    electronPath,
    [
        path.join(outDir, "main", "index.js"),
        `--user-data-dir=${dataDir}`,
        `--remote-debugging-port=${port}`,
        // 窗口被别的程序盖住时 Chromium 会停止渲染，懒加载的图不触发、缩略图也不生成；自动化时关掉这个判断
        "--disable-features=CalculateNativeWinOcclusion",
        "--disable-backgrounding-occluded-windows",
    ],
    { cwd: root, env, stdio: "inherit" },
);
fs.writeFileSync(pidFile, String(child.pid));
console.log(`[launch] 数据目录 ${dataDir}`);
console.log(`[launch] 调试地址 http://127.0.0.1:${port}`);
child.on("exit", (code) => {
    fs.rmSync(pidFile, { force: true });
    process.exit(code ?? 0);
});
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill());
