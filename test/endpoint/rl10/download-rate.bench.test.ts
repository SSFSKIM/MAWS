// A first download's rate through the endpoint (measurement, not a gate): a project log of about 12.5k signed v2
// events over about 220 writers, mostly other machines' session events with an attestation, sent by a stand-in hub in
// desk-hub's order and pages (writers lexical, each writer's events in seq order, pages of at most 1,000 rows or about
// 256 KiB), through the real hub link, RL10 and the log relay (a real inbound index on disk), to a stand-in sminos
// over RL10's real socket. Then each stage `#verify` runs per event, timed alone over the same events.
//
// Run: MAWS_BENCH=1 [CERTS=n RETIRED=n EVENTS=n WAIT_MS=n] vitest run --project node test/endpoint/rl10/download-rate.bench.test.ts
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  eventSigningInput,
  generateSigningKey,
  keyId,
  signEvent,
  signRecord,
  SIGNING_DOMAINS,
  verifyEvent,
  type Certificates,
  type LogEventV2,
  type OrgState,
  type SigningKey,
} from 'org-protocol';
import { afterAll, describe, expect, it } from 'vitest';
import { HubLink } from '../../../src/endpoint/hub-link';
import { EndpointPolicy } from '../../../src/endpoint/policy';
import { verifiedOwners } from '../../../src/endpoint/rl10/attest';
import { InboundIndex } from '../../../src/endpoint/rl10/inbound-index';
import { Rl10 } from '../../../src/endpoint/rl10/link';
import { signerOf } from '../../../src/endpoint/rl10/log-relay';
import { EndpointState } from '../../../src/endpoint/state/store';
import { FakeHub, until } from '../fake-hub';
import { genesis, memberId, newDevice, successor } from '../org-fixtures';
import { FakeSminos } from './fake-sminos';

const ORG = 'org-rate';
const P = '5c1d7e20-3a4b-4c5d-8e6f-7a8b9c0d1e2f';
const NAME = 'recv';
const REF = 'rRecv0000000000000000000000';
const TOTAL = Number(process.env.EVENTS ?? 12_530);
const WRITERS = 223;
const CERTS = Number(process.env.CERTS ?? 0);
const RETIRED = Number(process.env.RETIRED ?? 0);
const LISTED = 4; // state-listed sender machines; the rest of the senders are certified (min(8, live certs))
const PAGE_ROWS = 1000;
const BATCH_BYTES = 256 * 1024;
const TEXT = 'x'.repeat(640); // about 900 bytes an event, as the reported log's 11.4 MB / 12,530

