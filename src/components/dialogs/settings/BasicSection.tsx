import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
    api,
    type ApiError,
    type FontConfig,
    type FontPatch,
    type HotkeyId,
    type ShellId,
    type TermConfig,
    type TermPatch,
} from "@/api/client";
import { useI18n } from "@/i18n/useI18n";
import type { Lang, MessageKey } from "@/i18n";
import type { ThemeMode } from "@/theme";
import { CommitInput, row } from "./shared";
import { FontPicker } from "./FontPicker";

type AutostartStatus = { supported: boolean; enabled: boolean };

// 热键预设 id → i18n key 的映射（id 集合来自后端 schemas.HOTKEY_IDS）
const HOTKEY_LABEL: Record<HotkeyId, MessageKey> = {
    "double-ctrl": "settings.hotkey.double-ctrl",
    "double-alt": "settings.hotkey.double-alt",
    "double-shift": "settings.hotkey.double-shift",
    "alt-space": "settings.hotkey.alt-space",
    "ctrl-alt-space": "settings.hotkey.ctrl-alt-space",
};

type Props = {
    theme: ThemeMode;
    onTheme: (mode: ThemeMode) => void;
    lang: Lang;
    onChangeLang: (lang: Lang) => void;
    platform: string;
    /** 从设置里打开书签导入 */
    onOpenImport: () => void;
    /** 终端设置：shell 候选与当前值；提交走 onTermPatch（App 负责落库与回填） */
    termCfg: TermConfig | null;
    onTermPatch: (patch: TermPatch) => Promise<boolean>;
    /** 字体设置（界面/等宽）：提交走 onFontPatch（App 落库回填并写 CSS 变量即全局生效） */
    fontCfg: FontConfig | null;
    onFontPatch: (patch: FontPatch) => Promise<boolean>;
    /** 剪贴板素材时限（秒，0 = 关闭） */
    clipSec: number | null;
    onClipSec: (seconds: number) => Promise<boolean>;
};

