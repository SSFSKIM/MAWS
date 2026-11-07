// The reach acceptance's probe machines (P5 O18 M6, deploy/reach-acceptance.ts's `listProbe`, deploy/reach-items.ts's
// probe readers) driven on their real path against the suites' local hub: PA and PB enrolled and listed by the admin
// the way the run lists them, each with its RL1 socket and hello; a private session's stream written by an owner's
// machine; then what items 3c, 6b and 6c read through the probes — a hand-signed say refused `not-reachable` and kept
// as a tombstone on the owner's log, a hello's `have` and backlog, and the HTTP history page by writer.
import { join } from 'node:path';
import { historyLogPath, stateHash, type HistoryLogPage } from 'org-protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deviceEntry, OrgAdmin } from '../../deploy/org-admin.ts';
import { Cleanup } from '../../deploy/proof.ts';
import { listProbe } from '../../deploy/reach-acceptance.ts';
import { givenPastNotice, ownerLog, probeGet, probeHello, probeSay, streamOfSession, streamsOf, type Probe, type ProbeAt } from '../../deploy/reach-items.ts';
import { ADMIN, ORG, startLocalHub, type LocalHub } from '../support/local';
import { adminKeysFile, LocalPerson } from '../support/local-person';
import { genesis, memberId, newDevice, signedBy } from '../support/org';
import { AUDIENCE, joined, newSession, unlisted, upload } from '../support/reach';
import { Rl1Machine } from '../support/rl1';

process.env.DESK_HUB_APP ??= join(import.meta.dirname, '../..');

let hub: LocalHub;
let person: LocalPerson;
let admin: OrgAdmin;
let A: string;
let B: string;
const cleanup = new Cleanup();
/** A's machine on an endpoint advertising `audience`, the writer of the private session S. */
let writer: Rl1Machine;
let pa: Probe;
let pb: Probe;
const secrets: string[] = [];
const project = { id: '0f18a6e0-7c2d-4b5e-9a10-000000000006', name: 'o18-m6-probes' };
const at = (): ProbeAt => ({ hub: hub.url, org: ORG, project });
const S = { session: newSession(), alias: 's-probe' };
const P = newSession();
/** A session shared with B, then narrowed to A: its notice to B in the stream of the withdrawn. */
const N = newSession();
let noticeTs: string;

beforeAll(async () => {
  hub = await startLocalHub();
  person = new LocalPerson(hub);
  const { device } = await adminKeysFile();
  A = (await person.json<{ member: { id: string } }>('/api/me')).member.id;
  const root = { device: deviceEntry(device), channel: device.channel, stepUp: device.stepUp };
  const head = await signedBy(await genesis(ORG, A, ADMIN, root, device.recovery), root);
  await person.json('/api/org/state', { body: head }, 201);
  admin = await OrgAdmin.open(person, { org: ORG, pinnedGenesis: await stateHash(head.state) }, device, () => {});
  B = memberId();
  const bDevice = await newDevice('b-1');
  await admin.amend('B added', (s) => void s.members.push({ id: B, email: 'b@example.com', role: 'member', devices: [bDevice.device] }));

  writer = new Rl1Machine(hub, await admin.listedMachine('o18-a1', cleanup), { capabilities: AUDIENCE });
  await writer.connect();
  pa = await listProbe(admin, hub.url, 'o18-pa', A, undefined, cleanup, (v) => secrets.push(v));
  pb = await listProbe(admin, hub.url, 'o18-pb', B, AUDIENCE, cleanup, (v) => secrets.push(v));

  // S private to A (its snapshot in A's stream), P plain; both on the writer, the project opened first.
  await writer.sync(project.id, project.name);
  expect(await upload(writer, project.id, [joined(writer, project.id, S.session, 1, [A], 1), joined(writer, project.id, P, 1)])).toEqual([]);
  expect(await upload(writer, project.id, [joined(writer, project.id, N, 1, [A, B], 1)])).toEqual([]);
  const notice = unlisted(writer, project.id, N, 1, 2, [B]);
  noticeTs = notice.ts as string;
  expect(await upload(writer, project.id, [notice, joined(writer, project.id, N, 1, [A], 2)])).toEqual([]);
}, 60_000);
afterAll(async () => {
  writer?.close();
  await hub?.close();
});

