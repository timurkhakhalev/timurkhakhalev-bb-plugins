import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  definePluginApp,
  experimental_CollapsibleStackCard as CollapsibleStackCard,
  experimental_useAppPanel,
  experimental_usePanelTabs,
  experimental_usePluginId,
  useComposer,
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
  type ExperimentalPluginBrowserPage,
  type ExperimentalPluginBrowserToolbarActionProps,
  type JsonValue,
} from "@get-bb/plugin-sdk/app";
import {
  batchSchema,
  reactComponentSchema,
  type DesignChange,
  type LiveAnnotation,
  type rpcContract,
} from "./contracts.js";
import { planMentionReconciliation, removeMentionsFromDraft } from "./composer.js";
import {
  activateExpression,
  pageCalls,
  reactProbeExpression,
  type PageState,
  type PageTheme,
} from "./page-script.js";
import { z } from "zod";

type SessionEvent = {
  threadId?: string;
  status?: "sent" | "discarded";
  count?: number;
  batchId?: string;
};

const MENTION_PROVIDER = "browser-comments";

/**
 * Live page sessions by thread, so the composer hover card can edit or delete
 * annotations that are still on the page.
 */
type LiveSession = {
  batchId: string;
  open(annotationId: string): Promise<boolean>;
  remove(annotationId: string): Promise<boolean>;
};
const liveSessions = new Map<string, LiveSession>();
const liveSessionListeners = new Set<() => void>();
function setLiveSession(threadId: string, session: LiveSession | null) {
  if (session) liveSessions.set(threadId, session);
  else liveSessions.delete(threadId);
  for (const listener of liveSessionListeners) listener();
}

/** Dashed element box with a pointer: "pick something on the page". */
const annotateIcon = (
  <svg
    aria-hidden
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="size-4"
  >
    <path d="M14 3.5H6A2.5 2.5 0 0 0 3.5 6v8a2.5 2.5 0 0 0 2.5 2.5h3" strokeDasharray="2.6 2.6" />
    <path d="M17.5 9.5V6A2.5 2.5 0 0 0 15 3.5" strokeDasharray="2.6 2.6" />
    <path d="m12.2 12.2 8.6 3.1-3.7 1.6-1.6 3.7z" fill="currentColor" />
  </svg>
);

const pageStateSchema = z
  .object({
    active: z.boolean(),
    count: z.number().int().min(0),
    revision: z.number().int().min(0),
    url: z.string(),
    startUrl: z.string(),
  })
  .passthrough();
const probeResultSchema = z
  .object({ components: z.array(reactComponentSchema).max(12) })
  .nullable();
const pageMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("changed"), revision: z.number() }),
  z.object({ type: z.literal("committed"), annotationId: z.string().min(1).max(256) }),
  z.object({ type: z.literal("cancel") }),
]);

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function errorText(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : typeof error === "string" ? error : fallback;
}

function readTheme(): PageTheme | null {
  if (typeof document === "undefined" || typeof CSS === "undefined") return null;
  const computed = getComputedStyle(document.documentElement);
  const color = (name: string, fallback: string) => {
    const value = computed.getPropertyValue(name).trim();
    return value && CSS.supports("color", value) ? value : fallback;
  };
  return {
    surface: color("--popover", "rgba(20,22,28,.96)"),
    text: color("--popover-foreground", "#e8eaf0"),
    muted: color("--muted-foreground", "#9aa0ad"),
    accent: "#3b82f6",
    border: color("--border", "rgba(255,255,255,.12)"),
    field: color("--muted", "rgba(255,255,255,.06)"),
  };
}

function LoadingLabel({ children }: { children: React.ReactNode }) {
  return <span role="status" className="inline-flex items-center gap-1.5">
    <svg aria-hidden viewBox="0 0 16 16" className="size-3.5 shrink-0 motion-safe:animate-spin" fill="none">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" opacity="0.25" />
      <path d="M8 2a6 6 0 0 1 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
    {children}
  </span>;
}

const MOTION = "transition-[background-color,color,opacity,transform,max-width] duration-200 ease-[cubic-bezier(.2,.8,.2,1)] motion-reduce:transition-none";

