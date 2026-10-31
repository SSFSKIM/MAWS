// An engine host's session half as a process of its own (docs/doperpowers/plans/2026-10-31-p5-o16-holder.md, M3's
// Proves: an adoption after a manager is killed with SIGKILL mid-stream). It registers the engine host's handlers over
// a real session host binary and the stub engine, exactly as the in-process harness of
// src/engine-host/holder/hosted-launch.test.ts does, and is driven over stdio, so a test can kill it as a crash kills an
// engine host and adopt what it left from the test's own process. test/support/hosted-manager-bin.ts bundles it.
//
//   node hosted-manager.mjs '<config JSON>'
//
// stdin, one JSON line each: `{id, call, input}` runs a command handler; `{id, status}` reads a row's status.
// stdout, one JSON line each: `{id, value}` or `{id, error}` answers a line; `{emit, payload}` is every event emitted.
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { createInterface } from 'node:readline';
import type { AppSessionId } from '@shared/graph/ids';
import type { HostEmit, HostOn } from '@shared/host/runtime';
import { hostsDirOf } from '../../src/engine-host/holder/files';
import { startSessionHost } from '../../src/engine-host/holder/transport';
import { registerEngineIpc } from '../../src/engine-host/ipc';
import { RELAY_URL } from '../../src/engine-host/launch';

export interface HostedManagerConfig {
  userData: string;
  stub: string; // the engine binary the probe answers
  binary: string; // the session host binary
  version: string; // the engine version the probe answers
  hostArgs?: string[]; // the session host binary's test seams (`--ring-cap-bytes`)
  env?: Record<string, string>; // captured beside PATH (a test's CLAUDE_CONFIG_DIR)
}

const config = JSON.parse(process.argv[2] ?? '{}') as HostedManagerConfig;
const out = (line: unknown) => process.stdout.write(`${JSON.stringify(line)}\n`);
const handlers = new Map<string, (input: unknown) => Promise<unknown>>();
const on: HostOn = (name, handler) => void handlers.set(name, handler as (input: unknown) => Promise<unknown>);
const emit: HostEmit = (name, payload) => {
  out({ emit: name, payload });
  return true;
};
const ipc = registerEngineIpc(on, emit, {
  userData: config.userData, replayEnabled: false, log: () => {},
  holder: {
    gateSocket: join(config.userData, 'supervisor', 'gate.sock'),
    start: (launchId) => startSessionHost(launchId, { hostsDir: hostsDirOf(join(config.userData, 'supervisor')), binary: config.binary, userData: config.userData, tmpdir: tmpdir(), log: () => {}, hostArgs: config.hostArgs }),
  },
  binaryProbe: async () => ({ path: config.stub, testedVersion: config.version, version: config.version, ok: true, error: null }),
  checkRelay: async () => ({ url: RELAY_URL, ok: true, status: 200, latencyMs: 2, checkedAt: new Date().toISOString(), error: null }),
  captureEnv: async () => ({ PATH: '/usr/bin:/bin', ...config.env }),
});

createInterface({ input: process.stdin, crlfDelay: Infinity }).on('line', (line) => {
  const asked = JSON.parse(line) as { id: number; call?: string; input?: unknown; status?: string };
  if (asked.status !== undefined) {
    out({ id: asked.id, value: ipc.table.get(asked.status as AppSessionId)?.status() ?? null });
    return;
  }
  const handler = handlers.get(asked.call ?? '');
  if (!handler) {
    out({ id: asked.id, error: `no handler ${asked.call}` });
    return;
  }
  handler(asked.input).then(
    (value) => out({ id: asked.id, value }),
    (error: unknown) => out({ id: asked.id, error: error instanceof Error ? error.message : String(error) }),
  );
});
