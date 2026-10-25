// P3-H H3b: the engine host's `connectors.*` surface over the real store and a scripted engine, called as the runtime
// calls a handler (input validated, output checked against the registry): every host-owned command handled with one
// deadline shape, the grant store's commands, an operation's start, end and take, the events carrying nothing but ids
// and tools, and everything ended when main's client goes.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HostCommandError, type HostEmit, type HostOn } from '@shared/host/runtime';
import { commands, type CommandName, type CommandOutput, type EventName } from '@shared/ipc/schema';
import { validateCommandInput, validateCommandOutput, validateEventPayload } from '@shared/ipc/validate';
import type { StdinFrame } from '@shared/wire/frames';
import { openDocuments, type Documents } from '../documents';
import { ControlClient } from '../rpc';
import type { EngineTransport } from '../transport';
import { CONNECTORS_DEADLINE_SHAPES, registerConnectors, RUNNER_CONNECTOR_COMMANDS } from './register';

const SESSION = 'app-1';
const SERVERS = [
  {
    name: 'fixture',
    status: 'connected',
    scope: 'project',
    config: { type: 'http', url: 'http://127.0.0.1:47831/mcp', headers: { Authorization: 'Bearer sentinel-header' } },
    tools: [{ name: 'rows', annotations: { readOnly: true } }],
  },
];

let dir: string;
let documents: Documents | null;
let handlers: Map<string, (input: unknown) => Promise<unknown>>;
let emitted: { name: EventName; payload: unknown }[];
let gone: (() => void)[];
let surface: { close(): void } | null;
let writes: StdinFrame[];
let holdCalls: boolean;

function scriptedClient(): ControlClient {
  const transport: EngineTransport = {
    pid: null,
    frames: (async function* () {})(),
    stderr: (async function* () {})(),
    write: (frame) => {
      writes.push(frame);
      if (frame.type === 'control_request') {
        const { subtype } = frame.request as { subtype: string };
        const response = subtype === 'mcp_status' ? { mcpServers: SERVERS } : subtype === 'mcp_call' && !holdCalls ? { content: 'rows 107' } : null;
        if (response) queueMicrotask(() => client.observe({ type: 'control_response', response: { subtype: 'success', request_id: frame.request_id, response } } as never));
      }
      return Promise.resolve();
    },
    endInput: () => {},
    kill: () => {},
    exited: new Promise(() => {}),
  };
  const client = new ControlClient(transport, { row: (direction, frame) => ({ seq: 0, direction, at: '', frame }) }, 'L1', { warn: () => {} });
  return client;
}

function register(docs: Documents | null = documents): void {
  handlers = new Map();
  emitted = [];
  gone = [];
  const on: HostOn = (name, handler) => void handlers.set(name, handler as (input: unknown) => Promise<unknown>);
  const emit: HostEmit = (name, payload) => {
    expect(validateEventPayload(name, payload).ok, name).toBe(true);
    emitted.push({ name, payload });
    return true;
  };
  const control = scriptedClient();
  const session = { lifecycle: 'ready' as const, control, status: () => ({ launchId: 'L1', cwd: '/work/project' }) };
  surface = registerConnectors(on, emit, { onClientGone: (hook) => (gone.push(hook), () => {}) }, { sessions: { get: (id) => (id === SESSION ? (session as never) : undefined) }, store: docs?.store ?? null });
}

async function call<N extends CommandName>(name: N, input: unknown): Promise<CommandOutput<N>> {
  const checked = validateCommandInput(name, input);
  if (!checked.ok) throw new Error(`invalid input for ${name}: ${JSON.stringify(checked.error)}`);
  const value = await handlers.get(name)!(checked.value);
  const output = validateCommandOutput(name, value);
  if (!output.ok) throw new Error(`invalid output of ${name}: ${JSON.stringify(output.error.issues).slice(0, 400)}`);
  return output.value as CommandOutput<N>;
}
const events = (name: EventName) => emitted.filter((event) => event.name === name).map((event) => event.payload);
// the tool's calls (the compatibility probe's call names an absent server)
const mcpCalls = () => writes.filter((frame) => frame.type === 'control_request' && (frame.request as { tool?: string }).tool === 'mcp__fixture__rows');

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'maws-connectors-ipc-'));
  documents = openDocuments(dir, () => {});
  writes = [];
  holdCalls = false;
  register();
});
afterEach(() => {
  surface?.close();
  documents?.close();
  rmSync(dir, { recursive: true, force: true });
});

const operationId = '00000000-0000-4000-8000-000000000001';