describe('the probes on the local hub', () => {
  it('are listed for their owners, their secrets heard, the welcome carrying `audience` to each', async () => {
    const listed = admin.head.state.machines.filter((m) => m.name.startsWith('o18-p')).map((m) => [m.name, m.owners]);
    expect(listed).toEqual([
      ['o18-pa', [A]],
      ['o18-pb', [B]],
    ]);
    expect(secrets).toEqual([pa.machine.credentials.clientSecret, pb.machine.credentials.clientSecret]);
    for (const probe of [pa, pb]) expect(probe.welcome).toMatchObject({ t: 'welcome', capabilities: expect.arrayContaining(['audience']) });
  });

  it('PB, outside the audience: no stream of S in its hello or by name, the plain writer served', async () => {
    const stream = streamOfSession('o18-a1', S.session, [A]).writer;
    const hello = await probeHello(at(), pb, 300);
    expect(hello.have).toContain(`o18-a1/${P}`);
    expect(hello.have).not.toContain(stream);
    expect(hello.backlog.map((e) => e.writer)).not.toContain(stream);
    const page = await probeGet<HistoryLogPage>(at(), pb, historyLogPath(project.id, stream, 0));
    expect(page.status).toBe(200);
    expect(page.body!.events).toEqual([]);
    const plain = await probeGet<HistoryLogPage>(at(), pb, historyLogPath(project.id, `o18-a1/${P}`, 0));
    expect(plain.status).toBe(200);
    expect(plain.body!.events).toHaveLength(1);
  });

  it('PB, withdrawn from N: holds the notice’s stream and the share’s, nothing of N past the notice nor its owner-only stream', async () => {
    const ownerOnly = streamOfSession('o18-a1', N, [A]).writer;
    const hello = await probeHello(at(), pb, 300);
    const held = streamsOf([...hello.have, ...hello.backlog.map((e) => e.writer)], N);
    expect(new Set(held)).toEqual(new Set([streamOfSession('o18-a1', N, [B]).writer, streamOfSession('o18-a1', N, [A, B]).writer]));
    expect(hello.backlog.find((e) => e.writer === streamOfSession('o18-a1', N, [B]).writer)).toMatchObject({ kind: 'unlisted', ts: noticeTs });
    expect(givenPastNotice(N, ownerOnly, noticeTs, hello.have, hello.backlog)).toEqual([]);
  });

  it('PA, the owner’s old endpoint: given no stream of S, by hello or by name', async () => {
    const stream = streamOfSession('o18-a1', S.session, [A]).writer;
    const hello = await probeHello(at(), pa, 300);
    expect([...hello.have, ...hello.backlog.map((e) => e.writer)]).not.toContain(stream);
    const page = await probeGet<HistoryLogPage>(at(), pa, historyLogPath(project.id, stream, 0));
    expect(page.status).toBe(200);
    expect(page.body!.events).toEqual([]);
  });

  it('a hand-signed say from either probe naming private S is refused not-reachable with no message, a tombstone on the owner’s log', async () => {
    for (const probe of [pb, pa]) {
      const r = await probeSay(at(), probe, S, `tok-${probe.name}`);
      expect(r.refusal).toEqual({ reason: 'not-reachable', writer: r.writer, seq: 1 });
      const stored = (await ownerLog({ hub: hub.url, person, project })).find((l) => l.event.writer === r.writer);
      expect(stored?.event).toEqual({ writer: r.writer, seq: 1, withheld: true });
    }
  });

  it('undoes its listings: every probe and the writer revoked and out of the state', async () => {
    writer.close();
    expect(await cleanup.run()).toEqual([]);
    expect(admin.head.state.machines.map((m) => m.name)).toEqual([]);
  });
});
