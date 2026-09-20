// 背景色偏好:用户只选一个底色锚点(--bg-base),玻璃浮窗/弹窗/下拉/终端全族
// 由 index.css 的 color-mix 派生,保证同族协调。存 localStorage(与界面语言/布局
// 偏好同类,换数据目录不跟随是已知取舍)。
export const BG_DEFAULT = "#0d1428";

/** 预设色板(全部为深色,与薄荷绿强调色、白色文字阶梯协调);key 为 i18n 名 */
export const BG_PRESETS = [
    { value: BG_DEFAULT, key: "settings.bg.ink" },
    { value: "#101014", key: "settings.bg.graphite" },
    { value: "#000000", key: "settings.bg.black" },
    { value: "#1a120b", key: "settings.bg.warm" },
    { value: "#0c1f18", key: "settings.bg.pine" },
    { value: "#150e26", key: "settings.bg.violet" },
] as const;

const BG_KEY = "bgColor";

/** 读已存底色;脏值(手改 localStorage)回落默认,type=color 的 value 也要求规范 hex */
export function loadBgColor(): string {
    const saved = localStorage.getItem(BG_KEY);
    return saved !== null && /^#[0-9a-fA-F]{6}$/.test(saved) ? saved : BG_DEFAULT;
}

/** 仅应用(启动时/预览用):写 --bg-base 覆盖 CSS 默认值 */
export function applyBgColor(color: string) {
    document.documentElement.style.setProperty("--bg-base", color);
}

/** 应用并持久化(设置页提交用) */
export function saveBgColor(color: string) {
    localStorage.setItem(BG_KEY, color);
    applyBgColor(color);
}
