import { wifiConfigSchema, type WifiConfig, type WifiSave, type WifiState } from "./schemas";
import { getSetting, setSetting } from "./util/settings";
import { createWifiNative, WifiFault } from "./wifiNative";

let native: ReturnType<typeof createWifiNative> | undefined;
let generation = 0;
let timer: ReturnType<typeof setInterval> | undefined;
let sink: ((state: WifiState) => void) | undefined;
let state: WifiState = { connected: null, target: null, phase: "idle", attempt: 0, total: 0, error: null, detail: 0 };
const system = () => (native ??= createWifiNative());
const emit = () => sink?.({ ...state });

/** 无密码配置可随数据目录迁移。 */
export function getWifiConfig(): WifiConfig {
    try {
        const parsed = wifiConfigSchema.safeParse(JSON.parse(getSetting("wifiConfig", "{}")));
        if (parsed.success) return parsed.data;
    } catch {
        /* 无效配置使用空列表。 */
    }
    return { retries: 5, entries: [] };
}

/** 保存时不连接；SSID 变更时不沿用旧密码。 */
export function saveWifiConfig(input: WifiSave): WifiConfig {
    const config = wifiConfigSchema.parse(input);
    const old = getWifiConfig();
    const api = system();
    const previous = new Map<string, string | null>();
    const remember = (id: string) => {
        if (!previous.has(id)) previous.set(id, api.password(id));
    };
    try {
        for (const entry of input.entries)
            if (entry.password) {
                remember(entry.id);
                api.savePassword(entry.id, entry.password);
            }
        for (const entry of old.entries) {
            const next = input.entries.find((e) => e.id === entry.id);
            if (!next || (next.ssid !== entry.ssid && !next.password)) {
                remember(entry.id);
                api.deletePassword(entry.id);
            }
        }
        setSetting("wifiConfig", JSON.stringify(config));
    } catch (error) {
        // 后续写入失败时恢复已修改的凭据，避免表单报错却改变已保存密码。
        for (const [id, password] of previous) {
            try {
                if (password === null) api.deletePassword(id);
                else api.savePassword(id, password);
            } catch {
                /* 系统策略可能同时阻止恢复，仍返回保存失败。 */
            }
        }
        throw error;
    }
    stopWifi();
    startMonitoring();
    return config;
}

/** 订阅出口由应用窗口注入，隐藏窗口不影响主进程任务。 */
export function setWifiSink(next: (value: WifiState) => void): void {
    sink = next;
}
function fault(error: unknown): void {
    const value = error instanceof WifiFault ? error : new WifiFault("system");
    state = { ...state, phase: "failed", error: value.code, detail: value.detail };
    emit();
}
function refresh(): void {
    try {
        const api = system();
        const connected = api.current(api.adapter());
        if (state.connected !== connected) {
            state = { ...state, connected };
            emit();
        }
    } catch (error) {
        fault(error);
    }
}
function startMonitoring(): void {
    if (!getWifiConfig().entries.length) {
        if (timer) clearInterval(timer);
        timer = undefined;
        return;
    }
    if (process.platform !== "win32" || timer) return;
    refresh();
    timer = setInterval(refresh, 2000);
    timer.unref();
}
export function getWifiState(): WifiState {
    startMonitoring();
    return { ...state };
}
/** 停止后续动作，不承诺撤回已交给驱动的请求。 */
export function stopWifi(): void {
    generation++;
    state = { ...state, target: null, phase: "idle", error: null, detail: 0 };
    emit();
}
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** 一个任务占用无线网卡，序号使旧任务在等待结束后自动让位。 */
export function connectWifi(id: string): void {
    const config = getWifiConfig();
    const entry = config.entries.find((e) => e.id === id);
    if (!entry) throw new WifiFault("config");
    if (state.target === id && ["scanning", "connecting"].includes(state.phase)) {
        stopWifi();
        return;
    }
    if (state.connected === entry.ssid) {
        stopWifi();
        return;
    }
    stopWifi();
    const token = generation;
    state = { ...state, target: id, phase: "scanning", attempt: 0, total: config.retries + 1 };
    emit();
    void (async () => {
        try {
            const api = system();
            const guid = api.adapter();
            for (let attempt = 1; attempt <= config.retries + 1; attempt++) {
                if (token !== generation) return;
                state = { ...state, phase: "scanning", attempt };
                emit();
                api.scan(guid, entry.ssid);
                await delay(4000);
                if (token !== generation) return;
                const network = api.networks(guid).find((n) => n.ssid === entry.ssid);
                if (network) {
                    state = { ...state, phase: "connecting" };
                    emit();
                    api.connect(guid, network, entry.id, api.password(entry.id));
                    for (let seconds = 0; seconds < 15; seconds++) {
                        await delay(1000);
                        if (token !== generation) return;
                        const connected = api.current(guid);
                        state = { ...state, connected };
                        emit();
                        if (connected === entry.ssid) {
                            stopWifi();
                            return;
                        }
                        const why = api.failure();
                        if ([0x2800d, 0x48012, 0x48014].includes(why)) throw new WifiFault("password", why);
                        if (why) break;
                    }
                }
                if (attempt === config.retries + 1)
                    throw new WifiFault(network ? "timeout" : "not-found", api.failure());
                await delay(1000);
            }
        } catch (error) {
            if (token === generation) fault(error);
        }
    })();
}
/** 退出时停止任务并释放系统句柄。 */
export function shutdownWifi(): void {
    stopWifi();
    if (timer) clearInterval(timer);
    timer = undefined;
    native?.close();
}
