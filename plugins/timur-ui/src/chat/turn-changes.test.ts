// node --experimental-strip-types --test turn-changes.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { addChanges, diffStats, topFiles, type FileChange } from "./turn-changes.ts";

test("diff line counts skip the ---/+++ headers", () => {
  assert.deepEqual(diffStats("--- a/x\n+++ b/x\n-old\n+new\n+more\n context"), { added: 2, removed: 1 });
  assert.deepEqual(diffStats("--- /dev/null\n+++ b/new.ts\n+a\n+b"), { added: 2, removed: 0 });
  assert.deepEqual(diffStats(""), { added: 0, removed: 0 });
});

test("changes add up per workspace-relative path; outside files are skipped", () => {
  const files = new Map<string, FileChange>();
  addChanges(files, [{ path: "/ws/src/a.ts", diff: "+x\n-y" }, { path: "/elsewhere/b.ts", diff: "+z" }], "/ws");
  addChanges(files, [{ path: "/ws/src/a.ts", diff: "+x" }], "/ws/");
  assert.deepEqual([...files.values()], [{ path: "src/a.ts", added: 2, removed: 1 }]);
});

test("most-changed files come first, the rest is counted", () => {
  const { shown, more } = topFiles(
    [
      { path: "small.ts", added: 1, removed: 0 },
      { path: "big.ts", added: 70, removed: 40 },
      { path: "mid.css", added: 13, removed: 0 },
    ],
    2,
  );
  assert.deepEqual(shown.map((file) => file.path), ["big.ts", "mid.css"]);
  assert.equal(more, 1);
});
