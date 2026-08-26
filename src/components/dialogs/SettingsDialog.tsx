import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Eye, EyeOff } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TOOLS } from "@/tools/registry";
import { youdaoErrKey } from "@/tools/youdaoErr";
import {
    api,
    type HotkeyId,
    type ShellId,
    type TermConfig,
    type TermPatch,
    type ToolAliasPatch,
    type ToolAliases,
    type ToolId,
    type TranslateConfig,
    type TranslateConfigPatch,
} from "@/api/client";
import { useI18n } from "@/i18n/useI18n";
import type { Lang, MessageKey } from "@/i18n";
import type { ThemeMode } from "@/theme";

type Props = {
    open: boolean;
    onClose: () => void;
    /** 主题与语言控制在 App 层（设置页与顶栏共用同一状态源） */
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
    /** 工具别名：提交走 onToolAlias（App 负责落库与回填，SearchBox 随之生效） */
    toolAliases: ToolAliases | null;
    onToolAlias: (patch: ToolAliasPatch) => Promise<boolean>;
    /** 剪贴板素材时限（秒，0 = 关闭）：主进程呼出时直接读库，此处仅编辑态 */
    clipSec: number | null;
    onClipSec: (seconds: number) => Promise<boolean>;
    /** 有道翻译密钥：提交走 onTranslateCfg（App 负责落库与回填） */
    translateCfg: TranslateConfig | null;
    onTranslateCfg: (patch: TranslateConfigPatch) => Promise<boolean>;
    /** 打开时直接定位的分节（工具内「打开设置」引导；缺省回基础设置） */
    initialSection?: SectionId;
};

type AutostartStatus = { supported: boolean; enabled: boolean };

// 热键预设 id → i18n key 的映射（id 集合来自后端 schemas.HOTKEY_IDS）
const HOTKEY_LABEL: Record<HotkeyId, MessageKey> = {
    "double-ctrl": "settings.hotkey.double-ctrl",
    "double-alt": "settings.hotkey.double-alt",
    "double-shift": "settings.hotkey.double-shift",
    "alt-space": "settings.hotkey.alt-space",
    "ctrl-alt-space": "settings.hotkey.ctrl-alt-space",
};

// 分节导航定义：新增设置分节 = 这里加一项 + 下方渲染分支补一段
const SECTION_DEFS = [
    { id: "basic", labelKey: "settings.basic" },
    { id: "tools", labelKey: "settings.tools" },
    { id: "translate", labelKey: "settings.translate" },
] as const;
export type SectionId = (typeof SECTION_DEFS)[number]["id"];

// 表单行网格：标签列 + 控件列（与「编辑条目」对话框同一套排版）
const row = "grid grid-cols-[6rem_1fr] items-center gap-3";

