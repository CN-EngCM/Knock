import type { Item } from "@/api/client";

// 条目类型的终端风行前缀（行首灰色小字）：ItemRow 行内与 SearchBox 候选共用一份
export const KIND_TAG: Record<Item["kind"], string> = { bookmark: "web", app: "app", file: "file" };
