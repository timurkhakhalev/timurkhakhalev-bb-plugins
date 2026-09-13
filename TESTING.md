# Browser Annotate testing

Run the package checks from this directory:

```sh
bun install
bun test
bun run check
```

The regression suite has two layers:

- `server.regression.test.ts` loads the real server entry into the official SDK fake-host harness. It exercises validated RPC calls, KV persistence, thread-targeted send, image-version matching, capture recovery, editor/send gating, reload, disposal and composer polling without connecting to BB or a real browser. The fake host's KV/database state uses its temporary storage and is disposed after each test; the `sdk.files` adapter used here is an in-memory `Map`, so these tests do not claim durable filesystem-backed file persistence.
- `host.regression.test.ts` bundles the real `src/host.ts` entry only to replace its vendored SDK runtime import in a temporary copy. The injected `PAGE_SCRIPT` and host handlers are otherwise the source under test. A small loopback WebSocket fixture implements the CDP subset used here (`Target.*`, `Page.*`, and `Runtime.evaluate`) and evaluates expressions in a JSDOM realm. It observes connection close events, worker-retention leases, adaptive screenshot bounds, and the official harness's serialized-result byte boundary.
- `composer.regression.test.ts`, `editor-placement.test.ts` and `shortcut.test.ts` cover pure state transitions and shortcut/layout boundaries.

The suite keeps one explicit `test.failing` case for the remaining confirmed defect:

| Issue | Regression | Current status |
| --- | --- | --- |
| #2 | Downstream send failure retains the unsent draft | Expected failure |
| #3 | 50 large captures stay below the 8 MiB host-RPC boundary and remain queued | Passing |
| #4 | Viewport-sized, oversized, partially offscreen, and narrow-view elements receive a visible editor | Passing |
| #5 | An active host entry retains its worker until cleanup | Passing |
| #6 | Discard survives restart, cleans owned files, and rejects stale/cross-thread mentions | Passing |
| #7 | Sent history survives the 24-hour draft TTL while unsent drafts expire | Passing |
| #8 | Long title, classes/role, custom tags, selector, and metadata remain usable evidence | Passing |
| #9 | Evidence extraction preserves `Some sample text` while normalizing whitespace | Passing |

Bun reports the expected failure as a passing test; if it unexpectedly passes, the suite fails so the `.failing` marker can be removed. Issue #1 is intentionally a release gate rather than a fake green test: published SDK and companion BB compatibility must be verified after the required API is released.

Fidelity limits: screenshots are deterministic CDP stubs, layout metrics are JSDOM values, and the fixture does not emulate Electron, real daemon worker scheduling, real browser navigation, or published-SDK packaging. Those checks remain required before release.
