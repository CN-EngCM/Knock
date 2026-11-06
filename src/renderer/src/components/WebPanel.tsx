import { createElement, useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, ExternalLink, RotateCw, X } from "lucide-react";
import { toast } from "sonner";
import type { IDockviewPanelProps } from "@/components/ui/dock-layout";
import { Empty, EmptyDescription, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Scopebar } from "@/components/ui/toolbar";
import { Button } from "@/components/ui/button";
import { TipButton } from "@/tools/TipButton";
import { useI18n } from "@/i18n/useI18n";
import { normalizeUrl } from "@/lib/webUrl";

// ── 网页面板：一块 <webview> 加一条简易工具栏 ──
// 面板 id 是 web:<号>，可多开，由 App 的 openWeb 创建；创建时带 renderer: "always"，
// 内容画在 dockview 的覆盖层上、拖拽分屏时不被搬动，网页不会因此重载。
// 不带 url 的是「浏览器」工具开的空白页：先显示提示，在地址栏输入网址后才创建 <webview>。
// 分区、权限与 UA 全在主进程定死（main/webView.ts），这里不传分区，也不碰安全配置。

type WebParams = { url?: string };

export default function WebPanel({ api, params }: IDockviewPanelProps) {
    const { t } = useI18n();
    const wvRef = useRef<Electron.WebviewTag | null>(null);
    const addressRef = useRef<HTMLInputElement>(null);
    // <webview> 的初始地址；null 表示还没输入过网址。此后的跳转直接改元素的 src，不再动这个状态
    const [startUrl, setStartUrl] = useState<string | null>((params as WebParams).url ?? null);
    const [current, setCurrent] = useState(startUrl ?? "");
    const [address, setAddress] = useState(startUrl ?? "");
    // 正在编辑地址栏时，页面跳转不能把用户打的字覆盖掉
    const editing = useRef(false);
    const [loading, setLoading] = useState(false);
    const [ready, setReady] = useState(false);
    const [canBack, setCanBack] = useState(false);
    const [canForward, setCanForward] = useState(false);
    const [fail, setFail] = useState<{ desc: string } | null>(null);

    // 空白页先让焦点进地址栏。等一帧再聚焦：从工具集菜单打开时，菜单关闭会把焦点还给它的按钮，
    // 马上聚焦会被抢回去（便签用的是同一个办法）
    useEffect(() => {
        if (startUrl !== null) return;
        const frame = requestAnimationFrame(() => addressRef.current?.focus());
        return () => cancelAnimationFrame(frame);
        // 只在面板挂载时聚焦一次
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        const wv = wvRef.current;
        if (startUrl === null || !wv) return;

        // 前进后退状态只有 dom-ready 之后才能问，早问会抛错
        const syncHistory = () => {
            try {
                setCanBack(wv.canGoBack());
                setCanForward(wv.canGoForward());
            } catch {
                /* 还没 dom-ready */
            }
        };
        const showUrl = (url: string) => {
            setCurrent(url);
            if (!editing.current) setAddress(url);
            syncHistory();
        };
        const on: Record<string, (e: Event) => void> = {
            "dom-ready": () => {
                setReady(true);
                syncHistory();
            },
            "did-start-loading": () => {
                setLoading(true);
                setFail(null);
            },
            "did-stop-loading": () => {
                setLoading(false);
                syncHistory();
            },
            "did-navigate": (e) => showUrl((e as Electron.DidNavigateEvent).url),
            // 单页应用内部换页走这个事件，iframe 的跳转不算
            "did-navigate-in-page": (e) => {
                const ev = e as Electron.DidNavigateInPageEvent;
                if (ev.isMainFrame) showUrl(ev.url);
            },
            "page-title-updated": (e) => {
                const title = (e as Electron.PageTitleUpdatedEvent).title;
                if (title) api.setTitle(title);
            },
            // -3 是被新导航打断，不算失败。失败的导航不触发 did-navigate，
            // 地址要在这里同步成失败的那个网址，「重试」和「在系统浏览器打开」才对得上
            "did-fail-load": (e) => {
                const ev = e as Electron.DidFailLoadEvent;
                if (!ev.isMainFrame || ev.errorCode === -3) return;
                if (ev.validatedURL) showUrl(ev.validatedURL);
                setFail({ desc: ev.errorDescription });
            },
        };
        for (const [name, fn] of Object.entries(on)) wv.addEventListener(name, fn);
        return () => {
            for (const [name, fn] of Object.entries(on)) wv.removeEventListener(name, fn);
        };
    }, [startUrl, api]);

    function go(url: string) {
        setFail(null);
        if (startUrl === null) {
            setStartUrl(url);
            setCurrent(url);
        } else if (wvRef.current) {
            // 改 src 属性即导航，不要求 dom-ready；loadURL 要求
            wvRef.current.src = url;
        }
        setAddress(url);
    }

    function submit(event: FormEvent) {
        event.preventDefault();
        const url = normalizeUrl(address);
        if (!url) {
            toast.error(t("web.invalidUrl"));
            return;
        }
        editing.current = false;
        go(url);
    }

    function openExternal() {
        if (!current) return;
        window.open(current, "_blank", "noreferrer");
        window.knock.hideWindow();
    }

    return (
        <div className="flex h-full min-h-0 flex-col">
            {/* 用 Scopebar 而不是 Toolbar：Toolbar 自带 gan-drag（上游给窗口标题栏用的拖拽区），地址栏和按钮
                点击到不了页面，双击还会放大整个窗口；Scopebar 是内容条、自带 gan-no-drag，
                和工作区工具栏（WorkspaceToolbar）是同一套写法 */}
            <Scopebar
                role="toolbar"
                aria-label={t("tool.browser.name")}
                className="h-9 flex-none gap-1 overflow-hidden px-2"
            >
                <TipButton
                    label={t("web.back")}
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-6 flex-none"
                    disabled={!ready || !canBack}
                    onClick={() => wvRef.current?.goBack()}
                    aria-label={t("web.back")}
                >
                    <ArrowLeft className="size-3.5" />
                </TipButton>
                <TipButton
                    label={t("web.forward")}
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-6 flex-none"
                    disabled={!ready || !canForward}
                    onClick={() => wvRef.current?.goForward()}
                    aria-label={t("web.forward")}
                >
                    <ArrowRight className="size-3.5" />
                </TipButton>
                <TipButton
                    label={loading ? t("web.stop") : t("web.reload")}
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-6 flex-none"
                    disabled={!ready}
                    onClick={() => (loading ? wvRef.current?.stop() : wvRef.current?.reload())}
                    aria-label={loading ? t("web.stop") : t("web.reload")}
                >
                    {loading ? <X className="size-3.5" /> : <RotateCw className="size-3.5" />}
                </TipButton>
                <form className="min-w-0 flex-1" onSubmit={submit}>
                    <Input
                        ref={addressRef}
                        value={address}
                        onChange={(e) => {
                            editing.current = true;
                            setAddress(e.target.value);
                        }}
                        onFocus={(e) => e.target.select()}
                        onBlur={() => {
                            // 不提交就离开：还原成当前网址，免得留着半截输入
                            editing.current = false;
                            setAddress(current);
                        }}
                        placeholder={t("web.addressPlaceholder")}
                        aria-label={t("web.address")}
                        spellCheck={false}
                        className="font-mono text-xs"
                    />
                </form>
                <TipButton
                    label={t("web.openExternal")}
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-6 flex-none"
                    disabled={!current}
                    onClick={openExternal}
                    aria-label={t("web.openExternal")}
                >
                    <ExternalLink className="size-3.5" />
                </TipButton>
            </Scopebar>
            <div className="relative min-h-0 flex-1">
                {startUrl === null ? (
                    <Empty className="py-10">
                        <EmptyDescription className="text-[12.5px]">{t("web.blankHint")}</EmptyDescription>
                    </Empty>
                ) : (
                    // 用 createElement 而不是 JSX：allowpopups 在 React 里必须传字符串，
                    // 而 @types/react 把它声明成布尔，JSX 过不了类型检查
                    createElement("webview", {
                        ref: wvRef,
                        src: startUrl,
                        allowpopups: "true",
                        className: "absolute inset-0",
                    })
                )}
                {/* 加载中的细进度线：没有真实进度，用 Progress 的不定态 */}
                {loading && <Progress className="absolute inset-x-0 top-0 z-10 h-0.5 rounded-none" />}
                {fail && (
                    <div className="absolute inset-0 z-20 bg-background">
                        <Empty className="px-6 py-10">
                            <EmptyTitle className="text-[13px]">{t("web.failTitle")}</EmptyTitle>
                            <EmptyDescription className="max-w-md break-all font-mono text-[12px]">
                                {current}
                            </EmptyDescription>
                            <EmptyDescription className="text-[11.5px] text-dim-foreground">
                                {fail.desc}
                            </EmptyDescription>
                            <div className="flex gap-2">
                                <Button
                                    type="button"
                                    appearance="standard"
                                    variant="primary"
                                    size="sm"
                                    onClick={() => wvRef.current?.reload()}
                                >
                                    {t("web.retry")}
                                </Button>
                                <Button
                                    type="button"
                                    appearance="standard"
                                    variant="outline"
                                    size="sm"
                                    onClick={openExternal}
                                >
                                    {t("web.openExternal")}
                                </Button>
                            </div>
                        </Empty>
                    </div>
                )}
            </div>
        </div>
    );
}