const closers: Array<() => Promise<void> | void> = [];
afterAll(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

const uuid = (i: number) => {
  const h = createHash('sha256').update(String(i)).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

type Org = { state: OrgState; certificates: Certificates; senders: Array<{ name: string; key: SigningKey }>; A: string; machine: SigningKey };

async function makeOrg(): Promise<Org> {
  const a1 = await newDevice('a1');
  const A = memberId();
  const machine = await generateSigningKey();
  const delegationKey = await generateSigningKey();
  const listed = await Promise.all(Array.from({ length: LISTED }, async (_, i) => ({ name: `mac${i}`, ref: `rList${i}`.padEnd(27, '0'), key: await generateSigningKey() })));
  const D = 'd'.repeat(32);
  let head = await genesis(ORG, A, a1, await generateSigningKey());
  head = await successor(head, [a1], (s) => {
    s.machines.push({ name: NAME, ref: REF, pub: machine.pub, owners: [A] });
    s.machineNames.push({ name: NAME, ref: REF });
    for (const m of listed) {
      s.machines.push({ name: m.name, ref: m.ref, pub: m.key.pub, owners: [A] });
      s.machineNames.push({ name: m.name, ref: m.ref });
    }
    s.delegations.push({ id: D, pub: delegationKey.pub, prefix: 'vm', expires: new Date(Date.now() + 30 * 86_400_000).toISOString(), maxUses: 100_000, offlineRevokeS: 3600, owners: [A] });
  });
  const certs: Certificates['certs'] = [];
  const retirements: Certificates['retirements'] = [];
  const certified: Array<{ name: string; key: SigningKey }> = [];
  for (let i = 0; i < CERTS; i++) {
    const key = await generateSigningKey();
    const name = `vm-${i}`;
    const ref = `${D}_${createHash('sha256').update(`ref${i}`).digest('base64url').slice(0, 24)}`;
    certs.push(await signRecord(SIGNING_DOMAINS.machineCert, { org: ORG, machine: ref, name, pub: key.pub, delegation: D, use: i + 1, issued: new Date(Date.now() - 86_400_000).toISOString() }, delegationKey.privateKey, delegationKey.pub));
    if (i < RETIRED) {
      retirements.push(await signRecord(SIGNING_DOMAINS.certRetire, { org: ORG, keyId: await keyId(key.pub), notAfter: new Date(Date.now() - 3_600_000).toISOString() }, delegationKey.privateKey, delegationKey.pub));
    } else if (certified.length < 8) certified.push({ name, key });
  }
  return { state: head.state, certificates: { certs, retirements }, senders: [...listed.map((m) => ({ name: m.name, key: m.key })), ...certified], A, machine };
}

/**
 * Writer sizes: a skewed spread over WRITERS summing to exactly TOTAL (at least one each). The floor of one pushes the
 * spread past a small TOTAL (341 events for 300), so the excess comes off the largest writers.
 */
function sizes(): number[] {
  if (TOTAL < WRITERS) throw new Error(`EVENTS is at least ${WRITERS}, one a writer`);
  const weights = Array.from({ length: WRITERS }, (_, i) => 1 / (1 + (i % 37)));
  const sum = weights.reduce((a, b) => a + b, 0);
  const out = weights.map((w) => Math.max(1, Math.floor((w / sum) * TOTAL)));
  let left = TOTAL - out.reduce((a, b) => a + b, 0);
  for (let i = 0; left > 0; i = (i + 1) % WRITERS, left--) out[i]++;
  for (; left < 0; left++) out[out.indexOf(Math.max(...out))]--;
  return out;
}

async function makeLog(org: Org): Promise<Map<string, LogEventV2[]>> {
  const log = new Map<string, LogEventV2[]>();
  const counts = sizes();
  const created = new Date(Date.now() - 600_000).toISOString();
  for (let w = 0; w < WRITERS; w++) {
    const sender = org.senders[w % org.senders.length];
    const writer = `${sender.name}/${uuid(w)}`;
    const events: LogEventV2[] = [];
    for (let seq = 1; seq <= counts[w]; seq++) {
      const body = {
        ts: created,
        writer,
        seq,
        kind: 'assistant',
        text: `${TEXT}${seq}`,
        created,
        attest: { owners: [org.A], ownersProof: [], origin: { kind: 'local' }, stateVersion: org.state.version },
      };
      events.push((await signEvent({ org: ORG, project: P }, body, sender.key.privateKey, sender.key.pub)) as unknown as LogEventV2);
    }
    log.set(writer, events);
  }
  return log;
}

/** desk-hub's `LogStore.beyond` with `batches`: writers in lexical order, pages of at most PAGE_ROWS and about BATCH_BYTES. */
function* pages(log: Map<string, LogEventV2[]>): Generator<LogEventV2[]> {
  for (const writer of [...log.keys()].sort()) {
    const events = log.get(writer)!;
    for (let at = 0; at < events.length; at += PAGE_ROWS) {
      let batch: LogEventV2[] = [];
      let bytes = 0;
      for (const e of events.slice(at, at + PAGE_ROWS)) {
        const size = JSON.stringify(e).length;
        if (batch.length > 0 && bytes + size > BATCH_BYTES) {
          yield batch;
          batch = [];
          bytes = 0;
        }
        batch.push(e);
        bytes += size;
      }
      if (batch.length > 0) yield batch;
    }
  }
}

const bench = process.env.MAWS_BENCH === '1' ? describe : describe.skip;

bench(`a first download through the endpoint (certs ${CERTS}, retired ${RETIRED})`, () => {
  let org: Org;
  let log: Map<string, LogEventV2[]>;

  it('the whole path', async () => {
    const made = performance.now();
    org = await makeOrg();
    log = await makeLog(org);
    process.stderr.write('\n' + `made the org and ${TOTAL} signed events over ${log.size} writers in ${Math.round(performance.now() - made)} ms`);
    const kid = await keyId(org.machine.pub);
    const hub = await new FakeHub().start();
    closers.push(() => hub.close());
    hub.heartbeatMs = 60_000;
    let rl10: Rl10 | null = null;
    const link = new HubLink({
      target: () => ({ hub: hub.url, credentials: { clientId: 'id', clientSecret: 'secret' }, ref: REF }),
      build: 'rate',
      log: () => {},
      hooks: { welcome: () => rl10?.hubWelcomed() },
    });
    closers.push(() => link.stop());
    link.start();
    await until(() => link.connected, 'the welcome');
    const dir = fs.mkdtempSync(join(tmpdir(), 'rl10rate-'));
    fs.chmodSync(dir, 0o700);
    closers.push(() => fs.rmSync(dir, { recursive: true, force: true }));
    const state = EndpointState.open(dir);
    const lines: string[] = [];
    rl10 = new Rl10({
      stateDir: () => dir,
      build: 'rate',
      state: () => state,
      head: () => ({ state: org.state, certificates: org.certificates }),
      identity: () => ({ org: ORG, hub: hub.url, name: NAME, ref: REF, enrolled: '2026-10-27T18:00:00.000Z' }),
      key: () => ({ key: org.machine, keyId: kid }),
      policy: new EndpointPolicy(() => state),
      hub: { openProject: (project, handler) => link.openProject(project, handler), send: (frame) => link.send(frame as Parameters<HubLink['send']>[0]), writable: () => link.writable() },
      listings: { report: async () => {}, gone: async () => {}, refresh: async () => {}, listedSessions: () => [] },
      notifier: { pendingSet: () => {}, requestMessage: () => {}, hostMessage: () => {}, forget: () => {} },
      machineOwners: async () => [],
      dispatch: () => Promise.reject(new Error('none')),
      now: Date.now,
      log: (line) => void lines.push(line),
    });
    const served = rl10;
    await served.serve();
    closers.push(() => served.unserve());
    const info = JSON.parse(fs.readFileSync(join(dir, 'rl10.json'), 'utf8')) as { socket: string; token: string };
    const sminos = await FakeSminos.open(info.socket);
    closers.push(() => sminos.close());
    sminos.send({ t: 'hello', protocol: { major: 1, minor: 0 }, capabilities: [], token: info.token, sminos: { version: 'rate' }, policy: { read_only: false, ceiling: 'settings' } });
    await sminos.next((f) => f.t === 'welcome', 'the welcome');
    sminos.send({ t: 'hello', project: P, name: 'maws', have: {} });
    await until(() => hub.frames('hello').some((r) => r.frame.project === P), 'the project’s hello at the hub');

    // Each writer's first arrival at sminos, stamped as the stand-in reads it (a 2 ms poll).
    const first = new Map<string, number>();
    let delivered = 0;
    const positions = new Map<string, number>();
    const twice: string[] = [];
    let t0 = 0;
    let scanned = 0;
    const stamp = setInterval(() => {
      for (; scanned < sminos.received.length; scanned++) {
        const f = sminos.received[scanned];
        if (f.t !== 'events') continue;
        for (const w of f.events as Array<{ event: { writer: string; seq: number } }>) {
          delivered++;
          const key = `${w.event.writer}:${w.event.seq}`;
          if (positions.has(key)) twice.push(`${key} in frames ${positions.get(key)} and ${scanned} at ${Math.round(performance.now() - t0)} ms`);
          positions.set(key, scanned);
          if (!first.has(w.event.writer)) first.set(w.event.writer, performance.now());
        }
      }
    }, 2);
    closers.push(() => clearInterval(stamp));

    const cpu0 = process.cpuUsage();
    t0 = performance.now();
    hub.current.send(JSON.stringify({ t: 'have', project: P, have: {} }));
    let frames = 0;
    for (const page of pages(log)) {
      hub.current.send(JSON.stringify({ t: 'events', project: P, events: page }));
      frames++;
    }
    const sentAt = performance.now() - t0;
    try {
      await until(() => delivered >= TOTAL, 'every event at sminos', Number(process.env.WAIT_MS ?? 1_800_000));
    } catch (error) {
      process.stderr.write(`\ndelivered ${delivered}; holding ${served.relay.holding}; lines:\n${lines.slice(0, 8).join('\n')}\n`);
      throw error;
    }
    const wall = performance.now() - t0;
    const cpu = process.cpuUsage(cpu0);
    // A little longer, so an event that came down twice is seen.
    await new Promise((resolve) => setTimeout(resolve, 500));
    clearInterval(stamp);
    const order = [...log.keys()].sort();
    const at = (i: number) => {
      const w = order[i];
      return { writer: i + 1, eventsBefore: order.slice(0, i).reduce((n, x) => n + log.get(x)!.length, 0), ms: Math.round(first.get(w)! - t0) };
    };
    process.stderr.write('\n' + 
      JSON.stringify(
        {
          setup: { events: TOTAL, writers: log.size, frames, certs: CERTS, retired: RETIRED, senders: org.senders.length },
          hubSentAllMs: Math.round(sentAt),
          wallMs: Math.round(wall),
          eventsPerS: Math.round((TOTAL / wall) * 1000),
          msPerEvent: +(wall / TOTAL).toFixed(3),
          cpuMs: Math.round((cpu.user + cpu.system) / 1000),
          cpuShare: +((cpu.user + cpu.system) / 1000 / wall).toFixed(2),
          writer33: at(32),
          writer88pct: at(Math.floor(order.length * 0.88)),
          twice,
          hubConnections: hub.sockets.length,
          spent: sminos.received.filter((f) => f.t === 'spent').length,
          logLines: lines.slice(0, 12),
        },
        null,
        1,
      ),
    );
    expect(twice).toEqual([]);
    expect(delivered).toBe(TOTAL);
  }, 1_900_000);

  it('each stage of #verify, alone', async () => {
    const dir = fs.mkdtempSync(join(tmpdir(), 'rl10stage-'));
    fs.chmodSync(dir, 0o700);
    closers.push(() => fs.rmSync(dir, { recursive: true, force: true }));
    const index = new InboundIndex(() => dir, Date.now);
    const t = { verifyEvent: 0, signerOf: 0, sha256: 0, seen: 0, record: 0, verifiedOwners: 0 };
    const now = new Date();
    const all = [...pages(log)].flat();
    const cpu0 = process.cpuUsage();
    const w0 = performance.now();
    for (const event of all) {
      let s = performance.now();
      const verdict = await verifyEvent({ org: ORG, project: P }, org.state, event, org.certificates, now);
      t.verifyEvent += performance.now() - s;
      if (!verdict.ok) throw new Error(`not verified: ${verdict.code}`);
      s = performance.now();
      await signerOf(org.state, org.certificates, event);
      t.signerOf += performance.now() - s;
      s = performance.now();
      const content = createHash('sha256').update(eventSigningInput({ org: ORG, project: P }, event)).digest('base64url');
      t.sha256 += performance.now() - s;
      s = performance.now();
      const seen = index.seen(P, content, event.writer, event.seq);
      t.seen += performance.now() - s;
      s = performance.now();
      if (seen.kind === 'new') index.record(P, content, event.writer, event.seq);
      t.record += performance.now() - s;
      s = performance.now();
      const owners = await verifiedOwners(event, org.state, org.certificates, () => {});
      t.verifiedOwners += performance.now() - s;
      if (owners === undefined || owners.length === 0) throw new Error('attestation did not verify');
    }
    const wall = performance.now() - w0;
    const cpu = process.cpuUsage(cpu0);
    const per = Object.fromEntries(Object.entries(t).map(([k, v]) => [k, +(v / all.length).toFixed(4)]));
    process.stderr.write('\n' + JSON.stringify({ stagesMsPerEvent: per, totalMsPerEvent: +(wall / all.length).toFixed(4), cpuShare: +((cpu.user + cpu.system) / 1000 / wall).toFixed(2) }, null, 1));
  }, 1_900_000);
});
