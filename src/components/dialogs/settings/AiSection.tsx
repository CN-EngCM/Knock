import { useEffect, useState } from "react";
import { Check, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api, type AiModelConfig, type AiProviderId } from "@/api/client";
import { aiErrKey } from "@/tools/aiErr";
import { useI18n } from "@/i18n/useI18n";
import { row } from "./shared";

type Props = {
    /** AI 模型配置整表：提交走 onAiModels（App 负责落库与回填） */
    aiModels: AiModelConfig[] | null;
    onAiModels: (list: AiModelConfig[]) => Promise<boolean>;
};

// 供应商词汇表：须与 server/schemas.AI_PROVIDER_IDS 手工对齐（渲染进程禁止运行时
// import server/ 的值，zod 在主进程仍会兜底校验）；键为下拉展示名。
const PROVIDER_IDS: readonly AiProviderId[] = ["deepseek", "zhipu"];
const PROVIDER_LABEL: Record<AiProviderId, string> = { deepseek: "DeepSeek", zhipu: "智谱 GLM" };

// 模型 id 建议：仅 datalist 提示帮助输入，不是白名单——模型 id 自由填写。
// 条目要与两家供应商现役型号对齐，过期条目只会误导，定期审视。
const MODEL_SUGGESTIONS = [
    "deepseek-chat",
    "deepseek-reasoner",
    "deepseek-v4-flash-vision-exp",
    "glm-5.3-flash",
    "glm-4.6",
];

type TestState = { state: "idle" } | { state: "testing" } | { state: "ok" } | { state: "fail"; msg: string };

/** 配置卡片完整才可保存/测试（schema 也是 min(1)，这里先行挡下给出可用性反馈） */
function complete(cfg: AiModelConfig): boolean {
    return cfg.id !== "" && cfg.model.trim() !== "" && cfg.apiKey.trim() !== "";
}

