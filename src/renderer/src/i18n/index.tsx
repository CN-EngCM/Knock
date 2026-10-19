import { createContext, useEffect, useState, type ReactNode } from "react";
import { zh, type MessageKey } from "./zh";
import { en } from "./en";

// 语言包注册表：新增语言只需新增一个字典文件并在这里登记。
// as const 保住 zh 的字面量类型，使 Lang 成为 'zh' | 'en' 的精确联合。
const packs = { zh, en } as const;
export type Lang = keyof typeof packs;
export type { MessageKey };

// 首次访问按浏览器语言选默认值；之后尊重用户在页面上的选择。
function detectLang(): Lang {
    try {
        const saved = localStorage.getItem("mypage-lang");
        if (saved === "zh" || saved === "en") return saved;
    } catch {
        /* localStorage 不可用（如隐私模式）时忽略，走浏览器语言 */
    }
    return navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";
}

export type I18n = {
    lang: Lang;
    setLang: (lang: Lang) => void;
    /** 取一条文案；key 由 MessageKey 约束，写错编译期报错 */
    t: (key: MessageKey) => string;
};

// 本文件只导出「组件 + 类型」供 React Fast Refresh 正常工作；
// useI18n 钩子在 ./useI18n.ts。若把钩子也放这里，Fast Refresh 会
// 因“混合导出”而失效，热更新后页面会进入事件失效的脏状态（实测踩坑）。
export const I18nContext = createContext<I18n | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
    const [lang, setLangState] = useState<Lang>(detectLang);

    // 同步 <html lang>，让浏览器断字、读屏器发音跟随界面语言
    useEffect(() => {
        document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
    }, [lang]);

    const setLang = (next: Lang) => {
        setLangState(next);
        try {
            localStorage.setItem("mypage-lang", next);
        } catch {
            /* 忽略存储失败 */
        }
    };

    const t = (key: MessageKey) => packs[lang][key];

    return <I18nContext.Provider value={{ lang, setLang, t }}>{children}</I18nContext.Provider>;
}
