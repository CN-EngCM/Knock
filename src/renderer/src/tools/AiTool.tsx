import { Fragment, memo, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronRight, Copy, SlidersHorizontal, Sparkles } from "lucide-react";
import Markdown, { type Components } from "react-markdown";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/context-menu";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupTextarea } from "@/components/ui/input-group";
import { Item } from "@/components/ui/item";
import { Kbd } from "@/components/ui/kbd";
import { Message, MessageActions, MessageAvatar, MessageContent, MessageFooter } from "@/components/ui/message";
import { MessageScroller, type MessageScrollerHandle } from "@/components/ui/message-scroller";
import { Popover, PopoverClose, PopoverContent, PopoverHeader, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { Titlebar } from "@/components/ui/titlebar";
import { api, type AiEffortId, type AiProviderId, type Expert } from "@/api/client";
import { useI18n } from "@/i18n/useI18n";
import type { MessageKey } from "@/i18n/zh";
import { useAiModels } from "@/lib/aiModels";
import { useExperts } from "@/lib/experts";
import {
    appendExchange,
    clearConv,
    convStreaming,
    registerStream,
    resetForRetry,
    rollbackLastExchange,
    setActive,
    setEffortOverride,
    setOverride,
    stopExpertStreams,
    useAiSessions,
} from "./aiSessions";
import type { Msg } from "./aiSessions";
import { buildTurns } from "./aiMessageModel";
import { EditExpertDialog } from "@/components/dialogs/EditExpertDialog";
import { TipButton } from "./TipButton";
import { useToolInput } from "./toolInput";
import { aiErrKey } from "./aiErr";

// ── AI 助手工具 ──
// 左栏专家列表 + 右栏会话。会话语义：
//   单轮 —— 每次请求只发当条消息，但界面保留全部问答历史（与多轮同一条连续流，可复制旧答案）；
//   多轮 —— 整段 history 随请求携带，一个专家一段运行中会话。
// 会话与选中放在模块级 store（./aiSessions）：关闭工具 tab 后流仍在推进、历史保留，
// 重开即见最新内容——这是 TOOL_SPEC §3 生命周期的用户决策例外，应用重启仍从空开始。
// 流式输出走 mp:ai-event 事件流；不同专家的会话允许各有一条并发流，
// 同一专家重发先停自己的旧流。状态分层：模型配置来自共享 store（src/renderer/src/lib/aiModels）；
// 专家列表来自共享 store（src/renderer/src/lib/experts）；没有任何需要 localStorage 的东西。

// 供应商词汇表：须与 server/schemas.AI_PROVIDER_IDS 手工对齐（渲染进程禁止运行时
// import server/ 的值，zod 在主进程仍会兜底校验）。键是 id、值是显示名。
const PROVIDER_LABEL: Record<AiProviderId, string> = { deepseek: "DeepSeek", zhipu: "智谱" };

// 思考强度词汇表：与 EditExpertDialog 同一份手工对齐（server/schemas.AI_EFFORT_IDS）。
// default = 请求不带 reasoning_effort 参数。
const EFFORT_IDS: readonly AiEffortId[] = ["default", "low", "high", "max"];
const EFFORT_LABEL: Record<AiEffortId, MessageKey> = {
    default: "ai.effort.default",
    low: "ai.effort.low",
    high: "ai.effort.high",
    max: "ai.effort.max",
};

/** select 的哨兵 value：模型未绑定时让下拉显示出「未绑定」又不可再选回空值 */
const NO_MODEL = ":unbound";

/** 空会话用固定引用，避免每次渲染换新数组把 buildTurns 的 memo 打穿 */
const EMPTY_MSGS: Msg[] = [];

/** 消息时间只到分钟：HH:mm，24 小时制 */
function formatTime(ts: number): string {
    const date = new Date(ts);
    return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/**
 * 思考过程的折叠行：库的 Disclosure 是桌面面板折叠节（固定行高、上下描边、bar 底色），
 * 放进气泡上方会像一截工具面板，这里用一条 11px 的轻量触发行代替。
 */
function ReasoningRow({ text, live }: { text: string; live: boolean }) {
    const { t } = useI18n();
    const [open, setOpen] = useState(false);
    return (
        <div className="flex w-full min-w-0 flex-col">
            <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpen((v) => !v)}
                className="flex w-fit cursor-default items-center gap-1 rounded-sm text-[11px] leading-4 text-dim-foreground transition-colors hover:text-foreground"
            >
                <ChevronRight
                    aria-hidden="true"
                    className={`size-3 transition-transform motion-reduce:transition-none ${open ? "rotate-90" : ""}`}
                />
                {live ? t("ai.thinkingLive") : t("ai.thinking")}
            </button>
            {open && (
                <div className="mt-1.5 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-well p-2 text-[11.5px] leading-relaxed text-dim-foreground">
                    {text}
                </div>
            )}
        </div>
    );
}

/**
 * 回答的 markdown 渲染覆写。放模块级：内联对象每次渲染都是新引用，
 * 会让 react-markdown 在每个增量都重建整棵树的覆写映射。
 */
const MARKDOWN_COMPONENTS: Components = {
    pre: ({ node: _node, ...rest }) => (
        <pre
            {...rest}
            className="overflow-auto rounded-lg bg-[var(--control-input-background)] p-2 font-mono text-[12.5px]"
        />
    ),
    code: ({ node: _node, ...rest }) => <code {...rest} className="font-mono text-[12.5px]" />,
};

// 消息行：用户侧右对齐气泡 + 分钟时间；AI 侧头像 + 气泡 + footer（时间 / 状态 / 复制）。
// markdown 沿用 react-markdown 与现有 pre/code 覆写；思考过程交给 ReasoningRow 折叠。
// 用 memo 包住：Msg 不可变，流式时只有末条换引用，历史消息的 props 全部不变就不会重渲染。
const UserMsg = memo(function UserMsg({ m }: { m: Msg }) {
    return (
        <Message side="end">
            <MessageContent>
                <Bubble side="end" variant="primary" className="max-w-[80%]">
                    <BubbleContent className="rounded-xl rounded-br-[4px] px-3 py-2 text-[12.5px] leading-relaxed whitespace-pre-wrap">
                        {m.content}
                    </BubbleContent>
                </Bubble>
                <MessageFooter className="px-1 text-[10.5px] font-normal text-dim-foreground">
                    {formatTime(m.createdAt)}
                </MessageFooter>
            </MessageContent>
        </Message>
    );
});

const AssistantMsg = memo(function AssistantMsg({
    m,
    eid,
    isLast,
    initial,
    onRetry,
    onOpenSettings,
}: {
    m: Msg;
    eid: number;
    isLast: boolean;
    /** 头像上的专家名首字 */
    initial: string;
    onRetry: (eid: number) => void;
    onOpenSettings: () => void;
}) {
    const { t } = useI18n();
    const isStreaming = m.status === "streaming";
    const authError = m.status === "error" && aiErrKey(m.errStatus) === "ai.err.auth";

    async function copyMsg(content: string): Promise<void> {
        // 走主进程写：navigator.clipboard 要求页面有焦点，主进程没有这个限制
        const r = await api.clipboardWrite(content).catch(() => null);
        if (r?.ok) toast.success(t("ai.copied"));
        else toast.error(t("toast.error"));
    }

    return (
        <Message>
            <MessageAvatar
                aria-hidden="true"
                className="mt-0.5 size-6 min-w-6 rounded-full bg-primary/15 text-[10px] font-semibold text-primary"
            >
                {initial}
            </MessageAvatar>
            <MessageContent className="gap-1.5">
                {!!m.reasoning && <ReasoningRow text={m.reasoning} live={isStreaming && !m.content} />}
                {/* 没有正文的错误/停止不画空气泡，footer 自己交代状态 */}
                {(isStreaming || !!m.content) && (
                    <Bubble variant="secondary">
                        <BubbleContent className="rounded-xl rounded-bl-[4px] px-3 py-2 text-[12.5px] leading-relaxed [&_li]:ml-4 [&_ul]:list-disc">
                            {isStreaming && !m.content ? (
                                <Spinner decorative className="size-3.5 text-muted-foreground" />
                            ) : (
                                <Markdown components={MARKDOWN_COMPONENTS}>{m.content}</Markdown>
                            )}
                        </BubbleContent>
                    </Bubble>
                )}
                <MessageFooter className="flex-wrap gap-1.5 px-1 text-[10.5px] font-normal text-dim-foreground">
                    <span>{formatTime(m.createdAt)}</span>
                    {m.status === "stopped" && <span>· {t("ai.stopped")}</span>}
                    {m.status === "error" && (
                        <>
                            <span className="text-destructive">
                                {(() => {
                                    const k = aiErrKey(m.errStatus);
                                    return k ? t(k) : `${t("ai.err.other")}: ${m.errStatus}`;
                                })()}
                            </span>
                            {isLast && (
                                <Button
                                    type="button"
                                    appearance="standard"
                                    variant="ghost"
                                    size="xs"
                                    className="h-auto px-1 text-[10.5px] font-normal text-primary"
                                    onClick={() => (authError ? onOpenSettings() : onRetry(eid))}
                                >
                                    {authError ? t("translate.openSettings") : t("ai.retry")}
                                </Button>
                            )}
                        </>
                    )}
                    {(!m.status || m.status === "stopped") && m.content && (
                        <MessageActions className="min-h-0 gap-0.5 px-0 opacity-0 transition-opacity group-hover/message:opacity-100 group-focus-within/message:opacity-100 motion-reduce:transition-none">
                            <TipButton
                                type="button"
                                label={t("ai.copy")}
                                aria-label={t("ai.copy")}
                                appearance="standard"
                                variant="ghost"
                                size="icon-xs"
                                className="size-5 text-muted-foreground enabled:hover:text-foreground"
                                onClick={() => void copyMsg(m.content)}
                            >
                                <Copy className="size-3" />
                            </TipButton>
                        </MessageActions>
                    )}
                </MessageFooter>
            </MessageContent>
        </Message>
    );
});

export default function AiTool({
    initialInput,
    openSettings,
}: {
    initialInput?: string | null;
    openSettings?: () => void;
}) {
    const { t } = useI18n();
    // 同一个工具可能同时挂在多个工作区的停靠实例里，写死 id 会在文档里重复；
    // 弹层内两个 Select 的 label 靠 htmlFor 关联，必须每个实例各自唯一。
    const uid = useId();
    const modelSelectId = `${uid}-model`;
    const effortSelectId = `${uid}-effort`;
    const experts = useExperts();
    // 模型配置来自共享 store：在设置里新增模型后，这里立刻看到，不用关掉工具重开
    const aiModels = useAiModels();
    // 注入管道：text/expertId/seq 只承载「新到的素材」，见下方注入 effect；
    // setText 不取用——草稿与管道分离，多轮预填走 setDraft
    const { text, expertId, seq } = useToolInput("ai", initialInput);

    // 会话与选中来自模块级 store；convs 变化经订阅触发本组件重渲染
    const { convs, activeId } = useAiSessions();

    // 输入草稿与注入管道分离：toolInput.text 只承载「新到的素材」，
    // 处理完立即搬进 draft 或直接发送，text 本身不落回输入框
    const [draft, setDraft] = useState("");
    // 发送前置校验的行内提示：unbound=活跃专家没绑模型（附编辑入口）
    const [gate, setGate] = useState<"unbound" | null>(null);

    // 编辑对话框目标："new" 新建 / 数字改既有专家，null 关闭
    const [editing, setEditing] = useState<"new" | number | null>(null);

    const sendingRef = useRef(false); // startChat 在途标志：挡住 await 窗口内的连击发送
    const handledSeq = useRef(0); // 已消费的注入序号（StrictMode 双跑 + 重复注入防重放）
    const activeRef = useRef<number | null>(null); // 事件处理器里的活跃 id 快照
    const scrollerRef = useRef<MessageScrollerHandle | null>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        activeRef.current = activeId;
    }, [activeId]);

    // experts 到达后选中第一个（store 默认 null；列表非空即可选）
    useEffect(() => {
        if (activeId === null && experts.length > 0) setActive(experts[0].id);
    }, [experts, activeId]);

    /** 活跃专家当前生效的模型 id（会话 override 优先于专家绑定） */
    function effectiveModel(expert: Expert): string {
        return convs[expert.id]?.override ?? expert.modelId;
    }

    /** 活跃专家当前生效的思考强度（会话 override 优先于专家配置） */
    function effectiveEffort(expert: Expert): AiEffortId {
        return convs[expert.id]?.effortOverride ?? expert.effort;
    }

    /**
     * 发送一轮对话。targetId 缺省取当前选中（输入区路径）；素材注入路径显式传专家。
     * 同一专家已在流式中重发 = 先停它自己的旧流（已收部分就地标停止），新问答照常进行；
     * 其他专家的并发流不受影响。
     */
    async function send(rawText: string, targetId?: number): Promise<void> {
        if (sendingRef.current) return; // 上一次 startChat 尚未回执：忽略连击，不产生孤儿占位
        const eid = targetId ?? activeRef.current;
        const expert = experts.find((e) => e.id === eid);
        const trimmed = rawText.trim();
        if (eid == null || !expert || !trimmed) return;

        // 只停同一专家的在途流并就地标 stopped（abort 事件因路由换代到达不了旧占位）
        stopExpertStreams(eid);

        // 生效模型必须真实存在（空串或指向已删除的配置都拦下，行内引导去绑定）
        const modelId = effectiveModel(expert);
        if (!modelId || !aiModels?.some((m) => m.id === modelId)) {
            setGate("unbound");
            return;
        }

        // 多轮带完整 history（完成态的消息才可信）；单轮只发当条
        const conv = convs[eid] ?? { msgs: [], override: null, effortOverride: null };
        const history = (
            expert.multi ? conv.msgs.filter((m) => !m.status).map(({ role, content }) => ({ role, content })) : []
        ).concat({ role: "user", content: trimmed });

        // UI 先行：切到目标专家并落下一对占位（失败在回执后整体撤掉）
        setActive(eid);
        setDraft("");
        setGate(null);
        appendExchange(eid, trimmed);

        sendingRef.current = true;
        try {
            const r = await api.aiChat({
                modelId,
                system: expert.prompt,
                messages: history,
                effort: effectiveEffort(expert), // default 由主进程过滤为不发 reasoning_effort 参数
            });
            if (!r.ok) {
                // not-found ≈ 配置表刚被改动（模型被删）：撤掉两条占位，行内引导去绑定
                rollbackLastExchange(eid);
                setGate("unbound");
                return;
            }
            registerStream(eid, r.data.streamId);
        } finally {
            sendingRef.current = false;
        }
    }

    /**
     * 只对错误态开放的重试：沿用已有消息重建 history，不追加新的用户消息。
     * 先发请求再换占位——占位换失败（末条已不是这条 error）时把刚开的流停掉，避免孤儿流。
     */
    async function retry(eid: number): Promise<void> {
        if (sendingRef.current) return;
        const expert = experts.find((e) => e.id === eid);
        const conv = convs[eid];
        if (!expert || !conv) return;
        const modelId = effectiveModel(expert);
        if (!modelId || !aiModels?.some((m) => m.id === modelId)) {
            setGate("unbound");
            return;
        }
        const lastUser = [...conv.msgs].reverse().find((m) => m.role === "user");
        if (!lastUser) return;
        const history = expert.multi
            ? conv.msgs.filter((m) => !m.status).map(({ role, content }) => ({ role, content }))
            : [{ role: "user" as const, content: lastUser.content }];
        stopExpertStreams(eid);
        setGate(null);
        sendingRef.current = true;
        try {
            const r = await api.aiChat({
                modelId,
                system: expert.prompt,
                messages: history,
                effort: effectiveEffort(expert),
            });
            if (!r.ok) {
                setGate("unbound");
                return;
            }
            if (!resetForRetry(eid)) {
                void api.aiChatStop(r.data.streamId);
                return;
            }
            registerStream(eid, r.data.streamId);
        } finally {
            sendingRef.current = false;
        }
    }

    // ── 素材注入：seq 边沿信号驱动（见 useToolInput 注释）。
    // 单轮专家 → 立即自动发送；多轮专家 → 只预填输入框并聚焦；
    // 未指明专家（工具行进入）→ 落到当前选中专家后同规则分叉。
    // 两类「未就绪」都不消费序号，effect 随依赖到位重跑重试——此时消费掉会让首次注入静默蒸发：
    //   experts 未就绪：共享 store 还在异步拉取；
    //   aiModels 未就绪：共享 store 首次异步拉取中，此刻自动发送必把「还没加载」误判成「未绑定」。
    useEffect(() => {
        if (seq <= handledSeq.current) return; // 含 StrictMode 双跑的第二击
        if (aiModels === null) return;
        const eid = expertId ?? activeRef.current ?? experts[0]?.id ?? null;
        const expert = eid == null ? undefined : experts.find((e) => e.id === eid);
        if (!expert || eid == null) return; // 列表未就绪或确实一个专家都没有：维持待消费
        handledSeq.current = seq;
        const injected = text.trim();
        setActive(eid);
        setGate(null);
        if (!expert.multi) {
            if (injected) void send(injected, eid); // 单轮自动发送
        } else {
            setDraft(text); // 多轮预填聚焦
            requestAnimationFrame(() => textareaRef.current?.focus());
        }
    }, [seq, experts, aiModels]);

    // 当前选中的专家：左栏只改 activeId，右栏的模型、强度、轮次都从它派生
    const activeExpert = experts.find((e) => e.id === activeId) ?? null;
    // 头像显示专家名首个字符；空名兜底 AI（Array.from 防止把表情拆成半个代理对）
    const assistantInitial = Array.from((activeExpert?.name ?? "").trim())[0] ?? "AI";
    const noModelsConfigured = aiModels !== null && aiModels.length === 0;
    // 「停止」态看的是当前活跃会话末条 assistant 是否仍在流式（后台专家的流不影响按钮语义）
    const streaming = activeId != null && convStreaming(activeId);

    // 会话消息流折叠成 turn；单轮/多轮共用。memo 依赖 msgs 引用，后台专家的增量不重算
    const activeEid = activeExpert?.id ?? null;
    const activeMsgs = activeExpert ? (convs[activeExpert.id]?.msgs ?? EMPTY_MSGS) : EMPTY_MSGS;
    const turns = useMemo(() => buildTurns(activeMsgs), [activeMsgs]);
    const lastTurnRef = useRef<{ eid: number; count: number } | null>(null);

    // 只有「新增 turn」才主动回到底部：流式增量不改 turns.length，用户上翻后不会被拽回。
    // 切专家时交给 MessageScroller 重新挂载后的 initialPosition="end"，这里不重复命令。
    useEffect(() => {
        if (activeEid === null) {
            lastTurnRef.current = null;
            return;
        }
        const previous = lastTurnRef.current;
        lastTurnRef.current = { eid: activeEid, count: turns.length };
        if (previous === null || previous.eid !== activeEid) return;
        if (turns.length > previous.count) void scrollerRef.current?.scrollToEnd();
    }, [activeEid, turns.length]);

    // ── 加载窗口期的自愈：注入/发送可能在 aiModels 尚未拉完时放行，把「还没加载」误判成
    // unbound；这里在模型表就位后发现生效模型其实存在，就把陈旧红条自动撤掉
    useEffect(() => {
        if (aiModels === null || gate !== "unbound" || !activeExpert) return;
        const mid = effectiveModel(activeExpert);
        if (mid && aiModels.some((m) => m.id === mid)) setGate(null);
    }, [aiModels, gate, activeExpert, convs]);

    // 消息行是 memo 组件，回调引用必须稳定才不会被打穿：最新的 retry / openSettings 放进 ref，
    // 对外只给一个永不变的壳。retry 闭包里要读最新的 experts / convs / aiModels，所以不能直接传。
    const retryRef = useRef(retry);
    const openSettingsRef = useRef(openSettings);
    useEffect(() => {
        retryRef.current = retry;
        openSettingsRef.current = openSettings;
    });
    const onRetry = useCallback((eid: number) => void retryRef.current(eid), []);
    const onOpenSettings = useCallback(() => openSettingsRef.current?.(), []);

    return (
        <div className="flex h-full">
            {/* ── 左栏:专家列表(顶部小标签 + 选中行填充 + 模式 chip) ── */}
            <aside className="flex w-[148px] flex-none flex-col border-e border-line bg-background">
                <span className="px-2.5 pb-1 pt-2.5 text-[11px] font-semibold tracking-wider text-dim-foreground">
                    {t("search.expert")}
                </span>
                <div className="min-h-0 flex-1 overflow-y-auto px-1.5">
                    {experts.length === 0 ? (
                        <Empty className="px-3 py-6">
                            <EmptyDescription className="text-[12px] text-dim-foreground">
                                {t("ai.noExperts")}
                            </EmptyDescription>
                        </Empty>
                    ) : (
                        experts.map((e) => (
                            // 行本体承载点击与右键菜单：编辑入口收进右键，行内不再放小按钮
                            <ContextMenu key={e.id}>
                                <ContextMenuTrigger asChild>
                                    <Item
                                        role="button"
                                        tabIndex={0}
                                        onClick={() => {
                                            setActive(e.id);
                                            setGate(null);
                                        }}
                                        onKeyDown={(ev) => {
                                            if (ev.key === "Enter" || ev.key === " ") {
                                                ev.preventDefault();
                                                setActive(e.id);
                                                setGate(null);
                                            }
                                        }}
                                        className={`flex w-full cursor-default flex-nowrap items-center gap-2 rounded-[4px] px-2 py-[7px] text-left text-[12px] transition-colors ${
                                            e.id === activeId
                                                ? "bg-(--state-selected) font-semibold text-primary"
                                                : "text-muted-foreground hover:bg-(--state-hover) hover:text-foreground"
                                        }`}
                                    >
                                        {/* 该专家正在流式：克制的呼吸圆点，颜色随当前行文字（选中行即强调色） */}
                                        {convStreaming(e.id) && (
                                            <span className="size-1.5 flex-none animate-pulse rounded-full bg-current" />
                                        )}
                                        <span className="min-w-0 flex-1 truncate">{e.name}</span>
                                        {/* 模式 chip:选中行强调色,普通行井底 */}
                                        <Badge
                                            variant="ghost"
                                            className={`flex-none rounded-md px-1.5 py-[3px] font-mono text-[9.5px] font-normal leading-none ${
                                                e.id === activeId
                                                    ? "bg-primary/15 text-primary"
                                                    : "bg-well text-dim-foreground"
                                            }`}
                                        >
                                            {t(e.multi ? "ai.modeMulti" : "ai.modeSingle")}
                                        </Badge>
                                    </Item>
                                </ContextMenuTrigger>
                                {/* 右键只给编辑；右键不切换选中，避免用户只是想改配置却把会话切走 */}
                                <ContextMenuContent>
                                    <ContextMenuItem onClick={() => setEditing(e.id)}>
                                        {t("ai.editExpert")}
                                    </ContextMenuItem>
                                </ContextMenuContent>
                            </ContextMenu>
                        ))
                    )}
                </div>
                <Button
                    type="button"
                    appearance="standard"
                    variant="outline"
                    size="sm"
                    className="mx-2 mb-2.5 mt-1"
                    onClick={() => setEditing("new")}
                >
                    ＋ {t("ai.newExpert")}
                </Button>
            </aside>

            {/* ── 右栏:标题栏 + 会话 + 输入 ── */}
            <section className="flex min-w-0 flex-1 flex-col">
                {!noModelsConfigured && activeExpert && (
                    /* 头部用库的 Titlebar：34px、底部一条描边、通栏，模型/强度/清空都收进弹层 */
                    <Titlebar
                        className="gan-no-drag flex-none"
                        trafficLights={false}
                        windowControls="none"
                        left={
                            <>
                                <span className="min-w-0 truncate text-small font-semibold text-titlebar-foreground">
                                    {activeExpert.name}
                                </span>
                                <Badge
                                    variant="ghost"
                                    className="flex-none rounded-md bg-well px-1.5 py-[3px] font-mono text-[9.5px] font-normal leading-none text-dim-foreground"
                                >
                                    {t(activeExpert.multi ? "ai.modeMulti" : "ai.modeSingle")}
                                </Badge>
                            </>
                        }
                        right={
                            <Popover>
                                <PopoverTrigger asChild>
                                    <Button
                                        type="button"
                                        appearance="standard"
                                        variant="ghost"
                                        size="icon"
                                        className="size-7 flex-none"
                                        aria-label={t("ai.sessionSettings")}
                                    >
                                        <SlidersHorizontal className="size-4" />
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent align="end" className="w-64">
                                    <PopoverHeader>
                                        <span className="font-medium">{t("ai.sessionSettings")}</span>
                                    </PopoverHeader>
                                    {/* 会话内模型/强度临时切换：只改 conv.override 不写回专家；换模型历史照常携带 */}
                                    <Field className="gap-1.5">
                                        <FieldLabel htmlFor={modelSelectId}>{t("ai.model")}</FieldLabel>
                                        <Select
                                            value={effectiveModel(activeExpert) || NO_MODEL}
                                            onValueChange={(v) => setOverride(activeExpert.id, v)}
                                        >
                                            <SelectTrigger
                                                id={modelSelectId}
                                                size="sm"
                                                className="w-full"
                                                aria-label={t("ai.model")}
                                            >
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value={NO_MODEL} disabled>
                                                    {t("ai.unbound")}
                                                </SelectItem>
                                                {(aiModels ?? []).map((m) => (
                                                    <SelectItem key={m.id} value={m.id}>
                                                        {PROVIDER_LABEL[m.provider]} · {m.model}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </Field>
                                    <Field className="gap-1.5">
                                        <FieldLabel htmlFor={effortSelectId}>{t("ai.effort")}</FieldLabel>
                                        <Select
                                            value={effectiveEffort(activeExpert)}
                                            onValueChange={(v) => setEffortOverride(activeExpert.id, v as AiEffortId)}
                                        >
                                            <SelectTrigger
                                                id={effortSelectId}
                                                size="sm"
                                                className="w-full"
                                                aria-label={t("ai.effort")}
                                            >
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {EFFORT_IDS.map((id) => (
                                                    <SelectItem key={id} value={id}>
                                                        {t(EFFORT_LABEL[id])}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </Field>
                                    <Separator />
                                    <div className="flex flex-col gap-0.5">
                                        <PopoverClose asChild>
                                            <Button
                                                type="button"
                                                appearance="standard"
                                                variant="ghost"
                                                size="sm"
                                                className="justify-start"
                                                onClick={() => setEditing(activeExpert.id)}
                                            >
                                                {t("ai.editExpert")}
                                            </Button>
                                        </PopoverClose>
                                        {/* 单轮/多轮都给清空：单轮的历史同样需要一键重来 */}
                                        <PopoverClose asChild>
                                            <Button
                                                type="button"
                                                appearance="standard"
                                                variant="ghost"
                                                size="sm"
                                                className="justify-start text-destructive"
                                                onClick={() => clearConv(activeExpert.id)}
                                            >
                                                {t("ai.clear")}
                                            </Button>
                                        </PopoverClose>
                                    </div>
                                </PopoverContent>
                            </Popover>
                        }
                    />
                )}

                <div className="flex min-h-0 flex-1 flex-col gap-2.5 p-3">
                    {noModelsConfigured ? (
                        /* 无任何模型配置：TranslateTool 式引导直达设置页（实心 CTA） */
                        <Empty className="min-h-0 flex-1">
                            <EmptyHeader>
                                <EmptyTitle className="text-[13px]">{t("ai.errNoModels")}</EmptyTitle>
                            </EmptyHeader>
                            <EmptyContent>
                                <Button
                                    type="button"
                                    appearance="standard"
                                    variant="primary"
                                    size="sm"
                                    className="px-4"
                                    onClick={() => openSettings?.()}
                                >
                                    {t("translate.openSettings")}
                                </Button>
                            </EmptyContent>
                        </Empty>
                    ) : !activeExpert ? (
                        <Empty className="min-h-0 flex-1">
                            <EmptyDescription className="text-[12px] text-dim-foreground">
                                {experts.length === 0 ? t("ai.noExperts") : ""}
                            </EmptyDescription>
                        </Empty>
                    ) : turns.length === 0 ? (
                        /* 空态：单轮/多轮的差别在界面上看不出来，这里说清模式语义 */
                        <Empty className="min-h-0 flex-1">
                            <EmptyMedia variant="icon">
                                <Sparkles aria-hidden="true" />
                            </EmptyMedia>
                            <EmptyHeader>
                                <EmptyTitle className="text-[13px]">{activeExpert.name}</EmptyTitle>
                                <EmptyDescription className="text-[12px] text-dim-foreground">
                                    {t("ai.emptyTitle")}
                                </EmptyDescription>
                            </EmptyHeader>
                            <EmptyContent>
                                <p className="text-[11px] text-dim-foreground">
                                    {t(activeExpert.multi ? "ai.emptyMulti" : "ai.emptySingle")}
                                </p>
                            </EmptyContent>
                        </Empty>
                    ) : (
                        /* 滚动、底部吸附与「回到最新」按钮全部交给 MessageScroller：turn 是它的
                       直接子节点，data-turn-anchor 让每个问答轮可定位；流式增高由库跟随，
                       用户上翻后库自己暂停吸附，回到阈值内再恢复。 */
                        <div className="min-h-0 flex-1">
                            <MessageScroller
                                key={activeExpert.id}
                                commandRef={scrollerRef}
                                aria-label={t("ai.messages")}
                                scrollButtonLabel={t("ai.scrollToLatest")}
                                className="h-full"
                                contentClassName="gap-4 p-3"
                            >
                                {turns.map((turn, turnIndex) => {
                                    const first = turn.messages[0];
                                    const anchorProps = {
                                        "data-turn-anchor": "true",
                                        "data-turn-id": turn.key,
                                        "data-message-id": turn.key,
                                        "data-message-role": first.role,
                                    };
                                    return (
                                        <div key={turn.key} {...anchorProps} className="flex flex-col gap-3">
                                            {turn.messages.map((msg, index) => {
                                                const isLast =
                                                    turnIndex === turns.length - 1 &&
                                                    index === turn.messages.length - 1;
                                                return (
                                                    <Fragment key={`${turn.key}:${index}`}>
                                                        {msg.role === "user" ? (
                                                            <UserMsg m={msg} />
                                                        ) : (
                                                            <AssistantMsg
                                                                m={msg}
                                                                eid={activeExpert.id}
                                                                isLast={isLast}
                                                                initial={assistantInitial}
                                                                onRetry={onRetry}
                                                                onOpenSettings={onOpenSettings}
                                                            />
                                                        )}
                                                    </Fragment>
                                                );
                                            })}
                                        </div>
                                    );
                                })}
                            </MessageScroller>
                        </div>
                    )}

                    {/* 行内门禁提示（有界问题就地给出路） */}
                    {gate === "unbound" && !noModelsConfigured && activeExpert && (
                        <div className="flex flex-none items-center gap-2 text-[12px] text-destructive">
                            {t("ai.errUnbound")}
                            <Button
                                type="button"
                                appearance="standard"
                                variant="outline"
                                size="xs"
                                onClick={() => setEditing(activeExpert.id)}
                            >
                                {t("ai.editExpert")}
                            </Button>
                        </div>
                    )}

                    {/* 输入区:外层卡片给输入井一圈可见边界；发送键禁用会让输入组落到
                        has-disabled 的半透明底色，所以底色放外层；textarea 自动增高,
                        流式中发送按钮变停止;Enter 发送 Shift+Enter 换行 */}
                    <div className="flex-none rounded-lg border border-line bg-card p-1">
                        <InputGroup className="items-stretch p-1.5">
                            <InputGroupTextarea
                                ref={textareaRef}
                                rows={1}
                                className="field-sizing-content max-h-32 min-h-7 py-1 text-[12.5px] leading-5 placeholder:text-dim-foreground"
                                value={draft}
                                placeholder={t("ai.placeholder")}
                                spellCheck={false}
                                onChange={(e) => setDraft(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key !== "Enter" || e.shiftKey) return;
                                    e.preventDefault();
                                    if (!draft.trim()) return;
                                    void send(draft); // send 内部处理 stop-then-send 与守卫
                                }}
                            />
                            <InputGroupAddon
                                align="block-end"
                                className="flex-wrap justify-between gap-2 ps-2 pe-0 pb-0 pt-1.5"
                            >
                                <span className="flex items-center gap-1 whitespace-nowrap text-[11px] text-dim-foreground">
                                    <Kbd>Enter</Kbd>
                                    <span>{t("ai.send")}</span>
                                    <span className="px-0.5 text-muted-foreground/40">·</span>
                                    <Kbd>Shift+Enter</Kbd>
                                    <span>{t("ai.newline")}</span>
                                </span>
                                {/* 发送/停止同一颗按钮随流式状态切换(禁用态半透明由 Button 自带) */}
                                <Button
                                    appearance="standard"
                                    variant="primary"
                                    size="sm"
                                    className="ms-auto flex-none"
                                    disabled={!streaming && !draft.trim()}
                                    onClick={() => {
                                        if (streaming && activeId != null) stopExpertStreams(activeId);
                                        else void send(draft);
                                    }}
                                >
                                    {streaming ? t("ai.stop") : t("ai.send")}
                                </Button>
                            </InputGroupAddon>
                        </InputGroup>
                    </div>
                </div>
            </section>

            {/* 编辑对话框：新建/修改共用，编辑态自持关闭即丢 */}
            {editing !== null && (
                <EditExpertDialog target={editing} models={aiModels} onClose={() => setEditing(null)} />
            )}
        </div>
    );
}
