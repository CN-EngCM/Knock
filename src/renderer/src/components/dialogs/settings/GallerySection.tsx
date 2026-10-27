import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { FieldDescription, FieldLabel } from "@/components/ui/field";
import { api } from "@/api/client";
import { useI18n } from "@/i18n/useI18n";
import { CommitInput, FormRow } from "./shared";

// 图库分节：私密功能的图库密码（工具级一个，明文存 settings 表）。
// 密码不回显——编辑框只写新值，空值失焦不动作；清除走专门按钮（行内二次确认，
// 误触一次不至于让私密分组直接公开）。分节自治：挂载拉状态、提交直接走 api，
// 不进 App 的 props 链；设置里改密后，图库工具会在下次刷新分组表时同步开关显隐。
export function GallerySection() {
    const { t } = useI18n();
    const [has, setHas] = useState<boolean | null>(null); // null = 首拉未就绪，不渲染
    const [edit, setEdit] = useState("");
    const [confirmClear, setConfirmClear] = useState(false);

    useEffect(() => {
        void api.galleryPasswordState().then((r) => {
            if (r.ok) setHas(r.data.has);
        });
    }, []);

    /** 提交新密码（设置 = 修改，明文模型不校验旧密码）；成功后回空态 */
    async function commitPassword() {
        const v = edit;
        setEdit("");
        if (!v || has == null) return;
        const r = await api.gallerySetPassword(v);
        if (!r.ok) {
            toast.error(t("toast.error"));
            return;
        }
        setHas(true);
        toast.success(t("gallery.pw.setDone"));
    }

    async function clearPassword() {
        const r = await api.gallerySetPassword(null);
        setConfirmClear(false);
        if (!r.ok) {
            toast.error(t("toast.error"));
            return;
        }
        setHas(false);
        toast.success(t("gallery.pw.removeDone"));
    }

    if (has == null) return null;

    return (
        <>
            <FieldDescription className="px-1 text-small text-dim-foreground">
                {t("settings.gallery.hint")}
            </FieldDescription>

            <FormRow>
                <FieldLabel htmlFor="gallery-password">{t("settings.gallery.password")}</FieldLabel>
                <CommitInput
                    id="gallery-password"
                    type="password"
                    value={edit}
                    maxLength={64}
                    onChange={setEdit}
                    onCommit={() => void commitPassword()}
                    placeholder={has ? t("settings.gallery.pwSet") : t("settings.gallery.pwNone")}
                    className="w-48"
                />
            </FormRow>

            {has && (
                <FormRow>
                    <FieldLabel>{t("settings.gallery.clear")}</FieldLabel>
                    {/* 动作行样式对齐 TranslateSection 的测试连接行 */}
                    <div className="flex min-h-9 items-center">
                        {confirmClear ? (
                            <Button
                                type="button"
                                appearance="standard"
                                variant="destructive"
                                size="default"
                                className="w-fit px-4"
                                onClick={() => void clearPassword()}
                            >
                                {t("settings.gallery.confirmClear")}
                            </Button>
                        ) : (
                            <Button
                                type="button"
                                appearance="standard"
                                variant="outline"
                                size="default"
                                className="w-fit px-4"
                                onClick={() => setConfirmClear(true)}
                            >
                                {t("settings.gallery.clearBtn")}
                            </Button>
                        )}
                    </div>
                </FormRow>
            )}
        </>
    );
}
