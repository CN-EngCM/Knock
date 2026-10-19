import { spawn } from "node:child_process";
import { statSync } from "node:fs";
import type { FileHit, FileSearchOptions } from "./everything";

// ── Spotlight 文件搜索（工具 files 的 macOS 后端，对应 Windows 的 Everything）──
// mdfind 走系统 Spotlight 索引，无网络端口，与本应用「无 TCP/HTTP」约束一致。
// 与 es.exe 的差异（决定实现形态）：
// - 只做文件名匹配（-name 子串），没有 Everything 的查询语法——
//   only/exts 过滤与 name/size/dm 排序都在拿到路径后由 JS 复刻；
// - Spotlight 索引有延迟，刚落盘的文件可能搜不到（Everything 是实时监听）。

/** stdout 累积上限（约一万条路径）：防极端海量结果撑内存，截断后排序仍够用 */
const OUT_CAP = 512 * 1024;
const TIMEOUT_MS = 5000;

export async function searchSpotlight(
    query: string,
    opts: FileSearchOptions,
): Promise<{ ok: true; hits: FileHit[] } | { ok: false; error: "failed" }> {
    const paths = await runMdfind(query);
    if (paths === null) return { ok: false, error: "failed" };

    const hits: FileHit[] = [];
    for (const p of paths) {
        let st;
        try {
            st = statSync(p);
        } catch {
            continue; // 索引里有、盘上已没了（或权限不足）：丢弃
        }
        if (opts.only === "file" && st.isDirectory()) continue;
        if (opts.only === "folder" && !st.isDirectory()) continue;
        const name = p.slice(p.lastIndexOf("/") + 1);
        if (opts.exts.length > 0 && !matchExt(name, opts.exts)) continue;
        hits.push({
            path: p,
            name,
            isDir: st.isDirectory(),
            // 目录大小对用户无意义，与 es 的表现对齐（恒 0）
            size: st.isDirectory() ? 0 : st.size,
            mtime: isoLocal(st.mtime),
        });
    }

    hits.sort(comparator(opts.sort, opts.ascending));
    return { ok: true, hits: hits.slice(0, opts.limit) };
}

/** 后缀匹配语义对齐 es 的 ext:——按最后一个点切，整串相等（不含点本体的通配） */
function matchExt(name: string, exts: readonly string[]): boolean {
    const i = name.lastIndexOf(".");
    if (i <= 0) return false; // 无后缀或隐藏文件（.gitignore）不参与
    const ext = name.slice(i + 1).toLowerCase();
    return exts.some((e) => e.toLowerCase() === ext);
}

/** 排序比较器：name 按本地化不区分大小写（贴近资源管理器观感），size/dm 数值比较 */
function comparator(sort: FileSearchOptions["sort"], ascending: boolean): (a: FileHit, b: FileHit) => number {
    const dir = ascending ? 1 : -1;
    if (sort === "name")
        return (a, b) => dir * a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
    if (sort === "size") return (a, b) => dir * (a.size - b.size);
    // mtime 是定长 ISO 本地串，字典序即时间序
    return (a, b) => dir * (a.mtime < b.mtime ? -1 : a.mtime > b.mtime ? 1 : 0);
}

/** Date → es 同款本地 ISO 串（2026-08-26T17:50:37）：前端按原串展示，不做时区换算 */
function isoLocal(d: Date): string {
    const pad = (n: number) => String(n).padStart(2, "0");
    return (
        `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
        `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
    );
}

/** 跑一次 mdfind -name：失败/超时返回 null；截断（超量 kill）时仍算成功 */
function runMdfind(query: string): Promise<string[] | null> {
    return new Promise((resolve) => {
        // stderr 是 Spotlight 的 locale 加载日志，直接丢弃（不读的 pipe 可能塞满阻塞子进程）
        const child = spawn("mdfind", ["-name", query], { stdio: ["ignore", "pipe", "ignore"] });
        let out = "";
        let killed = false;
        const timer = setTimeout(() => {
            killed = true;
            child.kill();
        }, TIMEOUT_MS);
        child.stdout.setEncoding("utf8");
        child.stdout.on("data", (d: string) => {
            out += d;
            if (out.length > OUT_CAP && !killed) {
                killed = true;
                child.kill();
            }
        });
        child.on("error", () => {
            clearTimeout(timer);
            resolve(null);
        });
        child.on("close", (code) => {
            clearTimeout(timer);
            // mdfind 成功与无命中都是 0；被我们主动 kill 的截断场景也照常解析已有输出
            if (code !== 0 && !killed) return resolve(null);
            resolve(
                out
                    .split("\n")
                    .map((s) => s.trim())
                    .filter(Boolean),
            );
        });
    });
}
