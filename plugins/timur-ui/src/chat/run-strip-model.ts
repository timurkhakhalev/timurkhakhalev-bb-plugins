// Run strip (run-strip.tsx): what the row under the thread header shows, derived from
// the thread's head state. Pure so it can be tested; the input is untrusted JSON.

export type TodoStatus = "pending" | "in_progress" | "completed";
export type Todo = { id: string; status: TodoStatus; text: string };

export type Strip = {
  todos: { items: Todo[]; done: number; current: Todo | null } | null;
  /** Shown only from CONTEXT_WARN_AT up, so the row stays out of the way earlier. */
  context: { ratio: number; usedTokens: number; windowTokens: number; cost: string | null } | null;
  fallback: { from: string; to: string } | null;
};

export const CONTEXT_WARN_AT = 0.7;

/** Head-state events worth a refetch: to-dos, context usage, fallback, turn edges. */
export const HEAD_EVENTS = new Set([
  "turn/plan/updated",
  "thread/contextWindowUsage/updated",
  "thread/compacted",
  "thread/context/cleared",
  "provider/modelFallback",
  "turn/started",
  "turn/completed",
]);

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const STATUSES: readonly TodoStatus[] = ["pending", "in_progress", "completed"];

function todos(value: unknown): Strip["todos"] {
  if (!isObject(value) || !Array.isArray(value.items)) return null;
  const items = value.items.flatMap((item): Todo[] => {
    if (!isObject(item) || typeof item.text !== "string" || typeof item.id !== "string") return [];
    const status = STATUSES.find((s) => s === item.status);
    return status ? [{ id: item.id, status, text: item.text }] : [];
  });
  if (items.length === 0) return null;
  const done = items.filter((item) => item.status === "completed").length;
  if (done === items.length) return null;
  return { items, done, current: items.find((item) => item.status === "in_progress") ?? null };
}

function context(value: unknown): Strip["context"] {
  if (!isObject(value)) return null;
  const used = value.usedTokens;
  const windowTokens = value.modelContextWindow;
  if (typeof used !== "number" || typeof windowTokens !== "number" || !(windowTokens > 0)) return null;
  const ratio = Math.min(Math.max(used / windowTokens, 0), 1);
  if (ratio < CONTEXT_WARN_AT) return null;
  const cost = isObject(value.cost) ? formatCost(value.cost.amount, value.cost.currency) : null;
  return { ratio, usedTokens: used, windowTokens, cost };
}

function formatCost(amount: unknown, currency: unknown): string | null {
  if (typeof amount !== "number" || !Number.isFinite(amount) || typeof currency !== "string") return null;
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: amount < 1 ? 3 : 2 }).format(amount);
  } catch {
    return null;
  }
}

function fallback(value: unknown): Strip["fallback"] {
  if (!isObject(value) || typeof value.originalModel !== "string" || typeof value.fallbackModel !== "string") return null;
  return { from: value.originalModel, to: value.fallbackModel };
}

export function stripFrom(head: unknown): Strip | null {
  if (!isObject(head)) return null;
  const strip = {
    todos: todos(head.pendingTodos),
    context: context(head.contextWindowUsage),
    fallback: fallback(head.modelFallback),
  };
  return strip.todos || strip.context || strip.fallback ? strip : null;
}

/** 182_400 → "182k", 1_000_000 → "1M". */
export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${+(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}k`;
  return String(Math.round(tokens));
}
