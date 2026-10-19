import { app } from "electron";
import { join } from "node:path";

// ── 开机自启 ──
// v1 的三平台手工实现（注册表+VBS / LaunchAgent / XDG desktop）全部退役，
// 统一交给 Electron 的 app.setLoginItemSettings（Windows 写 HKCU Run，
// macOS 写 SMAppService，Linux 写 autostart desktop）。

export type AutostartStatus = { supported: boolean; enabled: boolean };
export type AutostartResult = { ok: boolean; error?: string };

// 自启以 --hidden 启动：只进托盘不弹窗（呼出靠热键）。
// 当前打的是目录版（dir 目标），process.execPath 就是真实 exe，直接注册即可；
// 保留 portable 分支作为兜底：若改回单文件 exe，其运行时先解压到 %TEMP%，
// process.execPath 指向临时目录——注册它毫无意义，必须用 portable 运行时
// 注入的 PORTABLE_EXECUTABLE_DIR/FILE 还原原始 exe 路径。
//
// 实测注意：setLoginItemSettings / getLoginItemSettings 的匹配是
// path + args 两者都参与的——读写必须用完全相同的组合，否则状态读回 false。
function loginItemOpts(): { path: string; args: [string] } {
    const dir = process.env.PORTABLE_EXECUTABLE_DIR;
    const file = process.env.PORTABLE_EXECUTABLE_FILE;
    const path = dir && file ? join(dir, file) : process.execPath;
    return { path, args: ["--hidden"] };
}

export function autostartStatus(): AutostartStatus {
    const { path, args } = loginItemOpts();
    const cur = app.getLoginItemSettings({ path, args });
    return { supported: true, enabled: cur.openAtLogin };
}

export function enableAutostart(): AutostartResult {
    const { path, args } = loginItemOpts();
    app.setLoginItemSettings({ openAtLogin: true, path, args });
    // setLoginItemSettings 不返回成败——写后读一次验证
    return autostartStatus().enabled ? { ok: true } : { ok: false, error: "failed" };
}

export function disableAutostart(): AutostartResult {
    const { path, args } = loginItemOpts();
    app.setLoginItemSettings({ openAtLogin: false, path, args });
    return { ok: true };
}
