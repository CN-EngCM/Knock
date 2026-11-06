import rawManifest from "material-icon-theme/dist/material-icons.json";

// Material Icon Theme（VS Code 里装机量最大的图标主题）自带一份「文件名 / 扩展名 / 文件夹名 → 图标」
// 的映射表和全套 svg。这里直接读它的映射表，不手写规则：映射与图标出自同一个包，不会对不上。
// 本文件体积较大（映射表约 450KB），只被文件树面板引用，面板懒加载，不拖慢启动。

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
