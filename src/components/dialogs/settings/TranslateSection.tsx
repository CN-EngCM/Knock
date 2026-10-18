import { useEffect, useState } from "react";
import { Check, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { api, type TranslateConfig, type TranslateConfigPatch } from "@/api/client";
import { youdaoErrKey } from "@/tools/youdaoErr";
import { useI18n } from "@/i18n/useI18n";
import { CommitInput, row } from "./shared";

type Props = {
    /** 有道翻译密钥：提交走 onTranslateCfg（App 负责落库与回填） */
    translateCfg: TranslateConfig | null;
    onTranslateCfg: (patch: TranslateConfigPatch) => Promise<boolean>;
};

/** 翻译分节：有道密钥 + 测试连接。分节挂载即持有全部编辑态，关闭即丢弃 */
export function TranslateSection({ translateCfg, onTranslateCfg }: Props) {
    const { t } = useI18n();
    // 密钥编辑态：失焦提交；密钥默认打码，眼睛切换明文便于核对粘贴
    const [appKeyEdit, setAppKeyEdit] = useState("");
    const [secretEdit, setSecretEdit] = useState("");
    const [showSecret, setShowSecret] = useState(false);
    // 测试连接状态：idle；testing；ok；fail（failMsg 带错误码释义或空密钥提示）
    const [test, setTest] = useState<"idle" | "testing" | "ok" | "fail">("idle");
    const [testMsg, setTestMsg] = useState("");

    // translateCfg 变化（含保存回填）时同步编辑态
    useEffect(() => {
        if (!translateCfg) return;
        setAppKeyEdit(translateCfg.appKey);
        setSecretEdit(translateCfg.secret);
    }, [translateCfg]);

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

    // 配置未就绪时不渲染任何行（外壳的分节容器保持空态）
    if (!translateCfg) return null;

    return (
        <>
            <div className={row}>
                <Label htmlFor="youdao-key">{t("settings.translate.appKey")}</Label>
                <CommitInput
                    id="youdao-key"
                    value={appKeyEdit}
                    maxLength={64}
                    onChange={setAppKeyEdit}
                    onCommit={() => void commitTranslateKey("appKey")}
                />
            </div>

            <div className={row}>
                <Label htmlFor="youdao-secret">{t("settings.translate.secret")}</Label>
                <span className="flex items-center gap-1.5">
                    <CommitInput
                        id="youdao-secret"
                        type={showSecret ? "text" : "password"}
                        value={secretEdit}
                        maxLength={128}
                        onChange={setSecretEdit}
                        onCommit={() => void commitTranslateKey("secret")}
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
            <div className="-mt-1 px-1 text-[11.5px] text-dim-foreground">{t("settings.translate.hint")}</div>

            <div className={row}>
                <Label>{t("settings.translate.test")}</Label>
                {/* 动作行而非输入框样式：主操作按钮 + 结果内联右侧，与上方文本输入拉开视觉差异 */}
                <div className="flex min-h-9 flex-wrap items-center gap-x-3 gap-y-1">
                    <Button
                        type="button"
                        appearance="standard"
                        variant="primary"
                        size="default"
                        className="w-fit px-4"
                        disabled={test === "testing"}
                        onClick={() => void testTranslate()}
                    >
                        {test === "testing" ? t("settings.translate.testing") : t("settings.translate.testBtn")}
                    </Button>
                    {test === "ok" && (
                        <span className="flex items-center gap-1 text-[12px] text-dim-foreground">
                            <Check size={13} />
                            {t("settings.translate.testOk")}
                        </span>
                    )}
                    {test === "fail" && !!testMsg && <span className="text-[12px] text-destructive">{testMsg}</span>}
                </div>
            </div>
        </>
    );
}
