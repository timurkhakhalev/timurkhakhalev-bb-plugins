# ACP follow-up turns ignore changed model selection and keep the startup model

## Summary

Changing the selected model between completed turns in a live OpenCode ACP chat records the new choice in BB, but OpenCode continues using the startup model. An isolated reproduction against BB's shipped ACP bridge requests A → B → A and observes A → A → A, with no model-selection RPC between prompts. Expected: apply the explicit selection before the next prompt in the same session.

## Versions and environment

- BB desktop / bundled CLI **0.45.0**, macOS **26.6.2**; local execution.
- Original provider: built-in **acp-opencode**, OpenCode CLI **1.18.34**.
- Owning repository: **get-bb/bb**, `packages/provider-bridge-acp`; built-in `provider-acp` plugin version **0.1.0** exports this bridge.
- Release source: `desktop-v0.45.0`, commit **129f621771a3e275773992db648316966ac207cf**.
- Executed artifact: installed `provider-acp/host.mjs`, SHA-256 **c199fff3aeff57c22d5474522a456c8ff3cc919defc9697ea7d8e1217e571adf**. Its bytes match the desktop's bundled `provider-acp/dist/host.js`.
- Reproduction runtime: Node **24.12.0**, synthetic ACP agent using JSON-RPC over stdio. Each case has a temporary workspace, HOME, BB/XDG directories and an explicit environment allowlist. No real provider process or inference request is involved.
- Upstream inspected on 2026-10-06: `main` at **6e348ee48c5d4e23d67b2d31d98b31acb3494739**. The same model-selection omission remains in source; the runtime test was run on the shipped 0.45.0 bundle, not a compiled main build.

## Steps to reproduce

The runnable fixture and captured `evidence.json` are included below in collapsible blocks. Save the three scripts together, then point the runner at an existing BB ACP plugin host bundle:

```sh
node reproduce.mjs "$ACP_HOST_BUNDLE"
node reproduce.mjs "$ACP_HOST_BUNDLE" --expect-fixed
```

The first command asserts the observed defect and prints `"result": "bug reproduced"`. The second checks the expected contract and currently exits 1 with `AssertionError: B`.

Exact bridge operations in each test case:

1. `thread/start` with `options.model="fake/a"`, `reasoningLevel="low"`, `serviceTier="default"`. Fake agent starts at B, so successful startup selection is independently observable.
2. Send `turn/start` for A. Wait for the completed turn boundary.
3. Send another `turn/start` for B, high reasoning, fast tier. Keep the same live bridge thread and ACP session.
4. Send another `turn/start` for A, medium reasoning, default tier. Keep the same session.
5. Send another A turn with high reasoning and fast tier to test settings changes without a model change.
6. Request B with a changed non-secret env marker. BB rebuilds/resumes the process, but still uses the old construction selection.
7. Release only this isolated bridge thread, then `thread/resume` with B/high/fast; the next prompt successfully uses B/high/fast.

Every prompt is the literal synthetic text `report synthetic selection`. The fake agent records only method names, selection values, and its current model/effort/tier; it never records prompt bodies. The runner repeats the case for an agent advertising model `configOptions` and for an agent advertising only the legacy `models` field. The A → B → A portion has exactly one `session/new`, no `session/load`, and one live ACP process.

Equivalent user-facing trigger: finish a normal OpenCode ACP turn, choose another model in BB's model picker, and send a follow-up. Compare BB requested metadata with OpenCode assistant model metadata, not the picker label alone. A fresh paid-model UI reproduction was not performed for this report.

## Expected vs actual

Both fake-agent interfaces produced the same result:

| Turn | Requested model / effort / tier | Actual fake-agent state at prompt |
| --- | --- | --- |
| A | fake/a / low / default | fake/a / low / default |
| B | fake/b / high / fast | **fake/a / low / default** |
| A again | fake/a / medium / default | **fake/a / low / default** |
| A with settings change | fake/a / high / fast | **fake/a / low / default** |
| B with env rebuild | fake/b / high / fast | **fake/a / low / default** |
| B after release/resume | fake/b / high / fast | fake/b / high / fast |

Verbatim method trace for the config-options case before the env/release controls:

