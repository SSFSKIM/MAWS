// `maws` aimed at another machine, through the services front (docs/doperpowers/plans/2026-11-10-project-registry.md,
// M12, Interfaces §K): `projects.forward` from a machine.sock client is posted as `projects.act.request` to the attached
// app whose hello lists `machine.project-acts`, and answered with that app's `projects.act.answer`. With no such app the
// terminal is answered at once; when the app's connection ends first the wait ends with the same refusal; an answer for
// an id not asked of that connection is refused; the three are a machine.sock client's alone; the registry is the
// daemon's read (`projects.registry`), served cold.
import { describe, expect, it, vi } from 'vitest';
import { MACHINE_PROJECT_ACTS_CAPABILITY, PEER_CAPABILITIES } from '@shared/host/socket-protocol';
import type { HostResponse } from '@shared/ipc/host-protocol';
import type { MachineRef } from '@shared/machine/ref';
import { createServicesFront, type FrontOptions } from './front';

const APP_PID = 4242;
const REF = 'TestMachineRef00000000' as MachineRef;
const REGISTRY_READ = { enrolled: true, machine: { ref: REF, name: 'macbook' }, machines: [{ ref: REF, name: 'macbook' }], projects: [] };

function connection() {
  const posted: Record<string, unknown>[] = [];
  let listener: (event: { data: unknown }) => void = () => {};
  let open = true;
  const port = {
    start: () => {},
    on: (_event: 'message', l: (event: { data: unknown }) => void) => void (listener = l),
    postMessage: (message: unknown) => (open ? void posted.push(message as Record<string, unknown>) : false),
  };
  let next = 0;
  return {
    port,
    posted,
    close: () => void (open = false),
    ask(name: string, input?: unknown): { id: string; answered: () => Record<string, unknown> | undefined } {
      const id = `r${++next}`;
      listener({ data: { t: 'req', id, name, input } });
      return { id, answered: () => posted.find((m) => m.t === 'res' && m.id === id) };
    },
    async request(name: string, input?: unknown): Promise<Record<string, unknown>> {
      const { answered } = this.ask(name, input);
      await vi.waitFor(() => expect(answered()).toBeDefined());
      return answered()!;
    },
    requests: () => posted.filter((m) => m.t === 'evt' && m.name === 'projects.act.request').map((m) => m.payload as Record<string, unknown>),
  };
}

function front(over: Partial<FrontOptions> = {}) {
  const daemon = vi.fn(async (name: string) => (name === 'projects.registry' ? REGISTRY_READ : undefined));
  const ensure = vi.fn(async () => ({}) as never);
  const served = createServicesFront({
    spine: { ensure },
    hosts: { forward: async () => ({ t: 'res', id: 'x', ok: true, value: null }) as HostResponse, onRaw: () => () => {}, onStreaming: () => () => {}, parked: () => false },
    intercept: () => null,
    daemon,
    identity: () => ({ ref: REF, name: 'macbook', project: { key: 'machine:x', name: 'macbook', smnsId: null } }) as never,
    isApp: (appPid) => appPid === APP_PID,
    log: () => {},
    ...over,
  });
  const client = (appPid: number, capabilities: readonly string[] = []) => {
    const end = connection();
    const runtime = served.runtimeFor({ appPid, capabilities });
    runtime.serve(end.port as never);
    return { ...end, runtime };
  };
  return { served, client, daemon, ensure };
}

const FORWARD = { verb: 'add', machine: 'mini', path: '/srv/scrape' } as const;
const NO_APP = { ok: false, code: 'no-app', text: 'MAWS is not running on this machine, so it cannot ask mini. Run this on mini: maws project add /srv/scrape' };

