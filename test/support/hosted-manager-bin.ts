// The hosted manager (test/support/hosted-manager.ts) as a process a test can kill: bundled with esbuild into one .mjs
// under the repository's node_modules/.cache (its packages stay external, resolved from there), its `?raw` imports read
// as text and the build's version defined as the main bundle's define does; and a client that drives it over stdio.
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { build, type Plugin } from 'esbuild';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { SessionEvent } from '@shared/graph/events';
import type { HostedManagerConfig } from './hosted-manager';

const REPO_ROOT = resolve(__dirname, '../..');

const raw: Plugin = {
  name: 'raw',
  setup(b) {
    b.onResolve({ filter: /\?raw$/ }, (args) => ({ path: resolve(args.resolveDir, args.path.replace(/\?raw$/, '')), namespace: 'raw' }));
    b.onLoad({ filter: /.*/, namespace: 'raw' }, (args) => ({ contents: readFileSync(args.path, 'utf8'), loader: 'text' }));
  },
};

// The bundle, written under `<repo>/node_modules/.cache/<name>/` so its external packages resolve.
export async function buildHostedManager(name: string): Promise<string> {
  const dir = join(REPO_ROOT, 'node_modules', '.cache', name);
  mkdirSync(dir, { recursive: true });
  const outfile = join(dir, 'hosted-manager.mjs');
  await build({
    entryPoints: [join(REPO_ROOT, 'test/support/hosted-manager.ts')],
    outfile, bundle: true, packages: 'external', format: 'esm', platform: 'node', target: 'node22', logLevel: 'error',
    tsconfig: join(REPO_ROOT, 'tsconfig.node.json'), plugins: [raw], define: { __MAWS_VERSION__: '"0.0.0-hosted-manager"' },
    banner: { js: "import { createRequire as __r } from 'node:module'; const require = __r(import.meta.url); import { fileURLToPath as __f } from 'node:url'; const __filename = __f(import.meta.url); const __dirname = __f(new URL('.', import.meta.url));" },
  });
  return outfile;
}

export interface HostedManager {
  readonly pid: number;
  call(name: string, input: unknown): Promise<unknown>;
  status(appSessionId: string): Promise<EngineSessionStatus | null>;
  events(appSessionId: string): SessionEvent[];
  kill(signal: NodeJS.Signals): Promise<void>; // resolves at the process's exit
  handover(graceMs: number): Promise<{ state: 'detaching' } | { state: 'deferred'; inFlight: number }>; // P5 O16 M3b
  readonly exited: Promise<void>; // P5 O16 M3b
  emitted(name: string): unknown[]; // P5 O16 M3b: every payload of an event it emitted
}

export function startHostedManager(bundle: string, config: HostedManagerConfig): HostedManager {
  const child: ChildProcess = spawn(process.execPath, [bundle, JSON.stringify(config)], { cwd: REPO_ROOT, stdio: ['pipe', 'pipe', 'inherit'] });
  const exited = new Promise<void>((done) => child.once('exit', () => done()));
  const waiting = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  const emitted: { emit: string; payload: { appSessionId?: string; events?: SessionEvent[] } }[] = [];
  let next = 0;
  createInterface({ input: child.stdout!, crlfDelay: Infinity }).on('line', (line) => {
    const message = JSON.parse(line) as { id?: number; value?: unknown; error?: string; emit?: string; payload?: never };
    if (message.emit !== undefined) {
      emitted.push({ emit: message.emit, payload: message.payload ?? {} });
      return;
    }
    const waiter = waiting.get(message.id!);
    waiting.delete(message.id!);
    if (message.error !== undefined) waiter?.reject(new Error(message.error));
    else waiter?.resolve(message.value);
  });
  const ask = (line: Record<string, unknown>) =>
    new Promise<unknown>((resolveAnswer, reject) => {
      const id = ++next;
      waiting.set(id, { resolve: resolveAnswer, reject });
      child.stdin!.write(`${JSON.stringify({ id, ...line })}\n`);
    });
  return {
    pid: child.pid!,
    call: (name, input) => ask({ call: name, input }),
    status: (appSessionId) => ask({ status: appSessionId }) as Promise<EngineSessionStatus | null>,
    events: (appSessionId) => emitted.filter((e) => e.emit === 'session.eventBatch' && e.payload.appSessionId === appSessionId).flatMap((e) => e.payload.events ?? []),
    kill: async (signal) => {
      child.kill(signal);
      await exited;
    },
    handover: (graceMs) => ask({ handover: graceMs }) as Promise<{ state: 'detaching' } | { state: 'deferred'; inFlight: number }>,
    exited,
    emitted: (name) => emitted.filter((e) => e.emit === name).map((e) => e.payload),
  };
}
