// The hub's share of #57's latency paths, on the suites' runtime (Miniflare, one clock: every party runs here), with a
// machine and a browser speaking DX2 and DX3 through the stand-in: what each hop costs between a machine's POST or a
// browser's frame and the other side's receipt, and how long a replaced object takes to be reconnected past. The
// machine side (the bridge, the plane, the uplink) and the web's own drawing are not in these numbers: the web's
// readout (`localStorage['desk.latency']`) measures the whole path on a deployment. The bounds are loose on purpose,
// a regression check rather than the budget (the composite's Decision Log for #57 holds the budgets); each run prints
// its numbers, and writes them as JSON to DESK_LATENCY_OUT when it is set.
import { writeFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ProjectDown } from '../src/protocol/browser';
import { base64urlEncode } from '../src/protocol/base64url';
import { importOrgKey, newNonce, seal } from '../src/protocol/codes';
import type { HumanDraft, LogEvent } from '../src/protocol/log';
import type { SessionMessage } from '../src/protocol/session';
import { BrowserClient, enroll, MachineClient, waitFor } from './support/clients';
import { ADMIN, startLocalHub, type LocalHub } from './support/local';

let hub: LocalHub;
let memberId: string;
beforeAll(async () => {
  hub = await startLocalHub();
  memberId = ((await (await hub.fetchAs(ADMIN, '/api/me')).json()) as { member: { id: string } }).member.id;
});
afterAll(() => hub?.close());

const SAMPLES = 30;
const SESSION = '1a7e0a8e-3b2d-4c5e-9f70-0000000000aa';
const PROJECT = '1a7c0a8e-3b2d-4c5e-9f70-000000000001';
const KEY = importOrgKey(new Uint8Array(32).fill(6));

/** When each frame arrived, by the frame (the clients' arrays are patched to note it as they push). */
const arrivals = new WeakMap<object, number>();
function stamped<T extends object>(frames: T[]): void {
  const push = frames.push.bind(frames);
  frames.push = (...items: T[]) => {
    const at = performance.now();
    for (const item of items) arrivals.set(item, at);
    return push(...items);
  };
}
const arrived = (frame: object) => arrivals.get(frame)!;

type Stats = { n: number; p50: number; p95: number; max: number };
function stats(samples: number[]): Stats {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)];
  const round = (ms: number) => Math.round(ms * 10) / 10;
  return { n: sorted.length, p50: round(at(0.5)), p95: round(at(0.95)), max: round(sorted.at(-1)!) };
}

const envelope = (m: MachineClient, kind: SessionMessage['kind'], body: unknown, sub: string | null = null, n: number | null = null) =>
  ({ project: PROJECT, machine: m.name, session: kind === 'machine' ? null : SESSION, kind, sub, n, body }) as unknown as SessionMessage;

