// P3-HD M1: route E's own mcp_status reads feed route D's observation cache before the answer is discarded
// (docs/doperpowers/plans/2026-10-17-p3-hd-direct-route.md, M1; P3 co-work Decision Log 98 (3)). Only a session's live
// launch, still in the directory it was launched in, contributes; an answer failing its schema fails the context closed;
// main's going clears the cache with every operation.
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { HostEmit, HostOn } from '@shared/host/runtime';
import { ControlClient } from '../rpc';
import type { EngineTransport } from '../transport';
import { ConnectorCalls, type ConnectorSessionView } from './calls';
import { ConnectorStatusCache, connectorLaunchContext, type ConnectorLaunchContext } from './provenance';
import { registerConnectors } from './register';

const SESSION = 'app-1';
let dir: string;
let project: string;
let answer: unknown;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'maws-hd-calls-'));
  project = join(dir, 'project');
  mkdirSync(project);
  mkdirSync(join(dir, 'bin'));
  writeFileSync(join(dir, 'bin', 'toy'), '#!/bin/sh\n');
  chmodSync(join(dir, 'bin', 'toy'), 0o755);
  writeFileSync(join(dir, '.claude.json'), JSON.stringify({ mcpServers: { usertoy: { command: 'toy', args: ['stdio'] } } }));
  answer = { mcpServers: [{ name: 'usertoy', status: 'connected', scope: 'user', source: 'user', config: { type: 'stdio', command: 'toy', args: ['stdio'] }, tools: [{ name: 'rows', annotations: { readOnly: true } }] }] };
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

// `onStatus`: runs as the engine receives an mcp_status request, before it answers (what changes while it is pending)
function scriptedClient(onStatus: () => void = () => {}): ControlClient {
  const transport: EngineTransport = {
    pid: null,
    frames: (async function* () {})(),
    stderr: (async function* () {})(),
    write: (frame) => {
      const subtype = frame.type === 'control_request' ? (frame.request as { subtype: string }).subtype : null;
      if (subtype === 'mcp_status') onStatus();
      // mcp_status as scripted; the support probe's mcp_call answered as the engine answers an unknown server
      const envelope = subtype === 'mcp_status' ? { subtype: 'success', response: structuredClone(answer) } : subtype === 'mcp_call' ? { subtype: 'error', error: 'MCP server not connected: probe' } : null;
      if (envelope && frame.type === 'control_request') queueMicrotask(() => client.observe({ type: 'control_response', response: { ...envelope, request_id: frame.request_id } } as never));
      return Promise.resolve();
    },
    endInput: () => {},
    kill: () => {},
    exited: new Promise(() => {}),
  };
  const client = new ControlClient(transport, { row: (direction, frame) => ({ seq: 0, direction, at: '', frame }) }, 'L1', { warn: () => {} });
  return client;
}

const context = (): ConnectorLaunchContext => connectorLaunchContext({ appSessionId: SESSION, launchId: 'L1', cwd: project, environment: { HOME: dir, PATH: join(dir, 'bin') } });
const tool = () => ({ appSessionId: SESSION, launchId: 'L1', cwd: project, server: 'usertoy', tool: 'rows' });

function calls(view: ConnectorSessionView, statusCache: ConnectorStatusCache): ConnectorCalls {
  return new ConnectorCalls({ session: (id) => (id === SESSION ? view : undefined), store: () => null, completed: () => {}, probe: async () => 'supported', statusCache });
}

