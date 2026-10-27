import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Maximize, Minimize, Pause, Play, X } from "lucide-react";
import { ActionBar, ActionBarGroup, ActionBarSeparator } from "@/components/ui/action-bar";
import { Empty, EmptyDescription } from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { api, type GalleryImage } from "@/api/client";
import { useI18n } from "@/i18n/useI18n";
import { TipActionButton } from "../TipButton";

type Props = {
    /** 解锁密码：画廊快照按解锁视角取（锁定视角自动剔除私密图，与侧栏计数同一边界） */
    password?: string;
    onClose: () => void;
};

// 画廊放映：打开时按加入顺序（position 序）拉全画廊；整页翻（全格同步）、末页回卷循环。
// 间隔档位含「手动」（不自动推进，纯 ←→/按钮翻页）；手动翻页即自动暂停。
// 布局与间隔记 localStorage（TOOL_SPEC §5）。单张/多格同一舞台：object-contain 纯适应显示，
// 不复用 Viewer——放映的图会自动跳走，缩放/平移的价值存不住，两个场景不互相污染。

const LS_KEY = "mypage-gallery-slideshow";
const PAGE = 200; // 拉全画廊的分页步长（= 后端单次上限）
const HIDE_MS = 3000; // 控制条闲置隐藏

type LayoutId = "1x1" | "1x2" | "1x3" | "2x2" | "2x3";
type IntervalMs = 0 | 3000 | 5000 | 10000 | 20000; // 0 = 手动档
type Prefs = { layout: LayoutId; ms: IntervalMs };

const LAYOUTS: readonly { id: LayoutId; rows: number; cols: number }[] = [
    { id: "1x1", rows: 1, cols: 1 },
    { id: "1x2", rows: 1, cols: 2 },
    { id: "1x3", rows: 1, cols: 3 },
    { id: "2x2", rows: 2, cols: 2 },
    { id: "2x3", rows: 2, cols: 3 },
];
const INTERVALS: readonly IntervalMs[] = [0, 3000, 5000, 10000, 20000];
const DEFAULT_PREFS: Prefs = { layout: "1x1", ms: 5000 };

function loadPrefs(): Prefs {
    try {
        const v = JSON.parse(localStorage.getItem(LS_KEY) ?? "") as Partial<Prefs>;
        const layout = LAYOUTS.some((l) => l.id === v.layout) ? (v.layout as LayoutId) : DEFAULT_PREFS.layout;
        const ms = INTERVALS.includes(v.ms as IntervalMs) ? (v.ms as IntervalMs) : DEFAULT_PREFS.ms;
        return { layout, ms };
    } catch {
        return DEFAULT_PREFS;
    }
}

/** 单格：适应显示；挂了的格不裂版，退成文件名占位 */
function Cell({ img }: { img: GalleryImage }) {
    const [failed, setFailed] = useState(false);
    if (failed) {
        return (
            <div className="flex h-full w-full items-center justify-center px-2">
                <span className="w-full truncate text-center text-[11px] text-white/40">{img.title}</span>
            </div>
        );
    }
    return (
        <img
            src={`mpimg://orig/${img.id}`}
            alt={img.title}
            draggable={false}
            onError={() => setFailed(true)}
            className="h-full w-full object-contain"
        />
    );
}

