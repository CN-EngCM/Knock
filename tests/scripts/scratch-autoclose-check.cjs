// 临时工作区小工具自动关闭的界面自检：窗口藏起 / 切到别的工作区会计时，回来取消，终端不受影响，设置里改时长重新计时。
// 运行：先 node tests/scripts/launch-isolated.cjs scratch-close --port=9223（隔离实例，不碰真实数据），
//       再 node tests/scripts/scratch-autoclose-check.cjs [端口] [主题]
// 把页面里 ≥5 分钟的定时器缩短 60 倍（5 分钟 = 5 秒，10 分钟 = 10 秒），所以整套约一分钟跑完。
// 会在隔离库里新建一个叫「测试区」的工作区，并把自动关闭时长改成 5 分钟；
// 「回来」靠再起一个 electron 触发 second-instance 呼出窗口；全部通过退出码为 0。
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const port = process.argv[2] ?? "9223";
const topic = process.argv[3] ?? "scratch-close";
const root = path.resolve(__dirname, "..", "..");
const base = path.join(root, "test-output", topic);

async function connect() {
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const page =
        targets.find((t) => t.type === "page" && t.title.includes("Knock")) ?? targets.find((t) => t.type === "page");
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((ok, fail) => {
        ws.onopen = ok;
        ws.onerror = () => fail(new Error("连接调试端口失败"));
    });
    let seq = 0;
    const pending = new Map();
    ws.onmessage = (ev) => {
        const m = JSON.parse(String(ev.data));
        const p = pending.get(m.id);
        if (!p) return;
        pending.delete(m.id);
        if (m.error) p.fail(new Error(m.error.message));
        else p.ok(m.result);
    };
    const call = (method, params) =>
        new Promise((ok, fail) => {
            const id = ++seq;
            pending.set(id, { ok, fail });
            ws.send(JSON.stringify({ id, method, params }));
        });
    return {
        close: () => ws.close(),
        sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
        async eval(expr) {
            const r = await call("Runtime.evaluate", {
                expression: `(async () => (${expr}))()`,
                awaitPromise: true,
                returnByValue: true,
            });
            if (r.exceptionDetails)
                throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
            return r.result.value;
        },
        // 不能在页面里 location.reload()：主进程的 will-navigate 在打包态会把它拦掉，页面根本不重载
        reload: () => call("Page.reload", {}),
        async key(key) {
            const vk = { Enter: 13, Escape: 27, ArrowDown: 40, ArrowUp: 38 }[key];
            const base = { key, code: key, windowsVirtualKeyCode: vk };
            await call("Input.dispatchKeyEvent", { type: "keyDown", ...base });
            await call("Input.dispatchKeyEvent", { type: "keyUp", ...base });
        },
    };
}

let failed = 0;
function check(name, ok, detail = "") {
    console.log(`${ok ? "通过" : "失败"}  ${name}${ok ? "" : `  ${detail}`}`);
    if (!ok) failed++;
}

// 再起一个 electron：单实例锁会把它转成第一个实例的 second-instance，窗口被呼出
function summonWindow() {
    const env = { ...process.env, APPDATA: path.join(base, "appdata") };
    delete env.ELECTRON_RUN_AS_NODE;
    const electronPath = require(path.join(root, "node_modules", "electron"));
    const t0 = Date.now();
    spawnSync(
        electronPath,
        [path.join(base, "out", "main", "index.js"), `--user-data-dir=${path.join(base, "appdata", "Knock")}`],
        { cwd: root, env, stdio: "ignore", timeout: 20000 },
    );
    return Date.now() - t0;
}

