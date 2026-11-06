import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const require = createRequire(resolve('packages/plugin-sdk/package.json'));
const react = require.resolve('react');
await build({
  entryPoints: ['apps/app/src/components/thread/embedded-chat/useInlineQueuedMessageEditing.ts'],
  bundle: true, platform: 'node', format: 'esm', conditions: ['source'],
  outfile: '/tmp/bb-queued-edit-hook.mjs',
  alias: { react, '@bb/client-core': resolve('packages/client-core/src/prompt/threadQueuedMessages.ts') },
  external: [react],
  banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' },
});
