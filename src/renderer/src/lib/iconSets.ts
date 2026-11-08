import { useSyncExternalStore } from "react";
import { hasIcon as hasFileIcon, namedIconUrl as fileIconByName } from "@/lib/fileIcon";

// 条目图标除了文件类图标包（Material Icon Theme，名字不带前缀，见 lib/fileIcon.ts）之外，
// 另有四套 Iconify 格式的图标库，图标名写成「库名:图标名」，如 mdi:home、logos:github-icon。
// 每个库是一个 icons.json（图标名 → svg 内容），最大的 logos 有 8.5MB，所以每个库都懒加载成独立的块，
// 第一次要用到才载入。没载入前给透明占位，载入后通知订阅的组件重绘（useIconSets）。
// 显示仍然走 <img>：svg 在这里现拼成 data 地址，调用方不用换元素。

export type IconSetId = "logos" | "fluent-color" | "mdi" | "ix";

type SvgIcon = { body: string; width?: number; height?: number };
type SetData = { icons: Record<string, SvgIcon>; width?: number; height?: number };

type SetMeta = {
    id: IconSetId;
    /** 单色库：svg 里用 currentColor，而 <img> 里的 svg 吃不到页面的文字色，所以拼 svg 时按主题把颜色写死 */
    mono: boolean;
    /** 选择器里只列满足条件的名字（icons 是整个库，供查同名的其他款） */
    listed?: (name: string, icons: Record<string, SvgIcon>) => boolean;
};

export const ICON_SETS: readonly SetMeta[] = [
    // 不少品牌同时有字标版（一串文字，缩到图标大小看不清）和紧凑的 -icon 版（github 与 github-icon），
    // 有 -icon 版的就只列它
    { id: "logos", mono: false, listed: (name, icons) => !Object.hasOwn(icons, `${name}-icon`) },
    // 每个图标有 16/20/24/28/32/48 六个尺寸，只留 24px 一款，免得一屏全是长得一样的
    { id: "fluent-color", mono: false, listed: (name) => name.endsWith("-24") },
    { id: "mdi", mono: true },
    { id: "ix", mono: true },
];

// 单色库的颜色取自 index.css 的 --foreground（浅色 / 深色）
const MONO_COLOR = { light: "#1d1d1e", dark: "#e8e9ec" };
// 品牌 logo 垫底用的反色底
const BACKDROP_COLOR = { light: "#2b2d31", dark: "#e8e9ec" };

