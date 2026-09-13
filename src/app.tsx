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
  status?: "cancelled" | "error" | "ready";
  count?: number;
  batchId?: string;
  error?: string;
};

const insertedBatches = new Set<string>();

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
        if (payload.status === "ready") {
          toast.success(
            `${payload.count ?? 0} browser comment${payload.count === 1 ? "" : "s"} added to chat`,
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

function BrowserCommentsComposer() {
  const rpc = useRpc<typeof rpcContract>();
  const composer = useComposer();
  const connectionState = useRealtimeConnectionState();
  const scopeRef = useRef(composer.scope);
  const revisionRef = useRef(-1);
  const finalizedRef = useRef(false);
  const sawMentionRef = useRef(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [annotations, setAnnotations] = useState<LiveAnnotation[]>([]);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingComment, setEditingComment] = useState("");
  const [popupStyle, setPopupStyle] = useState<React.CSSProperties>({});
  scopeRef.current = composer.scope;

  const insert = useCallback(
    (batch: { id: string; count: number; threadId: string }) => {
      const scope = scopeRef.current;
      if (
        scope.kind !== "thread" ||
        scope.threadId !== batch.threadId ||
        insertedBatches.has(batch.id)
      ) {
        return;
      }
      insertedBatches.add(batch.id);
      composer.insertMention({
        provider: "browser-comments",
        id: batch.id,
        label: pluralizeAnnotations(batch.count),
      });
      finalizedRef.current = true;
      sawMentionRef.current = false;
      setBatchId(batch.id);
      void rpc
        .call("stage", { threadId: batch.threadId, batchId: batch.id })
        .catch(() => undefined);
      composer.focus();
    },
    [composer, rpc],
  );

  useEffect(() => {
    if (composer.scope.kind !== "thread") return;
    void rpc
      .call("draft", { threadId: composer.scope.threadId })
      .then((draft) => {
        if (!draft.batchId || draft.annotations.length === 0) return;
        const label = pluralizeAnnotations(draft.annotations.length);
        if (!composer.text.includes(label)) return;
        finalizedRef.current = true;
        sawMentionRef.current = true;
        setBatchId(draft.batchId);
        setAnnotations(draft.annotations);
      })
      .catch(() => undefined);
    void rpc
      .call("pending", { threadId: composer.scope.threadId })
      .then(({ batches }) =>
        batches.forEach((batch) =>
          insert({ id: batch.id, threadId: batch.threadId, count: batch.count }),
        ),
      )
      .catch(() => undefined);
  }, [composer.scope, composer.text, connectionState, insert, rpc]);

  useEffect(() => {
    if (composer.scope.kind !== "thread") return;
    let disposed = false;
    let running = false;
    const threadId = composer.scope.threadId;
    const poll = async () => {
      if (running || disposed || finalizedRef.current) return;
      running = true;
      try {
        const live = await rpc.call("live", {
          threadId,
          afterRevision: revisionRef.current,
        });
        if (disposed) return;
        if (live.revision > revisionRef.current) {
          revisionRef.current = live.revision;
          setBatchId(live.batchId);
          setAnnotations(live.annotations);
          if (live.annotations.length === 0) setOpen(false);
        } else if (!live.active && !finalizedRef.current) {
          setAnnotations([]);
          setBatchId(null);
          setOpen(false);
        }
      } catch {
        // A short gap is normal while the Browser lease is being established.
      } finally {
        running = false;
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 450);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [composer.scope, connectionState, rpc]);

  useRealtime(
    "annotate-session",
    useCallback(
      (rawPayload) => {
        const payload = rawPayload as SessionEvent;
        if (payload.status !== "ready" || !payload.batchId || !payload.threadId) {
          return;
        }
        insert({
          id: payload.batchId,
          threadId: payload.threadId,
          count: payload.count ?? 0,
        });
      },
      [insert],
    ),
  );

  const count = annotations.length;
  const label = pluralizeAnnotations(count);

  useEffect(() => {
    if (!finalizedRef.current || !batchId) return;
    if (composer.text.includes(label)) {
      sawMentionRef.current = true;
      return;
    }
    if (sawMentionRef.current) {
      finalizedRef.current = false;
      sawMentionRef.current = false;
      setAnnotations([]);
      setBatchId(null);
      setOpen(false);
    }
  }, [batchId, composer.text, label]);

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

  const replaceMentionCount = useCallback(
    (previousCount: number, nextCount: number) => {
      if (!finalizedRef.current) return;
      const previous = pluralizeAnnotations(previousCount);
      const index = composer.text.lastIndexOf(previous);
      if (index < 0) return;
      const nextText = `${composer.text.slice(0, index)}${composer.text.slice(index + previous.length)}`
        .replace(/ {2,}/g, " ")
        .trimStart();
      composer.setText(nextText);
      if (nextCount > 0 && batchId) {
        composer.insertMention({
          provider: "browser-comments",
          id: batchId,
          label: pluralizeAnnotations(nextCount),
        });
      }
    },
    [batchId, composer],
  );

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
      replaceMentionCount(annotations.length, next.length);
      setAnnotations(next);
      setEditingId(null);
      if (next.length === 0) setOpen(false);
    },
    [annotations, composer.scope, replaceMentionCount, rpc],
  );

  const saveEdit = useCallback(async () => {
    if (composer.scope.kind !== "thread" || !editingId || !editingComment.trim()) return;
    const changed = await rpc.call("mutate", {
      threadId: composer.scope.threadId,
      annotationId: editingId,
      action: "edit",
      comment: editingComment.trim(),
    });
    if (!changed.changed) return;
    setAnnotations((current) =>
      current.map((annotation) =>
        annotation.id === editingId
          ? { ...annotation, comment: editingComment.trim() }
          : annotation,
      ),
    );
    setEditingId(null);
  }, [composer.scope, editingComment, editingId, rpc]);

  const discard = useCallback(async () => {
    if (composer.scope.kind !== "thread") return;
    await rpc.call("discard", { threadId: composer.scope.threadId });
    replaceMentionCount(annotations.length, 0);
    finalizedRef.current = false;
    setAnnotations([]);
    setBatchId(null);
    setOpen(false);
  }, [annotations.length, composer.scope, replaceMentionCount, rpc]);

  if (count === 0) return null;

  return (
    <>
      <div className="flex h-8 items-center rounded-lg border border-border bg-card text-sm text-foreground shadow-sm">
        <button
          ref={triggerRef}
          type="button"
          className="flex h-full items-center gap-2 rounded-l-lg px-2.5 hover:bg-state-hover"
          aria-label={`Show ${label}`}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
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
                      onClick={() => {
                        setEditingId(annotation.id);
                        setEditingComment(annotation.comment);
                      }}
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
                  {editingId === annotation.id ? (
                    <div className="mt-2 flex gap-2">
                      <input
                        autoFocus
                        value={editingComment}
                        className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 outline-none focus:ring-1 focus:ring-ring"
                        onChange={(event) => setEditingComment(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") void saveEdit();
                          if (event.key === "Escape") setEditingId(null);
                        }}
                      />
                      <button type="button" className="rounded-md bg-primary px-2 text-primary-foreground" onClick={() => void saveEdit()}>
                        Save
                      </button>
                    </div>
                  ) : (
                    <p className="mt-2 whitespace-pre-wrap text-sm">{annotation.comment}</p>
                  )}
                </div>
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
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
    actions: [{ id: "annotations", component: BrowserCommentsComposer }],
  });
});