describe("maws's commands on machine.sock", () => {
  it('answer the registry from the daemon, cold: no spine is loaded for it', async () => {
    const { client, daemon, ensure } = front();
    expect(await client(7).request('projects.registry')).toMatchObject({ ok: true, value: REGISTRY_READ });
    expect(daemon).toHaveBeenCalledWith('projects.registry', undefined);
    expect(ensure).not.toHaveBeenCalled();
  });

  it('are a machine.sock client’s alone, never the endpoint’s dispatch', async () => {
    const { served } = front();
    for (const [name, input] of [['projects.registry', undefined], ['projects.forward', FORWARD], ['projects.act.answer', { id: 'pa-1', result: { ok: true, text: 'x' } }]] as const) {
      expect([name, await served.dispatch(name, input)]).toMatchObject([name, { ok: false, error: { code: 'internal' } }]);
    }
  });

  it('posts a forwarded verb to the attached app that answers act requests, and answers the terminal with its answer', async () => {
    const { client, ensure } = front();
    const app = client(APP_PID, PEER_CAPABILITIES.app);
    const terminal = client(9);
    const asked = terminal.ask('projects.forward', { ...FORWARD, into: 'p-1', name: 'Scrape' });
    await vi.waitFor(() => expect(app.requests()).toHaveLength(1));
    const [request] = app.requests();
    expect(request).toEqual({ id: expect.any(String), ...FORWARD, into: 'p-1', name: 'Scrape' });
    expect(asked.answered(), 'it waits for the app').toBeUndefined();
    expect(await app.request('projects.act.answer', { id: request!.id, result: { ok: true, text: 'added scrape as a new project (p-1)' } })).toMatchObject({ ok: true });
    await vi.waitFor(() => expect(asked.answered()).toMatchObject({ ok: true, value: { ok: true, text: 'added scrape as a new project (p-1)' } }));
    expect(await app.request('projects.act.answer', { id: request!.id, result: { ok: true, text: 'again' } }), 'answered once').toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    expect(ensure).not.toHaveBeenCalled();
  });

  it('answers the terminal at once with no app, and with an attached app whose hello does not list machine.project-acts', async () => {
    const { client } = front();
    expect(await client(9).request('projects.forward', FORWARD)).toMatchObject({ ok: true, value: NO_APP });
    const older = client(APP_PID, PEER_CAPABILITIES.app.filter((name) => name !== MACHINE_PROJECT_ACTS_CAPABILITY));
    expect(await client(9).request('projects.forward', FORWARD)).toMatchObject({ ok: true, value: NO_APP });
    expect(older.requests()).toEqual([]);
    const notTheApp = client(31, PEER_CAPABILITIES.app); // capable, but not the app attached on engine-host.sock
    expect(await client(9).request('projects.forward', FORWARD)).toMatchObject({ ok: true, value: NO_APP });
    expect(notTheApp.requests()).toEqual([]);
  });

  it('ends the wait with the refusal when the app’s connection ends first', async () => {
    const { client } = front();
    const app = client(APP_PID, PEER_CAPABILITIES.app);
    const asked = client(9).ask('projects.forward', { verb: 'link', machine: 'mini', path: '/srv/scrape', into: null });
    await vi.waitFor(() => expect(app.requests()).toHaveLength(1));
    app.close();
    app.runtime.detach();
    await vi.waitFor(() => expect(asked.answered()).toMatchObject({ ok: true, value: { ok: false, code: 'no-app', text: 'MAWS is not running on this machine, so it cannot ask mini. Run this on mini: maws project link /srv/scrape --none' } }));
  });

  it('refuses an answer for an id not asked of that connection, and one for a terminal that has gone', async () => {
    const { client } = front();
    const app = client(APP_PID, PEER_CAPABILITIES.app);
    const other = client(77, PEER_CAPABILITIES.app);
    const terminal = client(9);
    terminal.ask('projects.forward', FORWARD);
    await vi.waitFor(() => expect(app.requests()).toHaveLength(1));
    const { id } = app.requests()[0]!;
    expect(await other.request('projects.act.answer', { id, result: { ok: true, text: 'x' } }), 'another connection').toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    expect(await app.request('projects.act.answer', { id: 'pa-unknown', result: { ok: true, text: 'x' } })).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    terminal.close();
    terminal.runtime.detach();
    expect(await app.request('projects.act.answer', { id, result: { ok: true, text: 'x' } }), 'nobody waits for it').toMatchObject({ ok: false, error: { code: 'invalid_input' } });
  });
});
