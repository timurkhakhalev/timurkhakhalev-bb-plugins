# Browser Annotate testing

Run the package checks from this directory:

```sh
bun install
bun test
bun run check
```

The regression suite has two layers:

- `server.regression.test.ts` loads the real server entry into the official SDK fake-host harness. It exercises validated RPC calls, KV persistence, thread-targeted send, image-version matching, capture recovery, editor/send gating, reload, disposal and composer polling without connecting to BB or a real browser. The fake host's KV/database state uses its temporary storage and is disposed after each test; the `sdk.files` adapter used here is an in-memory `Map`, so these tests do not claim durable filesystem-backed file persistence.
- `host.regression.test.ts` bundles the real `src/host.ts` entry only to replace its vendored SDK runtime import in a temporary copy. The injected `PAGE_SCRIPT` and host handlers are otherwise the source under test. A small loopback WebSocket fixture implements the CDP subset used here (`Target.*`, `Page.*`, and `Runtime.evaluate`) and evaluates expressions in a JSDOM realm.
- `composer.regression.test.ts`, `editor-placement.test.ts` and `shortcut.test.ts` cover pure state transitions and shortcut/layout boundaries.

The suite includes nine explicit `test.failing` cases for confirmed defects:

| Issue | Regression | Current status |
| --- | --- | --- |
| #2 | Downstream send failure retains the unsent draft | Expected failure |
| #3 | 50 large captures stay below the 8 MiB host-RPC boundary and remain queued | Expected failure |
| #4 | A viewport-sized element receives a visible editor | Expected failure |
| #5 | An active host entry retains its worker until cleanup | Expected failure |
| #6 | Discard survives plugin restart and old mentions cannot resolve | Expected failure |
| #7 | Sent history survives the 24-hour draft TTL | Expected failure |
| #8 | Long title remains usable evidence | Expected failure |
| #8 | Long classes/role remain usable after Save | Expected failure |
| #9 | Evidence extraction preserves `Some sample text` | Expected failure |

Bun reports expected failures as passing tests; if one unexpectedly passes, the suite fails so the `.failing` marker can be removed. Issue #1 is intentionally a release gate rather than a fake green test: published SDK and companion BB compatibility must be verified after the required API is released.

Fidelity limits: screenshots are deterministic CDP stubs, layout metrics are JSDOM values, and the fixture does not emulate Electron, real BB worker retention, real browser navigation, or published-SDK packaging. Those checks remain required before release.