/** AI 分节：多套模型配置增删改 + 逐卡测试连接。挂载即持有整表编辑态，关闭即丢 */
export function AiSection({ aiModels, onAiModels }: Props) {
    const { t } = useI18n();
    // 整表编辑态（id 是本地标识 UUID，新增时生成）
    const [list, setList] = useState<AiModelConfig[]>([]);
    // 测试状态按卡片隔离（key=配置 id）
    const [tests, setTests] = useState<Record<string, TestState>>({});
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (aiModels) setList(aiModels);
    }, [aiModels]);

    /** 只改本地编辑态；落库统一由「保存」整表提交 */
    function patchCard(id: string, patch: Partial<AiModelConfig>): void {
        setList((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));
    }

    function addCard(): void {
        setList((prev) => [...prev, { id: crypto.randomUUID(), provider: "deepseek", model: "", apiKey: "" }]);
    }

    function removeCard(id: string): void {
        setList((prev) => prev.filter((m) => m.id !== id));
    }

    /** 测试当前编辑值（不落库）：mini 非流式请求，结果按卡片内联展示 */
    async function testCard(cfg: AiModelConfig): Promise<void> {
        setTests((prev) => ({ ...prev, [cfg.id]: { state: "testing" } }));
        const r = await api.aiTestModel(cfg);
        if (r.ok) {
            setTests((prev) => ({ ...prev, [cfg.id]: { state: "ok" } }));
            return;
        }
        let msg = t("toast.error");
        if (r.error.kind === "ai") {
            const k = aiErrKey(r.error.status);
            if (k) msg = t(k);
            else msg = `${t("ai.err.other")}: ${r.error.status}`;
        }
        setTests((prev) => ({ ...prev, [cfg.id]: { state: "fail", msg } }));
    }

    async function save(): Promise<void> {
        if (!list.every(complete)) return; // 有半成品行时按钮已禁用，双保险
        setSaving(true);
        const ok = await onAiModels(list);
        setSaving(false);
        if (ok) toast.success(t("toast.saved"));
    }

    // 配置未就绪时不渲染任何行（外壳的分节容器保持空态）
    if (!aiModels) return null;

    return (
        <div className="flex flex-col gap-3">
            {/* 所有卡片共用一份模型 id 建议 */}
            <datalist id="mp-ai-model-suggestions">
                {MODEL_SUGGESTIONS.map((s) => (
                    <option key={s} value={s} />
                ))}
            </datalist>

            <div className="-mt-1 px-1 text-[11.5px] text-muted">{t("settings.ai.hint")}</div>

            {list.map((cfg) => {
                const test = tests[cfg.id] ?? { state: "idle" as const };
                return (
                    <div key={cfg.id} className="flex flex-col gap-2 rounded-sm border border-line p-2.5">
                        <div className={row}>
                            <Label htmlFor={`ai-provider-${cfg.id}`}>{t("settings.ai.provider")}</Label>
                            <Select
                                value={cfg.provider}
                                onValueChange={(v) => patchCard(cfg.id, { provider: v as AiProviderId })}
                            >
                                <SelectTrigger id={`ai-provider-${cfg.id}`} className="w-full">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {PROVIDER_IDS.map((p) => (
                                        <SelectItem key={p} value={p}>
                                            {PROVIDER_LABEL[p]}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className={row}>
                            <Label htmlFor={`ai-model-${cfg.id}`}>{t("settings.ai.model")}</Label>
                            <Input
                                id={`ai-model-${cfg.id}`}
                                list="mp-ai-model-suggestions"
                                value={cfg.model}
                                maxLength={100}
                                placeholder={MODEL_SUGGESTIONS[0]}
                                onChange={(e) => patchCard(cfg.id, { model: e.target.value })}
                            />
                        </div>

                        <div className={row}>
                            <Label htmlFor={`ai-key-${cfg.id}`}>{t("settings.ai.apiKey")}</Label>
                            <ApiKeyInput
                                id={`ai-key-${cfg.id}`}
                                value={cfg.apiKey}
                                onChange={(v) => patchCard(cfg.id, { apiKey: v })}
                            />
                        </div>

                        <div className="flex min-h-8 flex-wrap items-center gap-x-3 gap-y-1 pl-[7rem]">
                            <span className="mr-auto flex items-center gap-1 text-[12px] text-dim">
                                {test.state === "ok" && (
                                    <>
                                        <Check size={13} />
                                        {t("settings.ai.testOk")}
                                    </>
                                )}
                                {test.state === "fail" && <span className="text-destructive">{test.msg}</span>}
                            </span>
                            <Button
                                type="button"
                                className="w-fit px-4"
                                disabled={!complete(cfg) || test.state === "testing"}
                                onClick={() => void testCard(cfg)}
                            >
                                {test.state === "testing" ? t("settings.ai.testing") : t("settings.ai.test")}
                            </Button>
                            <Button
                                type="button"
                                variant="outline"
                                className="w-fit px-3"
                                onClick={() => removeCard(cfg.id)}
                            >
                                {t("settings.ai.remove")}
                            </Button>
                        </div>
                    </div>
                );
            })}

            {list.length === 0 && (
                <div className="py-6 text-center text-[12.5px] text-muted">{t("settings.ai.empty")}</div>
            )}

            <div className="flex justify-between">
                <Button type="button" variant="outline" onClick={addCard}>
                    ＋ {t("settings.ai.add")}
                </Button>
                <Button
                    type="button"
                    className="w-fit px-6"
                    disabled={saving || !list.every(complete)}
                    onClick={() => void save()}
                >
                    {t("settings.ai.save")}
                </Button>
            </div>
        </div>
    );
}

/** 密钥输入：默认打码、眼睛切明文（照 TranslateSection 先例；受控即时同步编辑态，
 *  提交统一走整表「保存」，因此不需要失焦提交语义） */
function ApiKeyInput({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
    const { t } = useI18n();
    const [show, setShow] = useState(false);
    return (
        <span className="flex items-center gap-1.5">
            <Input
                id={id}
                type={show ? "text" : "password"}
                value={value}
                maxLength={200}
                onChange={(e) => onChange(e.target.value)}
            />
            <button
                type="button"
                className="tbtn flex-none"
                aria-pressed={show}
                title={t("settings.translate.toggleSecret")}
                onClick={() => setShow((v) => !v)}
            >
                {show ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
        </span>
    );
}
