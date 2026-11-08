import { session } from "electron";
import { IMPORT_PARTITION } from "./server/chromeLogin";

/** 把会话数据刷盘：cookie 默认攒一阵才写，app.exit 不等。改数据目录重启前必须调用，否则搬过去的是旧登录态 */
export async function flushBrowserData(): Promise<void> {
    const sessions = [session.defaultSession, session.fromPartition(IMPORT_PARTITION)];
    await Promise.allSettled(sessions.flatMap((s) => [s.cookies.flushStore(), s.flushStorageData()]));
}