export function Slideshow({ password, onClose }: Props) {
    const { t } = useI18n();
    const rootRef = useRef<HTMLDivElement>(null);

    const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
    const layout = LAYOUTS.find((l) => l.id === prefs.layout) ?? LAYOUTS[0];
    const pageSize = layout.rows * layout.cols;

    const [items, setItems] = useState<GalleryImage[] | null>(null); // null = 加载中
    const [status, setStatus] = useState<"loading" | "done" | "error">("loading");
    const [cursor, setCursor] = useState(0); // 当前页首图下标；切布局按图进度对齐续播（不回开头）
    const [playing, setPlaying] = useState(prefs.ms !== 0); // 开场按记忆档位：手动档停着
    const [fs, setFs] = useState(false);
    const [uiVisible, setUiVisible] = useState(true);
    const hideTimer = useRef<number | undefined>(undefined);

    // 打开即拉全画廊（sort=time 在画廊视图 = position 加入顺序，见 server/gallery.ts）。
    // 快照语义：放映期间画廊变更不跟随，重开再取
    useEffect(() => {
        let stop = false;
        void (async () => {
            const all: GalleryImage[] = [];
            for (;;) {
                const r = await api.galleryImages({
                    group: "wall",
                    tags: [],
                    search: "",
                    sort: "time",
                    limit: PAGE,
                    offset: all.length,
                    password,
                });
                if (stop) return;
                if (!r.ok) {
                    setStatus("error");
                    return;
                }
                all.push(...r.data.items);
                if (all.length >= r.data.total || r.data.items.length === 0) break;
            }
            setItems(all);
            setStatus("done");
        })();
        return () => {
            stop = true;
        };
    }, [password]);

    // 挂载即抢焦点：按键落在覆盖层内被吃掉（stopPropagation 后不冒到工具的 document 监听）
    useEffect(() => {
        rootRef.current?.focus();
    }, []);

    // 控制条闲置自动隐藏：一动即浮现；隐藏时连光标一起藏（纯放映观感）
    function bumpUi() {
        setUiVisible(true);
        window.clearTimeout(hideTimer.current);
        hideTimer.current = window.setTimeout(() => setUiVisible(false), HIDE_MS);
    }
    useEffect(() => {
        bumpUi();
        return () => window.clearTimeout(hideTimer.current);
    }, []);

    // 游标 → 当前页：cursor 对齐到新 pageSize 的页首（切布局时进度所在页继续）
    const lastStart = items ? Math.max(0, (Math.ceil(items.length / pageSize) - 1) * pageSize) : 0;
    const start = Math.min(cursor - (cursor % pageSize), lastStart);
    const cells = items ? items.slice(start, start + pageSize) : [];

    function nextPage() {
        setCursor(start + pageSize > lastStart ? 0 : start + pageSize);
    }
    function prevPage() {
        setCursor(start === 0 ? lastStart : Math.max(0, start - pageSize));
    }
    /** 手动翻页：即自动暂停（用户接管节奏） */
    function go(dir: 1 | -1) {
        setPlaying(false);
        if (dir === 1) nextPage();
        else prevPage();
    }

    // 自动推进：依赖带 start，每次翻页重建定时器 = 每页整段间隔，无累积漂移
    useEffect(() => {
        if (!playing || prefs.ms === 0 || items == null) return;
        const timer = window.setInterval(() => nextPage(), prefs.ms);
        return () => window.clearInterval(timer);
    }, [playing, prefs.ms, items, start]);

    function updatePrefs(p: Prefs) {
        setPrefs(p);
        try {
            localStorage.setItem(LS_KEY, JSON.stringify(p));
        } catch {
            /* 记不住就用默认，不挡放映 */
        }
    }
    function switchLayout(id: LayoutId) {
        updatePrefs({ ...prefs, layout: id });
    }
    function switchInterval(ms: IntervalMs) {
        updatePrefs({ ...prefs, ms });
        setPlaying(ms !== 0); // 选自动档即开走；选手动 = 停住（播放键随之置灰）
    }

    // 全屏：Esc 在全屏时先被浏览器用于退全屏（到不了这里），再按才退出放映——标准两段式
    function toggleFs() {
        if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
        else void document.documentElement.requestFullscreen().catch(() => {});
    }
    useEffect(() => {
        const h = () => setFs(!!document.fullscreenElement);
        document.addEventListener("fullscreenchange", h);
        return () => document.removeEventListener("fullscreenchange", h);
    }, []);

    function onKeyDown(e: React.KeyboardEvent) {
        e.stopPropagation();
        switch (e.key) {
            case "Escape":
                e.preventDefault();
                onClose();
                break;
            case " ":
                e.preventDefault(); // 防止聚焦中的控制按钮被空格重复触发
                if (prefs.ms !== 0) setPlaying((p) => !p);
                break;
            case "ArrowLeft":
                e.preventDefault();
                go(-1);
                break;
            case "ArrowRight":
                e.preventDefault();
                go(1);
                break;
            case "f":
            case "F":
                toggleFs();
                break;
        }
    }

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
    const ready = status === "done" && items != null && items.length > 0;

    return (
        <div
            ref={rootRef}
            tabIndex={-1}
            onKeyDown={onKeyDown}
            onMouseMove={bumpUi}
            className={`fixed inset-0 z-40 select-none bg-black outline-none ${uiVisible ? "" : "cursor-none"}`}
        >
            {/* 舞台 */}
            <div className="h-full w-full p-1">
                {status === "loading" && (
                    <div className="flex h-full w-full items-center justify-center text-white/50">
                        <Spinner label={t("common.loading")} />
                    </div>
                )}
                {status === "error" && (
                    <Empty className="h-full w-full justify-center">
                        <EmptyDescription className="text-[12.5px] text-white/50">
                            {t("gallery.slide.loadFail")}
                        </EmptyDescription>
                    </Empty>
                )}
                {status === "done" && items != null && items.length === 0 && (
                    <Empty className="h-full w-full justify-center">
                        <EmptyDescription className="text-[12.5px] text-white/50">
                            {t("gallery.slide.empty")}
                        </EmptyDescription>
                    </Empty>
                )}
                {ready && (
                    <div
                        className="grid h-full w-full gap-1"
                        style={{
                            gridTemplateColumns: `repeat(${layout.cols}, minmax(0, 1fr))`,
                            gridTemplateRows: `repeat(${layout.rows}, minmax(0, 1fr))`,
                        }}
                    >
                        {cells.map((img) => (
                            <Cell key={img.id} img={img} />
                        ))}
                    </div>
                )}
            </div>

            {/* 页码指示（随控制条一起淡出淡入） */}
            {ready && (
                <div
                    className={`pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 text-[12px] tabular-nums text-white/50 transition-opacity ${
                        uiVisible ? "opacity-100" : "opacity-0"
                    }`}
                >
                    {start + 1}–{start + cells.length}/{items!.length}
                </div>
            )}

            {/* 底部控制条：ActionBar 药丸形态（className 覆写回 panel 材质、小圆角与 28px 图标按钮） */}
            <div
                className={`absolute bottom-3 left-1/2 -translate-x-1/2 transition-opacity ${
                    uiVisible ? "opacity-100" : "pointer-events-none opacity-0"
                }`}
            >
                <ActionBar className="flex-nowrap gap-0.5! rounded-md border border-border bg-panel! bg-none! p-(--space-xs)! shadow-[var(--shadow-toast)]!">
                    <TipActionButton
                        {...actionButton}
                        label={t("common.close")}
                        aria-label={t("common.close")}
                        onClick={onClose}
                    >
                        <X />
                    </TipActionButton>
                    <ActionBarSeparator className="mx-0.5! h-4! border-sidebar-border!" />
                    <ActionBarGroup className="gap-0.5 overflow-visible rounded-md bg-transparent">
                        <TipActionButton
                            {...actionButton}
                            label={t("gallery.slide.prevPage")}
                            aria-label={t("gallery.slide.prevPage")}
                            onClick={() => go(-1)}
                        >
                            <ChevronLeft />
                        </TipActionButton>
                        <TipActionButton
                            {...actionButton}
                            label={playing ? t("gallery.slide.pause") : t("gallery.slide.play")}
                            aria-label={playing ? t("gallery.slide.pause") : t("gallery.slide.play")}
                            disabled={prefs.ms === 0}
                            onClick={() => setPlaying((p) => !p)}
                        >
                            {playing ? <Pause /> : <Play />}
                        </TipActionButton>
                        <TipActionButton
                            {...actionButton}
                            label={t("gallery.slide.nextPage")}
                            aria-label={t("gallery.slide.nextPage")}
                            onClick={() => go(1)}
                        >
                            <ChevronRight />
                        </TipActionButton>
                    </ActionBarGroup>
                    <ActionBarSeparator className="mx-0.5! h-4! border-sidebar-border!" />
                    <ActionBarGroup className="gap-0.5 overflow-visible rounded-md bg-transparent">
                        {LAYOUTS.map((l) => (
                            <TipActionButton
                                key={l.id}
                                {...actionButton}
                                active={prefs.layout === l.id}
                                label={t("gallery.slide.layout")}
                                className={textButtonClass}
                                onClick={() => switchLayout(l.id)}
                            >
                                {l.id.replace("x", "×")}
                            </TipActionButton>
                        ))}
                    </ActionBarGroup>
                    <ActionBarSeparator className="mx-0.5! h-4! border-sidebar-border!" />
                    <ActionBarGroup className="gap-0.5 overflow-visible rounded-md bg-transparent">
                        {INTERVALS.map((ms) => (
                            <TipActionButton
                                key={ms}
                                {...actionButton}
                                active={prefs.ms === ms}
                                label={t("gallery.slide.interval")}
                                className={textButtonClass}
                                onClick={() => switchInterval(ms)}
                            >
                                {ms === 0 ? t("gallery.slide.manual") : `${ms / 1000}s`}
                            </TipActionButton>
                        ))}
                    </ActionBarGroup>
                    <ActionBarSeparator className="mx-0.5! h-4! border-sidebar-border!" />
                    <TipActionButton
                        {...actionButton}
                        label={fs ? t("gallery.slide.exitFullscreen") : t("gallery.slide.fullscreen")}
                        aria-label={fs ? t("gallery.slide.exitFullscreen") : t("gallery.slide.fullscreen")}
                        onClick={toggleFs}
                    >
                        {fs ? <Minimize /> : <Maximize />}
                    </TipActionButton>
                </ActionBar>
            </div>
        </div>
    );
}
