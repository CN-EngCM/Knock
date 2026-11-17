import { useEffect, useState } from "react";
import { ArrowUp, ArrowDown, Trash2, Plus } from "lucide-react";
import { api, type WifiSave, type WifiState } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FieldLabel, FieldDescription } from "@/components/ui/field";
import { useI18n } from "@/i18n/useI18n";
import { wifiErrorKey } from "@/components/WifiControls";

/** 单一显式保存入口，切换分节保留草稿，关闭弹窗丢弃草稿。 */
export function WifiSection() {
    const { t } = useI18n();
    const [draft, setDraft] = useState<WifiSave>({ entries: [], retries: 5 });
    const [ready, setReady] = useState(false);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState("");
    const [state, setState] = useState<WifiState | null>(null);
    useEffect(() => {
        void api.getWifiConfig().then((r) => {
            if (r.ok) {
                setDraft(r.data);
                setReady(true);
            } else setMessage(t("wifi.err.system"));
        });
        return window.knock.onWifiState(setState);
    }, []);
    const patch = (index: number, field: "name" | "ssid" | "password", value: string) =>
        setDraft((old) => ({
            ...old,
            entries: old.entries.map((e, i) => (i === index ? { ...e, [field]: value } : e)),
        }));
    const move = (index: number, step: number) =>
        setDraft((old) => {
            const entries = [...old.entries];
            [entries[index], entries[index + step]] = [entries[index + step], entries[index]];
            return { ...old, entries };
        });
    async function save() {
        if (
            draft.entries.some((e) => !e.name.trim() || !e.ssid || new TextEncoder().encode(e.ssid).length > 32) ||
            new Set(draft.entries.map((e) => e.ssid)).size !== draft.entries.length ||
            !Number.isInteger(draft.retries) ||
            draft.retries < 0 ||
            draft.retries > 20
        ) {
            setMessage(t("wifi.err.config"));
            return;
        }
        setBusy(true);
        setMessage("");
        try {
            const result = await api.saveWifiConfig(draft);
            if (result.ok) {
                setDraft(result.data);
                setMessage(t("wifi.saved"));
                window.dispatchEvent(new Event("knock-wifi-config"));
            } else setMessage(t(result.error.kind === "wifi" ? wifiErrorKey(result.error.code) : "wifi.err.config"));
        } catch {
            setMessage(t("wifi.err.system"));
        } finally {
            setBusy(false);
        }
    }
    return (
        <div className="grid gap-4">
            <div>
                <h2 className="text-control font-medium">{t("wifi.title")}</h2>
                <FieldDescription>{t("wifi.hint")}</FieldDescription>
            </div>
            <div className="flex items-center justify-between gap-3">
                <FieldLabel htmlFor="wifi-retries">{t("wifi.retries")}</FieldLabel>
                <Input
                    id="wifi-retries"
                    type="number"
                    min={0}
                    max={20}
                    className="w-20"
                    value={draft.retries}
                    onChange={(e) => setDraft({ ...draft, retries: Number(e.target.value) })}
                />
            </div>
            <FieldDescription>{t("wifi.retryHint")}</FieldDescription>
            {!draft.entries.length && (
                <p className="rounded-md border border-line p-3 text-small text-dim-foreground">{t("wifi.empty")}</p>
            )}
            {draft.entries.map((entry, index) => (
                <fieldset
                    key={entry.id}
                    disabled={busy}
                    className="grid min-w-0 gap-3 rounded-md border border-line p-3"
                >
                    <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-small font-medium">{entry.name || t("wifi.new")}</span>
                        <div className="flex shrink-0 gap-1">
                            <Button
                                size="icon"
                                variant="ghost"
                                className="size-6"
                                disabled={index === 0}
                                aria-label={t("wifi.up")}
                                onClick={() => move(index, -1)}
                            >
                                <ArrowUp className="size-3.5" />
                            </Button>
                            <Button
                                size="icon"
                                variant="ghost"
                                className="size-6"
                                disabled={index === draft.entries.length - 1}
                                aria-label={t("wifi.down")}
                                onClick={() => move(index, 1)}
                            >
                                <ArrowDown className="size-3.5" />
                            </Button>
                            <Button
                                size="icon"
                                variant="ghost"
                                className="size-6"
                                aria-label={t("wifi.delete")}
                                onClick={() =>
                                    setDraft({ ...draft, entries: draft.entries.filter((e) => e.id !== entry.id) })
                                }
                            >
                                <Trash2 className="size-3.5" />
                            </Button>
                        </div>
                    </div>
                    {(["name", "ssid", "password"] as const).map((field) => (
                        <div key={field} className="grid grid-cols-[5rem_1fr] items-center gap-2">
                            <FieldLabel htmlFor={`wifi-${entry.id}-${field}`}>
                                {t(field === "name" ? "wifi.name" : field === "ssid" ? "wifi.ssid" : "wifi.password")}
                            </FieldLabel>
                            <Input
                                id={`wifi-${entry.id}-${field}`}
                                type={field === "password" ? "password" : "text"}
                                autoComplete="off"
                                maxLength={field === "name" ? 40 : 64}
                                value={entry[field] ?? ""}
                                placeholder={field === "password" ? t("wifi.passwordHint") : undefined}
                                onChange={(e) => patch(index, field, e.target.value)}
                            />
                        </div>
                    ))}
                </fieldset>
            ))}
            <div className="flex items-center justify-between">
                <Button
                    variant="ghost"
                    size="sm"
                    disabled={!ready || busy || draft.entries.length >= 4}
                    onClick={() =>
                        setDraft({
                            ...draft,
                            entries: [...draft.entries, { id: crypto.randomUUID(), name: "", ssid: "", password: "" }],
                        })
                    }
                >
                    <Plus className="size-3.5" />
                    {t("wifi.add")}
                </Button>
                <Button variant="primary" disabled={!ready || busy} onClick={() => void save()}>
                    {t("wifi.save")}
                </Button>
            </div>
            <FieldDescription>{t("wifi.storageHint")}</FieldDescription>
            {message && (
                <p role="status" className="text-small">
                    {message}
                </p>
            )}
            {state?.error && (
                <div role="status" className="grid gap-2 text-small">
                    <p className="text-destructive">
                        {t(wifiErrorKey(state.error))} {state.detail || ""}
                    </p>
                    <Button
                        variant="ghost"
                        size="sm"
                        className="w-fit"
                        onClick={() => void api.openWifiSettings(state.error === "permission")}
                    >
                        {t("wifi.systemSettings")}
                    </Button>
                </div>
            )}
        </div>
    );
}
