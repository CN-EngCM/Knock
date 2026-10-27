import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// 表单行：Field 负责行语义与间距，定宽标签列由 grid 覆写保留——库的 Field
// 没有 labelWidth（缺口 G7），水平布局是 flex-auto，无法表达「标签列固定 6rem」。
// 设置各分节与新建/编辑对话框共用这一处，不再出现 5.5rem / 6rem 两套写法。
export function FormRow({ className, ...props }: React.ComponentProps<"div">) {
    return (
        <Field
            orientation="horizontal"
            className={cn("grid grid-cols-[6rem_1fr] items-center gap-3", className)}
            {...props}
        />
    );
}

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
