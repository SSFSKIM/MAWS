// What a machine's POST waits for (desk-open-fast §8): its own frames' replies, never the tail of everything queued for
// the machine's stream; a browser's control frames on a chain of their own; a write the stream does not take within
// WRITE_TIMEOUT_MS ends the stream; and a POST's runs for different projects handed over at once (the fourth change,
// after the every-fifteen-minutes 503 of a POST carrying many projects' hellos). On the local runtime, with machines
// and a browser through the stand-in; the write bound against a client that stopped reading, on Node's streams, is in
// machine-end.test.ts.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ProjectDown } from '../src/protocol/browser';
import { base64urlEncode } from '../src/protocol/base64url';
import { newNonce } from '../src/protocol/codes';
import type { LogEvent } from '../src/protocol/log';
import type { DownFrame, UpFrame } from '../src/protocol/machine';
import type { SessionMessage } from '../src/protocol/session';
import { BrowserClient, enroll, MachineClient, waitFor } from './support/clients';
import { ADMIN, startLocalHub, type LocalHub } from './support/local';

let hub: LocalHub;
beforeAll(async () => {
  hub = await startLocalHub();
});
afterAll(() => hub?.close());

let projects = 0;
const newProject = () => `7a2c0a8e-3b2d-4c5e-9f70-${(++projects).toString(16).padStart(12, '0')}`;
const SESSION = 'e0ad139c-18bc-45bd-9489-be8653145f81';

let machines = 0;
async function machine(prefix: string, timing?: Parameters<LocalHub['timing']>[1]): Promise<MachineClient> {
  const name = `${prefix}-${++machines}`;
  const client = new MachineClient(hub, name, await enroll(hub, ADMIN, name));
  if (timing) await hub.timing(name, timing);
  await client.connect();
  return client;
}

function say(m: MachineClient, project: string, seq: number, text = `say ${seq}`): LogEvent {
  const event: LogEvent = {
    ts: `2026-10-20T08:00:${String(seq % 60).padStart(2, '0')}.000Z`,
    writer: `${m.name}/${SESSION}`,
    seq,
    kind: 'say',
    from: m.name,
    to: '*',
    text,
    mac: { nonce: newNonce(), value: base64urlEncode(crypto.getRandomValues(new Uint8Array(32))) },
  };
  m.store(project, event);
  return event;
}

const presence = (m: MachineClient, project: string, status: string) =>
  ({ project, machine: m.name, session: SESSION, kind: 'presence', sub: null, n: null, body: { record: { status }, bridge: true } }) as unknown as SessionMessage;
const machinePresence = (m: MachineClient, project: string) =>
  ({ project, machine: m.name, session: null, kind: 'machine', sub: null, n: null, body: { online: true, policy: { read_only: false, ceiling: 'default' }, checkouts: [] } }) as unknown as SessionMessage;

/** `promise`, or a failure naming `what` once `ms` pass before it settles. */
async function within<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error(`no ${what} within ${ms} ms`)), ms)));
  try {
    return await Promise.race([promise, late]);
  } finally {
    clearTimeout(timer);
  }
}

/** The same machine's POST on another connection, under the stream's generation: the uplink's second lane. */
const alongside = (m: MachineClient) => {
  const other = new MachineClient(hub, m.name, m.creds);
  other.generation = m.generation;
  return other;
};

