// 界面主题：深浅由 settings 表 theme 键持久化（主进程开窗前同源直读），
// 渲染端只负责给 <html> 套/摘 .dark 类——全部令牌按类切换（见 index.css）。
export type ThemeId = "dark" | "light";

/** 读 <html> 当前主题类（初始值由 main.tsx 在首帧前按持久化值套好） */
export function currentTheme(): ThemeId {
    return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

/** 应用主题到 <html>；GaN.UI 令牌、通知容器与终端实色随之切换 */
export function applyTheme(theme: ThemeId): void {
    document.documentElement.classList.toggle("dark", theme === "dark");
}
