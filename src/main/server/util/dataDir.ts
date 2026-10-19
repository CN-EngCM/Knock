import { mkdirSync } from "node:fs";
import { defaultDataRoot, readPointer } from "./dataLocation";

// 当前数据目录：唯一事实来源是默认根下的指针文件 data-location.json（见 dataLocation.ts）。
// 无指针 = 从未启动过 → 兜底默认根（主进程启动引导会在开库前把指针补上）。
// mkdir 只对最终确定的目录做；「指针指向的目录不存在」是启动引导判定目标不可用、
// 走恢复流程的依据——若在这里提前创建，恢复流程就会被静默换成空库。
export function dataDir(): string {
    const dir = readPointer() ?? defaultDataRoot();
    mkdirSync(dir, { recursive: true });
    return dir;
}
