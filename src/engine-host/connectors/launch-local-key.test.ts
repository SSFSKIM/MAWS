// P3-HD M1: a live launch captures its local-scope `projects` key before the engine spawns and hands it to route D's
// launch context only (connectors/local-key.ts through launcher.ts and EngineSession.connectorLaunchContext); a replay
// captures none; the session's status, the stored launch spec and the journal never carry it. The engine host as the
// runtime builds it, a scripted engine for the process, and a scratch cwd holding a `.git` directory made by hand.
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { LaunchSpecSchema, type LaunchSpec } from '@shared/engine/launch-spec';
import type { HostEmit, HostOn } from '@shared/host/runtime';
import type { BinaryCheck } from '../binary-info';
import { autoResponder, scriptedTransport } from '../conformance/scripted-transport';
import { handshakeResponder } from '../conformance/session-harness';
import { TESTED_ENGINE_VERSION } from '../engine-compat';
import { registerEngineIpc } from '../ipc';
import { RELAY_URL } from '../launch';
import { ENGINE_BIN, ENGINE_VERSION } from '../../../test/support/engine-pin';

const REPO_ROOT = resolve(__dirname, '../../..');
const OK_BINARY: BinaryCheck = { path: ENGINE_BIN, testedVersion: TESTED_ENGINE_VERSION, version: ENGINE_VERSION, ok: true, error: null };
const OK_RELAY = { url: RELAY_URL, ok: true, status: 200, latencyMs: 2, checkedAt: '2026-09-28T10:00:00.000Z', error: null };

let dir: string;
let userData: string;
beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'maws-hd-launchkey-')));
  userData = join(dir, 'user-data');
  mkdirSync(userData);
});
afterEach(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10 }));

const spec = (overrides: Partial<LaunchSpec>): LaunchSpec =>
  LaunchSpecSchema.parse({
    appSessionId: 'app-key', cwd: dir, additionalDirectories: [], model: null, effort: null, permissionMode: null, gateway: 'gateway', subagentModel: null,
    resume: null, sessionId: null, trust: null, mcpConfig: null, extraSettings: null, maxBudgetUsd: null, inheritGrantsFrom: null, replay: null, ...overrides,
  });

function host() {
  const handlers = new Map<string, (input: unknown) => Promise<unknown>>();
  const on: HostOn = (name, handler) => void handlers.set(name, handler as (input: unknown) => Promise<unknown>);
  const emit: HostEmit = () => true;
  const transport = scriptedTransport({ onWrite: autoResponder(handshakeResponder()) });
  const ipc = registerEngineIpc(on, emit, { userData, replayEnabled: true, cwd: REPO_ROOT, binaryProbe: async () => OK_BINARY, checkRelay: async () => OK_RELAY, captureEnv: async () => ({ PATH: '/usr/bin', HOME: dir }), spawn: () => transport });
  return { ipc, launch: (launchSpec: LaunchSpec) => handlers.get('session.launch')!({ spec: launchSpec }) };
}

describe('the launch captures its local-scope key for route D only', () => {
  it('a live launch in a repository’s child directory carries the repository root’s key in its launch context', async () => {
    const repo = join(dir, 'repo');
    mkdirSync(join(repo, '.git'), { recursive: true });
    mkdirSync(join(repo, 'sub'));
    const { ipc, launch } = host();
    await launch(spec({ cwd: join(repo, 'sub') }));
    const session = ipc.table.get('app-key' as AppSessionId)!;
    expect(session.connectorLaunchContext().localKey).toEqual({ kind: 'repository', key: repo });
    // never in what the host reports, stores or journals
    expect(JSON.stringify(session.status())).not.toContain('"repository"');
    expect(readFileSync(session.status().journalPath, 'utf8')).not.toContain('"repository"');
    await ipc.shutdown(1_000);
  });

  it('outside a repository the cwd’s own key; a replay launch captures none', async () => {
    const plain = join(dir, 'plain');
    mkdirSync(plain);
    const { ipc, launch } = host();
    await launch(spec({ cwd: plain }));
    expect(ipc.table.get('app-key' as AppSessionId)!.connectorLaunchContext().localKey).toEqual({ kind: 'directory', key: plain });
    await launch(spec({ appSessionId: 'app-replay' as AppSessionId, cwd: plain, replay: 'test/fixtures/engine/replay-handshake.jsonl' }));
    expect(ipc.table.get('app-replay' as AppSessionId)!.connectorLaunchContext().localKey).toEqual({ kind: 'unidentified', why: 'notCaptured' });
    await ipc.shutdown(1_000);
  });
});