```text
initialize
session/new
session/set_config_option model=fake/a
session/set_config_option effort=low
session/set_config_option fast=false
session/prompt
session/prompt
session/prompt
session/prompt
```

The models-field case substitutes `session/set_model modelId=fake/a` for the startup model config request; there are again no subsequent model setters.

Expected: the B prompt is preceded by an acknowledged selection of B, followed by its requested supported settings; returning to A applies A again. Restart/resume must use the current selection rather than the original construction options. Rejected configuration must not silently dispatch a prompt under the old model as though the new choice succeeded.

## Evidence

Fresh read-only queries selected only execution/model fields in BB and OpenCode SQLite stores. No user message text, credentials, private entity IDs, or personal paths are included below:

| BB `client/turn/requested` model | OpenCode user/assistant model metadata at the corresponding prompt |
| --- | --- |
| cpa/space-bunny-free | cpa / space-bunny-free |
| opencode/space-bunny-free | **cpa / space-bunny-free** |
| cpa/glm-5.3-flash | **cpa / space-bunny-free** |
| cpa/glm-5.3-flash after runtime recreation | cpa / glm-5.3-flash |

This metadata corroborates the original symptom. It is OpenCode's recorded selection, not independent proof of a backend's internal model identity. The fake-agent reproduction independently establishes that BB sends no switch request.

Primary source evidence and root cause:

