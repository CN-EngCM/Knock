import { useEffect, useSyncExternalStore } from "react";
import { api, type Expert } from "@/api/client";

// ── AI 专家列表的渲染端共享 store ──
// 动机：工具组件的 props 契约固定只有 initialInput/openSettings，专家列表却需要
// AiTool 与 SearchBox 两处同步（搜索框推荐区显示勾选推荐的专家）。模块级单例 +
// 订阅集是最小的共享方式，不为此新造状态管理抽象（仓库硬约束 5）。

let experts: Expert[] = [];
const subs = new Set<() => void>();
let loading = false;

/** 替换整表并广播（必须换新数组引用，useSyncExternalStore 靠引用比较跳过无效渲染） */
function setExperts(list: Expert[]): void {
    experts = list;
    for (const fn of subs) fn();
}

/** 从主进程重拉整表；返回最新列表（调用方据它做「删除后切下一个」之类的即时决策）。
 *  loading 标记防并发重复请求 */
export async function loadExperts(): Promise<Expert[] | null> {
    if (loading) return null;
    loading = true;
    try {
        const r = await api.listExperts();
        if (r.ok) setExperts(r.data);
        return r.ok ? r.data : null;
    } finally {
        loading = false;
    }
}

/** 组件侧订阅入口：首次挂载自动拉一次，之后随共享 store 更新 */
export function useExperts(): Expert[] {
    useEffect(() => {
        void loadExperts();
    }, []);
    return useSyncExternalStore(
        (fn) => {
            subs.add(fn);
            return () => {
                subs.delete(fn);
            };
        },
        () => experts,
    );
}
