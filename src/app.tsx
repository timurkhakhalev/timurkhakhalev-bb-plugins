import { useCallback, useEffect, useRef, useState } from "react";
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

function BrowserCommentsComposerBridge() {
  const rpc = useRpc<typeof rpcContract>();
  const composer = useComposer();
  const connectionState = useRealtimeConnectionState();
  const scopeRef = useRef(composer.scope);
  scopeRef.current = composer.scope;

  const insert = useCallback(
    (batch: { id: string; label: string; threadId: string }) => {
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
        label: batch.label,
      });
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
      .call("pending", { threadId: composer.scope.threadId })
      .then(({ batches }) => batches.forEach(insert))
      .catch(() => undefined);
  }, [composer.scope, connectionState, insert, rpc]);

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
          label: `${payload.count ?? 0} browser comment${payload.count === 1 ? "" : "s"}`,
        });
      },
      [insert],
    ),
  );

  return null;
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
    actions: [{ id: "bridge", component: BrowserCommentsComposerBridge }],
  });
});
