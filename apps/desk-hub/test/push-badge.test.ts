// DX7's push badge: a push carries the org's waiting count after its own event is counted, the sum the grid shows,
// each test in an org of its own so the count is known.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { GridDown, ProjectSummary, PushNotice } from '../src/protocol/browser';
import { importOrgKey, newNonce, seal } from '../src/protocol/codes';
import type { SessionMessage } from '../src/protocol/session';
import { BrowserClient, enroll, GridClient, MachineClient, waitFor } from './support/clients';
import { ADMIN, startLocalHub, type LocalHub } from './support/local';
import { decrypt, userAgent, type UserAgent } from './support/push';

let hub: LocalHub;
beforeEach(async () => {
  hub = await startLocalHub();
});
afterEach(() => hub?.close());

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

// 2026-10-18: an async ask's `question` event pushes on its own (MAWS's ask is never raised), and its session's presence
// never says waiting (the engine works on), so the push counts the session itself, as a raise does.
it("a question event's push counts its session, though no presence of it says waiting; a message's push does not", async () => {
  const phone: UserAgent = await userAgent('https://push.test/badge-asked');
  await hub.fetchAs(ADMIN, '/api/push/subscriptions', { method: 'PUT', body: { endpoint: phone.endpoint, keys: phone.keys } });
  const m = await machine('badge-m', A);
  await m.postOk([{ t: 'session', message: envelope(m, A, 'presence', presence('busy')) }]);
  const latest = async (n: number) => {
    const push = await until(() => hub.pushes.filter((p) => p.endpoint === phone.endpoint)[n - 1], `push ${n}`);
    return JSON.parse(new TextDecoder().decode(await decrypt(phone, push.body))) as PushNotice;
  };
  const feed = (seq: number, kind: string, extra: Record<string, unknown>) => {
    const mac = { nonce: newNonce(), value: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url') };
    const event = { ts: new Date().toISOString(), writer: `${m.name}/${SESSION}`, seq, kind, from: 'maws-45', to: 'host', ...extra, mac };
    m.store(A, event);
    return event;
  };

  await m.postOk([{ t: 'events', project: A, events: [feed(1, 'message', { text: 'merged the migration' })] }]);
  expect(await latest(1)).toMatchObject({ kind: 'message', waiting: 0 });

  await m.postOk([{ t: 'events', project: A, events: [feed(2, 'question', { text: ['Ship it?'], choices: ['Yes', 'No'], src: 'toolu_asked' })] }]);
  expect(await latest(2)).toMatchObject({ kind: 'question', event: { writer: `${m.name}/${SESSION}`, seq: 2 }, waiting: 1 });

  // Its presence then says waiting: another question does not count the session twice.
  await m.postOk([{ t: 'session', message: envelope(m, A, 'presence', presence('waiting')) }]);
  await m.postOk([{ t: 'events', project: A, events: [feed(3, 'question', { text: ['And deploy?'], choices: ['Yes', 'No'], src: 'toolu_asked_2' })] }]);
  expect(await latest(3)).toMatchObject({ kind: 'question', event: { seq: 3 }, waiting: 1 });

  await m.close();
});

// The owner's ruling of 2026-10-18: an open async question counts in the badge and the grid's waiting until it is
// answered, its session's presence saying busy all the while (the engine works on, and the state word stays busy).
// MAWS's ask lives in the log alone; a bridge's is raised on the plane and logged as well.
describe('an open async question', () => {
  /** A phone subscribed for the admin: how many notices it has had, and its nth (1-based), decrypted. */
  async function phone(name: string) {
    const ua = await userAgent(`https://push.test/${name}`);
    await hub.fetchAs(ADMIN, '/api/push/subscriptions', { method: 'PUT', body: { endpoint: ua.endpoint, keys: ua.keys } });
    const mine = () => hub.pushes.filter((p) => p.endpoint === ua.endpoint);
    return {
      count: () => mine().length,
      notice: async (n: number) => {
        const push = await until(() => mine()[n - 1], `push ${n}`);
        return JSON.parse(new TextDecoder().decode(await decrypt(ua, push.body))) as PushNotice;
      },
    };
  }

  /** Waits until the latest summary of `project` the grid sent carries `counts`. */
  async function summary(grid: GridClient, project: string, counts: Partial<ProjectSummary>, what: string) {
    const latest = () => grid.frames.flatMap((f) => (f.t === 'summary' ? [f.project] : f.t === 'grid' ? f.projects : [])).filter((p) => p.id === project).at(-1);
    await until(() => (Object.entries(counts).every(([key, value]) => latest()?.[key as keyof ProjectSummary] === value) ? true : undefined), what).catch(() => {
      throw new Error(`no ${what}; the latest summary is ${JSON.stringify(latest())}`);
    });
  }

  /** Appends to a session's feed on `m` as its export does, and returns the upload of that one event. */
  function feeder(m: MachineClient, project: string) {
    const seqs = new Map<string, number>();
    return (session: string, kind: string, fields: Record<string, unknown>, at = new Date()) => {
      const seq = (seqs.get(session) ?? 0) + 1;
      seqs.set(session, seq);
      const mac = { nonce: newNonce(), value: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url') };
      const event = { ts: at.toISOString(), writer: `${m.name}/${session}`, seq, kind, ...fields, mac };
      m.store(project, event);
      return { t: 'events' as const, project, events: [event] };
    };
  }
  const asked = (src: string) => ({ from: 'maws-45', to: 'host', text: ['Ship it?'], choices: ['Yes', 'No'], src });
  const answered = (src: string) => ({ from: 'maws-45', src, text: 'Yes' });
  const said = (text: string) => ({ from: 'maws-45', to: 'host', text, src: `${text}#0` });
  const raise = (m: MachineClient, raised: object) => m.postOk([{ t: 'session', message: envelope(m, A, 'raised', raised) }]);
  const asyncAsk = async (request: string) =>
    seal(await KEY, 'raised', A, { request, session: SESSION, tool: 'mcp__doperpowers__AskUserQuestion', input: { questions: [{ question: 'Ship it?' }] }, async: true });
  const settle = async (m: MachineClient, request: string, outcome: 'answered' | 'withdrawn') => {
    const settled = await seal(await KEY, 'settled', A, outcome === 'answered' ? { request, winner: 'terminal', outcome, by: 'terminal' } : { request, winner: 'other', outcome, by: 'bridge' });
    await m.postOk([{ t: 'session', message: envelope(m, A, 'settled', settled) }]);
  };

  it("MAWS's: counted from its question event in the grid and every later push, until its answered event, and until its session retires", async () => {
    const p = await phone('open-maws');
    const grid = await GridClient.open(hub, ADMIN);
    const m = await machine('open-m', A);
    const feed = feeder(m, A);
    await m.postOk([{ t: 'session', message: envelope(m, A, 'presence', presence('busy')) }]);
    await summary(grid, A, { working: 1, waiting: 0 }, 'a busy session');

    await m.postOk([feed(SESSION, 'question', asked('toolu_maws_1'))]);
    expect(await p.notice(1)).toMatchObject({ kind: 'question', session: SESSION, waiting: 1 });
    // Its presence still says busy: it counts as working and as waiting at once.
    await summary(grid, A, { working: 1, waiting: 1 }, 'the question counted');
    // A later push carries it, another session's message and the asking session's own alike.
    await m.postOk([feed(OTHER, 'message', said('merged the migration'))]);
    expect(await p.notice(2)).toMatchObject({ kind: 'message', session: OTHER, waiting: 1 });
    await m.postOk([feed(SESSION, 'message', said('still on it'))]);
    expect(await p.notice(3)).toMatchObject({ kind: 'message', session: SESSION, waiting: 1 });

    // Answered: it leaves.
    await m.postOk([feed(SESSION, 'answered', answered('toolu_maws_1'))]);
    await summary(grid, A, { working: 1, waiting: 0 }, 'the answer');
    await m.postOk([feed(SESSION, 'message', said('shipping'))]);
    expect(await p.notice(4)).toMatchObject({ kind: 'message', waiting: 0 });

    // Asked again, and the session retires before an answer: the ask died with its process.
    await m.postOk([feed(SESSION, 'question', asked('toolu_maws_2'))]);
    expect(await p.notice(5)).toMatchObject({ kind: 'question', waiting: 1 });
    await m.postOk([feed(SESSION, 'retired', { session: SESSION, by: '', reason: 'ended' })]);
    await summary(grid, A, { waiting: 0 }, 'the retirement');
    await m.postOk([feed(OTHER, 'message', said('done here'))]);
    expect(await p.notice(6)).toMatchObject({ kind: 'message', session: OTHER, waiting: 0 });

    grid.close();
    await m.close();
  });

  it('is kept as events are stored, in each feed order, a backlog included: an old question no push announces still counts', async () => {
    const grid = await GridClient.open(hub, ADMIN);
    const m = await machine('open-backlog', A);
    const feed = feeder(m, A);
    const old = new Date(Date.now() - 3 * 3600 * 1000);
    // One upload, as a machine's first sync sends its backlog: an ask answered, an ask its session's end took, one open.
    const backlog = [
      feed(SESSION, 'question', asked('toolu_answered'), old),
      feed(OTHER, 'question', asked('toolu_retired'), old),
      feed(SESSION, 'answered', answered('toolu_answered'), old),
      feed(OTHER, 'retired', { session: OTHER, by: '', reason: 'ended' }, old),
      feed(SESSION, 'question', asked('toolu_open'), old),
    ].flatMap((upload) => upload.events);
    await m.postOk([{ t: 'events', project: A, events: backlog }]);
    await summary(grid, A, { machines_online: 1, waiting: 1 }, 'the one question the backlog leaves open');
    await m.postOk([feed(SESSION, 'answered', answered('toolu_open'))]);
    await summary(grid, A, { waiting: 0 }, 'its answer');
    grid.close();
    await m.close();
  });

  it("a bridge's: counted once while raised and logged, gone with its settlement before any answered event; a settled ask's late event does not count", async () => {
    const p = await phone('open-bridge');
    const grid = await GridClient.open(hub, ADMIN);
    const m = await machine('open-b', A);
    const feed = feeder(m, A);
    await m.postOk([{ t: 'session', message: envelope(m, A, 'presence', presence('busy')) }]);

    await raise(m, await asyncAsk('toolu_bridge'));
    expect(await p.notice(1)).toMatchObject({ kind: 'question', request: 'toolu_bridge', waiting: 1 });
    await summary(grid, A, { working: 1, waiting: 1 }, 'the raised ask');
    // Its question event too: the same ask, counted once (and pushed once).
    await m.postOk([feed(SESSION, 'question', asked('toolu_bridge'))]);
    await m.postOk([feed(OTHER, 'message', said('meanwhile'))]);
    expect(await p.notice(2)).toMatchObject({ kind: 'message', session: OTHER, waiting: 1 });

    // Answered: its settlement ends it, though the log holds no answered event yet.
    await settle(m, 'toolu_bridge', 'answered');
    await summary(grid, A, { working: 1, waiting: 0 }, 'the settlement');
    await m.postOk([feed(OTHER, 'message', said('after the answer'))]);
    expect(await p.notice(3)).toMatchObject({ kind: 'message', waiting: 0 });
    await m.postOk([feed(SESSION, 'answered', answered('toolu_bridge'))]);

    // Withdrawn before its event reaches the hub (the two planes run apart): the event does not bring it back.
    await raise(m, await asyncAsk('toolu_withdrawn'));
    expect(await p.notice(4)).toMatchObject({ kind: 'question', request: 'toolu_withdrawn', waiting: 1 });
    await settle(m, 'toolu_withdrawn', 'withdrawn');
    await m.postOk([feed(SESSION, 'question', asked('toolu_withdrawn'))]);
    await m.postOk([feed(OTHER, 'message', said('after the withdrawal'))]);
    expect(await p.notice(5)).toMatchObject({ kind: 'message', waiting: 0 });
    await summary(grid, A, { waiting: 0 }, 'nothing open');
    expect(p.count()).toBe(5);

    grid.close();
    await m.close();
  });

  it('leaves a blocking question and a permission request as they were: counted in their own push, and in the grid by presence alone', async () => {
    const p = await phone('open-blocking');
    const grid = await GridClient.open(hub, ADMIN);
    const m = await machine('open-p', A);
    const feed = feeder(m, A);
    await m.postOk([{ t: 'session', message: envelope(m, A, 'presence', presence('busy')) }]);

    await raise(m, await seal(await KEY, 'raised', A, { request: 'toolu_blocking', session: SESSION, tool: 'AskUserQuestion', input: { questions: [{ question: 'Ship it?' }] } }));
    expect(await p.notice(1)).toMatchObject({ kind: 'question', request: 'toolu_blocking', waiting: 1 });
    await m.postOk([feed(OTHER, 'message', said('meanwhile'))]);
    expect(await p.notice(2)).toMatchObject({ kind: 'message', waiting: 0 });

    await raise(m, await seal(await KEY, 'raised', A, { request: 'toolu_bash', session: SESSION, tool: 'Bash', input: { command: 'pnpm e2e' } }));
    expect(await p.notice(3)).toMatchObject({ kind: 'permission', request: 'toolu_bash', waiting: 1 });
    await m.postOk([feed(OTHER, 'message', said('still meanwhile'))]);
    expect(await p.notice(4)).toMatchObject({ kind: 'message', waiting: 0 });
    await summary(grid, A, { working: 1, waiting: 0 }, 'the grid by presence alone');

    // Its presence then says waiting, as a blocked engine's does.
    await m.postOk([{ t: 'session', message: envelope(m, A, 'presence', presence('waiting')) }]);
    await summary(grid, A, { working: 0, waiting: 1 }, 'the waiting presence');

    grid.close();
    await m.close();
  });

  // A stopped seat never retires, so the log holds its ask open; a bridge's ask is withdrawn when its process ends, and a
  // log-only one stops counting alike while no process of its session runs.
  it("a log question counts while its session's process lives: not while its presence says none does, and again once it runs", async () => {
    const p = await phone('open-stopped');
    const grid = await GridClient.open(hub, ADMIN);
    const m = await machine('open-s', A);
    const feed = feeder(m, A);
    await m.postOk([{ t: 'session', message: envelope(m, A, 'presence', presence('busy')) }]);
    await m.postOk([feed(SESSION, 'question', asked('toolu_stopped'))]);
    expect(await p.notice(1)).toMatchObject({ kind: 'question', session: SESSION, waiting: 1 });
    await summary(grid, A, { working: 1, waiting: 1 }, 'the question counted');

    // The session stops without retiring: no process holds its ask.
    await m.postOk([{ t: 'session', message: envelope(m, A, 'presence', { record: null, bridge: false }) }]);
    await summary(grid, A, { working: 0, waiting: 0 }, 'the stopped session');
    await m.postOk([feed(OTHER, 'message', said('meanwhile'))]);
    expect(await p.notice(2)).toMatchObject({ kind: 'message', session: OTHER, waiting: 0 });

    // Resumed: the ask, still unanswered, counts again.
    await m.postOk([{ t: 'session', message: envelope(m, A, 'presence', presence('busy')) }]);
    await summary(grid, A, { working: 1, waiting: 1 }, 'the resumed session');

    grid.close();
    await m.close();
  });

  // MAWS #65: a resumed session's bridge raises its still-open ask again under the call's id, which the first process's
  // end settled (withdrawn). The answer's settlement settles it on the same stream; no reconnect republishes the set.
  it("a bridge's, raised again under its id when its session resumes: counted again, and gone with its answer's settlement", async () => {
    const grid = await GridClient.open(hub, ADMIN);
    const m = await machine('open-r', A);
    const b = await BrowserClient.open(hub, ADMIN, A);
    const pending = () => b.frames.flatMap((f) => (f.t === 'pending' ? [f.requests] : [])).at(-1)?.map((r) => r.raised.request);
    const decisions = () => b.frames.filter((f) => f.t === 'decided' && f.decision.settled.request === 'toolu_resumed').length;
    await m.postOk([{ t: 'session', message: envelope(m, A, 'presence', presence('busy')) }]);

    await raise(m, await asyncAsk('toolu_resumed'));
    await summary(grid, A, { working: 1, waiting: 1 }, 'the raised ask');
    // Its process ends: the bridge withdraws it.
    await settle(m, 'toolu_resumed', 'withdrawn');
    await summary(grid, A, { waiting: 0 }, 'the withdrawal');
    // Resumed: raised again, under the same id.
    await raise(m, await asyncAsk('toolu_resumed'));
    await summary(grid, A, { working: 1, waiting: 1 }, 'the ask raised again');
    await waitFor(() => (pending()?.includes('toolu_resumed') ? true : undefined));

    // Answered.
    await settle(m, 'toolu_resumed', 'answered');
    await summary(grid, A, { working: 1, waiting: 0 }, 'the answer');
    await waitFor(() => (pending()?.length === 0 ? true : undefined));
    await waitFor(() => (decisions() === 2 ? true : undefined));

    // The answer sent again (a daemon restarted before recording it) is taken once: a marker after it shows it did nothing.
    await settle(m, 'toolu_resumed', 'answered');
    await m.postOk([{ t: 'session', message: envelope(m, A, 'presence', presence('busy'), OTHER) }]);
    await b.next((f) => f.t === 'session' && f.message.kind === 'presence' && f.message.session === OTHER, 'the marker');
    expect(decisions()).toBe(2);
    expect(b.frames.filter((f) => f.t === 'session' && f.message.kind === 'settled')).toHaveLength(2);

    b.close();
    grid.close();
    await m.close();
  });

  it("a settlement of a request this hub never held pending still ends the log's question for it", async () => {
    const grid = await GridClient.open(hub, ADMIN);
    const m = await machine('open-u', A);
    const feed = feeder(m, A);
    await m.postOk([{ t: 'session', message: envelope(m, A, 'presence', presence('busy')) }]);
    await m.postOk([feed(SESSION, 'question', asked('toolu_unheld'))]);
    await summary(grid, A, { working: 1, waiting: 1 }, 'the question counted');

    // Its raise never reached this hub (raised and settled while the uplink was away): the settlement alone ends it.
    await settle(m, 'toolu_unheld', 'withdrawn');
    await summary(grid, A, { working: 1, waiting: 0 }, 'the settlement');

    grid.close();
    await m.close();
  });
});
