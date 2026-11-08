import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { RefreshCw, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuSeparator,
    ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { Tree, type TreeNode } from "@/components/ui/tree";
import { api, type ApiError, type DirEntry } from "@/api/client";
import { fileIconUrl, folderIconUrl } from "@/lib/fileIcon";
import { sortEntries } from "@/lib/fileTree";
import { useI18n } from "@/i18n/useI18n";

const PANEL_WIDTH = 320;

type Props = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** 当前工作区；临时工作区或没有文件夹时为 null，此时面板什么都不画 */
    workspace: { id: number; folder: string } | null;
    /** 浅色主题：少数图标有专为浅底画的款式 */
    light: boolean;
    /** 定位基准：停靠区所在的内容容器，浮层贴它的左缘、与它同高 */
    anchorRef: RefObject<HTMLElement | null>;
    /** 顶栏工具栏上的入口按钮：「点外面收起」要放过它，否则点它关闭时会先收再开，闪一下 */
    toggleRef: RefObject<HTMLElement | null>;
    onOpenPath: (path: string) => void;
    onOpenFolderInTerminal: (path: string) => void;
    onChangeFolder: () => void;
};

type Status = { kind: "loading" } | { kind: "ready" } | { kind: "error"; error: ApiError };

/**
 * 工作区文件夹的文件树浮层：只读浏览，打开 / 定位 / 复制路径 / 在此开终端。
 * 常驻在 App 里（关闭只是不渲染内容），所以「每个工作区的展开状态」能在本次运行内留住；
 * 数据却不能指望 Tree 留住——浮层一关 Tree 就卸载了，它内部的懒加载缓存随之丢失，
 * 也没有刷新方法。所以每次打开或点刷新，由这里把根和所有已展开的目录重读一遍，
 * 拼成带 children 的节点交给 Tree，并换 key 让它重新挂载。
 */