/** 基础设置分节：主题 / 语言 / 热键 / 剪贴板时限 / 自启 / 字体 / 终端 / 书签导入 / 运行环境 */
export function BasicSection({
    theme,
    onTheme,
    lang,
    onChangeLang,
    platform,
    onOpenImport,
    termCfg,
    onTermPatch,
    fontCfg,
    onFontPatch,
    clipSec,
    onClipSec,
}: Props) {
    const { t } = useI18n();
    // Radix Dialog 关闭即卸载分节内容，挂载时拉一次即可，每次打开都会重新拉取
    const [autostart, setAutostart] = useState<AutostartStatus | null>(null);
    const [hotkey, setHotkey] = useState<HotkeyId | null>(null);
    const [busy, setBusy] = useState(false);
    // 终端设置的本地编辑态：shell 即选即存；字号失焦（或回车）才提交
    const [shell, setShell] = useState<ShellId | null>(null);
    const [fontSize, setFontSize] = useState("13");
    // 剪贴板时限编辑态（秒）
    const [clipSecEdit, setClipSecEdit] = useState("5");
    // 数据目录（null = 尚未拉取）；迁移是「搬库 → 重启」的长流程，pending 防重复触发
    const [dataDirInfo, setDataDirInfo] = useState<{ dir: string; isDefault: boolean } | null>(null);
    const [migrating, setMigrating] = useState(false);

    useEffect(() => {
        api.getAutostart().then((r) => setAutostart(r.ok ? r.data : { supported: false, enabled: false }));
        api.getHotkey().then((r) => {
            if (r.ok) setHotkey(r.data.hotkey);
        });
        api.getDataDir().then((r) => {
            if (r.ok) setDataDirInfo(r.data);
        });
    }, []);

    // termCfg 变化（含保存回填）时同步终端本地编辑态
    useEffect(() => {
        if (!termCfg) return;
        setShell(termCfg.shell);
        setFontSize(String(termCfg.fontSize));
    }, [termCfg]);

    useEffect(() => {
        if (clipSec !== null) setClipSecEdit(String(clipSec));
    }, [clipSec]);

    async function toggleAutostart() {
        if (!autostart) return;
        setBusy(true);
        try {
            const r = await api.setAutostart(!autostart.enabled);
            if (r.ok) {
                setAutostart({ supported: true, enabled: r.data.enabled });
                toast.success(r.data.enabled ? t("settings.autostart.enabled") : t("settings.autostart.disabled"));
            } else {
                toast.error(t("toast.error"));
            }
        } catch {
            toast.error(t("toast.error"));
        } finally {
            setBusy(false);
        }
    }

    /** 换呼出热键：conflict = 组合键被占用，服务端保持旧热键不变 */
    async function changeHotkey(next: HotkeyId) {
        const prev = hotkey;
        setHotkey(next); // 先行更新下拉，失败再回滚
        try {
            const r = await api.setHotkey(next);
            if (r.ok) {
                toast.success(t("settings.hotkey.saved"));
            } else {
                if (prev) setHotkey(prev);
                toast.error(r.error.kind === "conflict" ? t("settings.hotkey.conflict") : t("toast.error"));
            }
        } catch {
            if (prev) setHotkey(prev);
            toast.error(t("toast.error"));
        }
    }

    /** 换终端程序：即选即存；失败回滚（只影响之后新建的会话） */
    async function changeShell(next: ShellId) {
        const prev = shell;
        setShell(next);
        const ok = await onTermPatch({ shell: next });
        if (!ok && prev) setShell(prev);
    }

    /** 字体提交（界面/等宽共用）：没改动不请求；失败时 fontCfg 不回填，控件随 props 还原 */
    async function commitFont(patch: FontPatch) {
        if (!fontCfg) return;
        if (patch.uiFont !== undefined && patch.uiFont === fontCfg.uiFont) return;
        if (patch.monoFont !== undefined && patch.monoFont === fontCfg.monoFont) return;
        await onFontPatch(patch);
    }

    /** 字号提交：非法输入与越界一律夹回 8–32；没改动不请求 */
    async function commitFontSize() {
        const n = Math.round(Number(fontSize));
        const clamped = Number.isFinite(n) ? Math.min(32, Math.max(8, n)) : 13;
        if (!termCfg || clamped === termCfg.fontSize) {
            if (termCfg) setFontSize(String(termCfg.fontSize));
            return;
        }
        const ok = await onTermPatch({ fontSize: clamped });
        if (!ok) setFontSize(String(termCfg.fontSize));
    }

    /** 剪贴板时限提交：非法与越界夹回 0–60 秒；没改动不请求 */
    async function commitClipSec() {
        const n = Math.round(Number(clipSecEdit));
        const clamped = Number.isFinite(n) ? Math.min(60, Math.max(0, n)) : 5;
        if (clipSec === null || clamped === clipSec) {
            if (clipSec !== null) setClipSecEdit(String(clipSec));
            return;
        }
        const ok = await onClipSec(clamped);
        if (!ok && clipSec !== null) setClipSecEdit(String(clipSec));
    }

    /** 数据目录迁移失败提示：data-dir 按原因给文案，其余通用 */
    function dataDirErrorToast(e: ApiError) {
        if (e.kind === "data-dir") {
            const key =
                e.reason === "same"
                    ? "settings.dataDir.err.same"
                    : e.reason === "occupied"
                      ? "settings.dataDir.err.occupied"
                      : "settings.dataDir.err.failed";
            toast.error(t(key));
        } else {
            toast.error(t("toast.error"));
        }
    }

    /** 迁移数据目录（target=null = 恢复默认）：成功时进程已退出、不会有返回；
     *  能等到返回值即失败，toast 后解除 pending */
    async function changeDataDir(target: string | null) {
        setMigrating(true);
        try {
            const r = await api.changeDataDir(target);
            if (!r.ok) dataDirErrorToast(r.error);
        } catch {
            toast.error(t("toast.error"));
        } finally {
            setMigrating(false);
        }
    }

    /** [更改…]：先弹原生目录框，取消则不动 */
    async function pickAndChangeDataDir() {
        const picked = await api.pickDirectory();
        if (!picked.ok || picked.data === null) return;
        await changeDataDir(picked.data);
    }

    return (
        <>
            <div className={row}>
                <Label>{t("settings.theme")}</Label>
                <Select value={theme} onValueChange={(v) => onTheme(v as ThemeMode)}>
                    <SelectTrigger className="w-full">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="auto">{t("theme.auto")}</SelectItem>
                        <SelectItem value="light">{t("theme.light")}</SelectItem>
                        <SelectItem value="dark">{t("theme.dark")}</SelectItem>
                    </SelectContent>
                </Select>
            </div>

            <div className={row}>
                <Label>{t("settings.language")}</Label>
                <Select value={lang} onValueChange={(v) => onChangeLang(v as Lang)}>
                    <SelectTrigger className="w-full">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="zh">{t("settings.lang.zh")}</SelectItem>
                        <SelectItem value="en">{t("settings.lang.en")}</SelectItem>
                    </SelectContent>
                </Select>
            </div>

            <div className={row}>
                <Label>{t("settings.hotkey")}</Label>
                {hotkey === null ? (
                    <span className="text-[13px] text-muted">…</span>
                ) : (
                    <Select value={hotkey} onValueChange={(v) => changeHotkey(v as HotkeyId)}>
                        <SelectTrigger className="w-full">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {(Object.keys(HOTKEY_LABEL) as HotkeyId[]).map((id) => (
                                <SelectItem key={id} value={id}>
                                    {t(HOTKEY_LABEL[id])}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                )}
            </div>

            <div className={row}>
                <Label htmlFor="clip-sec">{t("settings.clip")}</Label>
                <CommitInput
                    id="clip-sec"
                    type="number"
                    value={clipSecEdit}
                    onChange={setClipSecEdit}
                    onCommit={() => void commitClipSec()}
                    className="w-24"
                />
            </div>
            <div className="-mt-1 px-1 text-[11.5px] text-muted">{t("settings.clipHint")}</div>

            <div className={row}>
                <Label>{t("settings.autostart")}</Label>
                {autostart === null ? (
                    <span className="text-[13px] text-muted">…</span>
                ) : !autostart.supported ? (
                    <span className="text-[13px] text-muted">{t("settings.autostart.unsupported")}</span>
                ) : (
                    <span className="flex min-h-9 items-center gap-2.5">
                        <Switch
                            id="autostart-switch"
                            checked={autostart.enabled}
                            disabled={busy}
                            onCheckedChange={() => void toggleAutostart()}
                        />
                        <label htmlFor="autostart-switch" className="cursor-pointer text-[13px] font-normal text-dim">
                            {autostart.enabled ? t("settings.autostart.enabled") : t("settings.autostart.disabled")}
                        </label>
                    </span>
                )}
            </div>
            <div className="-mt-1 px-1 text-[11.5px] text-muted">{t("settings.autostart.moveHint")}</div>

            <div className={row}>
                <Label>{t("settings.font.ui")}</Label>
                <FontPicker value={fontCfg?.uiFont ?? ""} onCommit={(v) => void commitFont({ uiFont: v })} />
            </div>

            <div className={row}>
                <Label>{t("settings.font.mono")}</Label>
                <FontPicker mono value={fontCfg?.monoFont ?? ""} onCommit={(v) => void commitFont({ monoFont: v })} />
            </div>

            <div className={row}>
                <Label>{t("settings.term.shell")}</Label>
                {shell === null || termCfg === null ? (
                    <span className="text-[13px] text-muted">…</span>
                ) : (
                    <Select value={shell} onValueChange={(v) => changeShell(v as ShellId)}>
                        <SelectTrigger className="w-full">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {termCfg.shells.map((s) => (
                                <SelectItem key={s.id} value={s.id}>
                                    {s.id === "auto" ? `${s.id} · ${t("settings.term.shellAuto")}` : s.id}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                )}
            </div>
            <div className="-mt-1 px-1 text-[11.5px] text-muted">{t("settings.term.shellHint")}</div>

            <div className={row}>
                <Label htmlFor="term-size">{t("settings.term.fontSize")}</Label>
                <CommitInput
                    id="term-size"
                    type="number"
                    value={fontSize}
                    onChange={setFontSize}
                    onCommit={() => void commitFontSize()}
                    className="w-24"
                />
            </div>

            <div className={row}>
                <Label>{t("settings.import")}</Label>
                <Button
                    type="button"
                    variant="outline"
                    className="justify-start font-normal"
                    // App 侧切换弹窗状态即关闭设置页，无需再显式调 onClose
                    onClick={onOpenImport}
                >
                    {t("settings.importBtn")}
                </Button>
            </div>

            <div className={row}>
                <Label>{t("settings.dataDir")}</Label>
                {migrating ? (
                    <span className="text-[13px] text-muted">{t("settings.dataDir.migrating")}</span>
                ) : dataDirInfo === null ? (
                    <span className="text-[13px] text-muted">…</span>
                ) : (
                    <span className="flex min-h-9 min-w-0 items-center gap-2">
                        {/* 长路径截断展示，悬停看全名；min-w-0 让 1fr 列允许收缩触发截断 */}
                        <span title={dataDirInfo.dir} className="min-w-0 flex-1 truncate text-[13px] text-muted">
                            {dataDirInfo.dir}
                        </span>
                        <Button
                            type="button"
                            variant="outline"
                            className="justify-start font-normal"
                            onClick={() => void pickAndChangeDataDir()}
                        >
                            {t("settings.dataDir.change")}
                        </Button>
                        {!dataDirInfo.isDefault && (
                            <Button
                                type="button"
                                variant="outline"
                                className="justify-start font-normal"
                                onClick={() => void changeDataDir(null)}
                            >
                                {t("settings.dataDir.reset")}
                            </Button>
                        )}
                    </span>
                )}
            </div>

            <div className={row}>
                <Label>{t("settings.info")}</Label>
                <span className="text-[13px] text-muted">Electron · {platform}</span>
            </div>
        </>
    );
}