describe('ConnectorCalls observing for route D', () => {
  it('observes a live launch’s mcp_status answer through route E’s own read', async () => {
    const client = scriptedClient();
    const cache = new ConnectorStatusCache();
    const launch = context();
    const view: ConnectorSessionView = { lifecycle: 'ready', control: client, status: () => ({ launchId: 'L1', cwd: project }), connectorLaunchContext: () => launch };
    expect(await calls(view, cache).resolve(tool())).toMatchObject({ ready: true, readOnly: true });
    expect(await cache.resolve(project, 'usertoy', 'rows')).toMatchObject({ ok: true, source: { scope: 'user', path: join(dir, '.claude.json') }, tool: { readOnly: true } });
  });

  it('ignores a session that moved from its launch directory, or one without launch facts', async () => {
    const client = scriptedClient();
    const moved = new ConnectorStatusCache();
    const elsewhere = join(dir, 'elsewhere');
    const view: ConnectorSessionView = { lifecycle: 'ready', control: client, status: () => ({ launchId: 'L1', cwd: elsewhere }), connectorLaunchContext: context };
    await calls(view, moved).resolve({ ...tool(), cwd: elsewhere });
    expect(await moved.resolveSource(project, 'usertoy')).toEqual({ ok: false, why: 'unobserved' });
    expect(await moved.resolveSource(elsewhere, 'usertoy')).toEqual({ ok: false, why: 'unobserved' });
    const bare = new ConnectorStatusCache();
    await calls({ lifecycle: 'ready', control: client, status: () => ({ launchId: 'L1', cwd: project }) }, bare).resolve(tool());
    expect(await bare.resolveSource(project, 'usertoy')).toEqual({ ok: false, why: 'unobserved' });
  });

  // P3-HD panel correction: what was checked before the request is checked again once it is answered
  it('discards an answer whose session moved (set_cwd) or relaunched while the request was pending', async () => {
    const elsewhere = join(dir, 'elsewhere');
    let status = { launchId: 'L1', cwd: project };
    const moved = new ConnectorStatusCache();
    const client = scriptedClient(() => (status = { launchId: 'L1', cwd: elsewhere }));
    const view: ConnectorSessionView = { lifecycle: 'ready', control: client, status: () => status, connectorLaunchContext: context };
    await calls(view, moved).resolve(tool());
    expect(await moved.resolveSource(project, 'usertoy')).toEqual({ ok: false, why: 'unobserved' });
    expect(await moved.resolveSource(elsewhere, 'usertoy')).toEqual({ ok: false, why: 'unobserved' });

    const relaunched = new ConnectorStatusCache();
    const second = connectorLaunchContext({ appSessionId: SESSION, launchId: 'L2', cwd: project, environment: { HOME: dir, PATH: join(dir, 'bin') } });
    let current: ConnectorSessionView;
    const old = scriptedClient(() => (current = { lifecycle: 'ready', control: scriptedClient(), status: () => ({ launchId: 'L2', cwd: project }), connectorLaunchContext: () => second }));
    current = { lifecycle: 'ready', control: old, status: () => ({ launchId: 'L1', cwd: project }), connectorLaunchContext: context };
    await new ConnectorCalls({ session: (id) => (id === SESSION ? current : undefined), store: () => null, completed: () => {}, probe: async () => 'supported', statusCache: relaunched }).resolve(tool());
    expect(await relaunched.resolveSource(project, 'usertoy')).toEqual({ ok: false, why: 'unobserved' });
  });

  it('fails the context closed when a newer answer fails mcp_status’s schema', async () => {
    const client = scriptedClient();
    const cache = new ConnectorStatusCache();
    const view: ConnectorSessionView = { lifecycle: 'ready', control: client, status: () => ({ launchId: 'L1', cwd: project }), connectorLaunchContext: context };
    const route = calls(view, cache);
    await route.resolve(tool());
    answer = { mcpServers: 'not a list' };
    expect(await route.resolve(tool())).toEqual({ ready: false, why: 'unknown' }); // route E's answer is unchanged
    expect(await cache.resolveSource(project, 'usertoy')).toEqual({ ok: false, why: 'unavailable' });
  });
});