export default function FileTreePanel({
    open,
    onOpenChange,
    workspace,
    light,
    anchorRef,
    toggleRef,
    onOpenPath,
    onOpenFolderInTerminal,
    onChangeFolder,
}: Props) {
    const { t } = useI18n();
    const [status, setStatus] = useState<Status>({ kind: "loading" });
    const [nodes, setNodes] = useState<TreeNode[]>([]);
    const [expanded, setExpanded] = useState<string[]>([]);
    // 换 key 让 Tree 重新挂载，清掉它内部的旧缓存
    const [treeKey, setTreeKey] = useState(0);
    const [reloadToken, setReloadToken] = useState(0);
    const [rect, setRect] = useState<{ top: number; left: number; height: number } | null>(null);
    // 各工作区的展开列表只放内存，不跨重启；记下文件夹是为了工作区改了文件夹后让它作废
    const memoryRef = useRef(new Map<number, { folder: string; ids: string[] }>());
    // 后台预读的第一层（原始列表，不建节点），按工作区存；每次打开读完后也会刷新它
    const warmRef = useRef(new Map<number, { folder: string; entries: DirEntry[] }>());
    // 点刷新是明确要看最新内容，不拿预读结果顶替；用一次就清掉
    const skipWarmRef = useRef(false);
    // 节点 id 就是路径；右键菜单和双击打开靠它找回条目
    const entriesRef = useRef(new Map<string, DirEntry>());
    // Tree 在 contextmenu 冒泡到外层菜单之前，已经同步把被右键的行设为活动行
    const activeIdRef = useRef<string | null>(null);
    const [menuEntry, setMenuEntry] = useState<DirEntry | null>(null);
    // 打开前的焦点元素，关闭时还回去
    const previousFocusRef = useRef<HTMLElement | null>(null);

    const workspaceId = workspace?.id ?? null;
    const folder = workspace?.folder ?? "";
    const visible = open && workspace !== null;

    // 贴着停靠区所在的内容区：位置取自它的实际矩形，不写死侧栏宽度和顶栏高度
    useLayoutEffect(() => {
        const anchor = anchorRef.current;
        if (!visible || !anchor) return;
        const sync = () => {
            const r = anchor.getBoundingClientRect();
            setRect({ top: r.top, left: r.left, height: r.height });
        };
        sync();
        const observer = new ResizeObserver(sync);
        observer.observe(anchor);
        window.addEventListener("resize", sync);
        return () => {
            observer.disconnect();
            window.removeEventListener("resize", sync);
        };
    }, [visible, anchorRef]);

    // 后台预读第一层：面板在空闲时就挂上了（见 App），趁用户还没点，先把工作区文件夹的第一层读到手。
    // 预读失败不提示：真正点开时会再读一次，那时才给出错误
    useEffect(() => {
        if (visible || workspaceId === null) return;
        if (warmRef.current.get(workspaceId)?.folder === folder) return;
        let cancelled = false;
        api.listDir(workspaceId, folder)
            .then((r) => {
                if (!cancelled && r.ok) warmRef.current.set(workspaceId, { folder, entries: r.data.entries });
            })
            .catch(() => {});
        return () => {
            cancelled = true;
        };
    }, [visible, workspaceId, folder]);

    // 打开、换工作区或文件夹、点刷新时整棵重读
    useEffect(() => {
        if (!visible || workspaceId === null) return;
        let cancelled = false;
        const remembered = memoryRef.current.get(workspaceId);
        const wantedIds = remembered?.folder === folder ? remembered.ids : [];
        // 预读过第一层、又没有要还原的展开状态时，先用预读结果立刻画出来，第一次点开不用等一轮读取；
        // 下面照常重读，读完发现内容有变化才替换（此刻用户几乎没来得及操作，换一下不碍事）
        const warm = warmRef.current.get(workspaceId);
        const useWarm = !skipWarmRef.current && warm?.folder === folder && wantedIds.length === 0;
        skipWarmRef.current = false;
        const warmEntries = new Map<string, DirEntry>();
        if (useWarm) {
            entriesRef.current = warmEntries;
            setNodes(sortEntries(warm.entries).map((entry) => toNode(entry, warmEntries, light)));
            setExpanded([]);
            setTreeKey((k) => k + 1);
            setStatus({ kind: "ready" });
        } else {
            setStatus({ kind: "loading" });
        }
        void (async () => {
            const alive: string[] = [];
            const fresh = new Map<string, DirEntry>();
            const root = await readLevel(workspaceId, folder, new Set(wantedIds), alive, fresh, light);
            if (cancelled) return;
            if (!root.ok) {
                warmRef.current.delete(workspaceId);
                setStatus({ kind: "error", error: root.error });
                return;
            }
            // 展开列表里读不到的目录（被删了、没权限）不在 alive 里，悄悄去掉
            memoryRef.current.set(workspaceId, { folder, ids: alive });
            warmRef.current.set(workspaceId, { folder, entries: root.listing });
            // 内容与预读的一样：界面已经是对的，不去动它——换节点要让树重新挂载，会丢掉焦点和滚动位置
            if (useWarm && sameEntries(warmEntries, fresh)) return;
            entriesRef.current = fresh;
            setNodes(root.nodes);
            setExpanded(alive);
            setTreeKey((k) => k + 1);
            setStatus({ kind: "ready" });
        })();
        return () => {
            cancelled = true;
        };
    }, [visible, workspaceId, folder, reloadToken, light]);

    // 趁树还没抢走焦点，先记下打开前焦点在哪（layout effect 先于下面的 effect 执行）
    useLayoutEffect(() => {
        if (visible)
            previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }, [visible]);

    // 树一挂载就把焦点交给它，方便直接用键盘上下选。不能靠「数据读完」这个状态去触发：
    // 有预读时数据比浮层先就绪，而浮层内容经 Portal 要晚一拍才挂上，那时树还不在 DOM 里。
    // 回调 ref 必须引用稳定，否则每次渲染都会重新聚焦；树重新挂载（刷新、读到变化）靠外层 div 的 key 触发
    const focusTree = useCallback((box: HTMLDivElement | null) => {
        box?.querySelector<HTMLElement>('[role="tree"]')?.focus({ preventScroll: true });
    }, []);

    // 窗口被藏起来时浮层一起收起。否则再次呼出时它还在，随即被呼出时聚焦搜索框的动作顶掉（点到浮层外），
    // 先露脸再滑走，体感很差。
    // 不能只把 open 置 false：普通关闭有滑出动画，窗口藏着时动画不走，要拖到下次呼出才补播，还是会闪。
    // 所以同时换 Sheet 的 key，让旧浮层当场卸载、没有退出动画
    const [sheetKey, setSheetKey] = useState(0);
    useEffect(() => {
        if (!visible) return;
        return window.knock.onWindowHidden(() => {
            setSheetKey((k) => k + 1);
            onOpenChange(false);
        });
    }, [visible, onOpenChange]);

    if (!workspace) return null;

    // 用户新展开的目录：按需读一层。抛出的错误由 Tree 显示成该行的「加载失败 + 重试」
    async function loadChildren(node: TreeNode): Promise<TreeNode[]> {
        const r = await api.listDir(workspace!.id, node.id);
        if (!r.ok) throw r.error;
        return sortEntries(r.data.entries).map((entry) => toNode(entry, entriesRef.current, light));
    }

    function refresh() {
        skipWarmRef.current = true;
        setReloadToken((n) => n + 1);
    }

    function handleExpandedChange(ids: string[]) {
        setExpanded(ids);
        memoryRef.current.set(workspace!.id, { folder: workspace!.folder, ids });
    }

    function handleActivate(node: TreeNode) {
        const entry = entriesRef.current.get(node.id);
        // Tree 把读完后是空的目录当叶子，双击会走到这里；目录不该被「打开」，直接忽略
        if (entry && !entry.isDir) onOpenPath(entry.path);
    }

    // 右键空白处不弹菜单；点在行上就取 Tree 刚刚设好的活动行
    function handleContextMenu(event: React.MouseEvent) {
        const onRow = (event.target as HTMLElement).closest('[role="treeitem"]');
        const entry = activeIdRef.current ? entriesRef.current.get(activeIdRef.current) : undefined;
        if (!onRow || !entry) {
            event.preventDefault();
            return;
        }
        setMenuEntry(entry);
    }

    async function reveal(path: string) {
        const r = await api.revealPath(path).catch(() => null);
        if (!r?.ok) toast.error(t("toast.error"));
    }

    async function copyPath(path: string) {
        const r = await api.clipboardWrite(path).catch(() => null);
        if (r?.ok) toast.success(t("ft.copied"));
        else toast.error(t("toast.error"));
    }

    const folderName =
        folder
            .replace(/[\\/]+$/, "")
            .split(/[\\/]/)
            .pop() || folder;

    return (
        <Sheet key={sheetKey} modal={false} open={visible} onOpenChange={onOpenChange}>
            {rect && (
                <SheetContent
                    side="left"
                    showCloseButton={false}
                    // 没有 SheetDescription；这个浮层只有标题，显式声明不挂描述，免得 Radix 在控制台报警
                    aria-describedby={undefined}
                    // 不抢焦点：等树读完后由上面的 effect 把焦点交给树
                    onOpenAutoFocus={(event) => event.preventDefault()}
                    // Radix 非模态对话框关闭时只会把焦点还给触发器（这里没有触发器），不会还给打开前的元素，
                    // 所以自己还：Esc 或点关闭按钮后焦点会落回 body，这时还给打开前的位置（比如正在输入的终端）；
                    // 点外面时焦点已经在用户点的地方了，不去抢
                    onCloseAutoFocus={(event) => {
                        event.preventDefault();
                        const active = document.activeElement;
                        const previous = previousFocusRef.current;
                        if ((!active || active === document.body) && previous?.isConnected) {
                            previous.focus({ preventScroll: true });
                        }
                    }}
                    onInteractOutside={(event) => {
                        if (toggleRef.current?.contains(event.target as Node)) event.preventDefault();
                    }}
                    className="gap-0 p-0"
                    // 位置覆盖 Sheet 默认的「贴窗口左缘、全屏高」；bottom 置 auto 免得与 top + height 打架
                    style={{
                        top: rect.top,
                        left: rect.left,
                        height: rect.height,
                        bottom: "auto",
                        width: PANEL_WIDTH,
                    }}
                >
                    <div className="flex h-9 flex-none items-center justify-between border-b border-line pr-1.5 pl-3">
                        <SheetTitle className="min-w-0 truncate text-xs" title={folder}>
                            {folderName}
                        </SheetTitle>
                        <div className="flex flex-none items-center gap-0.5">
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="size-6"
                                onClick={refresh}
                                title={t("ft.refresh")}
                                aria-label={t("ft.refresh")}
                            >
                                <RefreshCw className="size-3.5" />
                            </Button>
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="size-6"
                                onClick={() => onOpenChange(false)}
                                title={t("common.close")}
                                aria-label={t("common.close")}
                            >
                                <X className="size-3.5" />
                            </Button>
                        </div>
                    </div>
                    <div className="min-h-0 flex-1">
                        {status.kind === "loading" && (
                            <div className="flex h-full items-center justify-center">
                                <Spinner decorative className="text-muted-foreground" />
                            </div>
                        )}
                        {status.kind === "error" && (
                            <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
                                <span className="text-xs text-muted-foreground">
                                    {status.error.kind === "missing" ? t("ft.errMissing") : t("ft.errFailed")}
                                </span>
                                <div className="flex gap-2">
                                    <Button
                                        type="button"
                                        appearance="standard"
                                        variant="outline"
                                        size="sm"
                                        onClick={refresh}
                                    >
                                        {t("ft.retry")}
                                    </Button>
                                    <Button
                                        type="button"
                                        appearance="standard"
                                        variant="outline"
                                        size="sm"
                                        onClick={onChangeFolder}
                                    >
                                        {t("ws.changeFolder")}
                                    </Button>
                                </div>
                            </div>
                        )}
                        {status.kind === "ready" && nodes.length === 0 && (
                            <div className="flex h-full items-center justify-center text-xs text-dim-foreground">
                                {t("ft.empty")}
                            </div>
                        )}
                        {status.kind === "ready" && nodes.length > 0 && (
                            <ContextMenu>
                                <ContextMenuTrigger asChild onContextMenu={handleContextMenu}>
                                    <div key={treeKey} ref={focusTree} className="h-full p-1">
                                        <Tree
                                            nodes={nodes}
                                            expandedIds={expanded}
                                            onExpandedChange={handleExpandedChange}
                                            loadChildren={loadChildren}
                                            onActivate={handleActivate}
                                            onActiveChange={(id) => {
                                                activeIdRef.current = id;
                                            }}
                                            // 虚拟滚动：不隐藏任何文件，展开 node_modules 这类目录一次有几千行。
                                            // Tree 开虚拟滚动时会把最大高度写死成 320px，用 max-h-none! 盖掉，
                                            // 让它撑满浮层（不改上游文件）
                                            virtual
                                            className="h-full max-h-none!"
                                            label={folderName}
                                            labels={{
                                                loading: t("common.loading"),
                                                retry: t("ft.retry"),
                                                loadError: t("ft.loadError"),
                                                expand: t("ft.expand"),
                                                collapse: t("ft.collapse"),
                                            }}
                                            renderRow={(row) => {
                                                const entry = row.node.data as DirEntry;
                                                // 文件夹图标要随展开状态换开口款，所以在这里画，不用 node.icon
                                                const src = entry.isDir
                                                    ? folderIconUrl(entry.name, row.expanded, light)
                                                    : fileIconUrl(entry.name, light);
                                                return (
                                                    <>
                                                        <img
                                                            src={src}
                                                            alt=""
                                                            draggable={false}
                                                            className="size-4 flex-none"
                                                        />
                                                        <span className="min-w-0 flex-1 truncate" title={entry.path}>
                                                            {entry.name}
                                                        </span>
                                                    </>
                                                );
                                            }}
                                        />
                                    </div>
                                </ContextMenuTrigger>
                                <ContextMenuContent>
                                    {menuEntry && (
                                        <>
                                            <ContextMenuItem onClick={() => onOpenPath(menuEntry.path)}>
                                                {t("menu.open")}
                                            </ContextMenuItem>
                                            <ContextMenuItem onClick={() => void reveal(menuEntry.path)}>
                                                {t("ft.reveal")}
                                            </ContextMenuItem>
                                            <ContextMenuItem onClick={() => void copyPath(menuEntry.path)}>
                                                {t("ft.copyPath")}
                                            </ContextMenuItem>
                                            {menuEntry.isDir && (
                                                <>
                                                    <ContextMenuSeparator />
                                                    <ContextMenuItem
                                                        onClick={() => onOpenFolderInTerminal(menuEntry.path)}
                                                    >
                                                        {t("menu.terminalHere")}
                                                    </ContextMenuItem>
                                                </>
                                            )}
                                        </>
                                    )}
                                </ContextMenuContent>
                            </ContextMenu>
                        )}
                    </div>
                </SheetContent>
            )}
        </Sheet>
    );
}

