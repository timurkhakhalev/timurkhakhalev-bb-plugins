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
import type { DesignChange, rpcContract } from "./contracts.js";

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
  designChange: DesignChange | null;
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

function removeMentionLabel(text: string, label: string) {
  const index = text.lastIndexOf(label);
  if (index === -1) return text;
  let start = index;
  let end = index + label.length;
  if (text[end] === " ") end += 1;
  else if (start > 0 && text[start - 1] === " ") start -= 1;
  return `${text.slice(0, start)}${text.slice(end)}`;
}

function useBrowserAnnotationsComposerSync() {
  const rpc = useRpc<typeof rpcContract>();
  const composer = useComposer();
  const connectionState = useRealtimeConnectionState();
  const composerRef = useRef(composer);
  const revisionRef = useRef(-1);
  const liveBatchRef = useRef<string | null>(null);
  const attachedRef = useRef<{ batchId: string; label: string } | null>(null);
  const threadId = composer.scope.kind === "thread" ? composer.scope.threadId : null;
  composerRef.current = composer;

  const detach = useCallback(() => {
    const attached = attachedRef.current;
    if (!attached) return;
    composerRef.current.updateText((text) => removeMentionLabel(text, attached.label));
    attachedRef.current = null;
  }, []);

  useEffect(() => {
    revisionRef.current = -1;
    liveBatchRef.current = null;
    attachedRef.current = null;
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
        const revisionChanged = live.revision > revisionRef.current;
        if (live.batchId !== liveBatchRef.current) {
          detach();
          liveBatchRef.current = live.batchId;
          revisionRef.current = -1;
        }
        revisionRef.current = Math.max(revisionRef.current, live.revision);

        if (live.batchId && live.annotations.length > 0) {
          const label = pluralizeAnnotations(live.annotations.length);
          const attached = attachedRef.current;
          if (!attached) {
            if (!composerRef.current.text.includes(label)) {
              composerRef.current.insertMention({
                provider: "browser-comments",
                id: live.batchId,
                label,
              });
            }
            attachedRef.current = { batchId: live.batchId, label };
          } else if (attached.label !== label) {
            composerRef.current.updateText((text) => removeMentionLabel(text, attached.label));
            composerRef.current.insertMention({
              provider: "browser-comments",
              id: live.batchId,
              label,
            });
            attachedRef.current = { batchId: live.batchId, label };
          }
        } else if (!live.active || revisionChanged) {
          detach();
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
  }, [connectionState, detach, rpc, threadId]);

  useRealtime(
    "annotate-session",
    useCallback(
      (rawPayload) => {
        const payload = rawPayload as SessionEvent;
        if (!threadId || payload.threadId !== threadId) return;
        if (payload.status === "sent" || payload.status === "cancelled") detach();
      },
      [detach, threadId],
    ),
  );
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
    <div className="mt-2 space-y-1 rounded-lg bg-muted/60 p-2 font-mono text-[11px] leading-4">
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

function SentAnnotationsHover() {
  useBrowserAnnotationsComposerSync();
  const rpc = useRpc<typeof rpcContract>();
  const composer = useComposer();
  const threadId = composer.scope.kind === "thread" ? composer.scope.threadId : null;
  const closeTimerRef = useRef<number | null>(null);
  const requestRef = useRef(0);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [editable, setEditable] = useState(false);
  const [annotations, setAnnotations] = useState<LiveAnnotation[]>([]);
  const [popupStyle, setPopupStyle] = useState<React.CSSProperties>({});

  const cancelClose = useCallback(() => {
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
  }, []);

  const closeSoon = useCallback(() => {
    cancelClose();
    closeTimerRef.current = window.setTimeout(() => {
      setAnchor(null);
      setBatchId(null);
      setEditable(false);
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
      setBatchId(match.batchId);
      void rpc.call("batch", { threadId, batchId: match.batchId }).then((result) => {
        if (request === requestRef.current) {
          setEditable(result.editable);
          setAnnotations(result.annotations);
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

  const editAnnotation = useCallback(
    async (annotationId: string) => {
      if (!threadId || !editable) return;
      const result = await rpc.call("mutate", { threadId, annotationId, action: "open" });
      if (!result.changed) return;
      setAnchor(null);
      setBatchId(null);
      setEditable(false);
      setAnnotations([]);
    },
    [editable, rpc, threadId],
  );

  const deleteAnnotation = useCallback(
    async (annotationId: string) => {
      if (!threadId || !batchId || !editable) return;
      const result = await rpc.call("mutate", { threadId, annotationId, action: "delete" });
      if (!result.changed) return;
      const next = annotations.filter((annotation) => annotation.id !== annotationId);
      setAnnotations(next);
      if (next.length === 0) {
        setAnchor(null);
        setBatchId(null);
        setEditable(false);
      }
    },
    [annotations, batchId, editable, rpc, threadId],
  );

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
              {annotation.comment ? (
                <p className="mt-2 whitespace-pre-wrap text-sm">{annotation.comment}</p>
              ) : null}
              <DesignChangeDetails designChange={annotation.designChange} />
            </div>
            {editable ? (
              <div className="flex shrink-0 items-center">
                <button
                  type="button"
                  className="rounded-md p-1.5 text-muted-foreground hover:bg-state-hover hover:text-foreground"
                  aria-label={`Edit annotation ${index + 1}`}
                  onClick={() => void editAnnotation(annotation.id)}
                >
                  <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-4">
                    <path d="m4 20 4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10L4 20Z" />
                  </svg>
                </button>
                <button
                  type="button"
                  className="rounded-md p-1.5 text-muted-foreground hover:bg-state-hover hover:text-destructive"
                  aria-label={`Delete annotation ${index + 1}`}
                  onClick={() => void deleteAnnotation(annotation.id)}
                >
                  <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-4">
                    <path d="M4 7h16M9 7V4h6v3m-9 0 1 13h10l1-13M10 11v5m4-5v5" />
                  </svg>
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ))}
    </div>,
    document.body,
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
});
