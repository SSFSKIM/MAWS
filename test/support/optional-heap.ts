// Diagnostic only: portable DOM suites may sample their Node worker's heap, never use it as an Electron bound.
// Inherit NODE_OPTIONS=--expose-gc; happy-dom's global does not expose Node GC, so read it from a fresh VM context.
import { runInNewContext } from 'node:vm';

const collect = runInNewContext('typeof gc === "function" ? gc : null') as (() => void) | null;
export const collectedHeapMiB = collect ? () => {
  collect();
  return process.memoryUsage().heapUsed / 2 ** 20;
} : undefined;
