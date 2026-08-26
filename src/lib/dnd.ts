import { PointerSensor, useSensor, useSensors } from '@dnd-kit/core'

// 统一的拖拽传感器配置（App 的分组排序与 GroupPanel 的条目排序共用）。
// dnd-kit 默认传感器没有激活阈值：pointerdown 一按就激活拖拽，并立刻在
// document 捕获阶段拦截 click——表现为拖拽元素里的按钮（组头加号/删除、
// 行点击编辑）点了没反应。加 4px 位移阈值后：不动 = 点击照常，动了 = 拖拽。
export function useDragSensors() {
  return useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))
}
