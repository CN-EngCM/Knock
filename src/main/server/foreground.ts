import { createRequire } from "node:module";
import { basename } from "node:path";

// ── 前台窗口查询（Windows 专用）──
// Electron 没有「谁在最前面」的接口，用 koffi 直接调系统函数：
//   GetForegroundWindow → GetWindowThreadProcessId → OpenProcess → QueryFullProcessImageNameW。
// 其他平台、koffi 加载失败、受保护进程不让查，一律返回 null——调用方把 null 当作
// 「没命中」放行，保证呼出热键永远可用。

/** 只要查询权限即可，对以管理员身份运行的游戏也有效 */
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;

type Query = () => string | null;

/** 按需加载：写在函数里而不是文件顶部，koffi 缺失时只是查不到，不会让应用启动崩溃 */
function createQuery(): Query | null {
    if (process.platform !== "win32") return null;
    try {
        const koffi = createRequire(import.meta.url)("koffi") as typeof import("koffi");
        const user32 = koffi.load("user32.dll");
        const kernel32 = koffi.load("kernel32.dll");
        const GetForegroundWindow = user32.func("__stdcall", "GetForegroundWindow", "void *", []);
        const GetWindowThreadProcessId = user32.func("__stdcall", "GetWindowThreadProcessId", "uint32", [
            "void *",
            "void *",
        ]);
        const OpenProcess = kernel32.func("__stdcall", "OpenProcess", "void *", ["uint32", "bool", "uint32"]);
        const QueryFullProcessImageNameW = kernel32.func("__stdcall", "QueryFullProcessImageNameW", "bool", [
            "void *",
            "uint32",
            "void *",
            "void *",
        ]);
        const CloseHandle = kernel32.func("__stdcall", "CloseHandle", "bool", ["void *"]);

        return () => {
            const hwnd = GetForegroundWindow();
            if (!hwnd) return null;
            // 输出参数用类型化数组接：koffi 调用后会把结果写回去
            const pid = new Uint32Array(1);
            GetWindowThreadProcessId(hwnd, pid);
            const proc = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid[0]);
            if (!proc) return null;
            try {
                // 路径最长 32767 个字符，但绝大多数在 260 以内；装不下时调用失败，同样当「查不到」
                const buf = Buffer.alloc(520 * 2);
                const len = new Uint32Array([520]); // 传入缓冲区字符数，返回实际字符数
                if (!QueryFullProcessImageNameW(proc, 0, buf, len)) return null;
                return basename(buf.toString("utf16le", 0, len[0] * 2)).toLowerCase();
            } finally {
                CloseHandle(proc);
            }
        };
    } catch (e) {
        console.warn("[foreground] koffi 不可用，前台程序屏蔽将失效：", e);
        return null;
    }
}

// undefined = 还没尝试加载；null = 已尝试且不可用（不重复尝试）
let query: Query | null | undefined;

/** 前台窗口所属程序的文件名（小写，如 "chrome.exe"）；查不到返回 null */
export function foregroundExeName(): string | null {
    if (query === undefined) query = createQuery();
    try {
        return query ? query() : null;
    } catch {
        return null;
    }
}
