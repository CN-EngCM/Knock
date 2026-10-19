import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { app } from "electron";

// ── Everything 文件搜索（工具 files 的后端）──
// 官方 es.exe（MIT，随包分发于 assets/）经 IPC 查询正在运行的 Everything，
// 不开任何网络端口，与本应用「无 TCP/HTTP」的架构约束一致。
// 实测行为（ES 1.1.0.37），解析以此为准：
// - -export-json 的导出文件始终 UTF-8；字段 filename / size / date_modified，后两者可能缺失；
// - 文件夹行的 filename 以 \ 结尾，这是唯一的目录判定依据；
// - 无命中时导出的是 0 字节文件（不是 "[]"）；
// - Everything 未运行 → 退出码 8（找不到 IPC 窗口）。

export type FileHit = {
    /** 完整路径；文件夹以 \ 结尾 */
    path: string;
    name: string;
    isDir: boolean;
    /** 字节数（Everything 未给出时为 0） */
    size: number;
    /** ISO-8601 本地时间原串（2026-08-26T17:50:37），缺失为空串；排序已由 es 完成，前端只展示 */
    mtime: string;
};

export type FileSearchOptions = {
    only: "all" | "file" | "folder";
    exts: readonly string[];
    sort: "name" | "size" | "dm";
    ascending: boolean;
    limit: number;
};

/** everything = Everything 未运行；failed = 超时 / es.exe 缺失 / 输出异常 */
export type EverythingError = "everything" | "failed";

const SORT_ES = { name: "name", size: "size", dm: "date-modified" } as const;

/** es.exe 位置：打包版经 extraResources 放到 resources/（exe 不能从 asar 内 spawn）；开发版用仓库 assets/ */
export function esExePath(): string {
    return app.isPackaged ? join(process.resourcesPath, "es.exe") : join(app.getAppPath(), "assets", "es.exe");
}

export async function searchEverything(
    query: string,
    opts: FileSearchOptions,
): Promise<{ ok: true; hits: FileHit[] } | { ok: false; error: EverythingError }> {
    // 修饰符与查询词都是 Everything 原生语法，作为独立参数交给 es.exe 自行拼接
    const terms: string[] = [];
    if (opts.only === "file") terms.push("/a-d");
    if (opts.only === "folder") terms.push("/ad");
    if (opts.exts.length > 0) terms.push(`ext:${opts.exts.join(";")}`);

    // 编码坑（实测）：无控制台环境下（Electron 主进程 spawn 出的隐藏控制台是 ANSI
    // 代码页，中文系统 = GBK），es.exe 的 stdout 按代码页输出，按 UTF-8 解码即乱码；
    // 而 -export-json 的导出文件保证 UTF-8——所以结果走临时文件，不读 stdout。
    const dir = await mkdtemp(join(tmpdir(), "knock-es-"));
    const outFile = join(dir, "hits.json");
    const args = [
        "-size",
        "-dm",
        "-date-format", // 1 = ISO-8601，规避随系统区域变化的日期格式
        "1",
        "-no-digit-grouping",
        "-n",
        String(opts.limit),
        "-sort",
        `${SORT_ES[opts.sort]}-${opts.ascending ? "ascending" : "descending"}`,
        "-export-json",
        outFile,
        ...terms,
        query,
    ];

    const code = await new Promise<number>((resolve) => {
        const child = spawn(esExePath(), args, { windowsHide: true });
        // 索引查询本是毫秒级，3 秒视为挂死（Everything 卡死 / 索引重建中）
        const timer = setTimeout(() => {
            child.kill();
            resolve(-1);
        }, 3000);
        // es.exe 本体缺失（打包遗漏）等 spawn 层错误
        child.on("error", () => {
            clearTimeout(timer);
            resolve(-1);
        });
        child.on("close", (c) => {
            clearTimeout(timer);
            resolve(c ?? -1);
        });
    });

    try {
        if (code === 8) return { ok: false, error: "everything" };
        if (code !== 0) return { ok: false, error: "failed" };
        const text = (await readFile(outFile, "utf8")).trim();
        if (text === "") return { ok: true, hits: [] };
        const rows: unknown = JSON.parse(text);
        if (!Array.isArray(rows)) return { ok: false, error: "failed" };
        const hits: FileHit[] = [];
        for (const row of rows) {
            if (typeof row !== "object" || row === null) continue;
            const rec = row as Record<string, unknown>;
            const path = rec["filename"];
            if (typeof path !== "string") continue;
            const isDir = path.endsWith("\\");
            // 文件夹先去掉尾随 \ 再取最后一段；盘根 C:\ 退化为 "C:"
            const name = (isDir ? path.slice(0, -1) : path).split("\\").pop() ?? path;
            hits.push({
                path,
                name,
                isDir,
                size: typeof rec["size"] === "number" ? rec["size"] : 0,
                mtime: typeof rec["date_modified"] === "string" ? rec["date_modified"] : "",
            });
        }
        return { ok: true, hits };
    } catch {
        return { ok: false, error: "failed" };
    } finally {
        // 清理临时目录不阻塞返回
        void rm(dir, { recursive: true, force: true });
    }
}
