import { createRequire } from "node:module";

/** 可预期的系统无线错误，code 可直接映射到界面文案。 */
export class WifiFault extends Error {
    constructor(
        public code: string,
        public detail = 0,
    ) {
        super(code);
    }
}

/** XML 字段必须转义，SSID 另用原始字节的十六进制表示。 */
export function xmlEscape(value: string): string {
    return value.replace(
        /[&<>"']/g,
        (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!,
    );
}

/** 只生成个人密码网络的手动配置，避免改写系统已有配置。 */
export function profileXml(name: string, ssid: string, password: string, auth: number, cipher: number): string {
    const authentication = auth === 7 ? "WPA2PSK" : auth === 9 ? "WPA3SAE" : auth === 4 ? "WPAPSK" : "";
    if (!authentication || ![2, 4].includes(cipher)) throw new WifiFault("security");
    if (!password || password.length < 8 || password.length > 64) throw new WifiFault("password");
    const keyType = /^[\da-f]{64}$/i.test(password) && auth !== 9 ? "networkKey" : "passPhrase";
    return `<?xml version="1.0"?><WLANProfile xmlns="http://www.microsoft.com/networking/WLAN/profile/v1"><name>${xmlEscape(name)}</name><SSIDConfig><SSID><hex>${Buffer.from(ssid).toString("hex")}</hex></SSID></SSIDConfig><connectionType>ESS</connectionType><connectionMode>manual</connectionMode><MSM><security><authEncryption><authentication>${authentication}</authentication><encryption>${cipher === 2 ? "TKIP" : "AES"}</encryption><useOneX>false</useOneX></authEncryption><sharedKey><keyType>${keyType}</keyType><protected>false</protected><keyMaterial>${xmlEscape(password)}</keyMaterial></sharedKey></security></MSM></WLANProfile>`;
}

/** 单个扫描结果。 */
export type WifiNetwork = {
    /** 系统已保存的配置名称，可能与 SSID 不同。 */
    profile: string;
    /** Wi-Fi 名称。 */
    ssid: string;
    /** Windows 认证算法。 */
    auth: number;
    /** Windows 加密算法。 */
    cipher: number;
};

/** 按需加载原生库，其他平台不会装载 Windows DLL。 */
export function createWifiNative() {
    if (process.platform !== "win32") throw new WifiFault("platform");
    const k = createRequire(import.meta.url)("koffi") as typeof import("koffi");
    const wlan = k.load("wlanapi.dll");
    const cred = k.load("advapi32.dll");
    const kernel = k.load("kernel32.dll");
    const bind = (name: string, args: string[]) => wlan.func("__stdcall", name, "uint32", args);
    const open = bind("WlanOpenHandle", ["uint32", "void *", "_Out_ uint32 *", "_Out_ void **"]);
    const free = wlan.func("void WlanFreeMemory(void *p)");
    const enumerate = bind("WlanEnumInterfaces", ["void *", "void *", "_Out_ void **"]);
    const query = bind("WlanQueryInterface", [
        "void *",
        "void *",
        "uint32",
        "void *",
        "_Out_ uint32 *",
        "_Out_ void **",
        "void *",
    ]);
    const available = bind("WlanGetAvailableNetworkList", ["void *", "void *", "uint32", "void *", "_Out_ void **"]);
    const scan = bind("WlanScan", ["void *", "void *", "void *", "void *", "void *"]);
    const setProfile = bind("WlanSetProfile", [
        "void *",
        "void *",
        "uint32",
        "str16",
        "str16",
        "int32",
        "void *",
        "_Out_ uint32 *",
    ]);
    const params = k.struct({
        mode: "uint32",
        profile: "str16",
        ssid: "void *",
        bss: "void *",
        type: "uint32",
        flags: "uint32",
    });
    const connect = wlan.func("__stdcall", "WlanConnect", "uint32", ["void *", "void *", k.pointer(params), "void *"]);
    const credential = k.struct({
        flags: "uint32",
        type: "uint32",
        target: "str16",
        comment: "str16",
        time: "uint64",
        size: "uint32",
        blob: "void *",
        persist: "uint32",
        count: "uint32",
        attrs: "void *",
        alias: "str16",
        user: "str16",
    });
    const write = cred.func("__stdcall", "CredWriteW", "int32", [k.pointer(credential), "uint32"]);
    const read = cred.func("int32 __stdcall CredReadW(str16 target, uint32 type, uint32 flags, _Out_ void **out)");
    const remove = cred.func("int32 __stdcall CredDeleteW(str16 target, uint32 type, uint32 flags)");
    const credFree = cred.func("void __stdcall CredFree(void *p)");
    const lastError = kernel.func("uint32 __stdcall GetLastError()");
    const version = [0];
    const handles = [null];
    check(open(2, null, version, handles));
    const handle = handles[0];
    let reason = 0;
    const notification = k.struct({
        source: "uint32",
        code: "uint32",
        guid: k.array("uint8", 16),
        size: "uint32",
        data: "void *",
    });
    const callbackType = k.proto("__stdcall", "void", ["void *", "void *"]);
    const callback = k.register((ptr: unknown) => {
        const n = k.decode(ptr, notification);
        if (n.source === 8 && [10, 11].includes(n.code) && n.size >= 564) reason = bytes(n.data, 564).readUInt32LE(560);
    }, k.pointer(callbackType));
    const register = wlan.func("__stdcall", "WlanRegisterNotification", "uint32", [
        "void *",
        "uint32",
        "int32",
        k.pointer(callbackType),
        "void *",
        "void *",
        "void *",
    ]);
    const registration = register(handle, 8, 1, callback, null, null, null);
    if (registration) {
        k.unregister(callback);
        throw new WifiFault("system", registration);
    }

    function check(code: number): void {
        if (!code) return;
        throw new WifiFault(
            code === 5 ? "permission" : code === 0x80342002 ? "radio" : code === 1062 ? "service" : "system",
            code,
        );
    }
    function bytes(ptr: unknown, size: number): Buffer {
        // Electron 不允许外部 ArrayBuffer，复制系统内存后再解析。
        return Buffer.from(k.decode(ptr, "uint8", size));
    }
    function text(buffer: Buffer, offset: number, length: number): string {
        return buffer.toString("utf16le", offset, offset + length).split("\0")[0];
    }
    function ssid(buffer: Buffer, offset: number): string {
        return buffer.toString("utf8", offset + 4, offset + 4 + Math.min(32, buffer.readUInt32LE(offset)));
    }
    function target(id: string): string {
        return `Knock/WiFi/${id}`;
    }
    function interfaces(): { guid: Buffer; state: number }[] {
        const out = [null];
        check(enumerate(handle, null, out));
        try {
            const count = bytes(out[0], 8).readUInt32LE();
            const data = bytes(out[0], 8 + count * 532);
            return Array.from({ length: count }, (_, i) => ({
                guid: Buffer.from(data.subarray(8 + i * 532, 24 + i * 532)),
                state: data.readUInt32LE(536 + i * 532),
            }));
        } finally {
            free(out[0]);
        }
    }
    function adapter(): Buffer {
        const list = interfaces();
        const item = list.find((i) => i.state === 1) ?? list[0];
        if (!item) throw new WifiFault("adapter");
        return item.guid;
    }
    function current(guid: Buffer): string | null {
        const size = [0];
        const out = [null];
        const code = query(handle, guid, 7, null, size, out, null);
        if (code === 5023) return null;
        check(code);
        try {
            return ssid(bytes(out[0], size[0]), 520);
        } finally {
            free(out[0]);
        }
    }
    return {
        adapter,
        current,
        /** 读系统保存的凭据，密码只进入主进程内存。 */
        password(id: string): string | null {
            const out = [null];
            if (!read(target(id), 1, 0, out)) {
                const code = lastError();
                if (code === 1168) return null;
                throw new WifiFault("credential", code);
            }
            try {
                const value = k.decode(out[0], credential);
                return bytes(value.blob, value.size).toString("utf16le");
            } finally {
                credFree(out[0]);
            }
        },
        /** 使用本机、当前用户的持久凭据，不写应用数据库。 */
        savePassword(id: string, password: string): void {
            const blob = Buffer.from(password, "utf16le");
            try {
                if (
                    !write(
                        {
                            flags: 0,
                            type: 1,
                            target: target(id),
                            comment: null,
                            time: 0,
                            size: blob.length,
                            blob,
                            persist: 2,
                            count: 0,
                            attrs: null,
                            alias: null,
                            user: "Knock",
                        },
                        0,
                    )
                )
                    throw new WifiFault("credential", lastError());
            } finally {
                blob.fill(0);
            }
        },
        deletePassword(id: string): void {
            if (!remove(target(id), 1, 0)) {
                const code = lastError();
                if (code !== 1168) throw new WifiFault("credential", code);
            }
        },
        scan(guid: Buffer, name: string): void {
            const size = [0];
            const radio = [null];
            check(query(handle, guid, 4, null, size, radio, null));
            try {
                const data = bytes(radio[0], size[0]);
                const count = data.readUInt32LE();
                const enabled = Array.from(
                    { length: count },
                    (_, i) => data.readUInt32LE(8 + i * 12) === 1 && data.readUInt32LE(12 + i * 12) === 1,
                ).some(Boolean);
                if (!enabled) throw new WifiFault("radio");
            } finally {
                free(radio[0]);
            }
            const value = Buffer.from(name);
            const data = Buffer.alloc(36);
            data.writeUInt32LE(value.length);
            value.copy(data, 4);
            check(scan(handle, guid, data, null, null));
        },
        networks(guid: Buffer): WifiNetwork[] {
            const out = [null];
            check(available(handle, guid, 0, null, out));
            try {
                const count = bytes(out[0], 8).readUInt32LE();
                const data = bytes(out[0], 8 + count * 628);
                return Array.from({ length: count }, (_, i) => {
                    const offset = 8 + i * 628;
                    return {
                        profile: text(data, offset, 512),
                        ssid: ssid(data, offset + 512),
                        auth: data.readUInt32LE(offset + 612),
                        cipher: data.readUInt32LE(offset + 616),
                    };
                });
            } finally {
                free(out[0]);
            }
        },
        connect(guid: Buffer, network: WifiNetwork, id: string, password: string | null): void {
            reason = 0;
            let profile = network.profile;
            if (password !== null) {
                profile = `Knock-${id}`;
                const why = [0];
                check(
                    setProfile(
                        handle,
                        guid,
                        2,
                        profileXml(profile, network.ssid, password, network.auth, network.cipher),
                        null,
                        1,
                        null,
                        why,
                    ),
                );
            }
            if (!profile) throw new WifiFault("password");
            check(connect(handle, guid, { mode: 0, profile, ssid: null, bss: null, type: 1, flags: 0 }, null));
        },
        failure(): number {
            return reason;
        },
        /** 异步注销，避免系统回调等待主线程造成退出死锁。 */
        close(): void {
            register.async(handle, 0, 1, null, null, null, null, () => {
                k.unregister(callback);
                bind("WlanCloseHandle", ["void *", "void *"])(handle, null);
            });
        },
    };
}
