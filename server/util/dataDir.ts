import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// 跨平台用户数据目录（存 SQLite 数据库等）：
//   Windows: %APPDATA%\MyPage
//   macOS:   ~/Library/Application Support/MyPage
//   Linux:   ~/.config/MyPage（尊重 XDG_CONFIG_HOME）
// 目录名沿用项目旧名 MyPage（改名 Knock 时未迁移），改了会找不到既有数据库。
export function dataDir(): string {
	let base: string;
	if (process.platform === "win32") {
		base = process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
	} else if (process.platform === "darwin") {
		base = join(homedir(), "Library", "Application Support");
	} else {
		base = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
	}
	const dir = join(base, "MyPage");
	mkdirSync(dir, { recursive: true });
	return dir;
}
