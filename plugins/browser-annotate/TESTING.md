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
- `composer.regression.test.ts` and `editor-placement.test.ts` cover pure state transitions and layout boundaries.

The suite has no expected failures for the currently covered issues:

| Issue | Regression | Current status |
| --- | --- | --- |
| #2 | Downstream send failure retains the unsent draft and accepted composer mentions settle afterward | Passing |
| #3 | 50 large captures stay below the 8 MiB host-RPC boundary and remain queued | Passing |
| #4 | Viewport-sized, oversized, partially offscreen, and narrow-view elements receive a visible editor | Passing |
| #5 | An active host entry retains its worker until cleanup | Passing |
| #6 | Discard survives restart, cleans owned files, and rejects stale/cross-thread mentions | Passing |
| #7 | Sent history survives the 24-hour draft TTL while unsent drafts expire | Passing |
| #8 | Long title, classes/role, custom tags, selector, and metadata remain usable evidence | Passing |
| #9 | Evidence extraction preserves `Some sample text` while normalizing whitespace | Passing |

## Published SDK gate

`bun run check` typechecks against the published `@get-bb/plugin-sdk@0.5.9`.
BB 0.43.4 ships the Browser toolbar and image mention APIs used by this plugin.
Before release, run `bb plugin build`, then install the Git source on an
unmodified BB 0.43.4 instance and verify the live Browser workflow.

Before an npm release, run `bun pm pack --dry-run --ignore-scripts`. The file
list must include `dist/server.js`, `dist/host.js`, `dist/app.js` and their
metadata, while excluding regression fixtures.

Fidelity limits: screenshots are deterministic CDP stubs, layout metrics are JSDOM values, and the fixture does not emulate Electron, real daemon worker scheduling, or real browser navigation. Those checks remain required before release.
