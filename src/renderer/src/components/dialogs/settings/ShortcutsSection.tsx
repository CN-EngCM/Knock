import { FieldDescription } from "@/components/ui/field";
import { Kbd } from "@/components/ui/kbd";
import { Marker } from "@/components/ui/marker";
import { useI18n } from "@/i18n/useI18n";
import type { MessageKey } from "@/i18n";

// 快捷键分节：只读说明，不能改键。键名是键盘上印的字，不翻译；说明走 i18n。
// 新增或改了快捷键，这里和 docs/spec/ui.md 一起改。
// 键盘上印的是 Ctrl，macOS 上写 Cmd 的几个键（保存、粘贴）在说明里单独注明。

type Row = {
    /** 要显示成键帽的按键；呼出热键因为可以在基础设置里换，没有固定键，改用 label 写字 */
    keys?: string[];
    label?: MessageKey;
    desc: MessageKey;
};

const GROUPS: { title: MessageKey; rows: Row[] }[] = [
    {
        title: "shortcut.group.summon",
        rows: [{ label: "settings.hotkey", desc: "shortcut.summon" }],
    },
    {
        title: "shortcut.group.window",
        rows: [
            { keys: ["/"], desc: "shortcut.slash" },
            { keys: ["↑", "↓", "Enter"], desc: "shortcut.pick" },
            { keys: ["Esc"], desc: "shortcut.esc" },
            { keys: ["Ctrl+`", "Ctrl+Shift+`"], desc: "shortcut.workspace" },
            { keys: ["Ctrl+Tab", "Ctrl+Shift+Tab"], desc: "shortcut.panel" },
        ],
    },
    {
        title: "shortcut.group.tools",
        rows: [
            { keys: ["Ctrl+Enter"], desc: "shortcut.notes" },
            { keys: ["Ctrl+Enter"], desc: "shortcut.translate" },
            { keys: ["Ctrl+Enter"], desc: "shortcut.files" },
            { keys: ["Shift+Enter"], desc: "shortcut.termNewline" },
            { keys: ["Ctrl+V"], desc: "shortcut.termPaste" },
        ],
    },
];

/** 快捷键分节：按「呼出 / 窗口内 / 工具内」三段列出全部快捷键 */
export function ShortcutsSection() {
    const { t } = useI18n();
    return (
        <>
            {GROUPS.map((group) => (
                <div key={group.title} className="grid gap-2">
                    <Marker structure="separator" variant="muted" className="text-caption">
                        {t(group.title)}
                    </Marker>
                    {group.rows.map((row) => (
                        <div key={row.desc} className="grid grid-cols-[11rem_1fr] items-start gap-3">
                            <span className="flex flex-wrap items-center gap-1">
                                {row.label && <span className="text-xs text-foreground">{t(row.label)}</span>}
                                {row.keys?.map((k) => (
                                    <Kbd key={k}>{k}</Kbd>
                                ))}
                            </span>
                            <span className="text-xs leading-5 text-muted-foreground">{t(row.desc)}</span>
                        </div>
                    ))}
                </div>
            ))}
            <FieldDescription className="px-1 text-small text-dim-foreground">{t("shortcut.note")}</FieldDescription>
        </>
    );
}
