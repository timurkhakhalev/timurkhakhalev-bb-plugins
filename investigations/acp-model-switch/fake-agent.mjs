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
