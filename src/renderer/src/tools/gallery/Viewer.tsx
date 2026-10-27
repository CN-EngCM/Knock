import { useEffect, useRef, useState } from "react";
import {
    ChevronLeft,
    ChevronRight,
    Copy,
    ExternalLink,
    FolderOpen,
    Info,
    Maximize,
    RotateCw,
    Tag,
    Trash2,
    X,
    ZoomIn,
    ZoomOut,
} from "lucide-react";
import { toast } from "sonner";
import { ActionBar, ActionBarGroup, ActionBarSeparator } from "@/components/ui/action-bar";
import { api, type GalleryGroup, type GalleryImage } from "@/api/client";
import { useI18n } from "@/i18n/useI18n";
import { TipActionButton } from "../TipButton";
import { fmtBytes, fmtDateTime } from "./util";

type Props = {
    items: GalleryImage[];
    index: number;
    groups: GalleryGroup[];
    onNav: (index: number) => void;
    onClose: () => void;
    onEditTags: (img: GalleryImage) => void;
    /** 删除走父组件的确认弹窗（顺带处理列表移除与相邻跳转）。
     *  不传 = 该入口禁删（画廊视图打开时：策展面不做库级删除，与网格右键菜单同规） */
    onDelete?: (img: GalleryImage) => void;
};

const MIN_SCALE = 0.05;
const MAX_SCALE = 20;
const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

