import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DownFrame } from '../src/protocol/machine';
import { SESSION_KINDS } from '../src/protocol/session';
import { ADMIN, DEPLOY_VARS, ORG, startHub, type Hub } from './support/hub';

const PROJECT = '6f1c0a8e-3b2d-4c5e-9f70-8a1b2c3d4e5f';

let hub: Hub;
beforeAll(async () => {
  hub = await startHub();
});
afterAll(() => hub?.close());

describe('the build', () => {
  it('names the build that answered on every response the Worker makes, `dev` when the deploy named none', async () => {
    expect((await hub.fetch('/api/me')).headers.get('X-Desk-Build')).toBe('dev');
    expect((await hub.fetch('/api/me', { assertion: await hub.human(ADMIN) })).headers.get('X-Desk-Build')).toBe('dev');
  });
});

describe('the Worker admits only what Access signed and the Registry knows', () => {
  it('refuses a request without an assertion', async () => {
    const response = await hub.fetch('/api/me');
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'missing' });
  });

  it("refuses an assertion for another Access application's audience", async () => {
    const response = await hub.fetch('/api/me', { assertion: await hub.assertion({ email: ADMIN, sub: 's', aud: ['another-app'] }) });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'audience' });
  });

  it('makes the org from deploy configuration, its admin a member with a stable random id', async () => {
    const first = await hub.fetch('/api/me', { assertion: await hub.human(ADMIN) });
    expect(first.status).toBe(200);
    const body = (await first.json()) as { org: { id: string }; member: { id: string; email: string; role: string } };
    expect(body.org.id).toBe(ORG);
    expect(body.member).toMatchObject({ email: ADMIN, role: 'admin' });
    expect(body.member.id).toMatch(/^[0-9a-f]{32}$/);
    const again = (await (await hub.fetch('/api/me', { assertion: await hub.human('Owner@Example.com') })).json()) as typeof body;
    expect(again.member.id).toBe(body.member.id);
  });

  it('refuses a person Access admitted who is not a member', async () => {
    const response = await hub.fetch('/api/me', { assertion: await hub.human('stranger@example.com') });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'not-a-member' });
  });

  it('refuses a service token the Registry never enrolled, though Access admitted it', async () => {
    const response = await hub.fetch('/machine/stream', { assertion: await hub.service('0123abcd.access') });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'not-enrolled' });
  });

  it('serves a member no machine path', async () => {
    expect((await hub.fetch('/machine/stream', { assertion: await hub.human(ADMIN) })).status).toBe(404);
  });
});

describe("a project's socket", () => {
  it('is refused for a project the registry does not hold', async () => {
    const response = await hub.fetch(`/api/projects/${PROJECT}/socket`, { assertion: await hub.human(ADMIN), headers: { Upgrade: 'websocket' } });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'unknown-project' });
  });

  it('reaches the Project object for that project, carrying the member the Worker verified and not one the client named', async () => {
    const me = (await (await hub.fetch('/api/me', { assertion: await hub.human(ADMIN) })).json()) as { member: { id: string } };
    // A machine's hello registers a project (the log suite does it over the wire); here the registry is told directly.
    const registries = await hub.mf.getDurableObjectNamespace('REGISTRY');
    const registry = registries.get(registries.idFromName(ORG)) as unknown as { registerProject(id: string, name: string, machine: string): Promise<unknown> };
    await registry.registerProject(PROJECT, 'demo', 'mini');
    const response = await hub.fetch(`/api/projects/${PROJECT}/socket`, {
      assertion: await hub.human(ADMIN),
      headers: { Upgrade: 'websocket', 'X-Desk-Member': 'f'.repeat(32) },
    });
    expect(response.status).toBe(101);
    const socket = response.webSocket!;
    const first = new Promise<string>((resolve) => socket.addEventListener('message', (event) => resolve(String(event.data))));
    socket.accept();
    expect(JSON.parse(await first)).toEqual({ t: 'welcome', project: PROJECT, member: me.member.id, head: 0 });
    socket.close(1000, 'done');
  });

  it('is not found for a project id that is not a .smns uuid', async () => {
    expect((await hub.fetch('/api/projects/not-a-uuid/socket', { assertion: await hub.human(ADMIN), headers: { Upgrade: 'websocket' } })).status).toBe(404);
  });
});

describe("a machine's stream, held by its Machine object", () => {
  async function open(name: string) {
    const namespace = await hub.mf.getDurableObjectNamespace('MACHINE');
    const stub = namespace.get(namespace.idFromName(`${ORG}:${name}`));
    const response = await stub.fetch('https://machine/stream', { headers: { 'X-Desk-Org': ORG, 'X-Desk-Machine': name } });
    expect(response.headers.get('Content-Type')).toBe('text/event-stream');
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const next = async (): Promise<{ event: string; frame: DownFrame } | 'ended'> => {
      for (;;) {
        const end = buffer.indexOf('\n\n');
        if (end >= 0) {
          const block = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const event = /^event: (.*)$/m.exec(block)![1];
          return { event, frame: JSON.parse(/^data: (.*)$/m.exec(block)![1]) as DownFrame };
        }
        const { value, done } = await reader.read();
        if (done) return 'ended';
        buffer += decoder.decode(value, { stream: true });
      }
    };
    return { stub, next, cancel: () => reader.cancel() };
  }

  it("opens with a welcome naming the machine, its connection generation and the session kinds the hub lists, then the org's directory, and a newer stream ends the older", async () => {
    const first = await open('mini');
    expect(await first.next()).toEqual({ event: 'welcome', frame: { t: 'welcome', org: ORG, machine: 'mini', generation: 1, heartbeat_ms: 15_000, kinds: [...SESSION_KINDS] } });
    // The kinds the desk control surface adds are listed, so a daemon sends them to this hub (the spec's §13.3).
    expect(SESSION_KINDS).toEqual(expect.arrayContaining(['read', 'op', 'catalog']));
    expect(await first.next()).toMatchObject({ event: 'org', frame: { t: 'org', projects: expect.any(Array), machines: expect.any(Array) } });
    const second = await open('mini');
    expect(await second.next()).toMatchObject({ frame: { t: 'welcome', generation: 2 } });
    expect(await first.next()).toBe('ended');
    await second.cancel();
  });

  it('takes a frame for the machine from another object and writes it down the stream, or answers offline at once', async () => {
    const namespace = await hub.mf.getDurableObjectNamespace('MACHINE');
    const idle = namespace.get(namespace.idFromName(`${ORG}:asleep`));
    expect(await (idle as unknown as { send(frame: DownFrame): Promise<string> }).send({ t: 'hb', at: 'x' })).toBe('offline');

    const stream = await open('SK.local');
    await stream.next(); // welcome
    await stream.next(); // the org's directory
    const send = (stream.stub as unknown as { send(frame: DownFrame): Promise<string> }).send.bind(stream.stub);
    const frame: DownFrame = { t: 'rpc-ack', project: PROJECT, nonce: 'AQEBAQEBAQEBAQEBAQEBAQ' };
    expect(await send(frame)).toBe('written');
    expect(await stream.next()).toEqual({ event: 'rpc-ack', frame });
    await stream.cancel();
  });
});

describe('without its deploy configuration', () => {
  it.each([['ACCESS_AUD'], ['VAPID_KEY']])('refuses everything without %s', async (missing) => {
    const bare = await startHub({ ...DEPLOY_VARS, [missing]: '' });
    try {
      const response = await bare.fetch('/api/me', { assertion: await bare.human(ADMIN) });
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: 'not-configured' });
    } finally {
      await bare.close();
    }
  });
});
