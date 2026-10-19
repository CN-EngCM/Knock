import { Input } from "@/components/ui/input";

// 表单行网格：标签列 + 控件列（与「编辑条目」对话框同一套排版）
export const row = "grid grid-cols-[6rem_1fr] items-center gap-3";

type CommitInputProps = {
    id?: string;
    type?: string;
    value: string;
    onChange: (v: string) => void;
    /** 失焦触发；异步提交函数由调用处以 () => void fn() 包裹传入 */
    onCommit: () => void;
    placeholder?: string;
    maxLength?: number;
    className?: string;
};

/** 统一的「失焦提交」文本输入：Enter 触发 blur 复用同一条提交路径，
 *  收掉各设置行重复的 onBlur/onKeyDown 样板 */
export function CommitInput({
    id,
    type = "text",
    value,
    onChange,
    onCommit,
    placeholder,
    maxLength,
    className,
}: CommitInputProps) {
    return (
        <Input
            id={id}
            type={type}
            value={value}
            maxLength={maxLength}
            placeholder={placeholder}
            onChange={(e) => onChange(e.target.value)}
            onBlur={onCommit}
            onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
            }}
            className={className}
        />
    );
}
