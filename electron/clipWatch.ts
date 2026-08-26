import { clipboard } from "electron";
import { getSetting } from "../server/util/settings";

// ── 剪贴板时间戳（v2.3 素材流）──
// Windows/macOS 都没有「剪贴板最后修改时间」的系统 API，Electron 也不暴露，
// 唯一途径是常驻轮询比对文本、变化即打点。呼出窗口时用打点判断
// 「最近一次复制」是否落在时限内（时限存 settings 表 clipPasteWindow，秒，
// 0 = 关闭）。500ms 轮询一次原生调用，对常驻托盘应用的开销可忽略。
let lastText = "";
let lastChangedAt = 0;
let started = false;

export function startClipWatch(): void {
    if (started) return;
    started = true;
    lastText = clipboard.readText();
    setInterval(() => {
        const t = clipboard.readText();
        if (t !== lastText) {
            lastText = t;
            lastChangedAt = Date.now();
        }
    }, 500);
}

/** 呼出时取「新鲜素材」：超时限 / 空剪贴板 / 功能关闭都返回 null */
export function freshClipboardText(): string | null {
    const sec = Number(getSetting("clipPasteWindow", "5"));
    if (!Number.isFinite(sec) || sec <= 0) return null;
    const t = clipboard.readText();
    if (!t) return null;
    // 轮询间隔内的新复制可能尚未打点：文本与上次记录不同也视为新鲜
    if (Date.now() - lastChangedAt <= sec * 1000 || t !== lastText) {
        lastText = t;
        return t;
    }
    return null;
}
