import db from "../db";

// settings 表的键值读写。值一律存 TEXT 字符串，调用方自行转换类型。
export function getSetting(key: string, fallback: string): string {
    const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
    return row?.value ?? fallback;
}

export function setSetting(key: string, value: string): void {
    db.prepare(
        "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    ).run(key, value);
}
