import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

// cn：合并 className 并解决 Tailwind 类冲突（shadcn/ui 组件的标准工具）。
// clsx 负责条件拼接，twMerge 负责让后写的工具类覆盖先写的同类冲突项。
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
