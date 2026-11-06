# ACP model-switch investigation

This is a local issue draft and a dependency-free reproduction against an existing BB ACP plugin host bundle. It does not change the bundle or connect to a BB server. The fake agent uses only stdio and temporary selection-state files.

Set `ACP_HOST_BUNDLE` to the absolute path of an installed `provider-acp/host.mjs` or its bundled `dist/host.js`. For a source build, use the compiled host entry that exports `experimental_providerBridge`.

```sh
node investigations/acp-model-switch/reproduce.mjs "$ACP_HOST_BUNDLE"
node investigations/acp-model-switch/reproduce.mjs "$ACP_HOST_BUNDLE" --expect-fixed
```

Without the flag, the runner asserts the observed 0.45.0 defect and prints JSON. With the flag, it asserts the expected model/reasoning/tier contract; 0.45.0 fails at B. Both modes wait for completed turn boundaries. Temporary fake sessions are released and the worker is closed; no existing user chat is stopped or prompted.

Files:

- `issue-draft.md`: sanitized English issue body following upstream's filing guide.
- `evidence.json`: actual fixture output against the shipped 0.45.0 bundle.
- `reproduce.mjs`: runs both ACP model-selection interfaces, A → B → A, same-model settings changes, env rebuild, and release/resume controls.
- `bridge-worker.mjs`: loads the unmodified bridge host entry in a separate Node process.
- `fake-agent.mjs`: accepts model/effort/tier changes and records selection state at synthetic prompts; no LLM, auth, tool calls, or HTTP.

Verified 2026-10-06: BB 0.45.0 / desktop-v0.45.0 at 129f621771a3e275773992db648316966ac207cf; macOS 26.6.2; Node 24.12.0. Artifact SHA-256: c199fff3aeff57c22d5474522a456c8ff3cc919defc9697ea7d8e1217e571adf. Source-only main inspection at a4a762cf936dfeee10d3f8586e9d557732e93cef still shows the omission.

Original BB/OpenCode selection metadata was queried read-only and summarized in the draft. CPA network success and the original stop/retry sequence came from the prior investigation; they were not repeated here. No original messages, credentials, personal paths, or private IDs are stored in these artifacts.

Published with user authorization: https://github.com/get-bb/bb/issues/5051. The issue includes the three runnable scripts and captured JSON inline. `issue-published-body.md` is the verified published body, including a refreshed main source check at 6e348ee48c5d4e23d67b2d31d98b31acb3494739; `issue-draft.md` preserves the initial draft.
