import { Fragment, useEffect, useRef, useState } from "react";
import { Copy } from "lucide-react";
import Markdown from "react-markdown";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api, type AiModelConfig, type AiProviderId, type Expert } from "@/api/client";
import { useI18n } from "@/i18n/useI18n";
import { useExperts } from "@/lib/experts";
import {
    appendExchange,
    clearConv,
    convStreaming,
    registerStream,
    rollbackLastExchange,
    setActive,
    setOverride,
    stopExpertStreams,
    useAiSessions,
} from "./aiSessions";
import type { Msg } from "./aiSessions";
import { EditExpertDialog } from "@/components/dialogs/EditExpertDialog";
import { useToolInput } from "./toolInput";
import { aiErrKey } from "./aiErr";

// ── AI 助手工具 ──
// 左栏专家列表 + 右栏会话。会话语义：
//   单轮 —— 每次请求只发当条消息，但界面保留全部问答历史（一问一答一张卡片，可复制旧答案）；
//   多轮 —— 整段 history 随请求携带，一个专家一段运行中会话。
// 会话与选中放在模块级 store（./aiSessions）：关闭工具 tab 后流仍在推进、历史保留，
// 重开即见最新内容——这是 TOOL_SPEC §3 生命周期的用户决策例外，应用重启仍从空开始。
// 流式输出走 mp:ai-event 事件流；不同专家的会话允许各有一条并发流，
// 同一专家重发先停自己的旧流。状态分层：模型配置挂载时拉一次；
// 专家列表来自共享 store（src/lib/experts）；没有任何需要 localStorage 的东西。

// 供应商词汇表：须与 server/schemas.AI_PROVIDER_IDS 手工对齐（渲染进程禁止运行时
// import server/ 的值，zod 在主进程仍会兜底校验）。键是 id、值是显示名。
const PROVIDER_LABEL: Record<AiProviderId, string> = { deepseek: "DeepSeek", zhipu: "智谱" };

/** select 的哨兵 value：模型未绑定时让下拉显示出「未绑定」又不可再选回空值 */
const NO_MODEL = ":unbound";

/** 单轮消息按对分组成卡（一问一答一张）。发送路径保证 user+assistant 成对 push，
 *  但错误回滚可能留下奇数尾巴——落单的按单条收尾渲染 */
function pairUp(msgs: Msg[]): Msg[][] {
    const groups: Msg[][] = [];
    for (const m of msgs) {
        const last = groups[groups.length - 1];
        if (!last || last.length >= 2) groups.push([m]);
        else last.push(m);
    }
    return groups;
}

