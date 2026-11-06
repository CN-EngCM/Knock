import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ShortcutPickerDialog } from "./ShortcutPickerDialog";
import { api, type Item, type Kind } from "@/api/client";
import { useI18n } from "@/i18n/useI18n";
import { FormRow } from "./settings/shared";

// 表单值：提交前保证 args 为 null（而非空串），与数据库约定一致
export type ItemFormValues = {
    kind: Kind;
    title: string;
    target: string;
    args: string | null;
};

type Props = {
    open: boolean;
    /** 编辑时传入；新建时为 null */
    item: Item | null;
    /** 服务端平台（win32 才显示快捷方式选择器与「选择脚本…」） */
    platform: string;
    /** 归属普通工作区：新建时默认给终端命令（项目工具栏里命令最常见） */
    inWorkspace?: boolean;
    /** 工作区文件夹；空串表示这个工作区没有目录，不能提示「空 = 工作区文件夹」 */
    workspaceFolder?: string;
    onClose: () => void;
    onSubmit: (values: ItemFormValues) => Promise<void>;
};

/** 文件所在目录。盘符根（D:\a.ps1）要保留反斜杠：单写 "D:" 是「D 盘上次的当前目录」，不是根 */
function dirOf(path: string): string {
    const dir = path.replace(/[\\/][^\\/]*$/, "");
    return /^[A-Za-z]:$/.test(dir) ? `${dir}\\` : dir;
}

