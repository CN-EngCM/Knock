// ── 终端会话（node-pty / Windows ConPTY）──
// 会话是纯运行时状态，不落库：Map<id, IPty>，应用退出时统一 kill，
// 否则隐藏到托盘再退出会留下孤儿 shell 进程。
// node-pty 1.1.0 的预编译是 NAPI 单二进制（prebuilds/ 随 npm 包分发），
// 与 Electron ABI 无关，因此 electron-deps.mjs 不需要为它做 ABI 切换。
import { existsSync, lstatSync } from "node:fs";
import { basename, delimiter, join } from "node:path";
import { spawn, type IPty } from "node-pty";
import { getSetting } from "./util/settings";
import { SHELL_IDS, type ShellId, type ShellOption, type TermConfig } from "./schemas";

/** 主进程 → 渲染进程的输出事件（preload 转发，渲染端按 id 分发到 xterm 实例） */
export type PtyEvent = { type: "data"; id: number; data: string } | { type: "exit"; id: number };

// server 层不持有 BrowserWindow：出口由 src/main/app.ts 注入
let emit: ((e: PtyEvent) => void) | null = null;
export function setPtySink(fn: (e: PtyEvent) => void): void {
    emit = fn;
}

const sessions = new Map<number, IPty>();
let nextId = 1;

// ConPTY 会把一次程序输出拆成许多很小的回调，逐块 send 到渲染进程会让 IPC 消息数
// 随输出量膨胀；这里按会话攒 8ms 再整批发出（块内顺序不变），洪峰下消息数降一个量级。
const outBuf = new Map<number, string[]>();
let outTimer: ReturnType<typeof setTimeout> | null = null;

function flushOut(): void {
    outTimer = null;
    if (!emit) {
        outBuf.clear();
        return;
    }
    const batches = [...outBuf];
    outBuf.clear();
    for (const [id, chunks] of batches) emit({ type: "data", id, data: chunks.join("") });
}

function queueOut(id: number, data: string): void {
    const chunks = outBuf.get(id);
    if (chunks) chunks.push(data);
    else outBuf.set(id, [data]);
    outTimer ??= setTimeout(flushOut, 8);
}

// 候选 shell 探测缓存（id → 绝对路径，null = 不可用），应用运行期内只探一次。
// 直接扫 PATH 而不起 `where` 子进程：打开设置页时不再同步等待外部进程。
// Windows 必须用 lstat：微软商店版 pwsh 是 WindowsApps 下的「应用执行别名」
// （重解析点），existsSync（stat 跟随链接）对它返回 false，lstat 不跟随才能探明；
// 能在 PATH 里找到即代表 CreateProcess 可执行（ConPTY 同路径）。
// macOS 保持原来的 existsSync 判断，探测结果不变。
const probed = new Map<string, string | null>();
function fileExistsOnPath(p: string): boolean {
    if (process.platform !== "win32") return existsSync(p);
    try {
        lstatSync(p);
        return true;
    } catch {
        return false;
    }
}
function probeShell(id: string): string | null {
    if (probed.has(id)) return probed.get(id) ?? null;
    const exe = process.platform === "win32" ? `${id}.exe` : id;
    let path: string | null = null;
    for (const raw of (process.env.PATH || "").split(delimiter)) {
        // Windows 的 PATH 项允许被引号包住（含分号的目录），去掉再拼
        const dir = raw.replace(/^"(.*)"$/, "$1");
        if (!dir) continue;
        const p = join(dir, exe);
        if (fileExistsOnPath(p)) {
            path = p;
            break;
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

/**
 * 拼在用户命令后面、「命令成功了才让 shell 退出」的那段文字。命令条目勾了自动关闭就用它：
 * shell 一退出，渲染端已有的处理就会关掉终端面板；命令失败时 exit 不执行，shell 和面板都留着，报错还看得见。
 * PowerShell 5.1 没有 &&，用 $? 判断（原生程序退出码非 0 时为假）；cmd 和各类 POSIX shell 都认 &&（fish 3.0 起也认）。
 * 只有主进程知道实际用的是哪个 shell（设置里选「自动」时要探测），所以由这里给出，不让渲染端猜。
 */
function exitOnSuccess(label: string): string {
    return label === "pwsh" || label === "powershell" ? "; if ($?) { exit }" : " && exit";
}

/** 新建会话；返回 id、会话标签（渲染端做 tab 名）和 exitSuffix（见 exitOnSuccess）。
 *  opts 带 cwd（工作目录：工作区文件夹或命令条目显式填的目录，缺省主目录）与 label（会话标签）；
 *  不传时 label 用 shell 标签 */
export function spawnSession(opts?: { cwd?: string; label?: string }): {
    id: number;
    label: string;
    exitSuffix: string;
} {
    const shell = resolveShell();
    const id = nextId++;
    // 会话支持彩色输出，不能沿用启动进程禁色或精简终端的环境设置。
    const env: NodeJS.ProcessEnv = { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor" };
    delete env.NO_COLOR;
    const p = spawn(shell.file, [], {
        cols: 80,
        rows: 24,
        cwd: opts?.cwd || process.env.USERPROFILE || process.env.HOME,
        name: "xterm-256color",
        env: env as Record<string, string>,
    });
    p.onData((data) => queueOut(id, data));
    // exitCode 可能为 null（信号终止），对前端只关心「没了」
    p.onExit(() => {
        // 先发完缓冲里的输出再发 exit，渲染端才不会丢掉最后一段
        flushOut();
        sessions.delete(id);
        emit?.({ type: "exit", id });
    });
    sessions.set(id, p);
    return { id, label: opts?.label || shell.label, exitSuffix: exitOnSuccess(shell.label) };
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

/** 应用退出前统一回收（src/main/app.ts 的 before-quit 调用） */
export function killAllSessions(): void {
    for (const p of sessions.values()) p.kill();
    sessions.clear();
}
