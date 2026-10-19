// P3-HD M2: the transport scenes' scratch layout (e2e/connectors-direct.spec.ts, "transport"). MAWS's own stdio instance
// is started through a wrapper that stands in for npx: a shell that stays the server's parent (no exec), records its
// own pid, and leaves an EOF-ignoring grandchild (`sleep`) beside the fixture server, so a cleanup that signals only the
// direct child, or relies on stdin's end, is seen to leave members behind. Every value is a scratch fake; nothing of
// the owner's is read.
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { StdioLaunch } from '../../src/engine-host/connectors/direct-stdio';
import { DIRECT_SERVER, type ProbeLayout } from './connector-direct-probe';
import { shellQuoted } from './connector-direct-checks'; // P3-F (sweep#1)

export const DIRECT_HOST = join(__dirname, 'connector-direct-host.mjs');

export interface WrapperPids {
  wrappers: number[];
  sleepers: number[];
}

export function writeWrapper(layout: ProbeLayout): { path: string; log: string } {
  const path = join(layout.bin, 'npx-standin');
  const log = join(layout.scratch, 'wrapper.log');
  writeFileSync(path, `#!/bin/sh\nprintf 'wrapper %s\\n' "$$" >> "$MAWS_PROBE_WRAPPER_LOG"\n/bin/sleep 600 </dev/null >/dev/null 2>&1 &\nprintf 'sleeper %s\\n' "$!" >> "$MAWS_PROBE_WRAPPER_LOG"\n${shellQuoted(process.execPath)} "$@"\n`); // P3-F (sweep#1): the interpreter one literal word, never expanded
  chmodSync(path, 0o755);
  return { path, log };
}

export function wrapperPids(log: string): WrapperPids {
  const lines = existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean) : [];
  const of = (kind: string) => lines.filter((line) => line.startsWith(`${kind} `)).map((line) => Number(line.slice(kind.length + 1)));
  return { wrappers: of('wrapper'), sleepers: of('sleeper') };
}

// A launch as source-entry.ts materializes one: the resolved wrapper, literal args, the scratch cwd and exactly these
// variables (the SDK-minimal keys of a scratch launch plus the configured ones).
export function wrappedLaunch(layout: ProbeLayout, wrapper: { path: string; log: string }, id: string): StdioLaunch {
  return {
    transport: 'stdio',
    command: 'npx-standin',
    executable: wrapper.path,
    args: [DIRECT_SERVER, 'stdio', '--id', id, '--log', layout.log, 'an arg with spaces', '$NOT_EXPANDED'],
    cwd: layout.project,
    env: { HOME: layout.home, PATH: '/usr/bin:/bin', MAWS_PROBE_PLAIN: `plain-${id}`, MAWS_PROBE_WRAPPER_LOG: wrapper.log },
  };
}

export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export async function until(predicate: () => boolean, timeoutMs: number, stepMs = 50): Promise<number> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error(`not within ${timeoutMs} ms`);
    await new Promise((resolve) => setTimeout(resolve, stepMs));
  }
  return Date.now() - started;
}