export default function AiTool({
    initialInput,
    openSettings,
}: {
    initialInput?: string | null;
    openSettings?: () => void;
}) {
    const { t } = useI18n();
    const experts = useExperts();
    const [aiModels, setAiModels] = useState<AiModelConfig[] | null>(null);
    // 注入管道：text/expertId/seq 只承载「新到的素材」，见下方注入 effect；
    // setText 不取用——草稿与管道分离，多轮预填走 setDraft
    const { text, expertId, seq } = useToolInput("ai", initialInput);

    // 会话与选中来自模块级 store；convs 变化经订阅触发本组件重渲染
    const { convs, activeId, lastEid } = useAiSessions();

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
    const scrollRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        activeRef.current = activeId;
    }, [activeId]);

    // 消息区自动滚底。只在本组件看得到的前台会话有更新（或切人）时才拉到底——
    // 后台专家在关 tab 期间仍往 store 里追加增量，无脑滚底会让前台滚动位置被顶乱
    useEffect(() => {
        if (lastEid !== activeId) return;
        const el = scrollRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [lastEid, activeId, convs]);

    useEffect(() => {
        api.getAiModels().then((r) => {
            if (r.ok) setAiModels(r.data);
        });
    }, []);

    // experts 到达后选中第一个（store 默认 null；列表非空即可选）
    useEffect(() => {
        if (activeId === null && experts.length > 0) setActive(experts[0].id);
    }, [experts, activeId]);

    /** 活跃专家当前生效的模型 id（会话 override 优先于专家绑定） */
    function effectiveModel(expert: Expert): string {
        return convs[expert.id]?.override ?? expert.modelId;
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
        const conv = convs[eid] ?? { msgs: [], override: null };
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
                effort: expert.effort, // default 由主进程过滤为不发 reasoning_effort 参数
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

    // ── 素材注入：seq 边沿信号驱动（见 useToolInput 注释）。
    // 单轮专家 → 立即自动发送；多轮专家 → 只预填输入框并聚焦；
    // 未指明专家（工具行进入）→ 落到当前选中专家后同规则分叉。
    // 两类「未就绪」都不消费序号，effect 随依赖到位重跑重试——此时消费掉会让首次注入静默蒸发：
    //   experts 未就绪：共享 store 还在异步拉取；
    //   aiModels 未就绪：挂载时异步拉取中，此刻自动发送必把「还没加载」误判成「未绑定」。
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

    const inputCls = "border border-line bg-bg text-[12.5px] outline-none placeholder:text-muted focus:border-dim";
    const activeExpert = experts.find((e) => e.id === activeId) ?? null;
    const noModelsConfigured = aiModels !== null && aiModels.length === 0;
    // 「停止」态看的是当前活跃会话末条 assistant 是否仍在流式（后台专家的流不影响按钮语义）
    const streaming = activeId != null && convStreaming(activeId);

    // ── 加载窗口期的自愈：注入/发送可能在 aiModels 尚未拉完时放行，把「还没加载」误判成
    // unbound；这里在模型表就位后发现生效模型其实存在，就把陈旧红条自动撤掉
    useEffect(() => {
        if (aiModels === null || gate !== "unbound" || !activeExpert) return;
        const mid = effectiveModel(activeExpert);
        if (mid && aiModels.some((m) => m.id === mid)) setGate(null);
    }, [aiModels, gate, activeExpert, convs]);

    async function copyMsg(content: string): Promise<void> {
        try {
            await navigator.clipboard.writeText(content);
            toast.success(t("ai.copied"));
        } catch {
            toast.error(t("toast.error"));
        }
    }

    // 消息行渲染：多轮是连续对话流（回答块以分隔线相隔），单轮把一对问答包进卡片，
    // 卡内问题行保持 > 前缀、回答紧随其下（separated=false 时不再画内部分隔线）
    function renderUserMsg(m: Msg) {
        return (
            <div className="whitespace-pre-wrap break-words text-[13px] text-dim">
                <span className="mr-1.5 text-muted">&gt;</span>
                {m.content}
            </div>
        );
    }

    function renderAssistantMsg(m: Msg, separated: boolean) {
        return (
            <div
                className={`group flex flex-col gap-1 ${separated ? "border-t border-line pt-2 first:border-0 first:pt-0" : ""}`}
            >
                {!!m.reasoning && (
                    <details className="rounded-xs border border-dashed border-line bg-faint px-2 py-1">
                        <summary className="cursor-pointer select-none text-[11.5px] text-muted">
                            {t("ai.thinking")}
                        </summary>
                        <div className="mt-1 whitespace-pre-wrap break-words text-[12px] leading-relaxed text-muted">
                            {m.reasoning}
                        </div>
                    </details>
                )}
                <div className="break-words text-[13.5px] leading-relaxed text-text [&_a]:underline [&_li]:ml-4 [&_ul]:list-disc">
                    {/* react-markdown v10 无顶层 className，样式挂在包裹层 */}
                    <Markdown
                        components={{
                            pre: ({ node: _node, ...rest }) => (
                                <pre
                                    {...rest}
                                    className="overflow-auto rounded-xs border border-line bg-faint p-2 font-mono text-[12.5px]"
                                />
                            ),
                            code: ({ node: _node, ...rest }) => <code {...rest} className="font-mono text-[12.5px]" />,
                        }}
                    >
                        {m.content}
                    </Markdown>
                </div>
                <div className="flex items-center gap-2">
                    {m.status === "stopped" && <span className="text-[11px] text-muted">〔{t("ai.stopped")}〕</span>}
                    {m.status === "error" &&
                        (() => {
                            const k = aiErrKey(m.errStatus);
                            return (
                                <span className="text-[12px] text-destructive">
                                    {k ? t(k) : `${t("ai.err.other")}: ${m.errStatus}`}
                                </span>
                            );
                        })()}
                    {/* 完成或已停止的回答都可复制（流式中不显示） */}
                    {(!m.status || m.status === "stopped") && m.content && (
                        <button
                            type="button"
                            className="-my-0.5 ml-auto text-muted opacity-60 hover:text-text group-hover:opacity-100"
                            title={t("ai.copy")}
                            onClick={() => void copyMsg(m.content)}
                        >
                            <Copy size={13} />
                        </button>
                    )}
                </div>
            </div>
        );
    }

    return (
        <div className="flex h-full">
            {/* ── 左栏：专家纯列表 ── */}
            <aside className="flex w-52 flex-none flex-col border-r border-line">
                <div className="min-h-0 flex-1 overflow-y-auto">
                    {experts.length === 0 ? (
                        <div className="flex flex-col items-center gap-2 px-3 py-6 text-center">
                            <span className="text-[12px] text-muted">{t("ai.noExperts")}</span>
                        </div>
                    ) : (
                        experts.map((e) => (
                            // 行本体用 div 承载点击（里面还要放编辑小按钮，button 不能嵌套
                            // button——与 ToolsZone/TerminalZone 的行结构同一取舍）。
                            // 选中样式对齐设置对话框分节导航：左侧粗边框是最强信号，悬浮只有字色变化
                            <div
                                key={e.id}
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
                                className={`flex w-full cursor-default items-center gap-1.5 border-l-2 px-2 py-1.5 text-left text-[13px] ${
                                    e.id === activeId
                                        ? "border-text bg-faint text-text"
                                        : "border-transparent text-muted hover:text-dim"
                                }`}
                            >
                                {/* 该专家正在流式：克制的呼吸圆点，颜色随行文字 */}
                                {convStreaming(e.id) && (
                                    <span className="size-1.5 flex-none animate-pulse rounded-full bg-current" />
                                )}
                                <span className="min-w-0 flex-1 truncate">{e.name}</span>
                                <span className="flex-none text-[10.5px] text-muted">
                                    {t(e.multi ? "ai.modeMulti" : "ai.modeSingle")}
                                </span>
                                <button
                                    type="button"
                                    className="flex-none px-0.5 text-muted hover:text-text"
                                    title={t("ai.editExpert")}
                                    onClick={(ev) => {
                                        ev.stopPropagation();
                                        setEditing(e.id);
                                    }}
                                >
                                    ✎
                                </button>
                            </div>
                        ))
                    )}
                </div>
                <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    className="mx-1.5 my-1.5"
                    onClick={() => setEditing("new")}
                >
                    ＋ {t("ai.newExpert")}
                </Button>
            </aside>

            {/* ── 右栏：头部 + 会话 + 输入 ── */}
            <section className="flex min-w-0 flex-1 flex-col gap-2 p-3">
                {!noModelsConfigured && activeExpert && (
                    <header className="flex flex-none items-center gap-2">
                        <span className="min-w-0 truncate text-[13px] text-text">{activeExpert.name}</span>
                        <span className="flex-none text-[10.5px] text-muted">
                            {t(activeExpert.multi ? "ai.modeMulti" : "ai.modeSingle")}
                        </span>
                        <span className="flex-1" />
                        {/* 会话内模型临时切换：只改 conv.override 不写回专家；换模型历史照常携带 */}
                        <select
                            className={`${inputCls} w-56 flex-none px-1 py-0.5 text-[12px]`}
                            value={effectiveModel(activeExpert) || NO_MODEL}
                            onChange={(e) => setOverride(activeExpert.id, e.target.value || null)}
                            title={t("ai.bindModel")}
                        >
                            <option value={NO_MODEL} disabled>
                                {t("ai.unbound")}
                            </option>
                            {(aiModels ?? []).map((m) => (
                                <option key={m.id} value={m.id}>
                                    {PROVIDER_LABEL[m.provider]} · {m.model}
                                </option>
                            ))}
                        </select>
                        {/* 单轮/多轮都给清空：单轮的历史同样需要一键重来 */}
                        <Button
                            type="button"
                            variant="outline"
                            size="xs"
                            onClick={() => activeId != null && clearConv(activeId)}
                        >
                            {t("ai.clear")}
                        </Button>
                    </header>
                )}

                {noModelsConfigured ? (
                    /* 无任何模型配置：TranslateTool 式引导直达设置页（实心 CTA） */
                    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3">
                        <span className="text-[13px] text-text">{t("ai.errNoModels")}</span>
                        <Button type="button" size="sm" className="px-4" onClick={() => openSettings?.()}>
                            {t("translate.openSettings")}
                        </Button>
                    </div>
                ) : !activeExpert ? (
                    <div className="flex min-h-0 flex-1 items-center justify-center text-[12px] text-muted">
                        {experts.length === 0 ? t("ai.noExperts") : ""}
                    </div>
                ) : (
                    <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto pr-1">
                        <div className="flex flex-col gap-3 pb-1">
                            {activeExpert.multi
                                ? (convs[activeExpert.id]?.msgs ?? []).map((msg, i) =>
                                      msg.role === "user" ? (
                                          <Fragment key={i}>{renderUserMsg(msg)}</Fragment>
                                      ) : (
                                          <Fragment key={i}>{renderAssistantMsg(msg, true)}</Fragment>
                                      ),
                                  )
                                : pairUp(convs[activeExpert.id]?.msgs ?? []).map((pair, gi) => (
                                      /* 单轮：一问一答一张卡片，卡间用外层 gap 分隔 */
                                      <div key={gi} className="rounded-sm border border-line p-2.5">
                                          {pair.map((msg, mi) => (
                                              <Fragment key={mi}>
                                                  {msg.role === "user"
                                                      ? renderUserMsg(msg)
                                                      : renderAssistantMsg(msg, false)}
                                              </Fragment>
                                          ))}
                                      </div>
                                  ))}
                        </div>
                    </div>
                )}

                {/* 行内门禁提示（有界问题就地给出路） */}
                {gate === "unbound" && !noModelsConfigured && activeExpert && (
                    <div className="flex flex-none items-center gap-2 text-[12px] text-destructive">
                        {t("ai.errUnbound")}
                        <Button type="button" variant="outline" size="xs" onClick={() => setEditing(activeExpert.id)}>
                            {t("ai.editExpert")}
                        </Button>
                    </div>
                )}

                {/* 输入区：流式中发送按钮变停止；Enter 发送 Shift+Enter 换行 */}
                <div className="flex flex-none items-end gap-2">
                    <textarea
                        ref={textareaRef}
                        className={`${inputCls} h-16 min-w-0 flex-1 resize-none px-2 py-1.5 leading-relaxed`}
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
                    {/* 主操作实心：发送/停止同一颗按钮随流式状态切换（disabled 半透明由 Button 自带） */}
                    <Button
                        type="button"
                        size="xs"
                        className="flex-none px-3"
                        disabled={!streaming && !draft.trim()}
                        onClick={() => {
                            if (streaming && activeId != null) stopExpertStreams(activeId);
                            else void send(draft);
                        }}
                    >
                        {streaming ? t("ai.stop") : t("ai.send")}
                    </Button>
                </div>
            </section>

            {/* 编辑对话框：新建/修改共用，编辑态自持关闭即丢 */}
            {editing !== null && (
                <EditExpertDialog target={editing} models={aiModels} onClose={() => setEditing(null)} />
            )}
        </div>
    );
}
