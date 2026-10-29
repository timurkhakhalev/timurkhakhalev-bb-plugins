// The changed-files list (from Beautiful Chat): what the latest turn edited,
// with line counts, read from the thread's fileChange events.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { rpcContract } from "./rpc";
import { addChanges, type FileChange } from "./turn-changes";

type EventRow = { seq: number; scope: { kind: string; turnId?: string }; data: unknown };
type Turn = { turnId: string | null; seq: number; files: Map<string, FileChange> };
const PAGE = 100;

export function registerTurnChanges(bb: BbPluginApi) {
  // Per thread: its workspace, and the latest turn's changes read so far. The list
  // reads again when a run ends, so after the first read only newer events are fetched.
  const places = new Map<string, { environmentId: string; root: string } | null>();
  const turns = new Map<string, Turn>();
  const reading = new Map<string, Promise<Turn>>();

  async function placeOf(threadId: string) {
    if (!places.has(threadId)) {
      const thread = await bb.sdk.threads.get({ threadId });
      const environment = thread.environmentId ? await bb.sdk.environments.get({ environmentId: thread.environmentId }) : null;
      places.set(threadId, environment?.path ? { environmentId: environment.id, root: environment.path } : null);
    }
    return places.get(threadId) ?? null;
  }

  const events = (threadId: string, page: { afterSeq?: number; beforeSeq?: number; order: "asc" | "desc" }) =>
    bb.sdk.threads.events.list({
      threadId,
      types: ["item/completed"],
      limit: String(PAGE),
      order: page.order,
      ...(page.afterSeq !== undefined ? { afterSeq: String(page.afterSeq) } : {}),
      ...(page.beforeSeq !== undefined ? { beforeSeq: String(page.beforeSeq) } : {}),
    }) as Promise<EventRow[]>;

  const add = (turn: Turn, event: EventRow, root: string) => {
    const item = (event.data as { item?: { type?: string; status?: string; changes?: Array<{ path?: unknown; diff?: unknown }> } }).item;
    if (item?.type === "fileChange" && item.status !== "failed") addChanges(turn.files, item.changes ?? [], root);
  };

  // First read: walk back from the newest event to the start of its turn.
  async function latestTurn(threadId: string, root: string): Promise<Turn> {
    const turn: Turn = { turnId: null, seq: 0, files: new Map() };
    let beforeSeq: number | undefined;
    for (;;) {
      const page = await events(threadId, { order: "desc", beforeSeq });
      for (const event of page) {
        turn.seq = Math.max(turn.seq, event.seq);
        const turnId = event.scope.turnId;
        if (!turnId) continue;
        if (turn.turnId === null) turn.turnId = turnId;
        if (turnId !== turn.turnId) return turn;
        add(turn, event, root);
      }
      if (page.length < PAGE) return turn;
      beforeSeq = page[page.length - 1].seq;
    }
  }

  // Later reads: only newer events; a new turn starts the tally over.
  async function advance(threadId: string, turn: Turn, root: string): Promise<Turn> {
    for (;;) {
      const page = await events(threadId, { order: "asc", afterSeq: turn.seq });
      for (const event of page) {
        turn.seq = Math.max(turn.seq, event.seq);
        const turnId = event.scope.turnId;
        if (turnId && turnId !== turn.turnId) {
          turn.turnId = turnId;
          turn.files = new Map();
        }
        add(turn, event, root);
      }
      if (page.length < PAGE) return turn;
    }
  }

  bb.rpc.register(rpcContract, {
    async turnChanges({ threadId }) {
      const place = await placeOf(threadId);
      if (!place) return { environmentId: null, turnId: null, files: [] };
      // One read per thread at a time, so overlapping polls can't count an event twice.
      const previous = reading.get(threadId) ?? Promise.resolve(undefined);
      const next = previous.then(() => {
        const known = turns.get(threadId);
        return known ? advance(threadId, known, place.root) : latestTurn(threadId, place.root);
      });
      reading.set(threadId, next.catch(() => undefined) as Promise<Turn>);
      const turn = await next;
      turns.set(threadId, turn);
      return { environmentId: place.environmentId, turnId: turn.turnId, files: [...turn.files.values()] };
    },
  });
}
