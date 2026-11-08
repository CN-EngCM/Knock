// 便签与搜索框规则的界面自检：搜索框推荐顺序、命中区只打开、无命中不预选、带入便签、保存、编辑、删除撤销。
// 运行：先 node tests/scripts/launch-isolated.cjs notes --port=9222（隔离实例，不碰真实数据），
//       再 node tests/scripts/notes-check.cjs [端口]
// 全部通过退出码为 0。会在隔离库里新增几条便签，不碰系统剪贴板。
// 不覆盖：真实输入法、资源管理器复制文件的粘贴、拖拽（见实施文档的验收记录）。
const port = process.argv[2] ?? "9222";

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
        // 真实按键（modifiers 2 = Ctrl）
        async key(key, ctrl = false) {
            const vk = { Enter: 13, Escape: 27, ArrowDown: 40, Backspace: 8 }[key];
            const base = { key, code: key, windowsVirtualKeyCode: vk, modifiers: ctrl ? 2 : 0 };
            await call("Input.dispatchKeyEvent", {
                type: "keyDown",
                ...base,
                text: key === "Enter" && !ctrl ? "\r" : undefined,
            });
            await call("Input.dispatchKeyEvent", { type: "keyUp", ...base });
        },
        type: (text) => call("Input.insertText", { text }),
    };
}

let failed = 0;
function check(name, ok, detail = "") {
    console.log(`${ok ? "通过" : "失败"}  ${name}${ok ? "" : `  ${detail}`}`);
    if (!ok) failed++;
}

(async () => {
    const c = await connect();
    const visible = (sel) =>
        `[...document.querySelectorAll(${JSON.stringify(sel)})].filter(e => e.offsetParent !== null)`;
    const rows = () =>
        c.eval(
            `[...document.querySelectorAll('.drop-anim button')].map(b => b.innerText.split(String.fromCharCode(10))[0])`,
        );
    const search = async (text) => {
        await c.eval(`(() => { const s = document.getElementById("search"); s.focus(); s.select(); })()`);
        await c.key("Backspace");
        await c.type(text);
        await c.sleep(300);
    };
    const draft = () => c.eval(`${visible("textarea")}[0]?.value`);
    const noteCount = () => c.eval(`${visible("div.rounded-md.border.border-line.bg-background")}.length`);

    await c.eval(`window.knock.setPinned(true)`);
    // 先确保便签面板开着且草稿是空的（上一次跑剩下的草稿会干扰判断）
    await c.eval(`document.querySelector('[aria-label="工具集"]').click()`);
    await c.sleep(300);
    await c.eval(
        `[...document.querySelectorAll('[role=menuitem]')].find(e => e.innerText.startsWith('便签'))?.click()`,
    );
    await c.sleep(1000);
    await c.eval(`${visible("textarea")}[0].select()`);
    await c.key("Backspace");

    // 推荐区基础顺序与嗅探置顶
    await search("hello world");
    check(
        "推荐区基础顺序",
        JSON.stringify((await rows()).slice(0, 5)) === JSON.stringify(["便签", "json", "qrcode", "files", "translate"]),
    );
    await search('{"a":1}');
    check(
        "打 JSON：json 第一，便签第二",
        JSON.stringify((await rows()).slice(0, 2)) === JSON.stringify(["json", "便签"]),
    );
    await search("https://example.com");
    const linkRows = await rows();
    check(
        "打链接：qrcode 第一，便签第二",
        linkRows[0] === "qrcode" && linkRows[1] === "便签",
        JSON.stringify(linkRows),
    );

    // 命中区：吃文本的工具也能按名称命中，选中只打开；推荐区照常，所以同一个工具出现两次
    await search("便签");
    const exact = await rows();
    check("打「便签」：命中行 + 推荐行共两行便签", exact[0] === "便签" && exact[1] === "便签", JSON.stringify(exact));
    await c.key("Enter");
    await c.sleep(1000);
    check("命中区的工具行：只打开不带入", (await draft()) === "", JSON.stringify(await draft()));

    // 部分匹配也命中（原先 trans 显示「无匹配」的回归）：translate 排命中区第一行，推荐区里还有一行
    await search("trans");
    const partial = await rows();
    check(
        "打 trans：命中区第一行是 translate，推荐区里还有一行",
        partial[0] === "translate" && partial.filter((r) => r === "translate").length === 2,
        JSON.stringify(partial),
    );
    check(
        "打 trans：不再显示「无匹配」",
        await c.eval(`!document.querySelector('.drop-anim').innerText.includes('无匹配')`),
    );
    await c.key("Escape");

    // 没有任何命中：显示「无匹配」、不预选行，Enter 不做事，手打的字不会进便签
    await search("zzqq无命中");
    check("无命中：显示「无匹配」", await c.eval(`document.querySelector('.drop-anim').innerText.includes('无匹配')`));
    await c.key("Enter");
    await c.sleep(500);
    check("无命中：Enter 不带入便签", (await draft()) === "", JSON.stringify(await draft()));

    // 普通文字：无命中时先 ↓ 选推荐行再 Enter，带入便签输入框，不自动保存，焦点在输入框
    const before = await noteCount();
    await search("检查文字");
    await c.key("ArrowDown");
    await c.key("Enter");
    await c.sleep(800);
    check("普通文字带入输入框", (await draft()) === "检查文字");
    check("焦点在输入框", await c.eval(`document.activeElement === ${visible("textarea")}[0]`));
    check("没有新增便签", (await noteCount()) === before);

    // 再带入一次：已有草稿时换行追加
    await search("第二段");
    await c.key("ArrowDown");
    await c.key("Enter");
    await c.sleep(800);
    check("已有草稿时换行追加", (await draft()) === "检查文字\n第二段", JSON.stringify(await draft()));

    // 回车换行，Ctrl+回车保存，保存后清空且焦点留在输入框
    await c.eval(
        `(() => { const ta = ${visible("textarea")}[0]; ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); })()`,
    );
    await c.key("Enter");
    await c.type("第三行");
    check("回车是换行", (await draft()) === "检查文字\n第二段\n第三行");
    await c.key("Enter", true);
    await c.sleep(800);
    check("Ctrl+回车保存", (await noteCount()) === before + 1 && (await draft()) === "");
    await c.type("   ");
    await c.key("Enter", true);
    await c.sleep(400);
    check("全空白不保存", (await noteCount()) === before + 1);
    await c.eval(`${visible("textarea")}[0].select()`);
    await c.key("Backspace");

    // 编辑：Esc 取消不改动
    await c.eval(`${visible('button[aria-label="编辑"]')}[0].click()`);
    await c.sleep(300);
    await c.type("（改）");
    await c.key("Escape");
    await c.sleep(300);
    check(
        "Esc 取消编辑不保存",
        (await c.eval(
            `${visible("div.rounded-md.border.border-line.bg-background")}[0].innerText.includes('（改）')`,
        )) === false,
    );

    // 删除：立刻消失，撤销后回来
    await c.eval(`${visible('button[aria-label="删除"]')}[0].click()`);
    await c.sleep(300);
    check("删除后整条立刻消失", (await noteCount()) === before);
    await c.eval(
        `[...document.querySelectorAll('[data-sonner-toast] button')].find(b => b.innerText === '撤销')?.click()`,
    );
    await c.sleep(300);
    check("撤销后恢复", (await noteCount()) === before + 1);

    c.close();
    console.log(failed === 0 ? "全部通过" : `${failed} 项失败`);
    process.exit(failed === 0 ? 0 : 1);
})().catch((e) => {
    console.error(e);
    process.exit(2);
});
