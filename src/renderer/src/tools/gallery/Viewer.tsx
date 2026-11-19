import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
    ChevronLeft,
    ChevronRight,
    Copy,
    ExternalLink,
    FolderOpen,
    Info,
    Maximize,
    MoreHorizontal,
    RotateCw,
    Star,
    Tag,
    Trash2,
    X,
    ZoomIn,
    ZoomOut,
} from "lucide-react";
import { toast } from "sonner";
import { ActionBar, ActionBarGroup, ActionBarSeparator } from "@/components/ui/action-bar";
import { MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
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
    /** 保存当前图片的指定收藏状态。 */
    onSetFavorite: (img: GalleryImage, favorite: boolean) => void;
    onEditTags: (img: GalleryImage) => void;
    /** 由父组件确认删除、更新列表和切换相邻图片。 */
    onDelete: (img: GalleryImage) => void;
};

const MIN_SCALE = 0.05;
const MAX_SCALE = 20;
const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

// 大图查看器挂到窗口根层，盖住停靠区、左侧栏和顶栏，同时给标签和删除确认弹窗留出更高层。
// transform = translate(px,py) scale(s) rotate(deg)：translate 在 scale 之前，
// 平移量直接用屏幕像素，不用除以缩放。缩放一律以画面中心为锚。
export function Viewer({ items, index, groups, onNav, onClose, onSetFavorite, onEditTags, onDelete }: Props) {
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

    // 在缓存图片的加载事件前复位，避免清掉新图刚测出的尺寸。
    useLayoutEffect(() => {
        setNat(null);
        setFailed(false);
        setRot(0);
        setTx(0);
        setTy(0);
        setScale(1);
    }, [img?.id]);

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
        if (e.defaultPrevented || (e.target as HTMLElement).closest('[role="menu"]')) return;
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
            case "ArrowUp":
            case "ArrowDown":
                if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) break;
                e.preventDefault();
                // 长按取消收藏时，翻到相邻图片后必须重新按键才能继续取消。
                if (!e.repeat) onSetFavorite(img, e.key === "ArrowUp");
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
    const groupName = g?.name ?? "—";
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

    return createPortal(
        <div
            ref={rootRef}
            tabIndex={-1}
            onKeyDown={onKeyDown}
            className="app-no-drag fixed inset-0 z-40 flex flex-col bg-black/90 outline-none"
        >
            <div className="relative min-h-0 flex-1">
                {/* 标题和关闭按钮常驻图台上层，原图铺满时仍然可见。 */}
                <div className="pointer-events-none absolute inset-x-3 top-3 z-10 flex items-start justify-center px-10">
                    <div className="flex min-w-0 items-center gap-2 rounded-md border border-border bg-panel px-3 py-1.5 text-xs shadow-overlay">
                        <span className="truncate text-foreground">{img.title}</span>
                        <span className="flex-none font-mono text-muted-foreground">
                            {index + 1}/{items.length}
                        </span>
                    </div>
                    <TipActionButton
                        {...actionButton}
                        className={`${actionButton.className} pointer-events-auto absolute right-0 top-0 border border-border bg-panel shadow-overlay`}
                        label={t("common.close")}
                        aria-label={t("common.close")}
                        onClick={onClose}
                    >
                        <X />
                    </TipActionButton>
                </div>

                {/* 信息浮层：主题面板材质（表面/文字/边框随深浅主题） */}
                {info && (
                    <div className="absolute right-3 top-12 z-10 flex max-h-[calc(100%-7rem)] w-72 flex-col gap-1.5 overflow-auto rounded-md border border-border bg-panel p-3 text-[11.5px] text-foreground shadow-overlay">
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
                    className={`relative z-0 flex h-full w-full select-none items-center justify-center overflow-hidden ${
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
            <div className="pointer-events-none absolute bottom-3 left-1/2 z-10 -translate-x-1/2">
                <ActionBar className="pointer-events-auto flex-nowrap gap-0.5! rounded-md border border-border bg-panel! bg-none! p-(--space-xs)! shadow-[var(--shadow-toast)]!">
                    <ActionBarGroup className="gap-0.5 overflow-visible rounded-md bg-transparent">
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
                    </ActionBarGroup>
                    <ActionBarSeparator className="mx-0.5! h-4! border-sidebar-border!" />
                    <ActionBarGroup className="gap-0.5 overflow-visible rounded-md bg-transparent">
                        <TipActionButton
                            {...actionButton}
                            active={img.favorite}
                            aria-label={t("gallery.favorite.action")}
                            aria-pressed={img.favorite}
                            label={t("gallery.favorite.shortcuts")}
                            onClick={() => onSetFavorite(img, !img.favorite)}
                        >
                            <Star className={img.favorite ? "fill-current text-yellow-400" : undefined} />
                        </TipActionButton>
                        <TipActionButton
                            {...actionButton}
                            active={info}
                            label={t("gallery.view.info")}
                            aria-label={t("gallery.view.info")}
                            onClick={() => setInfo((v) => !v)}
                        >
                            <Info />
                        </TipActionButton>
                    </ActionBarGroup>
                    <ActionBarSeparator className="mx-0.5! h-4! border-sidebar-border!" />
                    <MenuTrigger align="end">
                        <TipActionButton
                            {...actionButton}
                            label={t("gallery.view.more")}
                            aria-label={t("gallery.view.more")}
                        >
                            <MoreHorizontal />
                        </TipActionButton>
                        <MenuContent className="app-no-drag">
                            <MenuItem onSelect={() => setRot((r) => (r + 90) % 360)}>
                                <RotateCw />
                                {t("gallery.view.rotate")}
                            </MenuItem>
                            <MenuItem onSelect={() => void copyImage()}>
                                <Copy />
                                {t("gallery.view.copy")}
                            </MenuItem>
                            <MenuItem onSelect={() => void openWith()}>
                                <ExternalLink />
                                {t("gallery.view.openWith")}
                            </MenuItem>
                            <MenuItem onSelect={() => void reveal()}>
                                <FolderOpen />
                                {t("gallery.view.reveal")}
                            </MenuItem>
                            <MenuItem onSelect={() => onEditTags(img)}>
                                <Tag />
                                {t("gallery.view.tags")}
                            </MenuItem>
                            <MenuSeparator />
                            <MenuItem className="text-destructive" onSelect={() => onDelete(img)}>
                                <Trash2 />
                                {t("gallery.view.delete")}
                            </MenuItem>
                        </MenuContent>
                    </MenuTrigger>
                </ActionBar>
            </div>
        </div>,
        document.body,
    );
}