const loaderById = new Map(
    Object.entries(
        import.meta.glob<SetData>("../../../../node_modules/@iconify-json/{logos,fluent-color,mdi,ix}/icons.json", {
            import: "default",
        }),
    ).map(([path, load]) => [path.match(/@iconify-json\/([^/]+)\//)![1], load]),
);

const loaded = new Map<IconSetId, SetData>();
const loading = new Map<IconSetId, Promise<void>>();

// 载入完成就把版本号加一，useIconSets 靠它触发重绘
let version = 0;
const listeners = new Set<() => void>();

/** 订阅图标库载入：用到新库图标的组件调一下，库载入完会重绘。返回版本号，可当 memo 依赖 */
export function useIconSets(): number {
    return useSyncExternalStore(
        (onChange) => {
            listeners.add(onChange);
            return () => listeners.delete(onChange);
        },
        () => version,
    );
}

export function isIconSetLoaded(id: IconSetId): boolean {
    return loaded.has(id);
}

/** 载入一个库；重复调用共用同一次载入，失败会抛出并允许下次重试 */
export function loadIconSet(id: IconSetId): Promise<void> {
    let task = loading.get(id);
    if (!task) {
        task = loaderById.get(id)!().then(
            (data) => {
                loaded.set(id, data);
                version++;
                listeners.forEach((fn) => fn());
            },
            (error) => {
                loading.delete(id);
                throw error;
            },
        );
        loading.set(id, task);
    }
    return task;
}

/** 图标名属于哪个新库；不带前缀的（文件类图标包）或前缀认不得返回 null */
export function iconSetOf(name: string): SetMeta | null {
    const colon = name.indexOf(":");
    if (colon < 0) return null;
    return ICON_SETS.find((set) => set.id === name.slice(0, colon)) ?? null;
}

/**
 * 库里认得这个图标名吗。库还没载入就核对不了，先当认得，载入后再判：
 * 包升级删了图标时，调用方据此回退成「自动」，和文件类图标包的做法一致。
 */
export function isKnownIcon(name: string): boolean {
    const set = iconSetOf(name);
    if (!set) return !name.includes(":") && hasFileIcon(name);
    const data = loaded.get(set.id);
    return data ? Object.hasOwn(data.icons, name.slice(set.id.length + 1)) : true;
}

const PLACEHOLDER = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E";
const urlCache = new Map<string, string>();

/**
 * svg 里写死的十六进制色的平均亮度（0 黑 ~ 1 白）。没有十六进制色时：什么颜色都没写的路径
 * 按 SVG 的默认填充算纯黑（苹果、OpenAI、X、Vercel 等 188 个 logo 就是这样）；
 * 写了别的颜色写法（命名色、渐变）的算不出来，返回 null。
 */
function averageLuminance(body: string): number | null {
    const colors = body.match(/#(?:[0-9a-f]{6}|[0-9a-f]{3})\b/gi);
    if (!colors) return /fill=|stroke=|style=|url\(#/.test(body) ? null : 0;
    let sum = 0;
    for (const color of colors) {
        const hex = color.length === 4 ? [...color.slice(1)].map((c) => c + c).join("") : color.slice(1);
        const n = parseInt(hex, 16);
        sum += (((n >> 16) & 255) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 255000;
    }
    return sum / colors.length;
}

function buildSvg(data: SetData, icon: SvgIcon, mono: boolean, light: boolean): string {
    const w = icon.width ?? data.width ?? 24;
    const h = icon.height ?? data.height ?? 24;
    const theme = light ? "light" : "dark";
    let inner = icon.body;
    let paint = "";
    if (mono) {
        // color 管 currentColor，fill 管没写填充的路径
        paint = ` color="${MONO_COLOR[theme]}" fill="${MONO_COLOR[theme]}"`;
    } else {
        // 品牌 logo 里有不少近黑（GitHub）或近白的，和同色的底融在一起就看不见：
        // 颜色太接近底色时，垫一块反色的圆角底，logo 缩到八成放在中间
        const lum = averageLuminance(icon.body);
        if (lum !== null && (light ? lum > 0.9 : lum < 0.25)) {
            const base = `<rect width="${w}" height="${h}" rx="${w * 0.2}" fill="${BACKDROP_COLOR[theme]}"/>`;
            inner = `${base}<g transform="translate(${w * 0.1} ${h * 0.1}) scale(0.8)">${icon.body}</g>`;
        }
    }
    return (
        `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
        `viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"${paint}>${inner}</svg>`
    );
}

/**
 * 条目图标名 → 图片地址，文件类图标包（不带前缀）和新库（带前缀）都走这里。
 * 新库没载入时先给透明占位并开始载入，载入完订阅了 useIconSets 的组件会重绘。
 * light 对单色库决定颜色，对文件类图标包决定要不要换浅底款。
 */
export function itemIconUrl(name: string, light: boolean): string {
    const set = iconSetOf(name);
    if (!set) return fileIconByName(name, light);
    const data = loaded.get(set.id);
    if (!data) {
        void loadIconSet(set.id).catch(() => {});
        return PLACEHOLDER;
    }
    const icon = data.icons[name.slice(set.id.length + 1)];
    if (!icon) return PLACEHOLDER;
    const key = `${name}|${light}`;
    let url = urlCache.get(key);
    if (!url) {
        url = `data:image/svg+xml;utf8,${encodeURIComponent(buildSvg(data, icon, set.mono, light))}`;
        urlCache.set(key, url);
    }
    return url;
}

const namesCache = new Map<IconSetId, string[]>();

/**
 * 搜某个库里可选的图标，返回带前缀的完整图标名；库没载入返回空。
 * 只搜图标名（英文）：用空格分开的几个词要全包含（arrow right 能找到 arrow-right），
 * 名字等于整句、或以第一个词开头的排前面。关键字为空返回全部。
 */
export function searchSetIcons(id: IconSetId, query: string): string[] {
    const data = loaded.get(id);
    const set = ICON_SETS.find((s) => s.id === id);
    if (!data || !set) return [];
    let names = namesCache.get(id);
    if (!names) {
        names = Object.keys(data.icons)
            .filter((name) => set.listed?.(name, data.icons) ?? true)
            .sort();
        namesCache.set(id, names);
    }
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return names.map((name) => `${id}:${name}`);
    const joined = words.join("-");
    const rank = (name: string) => (name === joined ? 0 : name.startsWith(words[0]) ? 1 : 2);
    return names
        .filter((name) => words.every((word) => name.includes(word)))
        .sort((a, b) => rank(a) - rank(b))
        .map((name) => `${id}:${name}`);
}
