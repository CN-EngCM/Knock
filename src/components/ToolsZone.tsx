import { Suspense } from "react";
import { toolMeta, type ToolId } from "@/tools/registry";
import { useI18n } from "@/i18n/useI18n";

// 右上工具区：动态 tab 集合。生命周期约定（用户决策，2026-08）：
//   打开 —— 从「工具 ▾」菜单或搜索候选进，ToolsZone 首次挂载该工具组件（懒加载 chunk）；
//   切换 —— 非活动工具 display:none 保活（草稿不丢）；
//   关闭 —— tab 的 × 直接卸载组件，状态与重库一起释放，重开回到初始态。
// 素材注入不经 props（懒加载 chunk 未就绪时 props 会先被清空，素材在挂载前丢失），
// 由 toolInput.ts 的模块级 pending 在组件挂载时消费。
type Props = {
    open: ToolId[];
    active: ToolId | null;
    onActivate: (id: ToolId) => void;
    onClose: (id: ToolId) => void;
};

export function ToolsZone({ open, active, onActivate, onClose }: Props) {
    const { t } = useI18n();

    return (
        <div className="flex min-h-0 flex-1 flex-col bg-panel">
            <div className="flex flex-none items-stretch gap-0.5 border-b border-line px-2 text-[12.5px]">
                {open.map((id) => (
                    <span
                        key={id}
                        onClick={() => onActivate(id)}
                        className={`mb-[-1px] flex cursor-default select-none items-center border-b pb-1 pt-1.5 ${
                            active === id
                                ? "border-text text-text"
                                : "border-transparent text-muted hover:border-line hover:text-dim"
                        } px-2.5`}
                    >
                        {t(toolMeta(id).nameKey)}
                        <button
                            type="button"
                            onClick={(e) => {
                                e.stopPropagation();
                                onClose(id);
                            }}
                            className="ml-1.5 px-1 text-[11px] hover:bg-faint hover:text-text"
                        >
                            ×
                        </button>
                    </span>
                ))}
            </div>
            <div className="relative min-h-0 flex-1">
                {open.map((id) => {
                    const C = toolMeta(id).Component;
                    return (
                        <div
                            key={id}
                            className="absolute inset-0"
                            style={{ display: active === id ? undefined : "none" }}
                        >
                            <Suspense fallback={<div className="p-3 text-[12px] text-muted">…</div>}>
                                <C />
                            </Suspense>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
