// ── 终端会话（node-pty / Windows ConPTY）──
// 会话是纯运行时状态，不落库：Map<id, IPty>，应用退出时统一 kill，
// 否则隐藏到托盘再退出会留下孤儿 shell 进程。
// node-pty 1.1.0 的预编译是 NAPI 单二进制（prebuilds/ 随 npm 包分发），
// 与 Electron ABI 无关，因此 electron-deps.mjs 不需要为它做 ABI 切换。
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import { spawn, type IPty } from "node-pty";
import { getSetting } from "./util/settings";
import { SHELL_IDS, type ShellId, type ShellOption, type TermConfig } from "./schemas";

/** 主进程 → 渲染进程的输出事件（preload 转发，渲染端按 id 分发到 xterm 实例） */
export type PtyEvent = { type: "data"; id: number; data: string } | { type: "exit"; id: number };

// server 层不持有 BrowserWindow：出口由 electron/main.ts 注入
let emit: ((e: PtyEvent) => void) | null = null;
export function setPtySink(fn: (e: PtyEvent) => void): void {
    emit = fn;
}

const sessions = new Map<number, IPty>();
let nextId = 1;

// 候选 shell 探测缓存（id → 绝对路径，null = 不可用），应用运行期内只探一次。
// 注意：微软商店版 pwsh 是 WindowsApps 下的「应用执行别名」（重解析点），
// fs.existsSync 对它返回 false——Windows 侧不能用 existsSync 验证 `where`
// 的结果；`where` 按 PATH 找到即代表 CreateProcess 可执行（ConPTY 同路径）。
const probed = new Map<string, string | null>();
function probeShell(id: string): string | null {
    if (probed.has(id)) return probed.get(id) ?? null;
    const exe = process.platform === "win32" ? `${id}.exe` : id;
    let path: string | null = null;
    if (process.platform === "win32") {
        try {
            const p = execFileSync("where", [exe], { encoding: "utf8" }).trim().split(/\r?\n/)[0];
            if (p) path = p;
        } catch {
            /* 不在 PATH */
        }
    } else {
        for (const dir of (process.env.PATH || "").split(":")) {
            if (!dir) continue;
            const p = join(dir, exe);
            if (existsSync(p)) {
                path = p;
                break;
            }
        }
    }
    probed.set(id, path);
    return path;
}

// 默认 shell 探测结果缓存：pwsh → powershell → cmd（Windows）；
// $SHELL → bash（macOS/Linux）。
let cachedShell: { file: string; label: string } | null = null;
function defaultShell(): { file: string; label: string } {
    if (cachedShell) return cachedShell;
    if (process.platform === "win32") {
        for (const id of ["pwsh", "powershell"] as const) {
            const p = probeShell(id);
            if (p) {
                cachedShell = { file: p, label: id };
                return cachedShell;
            }
        }
        cachedShell = { file: process.env.ComSpec || "cmd.exe", label: "cmd" };
        return cachedShell;
    }
    const sh = process.env.SHELL;
    const found = sh && existsSync(sh) ? sh : "/bin/bash";
    cachedShell = { file: found, label: shellLabel(found) };
    return cachedShell;
}

function shellLabel(file: string): string {
    return basename(file).replace(/\.exe$/i, "");
}

// 设置里选定的 shell 优先；选中的 shell 已不存在（被卸载等）时回退默认。
// 存值可能是手改库留下的非法 id，探测不到自然走回退，无需额外校验。
function resolveShell(): { file: string; label: string } {
    const wanted = getSetting("termShell", "auto");
    if (wanted !== "auto") {
        const p = probeShell(wanted);
        if (p) return { file: p, label: wanted };
    }
    return defaultShell();
}

/** 读终端设置（settings 表）+ 当前平台可用 shell 列表，供设置页渲染 */
export function readTermConfig(): TermConfig {
    const stored = getSetting("termShell", "auto");
    const shell: ShellId = (SHELL_IDS as readonly string[]).includes(stored) ? (stored as ShellId) : "auto";
    const size = Number(getSetting("termFontSize", "13"));
    const shells: ShellOption[] = [{ id: "auto" }];
    for (const id of SHELL_IDS) {
        if (id === "auto") continue;
        const p = probeShell(id);
        if (p) shells.push({ id, path: p });
    }
    return {
        shell,
        fontSize: Number.isInteger(size) ? Math.min(32, Math.max(8, size)) : 13,
        shells,
    };
}

/** 新建会话；返回 id 与 shell 标签（渲染端做 tab 名）。
 *  opts 供终端命令条目传入 cwd（工作目录）与 label（会话标签 = 条目标题）；
 *  不传时 cwd 缺省主目录、label 用 shell 标签，与历史行为一致 */
export function spawnSession(opts?: { cwd?: string; label?: string }): { id: number; label: string } {
    const shell = resolveShell();
    const id = nextId++;
    const p = spawn(shell.file, [], {
        cols: 80,
        rows: 24,
        cwd: opts?.cwd || process.env.USERPROFILE || process.env.HOME,
        name: "xterm-256color",
        env: process.env as unknown as Record<string, string>,
    });
    p.onData((data) => emit?.({ type: "data", id, data }));
    // exitCode 可能为 null（信号终止），对前端只关心「没了」
    p.onExit(() => {
        sessions.delete(id);
        emit?.({ type: "exit", id });
    });
    sessions.set(id, p);
    return { id, label: opts?.label || shell.label };
}

export function writeSession(id: number, data: string): boolean {
    const p = sessions.get(id);
    if (!p) return false;
    p.write(data);
    return true;
}

export function resizeSession(id: number, cols: number, rows: number): boolean {
    const p = sessions.get(id);
    if (!p) return false;
    p.resize(cols, rows);
    return true;
}

export function killSession(id: number): boolean {
    const p = sessions.get(id);
    if (!p) return false;
    p.kill();
    sessions.delete(id); // onExit 也会清，这里先删避免竞态期间仍可写
    return true;
}

/** 应用退出前统一回收（electron/main.ts 的 before-quit 调用） */
export function killAllSessions(): void {
    for (const p of sessions.values()) p.kill();
    sessions.clear();
}
