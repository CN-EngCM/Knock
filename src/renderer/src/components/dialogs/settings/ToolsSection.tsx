import { useEffect, useState } from "react";
import { FieldDescription, FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { type ToolAliasPatch, type ToolAliases, type ToolId } from "@/api/client";
import { TOOLS } from "@/tools/registry";
import { useI18n } from "@/i18n/useI18n";
import { CommitInput, FormRow } from "./shared";

type Props = {
    /** 工具别名：提交走 onToolAlias（App 负责落库与回填，SearchBox 随之生效） */
    toolAliases: ToolAliases | null;
    onToolAlias: (patch: ToolAliasPatch) => Promise<boolean>;
};

/** 工具分节：内置工具的搜索别名 */
export function ToolsSection({ toolAliases, onToolAlias }: Props) {
    const { t } = useI18n();
    // 工具别名本地编辑态：失焦提交
    const [aliasEdits, setAliasEdits] = useState<Partial<Record<ToolId, string>>>({});

    // toolAliases 变化（含保存回填）时同步本地编辑态
    useEffect(() => {
        if (!toolAliases) return;
        setAliasEdits({ ...toolAliases });
    }, [toolAliases]);

    /** 别名失焦提交：空串 = 清除；没改动不请求；失败回滚 */
    async function commitAlias(id: ToolId) {
        const v = (aliasEdits[id] ?? "").trim();
        if (!toolAliases || v === (toolAliases[id] ?? "")) return;
        const ok = await onToolAlias({ aliases: { [id]: v } });
        if (!ok) setAliasEdits((prev) => ({ ...prev, [id]: toolAliases[id] ?? "" }));
    }

    return (
        <>
            {toolAliases === null ? (
                <Spinner decorative className="m-1 size-3.5 text-dim-foreground" />
            ) : (
                TOOLS.map((tool) => (
                    <FormRow key={tool.id}>
                        <FieldLabel htmlFor={`alias-${tool.id}`}>{t(tool.nameKey)}</FieldLabel>
                        <CommitInput
                            id={`alias-${tool.id}`}
                            value={aliasEdits[tool.id] ?? ""}
                            onChange={(v) => setAliasEdits((prev) => ({ ...prev, [tool.id]: v }))}
                            onCommit={() => void commitAlias(tool.id)}
                            placeholder={t("settings.tools.aliasPlaceholder")}
                        />
                    </FormRow>
                ))
            )}
            <FieldDescription className="-mt-1 px-1 text-small text-dim-foreground">
                {t("settings.tools.aliasHint")}
            </FieldDescription>
        </>
    );
}
