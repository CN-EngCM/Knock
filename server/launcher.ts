import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import open from "open";

// ── 启动器：把一个条目在本机打开 ──
// - 应用（无参数）、文件、文件夹 → open 库走系统默认方式
//   （Windows: explorer/start，macOS: open，Linux: xdg-open）
// - 应用（带参数）→ 直接 spawn，参数走 argv 数组不经 shell，
//   路径含空格天然安全；此时要求 target 是真实 exe（不支持 .lnk）

/** 把参数字符串按引号规则切成 argv（"C:\a b" --flag → ['C:\a b', '--flag']） */
export function parseArgs(s: string): string[] {
    const out: string[] = [];
    let cur = "";
    let quote: string | null = null;
    for (const ch of s) {
        if (quote) {
            if (ch === quote) quote = null;
            else cur += ch;
            continue;
        }
        if (ch === '"' || ch === "'") {
            quote = ch;
            continue;
        }
        if (ch === " ") {
            if (cur) {
                out.push(cur);
                cur = "";
            }
            continue;
        }
        cur += ch;
    }
    if (cur) out.push(cur);
    return out;
}

export type LaunchError = { error: "missing" | "failed"; path?: string };

/** 打开条目。成功返回 null；失败返回结构化错误（含路径，供前端提示） */
export async function launchItem(item: {
    kind: "bookmark" | "app" | "file";
    target: string;
    args: string | null;
}): Promise<LaunchError | null> {
    // 启动前先验路径：失效路径要给出明确报错而不是静默失败
    if (!existsSync(item.target)) {
        return { error: "missing", path: item.target };
    }

    try {
        if (item.kind === "app" && item.args) {
            // detached + unref：让子进程脱离本服务独立存活
            const child = spawn(item.target, parseArgs(item.args), {
                detached: true,
                windowsHide: true,
            });
            child.unref();
        } else {
            await open(item.target);
        }
        return null;
    } catch {
        return { error: "failed", path: item.target };
    }
}