- [Plugin host export](https://github.com/get-bb/bb/blob/129f621771a3e275773992db648316966ac207cf/plugins/provider-acp/src/host.ts#L1-L8): the built-in plugin delegates to the SDK ACP bridge, rather than code in the reporter's plugin collection.
- [Release `turn/start`](https://github.com/get-bb/bb/blob/129f621771a3e275773992db648316966ac207cf/packages/provider-bridge-acp/src/bridge/bridge.ts#L2631-L2679): reads the incoming options for env changes, but does not apply model/effort/tier. On env/cancellation rebuild it spreads `session.construction`, preserving the old selection.
- [Release `runTurn`](https://github.com/get-bb/bb/blob/129f621771a3e275773992db648316966ac207cf/packages/provider-bridge-acp/src/bridge/bridge.ts#L2081-L2118): directly calls `session/prompt` without a selection step. Pending input does not retain execution options.
- [Startup/load/fork selection](https://github.com/get-bb/bb/blob/129f621771a3e275773992db648316966ac207cf/packages/provider-bridge-acp/src/bridge/bridge.ts#L1870-L1903): `selectAcpNativeModel` is invoked when constructing a session.
- [Selection helper](https://github.com/get-bb/bb/blob/129f621771a3e275773992db648316966ac207cf/packages/provider-bridge-acp/src/bridge/bridge.ts#L1148-L1283): uses model config or `session/set_model`, then calls native reasoning/service-tier selectors. All these updates are skipped on live follow-ups.
- [Construction selection conversion](https://github.com/get-bb/bb/blob/129f621771a3e275773992db648316966ac207cf/packages/provider-bridge-acp/src/session-params.ts#L208-L254): translates execution options into native or CLI selection. Fast tier is native only in the parameterized path; this report does not claim OpenCode itself supports fast tier.
- [Current main reconciliation](https://github.com/get-bb/bb/blob/6e348ee48c5d4e23d67b2d31d98b31acb3494739/packages/provider-bridge-acp/src/bridge/bridge.ts#L2184-L2242): new reconciliation handles env/permission/write roots, but retains `construction.modelSelection` and does not call the native model helper. [Main dispatch](https://github.com/get-bb/bb/blob/6e348ee48c5d4e23d67b2d31d98b31acb3494739/packages/provider-bridge-acp/src/bridge/bridge.ts#L2753-L2780) routes through this helper. Main was inspected, not executed.
- [ACP session configuration contract](https://agentclientprotocol.com/protocol/v1/session-config-options): clients can set session options; setter responses and agent updates carry complete current state, including dependent options.

Minimal fix direction: reconcile supported explicit model/effort/tier choices at the shared pre-prompt path using current turn options. Apply native choices in the live session; rebuild CLI-only agents with the new launch selection when necessary. Update construction selection for later recovery. Preserve per-input options when processing queued inputs/steers. This report reproduces completed follow-ups; steering changes are a source-derived adjacent path, not a separately exercised scenario.

Avoid introducing a second stale-state bug: `shouldSetModel` compares `currentValue`/`currentModelId`, so reusing startup config for A → B → A could skip the return to A. Currently the bridge does not retain an authoritative config snapshot on `AcpThreadSession`; this is a requirement for the fix, not the cause of the reproduced omission. Persist setter responses and reconcile relevant agent config updates before using cached state. Validate reasoning/tier against the resulting model configuration. Model/effort/tier and env-recovery controls in this fixture provide a small regression contract.

## What was ruled out / confidence limits

- Not a CPA routing/authentication failure: the same omission occurs with a local fake agent, no credentials, and no network inference. The separate free-model route misconfiguration is outside this issue.
- Initial selection works, and explicit release/resume applies B successfully in the fixture. The defect is live follow-up reconciliation.
- High confidence in the BB ACP bridge root cause: real shipped code, both ACP setter interfaces, requested-vs-actual assertions, and sanitized method traces agree.
- No executed main build or new paid-provider reproduction; other ACP agents and CLI-only model selectors were not live-tested. Reasoning/tier propagation is verified only where the fake agent advertises support.
- Open and closed GitHub issues and PRs were searched with ACP/model, model switch/switching, follow-up, ignored/stale model, and set_model queries on 2026-10-06. No exact duplicate was found within those results.
- [#2160](https://github.com/get-bb/bb/issues/2160) has a similar symptom in the Pi provider and is closed; it owns a different bridge.
- [#4433](https://github.com/get-bb/bb/issues/4433) proposes broader model intent/observation semantics. This report is the narrower accepted-but-ignored explicit ACP follow-up selection bug.
- [#1787](https://github.com/get-bb/bb/issues/1787) concerns requested-versus-executed observability; it does not implement live ACP switching.
- [#2925](https://github.com/get-bb/bb/issues/2925) concerns startup setter errors being retried through an unsupported method. This fixture has successful startup setters and no subsequent setters.
- [#3899](https://github.com/get-bb/bb/issues/3899) concerns OpenCode Zen reasoning discovery; catalog discovery is bypassed in this reproduction.

## Suggested priority and effort

High: explicit model changes silently use the prior model and can consume unintended quota. Runtime recreation is an observed workaround. The fix belongs to ACP execution reconciliation; UI label changes alone do not address it.

Investigation report: the sanitized evidence and root-cause analysis above, with the complete runnable fixture and captured output below. No PR or installed-app patch was made.

## Checks

- [x] Reproduced on the latest desktop release, 0.45.0.
- [x] Searched open and closed issues and PRs for duplicates; repeated the follow-up-model search immediately before publication.
- [x] Included the investigation report, commit permalinks, and executable fixture; body ends with the agent marker.

## Runnable fixture and captured output

<details>
<summary>reproduce.mjs</summary>

```javascript
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { once } from 'node:events';

const bundle = resolve(process.argv[2] ?? '');
assert(process.argv[2] && existsSync(bundle), 'Usage: node reproduce.mjs /absolute/path/to/provider-acp/host.mjs [--expect-fixed]');
const here = fileURLToPath(new URL('.', import.meta.url));
const expectedFixed = process.argv.includes('--expect-fixed');
const output = [];

for (const modelsField of [false, true]) {
  const scratch = mkdtempSync(join(tmpdir(), 'bb-acp-model-repro-'));
  mkdirSync(join(scratch, 'home'));
  const stateFile = join(scratch, 'state.jsonl');
  const env = { PATH: process.env.PATH, HOME: join(scratch, 'home'), TMPDIR: scratch,
    BB_DATA_DIR: join(scratch, 'bb-data'), XDG_CONFIG_HOME: join(scratch, 'config'),
    XDG_DATA_HOME: join(scratch, 'data'), XDG_CACHE_HOME: join(scratch, 'cache') };
  const child = spawn(process.execPath, [join(here, 'bridge-worker.mjs'), bundle],
    { cwd: scratch, env, stdio: ['pipe', 'pipe', 'pipe'] });
  const messages = [];
  let errors = '';
  child.stderr.on('data', data => { errors += data; });
  createInterface({ input: child.stdout }).on('line', line => messages.push(JSON.parse(line)));
  const wait = async predicate => {
    const deadline = Date.now() + 15000;
    while (!predicate()) {
      if (child.exitCode !== null || Date.now() > deadline) throw Error('Bridge timeout/exit: ' + errors);
      await new Promise(done => setTimeout(done, 10));
    }
  };
  let serial = 0;
  const request = async (method, params) => {
    const id = ++serial;
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    await wait(() => messages.some(message => message.id === id));
    const reply = messages.find(message => message.id === id);
    assert(!reply.error, JSON.stringify(reply.error));
    return reply.result;
  };
  const records = () => readFileSync(stateFile, 'utf8').trim().split('\n').map(JSON.parse);
  const options = (model, reasoningLevel, serviceTier, envVars) => ({
    permissionMode: 'full', permissionScope: 'full', approvalReviewer: null, permissionEscalation: null,
    model, reasoningLevel, serviceTier, ...(envVars ? { envVars } : {}),
    providerOptions: { parameterizedModelPicker: true, acpDialect: 'opencode', acpLaunchSpec: {
      displayName: 'Fake ACP', command: process.execPath, args: [join(here, 'fake-agent.mjs')],
      env: { FAKE_STATE_FILE: stateFile, FAKE_MODELS_FIELD: modelsField ? '1' : '0' },
    } },
  });
  const initial = options('fake/a', 'low', 'default');
  const rows = [];
  const completions = () => messages.flatMap(message => message.params?.deltas ?? [])
    .filter(delta => delta.kind === 'turn.boundary' && delta.status === 'completed').length;
  const turn = async (settings, label) => {
    const count = records().filter(record => record.method === 'session/prompt').length;
    const completed = completions();
    await request('turn/start', { threadId: 'isolated-thread', providerThreadId: 'fake-session',
      clientRequestId: 'creq_abcdefghjk', options: settings,
      input: [{ type: 'text', text: 'report synthetic selection', mentions: [] }] });
    await wait(() => records().filter(record => record.method === 'session/prompt').length > count);
    await wait(() => completions() > completed);
    const actual = records().filter(record => record.method === 'session/prompt').at(-1).actual;
    rows.push({ label, requested: { model: settings.model, reasoning: settings.reasoningLevel,
      fast: settings.serviceTier === 'fast' ? 'true' : 'false' }, actual });
  };
  try {
    const started = await request('thread/start', { threadId: 'isolated-thread', cwd: scratch,
      instructionMode: 'append', options: initial });
    assert.equal(started.providerThreadId, 'fake-session');
    await turn(initial, 'A');
    await turn(options('fake/b', 'high', 'fast'), 'B');
    await turn(options('fake/a', 'medium', 'default'), 'A again');
    await turn(options('fake/a', 'high', 'fast'), 'same model; effort/tier changed');
    const liveTrace = records().map(({ method, configId, value, modelId }) =>
      ({ method, ...(configId ? { configId, value } : {}), ...(modelId ? { modelId } : {}) }));
    assert.equal(liveTrace.filter(record => record.method === 'session/new').length, 1);
    assert.equal(liveTrace.filter(record => record.method === 'session/load').length, 0);
    if (expectedFixed) {
      for (const row of rows) assert.deepEqual(row.actual, row.requested, row.label);
    } else {
      for (const row of rows) assert.deepEqual(row.actual, rows[0].requested);
      assert.notDeepEqual(rows[1].actual, rows[1].requested);
    }
    await turn(options('fake/b', 'high', 'fast', { REPRO_NONSECRET_MARKER: 'changed' }), 'B with env rebuild');
    assert.deepEqual(rows.at(-1).actual, expectedFixed ? rows.at(-1).requested : rows[0].requested);
    await request('thread/stop', { threadId: 'isolated-thread', providerThreadId: 'fake-session', activeTurnId: null, intent: 'release' });
    await request('thread/resume', { threadId: 'isolated-thread', providerThreadId: 'fake-session',
      cwd: scratch, instructionMode: 'append', options: options('fake/b', 'high', 'fast') });
    await turn(options('fake/b', 'high', 'fast'), 'B after release/resume');
    assert.deepEqual(rows.at(-1).actual, rows.at(-1).requested);
    output.push({ interface: modelsField ? 'session/set_model' : 'session/set_config_option', rows, liveTrace });
    await request('thread/stop', { threadId: 'isolated-thread', providerThreadId: 'fake-session', activeTurnId: null, intent: 'release' });
  } finally {
    child.stdin.end();
    const exited = once(child, 'exit');
    const timer = setTimeout(() => child.kill('SIGTERM'), 3000);
    await exited;
    clearTimeout(timer);
    rmSync(scratch, { recursive: true, force: true });
  }
}
console.log(JSON.stringify({ result: expectedFixed ? 'fixed contract passed' : 'bug reproduced', cases: output }, null, 2));
```

</details>

<details>
<summary>bridge-worker.mjs</summary>

```javascript
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';

const { experimental_providerBridge: bridge } = await import(pathToFileURL(process.argv[2]).href);
createInterface({ input: process.stdin })
  .on('line', line => bridge.handleLine(line))
  .on('close', () => bridge.onClose());
```

</details>

<details>
<summary>fake-agent.mjs</summary>

```javascript
import { createInterface } from 'node:readline';
import { appendFileSync, readFileSync, existsSync } from 'node:fs';

const stateFile = process.env.FAKE_STATE_FILE;
let state = existsSync(stateFile)
  ? JSON.parse(readFileSync(stateFile, 'utf8').trim().split('\n').at(-1)).actual
  : { model: 'fake/b', reasoning: 'low', fast: 'false' };
const config = () => ({
  configOptions: [
    ...(process.env.FAKE_MODELS_FIELD === '1' ? [] : [{
      id: 'model', name: 'Model', category: 'model', type: 'select',
      currentValue: state.model,
      options: ['fake/a', 'fake/b'].map(value => ({ value, name: value })),
    }]),
    { id: 'effort', name: 'Effort', category: 'thought_level', type: 'select',
      currentValue: state.reasoning,
      options: ['low', 'medium', 'high'].map(value => ({ value, name: value })) },
    { id: 'fast', name: 'Fast', type: 'select', currentValue: state.fast,
      options: ['false', 'true'].map(value => ({ value, name: value })) },
  ],
  ...(process.env.FAKE_MODELS_FIELD === '1' ? { models: {
    currentModelId: state.model,
    availableModels: ['fake/a', 'fake/b'].map(modelId => ({ modelId, name: modelId })),
  }} : {}),
});
const send = message => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
for await (const line of createInterface({ input: process.stdin })) {
  const request = JSON.parse(line);
  const { id, method, params = {} } = request;
  let result;
  switch (method) {
    case 'initialize':
      result = { protocolVersion: 1, agentCapabilities: { loadSession: true } };
      break;
    case 'session/new':
      result = { sessionId: 'fake-session', ...config() };
      break;
    case 'session/load':
      result = config();
      break;
    case 'session/set_model':
      state.model = params.modelId;
      result = config();
      break;
    case 'session/set_config_option':
      state[{ model: 'model', effort: 'reasoning', fast: 'fast' }[params.configId]] = params.value;
      result = config();
      break;
    case 'session/prompt':
      send({ method: 'session/update', params: { sessionId: 'fake-session', update: {
        sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: JSON.stringify(state) },
      } } });
      result = { stopReason: 'end_turn' };
      break;
    case 'session/cancel':
      continue;
    default:
      send({ id, error: { code: -32601, message: 'Unsupported fake method' } });
      continue;
  }
  appendFileSync(stateFile, JSON.stringify({ method,
    ...(params.configId ? { configId: params.configId, value: params.value } : {}),
    ...(params.modelId ? { modelId: params.modelId } : {}),
    actual: { ...state },
  }) + '\n');
  send({ id, result });
}
```

</details>

<details>
<summary>evidence.json</summary>

```json
{
  "result": "bug reproduced",
  "cases": [
    {
      "interface": "session/set_config_option",
      "rows": [
        {
          "label": "A",
          "requested": {
            "model": "fake/a",
            "reasoning": "low",
            "fast": "false"
          },
          "actual": {
            "model": "fake/a",
            "reasoning": "low",
            "fast": "false"
          }
        },
        {
          "label": "B",
          "requested": {
            "model": "fake/b",
            "reasoning": "high",
            "fast": "true"
          },
          "actual": {
            "model": "fake/a",
            "reasoning": "low",
            "fast": "false"
          }
        },
        {
          "label": "A again",
          "requested": {
            "model": "fake/a",
            "reasoning": "medium",
            "fast": "false"
          },
          "actual": {
            "model": "fake/a",
            "reasoning": "low",
            "fast": "false"
          }
        },
        {
          "label": "same model; effort/tier changed",
          "requested": {
            "model": "fake/a",
            "reasoning": "high",
            "fast": "true"
          },
          "actual": {
            "model": "fake/a",
            "reasoning": "low",
            "fast": "false"
          }
        },
        {
          "label": "B with env rebuild",
          "requested": {
            "model": "fake/b",
            "reasoning": "high",
            "fast": "true"
          },
          "actual": {
            "model": "fake/a",
            "reasoning": "low",
            "fast": "false"
          }
        },
        {
          "label": "B after release/resume",
          "requested": {
            "model": "fake/b",
            "reasoning": "high",
            "fast": "true"
          },
          "actual": {
            "model": "fake/b",
            "reasoning": "high",
            "fast": "true"
          }
        }
      ],
      "liveTrace": [
        {
          "method": "initialize"
        },
        {
          "method": "session/new"
        },
        {
          "method": "session/set_config_option",
          "configId": "model",
          "value": "fake/a"
        },
        {
          "method": "session/set_config_option",
          "configId": "effort",
          "value": "low"
        },
        {
          "method": "session/set_config_option",
          "configId": "fast",
          "value": "false"
        },
        {
          "method": "session/prompt"
        },
        {
          "method": "session/prompt"
        },
        {
          "method": "session/prompt"
        },
        {
          "method": "session/prompt"
        }
      ]
    },
    {
      "interface": "session/set_model",
      "rows": [
        {
          "label": "A",
          "requested": {
            "model": "fake/a",
            "reasoning": "low",
            "fast": "false"
          },
          "actual": {
            "model": "fake/a",
            "reasoning": "low",
            "fast": "false"
          }
        },
        {
          "label": "B",
          "requested": {
            "model": "fake/b",
            "reasoning": "high",
            "fast": "true"
          },
          "actual": {
            "model": "fake/a",
            "reasoning": "low",
            "fast": "false"
          }
        },
        {
          "label": "A again",
          "requested": {
            "model": "fake/a",
            "reasoning": "medium",
            "fast": "false"
          },
          "actual": {
            "model": "fake/a",
            "reasoning": "low",
            "fast": "false"
          }
        },
        {
          "label": "same model; effort/tier changed",
          "requested": {
            "model": "fake/a",
            "reasoning": "high",
            "fast": "true"
          },
          "actual": {
            "model": "fake/a",
            "reasoning": "low",
            "fast": "false"
          }
        },
        {
          "label": "B with env rebuild",
          "requested": {
            "model": "fake/b",
            "reasoning": "high",
            "fast": "true"
          },
          "actual": {
            "model": "fake/a",
            "reasoning": "low",
            "fast": "false"
          }
        },
        {
          "label": "B after release/resume",
          "requested": {
            "model": "fake/b",
            "reasoning": "high",
            "fast": "true"
          },
          "actual": {
            "model": "fake/b",
            "reasoning": "high",
            "fast": "true"
          }
        }
      ],
      "liveTrace": [
        {
          "method": "initialize"
        },
        {
          "method": "session/new"
        },
        {
          "method": "session/set_model",
          "modelId": "fake/a"
        },
        {
          "method": "session/set_config_option",
          "configId": "effort",
          "value": "low"
        },
        {
          "method": "session/set_config_option",
          "configId": "fast",
          "value": "false"
        },
        {
          "method": "session/prompt"
        },
        {
          "method": "session/prompt"
        },
        {
          "method": "session/prompt"
        },
        {
          "method": "session/prompt"
        }
      ]
    }
  ]
}
```

</details>

> AGENT GENERATED