function BrowserAnnotateAction({
  threadId,
  tabId,
  url,
  experimental_page: page,
}: ExperimentalPluginBrowserToolbarActionProps) {
  const tooltipId = useId();
  const rpc = useRpc<typeof rpcContract>();
  const pageRef = useRef<ExperimentalPluginBrowserPage | null>(page);
  pageRef.current = page;
  const activeRef = useRef(false);
  const batchIdRef = useRef<string | null>(null);
  const activatingRef = useRef<Promise<void> | null>(null);
  const syncTailRef = useRef<Promise<void>>(Promise.resolve());
  const syncQueuedRef = useRef(false);
  const [active, setActive] = useState(false);
  const [count, setCount] = useState(0);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [missingCaptures, setMissingCaptures] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const busy = pendingAction !== null;

  const evaluate = useCallback(async (expression: string, world?: "main") => {
    const current = pageRef.current;
    if (!current) throw new Error("Annotate works in Browser tabs of the desktop app");
    return current.evaluate(expression, world ? { world } : undefined);
  }, []);

  /** Push the page's annotations to the server and screenshot new versions. */
  const runSync = useCallback(async () => {
    const batchId = batchIdRef.current;
    if (!batchId) return;
    const raw = await evaluate(pageCalls.snapshot());
    if (raw === null) return;
    const batch = batchSchema.parse(raw);
    setCount(batch.annotations.length);
    const { missingCaptures: missing } = await rpc.call("sync", { threadId, batchId, batch });
    setMissingCaptures(missing.length);
    if (missing.length === 0) return;
    setCapturing(true);
    try {
      // Let the popover fade out and markers settle before the screenshot.
      await sleep(240);
      await evaluate(pageCalls.setCapturing(true));
      const { captured } = await rpc.call("capture", { threadId, tabId, batchId, annotations: missing });
      setMissingCaptures(missing.length - captured.length);
    } finally {
      await evaluate(pageCalls.setCapturing(false)).catch(() => undefined);
      setCapturing(false);
    }
  }, [evaluate, rpc, tabId, threadId]);

  const scheduleSync = useCallback(() => {
    if (syncQueuedRef.current) return syncTailRef.current;
    syncQueuedRef.current = true;
    const next = syncTailRef.current
      .catch(() => undefined)
      .then(async () => {
        syncQueuedRef.current = false;
        await runSync();
      })
      .catch((error: unknown) => {
        setErrorMessage(errorText(error, "Could not save annotations"));
      });
    syncTailRef.current = next;
    return next;
  }, [runSync]);

  const probeComponents = useCallback(async (annotationId: string) => {
    try {
      const token = `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      if ((await evaluate(pageCalls.tagForProbe(annotationId, token))) !== true) return;
      const probe = probeResultSchema.safeParse(await evaluate(reactProbeExpression(token), "main"));
      if (probe.success && probe.data && probe.data.components.length > 0) {
        await evaluate(pageCalls.setComponents(annotationId, probe.data.components));
      }
    } catch {
      // React names are a hint; the annotation is useful without them.
    }
  }, [evaluate]);

  const deactivatePage = useCallback(async () => {
    activeRef.current = false;
    setActive(false);
    await evaluate(pageCalls.cleanup()).catch(() => undefined);
  }, [evaluate]);

  const activate = useCallback(async (pageUrl: string) => {
    if (activatingRef.current) return activatingRef.current;
    const run = (async () => {
      const { batchId, batch } = await rpc.call("start", { threadId, url: pageUrl });
      if (!pageRef.current) return;
      const state = pageStateSchema.extend({ restored: z.boolean() }).parse(
        await evaluate(activateExpression({ restore: batch, theme: readTheme() })),
      );
      // A restore that missed (redirect, different document) must not overwrite
      // the stored draft with an empty page.
      batchIdRef.current = batch && !state.restored
        ? `batch_${Date.now().toString(36)}_${crypto.randomUUID()}`
        : batchId;
      activeRef.current = true;
      setActive(true);
      setCount(state.count);
      setErrorMessage(null);
      if (state.restored) void scheduleSync();
    })();
    activatingRef.current = run;
    try {
      await run;
    } finally {
      activatingRef.current = null;
    }
  }, [evaluate, rpc, scheduleSync, threadId]);

  // Page messages: batch changed, an annotation was saved, Escape.
  useEffect(() => {
    if (!page) return;
    return page.onMessage((data: JsonValue) => {
      const parsed = pageMessageSchema.safeParse(data);
      if (!parsed.success || !activeRef.current) return;
      const message = parsed.data;
      if (message.type === "changed") {
        void scheduleSync();
      } else if (message.type === "committed") {
        setErrorMessage(null);
        void probeComponents(message.annotationId).then(() => scheduleSync());
      } else if (message.type === "cancel") {
        activeRef.current = false;
        setActive(false);
      }
    });
  }, [page, probeComponents, scheduleSync]);

  // Reload or navigation drops the page script; restore the draft for the new document.
  useEffect(() => {
    if (!active || !page) return;
    let stopped = false;
    const check = async () => {
      if (stopped || activatingRef.current) return;
      try {
        const raw = await evaluate(pageCalls.state());
        if (stopped || !activeRef.current) return;
        const state = raw === null ? null : pageStateSchema.parse(raw as PageState);
        if (state && state.url === state.startUrl) return;
        if (state) await evaluate(pageCalls.cleanup()).catch(() => undefined);
        await syncTailRef.current.catch(() => undefined);
        await activate(state?.url ?? url);
      } catch (error) {
        if (!stopped) setErrorMessage(errorText(error, "Could not reach the page"));
      }
    };
    void check();
    const timer = window.setInterval(() => void check(), 1000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [activate, active, evaluate, page, url]);

  // Leaving the tab or thread turns the picker off; the draft stays stored.
  useEffect(() => () => {
    if (activeRef.current) {
      activeRef.current = false;
      void pageRef.current?.evaluate(pageCalls.cleanup()).catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    if (!active || !batchIdRef.current) return;
    const batchId = batchIdRef.current;
    setLiveSession(threadId, {
      batchId,
      open: async (annotationId) => (await evaluate(pageCalls.open(annotationId))) === true,
      remove: async (annotationId) => (await evaluate(pageCalls.remove(annotationId))) === true,
    });
    return () => {
      if (liveSessions.get(threadId)?.batchId === batchId) setLiveSession(threadId, null);
    };
  }, [active, count, evaluate, threadId]);

  useRealtime(
    "annotate-session",
    useCallback(
      (rawPayload) => {
        const payload = rawPayload as SessionEvent;
        if (payload.threadId !== threadId || !payload.status) return;
        if (payload.batchId !== batchIdRef.current || !activeRef.current) return;
        void deactivatePage();
      },
      [deactivatePage, threadId],
    ),
  );

  const run = useCallback(async (label: string, action: () => Promise<void>, fallback: string) => {
    if (pendingAction) return;
    setPendingAction(label);
    setErrorMessage(null);
    try {
      await action();
    } catch (error) {
      setErrorMessage(errorText(error, fallback));
    } finally {
      setPendingAction(null);
    }
  }, [pendingAction]);

  const toggle = () => run(active ? "Stopping…" : "Starting…", async () => {
    if (active) {
      await syncTailRef.current;
      await deactivatePage();
    } else {
      await activate(url);
    }
  }, "Could not start annotating");

  const send = () => run("Sending…", async () => {
    await scheduleSync();
    const batchId = batchIdRef.current;
    if (!batchId) return;
    const result = await rpc.call("send", { threadId, batchId });
    if (!result.sent) throw new Error("Add at least one annotation before sending");
    await deactivatePage();
  }, "Could not send annotations");

  const sending = pendingAction === "Sending…";
  const showSend = active && (count > 0 || sending);
  const actionLabel = errorMessage ?? pendingAction ?? (page === null
    ? "Annotate works in Browser tabs of the desktop app"
    : active ? "Stop annotating (Esc)" : "Annotate page elements");

  return (
    <span className="inline-flex shrink-0 items-center gap-1">
      <span className="group relative inline-flex shrink-0">
        <button
          type="button"
          className={`relative inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs ${MOTION} hover:bg-state-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring active:scale-[.96] disabled:opacity-40 ${active ? "bg-blue-500/10 text-blue-500" : errorMessage ? "text-destructive" : "text-muted-foreground hover:text-foreground"}`}
          aria-label={actionLabel}
          aria-describedby={tooltipId}
          aria-pressed={active}
          aria-busy={busy}
          disabled={busy || page === null}
          onClick={() => void toggle()}
        >
          {busy && !sending ? <LoadingLabel><span className="hidden xl:inline">{pendingAction}</span></LoadingLabel> : <>
            {annotateIcon}
            <span className="hidden xl:inline">{active ? "Annotating" : "Annotate"}</span>
          </>}
          <span
            aria-hidden
            className={`absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-500 px-1 text-[10px] font-semibold leading-none text-white shadow-sm transition-[opacity,transform] duration-300 ease-[cubic-bezier(.34,1.56,.64,1)] motion-reduce:transition-none ${active && count > 0 ? "scale-100 opacity-100" : "scale-50 opacity-0"}`}
          >
            {count || ""}
          </span>
        </button>
        <span
          id={tooltipId}
          role="tooltip"
          className="pointer-events-none invisible absolute right-full top-1/2 z-50 mr-2 -translate-y-1/2 translate-x-1 whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-xs text-popover-foreground opacity-0 shadow-md transition-[opacity,transform] duration-150 ease-out group-hover:visible group-hover:translate-x-0 group-hover:opacity-100 group-focus-within:visible group-focus-within:translate-x-0 group-focus-within:opacity-100 motion-reduce:transition-none"
        >
          {actionLabel}
        </span>
      </span>
      <button
        type="button"
        aria-hidden={!showSend}
        tabIndex={showSend ? 0 : -1}
        disabled={!showSend || busy}
        title={missingCaptures > 0 && !capturing ? "Some screenshots failed; they are retried on send" : undefined}
        onClick={() => void send()}
        className={`inline-flex h-7 shrink-0 items-center overflow-hidden whitespace-nowrap rounded-md bg-blue-500 text-xs font-semibold text-white ${MOTION} hover:bg-blue-400 active:scale-[.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 disabled:cursor-default ${showSend ? "max-w-32 px-2.5 opacity-100" : "pointer-events-none max-w-0 scale-90 px-0 opacity-0"}`}
      >
        {sending ? <LoadingLabel>Sending…</LoadingLabel> : capturing ? <LoadingLabel>Capturing…</LoadingLabel> : `Send ${count}`}
      </button>
    </span>
  );
}

function pluralizeAnnotations(count: number) {
  return `${count} annotation${count === 1 ? "" : "s"}`;
}

/** Keep one composer mention per pending batch; removing the pill discards the batch. */
function useBrowserAnnotationsComposerSync() {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const rpc = useRpc<typeof rpcContract>();
  const composer = useComposer();
  const pluginId = experimental_usePluginId();
  const connectionState = useRealtimeConnectionState();
  const composerRef = useRef(composer);
  composerRef.current = composer;
  const [pendingRevision, setPendingRevision] = useState(0);
  const requestedMentionsRef = useRef(new Map<string, string>());
  const observedMentionsRef = useRef(new Set<string>());
  const pollErrorRef = useRef(false);
  /** Mentions that left the draft because the message was submitted, not deleted. */
  const submittedRef = useRef(new Set<string>());
  const threadId = composer.scope.kind === "thread" ? composer.scope.threadId : null;
  const isOwnMention = useCallback(
    (mention: (typeof composer.draft.mentions)[number]) =>
      mention.kind === "plugin" && mention.pluginId === pluginId && mention.provider === MENTION_PROVIDER,
    [pluginId],
  );
  const browserMentions = composer.draft.mentions.flatMap((mention) =>
    mention.kind === "plugin" && isOwnMention(mention)
      ? [{ from: mention.from, to: mention.to, id: mention.id, label: mention.label }]
      : [],
  );
  const mentionsKey = JSON.stringify(browserMentions.map((mention) => [mention.id, mention.label]));

  useEffect(() => {
    requestedMentionsRef.current = new Map();
    observedMentionsRef.current = new Set();
    submittedRef.current = new Set();
    pollErrorRef.current = false;
  }, [threadId]);

  useEffect(() => composer.onSubmitted(() => {
    for (const id of observedMentionsRef.current) submittedRef.current.add(id);
  }), [composer]);

  useEffect(() => {
    if (!threadId) return;
    let disposed = false;
    void (async () => {
      try {
        const live = await rpc.call("pending", { threadId });
        if (disposed) return;
        const current = composerRef.current;
        const mentions = current.draft.mentions.flatMap((mention) =>
          mention.kind === "plugin" && isOwnMention(mention)
            ? [{ from: mention.from, to: mention.to, id: mention.id, label: mention.label }]
            : [],
        );
        const plan = planMentionReconciliation(
          mentions,
          live.batches.map((batch) => ({ id: batch.id, label: pluralizeAnnotations(batch.count) })),
          observedMentionsRef.current,
          requestedMentionsRef.current,
        );
        observedMentionsRef.current = plan.observed;
        requestedMentionsRef.current = plan.requested;
        if (plan.remove.length > 0) {
          const removeIds = new Set(plan.remove.map((mention) => `${mention.from}:${mention.to}`));
          current.replace((draft) =>
            removeMentionsFromDraft(draft, (mention) =>
              mention.kind === "plugin" && isOwnMention(mention) && removeIds.has(`${mention.from}:${mention.to}`),
            ),
          );
        }
        if (plan.insert.length > 0) {
          const needsSpace = current.text.length > 0 && !/\s$/.test(current.text);
          current.insert(
            [
              ...(needsSpace ? [" "] : []),
              ...plan.insert.flatMap((batch) => [
                { provider: MENTION_PROVIDER, id: batch.id, label: batch.label },
                " ",
              ]),
            ],
            { at: "end" },
          );
        }
        const pendingIds = new Set(live.batches.map((batch) => batch.id));
        for (const id of [...submittedRef.current]) {
          if (!pendingIds.has(id)) submittedRef.current.delete(id);
        }
        for (const batchId of plan.discard) {
          if (submittedRef.current.has(batchId)) continue;
          await rpc.call("discard", { threadId, batchId });
        }
        pollErrorRef.current = false;
        setErrorMessage(null);
      } catch (error) {
        if (!pollErrorRef.current) {
          pollErrorRef.current = true;
          setErrorMessage(errorText(error, "Could not sync browser annotations"));
        }
      }
    })();
    return () => {
      disposed = true;
    };
  }, [connectionState, isOwnMention, mentionsKey, pendingRevision, rpc, threadId]);

  useRealtime("annotate-pending", useCallback((rawPayload) => {
    if ((rawPayload as { threadId?: string }).threadId === threadId) {
      setPendingRevision((revision) => revision + 1);
    }
  }, [threadId]));

  useRealtime(
    "annotate-session",
    useCallback(
      (rawPayload) => {
        const payload = rawPayload as SessionEvent;
        if (!threadId || payload.threadId !== threadId || !payload.status || !payload.batchId) return;
        const batchId = payload.batchId;
        composerRef.current.replace((draft) =>
          removeMentionsFromDraft(draft, (mention) =>
            mention.kind === "plugin" && isOwnMention(mention) && mention.id === batchId,
          ),
        );
        requestedMentionsRef.current.delete(batchId);
        observedMentionsRef.current.delete(batchId);
      },
      [isOwnMention, threadId],
    ),
  );
  return errorMessage;
}

function DesignChangeDetails({ designChange }: { designChange: DesignChange | null }) {
  if (!designChange) return null;
  const changes = [
    ...(designChange.text ? [{ property: "Text", ...designChange.text }] : []),
    ...designChange.declarations.map((change) => ({
      property: change.property,
      previousValue: change.previousValue,
      value: change.value,
    })),
  ];
  if (changes.length === 0) return null;
  return (
    <div className="mt-1 space-y-0.5 rounded bg-muted/60 px-1.5 py-1 font-mono text-[10px] leading-4">
      {changes.map((change) => (
        <div key={change.property} className="grid grid-cols-[minmax(5rem,auto)_1fr] gap-2">
          <span className="truncate text-muted-foreground">{change.property}</span>
          <span className="min-w-0 break-words">
            <span className="text-muted-foreground line-through">{change.previousValue}</span>
            <span aria-hidden className="px-1 text-muted-foreground">→</span>
            <span>{change.value}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

const editIcon = (
  <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-3.5">
    <path d="m4 20 4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10L4 20Z" />
  </svg>
);
const deleteIcon = (
  <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-3.5">
    <path d="M4 7h16M9 7V4h6v3m-9 0 1 13h10l1-13M10 11v5m4-5v5" />
  </svg>
);

function AnnotationRow({
  annotation,
  index,
  onEdit,
  onDelete,
}: {
  annotation: LiveAnnotation;
  index: number;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  return (
    <div className="border-b border-border px-1.5 py-1.5 last:border-b-0">
      <div className="flex items-start gap-2">
        {annotation.previewDataUrl ? (
          <img
            src={annotation.previewDataUrl}
            alt=""
            className="size-7 shrink-0 rounded border border-border object-cover"
          />
        ) : (
          <div className="flex size-7 shrink-0 items-center justify-center rounded border border-border bg-muted text-[10px] text-muted-foreground">
            {index + 1}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[11px] leading-4 text-muted-foreground">
            <span className="rounded bg-muted px-1">{annotation.tag}</span>
            <span className="truncate">{annotation.target}</span>
          </div>
          {annotation.comment ? (
            <p className="mt-0.5 line-clamp-3 whitespace-pre-wrap text-xs leading-4">{annotation.comment}</p>
          ) : null}
          <DesignChangeDetails designChange={annotation.designChange} />
        </div>
        {onEdit || onDelete ? (
          <div className="flex shrink-0 items-center">
            {onEdit ? (
              <button
                type="button"
                className="rounded p-1 text-muted-foreground hover:bg-state-hover hover:text-foreground"
                aria-label={`Edit annotation ${index + 1}`}
                onClick={onEdit}
              >
                {editIcon}
              </button>
            ) : null}
            {onDelete ? (
              <button
                type="button"
                className="rounded p-1 text-muted-foreground hover:bg-state-hover hover:text-destructive"
                aria-label={`Delete annotation ${index + 1}`}
                onClick={onDelete}
              >
                {deleteIcon}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function useLiveSession(threadId: string | null) {
  const [session, setSession] = useState<LiveSession | null>(() =>
    threadId ? liveSessions.get(threadId) ?? null : null,
  );
  useEffect(() => {
    const update = () => setSession(threadId ? liveSessions.get(threadId) ?? null : null);
    update();
    liveSessionListeners.add(update);
    return () => {
      liveSessionListeners.delete(update);
    };
  }, [threadId]);
  return session;
}

function SentAnnotationsHover() {
  const syncError = useBrowserAnnotationsComposerSync();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const rpc = useRpc<typeof rpcContract>();
  const composer = useComposer();
  const threadId = composer.scope.kind === "thread" ? composer.scope.threadId : null;
  const liveSession = useLiveSession(threadId);
  const closeTimerRef = useRef<number | null>(null);
  const requestRef = useRef(0);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [sent, setSent] = useState(true);
  const [annotations, setAnnotations] = useState<LiveAnnotation[]>([]);
  const [loading, setLoading] = useState(false);
  const [popupStyle, setPopupStyle] = useState<React.CSSProperties>({});
  const editable = Boolean(batchId && !sent);
  const onPage = Boolean(batchId && liveSession?.batchId === batchId);

  const cancelClose = useCallback(() => {
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
  }, []);

  const reset = useCallback(() => {
    setAnchor(null);
    setBatchId(null);
    setSent(true);
    setAnnotations([]);
  }, []);

  const closeSoon = useCallback(() => {
    cancelClose();
    closeTimerRef.current = window.setTimeout(reset, 140);
  }, [cancelClose, reset]);

  useEffect(() => {
    const batchIdFor = (target: EventTarget | null) => {
      if (!(target instanceof Element)) return null;
      const pill = target.closest<HTMLElement>('[data-prompt-mention="true"]');
      if (!pill) return null;
      try {
        const resource = JSON.parse(
          pill.getAttribute("data-prompt-mention-resource") ?? "null",
        ) as { kind?: string; itemId?: string } | null;
        const prefix = `${MENTION_PROVIDER}:`;
        if (resource?.kind !== "plugin" || !resource.itemId?.startsWith(prefix)) return null;
        return { pill, batchId: resource.itemId.slice(prefix.length) };
      } catch {
        return null;
      }
    };

    const enter = (event: MouseEvent) => {
      const match = batchIdFor(event.target);
      if (!match) return;
      if (event.relatedTarget instanceof Node && match.pill.contains(event.relatedTarget)) return;
      cancelClose();
      const rect = match.pill.getBoundingClientRect();
      const viewportGutter = 12;
      const popoverWidth = Math.min(
        300,
        window.innerWidth - viewportGutter * 2,
        rect.right - viewportGutter,
      );
      setAnchor(match.pill);
      setPopupStyle({
        left: Math.max(viewportGutter, rect.right - popoverWidth),
        width: popoverWidth,
        ...(rect.top > 360
          ? { bottom: window.innerHeight - rect.top + 8 }
          : { top: rect.bottom + 8 }),
      });
      const request = ++requestRef.current;
      if (!threadId) return;
      setBatchId(match.batchId);
      setAnnotations([]);
      setErrorMessage(null);
      setLoading(true);
      void rpc.call("batch", { threadId, batchId: match.batchId }).then((result) => {
        if (request === requestRef.current) {
          setLoading(false);
          setSent(result.sent);
          setAnnotations(result.annotations);
        }
      }).catch((error: unknown) => {
        if (request === requestRef.current) {
          setLoading(false);
          setErrorMessage(errorText(error, "Could not load annotations"));
        }
      });
    };
    const leave = (event: MouseEvent) => {
      const match = batchIdFor(event.target);
      if (!match) return;
      if (event.relatedTarget instanceof Node && match.pill.contains(event.relatedTarget)) return;
      closeSoon();
    };
    document.addEventListener("mouseover", enter);
    document.addEventListener("mouseout", leave);
    return () => {
      document.removeEventListener("mouseover", enter);
      document.removeEventListener("mouseout", leave);
      cancelClose();
    };
  }, [cancelClose, closeSoon, rpc, threadId]);

  const editAnnotation = useCallback(async (annotationId: string) => {
    if (!onPage || !liveSession) return;
    try {
      if (!(await liveSession.open(annotationId))) {
        setErrorMessage("This annotation target is no longer available on the page");
        return;
      }
      reset();
    } catch (error) {
      setErrorMessage(errorText(error, "Could not open annotation"));
    }
  }, [liveSession, onPage, reset]);

  const deleteAnnotation = useCallback(async (annotationId: string) => {
    if (!threadId || !batchId || !editable) return;
    try {
      const changed = onPage && liveSession
        ? await liveSession.remove(annotationId)
        : (await rpc.call("remove", { threadId, batchId, annotationId })).changed;
      if (!changed) return;
      const next = annotations.filter((annotation) => annotation.id !== annotationId);
      setAnnotations(next);
      if (next.length === 0) reset();
    } catch (error) {
      setErrorMessage(errorText(error, "Could not delete annotation"));
    }
  }, [annotations, batchId, editable, liveSession, onPage, reset, rpc, threadId]);

  if (!anchor) return syncError ? <span role="status" className="text-xs text-destructive">{syncError}</span> : null;
  if (annotations.length === 0 && !errorMessage && !loading) return null;
  return createPortal(
    <div
      data-browser-annotations-popover=""
      data-bb-plugin-root=""
      data-bb-plugin="browser-annotate"
      data-bb-portaled-overlay=""
      className="fixed z-[1100] max-h-[min(20rem,60vh)] max-w-[calc(100vw-24px)] overflow-y-auto rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-xl"
      style={popupStyle}
      onMouseEnter={cancelClose}
      onMouseLeave={closeSoon}
    >
      {loading ? <p className="p-1.5 text-xs text-muted-foreground"><LoadingLabel>Loading annotations…</LoadingLabel></p> : null}
      {errorMessage ? <p role="status" className="p-2 text-xs text-destructive">{errorMessage}</p> : null}
      {annotations.map((annotation, index) => (
        <AnnotationRow
          key={annotation.id}
          annotation={annotation}
          index={index}
          onEdit={editable && onPage ? () => void editAnnotation(annotation.id) : undefined}
          onDelete={editable ? () => void deleteAnnotation(annotation.id) : undefined}
        />
      ))}
    </div>,
    document.body,
  );
}

type PendingSummary = {
  id: string;
  label: string;
  count: number;
  url: string;
  title: string;
};

/** Same page, ignoring the hash: the address bar can add or drop one. */
function samePage(left: string, right: string) {
  try {
    const a = new URL(left);
    const b = new URL(right);
    a.hash = "";
    b.hash = "";
    return a.href === b.href;
  } catch {
    return left === right;
  }
}

/** Unsent annotations of this thread, as cards in the stack above the composer. */
function PendingAnnotationsBanner() {
  const { scope } = useComposer();
  return scope.kind === "thread" ? <PendingAnnotationsCards threadId={scope.threadId} /> : null;
}

function PendingAnnotationsCards({ threadId }: { threadId: string }) {
  const rpc = useRpc<typeof rpcContract>();
  const connectionState = useRealtimeConnectionState();
  const [revision, setRevision] = useState(0);
  const [batches, setBatches] = useState<PendingSummary[]>([]);

  useEffect(() => {
    let disposed = false;
    rpc.call("pending", { threadId }).then(
      (result) => {
        if (!disposed) setBatches(result.batches);
      },
      () => undefined,
    );
    return () => {
      disposed = true;
    };
  }, [connectionState, revision, rpc, threadId]);

  const bump = useCallback((rawPayload: unknown) => {
    if ((rawPayload as { threadId?: string }).threadId === threadId) setRevision((value) => value + 1);
  }, [threadId]);
  useRealtime("annotate-pending", bump);
  useRealtime("annotate-session", bump);

  return <>{batches.map((batch) => (
    <PendingAnnotationsCard key={batch.id} threadId={threadId} summary={batch} revision={revision} />
  ))}</>;
}

function PendingAnnotationsCard({
  threadId,
  summary,
  revision,
}: {
  threadId: string;
  summary: PendingSummary;
  revision: number;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const composer = useComposer();
  const pluginId = experimental_usePluginId();
  const liveSession = useLiveSession(threadId);
  const panelTabs = experimental_usePanelTabs();
  const panel = experimental_useAppPanel();
  const [annotations, setAnnotations] = useState<LiveAnnotation[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const onPage = liveSession?.batchId === summary.id;
  const browserTab = panelTabs.tabs.find(
    (tab) => tab.detail.kind === "browser" && samePage(tab.detail.url, summary.url),
  );

  useEffect(() => {
    let disposed = false;
    rpc.call("batch", { threadId, batchId: summary.id }).then(
      (result) => {
        if (!disposed) setAnnotations(result.annotations);
      },
      (error: unknown) => {
        if (!disposed) setErrorMessage(errorText(error, "Could not load annotations"));
      },
    );
    return () => {
      disposed = true;
    };
  }, [revision, rpc, summary.count, summary.id, threadId]);

  const removePill = useCallback(() => {
    composer.replace((draft) =>
      removeMentionsFromDraft(draft, (mention) =>
        mention.kind === "plugin" &&
        mention.pluginId === pluginId &&
        mention.provider === MENTION_PROVIDER &&
        mention.id === summary.id,
      ),
    );
  }, [composer, pluginId, summary.id]);

  const remove = async (annotationId: string) => {
    setErrorMessage(null);
    try {
      if (onPage && liveSession) await liveSession.remove(annotationId);
      else await rpc.call("remove", { threadId, batchId: summary.id, annotationId });
    } catch (error) {
      setErrorMessage(errorText(error, "Could not delete annotation"));
    }
  };

  const edit = async (annotationId: string) => {
    if (!liveSession) return;
    if (browserTab) panel.selectTab(browserTab.key);
    try {
      if (!(await liveSession.open(annotationId))) {
        setErrorMessage("This annotation target is no longer available on the page");
      }
    } catch (error) {
      setErrorMessage(errorText(error, "Could not open annotation"));
    }
  };

  const send = async () => {
    setSending(true);
    setErrorMessage(null);
    try {
      const result = await rpc.call("send", { threadId, batchId: summary.id });
      if (!result.sent) throw new Error("These annotations were already sent or removed");
      removePill();
    } catch (error) {
      setErrorMessage(errorText(error, "Could not send annotations"));
    } finally {
      setSending(false);
    }
  };

  const title = summary.title ? `${summary.label} · ${summary.title}` : summary.label;
  return (
    <CollapsibleStackCard
      label="Browser annotations"
      title={title}
      icon="Target"
      isActive={onPage}
      dismiss={{
        label: "Discard annotations",
        failureMessage: "Could not discard annotations.",
        onDismiss: async () => {
          await rpc.call("discard", { threadId, batchId: summary.id });
          removePill();
        },
      }}
    >
      <div className="max-h-[min(20rem,50vh)] overflow-y-auto">
        {annotations.map((annotation, index) => (
          <AnnotationRow
            key={annotation.id}
            annotation={annotation}
            index={index}
            onEdit={onPage ? () => void edit(annotation.id) : undefined}
            onDelete={() => void remove(annotation.id)}
          />
        ))}
      </div>
      {errorMessage ? <p role="status" className="px-2 pt-1 text-xs text-destructive">{errorMessage}</p> : null}
      <div className="flex items-center justify-end gap-1 px-2 pt-2">
        {browserTab ? (
          <button
            type="button"
            className={`inline-flex h-7 items-center rounded-md px-2.5 text-xs text-muted-foreground ${MOTION} hover:bg-state-hover hover:text-foreground active:scale-[.96]`}
            onClick={() => panel.selectTab(browserTab.key)}
          >
            Show page
          </button>
        ) : null}
        <button
          type="button"
          disabled={sending || annotations.length === 0}
          className={`inline-flex h-7 items-center rounded-md bg-blue-500 px-2.5 text-xs font-semibold text-white ${MOTION} hover:bg-blue-400 active:scale-[.96] disabled:opacity-50`}
          onClick={() => void send()}
        >
          {sending ? <LoadingLabel>Sending…</LoadingLabel> : `Send ${summary.count}`}
        </button>
      </div>
    </CollapsibleStackCard>
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_browserToolbarAction({
    id: "browser-annotate",
    title: "Browser Annotate",
    component: BrowserAnnotateAction,
  });
  app.slots.experimental_appOverlay({
    id: "sent-annotation-hover",
    component: SentAnnotationsHover,
  });
  app.composer.customize({
    id: "pending-annotations",
    scopes: ["thread"],
    banners: [{ id: "pending-annotations", chrome: "bare", component: PendingAnnotationsBanner }],
  });
});
