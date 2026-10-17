// `session.mcpStatus` answers the renderer without the secrets mcp_status carries (P3 Decision Log 24's residue: the
// engine reports an HTTP server's header values verbatim after env expansion; spikes/p3-connectors/findings.txt §1).
// The answer is the live probe's (spikes/p3-connectors/fixtures/engine-mcp-call.jsonl seq 5, 2.1.296), whose
// `userhttp` server carries the env-expanded `X-Probe-Header`.
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { HostOn } from '@shared/host/runtime';
import { validateCommandOutput } from '@shared/ipc/validate';
import { McpStatusResponseSchema, type McpStatusResponse } from '@shared/wire/control';
import { autoResponder, scriptedTransport } from './conformance/scripted-transport';
import { handshakeResponder, launchSpec } from './conformance/session-harness';
import { TESTED_ENGINE_VERSION } from './engine-compat';
import { registerEngineIpc } from './ipc';
import { RELAY_URL } from './launch';
import { rendererMcpStatus } from './mcp-status';

const REPO_ROOT = resolve(__dirname, '../..');
const HEADER_VALUE = 'fake-value-not-a-credential';
const PROBE_ANSWER = McpStatusResponseSchema.parse(
  (
    readFileSync(join(REPO_ROOT, 'spikes/p3-connectors/fixtures/engine-mcp-call.jsonl'), 'utf8')
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as { seq: number; frame: { response: { response: unknown } } })
      .find((row) => row.seq === 5)!.frame.response.response
  ),
);
const serverOf = (answer: McpStatusResponse, name: string) => answer.mcpServers.find((s) => s.name === name)!;

describe('rendererMcpStatus', () => {
  it('drops header values and every other config field the renderer does not show', () => {
    expect(JSON.stringify(PROBE_ANSWER)).toContain(HEADER_VALUE); // the engine's answer does carry it
    const answer = rendererMcpStatus(PROBE_ANSWER);
    expect(JSON.stringify(answer)).not.toContain(HEADER_VALUE);
    expect(JSON.stringify(answer)).not.toContain('X-Probe-Header');
    expect(serverOf(answer, 'userhttp').config).toEqual({ type: 'http', url: 'http://127.0.0.1:47831/mcp' });
    const stdio = serverOf(PROBE_ANSWER, 'dyntoy').config as { command: string; args: string[] };
    expect(serverOf(answer, 'dyntoy').config).toEqual({ type: 'stdio', command: stdio.command, args: stdio.args });
    const dropped = rendererMcpStatus({ mcpServers: [{ name: 's', status: 'connected', config: { type: 'stdio', command: 'x', env: { TOKEN: 'secret' }, headersHelper: '/bin/h', oauth: { clientId: 'c' } } }] });
    expect(dropped.mcpServers[0]!.config).toEqual({ type: 'stdio', command: 'x' });
  });

  it('keeps everything else the widget reads: status, scope, source, serverInfo, error, tools', () => {
    const answer = rendererMcpStatus(PROBE_ANSWER);
    const withoutConfig = (status: McpStatusResponse) => status.mcpServers.map((server) => Object.fromEntries(Object.entries(server).filter(([field]) => field !== 'config')));
    expect(withoutConfig(answer)).toEqual(withoutConfig(PROBE_ANSWER));
    expect(rendererMcpStatus({ mcpServers: [{ name: 'f', status: 'failed', error: 'spawn ENOENT' }] })).toEqual({ mcpServers: [{ name: 'f', status: 'failed', error: 'spawn ENOENT' }] });
  });

  it('leaves the engine’s answer itself untouched (main-only consumers read it in the host)', () => {
    const before = JSON.stringify(PROBE_ANSWER);
    rendererMcpStatus(PROBE_ANSWER);
    expect(JSON.stringify(PROBE_ANSWER)).toBe(before);
  });
});

describe('session.mcpStatus through the engine host', () => {
  let userData: string;
  beforeEach(async () => {
    userData = await mkdtemp(join(tmpdir(), 'maws-mcp-status-'));
  });
  afterEach(async () => {
    await rm(userData, { recursive: true, force: true, maxRetries: 10 });
  });

  it('answers the renderer-safe status', async () => {
    const handlers = new Map<string, (input: unknown) => Promise<unknown>>();
    const on: HostOn = (name, handler) => void handlers.set(name, handler as (input: unknown) => Promise<unknown>);
    const transport = scriptedTransport({ onWrite: autoResponder(handshakeResponder({ mcp_status: () => ({ response: PROBE_ANSWER }) })) });
    const ipc = registerEngineIpc(on, () => true, {
      userData, replayEnabled: false, cwd: REPO_ROOT, spawn: () => transport, log: () => {} /* the scripted engine refuses the ready context sample */, captureEnv: async () => ({ PATH: '/usr/bin' }),
      binaryProbe: async () => ({ path: '/x/claude', testedVersion: TESTED_ENGINE_VERSION, version: TESTED_ENGINE_VERSION, ok: true, error: null }),
      checkRelay: async () => ({ url: RELAY_URL, ok: true, status: 200, latencyMs: 1, checkedAt: '2026-10-16T00:00:00.000Z', error: null }),
    });
    const id = 'app-mcp-status' as AppSessionId;
    await handlers.get('session.launch')!({ spec: launchSpec({ appSessionId: id }) });
    const start = Date.now();
    while (ipc.table.get(id)?.lifecycle !== 'ready') {
      if (Date.now() - start > 3_000) throw new Error('the session never became ready');
      await new Promise((r) => setTimeout(r, 5));
    }
    const value = await handlers.get('session.mcpStatus')!({ appSessionId: id });
    const checked = validateCommandOutput('session.mcpStatus', value);
    expect(checked.ok).toBe(true);
    expect(JSON.stringify(value)).not.toContain(HEADER_VALUE);
    expect(value).toEqual(rendererMcpStatus(PROBE_ANSWER));
    transport.exit(0);
    await ipc.table.get(id)!.exited;
  });
});
