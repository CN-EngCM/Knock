// 拼音匹配规则自检：lib/pinyinMatch.ts 的 matchText（顶栏搜索框与「选快捷方式」弹窗共用）。
// 运行：node tests/scripts/pinyin-match-check.mjs（Node ≥ 24，直接读 .ts，不启动界面）
// 全部通过退出码为 0，有失败项会逐条列出。查询按约定由调用方 trim 并转小写，所以这里不测大写。
// 不覆盖：搜索框里 chip 在场时不走拼音、工具描述不走拼音（那是 SearchBox 的调用方式，要在界面里看）。
import { matchText } from "../../src/renderer/src/lib/pinyinMatch.ts";

// [文字, 查询, 是否应命中, 说明]
const cases = [
    // 三种写法
    ["微信", "weixin", true, "全拼"],
    ["微信", "wx", true, "首字母"],
    ["微信", "wxin", true, "混拼：首字母 + 全拼"],
    ["微信", "weix", true, "混拼：全拼 + 首字母"],
    // 专家名称：搜索框对专家名也走同一个函数
    ["AI翻译", "fanyi", true, "专家名：全拼"],
    ["AI翻译", "fy", true, "专家名：首字母"],
    ["AI翻译", "aifanyi", true, "专家名：英文 + 全拼"],
    ["AI翻译", "翻译", true, "专家名：汉字字面"],
    ["AI翻译", "ai", true, "专家名：英文字面"],
    ["AI翻译", "fanyu", false, "专家名：拼错不命中"],
    // 位置、大小写、空格
    ["微信", "xin", true, "从中间的字开始"],
    ["网易云音乐", "yy", true, "从中间开始的首字母（易云）"],
    ["微信", "wei xin", true, "查询里的空格被忽略"],
    ["微信 开发者工具", "wxkf", true, "标题里的空格被跳过"],
    // 多音字：各个读音都算
    ["网易云音乐", "yinyue", true, "音乐 读 yue"],
    ["网易云音乐", "yinle", true, "音乐 读 le 也算"],
    ["银行", "yinhang", true, "银行 读 hang"],
    ["银行", "yinxing", true, "银行 读 xing 也算"],
    ["重庆", "chongqing", true, "重庆 读 chong"],
    ["重庆", "zhongqing", true, "重庆 读 zhong 也算"],
    // 夹英文
    ["QQ音乐", "qqyy", true, "英文 + 汉字首字母"],
    ["QQ音乐", "yinyue", true, "只打汉字部分"],
    ["Visual Studio Code 编辑器", "bianji", true, "英文后面的汉字"],
    ["Visual Studio Code 编辑器", "codebj", true, "英文 + 汉字首字母，空格被跳过"],
    // 字面匹配照旧
    ["Chrome", "chr", true, "纯英文连续包含"],
    ["微信", "微", true, "单个汉字"],
    ["a1", "a", true, "单个字母的字面匹配不受限制"],
    // 不该命中
    ["微信", "zz", false, "不相干的拼音"],
    ["微信", "xw", false, "顺序反了"],
    ["微信", "wxx", false, "多出来的字母"],
    ["Translate", "tl", false, "纯英文不做跳字模糊"],
    ["Visual Studio Code", "vsc", false, "纯英文不做缩写"],
    ["QQ音乐", "qyy", true, "从第二个 Q 开始也是连续的（同字面的 q音乐）"],
    ["QQ音乐", "qqyyy", false, "字母比字多"],
    // 至少 2 个字母才走拼音
    ["微信", "w", false, "1 个字母不走拼音"],
    ["微信", "x", false, "1 个字母不走拼音（中间的字）"],
    ["微信", " w ", false, "空格不算字母"],
    // 只认字母和空格的拼音查询
    ["微信2", "wx2", false, "带数字的查询不走拼音"],
    ["微信", "wx-", false, "带符号的查询不走拼音"],
];

let failed = 0;
for (const [text, q, want, note] of cases) {
    const got = matchText(text, q);
    if (got !== want) {
        failed++;
        console.log(`✗ matchText(${JSON.stringify(text)}, ${JSON.stringify(q)}) = ${got}，应为 ${want}（${note}）`);
    }
}

// withPinyin = false：搜索框带着剪贴板素材时用，只剩字面匹配
const literalOnly = [
    ["微信", "wx", false, "关了拼音就不命中"],
    ["微信", "weixin", false, "关了拼音就不命中（全拼）"],
    ["微信", "微", true, "字面照常"],
    ["Chrome", "chr", true, "字面照常（英文）"],
];
for (const [text, q, want, note] of literalOnly) {
    const got = matchText(text, q, false);
    if (got !== want) {
        failed++;
        console.log(
            `✗ matchText(${JSON.stringify(text)}, ${JSON.stringify(q)}, false) = ${got}，应为 ${want}（${note}）`,
        );
    }
}

const total = cases.length + literalOnly.length;
console.log(failed === 0 ? `全部通过（${total} 条）` : `${failed} / ${total} 条失败`);
process.exit(failed === 0 ? 0 : 1);
