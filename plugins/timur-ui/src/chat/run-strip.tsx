// Run strip: a slim row under the thread header (bb 0.50 `experimental_threadHeaderRow`)
// fed by `threads.experimental_headState`. It shows the agent's to-do progress as
// segments with the current item, a context meter once the window is 70% full, and a
// chip when the provider fell back to another model. Nothing to show → no row.
import { useEffect, useState } from "react";
import { experimental_Icon as Icon, useSdk, useSettings } from "@get-bb/plugin-sdk/app";
import { formatTokens, HEAD_EVENTS, stripFrom, type Strip } from "./run-strip-model";

const REFETCH_MS = 250;

function useStrip(threadId: string, enabled: boolean): Strip | null {
  const sdk = useSdk();
  const [strip, setStrip] = useState<Strip | null>(null);
  useEffect(() => {
    if (!enabled) {
      setStrip(null);
      return;
    }
    let controller: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () => {
      controller?.abort();
      const current = new AbortController();
      controller = current;
      sdk.threads
        .experimental_headState({ threadId, signal: current.signal })
        .then((head) => {
          if (!current.signal.aborted) setStrip(stripFrom(head));
        })
        .catch(() => {
          // Aborted or unavailable: keep the last strip; the next event retries.
        });
    };
    load();
    const unsubscribe = sdk.subscribe({
      event: "thread:changed",
      threadId,
      callback: (event) => {
        const types = event.metadata?.eventTypes;
        const relevant =
          event.changes.includes("status-changed") ||
          event.changes.includes("history-compacted") ||
          event.changes.includes("history-rewritten") ||
          types?.some((type) => HEAD_EVENTS.has(type)) === true;
        if (!relevant) return;
        clearTimeout(timer);
        timer = setTimeout(load, REFETCH_MS);
      },
    });
    return () => {
      unsubscribe();
      clearTimeout(timer);
      controller?.abort();
    };
  }, [sdk, threadId, enabled]);
  return enabled ? strip : null;
}

function Todos({ todos }: { todos: NonNullable<Strip["todos"]> }) {
  const [open, setOpen] = useState(false);
  const label = todos.current?.text ?? todos.items.find((item) => item.status === "pending")?.text ?? "";
  return (
    <div className="bui-strip-todos">
      <button
        type="button"
        className="bui-strip-todo-btn"
        aria-expanded={open}
        aria-label={`To-dos: ${todos.done} of ${todos.items.length} done`}
        onClick={() => setOpen(!open)}
      >
        <span className="bui-strip-segments" aria-hidden>
          {todos.items.map((item) => (
            <span key={item.id} data-status={item.status} />
          ))}
        </span>
        <span className="bui-strip-count">
          {todos.done}/{todos.items.length}
        </span>
        <span className="bui-strip-current" data-active={todos.current ? "" : undefined}>
          {label}
        </span>
        <Icon name="ChevronDown" className="bui-strip-chevron" aria-hidden />
      </button>
      {open && (
        <ol className="bui-strip-list">
          {todos.items.map((item) => (
            <li key={item.id} data-status={item.status}>
              <span className="bui-strip-dot" aria-hidden />
              <span>{item.text}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function Context({ context }: { context: NonNullable<Strip["context"]> }) {
  const pct = Math.round(context.ratio * 100);
  const title = `Context ${formatTokens(context.usedTokens)} of ${formatTokens(context.windowTokens)}${context.cost ? ` · ${context.cost}` : ""}`;
  return (
    <span className="bui-strip-chip" data-level={context.ratio >= 0.9 ? "high" : "warn"} title={title}>
      <svg viewBox="0 0 16 16" className="bui-strip-ring" aria-hidden>
        <circle cx="8" cy="8" r="6" pathLength="100" />
        <circle cx="8" cy="8" r="6" pathLength="100" strokeDasharray={`${pct} 100`} />
      </svg>
      {pct}%{context.cost ? <span className="bui-strip-muted">{context.cost}</span> : null}
    </span>
  );
}

export function RunStrip({ threadId }: { threadId: string }) {
  const { values = {} } = useSettings();
  const strip = useStrip(threadId, values.runStrip !== false);
  if (!strip) return null;
  return (
    <div className="bui-strip" role="status" aria-live="polite">
      {strip.todos ? <Todos todos={strip.todos} /> : <span className="bui-strip-spacer" />}
      {strip.fallback && (
        <span className="bui-strip-chip" data-level="warn" title={`Fell back from ${strip.fallback.from}`}>
          <Icon name="ArrowRightLeft" className="size-3 shrink-0" aria-hidden />
          {strip.fallback.to}
        </span>
      )}
      {strip.context && <Context context={strip.context} />}
    </div>
  );
}