/** 目录项 → 树节点。id 用路径（唯一，且能直接回查条目）；目录先标成「有子节点」，展开时才读 */
function toNode(entry: DirEntry, entries: Map<string, DirEntry>, light: boolean): TreeNode {
    entries.set(entry.path, entry);
    return {
        id: entry.path,
        label: entry.name,
        hasChildren: entry.isDir,
        // 只有「加载失败」那一行会用到 icon；正常行的图标在 renderRow 里画
        icon: (
            <img
                src={entry.isDir ? folderIconUrl(entry.name, false, light) : fileIconUrl(entry.name, light)}
                alt=""
                className="size-4"
            />
        ),
        data: entry,
    };
}

/** listing 是这一层读到的原始列表（预读缓存存它，不存建好的节点） */
type Level = { ok: true; nodes: TreeNode[]; listing: DirEntry[] } | { ok: false; error: ApiError };

/**
 * 读一层，并顺着用户上次展开的目录往下读：所有读到的条目登记进 entries，读成功的展开目录挂上 children 并记进 alive，
 * 读失败的只当普通目录留着（不展开）。返回失败只会出现在最上层——下层失败不影响上层。
 */
async function readLevel(
    workspaceId: number,
    dir: string,
    wanted: Set<string>,
    alive: string[],
    entries: Map<string, DirEntry>,
    light: boolean,
): Promise<Level> {
    // 工作区 id 与路径在 api 层校验；抛异常（IPC 断了等）按读取失败处理，和主进程的 failed 同一口径
    const r = await api.listDir(workspaceId, dir).catch((): { ok: false; error: ApiError } => ({
        ok: false,
        error: { kind: "failed", path: dir },
    }));
    if (!r.ok) return { ok: false, error: r.error };
    const nodes = await Promise.all(
        sortEntries(r.data.entries).map(async (entry) => {
            const node = toNode(entry, entries, light);
            if (entry.isDir && wanted.has(entry.path)) {
                const sub = await readLevel(workspaceId, entry.path, wanted, alive, entries, light);
                if (sub.ok) {
                    node.children = sub.nodes;
                    alive.push(entry.path);
                }
            }
            return node;
        }),
    );
    return { ok: true, nodes, listing: r.data.entries };
}

/** 两份条目登记表是否一致：数量相同，且每个路径的「是不是目录」都对得上 */
function sameEntries(a: Map<string, DirEntry>, b: Map<string, DirEntry>): boolean {
    if (a.size !== b.size) return false;
    for (const [path, entry] of a) if (b.get(path)?.isDir !== entry.isDir) return false;
    return true;
}
