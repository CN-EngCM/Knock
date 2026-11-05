// 生成图库测试图片：大 JPEG 若干张（内容各不相同，避开 sha256 去重）、大 PNG、WebP、GIF、BMP、SVG。
// 运行：npx electron tests/scripts/gen-gallery-images.cjs <输出目录>（目录放 test-output/<主题>/ 下）
// 可用参数：--count=30 控制 JPEG 张数，--size=6000x4000 控制 JPEG 尺寸（要几百张时用小图，省磁盘）。
// JPEG 用 nativeImage 编码，WebP 用隐藏窗口的 canvas 编码。
const { app, BrowserWindow, nativeImage } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const args = process.argv.slice(2).filter((a) => !a.startsWith("--") && !a.endsWith(".cjs"));
const countArg = process.argv.find((a) => a.startsWith("--count="));
const count = countArg ? Number(countArg.slice("--count=".length)) : 30;
const sizeArg = process.argv.find((a) => a.startsWith("--size="));
const [jpegWidth, jpegHeight] = (sizeArg ? sizeArg.slice("--size=".length) : "6000x4000").split("x").map(Number);
const outDir = args[0];

function noisy(width, height) {
    const bitmap = Buffer.alloc(width * height * 4);
    let seed = 12345;
    for (let i = 0; i < bitmap.length; i += 4) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        const noise = (seed >> 16) & 31;
        const x = (i / 4) % width;
        const y = Math.floor(i / 4 / width);
        bitmap[i] = (x / width) * 200 + noise;
        bitmap[i + 1] = (y / height) * 200 + noise;
        bitmap[i + 2] = 120 + noise;
        bitmap[i + 3] = 255;
    }
    return nativeImage.createFromBitmap(bitmap, { width, height });
}

app.on("window-all-closed", () => {});
app.whenReady().then(async () => {
    if (!outDir) {
        console.error("用法：npx electron tests/scripts/gen-gallery-images.cjs <输出目录> [--count=30]");
        app.exit(2);
        return;
    }
    fs.mkdirSync(outDir, { recursive: true });

    const jpeg = noisy(jpegWidth, jpegHeight).toJPEG(90);
    for (let i = 0; i < count; i++) {
        // JPEG 结束标记之后的字节不影响解码：加序号就能让每张的 sha256 不同
        fs.writeFileSync(path.join(outDir, `photo-${i}.jpg`), Buffer.concat([jpeg, Buffer.from(`#${i}`)]));
    }
    fs.writeFileSync(path.join(outDir, "large.png"), noisy(1600, 1200).toPNG());

    const win = new BrowserWindow({ show: false });
    await win.loadURL("about:blank");
    const webpBase64 = await win.webContents.executeJavaScript(`new Promise((resolve) => {
        const canvas = document.createElement("canvas");
        canvas.width = 2000;
        canvas.height = 1500;
        const g = canvas.getContext("2d");
        g.fillStyle = "#3a6";
        g.fillRect(0, 0, 2000, 1500);
        g.fillStyle = "#fff";
        g.fillRect(200, 200, 1200, 800);
        canvas.toBlob((blob) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result).split(",")[1]);
            reader.readAsDataURL(blob);
        }, "image/webp");
    })`);
    win.destroy();
    fs.writeFileSync(path.join(outDir, "banner.webp"), Buffer.from(webpBase64, "base64"));

    // GIF 与 BMP 只要能验证解码和尺寸，最小样本就够了
    fs.writeFileSync(
        path.join(outDir, "tiny.gif"),
        Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64"),
    );
    fs.writeFileSync(
        path.join(outDir, "tiny.bmp"),
        Buffer.from("Qk06AAAAAAAAADYAAAAoAAAAAQAAAAEAAAABABgAAAAAAAQAAAATCwAAEwsAAAAAAAAAAAAA/wAAAA==", "base64"),
    );
    fs.writeFileSync(
        path.join(outDir, "vector.svg"),
        '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80"><rect width="100" height="80" fill="red"/></svg>',
    );
    console.log(`已生成到 ${outDir}`);
    app.exit(0);
});
