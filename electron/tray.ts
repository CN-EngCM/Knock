import { app, Tray, Menu, nativeImage, type BrowserWindow } from "electron";
import { join } from "node:path";

// ── 托盘 ──
// 左键单击 = 切换主窗口显隐（与热键等效）；
// 右键菜单 = 显示主窗口 / 设置 / 退出——「退出」是程序唯一退出入口。

/** 图标位置：开发态与打包态都是包根（out/ 的上一级）下的 assets/ */
function iconPath(): string {
    return join(__dirname, "..", "assets", "icon.png");
}

export function createTray(getWin: () => BrowserWindow | null, onSettings: () => void): Tray {
    let icon = nativeImage.createFromPath(iconPath()).resize({ width: 16, height: 16 });
    if (process.platform === "darwin") {
        // mac 菜单栏惯例是模板图：系统只取 alpha 通道、按明暗自动反色——
        // 直接沿用彩色图标，彩色在暗色菜单栏下会看不清
        icon.setTemplateImage(true);
    }
    const tray = new Tray(icon);
    tray.setToolTip("敲敲 Knock");

    const showWin = () => {
        const win = getWin();
        if (!win) return;
        if (win.isMinimized()) win.restore();
        win.show();
        win.focus();
    };

    tray.setContextMenu(
        Menu.buildFromTemplate([
            { label: "显示主窗口", click: showWin },
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
    tray.on("click", () => {
        const win = getWin();
        if (win && win.isVisible() && !win.isMinimized()) win.hide();
        else showWin();
    });

    return tray;
}
