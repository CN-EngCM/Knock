// electron-builder afterPack 钩子（目录版瘦身，dist:win / dist:mac 时自动执行）。
// 删的都是运行用不到的文件；一旦哪天用了 WebGPU/拼写检查异常，从这里找原因。
//   locales/*      —— Chromium 界面语言包，只留中英文（UI 文案本来走自家 i18n）
//   LICENSES.chromium.html —— 19MB 纯许可证汇编（个人自用；对外分发请保留）
//   dxcompiler/dxil —— Dawn(WebGPU) 的着色器编译器，本应用纯 DOM 界面用不到
//   elevate.exe    —— 仅 NSIS/portable 目标的提权辅助，dir 目标无用
const fs = require("node:fs");
const path = require("node:path");

const KEEP_LOCALES = new Set(["en-US.pak", "zh-CN.pak", "zh-TW.pak"]);

/** @param context {import('electron-builder').AfterPackContext} */
module.exports = function afterPack(context) {
    const dir = context.appOutDir;
    const drop = [
        path.join(dir, "LICENSES.chromium.html"),
        path.join(dir, "dxcompiler.dll"),
        path.join(dir, "dxil.dll"),
        path.join(dir, "resources", "elevate.exe"),
    ];
    const localesDir = path.join(dir, "locales");
    if (fs.existsSync(localesDir)) {
        for (const f of fs.readdirSync(localesDir)) {
            if (!KEEP_LOCALES.has(f)) drop.push(path.join(localesDir, f));
        }
    }
    let freed = 0;
    for (const f of drop) {
        try {
            freed += fs.statSync(f).size;
            fs.rmSync(f);
        } catch {
            /* 不存在就跳过 */
        }
    }

    // ── 平台裁剪：files 清单不能按平台条件排除，跨平台内容在这里删 ──
    // win 包删 darwin 预编译（files 曾直接排除；mac 包需要它们才挪到这里），
    // 非 win 包删 Windows 专属的 Everything CLI（es.exe）
    const nmUnpacked = path.join(dir, "resources", "app.asar.unpacked", "node_modules");
    const trimmed = [];
    if (context.electronPlatformName !== "darwin") {
        for (const mod of ["uiohook-napi", "node-pty"]) {
            for (const pre of ["darwin-arm64", "darwin-x64"]) {
                const p = path.join(nmUnpacked, mod, "prebuilds", pre);
                freed += dirSize(p);
                fs.rmSync(p, { recursive: true, force: true });
                trimmed.push(p);
            }
        }
    } else {
        fs.rmSync(path.join(dir, "resources", "es.exe"), { force: true });
    }

    console.log(
        `afterPack 瘦身：删除 ${drop.length} 个文件${trimmed.length ? ` + ${trimmed.length} 个目录` : ""}，释放约 ${Math.round(freed / 1048576)}MB`,
    );
};

/** 目录递归大小（字节）；不存在返回 0 */
function dirSize(p) {
    let total = 0;
    try {
        for (const ent of fs.readdirSync(p, { withFileTypes: true })) {
            const child = path.join(p, ent.name);
            total += ent.isDirectory() ? dirSize(child) : fs.statSync(child).size;
        }
    } catch {
        /* 不存在或不可读就计 0 */
    }
    return total;
}
