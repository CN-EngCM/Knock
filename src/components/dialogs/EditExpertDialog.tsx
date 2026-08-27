import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { api, type AiEffortId, type AiModelConfig, type AiProviderId, type Expert } from "@/api/client";
import { loadExperts, useExperts } from "@/lib/experts";
import { dropConv, getActive, setActive } from "@/tools/aiSessions";
import { useI18n } from "@/i18n/useI18n";
import type { MessageKey } from "@/i18n/zh";
import { row } from "./settings/shared";

type Props = {
    /** 编辑目标："new" 新建，否则为既有专家 id */
    target: "new" | number;
    /** 模型配置候选（AiTool 挂载时拉取后透传，避免对话框重复请求；null = 尚未就绪只显示未绑定） */
    models: AiModelConfig[] | null;
    onClose: () => void;
};

// 思考强度词汇表：须与 server/schemas.AI_EFFORT_IDS 手工对齐（渲染进程禁止运行时
// import server/ 的值，zod 在主进程仍会兜底校验）。default = 请求不带 reasoning_effort。
const EFFORT_IDS: readonly AiEffortId[] = ["default", "low", "high", "max"];
const EFFORT_LABEL: Record<AiEffortId, MessageKey> = {
    default: "ai.effort.default",
    low: "ai.effort.low",
    high: "ai.effort.high",
    max: "ai.effort.max",
};

// 供应商显示名：与 AiTool/AiSection 同一份手工对齐（server/schemas.AI_PROVIDER_IDS）
const PROVIDER_LABEL: Record<AiProviderId, string> = { deepseek: "DeepSeek", zhipu: "智谱" };

/** 绑定模型下拉的哨兵 value：Radix Select 不允许空串 value，用非法模型 id 代表「未绑定」 */
const NO_MODEL = ":unbound";

/** 专家编辑对话框（新建 / 修改共用）。编辑态自持、关闭即丢；
 *  保存与删除成功都先 loadExperts() 刷新共享 store 再关——左栏列表与搜索框推荐同步刷新 */