export function SettingsDialog({
    open,
    onClose,
    theme,
    onTheme,
    lang,
    onChangeLang,
    platform,
    onOpenImport,
    termCfg,
    onTermPatch,
    toolAliases,
    onToolAlias,
    clipSec,
    onClipSec,
    translateCfg,
    onTranslateCfg,
    initialSection,
}: Props) {
    const { t } = useI18n();
    const [sec, setSec] = useState<SectionId>("basic");
    const [autostart, setAutostart] = useState<AutostartStatus | null>(null);
    const [hotkey, setHotkey] = useState<HotkeyId | null>(null);
    const [busy, setBusy] = useState(false);
    // 终端设置的本地编辑态：shell 即选即存；字体/字号失焦（或回车）才提交
    const [shell, setShell] = useState<ShellId | null>(null);
    const [font, setFont] = useState("");
    const [fontSize, setFontSize] = useState("13");
    // 工具别名本地编辑态：同样失焦提交
    const [aliasEdits, setAliasEdits] = useState<Partial<Record<ToolId, string>>>({});
    // 剪贴板时限编辑态（秒）
    const [clipSecEdit, setClipSecEdit] = useState("5");
    // 翻译密钥编辑态：失焦提交；密钥默认打码，眼睛切换明文便于核对粘贴
    const [appKeyEdit, setAppKeyEdit] = useState("");
    const [secretEdit, setSecretEdit] = useState("");
    const [showSecret, setShowSecret] = useState(false);
    // 测试连接状态：idle；testing；ok；fail（failMsg 带错误码释义或空密钥提示）
    const [test, setTest] = useState<"idle" | "testing" | "ok" | "fail">("idle");
    const [testMsg, setTestMsg] = useState("");

    // 打开时拉一次自启状态与当前热键，并回到定位分节（或第一个分节）
    useEffect(() => {
        if (!open) return;
        setSec(initialSection ?? "basic");
        setAutostart(null);
        api.getAutostart().then((r) => setAutostart(r.ok ? r.data : { supported: false, enabled: false }));
        api.getHotkey().then((r) => {
            if (r.ok) setHotkey(r.data.hotkey);
        });
    }, [open, initialSection]);

    // termCfg / toolAliases 变化（含保存回填）时同步本地编辑态
    useEffect(() => {
        if (!termCfg) return;
        setShell(termCfg.shell);
        setFont(termCfg.font);
        setFontSize(String(termCfg.fontSize));
    }, [termCfg]);

    useEffect(() => {
        if (!toolAliases) return;
        setAliasEdits({ ...toolAliases });
    }, [toolAliases]);

    useEffect(() => {
        if (clipSec !== null) setClipSecEdit(String(clipSec));
    }, [clipSec]);

    useEffect(() => {
        if (!translateCfg) return;
        setAppKeyEdit(translateCfg.appKey);
        setSecretEdit(translateCfg.secret);
    }, [translateCfg]);

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

    /** 字体失焦/回车提交：没改动不请求；失败回滚为已存值 */
    async function commitFont() {
        const v = font.trim();
        if (!termCfg || v === termCfg.font) return;
        const ok = await onTermPatch({ font: v });
        if (!ok) setFont(termCfg.font);
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

    /** 别名失焦提交：空串 = 清除；没改动不请求；失败回滚 */
    async function commitAlias(id: ToolId) {
        const v = (aliasEdits[id] ?? "").trim();
        if (!toolAliases || v === (toolAliases[id] ?? "")) return;
        const ok = await onToolAlias({ aliases: { [id]: v } });
        if (!ok) setAliasEdits((prev) => ({ ...prev, [id]: toolAliases[id] ?? "" }));
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

    /** 翻译密钥失焦提交：空串 = 清除（工具随之进入未配置态）；没改动不请求；失败回滚 */
    async function commitTranslateKey(field: "appKey" | "secret") {
        if (!translateCfg) return;
        const v = (field === "appKey" ? appKeyEdit : secretEdit).trim();
        if (v === translateCfg[field]) return;
        const ok = await onTranslateCfg({ [field]: v });
        if (!ok) {
            if (field === "appKey") setAppKeyEdit(translateCfg.appKey);
            else setSecretEdit(translateCfg.secret);
        }
    }

    /** 测试连接：先落库（translate 每次现读 settings），再发一次 mini 翻译请求 */
    async function testTranslate() {
        const appKey = appKeyEdit.trim();
        const secret = secretEdit.trim();
        if (!appKey || !secret) {
            setTest("fail");
            setTestMsg(t("settings.translate.testEmpty"));
            return;
        }
        setTest("testing");
        setTestMsg("");
        if (!(await onTranslateCfg({ appKey, secret }))) {
            setTest("fail");
            setTestMsg(t("toast.error"));
            return;
        }
        const r = await api.translate({ text: "hello", from: "auto", to: "zh-CHS" });
        if (r.ok) {
            setTest("ok");
            return;
        }
        setTest("fail");
        if (r.error.kind === "youdao") {
            const k = youdaoErrKey(r.error.code);
            setTestMsg(k ? t(k) : `${t("translate.errFallback")}: ${r.error.code}`);
        } else if (r.error.kind === "not-configured") {
            setTestMsg(t("settings.translate.testEmpty"));
        } else {
            setTestMsg(t("toast.error"));
        }
    }

    return (
        <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
            <DialogContent className="max-h-[85vh] overflow-y-auto font-mono sm:max-w-[640px]">
                <DialogHeader>
                    <DialogTitle>{t("settings.title")}</DialogTitle>
                </DialogHeader>

                {/* 两栏：左=分节导航（SECTION_DEFS 驱动），右=当前分节内容 */}
                <div className="flex min-h-[22rem] gap-4">
                    <nav className="flex w-28 flex-none flex-col gap-0.5 border-r border-line pr-2">
                        {SECTION_DEFS.map((s) => (
                            <button
                                key={s.id}
                                type="button"
                                onClick={() => setSec(s.id)}
                                className={`border-l-2 px-2 py-1.5 text-left text-[13px] ${
                                    sec === s.id
                                        ? "border-text bg-faint text-text"
                                        : "border-transparent text-muted hover:text-dim"
                                }`}
                            >
                                {t(s.labelKey)}
                            </button>
                        ))}
                    </nav>
                    <div className="grid min-w-0 flex-1 content-start gap-3">
                        {sec === "basic" && (
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
                                    <Input
                                        id="clip-sec"
                                        type="number"
                                        min={0}
                                        max={60}
                                        value={clipSecEdit}
                                        onChange={(e) => setClipSecEdit(e.target.value)}
                                        onBlur={() => void commitClipSec()}
                                        onKeyDown={(e) => {
                                            if (e.key === "Enter") e.currentTarget.blur();
                                        }}
                                        className="w-24"
                                    />
                                </div>
                                <div className="-mt-1 px-1 text-[11.5px] text-muted">{t("settings.clipHint")}</div>

                                <div className={row}>
                                    <Label>{t("settings.autostart")}</Label>
                                    {autostart === null ? (
                                        <span className="text-[13px] text-muted">…</span>
                                    ) : !autostart.supported ? (
                                        <span className="text-[13px] text-muted">
                                            {t("settings.autostart.unsupported")}
                                        </span>
                                    ) : (
                                        <Button
                                            type="button"
                                            variant="outline"
                                            className="justify-start font-normal"
                                            disabled={busy}
                                            onClick={toggleAutostart}
                                        >
                                            {autostart.enabled
                                                ? t("settings.autostart.disable")
                                                : t("settings.autostart.enable")}
                                        </Button>
                                    )}
                                </div>
                                <div className="-mt-1 px-1 text-[11.5px] text-muted">
                                    {t("settings.autostart.moveHint")}
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
                                                        {s.id === "auto"
                                                            ? `${s.id} · ${t("settings.term.shellAuto")}`
                                                            : s.id}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    )}
                                </div>
                                <div className="-mt-1 px-1 text-[11.5px] text-muted">
                                    {t("settings.term.shellHint")}
                                </div>

                                <div className={row}>
                                    <Label htmlFor="term-font">{t("settings.term.font")}</Label>
                                    <Input
                                        id="term-font"
                                        type="text"
                                        value={font}
                                        onChange={(e) => setFont(e.target.value)}
                                        onBlur={() => void commitFont()}
                                        onKeyDown={(e) => {
                                            if (e.key === "Enter") e.currentTarget.blur();
                                        }}
                                        placeholder={t("settings.term.fontPlaceholder")}
                                    />
                                </div>

                                <div className={row}>
                                    <Label htmlFor="term-size">{t("settings.term.fontSize")}</Label>
                                    <Input
                                        id="term-size"
                                        type="number"
                                        min={8}
                                        max={32}
                                        value={fontSize}
                                        onChange={(e) => setFontSize(e.target.value)}
                                        onBlur={() => void commitFontSize()}
                                        onKeyDown={(e) => {
                                            if (e.key === "Enter") e.currentTarget.blur();
                                        }}
                                        className="w-24"
                                    />
                                </div>

                                <div className={row}>
                                    <Label>{t("settings.import")}</Label>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        className="justify-start font-normal"
                                        onClick={() => {
                                            onClose();
                                            onOpenImport();
                                        }}
                                    >
                                        {t("settings.importBtn")}
                                    </Button>
                                </div>

                                <div className={row}>
                                    <Label>{t("settings.info")}</Label>
                                    <span className="text-[13px] text-muted">Electron · {platform}</span>
                                </div>
                            </>
                        )}

                        {sec === "tools" && (
                            <>
                                {toolAliases === null ? (
                                    <span className="px-1 text-[13px] text-muted">…</span>
                                ) : (
                                    TOOLS.map((tool) => (
                                        <div className={row} key={tool.id}>
                                            <Label htmlFor={`alias-${tool.id}`}>{t(tool.nameKey)}</Label>
                                            <Input
                                                id={`alias-${tool.id}`}
                                                type="text"
                                                value={aliasEdits[tool.id] ?? ""}
                                                onChange={(e) =>
                                                    setAliasEdits((prev) => ({ ...prev, [tool.id]: e.target.value }))
                                                }
                                                onBlur={() => void commitAlias(tool.id)}
                                                onKeyDown={(e) => {
                                                    if (e.key === "Enter") e.currentTarget.blur();
                                                }}
                                                placeholder={t("settings.tools.aliasPlaceholder")}
                                            />
                                        </div>
                                    ))
                                )}
                                <div className="-mt-1 px-1 text-[11.5px] text-muted">
                                    {t("settings.tools.aliasHint")}
                                </div>
                            </>
                        )}

                        {sec === "translate" && translateCfg !== null && (
                            <>
                                <div className={row}>
                                    <Label htmlFor="youdao-key">{t("settings.translate.appKey")}</Label>
                                    <Input
                                        id="youdao-key"
                                        type="text"
                                        value={appKeyEdit}
                                        maxLength={64}
                                        onChange={(e) => setAppKeyEdit(e.target.value)}
                                        onBlur={() => void commitTranslateKey("appKey")}
                                        onKeyDown={(e) => {
                                            if (e.key === "Enter") e.currentTarget.blur();
                                        }}
                                    />
                                </div>

                                <div className={row}>
                                    <Label htmlFor="youdao-secret">{t("settings.translate.secret")}</Label>
                                    <span className="flex items-center gap-1.5">
                                        <Input
                                            id="youdao-secret"
                                            type={showSecret ? "text" : "password"}
                                            value={secretEdit}
                                            maxLength={128}
                                            onChange={(e) => setSecretEdit(e.target.value)}
                                            onBlur={() => void commitTranslateKey("secret")}
                                            onKeyDown={(e) => {
                                                if (e.key === "Enter") e.currentTarget.blur();
                                            }}
                                        />
                                        <button
                                            type="button"
                                            className="tbtn flex-none"
                                            aria-pressed={showSecret}
                                            title={t("settings.translate.toggleSecret")}
                                            onClick={() => setShowSecret((v) => !v)}
                                        >
                                            {showSecret ? <EyeOff size={14} /> : <Eye size={14} />}
                                        </button>
                                    </span>
                                </div>
                                <div className="-mt-1 px-1 text-[11.5px] text-muted">
                                    {t("settings.translate.hint")}
                                </div>

                                <div className={row}>
                                    <Label>{t("settings.translate.test")}</Label>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        className="justify-start font-normal"
                                        disabled={test === "testing"}
                                        onClick={() => void testTranslate()}
                                    >
                                        {test === "testing"
                                            ? t("settings.translate.testing")
                                            : t("settings.translate.testBtn")}
                                    </Button>
                                </div>
                                {test === "ok" && (
                                    <div className="-mt-1 px-1 text-[11.5px] text-dim">
                                        {t("settings.translate.testOk")}
                                    </div>
                                )}
                                {test === "fail" && testMsg && (
                                    <div className="-mt-1 px-1 text-[11.5px] text-dim">{testMsg}</div>
                                )}
                            </>
                        )}
                    </div>
                </div>

                <DialogFooter>
                    <Button type="button" variant="outline" onClick={onClose}>
                        {t("common.close")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