describe('the engine host’s connectors surface (P3-H H3b)', () => {
  it('handles every connectors command the engine host owns, each in one deadline shape, and owns none of main’s', () => {
    // P4-AGG M4: add and remove are the plugin runner's, registered beside `plugins.*` (ipc.ts)
    const owned = Object.entries(commands).filter(([name, spec]) => name.startsWith('connectors.') && spec.owner === 'engine-host' && !(RUNNER_CONNECTOR_COMMANDS as readonly string[]).includes(name)).map(([name]) => name);
    expect(Object.keys(CONNECTORS_DEADLINE_SHAPES).sort()).toEqual(owned.sort());
    expect([...handlers.keys()].sort()).toEqual(owned.sort());
    // P4-B5: route E's observation alone is a status read, bounded as `resolve` is
    expect(Object.entries(CONNECTORS_DEADLINE_SHAPES).filter(([, shape]) => shape !== 'immediate')).toEqual([['connectors.resolve', 'bounded'], ['connectors.observe', 'bounded']]);
  });

  it('grants, lists, checks and revokes through the store, announcing each committed change by tool alone', async () => {
    const artifact = await documents!.store.create({ kind: 'html', title: 'Live page', content: { bytes: new TextEncoder().encode('<p>a</p>') } }, { kind: 'human' });
    const resolved = await call('connectors.resolve', { appSessionId: SESSION, launchId: 'L1', cwd: '/work/project', server: 'fixture', tool: 'rows' });
    expect(resolved).toMatchObject({ ready: true, readOnly: true });
    expect(JSON.stringify(resolved)).not.toContain('sentinel-header');
    const fingerprint = (resolved as { fingerprint: string }).fingerprint;
    const { grant } = await call('connectors.grant', { artifactId: artifact.id, grant: { server: 'fixture', tool: 'rows', fingerprint, mode: 'read' } });
    expect(grant).toMatchObject({ server: 'fixture', tool: 'rows', mode: 'read' });
    expect(await call('connectors.grants', { artifactId: artifact.id })).toEqual({ grants: [grant] });
    expect(await call('connectors.check', { artifactId: artifact.id, call: { server: 'fixture', tool: 'rows', fingerprint } })).toEqual({ granted: true, mode: 'read' });
    expect(await call('connectors.revoke', { artifactId: artifact.id, server: 'fixture', tool: 'rows' })).toEqual({ revoked: true });
    expect(events('connectors.grantChanged')).toEqual([
      { artifactId: artifact.id, server: 'fixture', tool: 'rows', change: 'granted' },
      { artifactId: artifact.id, server: 'fixture', tool: 'rows', change: 'revoked' },
    ]);
    // a store refusal reaches main typed
    const missing = await call('connectors.grants', { artifactId: '00000000-0000-4000-8000-0000000000ff' }).catch((error: unknown) => error);
    expect(missing).toBeInstanceOf(HostCommandError);
    expect((missing as HostCommandError).ipcError).toMatchObject({ code: 'invalid_input', issues: { reason: 'notFound' } });
  });

  it('starts an operation at once, says its id alone when it ends, and hands main its outcome through take', async () => {
    const artifact = await documents!.store.create({ kind: 'html', title: 'Live page', content: { bytes: new TextEncoder().encode('<p>a</p>') } }, { kind: 'human' });
    const { fingerprint } = (await call('connectors.resolve', { appSessionId: SESSION, launchId: 'L1', cwd: '/work/project', server: 'fixture', tool: 'rows' })) as { fingerprint: string };
    await call('connectors.grant', { artifactId: artifact.id, grant: { server: 'fixture', tool: 'rows', fingerprint, mode: 'read' } });
    const start = { operationId, artifactId: artifact.id, appSessionId: SESSION, launchId: 'L1', cwd: '/work/project', server: 'fixture', tool: 'rows', arguments: {}, fingerprint, mode: 'read' as const };
    expect(await call('connectors.start', start)).toEqual({ operationId });
    await vi.waitFor(() => expect(events('connectors.operation')).toEqual([{ operationId }]));
    expect(await call('connectors.take', { operationId })).toEqual({ outcome: { ok: true, result: { content: 'rows 107' } } });
    expect(await call('connectors.take', { operationId })).toEqual({ outcome: null });
    expect(await call('connectors.cancel', { operationId })).toEqual({ cancelled: false });
  });

  it('ends every operation when main’s client goes, writing a cancel for one the engine runs', async () => {
    const artifact = await documents!.store.create({ kind: 'html', title: 'Live page', content: { bytes: new TextEncoder().encode('<p>a</p>') } }, { kind: 'human' });
    const { fingerprint } = (await call('connectors.resolve', { appSessionId: SESSION, launchId: 'L1', cwd: '/work/project', server: 'fixture', tool: 'rows' })) as { fingerprint: string };
    await call('connectors.grant', { artifactId: artifact.id, grant: { server: 'fixture', tool: 'rows', fingerprint, mode: 'read' } });
    holdCalls = true;
    await call('connectors.start', { operationId, artifactId: artifact.id, appSessionId: SESSION, launchId: 'L1', cwd: '/work/project', server: 'fixture', tool: 'rows', arguments: {}, fingerprint, mode: 'read' });
    await vi.waitFor(() => expect(mcpCalls()).toHaveLength(1));
    for (const hook of gone) hook();
    expect(writes.filter((frame) => frame.type === 'control_cancel_request')).toHaveLength(1);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(events('connectors.operation')).toEqual([]);
    expect(await call('connectors.take', { operationId })).toEqual({ outcome: null });
  });

  it('without a store, refuses the grant commands as unavailable', async () => {
    surface?.close();
    register(null);
    const refusal = await call('connectors.grants', { artifactId: '00000000-0000-4000-8000-0000000000ff' }).catch((error: unknown) => error);
    expect((refusal as HostCommandError).ipcError).toMatchObject({ code: 'internal', issues: { reason: 'unavailable' } });
  });
});
