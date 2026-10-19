import { execFile } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type Shortcut = {
    name: string; // 快捷方式显示名（去扩展名）
    lnk: string; // .lnk 文件路径（mac 为 .app bundle 路径）
    target: string; // 解析出的目标路径（可能为空；mac 与 lnk 相同）
};

// ── 应用快捷方式扫描器 ──
// Windows：扫开始菜单（用户 + 公共）与桌面（用户 + 公共）的 .lnk，
//   用一次 PowerShell 调用批量解析目标路径（WScript.Shell COM）。
// macOS：扫 /Applications、/System/Applications 及各自 Utilities 子目录与
//   ~/Applications 下的 .app bundle——bundle 本身就是「快捷方式 = 目标」，
//   不解析到内层可执行文件（启动走 open，见 launcher.ts）。
// 结果在进程内缓存；其余平台返回空数组。

let cache: Shortcut[] | null = null;

/** mac 应用目录清单（Utilities 单列——浅层扫描不递归，系统工具都在子目录里） */
const MAC_APP_DIRS = [
    "/Applications",
    "/Applications/Utilities",
    "/System/Applications",
    "/System/Applications/Utilities",
    join(homedir(), "Applications"),
];

/** mac：各目录浅层扫 *.app，bundle 路径同时充当 lnk 与 target */
function scanMacApps(): Shortcut[] {
    const out: Shortcut[] = [];
    for (const dir of MAC_APP_DIRS) {
        let entries;
        try {
            entries = readdirSync(dir, { withFileTypes: true });
        } catch {
            continue; // 目录不存在（如无 ~/Applications）或不可读，跳过
        }
        for (const e of entries) {
            if (!e.isDirectory() || !e.name.endsWith(".app")) continue;
            const p = join(dir, e.name);
            out.push({ name: e.name.slice(0, -".app".length), lnk: p, target: p });
        }
    }
    return out;
}

function scanDirs(): string[] {
    const appData = process.env.APPDATA ?? "";
    const programData = process.env.ProgramData ?? "";
    const desktop = join(homedir(), "Desktop");
    const publicDesktop = process.env.PUBLIC ? join(process.env.PUBLIC, "Desktop") : "";
    return [
        appData && join(appData, "Microsoft", "Windows", "Start Menu", "Programs"),
        programData && join(programData, "Microsoft", "Windows", "Start Menu", "Programs"),
        desktop,
        publicDesktop,
    ].filter((d): d is string => !!d && existsSync(d));
}

export async function scanShortcuts(refresh = false): Promise<Shortcut[]> {
    if (cache && !refresh) return cache;
    if (process.platform === "darwin") {
        cache = scanMacApps();
        return cache;
    }
    if (process.platform !== "win32") return [];

    const dirs = scanDirs();
    if (dirs.length === 0) {
        cache = [];
        return cache;
    }

    // PowerShell 单引号字符串里转义单引号：' → ''
    const psDirs = dirs.map((d) => `'${d.replaceAll("'", "''")}'`).join(",");
    const script = [
        "$w = New-Object -ComObject WScript.Shell",
        `Get-ChildItem -LiteralPath ${psDirs} -Recurse -Filter *.lnk -ErrorAction SilentlyContinue | ForEach-Object {`,
        "  $t = $w.CreateShortcut($_.FullName).TargetPath",
        '  "$($_.FullName)`t$($_.BaseName)`t$t"',
        "}",
    ].join("\n");

    try {
        const { stdout } = await execFileAsync(
            "powershell.exe",
            ["-NoProfile", "-NonInteractive", "-Command", script],
            {
                maxBuffer: 16 * 1024 * 1024,
                windowsHide: true,
                timeout: 30_000,
            },
        );
        cache = stdout
            .split(/\r?\n/)
            .filter((line) => line.includes("\t"))
            .map((line) => {
                const [lnk = "", name = "", target = ""] = line.split("\t");
                return { name, lnk, target: target.trim() };
            });
        return cache;
    } catch {
        // 扫描失败不致命：返回已缓存内容或空表，添加条目仍可手填路径
        return cache ?? [];
    }
}
