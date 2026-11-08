/** 终端名的长度上限：顶栏按钮和菜单宽度有限，长标题会撑坏布局 */
export const TERM_TITLE_MAX = 24;

/**
 * 清洗终端标题。空串返回 null，调用方据此保持原名（手改名与终端标题两种来源共用）。
 * 手改名的输入框与 OSC 标题走同一套规则，避免同一个终端出现两种宽度行为。
 */
export function cleanTermTitle(raw: string): string | null {
    const title = raw.trim();
    return title ? title.slice(0, TERM_TITLE_MAX) : null;
}