describe("the hub's hops of the desk's latency paths, on the local runtime", () => {
  it('measures each hop, and a replaced object reconnected past', { timeout: 120_000 }, async () => {
    const m = new MachineClient(hub, 'lat-1', await enroll(hub, ADMIN, 'lat-1'));
    stamped(m.frames);
    await m.connect();
    await m.sync(PROJECT);
    await m.postOk([{ t: 'session', message: envelope(m, 'machine', { online: true, policy: { read_only: false, ceiling: 'default' }, checkouts: [] }) }]);
    const b = await BrowserClient.open(hub, ADMIN, PROJECT);
    stamped(b.frames);
    b.send({ t: 'resume', after: 0 });
    await b.next((f) => f.t === 'caught-up', 'caught-up');
    const results: Record<string, Stats> = {};

    // An owner's message: the browser's `human` → its `human-ack`, and → the machine's stream carrying it.
    const ack: number[] = [];
    const toMachine: number[] = [];
    for (let i = 0; i < SAMPLES; i++) {
      const text = `owner ${i}`;
      const draft: HumanDraft = { kind: 'human', from: 'human', member: memberId, to: '*', text, created: new Date().toISOString() };
      const event = await seal(await KEY, 'log', PROJECT, draft);
      const fromB = b.frames.length;
      const fromM = m.frames.length;
      const sent = performance.now();
      b.send({ t: 'human', event });
      const acked = await b.next((f) => f.t === 'human-ack' && f.nonce === event.mac.nonce, 'human-ack', fromB);
      const carried = await m.next((f) => f.t === 'events' && f.events.some((e) => (e as { text?: string }).text === text), 'the event on the stream', fromM);
      ack.push(arrived(acked) - sent);
      toMachine.push(arrived(carried) - sent);
    }
    results['owner message: web → hub ack'] = stats(ack);
    results['owner message: web → machine stream'] = stats(toMachine);

    // A session's `<message>` (any log event of the machine's writer): the machine's POST → the browser's `log`.
    const message: number[] = [];
    for (let seq = 1; seq <= SAMPLES; seq++) {
      const event: LogEvent = {
        ts: new Date().toISOString(),
        writer: `${m.name}/${SESSION}`,
        seq,
        kind: 'message',
        from: 'session',
        to: 'human',
        text: `message ${seq}`,
        mac: { nonce: newNonce(), value: base64urlEncode(crypto.getRandomValues(new Uint8Array(32))) },
      } as unknown as LogEvent;
      m.store(PROJECT, event);
      const fromB = b.frames.length;
      const sent = performance.now();
      await m.postOk([{ t: 'events', project: PROJECT, events: [event] }]);
      const got = await b.next((f) => f.t === 'log' && f.events.some((e) => e.event.writer === event.writer && e.event.seq === seq), 'the log event', fromB);
      message.push(arrived(got) - sent);
    }
    results["session <message> (log event): machine POST → web"] = stats(message);

    // A session-wide DX4 message (presence; `raised`, `settled` and `delivery` take the same path): POST → browser.
    const wide: number[] = [];
    for (let i = 0; i < SAMPLES; i++) {
      const status = i % 2 === 0 ? 'busy' : 'idle';
      const fromB = b.frames.length;
      const sent = performance.now();
      await m.postOk([{ t: 'session', message: envelope(m, 'presence', { record: { status, waitingFor: null, needs: null }, bridge: true }) }]);
      const got = await b.next((f) => f.t === 'session' && f.message.kind === 'presence' && (f.message.body as unknown as { record: { status: string } }).record.status === status, 'presence', fromB);
      wide.push(arrived(got) - sent);
    }
    results['session-wide message (presence, raised): machine POST → web'] = stats(wide);

    // A session view's first rows: the browser's `subscribe` → at the machine, and → the snapshot back at the browser
    // (the machine answers at once: its own build is not in this number).
    const subscribe: number[] = [];
    const snapshot: number[] = [];
    let live = '';
    for (let i = 0; i < SAMPLES; i++) {
      const sub = newNonce();
      const fromB = b.frames.length;
      const fromM = m.frames.length;
      const sent = performance.now();
      b.send({ t: 'subscribe', machine: m.name, session: SESSION, agentId: null, sub });
      const asked = await m.next((f) => f.t === 'subscribe' && f.sub === sub, 'subscribe', fromM);
      await m.postOk([{ t: 'session', message: envelope(m, 'snapshot', { rows: [], more: false, subagents: [], presence: { record: null, bridge: true }, streaming: [], usage: null }, sub, 0) }]);
      const got = await b.next((f) => f.t === 'session' && f.message.sub === sub && f.message.kind === 'snapshot', 'snapshot', fromB);
      subscribe.push(arrived(asked) - sent);
      snapshot.push(arrived(got) - sent);
      if (i < SAMPLES - 1) b.send({ t: 'unsubscribe', sub });
      else live = sub;
    }
    results['session view: web subscribe → machine'] = stats(subscribe);
    results['session view: web subscribe → snapshot at web'] = stats(snapshot);

    // A streaming chunk: the machine's POST (one chunk, as a bridge read posts one at a time when idle) → the browser.
    const chunk: number[] = [];
    for (let n = 1; n <= SAMPLES; n++) {
      const fromB = b.frames.length;
      const sent = performance.now();
      await m.postOk([{ t: 'session', message: envelope(m, 'chunk', { turnId: 't', agentId: null, step: 0, chunkIndex: n - 1, chunk: { kind: 'text', index: 0, text: 'x' }, t: Date.now() }, live, n) }]);
      const got = await b.next((f) => f.t === 'session' && f.message.sub === live && f.message.n === n, 'chunk', fromB);
      chunk.push(arrived(got) - sent);
    }
    results['streaming chunk: machine POST → web'] = stats(chunk);

    // A replaced object: from the replacement (the suite's seam, as Cloudflare's routing to a successor) to the stream's
    // end at the machine (the probe, PROBE_MS deployed), then, from the machine's reconnect, its `hello` taking the
    // lease over and a waiting subscription reaching the new stream. The uplink waits 1 s before it reconnects; that
    // second is the daemon's and is not here.
    const fromB = b.frames.length;
    const replacedAt = performance.now();
    await hub.replace(m.name);
    await waitFor(() => (m.isEnded ? true : undefined), 5000);
    const ended = performance.now() - replacedAt;
    await b.next((f) => f.t === 'session' && f.message.kind === 'end' && f.message.sub === live, 'the live sub ended', fromB);
    const waiting = newNonce();
    b.send({ t: 'subscribe', machine: m.name, session: SESSION, agentId: null, sub: waiting });
    const fromM = m.frames.length;
    const reconnecting = performance.now();
    await m.connect();
    await m.sync(PROJECT);
    const carried = await m.next((f) => f.t === 'subscribe' && f.sub === waiting, 'the waiting subscribe', fromM);
    const back = arrived(carried) - reconnecting;
    const offline = b.frames.slice(fromB).some((f: ProjectDown) => f.t === 'machines' && f.machines.some((x) => x.machine === m.name && !x.online));

    const report = { hops: results, replacedToEnded: Math.round(ended), reconnectToWaitingSubscribe: Math.round(back), offlineMeanwhile: offline };
    if (process.env.DESK_LATENCY_OUT) writeFileSync(process.env.DESK_LATENCY_OUT, JSON.stringify(report, null, 2));
    console.log(
      ['', "hub hops on the local runtime (ms; n, p50, p95, max):"]
        .concat(Object.entries(results).map(([path, s]) => `  ${path}: n ${s.n}, p50 ${s.p50}, p95 ${s.p95}, max ${s.max}`))
        .concat([`  replaced object → stream ended at the machine: ${Math.round(ended)}`, `  reconnect → waiting subscription on the new stream: ${Math.round(back)}`, `  the machine read offline meanwhile: ${offline}`])
        .join('\n'),
    );

    for (const s of Object.values(results)) expect(s.p95).toBeLessThan(1000);
    expect(ended).toBeLessThan(3000);
    expect(back).toBeLessThan(3000);
    expect(offline).toBe(false);
    b.close();
    await m.close();
  });
});