(async () => {
    if (!fs.existsSync(path.join(base, "out", "main", "index.js"))) {
        console.error(`没有找到 ${base}\\out，请先运行 launch-isolated.cjs ${topic}`);
        process.exit(2);
    }
    const c = await connect();
    const invoke = (name, ...args) =>
        c.eval(`window.knock.invoke(${JSON.stringify(name)}, ...${JSON.stringify(args)})`);
    const rowByName = (name) =>
        `[...document.querySelectorAll('button')].find(b => b.innerText.split(String.fromCharCode(10))[0].trim() === ${JSON.stringify(name)})`;
    // 工作区行的悬停提示以窗口数开头（"3 窗口 · …"），含工具、终端和网页面板
    const panelCount = async (name) => Number(await c.eval(`${rowByName(name)}?.title.split(" ")[0]`));
    const clickRow = (name) => c.eval(`${rowByName(name)}.click()`);
    const openFromMenu = async (name) => {
        await c.eval(`document.querySelector('[aria-label="工具集"]').click()`);
        await c.sleep(300);
        await c.eval(
            `[...document.querySelectorAll('[role=menuitem]')].find(e => e.innerText.startsWith(${JSON.stringify(name)}))?.click()`,
        );
        await c.sleep(600);
    };
    const SCRATCH = "临时工作区";
    const OTHER = "测试区";
    // 藏窗口：mp:hide-window 在钉住时被主进程忽略，所以先取消钉住；hide / show 事件计数用来证明窗口真的藏过、呼出过
    const hideWindow = async () => {
        await c.eval(`window.knock.setPinned(false)`);
        await c.eval(`window.knock.hideWindow()`);
        await c.sleep(300);
    };
    const showWindow = async () => {
        const ms = summonWindow();
        await c.sleep(500);
        await c.eval(`window.knock.setPinned(true)`);
        return ms;
    };
    const events = () => c.eval(`({ hidden: window.__hidden, shown: window.__shown })`);

    await c.eval(`window.knock.setPinned(true)`);

    // ── 准备：默认值、测试区、时长设成 5 分钟 ──
    const first = await invoke("getScratchAutoClose");
    console.log(`      读到的初始时长：${JSON.stringify(first)}（全新库应为 10）`);
    const wsList = await invoke("getWorkspaces");
    const scratchId = wsList.data.workspaces.find((w) => w.builtin).id;
    if (!wsList.data.workspaces.some((w) => w.name === OTHER)) {
        const made = await invoke("createWorkspace", OTHER, base);
        if (!made.ok) throw new Error("建测试区失败");
    }
    await invoke("setScratchAutoClose", 5);
    await invoke("setActiveWorkspace", scratchId);
    await c.reload();
    await c.sleep(2500);
    await c.eval(`window.knock.setPinned(true)`);
    // 缩短定时器：只动 ≥5 分钟的，其余照旧。必须在计时开始前装好，这里页面刚加载完还没人离开
    await c.eval(
        `(() => { const orig = window.setTimeout.bind(window); window.setTimeout = (fn, ms, ...a) => orig(fn, ms >= 300000 ? ms / 60 : ms, ...a); })()`,
    );
    await c.eval(
        `(() => { window.__hidden = 0; window.__shown = 0; window.knock.onWindowHidden(() => window.__hidden++); window.knock.onWindowShown(() => window.__shown++); })()`,
    );
    check("时长读回 5（重载后 App 启动读到）", (await invoke("getScratchAutoClose")).data.minutes === 5);

    // ── 1. 窗口藏起：小工具关，终端留 ──
    await openFromMenu("便签");
    await openFromMenu("json");
    await openFromMenu("终端");
    check("打开 便签 + json + 终端 后窗口数为 3", (await panelCount(SCRATCH)) === 3, String(await panelCount(SCRATCH)));
    await hideWindow();
    check("界面收到了隐藏事件", (await events()).hidden === 1, JSON.stringify(await events()));
    await c.sleep(2200);
    check("藏起 2.5 秒（没到 5 秒）还没关", (await panelCount(SCRATCH)) === 3, String(await panelCount(SCRATCH)));
    await c.sleep(5500);
    check("藏起满 5 秒：小工具关了，只剩终端", (await panelCount(SCRATCH)) === 1, String(await panelCount(SCRATCH)));

    // ── 2. 窗口藏起后在期限内呼出：计时取消 ──
    const ms = await showWindow();
    console.log(`      呼出耗时 ${ms}ms`);
    check("界面收到了显示事件", (await events()).shown === 1, JSON.stringify(await events()));
    await openFromMenu("便签");
    await openFromMenu("json");
    check("重新打开两个小工具，窗口数为 3", (await panelCount(SCRATCH)) === 3, String(await panelCount(SCRATCH)));
    await hideWindow();
    await c.sleep(700);
    const ms2 = await showWindow();
    console.log(`      呼出耗时 ${ms2}ms（要小于 3000，否则这一项不可信）`);
    await c.sleep(8000);
    check(
        "期限内呼出又留在临时工作区：8 秒后小工具仍在",
        (await panelCount(SCRATCH)) === 3,
        String(await panelCount(SCRATCH)),
    );

    // ── 3. 切到别的工作区：窗口开着也计时 ──
    await clickRow(OTHER);
    await c.sleep(2500);
    check("切走 2.5 秒还没关", (await panelCount(SCRATCH)) === 3, String(await panelCount(SCRATCH)));
    await c.sleep(5500);
    check("切走满 5 秒：小工具关了，终端还在", (await panelCount(SCRATCH)) === 1, String(await panelCount(SCRATCH)));

    // ── 4. 切走又在期限内切回：取消 ──
    await clickRow(SCRATCH);
    await c.sleep(600);
    await openFromMenu("便签");
    await openFromMenu("json");
    await clickRow(OTHER);
    await c.sleep(1500);
    await clickRow(SCRATCH);
    await c.sleep(8000);
    check("切走 1.5 秒又切回：8 秒后小工具仍在", (await panelCount(SCRATCH)) === 3, String(await panelCount(SCRATCH)));

    // ── 5. 普通工作区的小工具不受影响 ──
    // 一直待在测试区不回去：临时工作区的小工具到点关，测试区自己的便签不动
    await clickRow(OTHER);
    await c.sleep(600);
    await openFromMenu("便签");
    await c.sleep(8000);
    check("在测试区开的便签没被关", (await panelCount(OTHER)) === 1, String(await panelCount(OTHER)));
    check("临时工作区的小工具按切走计时关掉了", (await panelCount(SCRATCH)) === 1, String(await panelCount(SCRATCH)));

    // ── 6. 设置里改时长：按新时长重新数 ──
    await clickRow(SCRATCH);
    await c.sleep(600);
    await openFromMenu("便签");
    await openFromMenu("json");
    await clickRow(OTHER);
    await c.sleep(3000);
    await c.eval(`(document.querySelector('[aria-label="设置"]') ?? document.querySelector('[title="设置"]')).click()`);
    await c.sleep(800);
    // 下拉当前是 5 分钟，往下一格是 10 分钟；键盘操作比模拟指针稳
    await c.eval(
        `(() => { const label = [...document.querySelectorAll('label')].find(l => l.innerText.trim() === '小工具自动关闭'); label.parentElement.querySelector('[role=combobox]').focus(); })()`,
    );
    await c.key("Enter");
    await c.sleep(400);
    await c.key("ArrowDown");
    await c.key("Enter");
    await c.sleep(800);
    check("设置落库为 10 分钟", (await invoke("getScratchAutoClose")).data.minutes === 10);
    await c.key("Escape");
    await c.sleep(300);
    // 旧计时（5 秒）从切走算起已经过了 3 + 0.8 秒；若没重新数，再过 2 秒就会关
    await c.sleep(4000);
    check(
        "改成 10 分钟后原来的 5 秒计时作废：切走约 8 秒仍未关",
        (await panelCount(SCRATCH)) === 3,
        String(await panelCount(SCRATCH)),
    );
    await c.sleep(8000);
    check("按新时长（10 秒）重新数，到点关了", (await panelCount(SCRATCH)) === 1, String(await panelCount(SCRATCH)));

    // 复原：时长改回 5，免得影响下次手动看
    await invoke("setScratchAutoClose", 5);
    await c.eval(`${rowByName(SCRATCH)}.click()`);
    c.close();
    console.log(failed === 0 ? "全部通过" : `${failed} 项失败`);
    process.exit(failed === 0 ? 0 : 1);
})().catch((e) => {
    console.error(e.message);
    process.exit(1);
});