// 大图查看器：fixed 覆盖层（z-40，低于 Dialog 的 z-50，标签/删除确认弹窗盖得住）。
// transform = translate(px,py) scale(s) rotate(deg)：translate 在 scale 之前，
// 平移量直接用屏幕像素，不用除以缩放。缩放一律以画面中心为锚。
export function Viewer({ items, index, groups, onNav, onClose, onEditTags, onDelete }: Props) {
    const { t } = useI18n();
    const img = items[index];
    const rootRef = useRef<HTMLDivElement>(null);
    const stageRef = useRef<HTMLDivElement>(null);
    const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
    const [scale, setScale] = useState(1);
    const [tx, setTx] = useState(0);
    const [ty, setTy] = useState(0);
    const [rot, setRot] = useState(0);
    const [info, setInfo] = useState(false);
    const [failed, setFailed] = useState(false);
    const [panning, setPanning] = useState(false);
    const panRef = useRef<{ x: number; y: number } | null>(null);

    // 挂载即抢焦点：后续所有按键都落在覆盖层内被吃掉（stopPropagation 后
    // 不会再冒到工具挂在 document 上的 Ctrl+A / Esc 监听）
    useEffect(() => {
        rootRef.current?.focus();
    }, []);

    // 翻图即复位：尺寸等新图 onLoad 给出后再适应
    useEffect(() => {
        setNat(null);
        setFailed(false);
        setRot(0);
        setTx(0);
        setTy(0);
        setScale(1);
    }, [index]);

    function fitScale(w: number, h: number): number {
        const el = stageRef.current;
        if (!el || w <= 0 || h <= 0) return 1;
        return Math.min(el.clientWidth / w, el.clientHeight / h);
    }
    function fit() {
        if (!nat) return;
        setScale(fitScale(nat.w, nat.h));
        setTx(0);
        setTy(0);
    }
    function oneToOne() {
        setScale(1);
        setTx(0);
        setTy(0);
    }
    const pannable = nat != null && scale > fitScale(nat.w, nat.h) * 1.001;

    // React 给 onWheel 挂的是 passive 监听，preventDefault 无效——用原生监听接管滚轮缩放
    useEffect(() => {
        const el = stageRef.current;
        if (!el) return;
        const onWheel = (e: WheelEvent) => {
            e.preventDefault();
            setScale((s) => clampScale(s * Math.exp(-e.deltaY * 0.0015)));
        };
        el.addEventListener("wheel", onWheel, { passive: false });
        return () => el.removeEventListener("wheel", onWheel);
    }, []);

    // 早退必须让位于上面的 hooks（hooks 不得落在条件返回之后）；
    // 挂载方已保证 items[index] 存在，这里只是类型收窄的兜底
    if (!img) return null;

    function onKeyDown(e: React.KeyboardEvent) {
        // 查看器开着时按键全部先吃掉，不落到工具层
        e.stopPropagation();
        switch (e.key) {
            case "Escape":
                e.preventDefault();
                onClose();
                break;
            case "ArrowLeft":
                e.preventDefault();
                if (index > 0) onNav(index - 1); // 端点不环绕
                break;
            case "ArrowRight":
                e.preventDefault();
                if (index < items.length - 1) onNav(index + 1);
                break;
            case "+":
            case "=":
                setScale((s) => clampScale(s * 1.25));
                break;
            case "-":
                setScale((s) => clampScale(s / 1.25));
                break;
            case "2":
                fit();
                break;
            case "1":
                oneToOne();
                break;
        }
    }

    function onPointerDown(e: React.PointerEvent) {
        if (!pannable) return;
        panRef.current = { x: e.clientX, y: e.clientY };
        e.currentTarget.setPointerCapture(e.pointerId);
        setPanning(true);
    }
    function onPointerMove(e: React.PointerEvent) {
        const p = panRef.current;
        if (!p) return;
        setTx((v) => v + e.clientX - p.x);
        setTy((v) => v + e.clientY - p.y);
        panRef.current = { x: e.clientX, y: e.clientY };
    }
    function endPan() {
        panRef.current = null;
        setPanning(false);
    }

    function onDoubleClick() {
        if (!nat) return;
        // 双击在 适应 / 100% 之间切换
        if (Math.abs(scale - 1) < 0.01) fit();
        else oneToOne();
    }

    async function openWith() {
        const r = await api.galleryOpenImage(img.id);
        if (!r.ok) toast.error(t("toast.error"));
    }
    async function reveal() {
        const r = await api.galleryRevealImage(img.id);
        if (!r.ok) toast.error(t("toast.error"));
    }

    // 复制原图：协议开了 supportFetchAPI 才能这样拉字节；经 canvas 转 PNG 规避
    // 剪贴板对源格式/EXIF 方向的挑剔（createImageBitmap 顺手摆正方向）
    async function copyImage() {
        try {
            const blob = await (await fetch(`mpimg://orig/${img.id}`)).blob();
            const bmp = await createImageBitmap(blob, { imageOrientation: "from-image" });
            const canvas = document.createElement("canvas");
            canvas.width = bmp.width;
            canvas.height = bmp.height;
            canvas.getContext("2d")?.drawImage(bmp, 0, 0);
            bmp.close();
            const png = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/png"));
            if (!png) throw new Error("toBlob");
            await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
            toast.success(t("gallery.view.copied"));
        } catch {
            toast.error(t("gallery.view.copyFailed"));
        }
    }

    const g = groups.find((x) => x.id === img.groupId);
    const groupName = g ? (g.inbox ? t("gallery.inbox") : g.name) : "—";
    const infoRows: [string, string][] = [
        [t("gallery.info.name"), img.title],
        [t("gallery.info.size"), img.width > 0 ? `${img.width}×${img.height}` : "—"],
        [t("gallery.info.bytes"), fmtBytes(img.bytes)],
        [t("gallery.info.format"), img.format],
        [t("gallery.info.group"), groupName],
        [t("gallery.info.tags"), img.tags.length > 0 ? img.tags.join(" / ") : "—"],
        [t("gallery.info.time"), fmtDateTime(img.createdAt)],
        [t("gallery.info.path"), img.sourcePath || "—"],
    ];

    // 控制条按钮：ActionBarButton 图标态 + Tooltip，密度保持原 28px。
    // ActionBar 自带通栏 transport 材质与 34px 控件高，用 className 覆写回药丸：
    // 尺寸/圆角/悬停填充走工具类与令牌，选中态用库令牌，不新增颜色字面值。
    const actionButton = {
        plain: true,
        activeTint: "var(--control-selection)",
        className:
            "size-7 min-w-0 rounded-md! text-muted-foreground enabled:hover:text-foreground enabled:hover:not-data-active:bg-(--state-hover-control)! enabled:active:not-data-active:bg-(--state-pressed)! data-active:text-(--state-selected-foreground) data-active:shadow-sunken! disabled:opacity-(--state-disabled-opacity) [&_svg]:size-4",
    } as const;
    const textButtonClass = `${actionButton.className} text-[10.5px] font-normal`;

    return (
        <div
            ref={rootRef}
            tabIndex={-1}
            onKeyDown={onKeyDown}
            className="fixed inset-0 z-40 flex flex-col bg-black/90 outline-none"
        >
            <div className="relative min-h-0 flex-1">
                {/* 顶条：文件名 + 序号 */}
                <div className="pointer-events-none absolute left-1/2 top-3 max-w-[80%] -translate-x-1/2 truncate text-[12px] text-white/70">
                    {img.title} ({index + 1}/{items.length})
                </div>

                {/* 信息浮层：主题面板材质（表面/文字/边框随深浅主题） */}
                {info && (
                    <div className="absolute right-3 top-3 flex max-h-[calc(100%-1.5rem)] w-72 flex-col gap-1.5 overflow-auto rounded-md border border-border bg-panel p-3 text-[11.5px] text-foreground shadow-[var(--shadow-toast)]">
                        {infoRows.map(([k, v]) => (
                            <div key={k} className="flex gap-2">
                                <span className="w-16 flex-none text-dim-foreground">{k}</span>
                                <span className="min-w-0 flex-1 break-all">{v}</span>
                            </div>
                        ))}
                    </div>
                )}

                {/* 图台：滚轮缩放 / 拖拽平移 / 双击切换适应与 1:1。
                    select-none 不可省：按下拖拽一旦命中可选中内容，Chromium 会启动
                    原生选区拖拽并对已捕获指针补发 pointercancel，平移手势半途夭折
                    （曾表现为「拖到图片外就拖不动、回来也拖不动」） */}
                <div
                    ref={stageRef}
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={endPan}
                    onPointerCancel={endPan}
                    onDoubleClick={onDoubleClick}
                    className={`flex h-full w-full select-none items-center justify-center overflow-hidden ${
                        panning ? "cursor-grabbing" : pannable ? "cursor-grab" : "cursor-default"
                    }`}
                >
                    {failed ? (
                        <span className="text-[12.5px] text-white/60">{t("gallery.view.loadFail")}</span>
                    ) : (
                        <img
                            key={img.id}
                            src={`mpimg://orig/${img.id}`}
                            alt={img.title}
                            draggable={false}
                            onLoad={(e) => {
                                const w = e.currentTarget.naturalWidth;
                                const h = e.currentTarget.naturalHeight;
                                setNat({ w, h });
                                setScale(fitScale(w, h));
                                setTx(0);
                                setTy(0);
                            }}
                            onError={() => setFailed(true)}
                            className="flex-none max-w-none select-none"
                            style={{
                                // 尺寸全权由 transform 相对自然尺寸换算（scale 以自然像素为 1），
                                // 两个缺一不可的类：max-w-none 压掉 Tailwind preflight 的
                                // img{max-width:100%;height:auto}（它把布局盒先压进舞台，
                                // transform 再缩一次 = 双缩放，曾表现为「打开缩成窗口的
                                // 1/4、按 1 反而像适应」）；flex-none 挡 flex 子项的默认
                                // flex-shrink（同性质的双缩放源）。首帧隐藏到量出自然尺寸、
                                // 算好 fit 再显示，消灭「先 1:1 再缩放」闪烁。
                                visibility: nat ? "visible" : "hidden",
                                transform: `translate(${tx}px, ${ty}px) scale(${scale}) rotate(${rot}deg)`,
                            }}
                        />
                    )}
                </div>
            </div>

            {/* 底部工具条：ActionBar 药丸形态（className 覆写回 panel 材质、小圆角与 28px 图标按钮） */}
            <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2">
                <ActionBar className="pointer-events-auto flex-nowrap gap-0.5! rounded-md border border-border bg-panel! bg-none! p-(--space-xs)! shadow-[var(--shadow-toast)]!">
                    <ActionBarGroup className="gap-0.5 overflow-visible rounded-md bg-transparent">
                        <TipActionButton
                            {...actionButton}
                            label={t("common.close")}
                            aria-label={t("common.close")}
                            onClick={onClose}
                        >
                            <X />
                        </TipActionButton>
                        <TipActionButton
                            {...actionButton}
                            label={t("gallery.view.prev")}
                            aria-label={t("gallery.view.prev")}
                            disabled={index === 0}
                            onClick={() => onNav(index - 1)}
                        >
                            <ChevronLeft />
                        </TipActionButton>
                        <TipActionButton
                            {...actionButton}
                            label={t("gallery.view.next")}
                            aria-label={t("gallery.view.next")}
                            disabled={index === items.length - 1}
                            onClick={() => onNav(index + 1)}
                        >
                            <ChevronRight />
                        </TipActionButton>
                    </ActionBarGroup>
                    <ActionBarSeparator className="mx-0.5! h-4! border-sidebar-border!" />
                    <ActionBarGroup className="gap-0.5 overflow-visible rounded-md bg-transparent">
                        <TipActionButton
                            {...actionButton}
                            label={t("gallery.view.zoomOut")}
                            aria-label={t("gallery.view.zoomOut")}
                            onClick={() => setScale((s) => clampScale(s / 1.25))}
                        >
                            <ZoomOut />
                        </TipActionButton>
                        <TipActionButton
                            {...actionButton}
                            label={t("gallery.view.zoomIn")}
                            aria-label={t("gallery.view.zoomIn")}
                            onClick={() => setScale((s) => clampScale(s * 1.25))}
                        >
                            <ZoomIn />
                        </TipActionButton>
                        <TipActionButton
                            {...actionButton}
                            label={t("gallery.view.fit")}
                            aria-label={t("gallery.view.fit")}
                            onClick={fit}
                        >
                            <Maximize />
                        </TipActionButton>
                        <TipActionButton {...actionButton} label="1:1" className={textButtonClass} onClick={oneToOne}>
                            1:1
                        </TipActionButton>
                        <TipActionButton
                            {...actionButton}
                            label={t("gallery.view.rotate")}
                            aria-label={t("gallery.view.rotate")}
                            onClick={() => setRot((r) => (r + 90) % 360)}
                        >
                            <RotateCw />
                        </TipActionButton>
                    </ActionBarGroup>
                    <ActionBarSeparator className="mx-0.5! h-4! border-sidebar-border!" />
                    <ActionBarGroup className="gap-0.5 overflow-visible rounded-md bg-transparent">
                        <TipActionButton
                            {...actionButton}
                            active={info}
                            label={t("gallery.view.info")}
                            aria-label={t("gallery.view.info")}
                            onClick={() => setInfo((v) => !v)}
                        >
                            <Info />
                        </TipActionButton>
                        <TipActionButton
                            {...actionButton}
                            label={t("gallery.view.copy")}
                            aria-label={t("gallery.view.copy")}
                            onClick={() => void copyImage()}
                        >
                            <Copy />
                        </TipActionButton>
                        <TipActionButton
                            {...actionButton}
                            label={t("gallery.view.openWith")}
                            aria-label={t("gallery.view.openWith")}
                            onClick={() => void openWith()}
                        >
                            <ExternalLink />
                        </TipActionButton>
                        <TipActionButton
                            {...actionButton}
                            label={t("gallery.view.reveal")}
                            aria-label={t("gallery.view.reveal")}
                            onClick={() => void reveal()}
                        >
                            <FolderOpen />
                        </TipActionButton>
                        <TipActionButton
                            {...actionButton}
                            label={t("gallery.view.tags")}
                            aria-label={t("gallery.view.tags")}
                            onClick={() => onEditTags(img)}
                        >
                            <Tag />
                        </TipActionButton>
                        {onDelete && (
                            <TipActionButton
                                {...actionButton}
                                label={t("gallery.view.delete")}
                                aria-label={t("gallery.view.delete")}
                                className={`${actionButton.className} enabled:hover:text-destructive`}
                                onClick={() => onDelete(img)}
                            >
                                <Trash2 />
                            </TipActionButton>
                        )}
                    </ActionBarGroup>
                </ActionBar>
            </div>
        </div>
    );
}
