// 字体栈单点定义：默认值必须与 src/index.css 里非 inline @theme 块的
// --font-sans/--font-mono 保持一致（CSS 变量是这里 setProperty 写下去的，
// CSS 文件里的声明只做无设置时的初始值）。一边改了另一边要同步。
export const DEFAULT_SANS_STACK = "system-ui, sans-serif";
export const DEFAULT_MONO_STACK = '"Cascadia Mono", Consolas, "Sarasa Mono SC", ui-monospace, monospace';

/** 拼用户字体与默认栈：用户值在前优先命中，默认栈兜底防字体名失效掉到浏览器默认 */
export function withFallback(userFont: string, defaultStack: string): string {
    return userFont ? `${userFont}, ${defaultStack}` : defaultStack;
}

/** 把用户设置写到 <html> 行内样式：行内优先级高于 :root，font-sans/font-mono
 *  工具类引用 var() 即随之热生效（要求 @theme 非 inline，见 index.css 注释） */
export function applyFonts(uiFont: string, monoFont: string): void {
    document.documentElement.style.setProperty("--font-sans", withFallback(uiFont, DEFAULT_SANS_STACK));
    document.documentElement.style.setProperty("--font-mono", withFallback(monoFont, DEFAULT_MONO_STACK));
}
