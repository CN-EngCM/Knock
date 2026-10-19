import { app, dialog } from "electron";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import {
    DB_NAME,
    defaultDataRoot,
    migrateDataFiles,
    readPointer,
    removeDbArtifacts,
    samePath,
    targetIsEmpty,
    upgradeLegacyData,
    writePointer,
} from "./server/util/dataLocation";

// ── 启动引导：开库前确定数据目录 ──
// server 侧模块在 import 求值链上同步打开 SQLite，因此本文件必须先于
// await import("./server/api") 执行（index.ts 的 whenReady 里编排）；
// 它只依赖纯 fs 的 dataLocation 与原生弹窗，不触达任何会开库的模块。
//
// 弹窗文案内联双语（app.getLocale() 判断），不 import src/renderer/src/i18n——那是渲染层的东西。

export async function resolveDataDirOnBoot(): Promise<void> {
    const zh = app.getLocale().startsWith("zh");
    // 一次性升级：默认根旧名 MyPage → Knock（有旧数据则已在此时迁移并落好指针）
    upgradeLegacyData();
    const dir = readPointer();

    // 无指针 = 从未启动过：问一次「存哪里」，选默认也写指针，一生只弹一次
    if (dir === null) {
        await firstBoot(zh);
        return;
    }
    // 指针有效（目录里有 mypage.db）→ 正常启动，开库的事交给后面的动态 import
    if (existsSync(join(dir, DB_NAME))) return;

    // 指针存在但目标不可用：绝不能静默新建空库（那等于丢掉全部数据），
    // 走恢复流程——让用户把指针指回已有数据的那份 mypage.db
    await recoverUnavailable(zh, dir);
}

/** 首次引导：数据存哪里？[使用默认位置] / [选择文件夹…]（Esc / 关闭 = 默认） */
async function firstBoot(zh: boolean): Promise<void> {
    // 此刻窗口还没建，dialog 没有父窗口——macOS 不会自动把应用带到前台，
    // 弹窗会藏在其他应用后面像「没反应」，先抢一次焦点（Windows 无感）
    app.focus();
    const root = defaultDataRoot();
    for (;;) {
        const { response } = await dialog.showMessageBox({
            type: "question",
            message: zh ? "数据将存放在哪里？" : "Where should your data be stored?",
            detail: zh
                ? "之后可在 设置 → 数据目录 中更改。"
                : "You can change this later in Settings → Data directory.",
            buttons: [
                zh ? `使用默认位置（${root}）` : `Use default location (${root})`,
                zh ? "选择文件夹…" : "Choose folder…",
            ],
            cancelId: 0, // Esc / 关闭视为选默认
            noLink: true,
        });

        // 选默认也写指针：无指针的语义是「从未启动」，写过就不再引导
        if (response === 0) {
            writePointer(root);
            return;
        }

        const picked = await dialog.showOpenDialog({ properties: ["openDirectory"] });
        // 取消选择 = 落回默认
        if (picked.canceled || !picked.filePaths[0]) {
            writePointer(root);
            return;
        }
        const target = resolve(picked.filePaths[0]);

        // 手选了默认根 = 点「使用默认位置」：数据本就在位，指针一写即可
        //（不能落进下面的迁移分支——源=目标会把库复制到自己身上）
        if (samePath(target, root)) {
            writePointer(root);
            return;
        }

        // 自定义目录必须「空或不存在」，违规则提示后重选
        if (!targetIsEmpty(target)) {
            await dialog.showMessageBox({
                type: "warning",
                message: zh
                    ? "所选文件夹不是空的，请换一个空文件夹。"
                    : "The selected folder is not empty — pick an empty one.",
                buttons: [zh ? "好" : "OK"],
                noLink: true,
            });
            continue;
        }

        if (existsSync(join(root, DB_NAME))) {
            // 默认根已有老库 = 指针被删/老安装：整库搬去新位置，本次启动即生效、无需重启
            try {
                migrateDataFiles(root, target);
            } catch (e) {
                // 搬迁失败：清残留、留在默认根——老库原封未动（指针没写，dataDir()
                // 兜底也是默认根），应用照常可用
                console.error("[dataBoot] migrate failed, fallback to default:", e);
                try {
                    removeDbArtifacts(target);
                    writePointer(root);
                } catch (e2) {
                    console.error("[dataBoot] fallback cleanup failed:", e2);
                }
            }
            return;
        }

        // 全新安装：指针一写，后续 import 链上的 dataDir() 即按新目录开库建库
        writePointer(target);
        return;
    }
}

/** 指针目标不可用的恢复流程：所选目录必须已有 mypage.db（指回已有数据） */
async function recoverUnavailable(zh: boolean, dir: string): Promise<void> {
    app.focus(); // 同 firstBoot：无父窗口的弹窗在 mac 要先抢前台才可见
    for (;;) {
        const { response } = await dialog.showMessageBox({
            type: "warning",
            message: zh ? `数据目录不可用：${dir}` : `Data directory unavailable: ${dir}`,
            detail: zh ? "目录不存在，或里面没有 mypage.db。" : "The folder is missing, or contains no mypage.db.",
            buttons: [zh ? "选择其他目录" : "Choose another folder", zh ? "退出" : "Quit"],
            cancelId: 1, // Esc = 退出：没有可用数据就无法继续
            noLink: true,
        });
        if (response === 1) {
            app.exit(1);
            return;
        }

        const picked = await dialog.showOpenDialog({ properties: ["openDirectory"] });
        // 取消回到上面的提示框，用户仍可选「退出」
        if (picked.canceled || !picked.filePaths[0]) continue;
        const target = resolve(picked.filePaths[0]);

        if (!existsSync(join(target, DB_NAME))) {
            await dialog.showMessageBox({
                type: "warning",
                message: zh
                    ? "所选文件夹里没有 mypage.db，请重新选择。"
                    : "No mypage.db in the selected folder — pick again.",
                buttons: [zh ? "好" : "OK"],
                noLink: true,
            });
            continue;
        }

        writePointer(target);
        // 指针改指后重启：让全部模块按新指针干净地重新加载，不带着旧目录状态跑
        app.relaunch();
        app.exit(0);
        return;
    }
}
