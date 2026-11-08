import { match } from "pinyin-pro";

// 有汉字才值得走拼音：纯英文的文字保持原来的「连续包含」，不被库的模糊规则影响
const HAS_HAN = /[㐀-鿿]/;
// 拼音查询只认字母和空格；带数字、符号、汉字的查询靠字面匹配就够了
const PINYIN_QUERY = /^[a-z ]+$/;
// 少于 2 个字母不走拼音：打一个 w 会命中所有首字母是 w 的条目
const MIN_PINYIN_LETTERS = 2;

/**
 * text 是否命中查询 q。q 由调用方 trim 并转成小写。
 *
 * 字面包含永远算；withPinyin 为真时再认拼音：全拼、首字母、混拼都行
 * （wx / weixin / wxin 都命中「微信」），可以从中间的字开始，空格会被忽略，多音字的各个读音都算。
 *
 * 必须带 continuous：不带的话库按「跳着字」匹配，tl 也会命中 Translate，英文就太吵了。
 */
export function matchText(text: string, q: string, withPinyin = true): boolean {
    if (text.toLowerCase().includes(q)) return true;
    if (!withPinyin || !HAS_HAN.test(text) || !PINYIN_QUERY.test(q)) return false;
    if (q.replace(/ /g, "").length < MIN_PINYIN_LETTERS) return false;
    return match(text, q, { continuous: true }) !== null;
}
