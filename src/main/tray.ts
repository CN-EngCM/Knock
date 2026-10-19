import { app, Tray, Menu, nativeImage } from "electron";
import { join } from "node:path";

// ── 托盘 ──
// 左键单击 = 切换主窗口显隐（与热键等效）；
// 右键菜单 = 显示主窗口 / 设置 / 退出——「退出」是程序唯一退出入口。
// 显隐动作由 index.ts 注入（onToggle/onShow）：隐藏必经统一入口清钉，
// 呼出走 showWindow 的前台锁破局流程，托盘不再自持窗口操作。

/** 图标位于应用根目录，避免依赖构建后的代码目录。 */
function iconPath(): string {
    return join(app.getAppPath(), "assets", "icon.png");
}

export function createTray(onSettings: () => void, onToggle: () => void, onShow: () => void): Tray {
    let icon = nativeImage.createFromPath(iconPath()).resize({ width: 16, height: 16 });
    if (process.platform === "darwin") {
        // mac 菜单栏惯例是模板图：系统只取 alpha 通道、按明暗自动反色——
        // 直接沿用彩色图标，彩色在暗色菜单栏下会看不清
        icon.setTemplateImage(true);
    }
    const tray = new Tray(icon);
    tray.setToolTip("敲敲 Knock");

    tray.setContextMenu(
        Menu.buildFromTemplate([
            { label: "显示主窗口", click: onShow },
            { label: "设置", click: onSettings },
            { type: "separator" },
            {
                label: "退出",
                click: () => {
                    app.quit();
                },
            },
        ]),
    );

    // Windows 习惯：左键单击托盘切换窗口显隐
    tray.on("click", onToggle);

    return tray;
}
