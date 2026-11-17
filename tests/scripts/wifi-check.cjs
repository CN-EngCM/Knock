// 验证无线配置、重试、停止、切换和密码隔离。运行：node tests/scripts/wifi-check.cjs
// 加 --native 只检查原生库加载和网卡枚举，不扫描、不连接、不读取真实密码。
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const assert = require("node:assert/strict");
const ts = require("typescript");
const { pathToFileURL } = require("node:url");
const root = path.resolve(__dirname, "../..");
function load(file, replacements = {}, timers = {}) {
    let source = fs.readFileSync(path.join(root, file), "utf8");
    source = source.replaceAll("import.meta.url", JSON.stringify(pathToFileURL(path.join(root, file)).href));
    const code = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const exports = {};
    vm.runInNewContext(code, {
        exports,
        require: (id) => replacements[id] ?? require(id),
        Buffer,
        TextEncoder,
        process,
        console,
        setTimeout,
        setInterval: () => ({ unref() {} }),
        clearInterval() {},
        ...timers,
    });
    return exports;
}
const schemas = load("src/main/server/schemas.ts");
const native = load("src/main/server/wifiNative.ts");
const first = { id: "ad6ea20c-cad8-4b1f-a2f8-67ae3cf0ade0", name: "手机热点", ssid: "热点" };
const second = { ...first, id: "f51a9dde-a8d4-419b-9903-98ce4f94c9b1", ssid: "公司" };
assert(schemas.wifiSaveSchema.safeParse({ retries: 5, entries: [first] }).success);
for (const input of [
    { retries: 21, entries: [] },
    { retries: -1, entries: [] },
    { retries: 5, entries: [first, first] },
    { retries: 5, entries: [{ ...first, ssid: "中".repeat(11) }] },
])
    assert(!schemas.wifiSaveSchema.safeParse(input).success);
const xml = native.profileXml("名称&", "热点", "pass<&word", 7, 4);
assert(xml.includes("名称&amp;"));
assert(xml.includes("pass&lt;&amp;word"));
assert(xml.includes("<connectionMode>manual</connectionMode>"));
assert.throws(() => native.profileXml("a", "b", "password", 8, 4));
function fixture(retries = 1) {
    let config = JSON.stringify({ retries, entries: [first, second] });
    let scans = 0;
    let connects = 0;
    let found = false;
    let connected = null;
    let reason = 0;
    let failedWrite = null;
    const waits = [];
    const passwords = new Map();
    const api = {
        adapter: () => Buffer.alloc(16),
        current: () => connected,
        scan: () => scans++,
        networks: () => (found ? [{ ssid: first.ssid, profile: "saved", auth: 7, cipher: 4 }] : []),
        password: (id) => passwords.get(id) ?? null,
        savePassword: (id, p) => {
            if (id === failedWrite) throw new native.WifiFault("credential");
            passwords.set(id, p);
        },
        deletePassword: (id) => passwords.delete(id),
        connect: () => connects++,
        failure: () => reason,
        close() {},
    };
    const service = load(
        "src/main/server/wifi.ts",
        {
            "./schemas": schemas,
            "./util/settings": { getSetting: () => config, setSetting: (_, value) => (config = value) },
            "./wifiNative": { ...native, createWifiNative: () => api },
        },
        {
            setTimeout: (cb) => {
                waits.push(cb);
            },
        },
    );
    return {
        service,
        passwords,
        failWrite: (id) => (failedWrite = id),
        get config() {
            return config;
        },
        get scans() {
            return scans;
        },
        get connects() {
            return connects;
        },
        async tick() {
            waits.shift()?.();
            for (let i = 0; i < 5; i++) await Promise.resolve();
        },
        found: () => (found = true),
        connected: () => (connected = first.ssid),
        failure: () => (reason = 0x2800d),
    };
}
async function main() {
    let f = fixture();
    f.service.connectWifi(first.id);
    await f.tick();
    await f.tick();
    await f.tick();
    assert.equal(f.scans, 2);
    assert.equal(f.service.getWifiState().phase, "failed");
    f = fixture();
    f.service.connectWifi(first.id);
    f.service.connectWifi(first.id);
    await f.tick();
    assert.equal(f.scans, 1);
    assert.equal(f.connects, 0);
    assert.equal(f.service.getWifiState().phase, "idle");
    f = fixture();
    f.service.connectWifi(first.id);
    f.service.connectWifi(second.id);
    await f.tick();
    assert.equal(f.service.getWifiState().target, second.id);
    assert.equal(f.connects, 0);
    f = fixture();
    f.found();
    f.service.connectWifi(first.id);
    await f.tick();
    f.connected();
    await f.tick();
    assert.equal(f.service.getWifiState().connected, first.ssid);
    assert.equal(f.service.getWifiState().phase, "idle");
    f = fixture();
    f.found();
    f.service.connectWifi(first.id);
    await f.tick();
    f.failure();
    await f.tick();
    assert.equal(f.scans, 1);
    assert.equal(f.service.getWifiState().error, "password");
    f = fixture();
    const saved = f.service.saveWifiConfig({ retries: 0, entries: [{ ...first, password: "secret-password" }] });
    assert(!JSON.stringify(saved).includes("secret-password"));
    assert(!f.config.includes("secret-password"));
    assert.equal(f.passwords.get(first.id), "secret-password");
    f.service.saveWifiConfig({ retries: 0, entries: [first] });
    assert.equal(f.passwords.get(first.id), "secret-password");
    f.service.saveWifiConfig({ retries: 0, entries: [{ ...first, ssid: "另一个" }] });
    assert.equal(f.passwords.size, 0);
    f = fixture(0);
    f.found();
    f.service.connectWifi(first.id);
    for (let i = 0; i < 17; i++) await f.tick();
    assert.equal(f.service.getWifiState().error, "timeout");
    f = fixture();
    f.failWrite(second.id);
    const before = f.config;
    assert.throws(() =>
        f.service.saveWifiConfig({
            retries: 0,
            entries: [
                { ...first, password: "first-password" },
                { ...second, password: "second-password" },
            ],
        }),
    );
    assert.equal(f.config, before);
    assert.equal(f.passwords.size, 0);
    if (process.argv.includes("--native")) {
        const api = native.createWifiNative();
        try {
            assert.equal(api.adapter().length, 16);
            console.log("原生网卡枚举通过");
        } catch (e) {
            if (e.code !== "adapter") throw e;
            console.log("原生接口可用，当前没有无线网卡");
        } finally {
            api.close();
        }
    }
    console.log("无线配置、重试、停止、切换、密码隔离检查通过");
}
main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
});
