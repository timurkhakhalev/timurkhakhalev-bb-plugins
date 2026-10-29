// Changed-files chips: what the latest turn edited, with line counts, from the
// thread's own fileChange events. Pure so the server and tests share it.

export type FileChange = { path: string; added: number; removed: number };

/** Line counts of one unified diff, headers (---/+++) excluded. */
export function diffStats(diff: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) added += 1;
    else if (line.startsWith("-") && !line.startsWith("---")) removed += 1;
  }
  return { added, removed };
}

/**
 * Adds one fileChange item's changes into `files`, keyed by path relative to the
 * workspace `root`. Files outside the workspace can't be opened as workspace files,
 * so they're left out.
 */
export function addChanges(
  files: Map<string, FileChange>,
  changes: ReadonlyArray<{ path?: unknown; diff?: unknown }>,
  root: string,
): void {
  const prefix = root.endsWith("/") ? root : `${root}/`;
  for (const change of changes) {
    if (typeof change.path !== "string" || !change.path.startsWith(prefix)) continue;
    const path = change.path.slice(prefix.length);
    const { added, removed } = diffStats(typeof change.diff === "string" ? change.diff : "");
    const file = files.get(path) ?? { path, added: 0, removed: 0 };
    file.added += added;
    file.removed += removed;
    files.set(path, file);
  }
}

/** Most-changed first, so the chips that fit are the ones that matter. */
export function topFiles(files: Iterable<FileChange>, limit: number): { shown: FileChange[]; more: number } {
  const all = [...files].sort((a, b) => b.added + b.removed - (a.added + a.removed) || a.path.localeCompare(b.path));
  return { shown: all.slice(0, limit), more: Math.max(0, all.length - limit) };
}
