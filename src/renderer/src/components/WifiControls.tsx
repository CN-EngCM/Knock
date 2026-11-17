import { useEffect, useState } from "react";
import { Wifi, LoaderCircle, TriangleAlert } from "lucide-react";
import { api, type WifiConfig, type WifiState } from "@/api/client";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useI18n } from "@/i18n/useI18n";
import type { MessageKey } from "@/i18n";

/** 所有系统错误都有本地文案，未知错误保留系统代码。 */
export function wifiErrorKey(code: string | null): MessageKey {
    const keys: Record<string, MessageKey> = {
        permission: "wifi.err.permission",
        radio: "wifi.err.radio",
        adapter: "wifi.err.adapter",
        service: "wifi.err.service",
        credential: "wifi.err.credential",
        password: "wifi.err.password",
        security: "wifi.err.security",
        "not-found": "wifi.err.notFound",
        timeout: "wifi.err.timeout",
        config: "wifi.err.config",
    };
    return keys[code ?? ""] ?? "wifi.err.system";
}

/** 顶栏与设置保持独立表单状态，保存完成后通知顶栏重读配置。 */
export function WifiControls() {
    const { t } = useI18n();
    const [config, setConfig] = useState<WifiConfig>({ entries: [], retries: 5 });
    const [state, setState] = useState<WifiState | null>(null);
    useEffect(() => {
        const load = () => {
            void api.getWifiConfig().then((r) => {
                if (r.ok) setConfig(r.data);
            });
        };
        load();
        void api.getWifiState().then((r) => {
            if (r.ok) setState(r.data);
        });
        const off = window.knock.onWifiState(setState);
        window.addEventListener("knock-wifi-config", load);
        return () => {
            off();
            window.removeEventListener("knock-wifi-config", load);
        };
    }, []);
    if (!config.entries.length) return null;
    return (
        <ToggleGroup
            type="single"
            size="sm"
            spacing={1}
            value={config.entries.find((e) => e.ssid === state?.connected)?.id ?? ""}
            aria-label={t("wifi.title")}
            className="app-no-drag me-2 h-7 shrink-0 gap-0.5 rounded-md bg-[linear-gradient(var(--well-top),var(--well-bottom))] p-[3px] shadow-well"
        >
            {config.entries.map((entry) => {
                const active = state?.target === entry.id;
                const busy = active && (state.phase === "scanning" || state.phase === "connecting");
                const failed = active && state?.phase === "failed";
                const connected = state?.connected === entry.ssid;
                const Icon = busy ? LoaderCircle : failed ? TriangleAlert : Wifi;
                const status = busy
                    ? `${t(state.phase === "scanning" ? "wifi.scanning" : "wifi.connecting")} ${state.attempt}/${state.total} · ${t("wifi.stop")}`
                    : failed
                      ? `${t(wifiErrorKey(state.error))} ${state.detail || ""}`
                      : t(connected ? "wifi.connected" : "wifi.connect");
                return (
                    <Tooltip key={entry.id}>
                        <TooltipTrigger asChild>
                            {/* 提示状态放在外层，避免覆盖按钮的选中状态。 */}
                            <span className="inline-flex">
                                <ToggleGroupItem
                                    value={entry.id}
                                    className="h-[22px] w-20 gap-1 rounded-sm bg-transparent px-1.5 data-[state=on]:bg-white dark:data-[state=on]:bg-white/18"
                                    aria-label={`${entry.name} · ${status}`}
                                    onClick={() => {
                                        void api.connectWifi(entry.id);
                                    }}
                                >
                                    <Icon
                                        className={`size-3.5 ${busy ? "animate-spin text-info" : failed ? "text-destructive" : connected ? "text-success" : "text-dim-foreground"}`}
                                    />
                                    <span className="w-[4em] truncate text-left">{entry.name}</span>
                                </ToggleGroupItem>
                            </span>
                        </TooltipTrigger>
                        <TooltipContent>
                            <div>
                                {entry.name} · {entry.ssid}
                            </div>
                            <div>{status}</div>
                        </TooltipContent>
                    </Tooltip>
                );
            })}
        </ToggleGroup>
    );
}
