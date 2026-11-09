import { pinyin } from "pinyin-pro";

// 搜索框的文本匹配：字面包含优先，其次才是拼音（全拼或首字母）。
// 返回值分两档而不是一个布尔，是因为调用方要把字面命中排在拼音命中前面，
// 这样只打英文或汉字时，结果和没有拼音功能时完全一样。

export type MatchKind = "literal" | "pinyin";

/** 拼音至少这么多个字母才参与：一个字母会把所有首字母相同的中文标题都捞出来 */
const MIN_PINYIN_QUERY = 2;
/** 关键词长过这个数就不可能是在打标题的拼音，直接放弃。
 *  复制来的素材（chip）可能是几 MB 的文本，不拦的话要对每个候选各扫一遍去空白 */
const MAX_PINYIN_QUERY = 64;

/** 一段文本的两种拼音串，都只含小写字母和数字 */
type PinyinForms = { full: string; initials: string };

// 每敲一个字，所有条目标题、工具名、别名都要重新比一遍，所以每段文本的拼音只算一次。
// 不清理：key 只是标题、工具名、别名，总量有限，改标题留下的旧项也只占几十个字节。
const cache = new Map<string, PinyinForms>();

/** 只留小写字母和数字：空格、标点不参与拼音匹配 */
function squash(s: string): string {
    return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function formsOf(text: string): PinyinForms {
    let forms = cache.get(text);
    if (!forms) {
        // 默认的数组输出里，汉字是一个音节（或首字母），英文数字则每个字符各占一项，
        // 所以「QQ音乐」得到全拼 qqyinyue、首字母 qqyy；v: true 让「绿」是 lv 而不是 lü。
        // 多音字只取库按上下文选出的那一个读音
        const options = { toneType: "none", type: "array", v: true } as const;
        forms = {
            full: squash(pinyin(text, options).join("")),
            initials: squash(pinyin(text, { ...options, pattern: "first" }).join("")),
        };
        cache.set(text, forms);
    }
    return forms;
}

/**
 * 判断 text 是否被关键词 q 命中。q 由调用方先 trim 并转小写（和原来的字面匹配同一个 q）。
 * 字面是普通的「包含」；字面不中才看拼音：q 去掉空白后，是全拼串或首字母串的子串即命中，
 * 所以 wei xin 等于 weixin。不支持汉字混拼音，也不支持带声调。
 */
export function matchText(text: string, q: string): MatchKind | null {
    if (text.toLowerCase().includes(q)) return "literal";
    if (q.length > MAX_PINYIN_QUERY) return null;
    const key = q.replace(/\s+/g, "");
    if (key.length < MIN_PINYIN_QUERY) return null;
    const { full, initials } = formsOf(text);
    return full.includes(key) || initials.includes(key) ? "pinyin" : null;
}
