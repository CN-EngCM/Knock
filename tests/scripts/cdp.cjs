// 经调试端口操作隔离启动的窗口：在页面里执行 JS，或截图。零依赖，要求 Node 22 以上（自带 WebSocket）。
// 运行：node tests/scripts/cdp.cjs <端口> eval "<JS 表达式，可 await>"
//       node tests/scripts/cdp.cjs <端口> shot test-output/<主题>/<名字>.png
// 窗口由 tests/scripts/launch-isolated.cjs 启动。eval 的结果按 JSON 打印到标准输出。
const fs = require("node:fs");
const path = require("node:path");

const [port, command, arg] = process.argv.slice(2);
if (!port || !command || !arg) {
    console.error('用法：node tests/scripts/cdp.cjs <端口> eval "<JS>" | shot <文件>');
    process.exit(2);
}

async function main() {
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    // 主窗口才是要操作的页面；隐藏渲染窗口等其他页面都跳过
    const page =
        targets.find((t) => t.type === "page" && t.title.includes("Knock")) ?? targets.find((t) => t.type === "page");
    if (!page) throw new Error("没有可连接的页面");

    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((ok, fail) => {
        ws.onopen = ok;
        ws.onerror = () => fail(new Error("连接调试端口失败"));
    });
    let seq = 0;
    const pending = new Map();
    ws.onmessage = (ev) => {
        const msg = JSON.parse(String(ev.data));
        const done = pending.get(msg.id);
        if (!done) return;
        pending.delete(msg.id);
        if (msg.error) done.fail(new Error(msg.error.message));
        else done.ok(msg.result);
    };
    const call = (method, params) =>
        new Promise((ok, fail) => {
            const id = ++seq;
            pending.set(id, { ok, fail });
            ws.send(JSON.stringify({ id, method, params }));
        });

    if (command === "eval") {
        const r = await call("Runtime.evaluate", {
            // 包一层 async，脚本里可以直接写 await
            expression: `(async () => (${arg}))()`,
            awaitPromise: true,
            returnByValue: true,
        });
        if (r.exceptionDetails) {
            const detail = r.exceptionDetails.exception?.description ?? r.exceptionDetails.text;
            throw new Error(detail);
        }
        console.log(JSON.stringify(r.result.value, null, 2) ?? "undefined");
    } else if (command === "shot") {
        const r = await call("Page.captureScreenshot", { format: "png" });
        fs.mkdirSync(path.dirname(path.resolve(arg)), { recursive: true });
        fs.writeFileSync(arg, Buffer.from(r.data, "base64"));
        console.log(arg);
    } else {
        throw new Error(`未知命令：${command}`);
    }
    ws.close();
}

main().catch((e) => {
    console.error(e.message);
    process.exit(1);
});
