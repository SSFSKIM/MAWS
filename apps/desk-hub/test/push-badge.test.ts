// DX7's push badge: a push carries the org's waiting count after its own event is counted, the sum the grid shows,
// in an org of its own so the count is known.
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { GridDown, PushNotice } from '../src/protocol/browser';
import { importOrgKey, seal } from '../src/protocol/codes';
import type { SessionMessage } from '../src/protocol/session';
import { enroll, MachineClient } from './support/clients';
import { ADMIN, startLocalHub, type LocalHub } from './support/local';
import { decrypt, userAgent, type UserAgent } from './support/push';

let hub: LocalHub;
beforeAll(async () => {
  hub = await startLocalHub();
});
afterAll(() => hub?.close());

const KEY = importOrgKey(new Uint8Array(32).fill(9));
const A = '7a1c0a8e-3b2d-4c5e-9f70-0000000000a1';
const B = '7a1c0a8e-3b2d-4c5e-9f70-0000000000b2';
const SESSION = '67646a1b-2f5e-4c1d-8a3b-9c0d1e2f3a4b';
const OTHER = '0d9e8f7a-6b5c-4d3e-a2f1-0e9d8c7b6a59';
const machinePresence = { online: true, policy: { read_only: false, ceiling: 'default' }, checkouts: [] };

async function machine(name: string, project: string): Promise<MachineClient> {
  const client = new MachineClient(hub, name, await enroll(hub, ADMIN, name));
  await client.connect();
  await client.sync(project, `demo-${name.slice(-1)}`);
  await client.postOk([{ t: 'session', message: envelope(client, project, 'machine', machinePresence, null) }]);
  return client;
}

const envelope = (m: MachineClient, project: string, kind: SessionMessage['kind'], body: unknown, session: string | null = SESSION) =>
  ({ project, machine: m.name, session, kind, sub: null, n: null, body }) as unknown as SessionMessage;
const presence = (status: string) => ({ record: { status, waitingFor: null, needs: null }, bridge: true });

async function until<T>(probe: () => T | undefined, what: string, ms = 8000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = probe();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`no ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

it("a push's waiting is the org's total, its own request counted even before its project's summary reached the registry", async () => {
  const phone: UserAgent = await userAgent('https://push.test/badge-phone');
  await hub.fetchAs(ADMIN, '/api/push/subscriptions', { method: 'PUT', body: { endpoint: phone.endpoint, keys: phone.keys } });
  const grid: GridDown[] = [];
  const socket = new WebSocket(`${hub.url.replace('http', 'ws')}/api/registry/socket`, { headers: { 'x-desk-standin-user': ADMIN } } as unknown as string[]);
  socket.addEventListener('message', (event) => grid.push(JSON.parse(String(event.data)) as GridDown));

  // Project A: two sessions waiting, reported to the registry.
  const a = await machine('badge-a', A);
  await a.postOk([
    { t: 'session', message: envelope(a, A, 'presence', presence('waiting')) },
    { t: 'session', message: envelope(a, A, 'presence', presence('waiting'), OTHER) },
  ]);
  await until(() => (grid.some((f) => f.t === 'summary' && f.project.id === A && f.project.waiting === 2) ? true : undefined), "A's summary");

  // Project B: a session raises a request before any presence of it says waiting.
  const b = await machine('badge-b', B);
  const raised = await seal(await KEY, 'raised', B, { request: 'toolu_badge', session: SESSION, tool: 'Bash', input: { command: 'pnpm e2e' } });
  await b.postOk([{ t: 'session', message: envelope(b, B, 'raised', raised) }]);
  const push = await until(() => hub.pushes.find((p) => p.endpoint === phone.endpoint), 'the push');
  const notice = JSON.parse(new TextDecoder().decode(await decrypt(phone, push.body))) as PushNotice;
  expect(notice).toMatchObject({ project: B, name: 'demo-b', request: 'toolu_badge', waiting: 3 });

  // The session's presence then says waiting too: the same request is not counted twice.
  await b.postOk([{ t: 'session', message: envelope(b, B, 'presence', presence('waiting')) }]);
  const second = await seal(await KEY, 'raised', B, { request: 'toolu_badge_2', session: SESSION, tool: 'Bash', input: { command: 'pnpm e2e' } });
  await b.postOk([{ t: 'session', message: envelope(b, B, 'raised', second) }]);
  const next = await until(() => hub.pushes.filter((p) => p.endpoint === phone.endpoint)[1], 'the second push');
  expect(JSON.parse(new TextDecoder().decode(await decrypt(phone, next.body)))).toMatchObject({ request: 'toolu_badge_2', waiting: 3 });

  socket.close();
  await a.close();
  await b.close();
});
