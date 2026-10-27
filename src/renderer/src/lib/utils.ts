import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// 自定义字号令牌（见 index.css 的 @theme static 字号阶梯）必须登记为 font-size 组，
// 否则 twMerge 会把 text-small 当成文字颜色，与 text-xs 等同时出现时无法互相覆盖。
// 等价于上游 lib/utils 的 createCn，只是不引入 cn 包（本项目约束：零新增依赖）。
const twMerge = extendTailwindMerge({
    extend: {
        classGroups: {
            "font-size": [{ text: ["micro", "caption", "small", "control", "readout", "display"] }],
        },
    },
});

// cn：合并 className 并解决 Tailwind 类冲突（shadcn/ui 组件的标准工具）。
// clsx 负责条件拼接，twMerge 负责让后写的工具类覆盖先写的同类冲突项。
export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}