describe('registerConnectors and the observation cache', () => {
  it('feeds the cache it owns and clears it when main’s client goes', async () => {
    const client = scriptedClient();
    const handlers = new Map<string, (input: unknown) => Promise<unknown>>();
    const on = ((name: string, handler: (input: unknown) => Promise<unknown>) => void handlers.set(name, handler)) as unknown as HostOn;
    const gone: (() => void)[] = [];
    const launch = context();
    const session = { lifecycle: 'ready', control: client, status: () => ({ launchId: 'L1', cwd: project }), connectorLaunchContext: () => launch };
    const surface = registerConnectors(on, (() => true) as unknown as HostEmit, { onClientGone: (listener) => (gone.push(listener), () => {}) }, { sessions: { get: (id) => (id === SESSION ? (session as never) : undefined) }, store: null });
    await handlers.get('connectors.resolve')!(tool());
    expect(await surface.statusCache.resolveSource(project, 'usertoy')).toMatchObject({ ok: true });
    for (const listener of gone) listener();
    expect(await surface.statusCache.resolveSource(project, 'usertoy')).toEqual({ ok: false, why: 'unobserved' });
    await handlers.get('connectors.resolve')!(tool());
    surface.close();
    expect(await surface.statusCache.resolveSource(project, 'usertoy')).toEqual({ ok: false, why: 'unobserved' });
  });

  // P3-HD panel correction: the process table's row change retires a replaced launch at once
  it('retires a session’s replaced launch when the process table’s rows change', async () => {
    const handlers = new Map<string, (input: unknown) => Promise<unknown>>();
    const on = ((name: string, handler: (input: unknown) => Promise<unknown>) => void handlers.set(name, handler)) as unknown as HostOn;
    let rowsChanged: () => void = () => {};
    const first = context();
    const second = connectorLaunchContext({ appSessionId: SESSION, launchId: 'L2', cwd: project, environment: { HOME: dir, PATH: join(dir, 'bin') } });
    let row = { lifecycle: 'ready', control: scriptedClient(), status: () => ({ appSessionId: SESSION, launchId: 'L1', cwd: project }), connectorLaunchContext: () => first };
    const sessions = { get: (id: string) => (id === SESSION ? (row as never) : undefined), list: () => [row as never], onRowsChanged: (listener: () => void) => ((rowsChanged = listener), () => {}) };
    const surface = registerConnectors(on, (() => true) as unknown as HostEmit, { onClientGone: () => () => {} }, { sessions, store: null });
    const pending = surface.statusCache.begin(first); // L1's request, still unanswered
    row = { lifecycle: 'ready', control: scriptedClient(), status: () => ({ appSessionId: SESSION, launchId: 'L2', cwd: project }), connectorLaunchContext: () => second };
    rowsChanged();
    surface.statusCache.observe(pending, answer as never);
    expect(await surface.statusCache.resolveSource(project, 'usertoy')).toEqual({ ok: false, why: 'unobserved' });
    surface.close();
  });

  // P3-F: a resolve begun before main went must not observe into the next attachment, even one whose probe answers
  it('cancels a resolve still probing when main’s client goes, and lands nothing it reads afterwards', async () => {
    const handlers = new Map<string, (input: unknown) => Promise<unknown>>();
    const on = ((name: string, handler: (input: unknown) => Promise<unknown>) => void handlers.set(name, handler)) as unknown as HostOn;
    const gone: (() => void)[] = [];
    const launch = context();
    const session: ConnectorSessionView = { lifecycle: 'ready', control: scriptedClient(), status: () => ({ launchId: 'L1', cwd: project }), connectorLaunchContext: () => launch };
    const statusCache = new ConnectorStatusCache();
    let probing!: AbortSignal;
    let probed!: (support: 'supported') => void;
    const calls = new ConnectorCalls({ session: (id) => (id === SESSION ? session : undefined), store: () => null, completed: () => {}, statusCache, probe: (_client, signal) => ((probing = signal), new Promise((resolve) => (probed = resolve))) });
    const surface = registerConnectors(on, (() => true) as unknown as HostEmit, { onClientGone: (listener) => (gone.push(listener), () => {}) }, { sessions: { get: (id) => (id === SESSION ? (session as never) : undefined) }, store: null, calls, statusCache });
    const resolving = handlers.get('connectors.resolve')!(tool()).catch(() => null);
    for (const listener of gone) listener();
    probed('supported'); // a probe answering after all
    await resolving;
    expect(await statusCache.resolveSource(project, 'usertoy')).toEqual({ ok: false, why: 'unobserved' });
    expect(probing.aborted).toBe(true);
    surface.close();
  });
});
