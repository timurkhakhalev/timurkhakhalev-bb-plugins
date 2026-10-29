// Changed-files list (issue #3): under the latest turn's last response, the files that
// turn edited, most-changed first, with line counts; each row opens its file. Three
// show at first, the rest on expand, in a list that scrolls past a max height.
//
// BB has no slot after a message, so the composer banner (which knows the thread and
// whether it is running) renders nothing in the composer and portals the list into the
// timeline instead: a host element placed after the response text of that turn's last
// assistant row. The timeline is virtualized, so rows remount as they scroll in; an
// observer puts the host back whenever the row comes back.
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  experimental_FileLink as FileLink,
  experimental_Icon as Icon,
  useComposer,
  useRpc,
  useSettings,
} from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "./rpc";
import { rootAttributes } from "./settings";
import { topFiles, type FileChange } from "./turn-changes";

const SHOWN = 3;
const HOST = "data-bui-turn-files";

type Changes = { environmentId: string | null; turnId: string | null; files: FileChange[] };

const split = (path: string) => {
  const cut = path.lastIndexOf("/") + 1;
  return { dir: path.slice(0, cut), name: path.slice(cut) };
};

// The turn's last assistant row that is on screen, and the host after its text.
// ponytail: while scrolled up inside a long last turn, the last *realized* row of the
// turn can be an earlier response; the list moves to the real end once it mounts.
function placeHost(turnId: string): HTMLElement | null {
  const rows = document.querySelectorAll(`[data-timeline-row-id*=":assistant:"][data-timeline-row-id*="|turn:${CSS.escape(turnId)}|"]`);
  const column = rows[rows.length - 1]?.querySelector(":scope > [data-message-column]");
  const text = column?.querySelector(":scope > [data-sidebar-swipe-selectable]");
  if (!column || !text) return null;
  let host = column.querySelector<HTMLElement>(`:scope > [${HOST}]`);
  if (!host) {
    host = document.createElement("div");
    host.setAttribute(HOST, "");
    text.after(host);
  }
  return host;
}

function useHost(turnId: string | null): HTMLElement | null {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (turnId === null) return;
    const place = () => {
      const next = placeHost(turnId);
      setHost((prev) => (prev === next ? prev : next));
    };
    place();
    const timeline = document.querySelector("[data-timeline-row-list]")?.closest("main") ?? document.body;
    const observer = new MutationObserver(place);
    observer.observe(timeline, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      document.querySelectorAll(`[${HOST}]`).forEach((el) => el.remove());
      setHost(null);
    };
  }, [turnId]);
  return host;
}

function FileList({ environmentId, files }: { environmentId: string; files: FileChange[] }) {
  const [open, setOpen] = useState(false);
  const { shown, more } = topFiles(files, open ? files.length : SHOWN);
  const added = files.reduce((sum, file) => sum + file.added, 0);
  const removed = files.reduce((sum, file) => sum + file.removed, 0);
  return (
    <section className="bui-turn" aria-label="Files changed in this turn">
      <header className="bui-turn-head">
        <Icon name="FileDiff" className="size-3.5 shrink-0" aria-hidden />
        <span>
          {files.length} {files.length === 1 ? "file" : "files"} changed
        </span>
        <span className="text-diff-added">+{added}</span>
        <span className="text-diff-removed">-{removed}</span>
      </header>
      <ul className="bui-turn-files" data-open={open || undefined}>
        {shown.map((file) => {
          const { dir, name } = split(file.path);
          return (
            <li key={file.path}>
              <FileLink target={{ kind: "workspace", environmentId, path: file.path }} className="bui-turn-file" title={file.path}>
                <span className="bui-turn-path">
                  <span className="bui-turn-name">{name}</span>
                  {dir && <span className="bui-turn-dir">{dir.slice(0, -1)}</span>}
                </span>
                {file.added > 0 && <span className="text-diff-added">+{file.added}</span>}
                {file.removed > 0 && <span className="text-diff-removed">-{file.removed}</span>}
              </FileLink>
            </li>
          );
        })}
      </ul>
      {files.length > SHOWN && (
        <button type="button" className="bui-turn-more" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? "Show less" : `Show ${more} more`}
          <Icon name="ChevronDown" className="size-3 shrink-0" aria-hidden />
        </button>
      )}
    </section>
  );
}

export function ChangedFiles() {
  const view = useComposer();
  const rpc = useRpc<typeof rpcContract>();
  const { values } = useSettings();
  const on = !rootAttributes(values ?? {}).off.includes("turn");
  const threadId = view.scope.kind === "thread" ? view.scope.threadId : null;
  const running = view.isRunning;
  const [changes, setChanges] = useState<Changes | null>(null);

  // Read once the turn is done (and on open); a running turn shows nothing yet.
  useEffect(() => {
    if (!on || threadId === null || running) return;
    let live = true;
    rpc.call("turnChanges", { threadId }).then(
      (next) => live && setChanges((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next)),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [on, rpc, threadId, running]);

  const ready = on && !running && changes !== null && changes.environmentId !== null && changes.files.length > 0;
  const host = useHost(ready ? changes.turnId : null);
  if (!ready || host === null || changes.environmentId === null) return null;
  return createPortal(<FileList key={changes.turnId} environmentId={changes.environmentId} files={changes.files} />, host);
}