describe("a POST waits for its own frames' replies, not the reply chain's tail", () => {
  it('a session POST and a subscribe pass a held have; released, the hello is answered and its backlog follows in order', async () => {
    const project = newProject();
    const source = await machine('chain-source');
    await source.sync(project);
    const events = Array.from({ length: 6 }, (_, i) => say(source, project, i + 1, 'x'.repeat(200_000)));
    for (const event of events) await source.postOk([{ t: 'events', project, events: [event] }]);

    const m = await machine('chain');
    const from = m.frames.length;
    await hub.holdSend(m.name, 'have');
    const hello = m.post([{ t: 'hello', project, name: 'demo', have: {} }]);
    // The hello is applied (the project is open on this stream) and its `have` waits at the machine's object.
    await waitFor(async () => ((await hub.projectMachines(project)).some((row) => row.name === m.name && row.generation === m.generation) ? true : undefined));
    const browser = await BrowserClient.open(hub, ADMIN, project);
    // Answered while the have is still held (it is released below), which a POST waiting behind the have never is. Bounded
    // as the subscribe below is, at 5 s: a bound of 200 ms measured the box, and a loaded pool box's answer took 1,046 ms
    // (run 39669676842).
    const answered = await within(alongside(m).post([{ t: 'session', message: presence(m, project, 'idle') }]), 5000, 'answer to the session POST while the have is held');
    expect(answered.status).toBe(200);

    const sub = newNonce();
    browser.send({ t: 'subscribe', machine: m.name, session: SESSION, agentId: null, sub });
    await m.next((f) => f.t === 'subscribe' && f.sub === sub, 'the subscribe while the have is held', from);
    expect(m.frames.slice(from).some((f) => f.t === 'have')).toBe(false);

    await hub.releaseSend(m.name);
    expect((await hello).status).toBe(200);
    await m.reaches(project, source.vector(project), 10_000);
    const after = m.frames.slice(from).filter((f) => (f.t === 'have' || f.t === 'events') && f.project === project) as Array<Extract<DownFrame, { t: 'have' | 'events' }>>;
    expect(after[0].t).toBe('have');
    const seqs = after.flatMap((f) => (f.t === 'events' ? f.events.map((e) => e.seq) : []));
    expect(seqs).toEqual([1, 2, 3, 4, 5, 6]);
    expect(await hub.projectQueues(project)).toEqual(expect.arrayContaining([`${m.name}#${m.generation}#replies`, `${m.name}#${m.generation}#control`]));
    browser.close();
    await source.close();
    await m.close();
  });
});

describe('a hello whose have the stream does not take (D1)', () => {
  it('stops its opening bundle: 503 with frames 0, out of the fan-out, nothing after it applied', async () => {
    const project = newProject();
    const owner = await machine('d1-owner');
    await owner.sync(project);
    const browser = await BrowserClient.open(hub, ADMIN, project);
    const seen = browser.frames.length;

    const m = await machine('d1', { heartbeatMs: 15_000, leaseMs: 45_000, writeTimeoutMs: 1000 });
    await hub.stallNextWrite(m.name, 'have');
    const started = performance.now();
    const response = await m.post([
      { t: 'hello', project, name: 'demo', have: {} },
      { t: 'session', message: machinePresence(m, project) },
      { t: 'session', message: presence(m, project, 'busy') },
      { t: 'rejected', project, event: null, reason: 'bad-code', message: 'after the hello' },
      { t: 'pending', project, raised: [] },
    ] as UpFrame[]);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: 'delivery-failed', frames: 0 });
    // The stream's own bound answered it: the POST waited the stalled write out, and was answered well before the
    // deployed bound (WRITE_TIMEOUT_MS, 10 s) would have been. How far past the bound it comes is the box's, since the
    // POST's round trip (the suite's proxy, the Worker, the Registry, the Machine and the Project) is all in it: on
    // loaded pool boxes it came 1.2 and 1.4 s past (runs 39608865906, 39607160893), where this allowed one second.
    const waited = performance.now() - started;
    expect(waited).toBeGreaterThanOrEqual(1000);
    expect(waited).toBeLessThan(10_000);
    expect(hub.runtimeLogs.some((l) => l.message.includes('"cause":"write-stalled"') && l.message.includes(`"machine":"${m.name}"`))).toBe(true);
    expect((await hub.projectMachines(project)).filter((row) => row.name === m.name)).toEqual([]);

    await new Promise((resolve) => setTimeout(resolve, 300));
    const later = browser.frames.slice(seen) as ProjectDown[];
    expect(later.some((f) => f.t === 'refused' || f.t === 'rejected')).toBe(false);
    expect(later.some((f) => f.t === 'session' && (f.message.kind === 'presence' || f.message.kind === 'machine'))).toBe(false);
    expect(later.some((f) => f.t === 'machines' && f.machines.some((x) => x.machine === m.name && x.checkouts !== undefined))).toBe(false);
    browser.close();
    await owner.close();
    await m.close();
  });
});

