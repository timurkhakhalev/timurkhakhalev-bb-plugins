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
