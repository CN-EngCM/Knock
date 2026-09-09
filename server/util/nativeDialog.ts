// ── 原生对话框抑制计数 ──
// 主窗口「失焦自动隐藏」（electron/main.ts 的 blur 处理）与原生对话框互斥：
// 文件/目录选择框打开的瞬间主窗口必然失焦，不抑制会被自动藏到弹窗后面。
// 计数而非布尔：编辑条目与图库导入理论上可叠开两个框。
let count = 0;

/** 包住一次原生对话框调用：在框存活期间 nativeDialogOpen() 为真 */
export async function withNativeDialog<T>(fn: () => Promise<T>): Promise<T> {
    count++;
    try {
        return await fn();
    } finally {
        count--;
    }
}

/** blur 自动隐藏的判定用：当前是否有原生对话框在场 */
export function nativeDialogOpen(): boolean {
    return count > 0;
}