export function ItemDialog({ open, item, platform, inWorkspace = false, workspaceFolder, onClose, onSubmit }: Props) {
    const { t } = useI18n();
    const [kind, setKind] = useState<Kind>("bookmark");
    const [title, setTitle] = useState("");
    const [target, setTarget] = useState("");
    const [args, setArgs] = useState("");
    const [saving, setSaving] = useState(false);
    const [pickerOpen, setPickerOpen] = useState(false);

    // 每次打开时用 item / 默认值重置表单（编辑回填）。
    // 工作区里新建默认终端命令：项目启动项绝大多数是命令，省掉每次改下拉
    useEffect(() => {
        if (!open) return;
        setKind(item?.kind ?? (inWorkspace ? "command" : "bookmark"));
        setTitle(item?.title ?? "");
        setTarget(item?.target ?? "");
        setArgs(item?.args ?? "");
    }, [open, item, inWorkspace]);

    const targetLabel =
        kind === "bookmark"
            ? t("item.target.bookmark")
            : kind === "app"
              ? t("item.target.app")
              : kind === "command"
                ? t("item.target.command")
                : t("item.target.file");

    // 目录选择框：成功回填工作目录；取消（null）与失败都保持原值不动
    async function browseDir() {
        const r = await api.pickDirectory();
        if (r.ok && r.data !== null) setArgs(r.data);
    }

    // 标题为空时跟随文件名（与快捷方式选择器行为一致）
    function fillTitleFromFile(path: string) {
        if (title.trim()) return;
        const base = path.split(/[\\/]/).pop() ?? "";
        setTitle(base.replace(/\.[^.]+$/, ""));
    }

    // 目标选择框：app = 选可执行文件，file = 文件/文件夹皆可选；取消与失败保持原值不动
    async function browseTarget() {
        const r = await api.pickFile(kind === "app" ? "app" : "path");
        if (!r.ok || r.data === null) return;
        setTarget(r.data);
        fillTitleFromFile(r.data);
    }

    // 脚本选择框（终端命令）：命令栏填成 PowerShell 调用，工作目录填脚本所在目录。
    // 为什么用 -File 子进程而不是直接 & 脚本：不管设置里终端程序选的是 cmd 还是 PowerShell 都能跑，
    // 执行策略只对这一次放行；-NoProfile 让每次运行结果一致。
    // 工作目录每次都覆盖：换了脚本还留着旧目录，脚本会在错的目录里悄悄跑；填完用户仍可手改。
    // 对话框从工作区文件夹起步：项目脚本多半就在里面，省得每次从头翻目录；没有文件夹时用系统默认位置。
    async function browseScript() {
        const r = await api.pickFile("script", workspaceFolder || undefined);
        if (!r.ok || r.data === null) return;
        // 优先 pwsh（读无 BOM 的 UTF-8 脚本中文不乱码）；没装才退回 Windows 自带的 powershell
        const cfg = await api.getTermConfig();
        const hasPwsh = cfg.ok && cfg.data.shells.some((s) => s.id === "pwsh");
        const exe = hasPwsh ? "pwsh" : "powershell";
        setTarget(`${exe} -NoProfile -ExecutionPolicy Bypass -File "${r.data}"`);
        setArgs(dirOf(r.data));
        fillTitleFromFile(r.data);
    }

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        // 必填兜底：标题与目标不能为空
        if (!title.trim() || !target.trim()) {
            toast.error(t("toast.error"));
            return;
        }
        setSaving(true);
        try {
            await onSubmit({
                kind,
                title: title.trim(),
                // 书签缺协议时自动补 https://（否则 href 会变成站内相对路径）
                target:
                    kind === "bookmark" && !/^https?:\/\//i.test(target.trim())
                        ? `https://${target.trim()}`
                        : target.trim(),
                // 仅 app/command 复用 args 列（启动参数 / 工作目录），其余类型一律置 null
                args: (kind === "app" || kind === "command") && args.trim() ? args.trim() : null,
            });
            onClose();
        } catch {
            toast.error(t("toast.error"));
        } finally {
            setSaving(false);
        }
    }

    return (
        <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{item ? t("item.edit") : t("item.new")}</DialogTitle>
                </DialogHeader>

                <form onSubmit={handleSubmit} className="grid gap-4">
                    <FormRow>
                        <FieldLabel htmlFor="item-kind">{t("item.kind")}</FieldLabel>
                        <Select value={kind} onValueChange={(v) => setKind(v as Kind)}>
                            <SelectTrigger id="item-kind" className="w-full">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="bookmark">{t("item.kind.bookmark")}</SelectItem>
                                <SelectItem value="app">{t("item.kind.app")}</SelectItem>
                                <SelectItem value="file">{t("item.kind.file")}</SelectItem>
                                <SelectItem value="command">{t("item.kind.command")}</SelectItem>
                            </SelectContent>
                        </Select>
                    </FormRow>

                    <FormRow>
                        <FieldLabel htmlFor="item-title">{t("item.title")}</FieldLabel>
                        <Input
                            id="item-title"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            required
                            maxLength={100}
                        />
                    </FormRow>

                    <FormRow>
                        <FieldLabel htmlFor="item-target">{t("item.target")}</FieldLabel>
                        <div className="flex gap-2">
                            <Input
                                id="item-target"
                                placeholder={targetLabel}
                                value={target}
                                onChange={(e) => setTarget(e.target.value)}
                                required
                                maxLength={1000}
                                className="flex-1"
                            />
                            {kind === "app" && (platform === "win32" || platform === "darwin") && (
                                <Button
                                    type="button"
                                    appearance="standard"
                                    variant="outline"
                                    size="default"
                                    className="flex-none whitespace-nowrap"
                                    onClick={() => setPickerOpen(true)}
                                >
                                    {t("item.pickShortcut")}
                                </Button>
                            )}
                            {(kind === "app" || kind === "file") && (
                                <Button
                                    type="button"
                                    appearance="standard"
                                    variant="outline"
                                    size="default"
                                    className="flex-none whitespace-nowrap"
                                    onClick={() => void browseTarget()}
                                >
                                    {t("btn.browse")}
                                </Button>
                            )}
                            {/* 与下面工作目录那行的「浏览…」区分开，按钮文字写明是选脚本；ps1 只有 Windows 用 */}
                            {kind === "command" && platform === "win32" && (
                                <Button
                                    type="button"
                                    appearance="standard"
                                    variant="outline"
                                    size="default"
                                    className="flex-none whitespace-nowrap"
                                    onClick={() => void browseScript()}
                                >
                                    {t("item.pickScript")}
                                </Button>
                            )}
                        </div>
                    </FormRow>

                    {/* args 列被 app（启动参数）与 command（工作目录）复用；command 额外给「浏览…」 */}
                    {(kind === "app" || kind === "command") && (
                        <FormRow>
                            <FieldLabel htmlFor="item-args">
                                {kind === "app"
                                    ? t("item.args")
                                    : workspaceFolder
                                      ? t("item.cwdInWorkspace")
                                      : t("item.cwd")}
                            </FieldLabel>
                            <div className="flex gap-2">
                                <Input
                                    id="item-args"
                                    value={args}
                                    onChange={(e) => setArgs(e.target.value)}
                                    maxLength={1000}
                                    className="flex-1"
                                />
                                {kind === "command" && (
                                    <Button
                                        type="button"
                                        appearance="standard"
                                        variant="outline"
                                        size="default"
                                        className="flex-none whitespace-nowrap"
                                        onClick={() => void browseDir()}
                                    >
                                        {t("btn.browse")}
                                    </Button>
                                )}
                            </div>
                        </FormRow>
                    )}

                    <DialogFooter>
                        <Button type="button" appearance="standard" variant="outline" size="default" onClick={onClose}>
                            {t("common.cancel")}
                        </Button>
                        <Button type="submit" appearance="standard" variant="primary" size="default" disabled={saving}>
                            {item ? t("common.save") : t("common.create")}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>

            {/* Windows 列开始菜单/桌面快捷方式，mac 列已安装应用（.app）；回填路径与标题 */}
            <ShortcutPickerDialog
                open={pickerOpen}
                onClose={() => setPickerOpen(false)}
                onPick={(s) => {
                    setTarget(s.lnk);
                    // 标题为空或仍是上次回填值时，跟随快捷方式名
                    if (!title.trim()) setTitle(s.name);
                }}
            />
        </Dialog>
    );
}
