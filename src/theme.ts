// 主题模式：auto（跟随系统）/ light / dark。
// “生效主题”由 CSS 决定：html 无 data-theme = 跟随系统，
// 有则强制指定（见 src/index.css 的令牌规则）。

export type ThemeMode = "auto" | "light" | "dark";

const STORAGE_KEY = "mypage-theme";

export function initialTheme(): ThemeMode {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved === "light" || saved === "dark" || saved === "auto") return saved;
    } catch {
        /* 忽略存储失败 */
    }
    return "auto";
}

// 把模式写到 <html data-theme> 上；auto 时移除属性交还系统偏好。
export function applyTheme(mode: ThemeMode): void {
    if (mode === "auto") {
        delete document.documentElement.dataset.theme;
    } else {
        document.documentElement.dataset.theme = mode;
    }
}

export function saveTheme(mode: ThemeMode): void {
    try {
        localStorage.setItem(STORAGE_KEY, mode);
    } catch {
        /* 忽略存储失败 */
    }
}
