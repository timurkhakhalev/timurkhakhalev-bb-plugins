import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';

const { experimental_providerBridge: bridge } = await import(pathToFileURL(process.argv[2]).href);
createInterface({ input: process.stdin })
  .on('line', line => bridge.handleLine(line))
  .on('close', () => bridge.onClose());