describe("a POST carrying many projects' hellos (the every-fifteen-minutes 503)", () => {
  it('hands each project its run at once: a held project delays none of the others', async () => {
    const held = newProject();
    const free = newProject();
    const m = await machine('runs');
    // Registered first, so the hold below catches the hello's registration, not the project's creation.
    await m.sync(held);
    await hub.holdHellos(held, true);
    const from = m.frames.length;
    const post = m.post([
      { t: 'hello', project: held, name: 'demo', have: {} },
      { t: 'hello', project: free, name: 'demo', have: {} },
    ]);
    await m.next((f) => f.t === 'have' && f.project === free, "the free project's have while the other's hello is held", from);
    await hub.holdHellos(held, false);
    const response = await post;
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ frames: 2 });
    await m.close();
  });

  it("applies one project's runs in order though another project's run sits between them", async () => {
    const held = newProject();
    const free = newProject();
    const m = await machine('interleaved');
    await m.sync(held);
    await m.connect(); // a new stream: `held` must be opened again before its upload is
    await hub.holdHellos(held, true);
    const calls = (await hub.projectCalls(held)).calls;
    const from = m.frames.length;
    const post = m.post([
      { t: 'hello', project: held, name: 'demo', have: {} },
      { t: 'hello', project: free, name: 'demo', have: {} },
      { t: 'events', project: held, events: [say(m, held, 1)] },
    ]);
    await m.next((f) => f.t === 'have' && f.project === free, "the free project's have", from);
    // The held project's upload waits behind its hello: applied before it, it would be refused not-open.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(m.frames.slice(from).some((f) => f.t === 'refused')).toBe(false);
    await hub.holdHellos(held, false);
    const response = await post;
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ frames: 3 });
    expect(m.frames.slice(from).some((f) => f.t === 'refused')).toBe(false);
    // Two runs of the held project, two calls; its event stored once, after its hello.
    expect((await hub.projectCalls(held)).calls - calls).toBe(2);
    const browser = await BrowserClient.open(hub, ADMIN, held);
    browser.send({ t: 'resume', after: 0 });
    await browser.next((f) => f.t === 'caught-up', 'caught-up');
    expect(browser.logged.map((e) => e.event.seq)).toEqual([1]);
    browser.close();
    await m.close();
  });

  it("answers a failed early run with the POST-order prefix, though a later project's run applied", async () => {
    const early = newProject();
    const later = newProject();
    const m = await machine('prefix');
    await m.sync(early);
    await m.connect();
    await hub.holdHellos(early, true);
    const from = m.frames.length;
    const post = m.post([
      { t: 'hello', project: early, name: 'demo', have: {} },
      { t: 'hello', project: later, name: 'demo', have: {} },
    ]);
    // The later project's run applies (its `have` is on the stream) while the early one waits; then the early `have` fails.
    await m.next((f) => f.t === 'have' && f.project === later, "the later project's have", from);
    await hub.failNextSend(m.name, 'have');
    await hub.holdHellos(early, false);
    const response = await post;
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: 'delivery-failed', frames: 0 });
    expect((await hub.projectMachines(later)).some((row) => row.name === m.name && row.generation === m.generation)).toBe(true);
    await m.close();
  });

  it("is answered 200 for thirteen projects' hellos in one POST, each project's have on the stream", async () => {
    const ids = Array.from({ length: 13 }, () => newProject());
    const m = await machine('thirteen');
    const from = m.frames.length;
    const response = await m.post(ids.map((project) => ({ t: 'hello', project, name: `p-${project.slice(-2)}`, have: {} })));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ frames: 13 });
    for (const project of ids) await m.next((f) => f.t === 'have' && f.project === project, `the have of ${project}`, from);
    // Again, as the archive period's confirmation sends them on an open stream.
    const again = await m.post(ids.map((project) => ({ t: 'hello', project, name: `p-${project.slice(-2)}`, have: {} })));
    expect(again.status).toBe(200);
    expect(m.isEnded).toBe(false);
    await m.close();
  });

  it('logs what a failed run threw, naming the project and the frame', async () => {
    const project = newProject();
    const m = await machine('logged');
    await hub.failNextSend(m.name, 'have');
    const response = await m.post([{ t: 'hello', project, name: 'demo', have: {} }]);
    expect(response.status).toBe(503);
    const line = hub.runtimeLogs.find((l) => l.message.includes('"event":"frame-failed"') && l.message.includes(`"machine":"${m.name}"`));
    expect(line?.message).toContain('a failure the suite injected into the send of have');
    expect(line?.message).toContain(`"project":"${project}"`);
    expect(line?.message).toContain('"frame":"hello"');
    await m.close();
  });
});
