import rawManifest from "material-icon-theme/dist/material-icons.json";

// Material Icon Theme（VS Code 里装机量最大的图标主题）自带一份「文件名 / 扩展名 / 文件夹名 → 图标」
// 的映射表和全套 svg。这里直接读它的映射表，不手写规则：映射与图标出自同一个包，不会对不上。
// 本文件体积较大（映射表约 450KB）。快捷启动条目（lib/kindIcon.tsx）和搜索候选用它，
// 后者在首屏就要画图标，所以它进主包，不能再靠面板懒加载来省。

type NameMap = Record<string, string>;
type Overrides = {
    fileNames?: NameMap;
    fileExtensions?: NameMap;
    folderNames?: NameMap;
    folderNamesExpanded?: NameMap;
};
type Manifest = Overrides & {
    iconDefinitions: Record<string, { iconPath: string }>;
    /** 浅色主题的覆盖：默认图标是给深色底画的，少数在浅底上看不清，包里另给了 *_light 款 */
    light: Overrides;
    file: string;
    folder: string;
    folderExpanded: string;
};
const manifest = rawManifest as unknown as Manifest;

// ?no-inline：不让 Vite 把小 svg 转成 data 地址塞进 js。这里有一千多个图标，
// 转了会让面板的 js 膨胀成一大坨；不转则是一千多个独立文件，只有真正显示到的才会被请求。
const urlByFile: Record<string, string> = {};
const modules = import.meta.glob<string>("../../../../node_modules/material-icon-theme/icons/*.svg", {
    query: "?url&no-inline",
    import: "default",
    eager: true,
});
for (const [path, url] of Object.entries(modules)) urlByFile[path.slice(path.lastIndexOf("/") + 1)] = url;

/** 图标名 → 图片地址；映射表里有名字但包里缺文件时退回默认文件图标 */
function urlOf(iconId: string): string {
    const iconPath = manifest.iconDefinitions[iconId]?.iconPath ?? "";
    return urlByFile[iconPath.slice(iconPath.lastIndexOf("/") + 1)] ?? urlByFile["file.svg"] ?? "";
}

/** 图标名在包里存在吗。库里存的名字可能是旧版遗留或包升级后删掉的，认不得就让调用方回退到自动匹配；
 *  用 hasOwn 而不是 in，免得 "constructor" 之类的名字命中原型 */
export function hasIcon(iconId: string): boolean {
    return Object.hasOwn(manifest.iconDefinitions, iconId);
}

/** 按图标名直接取图：网页、应用、终端命令没有文件名可匹配，由调用方各指定包里的一张；
 *  用户手选的图标也走这里。浅色主题下，有专为浅底画的 `<名>_light` 款就换上它 */
export function namedIconUrl(iconId: string, light = false): string {
    return urlOf(light && hasIcon(`${iconId}_light`) ? `${iconId}_light` : iconId);
}

/** 可手选的图标：浅色款随主题自动换、展开款（-open）只在文件夹展开时才用，都不单列，剩 900 多个 */
const PICKABLE = Object.keys(manifest.iconDefinitions)
    .filter((id) => !/_light$|-open$/.test(id))
    .sort();

/** 图标名 → 映射到它的扩展名 / 文件名 / 文件夹名。第一次搜索时才建，用不到不花时间 */
let keywordsById: Map<string, string[]> | null = null;
function keywordsOf(iconId: string): string[] {
    if (!keywordsById) {
        keywordsById = new Map();
        for (const table of [manifest.fileExtensions, manifest.fileNames, manifest.folderNames]) {
            for (const [key, id] of Object.entries(table ?? {})) {
                const list = keywordsById.get(id);
                if (list) list.push(key);
                else keywordsById.set(id, [key]);
            }
        }
    }
    return keywordsById.get(iconId) ?? [];
}

/**
 * 搜可选图标：图标名等于关键字、或有扩展名 / 文件名 / 文件夹名等于关键字的排最前
 * （用户记得的是 md 而不是 markdown；只认「等于」，否则搜 md 会被一大片无关的淹没），
 * 其余图标名里包含关键字的排在后面。关键字为空返回全部。
 */
export function searchIcons(query: string): string[] {
    const q = query.trim().toLowerCase().replace(/^\./, "");
    if (!q) return PICKABLE;
    // 完全匹配里文件图标排在文件夹图标前：包里 md 也是文件夹名（folder-markdown），但搜 md 多半想要文档图标
    const exact = PICKABLE.filter((id) => id === q || keywordsOf(id).includes(q)).sort(
        (a, b) => Number(a.startsWith("folder")) - Number(b.startsWith("folder")),
    );
    const partial = PICKABLE.filter((id) => id.includes(q) && !exact.includes(id));
    return [...exact, ...partial];
}

/** 浅色主题先查覆盖表，查不到再查通用表 */
function lookup(table: keyof Overrides, key: string, light: boolean): string | undefined {
    return (light ? manifest.light[table]?.[key] : undefined) ?? manifest[table]?.[key];
}

/**
 * 文件图标：先按完整文件名，再按扩展名（从最长的试起，`a.test.ts` 先试 `test.ts` 再试 `ts`），
 * 都没有用默认文件图标。名字统一转小写，映射表的键都是小写。
 */
export function fileIconUrl(name: string, light: boolean): string {
    const lower = name.toLowerCase();
    const byName = lookup("fileNames", lower, light);
    if (byName) return urlOf(byName);
    for (let dot = lower.indexOf("."); dot !== -1; dot = lower.indexOf(".", dot + 1)) {
        const byExt = lookup("fileExtensions", lower.slice(dot + 1), light);
        if (byExt) return urlOf(byExt);
    }
    return urlOf(manifest.file);
}

/** 文件夹图标：按文件夹名匹配（src、docs、node_modules 等各有自己的图标），展开时换开口款 */
export function folderIconUrl(name: string, expanded: boolean, light: boolean): string {
    const lower = name.toLowerCase();
    const byName = lookup(expanded ? "folderNamesExpanded" : "folderNames", lower, light);
    if (byName) return urlOf(byName);
    return urlOf(expanded ? manifest.folderExpanded : manifest.folder);
}
