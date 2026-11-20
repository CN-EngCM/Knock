// 画廊分页回归检查，只允许连接 test-output 下的隔离数据目录。
// 先启动 launch-isolated.cjs，再运行 node tests/scripts/gallery-pagination-check.cjs [端口]。
const fs = require("node:fs");
const path = require("node:path");
const port = process.argv[2] ?? "9231";

async function main() {
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const page = targets.find((target) => target.type === "page" && target.title.includes("Knock"));
    if (!page) throw new Error("没有找到隔离窗口");
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
        ws.onopen = resolve;
        ws.onerror = reject;
    });
    let sequence = 0;
    const pending = new Map();
    ws.onmessage = (event) => {
        const message = JSON.parse(String(event.data));
        const request = pending.get(message.id);
        if (!request) return;
        pending.delete(message.id);
        if (message.error) request.reject(new Error(message.error.message));
        else request.resolve(message.result);
    };
    const call = (method, params) =>
        new Promise((resolve, reject) => {
            const id = ++sequence;
            pending.set(id, { resolve, reject });
            ws.send(JSON.stringify({ id, method, params }));
        });
    const evaluate = async (expression) => {
        const result = await call("Runtime.evaluate", {
            expression: `(async () => { ${expression} })()`,
            awaitPromise: true,
            returnByValue: true,
        });
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description);
        return result.result.value;
    };
    let failed = 0;
    const check = (name, passed, detail) => {
        console.log(`${passed ? "通过" : "失败"} ${name}：${JSON.stringify(detail)}`);
        if (!passed) failed++;
    };
    try {
        const data = await evaluate("return await window.knock.invoke('getDataDir');");
        if (!data.ok) throw new Error("无法读取当前数据目录");
        const output = path.resolve(__dirname, "../../test-output");
        const relative = path.relative(output, data.data.dir);
        if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
            throw new Error("当前窗口没有使用 test-output 下的隔离数据，停止检查");
        }
        const fixtures = path.resolve(output, "gallery-pagination/images");
        fs.mkdirSync(fixtures, { recursive: true });
        for (let i = 1; i <= 270; i++) {
            const number = String(i).padStart(3, "0");
            fs.writeFileSync(
                path.join(fixtures, `image-${number}.svg`),
                `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120"><rect width="160" height="120" fill="hsl(${i} 55% 45%)"/><text x="20" y="70" fill="white" font-size="36">${number}</text></svg>`,
            );
        }
        const overview = await evaluate("return await window.knock.invoke('galleryOverview');");
        let group = overview.data.groups.find((entry) => entry.name === "分页检查" || entry.name === "images");
        if (!group) {
            const imported = await evaluate(
                `return await window.knock.invoke('galleryImportFolder', ${JSON.stringify(fixtures)});`,
            );
            if (!imported.ok) throw new Error(`导入失败：${JSON.stringify(imported)}`);
            group = { id: imported.data.groupId };
        }
        await evaluate(`await window.knock.invoke('galleryRenameGroup', ${group.id}, '分页检查');`);
        await call("Emulation.setDeviceMetricsOverride", {
            width: 2560,
            height: 1600,
            deviceScaleFactor: 1,
            mobile: false,
        });
        await evaluate(`
            window.knock.setPinned(true);
            window.__galleryCheck = {
                wait: ms => new Promise(resolve => setTimeout(resolve, ms)),
                grid: () => document.querySelector('[data-index]')?.closest('[data-slot="context-menu-trigger"]'),
                viewer: () => document.querySelector('img[src^="mpimg://orig/"]')?.closest('[tabindex="-1"]'),
                counter: () => [...(window.__galleryCheck.viewer()?.querySelectorAll('span') ?? [])].find(el => /^\\d+\\/\\d+$/.test(el.textContent))?.textContent,
                until: async read => {
                    for (let i = 0; i < 100; i++) {
                        const result = read();
                        if (result) return result;
                        await new Promise(resolve => setTimeout(resolve, 50));
                    }
                    throw new Error('等待画廊界面超时');
                },
            };
            document.querySelector('[aria-label="关闭"]')?.click();
            document.querySelector('[aria-label="关闭gallery"]')?.click();
            await window.__galleryCheck.wait(100);
            document.querySelector('[aria-label="工具集"]').click();
            const menu = await window.__galleryCheck.until(() => [...document.querySelectorAll('[role="menuitem"]')].find(el => el.textContent.startsWith('gallery')));
            menu.click();
            const row = await window.__galleryCheck.until(() => document.querySelector('[data-gallery-group="${group.id}"]'));
            row.firstElementChild.click();
            await window.__galleryCheck.until(() => document.querySelectorAll('[data-index]').length >= 100);
            await window.__galleryCheck.wait(1000);
        `);
        const initial = await evaluate("return document.querySelectorAll('[data-index]').length;");
        check("大窗口在列表填充后继续加载缩略图", initial > 100, initial);
        await call("Emulation.setDeviceMetricsOverride", {
            width: 1280,
            height: 800,
            deviceScaleFactor: 1,
            mobile: false,
        });
        await evaluate(`
            document.querySelector('[data-gallery-group="${group.id}"]').firstElementChild.click();
            await window.__galleryCheck.wait(500);
        `);
        const beforeViewer = await evaluate("return document.querySelectorAll('[data-index]').length;");
        check("普通窗口从首批缩略图开始且没有滚动续载", beforeViewer === 100, beforeViewer);
        await evaluate(`document.querySelector('[data-index="0"]').click(); await window.__galleryCheck.wait(100);`);
        const first = await evaluate("return window.__galleryCheck.counter();");
        check("查看器显示完整分组数量", first === "1/270", first);
        const last = await evaluate(`
            for (let i = 0; i < 300 && window.__galleryCheck.counter() !== '270/270'; i++) {
                window.__galleryCheck.viewer().dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowRight', bubbles:true, cancelable:true}));
                await window.__galleryCheck.wait(20);
            }
            return window.__galleryCheck.counter();
        `);
        check("连续翻页能够越过第 200 张到最后一张", last === "270/270", last);
        const imageLoaded = await evaluate(`
            return !!await window.__galleryCheck.until(() => {
                const image = document.querySelector('img[src^="mpimg://orig/"]');
                return image?.complete && image.naturalWidth > 0;
            });
        `);
        check("第 270 张原图正常加载", imageLoaded, imageLoaded);
        const endpoint = await evaluate(`
            const next = window.__galleryCheck.viewer().querySelector('[aria-label="下一张"]');
            const disabled = next?.disabled;
            window.__galleryCheck.viewer().dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowLeft', bubbles:true, cancelable:true}));
            await window.__galleryCheck.wait(50);
            return {disabled, counter:window.__galleryCheck.counter()};
        `);
        check("最后一张禁用前进且可以后退", endpoint.disabled && endpoint.counter === "269/270", endpoint);
        await evaluate(`
            window.__galleryCheck.viewer().dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true, cancelable:true}));
            for (let i = 0; i < 10; i++) {
                const grid = window.__galleryCheck.grid();
                grid.scrollTop = grid.scrollHeight;
                await window.__galleryCheck.wait(100);
            }
        `);
        const thumbnails = await evaluate("return document.querySelectorAll('[data-index]').length;");
        check("缩略图可滚动加载全部 270 张", thumbnails === 270, thumbnails);
        for (const [search, count] of [
            ["image-1", 100],
            ["image-270", 1],
            ["没有这张图片", 0],
        ]) {
            await evaluate(`
                const input = document.querySelector('input[placeholder="搜索文件名…"]');
                input.focus();
                input.select();
            `);
            await call("Input.insertText", { text: search });
            await evaluate("await window.__galleryCheck.wait(700);");
            const filtered = await evaluate("return document.querySelectorAll('[data-index]').length;");
            check(`搜索 ${search} 后重置列表`, filtered === count, filtered);
        }
    } finally {
        await call("Emulation.clearDeviceMetricsOverride", {});
        ws.close();
    }
    process.exitCode = failed ? 1 : 0;
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
