import { readdir, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
// type-only import 编译期擦除，不构成运行时循环依赖
import type { ApiResult } from "./api";

// ── 文件树：只负责读一层目录。排序、图标都在渲染端，这里不过滤、不排序 ──

/** path 在这里拼好：渲染端不自己拼，省得处理 Windows 与 macOS 的分隔符差异 */
export type DirEntry = { name: string; path: string; isDir: boolean };

/**
 * dir 是否等于或位于 root 之内。只做字面比较，不跟随符号链接判断真实位置：
 * 目的是挡住界面传错参数，不当成安全边界（单机单用户，用户本来就能在自己的文件夹里放链接）。
 * Windows 上 path.relative 不分大小写；跨盘符时返回的是绝对路径，所以要一并排除。
 */
function isInside(root: string, dir: string): boolean {
    const rel = relative(resolve(root), resolve(dir));
    if (rel === "") return true;
    // 不能写成 startsWith("..")：名叫 "..foo" 的子目录会被误判成越界
    return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/** 读 root（工作区文件夹）内某个目录的直接子项 */
export async function listDir(root: string, dir: string): Promise<ApiResult<{ entries: DirEntry[] }>> {
    if (!isInside(root, dir)) return { ok: false, error: { kind: "bad-request" } };
    try {
        const dirents = await readdir(dir, { withFileTypes: true });
        const entries = await Promise.all(
            dirents.map(async (d): Promise<DirEntry> => {
                const path = join(dir, d.name);
                if (!d.isSymbolicLink()) return { name: d.name, path, isDir: d.isDirectory() };
                // 符号链接（含 Windows 的 junction）要看目标是什么；坏链接 stat 会抛错，当文件处理
                try {
                    return { name: d.name, path, isDir: (await stat(path)).isDirectory() };
                } catch {
                    return { name: d.name, path, isDir: false };
                }
            }),
        );
        return { ok: true, data: { entries } };
    } catch (e) {
        // 目录没了（或其中一段变成了文件）与其余读失败（权限等）分开：前者引导用户改文件夹，后者只能重试
        const code = (e as NodeJS.ErrnoException).code;
        const kind = code === "ENOENT" || code === "ENOTDIR" ? "missing" : "failed";
        return { ok: false, error: { kind, path: dir } };
    }
}
