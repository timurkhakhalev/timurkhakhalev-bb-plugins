# Browser Annotate testing

Run the package checks from this directory:

```sh
bun install
bun test
bun run check
```

The regression suite has three layers:

- `page-script.test.ts` evaluates the real isolated-world page script in a JSDOM realm with a fake `bb.postMessage`. It covers selection → editor messages, commit validation, synthetic-input rejection, editor close from the page, version bumps on edit/delete, design preview and rollback, Escape cleanup, same-URL restore, the main-world React probe, and the capture flag. JSDOM cannot create trusted events, so these tests pass `allowSyntheticInput`; one test checks that synthetic input is rejected without it.
- `server.regression.test.ts` loads the real server entry into the official SDK fake-host harness. It exercises `start`/`sync`/`capture`/`send`, `captureTab` failure and retry, version-matched screenshots, restore after plugin reload, accepted composer mentions, discard and storage ownership, and sent-history retention. The `sdk.files` adapter is an in-memory `Map`.
- `server.test.ts` and `composer.regression.test.ts` cover prompt formatting and composer mention reconciliation.

| Issue | Regression | Current status |
| --- | --- | --- |
| #2 | Downstream send failure retains the unsent draft and accepted composer mentions settle afterward | Passing |
| #6 | Discard survives restart, cleans owned files, and rejects stale/cross-thread batches | Passing |
| #7 | Sent history survives the 24-hour draft TTL while unsent drafts expire | Passing |
| #8 | Long title, classes/role, custom tags, selector, and metadata remain usable evidence | Covered by schema bounds |
| #9 | Evidence extraction preserves text while normalizing whitespace | Covered by page-script snapshot |

## Published SDK gate

`bun run check` typechecks against `@get-bb/plugin-sdk@0.6.79`, which ships
`experimental_page` on Browser toolbar actions and `captureTab` on
`sdk.experimental_desktopBrowsers`. Before release, run `bb plugin build`, then
install the Git source and walk through `LIVE_SMOKE_CHECKLIST.md`, including a
run against a remote BB server.

Fidelity limits: screenshots are stubs, layout metrics are JSDOM values, and the
tests do not emulate Electron, the native Browser view, or real navigation.