export function EditExpertDialog({ target, models, onClose }: Props) {
    const { t } = useI18n();
    const experts = useExperts();
    // 回填只在挂载时做一次（父组件条件渲染保证开一次挂一次），共享 store 后续刷新不打扰表单
    const editing: Expert | null = target === "new" ? null : (experts.find((e) => e.id === target) ?? null);
    const [name, setName] = useState(editing?.name ?? "");
    const [prompt, setPrompt] = useState(editing?.prompt ?? "");
    const [multi, setMulti] = useState(editing?.multi ?? false);
    const [effort, setEffort] = useState<AiEffortId>(editing?.effort ?? "default");
    const [recommend, setRecommend] = useState(editing?.recommend ?? false);
    const [modelId, setModelId] = useState(editing?.modelId ?? "");
    // 删除的行内二次确认 + 在途请求标志（双击确认路径要挡住第二阶段的连击）
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [busy, setBusy] = useState(false);

    async function save(): Promise<void> {
        if (busy || !name.trim() || !prompt.trim()) return;
        const input = { name: name.trim(), prompt: prompt.trim(), multi, recommend, effort, modelId };
        setBusy(true);
        try {
            const r = target === "new" ? await api.createExpert(input) : await api.updateExpert(target, input);
            if (!r.ok) {
                toast.error(t("toast.error"));
                return;
            }
            await loadExperts(); // 先刷共享 store 再关，失败时对话框不关可重试
            toast.success(t("toast.saved"));
            // 新建成功即切到新专家（编辑既有专家不动当前选中）
            if (target === "new") setActive(r.data.id);
            onClose();
        } finally {
            setBusy(false);
        }
    }

    async function remove(): Promise<void> {
        if (typeof target !== "number" || busy) return;
        // 行内二次确认：第一击只翻开确认态
        if (!confirmDelete) {
            setConfirmDelete(true);
            return;
        }
        setBusy(true);
        try {
            const r = await api.deleteExpert(target);
            if (!r.ok) {
                toast.error(t("toast.error"));
                setConfirmDelete(false);
                return;
            }
            dropConv(target); // 连带停流清会话
            const fresh = await loadExperts();
            // 删的是活跃专家 → 切到删除后列表的第一个；fresh 拉取失败则保持原选中
            if (fresh && getActive() === target) setActive(fresh[0]?.id ?? null);
            toast.success(t("toast.deleted"));
            onClose();
        } finally {
            setBusy(false);
        }
    }

    return (
        <Dialog open onOpenChange={(v) => !v && onClose()}>
            <DialogContent className="font-mono sm:max-w-xl">
                <DialogHeader>
                    <DialogTitle>{target === "new" ? t("ai.newExpert") : t("ai.editExpert")}</DialogTitle>
                </DialogHeader>

                <div className="grid gap-4">
                    <div className={row}>
                        <Label htmlFor="ee-name">{t("ai.name")}</Label>
                        <Input
                            id="ee-name"
                            value={name}
                            maxLength={50}
                            onChange={(e) => setName(e.target.value)}
                            required
                        />
                    </div>

                    {/* 提示词占满整行多行输入，脱离 row 网格（标签在上不占标签列） */}
                    <div className="flex flex-col gap-2">
                        <Label htmlFor="ee-prompt">{t("ai.prompt")}</Label>
                        <textarea
                            id="ee-prompt"
                            className="min-h-36 w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
                            value={prompt}
                            maxLength={8000}
                            spellCheck={false}
                            onChange={(e) => setPrompt(e.target.value)}
                        />
                    </div>

                    <div className={row}>
                        <Label>{t("ai.mode")}</Label>
                        <div className="flex gap-2">
                            {[false, true].map((m) => (
                                <button
                                    key={String(m)}
                                    type="button"
                                    className={`rounded-md border border-line px-3 py-1.5 text-sm transition-colors ${
                                        multi === m ? "bg-text text-bg" : "text-dim hover:bg-faint"
                                    }`}
                                    onClick={() => setMulti(m)}
                                >
                                    {t(m ? "ai.modeMulti" : "ai.modeSingle")}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className={row}>
                        <Label>{t("ai.effort")}</Label>
                        <Select value={effort} onValueChange={(v) => setEffort(v as AiEffortId)}>
                            <SelectTrigger className="w-full">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {EFFORT_IDS.map((id) => (
                                    <SelectItem key={id} value={id}>
                                        {t(EFFORT_LABEL[id])}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className={row}>
                        <Label htmlFor="ee-recommend">{t("ai.recommend")}</Label>
                        <Switch id="ee-recommend" checked={recommend} onCheckedChange={setRecommend} />
                    </div>

                    <div className={row}>
                        <Label>{t("ai.bindModel")}</Label>
                        <Select value={modelId || NO_MODEL} onValueChange={(v) => setModelId(v === NO_MODEL ? "" : v)}>
                            <SelectTrigger className="w-full">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={NO_MODEL}>{t("ai.unbound")}</SelectItem>
                                {(models ?? []).map((m) => (
                                    <SelectItem key={m.id} value={m.id}>
                                        {PROVIDER_LABEL[m.provider]} · {m.model}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                </div>

                <DialogFooter>
                    {typeof target === "number" && (
                        <Button
                            type="button"
                            variant="outline"
                            disabled={busy}
                            className={`mr-auto ${confirmDelete ? "border-destructive text-destructive hover:text-destructive" : ""}`}
                            onClick={() => void remove()}
                        >
                            {confirmDelete ? t("ai.confirmDelete") : t("ai.delete")}
                        </Button>
                    )}
                    <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
                        {t("common.cancel")}
                    </Button>
                    <Button type="button" disabled={busy || !name.trim() || !prompt.trim()} onClick={() => void save()}>
                        {target === "new" ? t("common.create") : t("common.save")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
