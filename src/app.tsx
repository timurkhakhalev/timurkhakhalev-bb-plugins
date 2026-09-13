import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  definePluginApp,
  useComposer,
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
  type ExperimentalPluginBrowserToolbarActionProps,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { rpcContract } from "./contracts.js";

type SessionEvent = {
  threadId?: string;
  tabId?: string;
  status?: "cancelled" | "error" | "sent";
  count?: number;
  batchId?: string;
  error?: string;
};

type LiveAnnotation = {
  id: string;
  tag: string;
  target: string;
  comment: string;
  previewDataUrl: string | null;
};

const annotateIcon = (
  <svg
    aria-hidden
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="size-3.5"
  >
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </svg>
);

function BrowserAnnotateAction({ threadId, tabId }: ExperimentalPluginBrowserToolbarActionProps) {
  const rpc = useRpc<typeof rpcContract>();
  const connectionState = useRealtimeConnectionState();
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState(false);

  const refreshStatus = useCallback(() => {
    void rpc
      .call("status", { threadId })
      .then((status) => setActive(status.active && status.tabId === tabId))
      .catch(() => undefined);
  }, [rpc, tabId, threadId]);

  useEffect(refreshStatus, [connectionState, refreshStatus]);

  useRealtime(
    "annotate-session",
    useCallback(
      (rawPayload) => {
        const payload = rawPayload as SessionEvent;
        if (payload.threadId !== threadId || payload.tabId !== tabId) return;
        setActive(false);
        if (payload.status === "sent") {
          toast.success(
            `${payload.count ?? 0} browser annotation${payload.count === 1 ? "" : "s"} sent`,
          );
        } else if (payload.status === "error") {
          toast.error(payload.error || "Browser annotation failed");
        }
      },
      [tabId, threadId],
    ),
  );

  const toggle = useCallback(async () => {
    setBusy(true);
    try {
      if (active) {
        await rpc.call("stop", { threadId });
        setActive(false);
      } else {
        await rpc.call("start", { threadId, tabId });
        setActive(true);
        toast.message("Select page elements and add comments");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }, [active, rpc, tabId, threadId]);

  return (
    <button
      type="button"
      className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs transition-colors hover:bg-state-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-40 ${active ? "bg-card text-blue-500" : "text-muted-foreground hover:text-foreground"}`}
      title={active ? "Stop annotating" : "Annotate this page"}
      aria-label={active ? "Stop annotating this page" : "Annotate this page"}
      aria-pressed={active}
      disabled={busy}
      onClick={() => void toggle()}
    >
      {annotateIcon}
      <span className="hidden xl:inline">{active ? "Annotating" : "Annotate"}</span>
    </button>
  );
}

function pluralizeAnnotations(count: number) {
  return `${count} annotation${count === 1 ? "" : "s"}`;
}

function SentAnnotationsHover() {
  const rpc = useRpc<typeof rpcContract>();
  const composer = useComposer();
  const threadId = composer.scope.kind === "thread" ? composer.scope.threadId : null;
  const closeTimerRef = useRef<number | null>(null);
  const requestRef = useRef(0);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [annotations, setAnnotations] = useState<LiveAnnotation[]>([]);
  const [popupStyle, setPopupStyle] = useState<React.CSSProperties>({});

  const cancelClose = useCallback(() => {
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
  }, []);

  const closeSoon = useCallback(() => {
    cancelClose();
    closeTimerRef.current = window.setTimeout(() => {
      setAnchor(null);
      setAnnotations([]);
    }, 140);
  }, [cancelClose]);

  useEffect(() => {
    const batchIdFor = (target: EventTarget | null) => {
      if (!(target instanceof Element)) return null;
      const pill = target.closest<HTMLElement>('[data-prompt-mention="true"]');
      if (!pill) return null;
      try {
        const resource = JSON.parse(
          pill.getAttribute("data-prompt-mention-resource") ?? "null",
        ) as { kind?: string; itemId?: string } | null;
        const prefix = "browser-comments:";
        if (resource?.kind !== "plugin" || !resource.itemId?.startsWith(prefix)) return null;
        return { pill, batchId: resource.itemId.slice(prefix.length) };
      } catch {
        return null;
      }
    };

    const enter = (event: MouseEvent) => {
      const match = batchIdFor(event.target);
      if (!match) return;
      cancelClose();
      const rect = match.pill.getBoundingClientRect();
      setAnchor(match.pill);
      setPopupStyle({
        left: Math.max(12, Math.min(rect.left, window.innerWidth - 396)),
        ...(rect.top > 360
          ? { bottom: window.innerHeight - rect.top + 8 }
          : { top: rect.bottom + 8 }),
      });
      const request = ++requestRef.current;
      if (!threadId) return;
      void rpc.call("batch", { threadId, batchId: match.batchId }).then((result) => {
        if (request === requestRef.current) setAnnotations(result.annotations);
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

  if (!anchor || annotations.length === 0) return null;
  return createPortal(
    <div
      data-browser-annotations-popover=""
      className="fixed z-[1100] max-h-[min(28rem,70vh)] w-96 max-w-[calc(100vw-24px)] overflow-y-auto rounded-xl border border-border bg-popover p-2 text-popover-foreground shadow-2xl"
      style={popupStyle}
      onMouseEnter={cancelClose}
      onMouseLeave={closeSoon}
    >
      {annotations.map((annotation, index) => (
        <div key={annotation.id} className="border-b border-border p-2 last:border-b-0">
          <div className="flex items-start gap-2">
            {annotation.previewDataUrl ? (
              <img
                src={annotation.previewDataUrl}
                alt=""
                className="mt-0.5 size-10 rounded-md border border-border object-cover"
              />
            ) : (
              <div className="mt-0.5 flex size-10 items-center justify-center rounded-md border border-border bg-muted text-xs text-muted-foreground">
                {index + 1}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="rounded-md bg-muted px-1.5 py-0.5">{annotation.tag}</span>
                <span className="truncate">{annotation.target}</span>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm">{annotation.comment}</p>
            </div>
          </div>
        </div>
      ))}
    </div>,
    document.body,
  );
}

function BrowserCommentsComposer() {
  const rpc = useRpc<typeof rpcContract>();
  const composer = useComposer();
  const connectionState = useRealtimeConnectionState();
  const revisionRef = useRef(-1);
  const liveBatchRef = useRef<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeTimerRef = useRef<number | null>(null);
  const [annotations, setAnnotations] = useState<LiveAnnotation[]>([]);
  const [open, setOpen] = useState(false);
  const [popupStyle, setPopupStyle] = useState<React.CSSProperties>({});
  const threadId = composer.scope.kind === "thread" ? composer.scope.threadId : null;

  useEffect(() => {
    revisionRef.current = -1;
    liveBatchRef.current = null;
    setAnnotations([]);
    setOpen(false);
  }, [threadId]);

  useEffect(() => {
    if (!threadId) return;
    let disposed = false;
    let running = false;
    const poll = async () => {
      if (running || disposed) return;
      running = true;
      try {
        const live = await rpc.call("live", {
          threadId,
          afterRevision: revisionRef.current,
        });
        if (disposed) return;
        if (live.batchId !== liveBatchRef.current) {
          liveBatchRef.current = live.batchId;
          revisionRef.current = -1;
        }
        if (live.revision > revisionRef.current || live.annotations.length > 0) {
          revisionRef.current = Math.max(revisionRef.current, live.revision);
          setAnnotations(live.annotations);
          if (live.annotations.length === 0) setOpen(false);
        } else if (!live.active) {
          revisionRef.current = -1;
          liveBatchRef.current = null;
          setAnnotations([]);
          setOpen(false);
        }
      } catch {
        // A short gap is normal while the Browser lease is being established.
      } finally {
        running = false;
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 250);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [connectionState, rpc, threadId]);

  useRealtime(
    "annotate-session",
    useCallback(
      (rawPayload) => {
        const payload = rawPayload as SessionEvent;
        if (!threadId || payload.threadId !== threadId) return;
        if (payload.status === "sent" || payload.status === "cancelled") {
          setAnnotations([]);
          setOpen(false);
        }
      },
      [threadId],
    ),
  );

  const count = annotations.length;
  const label = pluralizeAnnotations(count);

  useEffect(() => {
    if (!open) return;
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPopupStyle({
      left: Math.max(12, Math.min(rect.left, window.innerWidth - 396)),
      bottom: window.innerHeight - rect.top + 8,
    });
    const close = (event: MouseEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if ((target as Element).closest?.("[data-browser-annotations-popover]")) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const showDetails = useCallback(() => {
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
    setOpen(true);
  }, []);

  const hideDetailsSoon = useCallback(() => {
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = window.setTimeout(() => setOpen(false), 140);
  }, []);

  const removeAnnotation = useCallback(
    async (annotationId: string) => {
      if (composer.scope.kind !== "thread") return;
      const changed = await rpc.call("mutate", {
        threadId: composer.scope.threadId,
        annotationId,
        action: "delete",
      });
      if (!changed.changed) return;
      const next = annotations.filter((annotation) => annotation.id !== annotationId);
      setAnnotations(next);
      if (next.length === 0) setOpen(false);
    },
    [annotations, composer.scope, rpc],
  );

  const openAnnotationEditor = useCallback(async (annotationId: string) => {
    if (composer.scope.kind !== "thread") return;
    const changed = await rpc.call("mutate", {
      threadId: composer.scope.threadId,
      annotationId,
      action: "open",
    });
    if (!changed.changed) return;
    setOpen(false);
  }, [composer.scope, rpc]);

  const discard = useCallback(async () => {
    if (composer.scope.kind !== "thread") return;
    await rpc.call("discard", { threadId: composer.scope.threadId });
    setAnnotations([]);
    setOpen(false);
  }, [composer.scope, rpc]);

  if (count === 0) return null;

  return (
    <div className="flex justify-start px-1 py-1">
      <div className="flex h-8 w-fit items-center rounded-lg border border-border bg-card text-sm text-foreground shadow-sm">
        <button
          ref={triggerRef}
          type="button"
          className="flex h-full items-center gap-2 rounded-l-lg px-2.5 hover:bg-state-hover"
          aria-label={`Show ${label}`}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          onMouseEnter={showDetails}
          onMouseLeave={hideDetailsSoon}
        >
          <span aria-hidden className="text-muted-foreground">▢</span>
          <span>{label}</span>
        </button>
        <button
          type="button"
          className="flex size-8 items-center justify-center rounded-r-lg text-muted-foreground hover:bg-state-hover hover:text-foreground"
          aria-label="Remove browser annotations"
          onClick={() => void discard()}
        >
          ×
        </button>
      </div>
      {open
        ? createPortal(
            <div
              data-browser-annotations-popover=""
              className="fixed z-[1000] max-h-[min(28rem,70vh)] w-96 max-w-[calc(100vw-24px)] overflow-y-auto rounded-xl border border-border bg-popover p-2 text-popover-foreground shadow-2xl"
              style={popupStyle}
              onMouseEnter={showDetails}
              onMouseLeave={hideDetailsSoon}
            >
              {annotations.map((annotation, index) => (
                <div
                  key={annotation.id}
                  className="border-b border-border p-2 last:border-b-0"
                >
                  <div className="flex items-start gap-2">
                    {annotation.previewDataUrl ? (
                      <img
                        src={annotation.previewDataUrl}
                        alt=""
                        className="mt-0.5 size-10 rounded-md border border-border object-cover"
                      />
                    ) : (
                      <div className="mt-0.5 flex size-10 items-center justify-center rounded-md border border-border bg-muted text-xs text-muted-foreground">
                        {index + 1}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="rounded-md bg-muted px-1.5 py-0.5">{annotation.tag}</span>
                        <span className="truncate">{annotation.target}</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="px-1.5 text-muted-foreground hover:text-foreground"
                      aria-label={`Edit annotation ${index + 1}`}
                      onClick={() => void openAnnotationEditor(annotation.id)}
                    >
                      <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-4">
                        <path d="m4 20 4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10L4 20Z" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      className="px-1.5 text-muted-foreground hover:text-destructive"
                      aria-label={`Delete annotation ${index + 1}`}
                      onClick={() => void removeAnnotation(annotation.id)}
                    >
                      <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-4">
                        <path d="M4 7h16M9 7V4h6v3m-9 0 1 13h10l1-13M10 11v5m4-5v5" />
                      </svg>
                    </button>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm">{annotation.comment}</p>
                </div>
              ))}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_browserToolbarAction({
    id: "browser-annotate",
    title: "Browser Annotate",
    component: BrowserAnnotateAction,
  });
  app.composer.customize({
    id: "browser-comments",
    scopes: ["thread"],
    banners: [{ id: "annotations", chrome: "bare", component: BrowserCommentsComposer }],
  });
  app.slots.experimental_appOverlay({
    id: "sent-annotation-hover",
    component: SentAnnotationsHover,
  });
});
