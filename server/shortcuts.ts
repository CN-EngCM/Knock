import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type Shortcut = {
    name: string; // 快捷方式显示名（去扩展名）
    lnk: string; // .lnk 文件路径
    target: string; // 解析出的目标路径（可能为空）
};

// ── Windows 快捷方式扫描器（v1 仅 Windows）──
// 扫描开始菜单（用户 + 公共）与桌面（用户 + 公共）的 .lnk，
// 用一次 PowerShell 调用批量解析目标路径（WScript.Shell COM）。
// 结果在进程内缓存；非 Windows 平台返回空数组。

let cache: Shortcut[] | null = null;

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
    if (process.platform !== "win32") return [];
    if (cache && !refresh) return cache;

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
