// ── Netscape 书签文件解析器（Chrome/Edge「导出书签」格式）──
// 格式本质是一棵用 <DL> 缩进表达的文件夹树：
//   <DT><H3>文件夹名</H3> <DL><p> …子内容… </DL><p>
//   <DT><A HREF="url">标题</A>
// 解析策略：用一条「顺序敏感」的组合正则在整个文本上按出现顺序扫描
// 三种标记（H3 开文件夹、A 书签、/DL 关文件夹），维护一个名称栈。
// 不按行切分，因此对换行位置没有任何假设。

// Chrome 导出文件里的根节点名：这些不算真实分组，穿透之。
// （根下的直接子文件夹才是用户建的分组）
const ROOT_NAMES =
  /^(书签栏|收藏夹栏|其他书签|其他收藏夹|移动设备书签|Bookmarks? ?[Bb]ar?|Other [Bb]ookmarks?|Mobile [Bb]ookmarks?|Favorites?)$/

// 根节点下未入文件夹的书签，归入此后备分组
export const FALLBACK_GROUP = '导入书签'

export type ParsedGroup = { title: string; url: string }[]

/** HTML 实体解码（导出文件里 & < > " ' 以及数字实体都会出现） */
function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
}

/**
 * 解析书签 HTML → 分组名到书签数组的有序映射。
 * 嵌套文件夹按「最深一级文件夹名」归组（重名自然合并）。
 */
export function parseNetscapeBookmarks(html: string): Map<string, ParsedGroup> {
  // 三种标记按出现顺序匹配；正则的 | 分支保持先后优先级
  const tokenRe =
    /<DT>\s*<H3[^>]*>([\s\S]*?)<\/H3>|<DT>\s*<A\s[^>]*?HREF="([^"]*)"[^>]*>([\s\S]*?)<\/A>|<\/DL>/gi

  const groups = new Map<string, ParsedGroup>()
  // 名称栈：null 表示「透明」的根节点（不参与分组命名）
  const stack: (string | null)[] = []

  /** 当前书签应归属的分组名：自栈顶向下找第一个非透明层 */
  function currentGroup(): string {
    for (let i = stack.length - 1; i >= 0; i--) {
      const name = stack[i]
      if (name !== null) return name
    }
    return FALLBACK_GROUP
  }

  let m: RegExpExecArray | null
  while ((m = tokenRe.exec(html)) !== null) {
    if (m[1] !== undefined) {
      // <DT><H3>：开文件夹。栈空时遇到根节点名 → 透明
      const name = decodeEntities(m[1]).trim()
      const transparent = stack.length === 0 && ROOT_NAMES.test(name)
      stack.push(transparent ? null : name)
    } else if (m[2] !== undefined) {
      // <DT><A HREF>：一条书签，归入当前分组
      const group = currentGroup()
      const list = groups.get(group) ?? []
      list.push({ title: decodeEntities(m[3] ?? '').trim(), url: decodeEntities(m[2]) })
      groups.set(group, list)
    } else {
      // </DL>：关文件夹（最外层 DL 关闭时栈已空，忽略）
      stack.pop()
    }
  }

  return groups
}
