import { useEffect, useSyncExternalStore } from "react";
import { api, type AiModelConfig } from "@/api/client";

// ── AI 模型配置（整表）的渲染端共享 store ──
// 动机：AiTool 判断「有没有可用模型」，AiSection 编辑并保存同一张表；两处各拉各的，
// 会让「在 AI 工具里点打开设置、配好模型回来」时工具看不到新值。照 lib/experts.ts 的写法，
// 模块级变量 + 订阅集，不新造状态管理抽象（仓库硬约束 5）。

// null = 还没拉到：AiTool 据此区分「加载中」和「确实没配」，不能用空数组代替
let models: AiModelConfig[] | null = null;
const subs = new Set<() => void>();
let loading = false;

/** 替换整表并广播（必须换新数组引用，useSyncExternalStore 靠引用比较跳过无效渲染） */
function setModels(list: AiModelConfig[]): void {
    models = list;
    for (const fn of subs) fn();
}

async function loadAiModels(): Promise<void> {
    if (loading) return;
    loading = true;
    try {
        const r = await api.getAiModels();
        if (r.ok) setModels(r.data);
    } finally {
        loading = false;
    }
}

/** 整表替换并落库：成功才更新共享值并返回 true，失败返回 false 由调用方提示 */
export async function saveAiModels(list: AiModelConfig[]): Promise<boolean> {
    try {
        const r = await api.setAiModels(list);
        if (!r.ok) return false;
        setModels(list);
        return true;
    } catch {
        return false;
    }
}

/** 组件侧订阅入口：已有值就不重拉（保存时已同步），首个使用者挂载时才拉一次 */
export function useAiModels(): AiModelConfig[] | null {
    useEffect(() => {
        if (models === null) void loadAiModels();
    }, []);
    return useSyncExternalStore(
        (fn) => {
            subs.add(fn);
            return () => {
                subs.delete(fn);
            };
        },
        () => models,
    );
}
