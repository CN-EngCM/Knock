// 三区布局的分隔条：拖动改侧栏宽度 / 终端高度（受控组件，位置状态在 App）。
// 用 pointer capture 而不是 window 监听：拖出窗口边界也不丢事件。
type Props = {
    /** vertical = 左右分栏（竖条，col-resize）；horizontal = 上下分栏（横条，row-resize） */
    orientation: "vertical" | "horizontal";
    onDrag: (e: React.PointerEvent) => void;
};

export function Splitter({ orientation, onDrag }: Props) {
    const base = "flex-none hover:bg-faint active:bg-faint";
    return (
        <div
            role="separator"
            aria-orientation={orientation}
            onPointerDown={(e) => {
                e.preventDefault();
                e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
                if (e.currentTarget.hasPointerCapture(e.pointerId)) onDrag(e);
            }}
            className={orientation === "vertical" ? `w-1 cursor-col-resize ${base}` : `h-1 cursor-row-resize ${base}`}
        />
    );
}
