/** 终端标签标题的长度上限：dockview 标签条宽度固定，长标题会把相邻标签挤到看不见 */
export const TERM_TITLE_MAX = 24;

/**
 * 清洗终端标签标题。空串返回 null，调用方据此保持原名（手改名与终端标题两种来源共用）。
 * 手改名的输入框与 OSC 标题走同一套规则，避免同一个标签出现两种宽度行为。
 */
export function cleanTermTitle(raw: string): string | null {
    const title = raw.trim();
    return title ? title.slice(0, TERM_TITLE_MAX) : null;
}
