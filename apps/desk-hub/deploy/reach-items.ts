// The items of P5 O18 M6's live acceptance of message reach (docs/doperpowers/plans/2026-11-05-p5-o18-message-reach.md,
// Acceptance 1–8 and M6), each against the reach scene reach-acceptance.ts builds: three scratch machines on the run's
// VM (A1 and A2 the staging admin's, B1 a second member B's), a fourth (A3, on the old sminos) brought up for 6e, and two
// in-process probe machines (PA, the admin's, whose RL1 hello lacks `audience`: an old endpoint and an old reader; PB,
// B's, whose hello carries it). S runs on A1, T on A2, U on B1; S spawns L1 while listed and C1 once private.
//
// Every item sets up what it needs of the sessions' visibility first (`ensure`): narrowing from the session's own shell,
// widening by the operator at the scene's terminal (the pty path, staging's and the run's scenes' alone), so an item can
// be rehearsed on its own (`--items`). Every check is one report line; what the run makes is undone by its cleanup.
import { randomBytes, randomUUID } from 'node:crypto';
import { historyInventoryPath, historyLogPath, signEvent, streamWriter, type HistoryInventory, type HistoryLogPage, type Listing, type Rl1Welcome, type Signed } from 'org-protocol';
import { ProjectSocket, type DeviceHuman, type LoggedEvent } from 'org-protocol/test-support';
import type { FakeEndpoint } from '../fake-machine/endpoint';
import type { V2Machine } from '../fake-machine/org';
import { credentialHeaders } from '../fake-machine/link';
import type { LogEvent } from '../src/protocol/log';
import type { OrgView } from './endpoint-acceptance';
import type { MemberChange, RunHub, StepResult, Tag, VmMachine } from './endpoint-machine';
import { openRemote, testDevice, type RelayDialer, type Remote, type RunDevice } from './endpoint-remote';
import type { ItemReport } from './endpoint-verdicts';
import type { Person } from './hub';
import { seatSession } from './endpoint-items';
import type { Cleanup } from './proof';

/** The items, in the run's order (M6's "Items, live, in the run's order"); `scene` is the preflight. */
export const REACH_ITEMS = ['2', '8', '3a', '3b', '3c', '7', '1', '5', '4', '3e', '3d', '6b', '6c', '6d', '6e'] as const;
export type ReachItem = (typeof REACH_ITEMS)[number];

/** The clauses cited from suites, not run (M6's "Cited, not run"). */
export const CITED = {
  '6a': 'an old hub (the endpoint holds the events): test/endpoint/rl10/audience-signing.test.ts, the holds while the hub’s welcome lacks `audience` (“holds stream events, unsigned, while the hub’s welcome lacks `audience`…”, “holds a stream position the ledger signed already…”, “sends no queued stream event over a connection whose hub lacks `audience`…”); a pre-M1 hub over M1’s stored tombstones would put staging’s logs at risk',
  '8': 'the cutover sentence (M5’s step-up cutover closes widening to every agent): sminos test_visibility.py `Cutover` (doperpowers 0759115d); the scene’s MAWS predates the `record` acts, and O8 M6b’s own e2e proves the step-up path',
  '3a': 'the member’s browser half: apps/desk-hub/test/audience-reads.test.ts (“live and on resume: A’s browser is sent the stream, B’s never”, the audit record live and replayed, the session plane); the second member is @staging.invalid, and the hub resolves a browser’s member by its Access email alone',
} as const;

/** A machine of the scene: a VM scene's, enrolled and listed. */
export type ReachMachine = { scene: string; vm: VmMachine; name: string; ref: string; owner: string };
/** A session of the scene's, as its sminos lists it. */
export type ReachSession = { label: string; session: string; alias: string; short?: string; machine: ReachMachine };
/** A probe machine in this process (FakeEndpoint), speaking only to the staging hub. */
export type Probe = { name: string; machine: V2Machine; endpoint: FakeEndpoint; welcome: Rl1Welcome };

export type ReachScene = {
  hub: string;
  org: string;
  person: Person;
  view: OrgView;
  /** The staging admin member (A) and their email, the owner of A1, A2, A3 and PA. */
  a: { member: string; email: string; device: RunDevice };
  /** The second member (B) and their device `b1`, the owner of B1 and PB. */
  b: { member: string; email: string; device: RunDevice };
  machines: { a1: ReachMachine; a2: ReachMachine; b1: ReachMachine };
  /** A3 up, enrolled, listed and in the project, on the old sminos (6e); once. */
  bringA3(): Promise<ReachSession>;
  pa: Probe;
  pb: Probe;
  project: { id: string; name: string };
  S: ReachSession;
  T: ReachSession;
  U: ReachSession;
  seats: { L1?: ReachSession; C1?: ReachSession };
  /** The relay to A1, for b1's channels. */
  relayA1: RelayDialer;
  /** The project's archive designated to a machine of the run's (by name), or cleared. */
  designate(machine: string | null): Promise<void>;
  /** Where the operator's pty path may widen: this run's hub and its own scenes. */
  run: { hub: RunHub; scenes: string[] };
  cleanup: Cleanup;
  log(line: string): void;
  tag: string;
  /** The tokens of says whose every event is private (to or from a private session, no listed recipient beside it):
   * what no archive commit may hold. */
  privateTokens: string[];
};

const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

async function until<T>(probe: () => Promise<T | null | undefined | false>, what: string, ms: number, every = 2000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await probe();
    if (value !== null && value !== undefined && value !== false) return value;
    if (Date.now() > deadline) throw new Error(`no ${what} within ${ms / 1000} s`);
    await sleep(every);
  }
}

// ---- what the items read, as pure functions (test/deploy/reach-acceptance.test.ts) ---------------------------------

/** The policyRev sminos access's and share's report line names (`… access private, policyRev 3; …`), or null. */
export function policyRevOf(lines: readonly string[]): number | null {
  for (const line of [...lines].reverse()) {
    const m = /policyRev (\d+)/.exec(line);
    if (m) return Number(m[1]);
  }
  return null;
}

/** A session's stream writer of `members` and its log file's name on a machine (`/` as `.`). */
export function streamOfSession(machine: string, session: string, members: readonly string[]): { writer: string; file: string } {
  const writer = streamWriter(`${machine}/${session}`, members);
  return { writer, file: `${writer.replace('/', '.')}.jsonl` };
}

/** Whether a writer's withheld positions (uplink.json's `withheld`, or a `have`'s, as runs `[seq | [from, to]]`) hold `seq`. */
export function withheldHolds(withheld: unknown, writer: string, seq: number): boolean {
  const runs = (withheld as Record<string, unknown> | null | undefined)?.[writer];
  if (!Array.isArray(runs)) return false;
  return runs.some((r) => r === seq || (Array.isArray(r) && r.length === 2 && typeof r[0] === 'number' && typeof r[1] === 'number' && r[0] <= seq && seq <= r[1]));
}

/** The withheld map uplink.json holds, wherever it keeps it (`withheld`, or `archive_have.withheld`). */
export function uplinkWithheld(uplink: Record<string, unknown> | null): Record<string, unknown> {
  const own = uplink?.withheld;
  const have = (uplink?.archive_have as { withheld?: unknown } | undefined)?.withheld;
  return { ...((have as Record<string, unknown> | undefined) ?? {}), ...((own as Record<string, unknown> | undefined) ?? {}) };
}

/** Whether a JSON value names `id` anywhere (a field, a writer, a text). */
export const names = (value: unknown, id: string): boolean => JSON.stringify(value ?? null).includes(id);

/** The audience streams of `session` a vector or a list of writers holds (`<machine>/<session>~<digest>`). */
export const streamsOf = (writers: Iterable<string>, session: string): string[] => [...writers].filter((w) => w.includes(`/${session}~`));

/**
 * What a reader outside private `session`'s audience was given of it beyond what it may hold: `ownerOnly` (the stream of
 * the owner alone) named anywhere, or an event of the session's streams written after its last `unlisted` notice
 * (`after`, its ts) that is not a notice. The notice's own stream, addressed to the withdrawn, and a share's stream
 * written while the reader was in it are the reader's (`Project.mayRead`); a withheld position carries nothing.
 */
export function givenPastNotice(session: string, ownerOnly: string, after: string, writers: Iterable<string>, events: readonly BacklogEvent[]): string[] {
  const out = new Set<string>();
  for (const w of [...writers, ...events.map((e) => e.writer)]) if (w === ownerOnly) out.add(w);
  for (const e of events) {
    if (e.writer === ownerOnly || streamsOf([e.writer], session).length === 0 || e.withheld === true || e.kind === 'unlisted') continue;
    if (e.ts === undefined || e.ts > after) out.add(`${e.writer}:${e.seq}`);
  }
  return [...out];
}

/**
 * Every audience stream an HTTP inventory lists. The history routes read as the machine's HTTP reader, which is served
 * no audience stream of another machine's at all, so any stream there is a leak: the notice's exception is the RL1
 * connection's (`givenPastNotice`), never this one's.
 */
export function inventoryStreams(inventory: HistoryInventory | null | undefined): string[] {
  return (inventory?.projects ?? []).flatMap((p) => p.writers.map((w) => w.writer)).filter((w) => w.includes('~'));
}

// ---- the scene's means ----------------------------------------------------------------------------------------------

const token = (scene: ReachScene, what: string) => `o18-${what}-${scene.tag}-${randomBytes(4).toString('hex')}`;
const tagOf = (s: ReachSession): Tag => (s.short === undefined ? { alias: s.alias } : { alias: s.alias, short: s.short });
const said = (r: StepResult) => r.lines.join(' / ').slice(0, 300);

/** `from`'s agent says `hello <tok>` to `to`, from its own shell. */
function sayFrom(from: ReachSession, tok: string, to: readonly ReachSession[] | readonly Tag[]): Promise<StepResult> {
  const tags = to.map((t) => ('session' in t ? tagOf(t) : t));
  return from.machine.vm.asSession(from.session, { say: { token: tok, tags } });
}

const count = (s: ReachSession, tok: string) => s.machine.vm.laneA.count(s.session, tok);
const arrives = (s: ReachSession, tok: string, ms = 90_000) => until(async () => (await count(s, tok)) || null, `${tok} in ${s.label}'s transcript`, ms, 3000);
async function never(s: ReachSession, tok: string, ms = 60_000): Promise<void> {
  await sleep(ms);
  const n = await count(s, tok);
  if (n !== 0) throw new Error(`${tok} reached ${s.label} ${n} time(s)`);
}

/** Sets a session's access (narrowing from its own shell; widening by the operator at its scene's terminal). */
async function setAccess(scene: ReachScene, s: ReachSession, level: 'private' | 'listed'): Promise<StepResult> {
  const change: MemberChange = { access: { member: s.session, level } };
  const r = level === 'private' ? await s.machine.vm.asSession(s.session, change) : await s.machine.vm.operator(change, scene.run);
  if (r.rc !== 0) throw new Error(`${s.label} ${level}: exited ${r.rc}: ${said(r)}`);
  return r;
}

/** Shares S's session with B at `grade` (the operator: a widening) or removes the share (its own shell: narrowing). */
async function shareS(scene: ReachScene, grade: 'list' | 'view' | 'none'): Promise<StepResult> {
  const change: MemberChange = { share: { member: scene.S.session, person: scene.b.member, grade } };
  const r = grade === 'none' ? await scene.S.machine.vm.asSession(scene.S.session, change) : await scene.S.machine.vm.operator(change, scene.run);
  if (r.rc !== 0) throw new Error(`S's share with B ${grade}: exited ${r.rc}: ${said(r)}`);
  return r;
}

/** Whether U's `sminos list --org --json` names S. */
async function uSees(scene: ReachScene, s: ReachSession = scene.S): Promise<boolean> {
  const r = await scene.U.machine.vm.asSession(scene.U.session, { listOrg: true });
  if (r.rc !== 0) throw new Error(`U's list --org exited ${r.rc}: ${said(r)}`);
  return r.lines.some((l) => l.includes(s.session));
}

/** The owner's view of the project's log, from offset 0, caught up. */
export async function ownerLog(scene: Pick<ReachScene, 'hub' | 'person' | 'project'>): Promise<LoggedEvent[]> {
  const socket = await ProjectSocket.open(scene.hub, scene.person.headers, scene.project.id, 15_000);
  try {
    await socket.catchUp(0);
    return socket.log;
  } finally {
    socket.close();
  }
}

/** Where a probe speaks: the hub, the org it signs for, and the run's project. */
export type ProbeAt = Pick<ReachScene, 'hub' | 'org' | 'project'>;

/** A probe machine's request to the hub's HTTP history routes, as the machine: its service token alone, never the
 * owner's Access token beside it, which would make the request the owner's. */
export async function probeGet<T>(scene: ProbeAt, probe: Probe, path: string): Promise<{ status: number; body: T | null }> {
  const response = await fetch(`${scene.hub}${path}`, { headers: credentialHeaders(probe.machine.credentials), signal: AbortSignal.timeout(30_000) });
  const text = await response.text();
  let body: T | null = null;
  try {
    body = JSON.parse(text) as T;
  } catch {
    // not JSON: the status says it
  }
  return { status: response.status, body };
}

/** An event a probe was sent, as far as the checks read it. */
export type BacklogEvent = { writer: string; seq: number; kind?: string; ts?: string; withheld?: boolean };

/** A probe's project hello: the hub's vector and archive flag, and the events it sends after (its backlog), settled. */
export async function probeHello(scene: ProbeAt, probe: Probe, settleMs = 5000): Promise<{ have: string[]; backlog: BacklogEvent[] }> {
  const from = probe.endpoint.frames.length;
  const have = await probe.endpoint.project(scene.project.id, scene.project.name);
  await sleep(settleMs);
  const backlog = probe.endpoint.frames
    .slice(from)
    .filter((f) => f.t === 'events' && f.project === scene.project.id)
    .flatMap((f) => (f.events as BacklogEvent[]).map(({ writer, seq, kind, ts, withheld }) => ({ writer, seq, kind, ts, withheld })));
  return { have: Object.keys(have.have ?? {}), backlog };
}

/** A hand-signed v2 `say` from a probe to `to` uploaded with no audience: the hub's refusal of it, or its acceptance. */
export async function probeSay(scene: ProbeAt, probe: Probe, to: Pick<ReachSession, 'session' | 'alias'>, tok: string): Promise<{ writer: string; seq: number; refusal: { reason: string; message?: string } | null }> {
  const writer = `${probe.name}/${randomUUID()}`;
  const ts = new Date().toISOString();
  const draft = { ts, created: ts, writer, seq: 1, kind: 'say', from: 'o18-probe', to: [{ session: to.session, alias: to.alias }], text: `@${to.alias} hello ${tok}` };
  const event = (await signEvent({ org: scene.org, project: scene.project.id }, draft, probe.machine.key.privateKey, probe.machine.key.pub)) as unknown as LogEvent;
  // The project open on the probe's socket first, whatever ran before: the hub refuses events for a project the
  // connection never said hello to (‘not-open’, naming no writer).
  await probe.endpoint.project(scene.project.id, scene.project.name);
  const from = probe.endpoint.frames.length;
  probe.endpoint.upload(scene.project.id, [event]);
  const answer = await probe.endpoint
    .next((f) => f.t === 'refused' && f.project === scene.project.id && [writer, undefined].includes((f.refusal as { writer?: string }).writer), `the refusal of ${writer}`, from, 30_000)
    .catch(() => null);
  return { writer, seq: 1, refusal: answer === null ? null : (answer.refusal as { reason: string; message?: string }) };
}

/** b1's channel to A1 over the relay. */
async function b1ToA1(scene: ReachScene): Promise<Remote> {
  return openRemote(testDevice(scene.org, scene.b.device, { chain: scene.view.chain, certificates: scene.view.certificates }, { build: 'o18-m6-acceptance' }), scene.machines.a1.ref, () => scene.relayA1.dial());
}

/** The listings b1 is served by A1's endpoint. */
async function b1Listings(scene: ReachScene): Promise<Signed<Listing>[]> {
  const remote = await b1ToA1(scene);
  try {
    const answer = await remote.call('endpoint.listings', {});
    if (!answer.ok) throw new Error(`endpoint.listings refused ${answer.code}`);
    const out = answer.output as { listings?: Signed<Listing>[] } | Signed<Listing>[];
    return Array.isArray(out) ? out : (out.listings ?? []);
  } finally {
    remote.close();
  }
}

/** The ts of the last `unlisted` notice of `s` its own machine holds. */
async function noticeTs(s: ReachSession): Promise<string> {
  const notices = (await s.machine.vm.events(s.session)).filter((e) => e.kind === 'unlisted' && e.session === s.session && typeof e.ts === 'string');
  const last = notices.map((e) => e.ts!).sort().at(-1);
  if (last === undefined) throw new Error(`${s.label}'s machine holds no unlisted notice of it`);
  return last;
}

/** The archive after `periods` archive periods of the designated machine have passed with a new commit on main. */
async function archiveAfter(scene: ReachScene, before: string | null, tokens: readonly string[], ms = 300_000): Promise<NonNullable<Awaited<ReturnType<VmMachine['archive']>>>> {
  return until(
    async () => {
      const a = await scene.machines.a1.vm.archive(tokens);
      return a !== null && a.head !== before ? a : null;
    },
    'a new archive commit',
    ms,
    10_000,
  );
}

const archiveHead = async (scene: ReachScene) => (await scene.machines.a1.vm.archive())?.head ?? null;

/** S listed (2, 8), or private with no share (3a–3e, 7, 1). */
async function ensure(scene: ReachScene, s: ReachSession, level: 'private' | 'listed'): Promise<void> {
  await setAccess(scene, s, level);
  if (s === scene.S && level === 'private') await shareS(scene, 'none');
}

// ---- the preflight --------------------------------------------------------------------------------------------------

export async function preflight(scene: ReachScene, report: ReachReport): Promise<void> {
  await report.check('scene', 'every session in /api/listings', async () => {
    const found = await until(
      async () => {
        const { listings } = await scene.person.json<{ listings: Signed<Listing>[] }>('/api/listings');
        return [scene.S, scene.T, scene.U].every((s) => listings.some((l) => l.body.session === s.session)) ? listings.length : null;
      },
      'S, T and U in /api/listings',
      120_000,
    );
    return `S, T and U listed (${found} listings)`;
  });
  await report.check('scene', 'every sminos on RL10, its audiences.json carrying access and reach', async () => {
    const out: string[] = [];
    for (const m of Object.values(scene.machines)) {
      const status = await m.vm.laneA.sminos.status();
      if (!status.lines.some((l) => /uplink: RL10/.test(l) && /running/.test(l))) throw new Error(`${m.scene}'s sminos: ${status.lines.join(' / ')}`);
      const audiences = await until(async () => {
        const a = await m.vm.json('audiences');
        const caps = (a?.capabilities as string[] | undefined) ?? [];
        return caps.includes('access') && caps.includes('reach') ? caps : null;
      }, `${m.scene}'s audiences.json capabilities`, 60_000);
      out.push(`${m.scene}: ${audiences.join(',')}`);
    }
    return out.join('; ');
  });
  await report.check('scene', 'PB’s welcome carries `audience`, PA’s hello none', async () => {
    const caps = (scene.pb.welcome as { capabilities?: string[] }).capabilities ?? [];
    if (!caps.includes('audience')) throw new Error(`the hub's welcome to PB carries ${JSON.stringify(caps)}: is M1 deployed?`);
    return `the hub's welcome carries ${caps.join(',')}`;
  });
}

// ---- the items ------------------------------------------------------------------------------------------------------

/** Item 2: the second member's agent resolves and messages a listed session; S spawns L1 while listed. */
export async function item2(scene: ReachScene, report: ReachReport): Promise<void> {
  await ensure(scene, scene.S, 'listed');
  const tok = token(scene, 'i2');
  await report.check('2', 'U messages S, listed', async () => {
    const r = await sayFrom(scene.U, tok, [scene.S]);
    if (r.rc !== 0) throw new Error(`U's say exited ${r.rc}: ${said(r)}`);
    const n = await arrives(scene.S, tok);
    if (n !== 1) throw new Error(`delivered ${n} times`);
    return `delivered once (${said(r)})`;
  });
  await report.check('2', 'as a peer message with its owner label, nobody’s words', async () => {
    const row = await scene.S.machine.vm.row(scene.S.session, tok);
    if (row === null) throw new Error('no row holds it');
    if (!row.includes(scene.U.alias) || !row.includes(scene.b.email)) throw new Error(`the row names neither U's alias and B's email: ${row.slice(0, 200)}`);
    if (!/\[sminos/.test(row)) throw new Error(`the row is not a chat frame: ${row.slice(0, 200)}`);
    return `the row is a chat frame from ${scene.U.alias}, owned by ${scene.b.email}`;
  });
  await report.check('2', 'S spawns L1 while listed', async () => {
    scene.seats.L1 = await spawnSeat(scene, scene.S, `o18-l1-${scene.tag}`);
    return `L1 is ${scene.seats.L1.session}`;
  });
}

async function spawnSeat(scene: ReachScene, from: ReachSession, alias: string): Promise<ReachSession> {
  const r = await from.machine.vm.asSession(from.session, { spawn: { alias } });
  const session = seatSession(r.lines);
  if (r.rc !== 0 || session === null) throw new Error(`the spawn of ${alias} exited ${r.rc}: ${said(r)}`);
  return { label: alias, session, alias, machine: from.machine };
}

/** Item 8's first sentence: from S's shell, going private succeeds; going listed and a share are refused, policyRev held. */
export async function item8(scene: ReachScene, report: ReachReport): Promise<void> {
  await ensure(scene, scene.S, 'listed');
  const vm = scene.S.machine.vm;
  let rev: number | null = null;
  await report.check('8', 'an agent’s shell narrows: private succeeds', async () => {
    const r = await vm.asSession(scene.S.session, { access: { member: scene.S.session, level: 'private' } });
    rev = policyRevOf(r.lines);
    if (r.rc !== 0 || rev === null) throw new Error(`exited ${r.rc}: ${said(r)}`);
    return `access private, policyRev ${rev}`;
  });
  for (const [what, change] of [
    ['listed', { access: { member: scene.S.session, level: 'listed' } }],
    ['a share with B', { share: { member: scene.S.session, person: scene.b.member, grade: 'view' } }],
  ] as const) {
    await report.check('8', `an agent’s shell never widens: ${what} refused`, async () => {
      const r = await vm.asSession(scene.S.session, change as MemberChange);
      if (r.rc === 0 || !r.lines.some((l) => l.includes('widening reach needs its owner'))) throw new Error(`exited ${r.rc}: ${said(r)}`);
      const held = policyRevOf((await vm.asSession(scene.S.session, { access: { member: scene.S.session, level: 'private' } })).lines);
      if (held !== rev) throw new Error(`policyRev moved from ${rev} to ${held}`);
      return `refused (“widening reach needs its owner”), policyRev still ${held}`;
    });
  }
  report.bySuites('8', CITED['8']);
}

/** 3a: nothing new of private S reaches B's machine, PB, b1 or the archive; C1, born private, shows the literal none. */
export async function item3a(scene: ReachScene, report: ReachReport): Promise<void> {
  await ensure(scene, scene.S, 'private');
  const b1 = scene.machines.b1.vm;
  const a = scene.a.member;
  const stream = streamOfSession(scene.machines.a1.name, scene.S.session, [a]);
  await report.check('3a', 'U’s list --org, find and @short name nothing of S', async () => {
    await until(async () => !(await uSees(scene)), 'S gone from U’s list --org', 90_000);
    const found = await b1.asSession(scene.U.session, { find: { name: scene.S.alias } });
    if (found.lines.some((l) => l.includes(scene.S.session))) throw new Error(`find names S: ${said(found)}`);
    if (scene.S.short === undefined) throw new Error('S has no short');
    const before = await b1.logFiles();
    const r = await b1.asSession(scene.U.session, { say: { token: token(scene, 'i3a'), tags: [{ alias: scene.S.short }] } });
    if (r.rc === 0 || !r.lines.some((l) => l.includes(`no member @${scene.S.short}`))) throw new Error(`@${scene.S.short} was answered ${r.rc}: ${said(r)}`);
    if (JSON.stringify(await b1.logFiles()) !== JSON.stringify(before)) throw new Error('the refused say wrote to the log');
    return `list and find name nothing of S; @${scene.S.short} answers “no member”, nothing written`;
  });
  await report.check('3a', 'B1’s log files and uplink.json carry no audience stream of S, nothing of S after its notice', async () => {
    const files = (await b1.logFiles()).map((f) => f.name);
    if (files.includes(stream.file)) throw new Error(`B1 holds ${stream.file}`);
    if (names(await b1.json('uplink'), stream.writer)) throw new Error(`B1's uplink.json names ${stream.writer}`);
    const after = await noticeTs(scene.S);
    const grep = await b1.grepHome(scene.S.session, after);
    if (grep.total !== 0) throw new Error(`after the notice (${after}), B1 holds S's id in ${JSON.stringify(grep.files)}`);
    const held = streamsOf(files.map((f) => f.replace('.', '/').replace(/\.jsonl$/, '')), scene.S.session);
    return `no ${stream.file}; S's id in no line after its notice (${after}); B1 holds of S's streams ${held.length ? held.join(', ') + ' (the notice’s, served to the withdrawn)' : 'none'}`;
  });
  await report.check('3a', 'C1, born private, is nowhere on B1 and in no listing', async () => {
    scene.seats.C1 ??= await spawnSeat(scene, scene.S, `o18-c1-${scene.tag}`);
    await sleep(30_000);
    const grep = await b1.grepHome(scene.seats.C1.session);
    if (grep.total !== 0) throw new Error(`B1 holds C1's id: ${JSON.stringify(grep.files)}`);
    const { listings } = await scene.person.json<{ listings: Signed<Listing>[] }>('/api/listings');
    if (listings.some((l) => l.body.session === scene.seats.C1!.session || l.body.session === scene.S.session)) throw new Error('the owner’s /api/listings lists C1 or S');
    return 'C1’s id is in no file of B1’s sminos home; the owner’s /api/listings lists neither C1 nor S';
  });
  await report.check('3a', 'b1’s endpoint.listings from A1 has no S', async () => {
    const listings = await b1Listings(scene);
    if (listings.some((l) => l.body.session === scene.S.session)) throw new Error('A1 lists S to b1');
    return `${listings.length} listing(s), none of S`;
  });
  await report.check('3a', 'PB’s hello, the history route and the inventory give nothing of S past its notice', async () => {
    // B is withdrawn from S, so PB's RL1 connection may hold the notice's stream (addressed to the withdrawn) and a
    // share's from before it; never S's stream of its owner alone, nor anything of S written after the notice. The HTTP
    // inventory, read as the machine's HTTP reader, lists no stream at all.
    const hello = await probeHello(scene, scene.pb);
    const after = await noticeTs(scene.S);
    const given = givenPastNotice(scene.S.session, stream.writer, after, hello.have, hello.backlog);
    if (given.length) throw new Error(`PB was given ${given.join(', ')}`);
    const held = streamsOf(new Set([...hello.have, ...hello.backlog.map((e) => e.writer)]), scene.S.session);
    const inventory = await probeGet<HistoryInventory>(scene, scene.pb, historyInventoryPath([scene.machines.a1.name]));
    const listed = inventoryStreams(inventory.body);
    if (listed.length) throw new Error(`the inventory lists a stream: ${listed.join(', ')}`);
    const page = await probeGet<HistoryLogPage>(scene, scene.pb, historyLogPath(scene.project.id, stream.writer, 0));
    if ((page.body?.events?.length ?? 0) !== 0) throw new Error(`the history route served ${page.body!.events.length} event(s) of ${stream.writer}`);
    const plain = await probeGet<HistoryLogPage>(scene, scene.pb, historyLogPath(scene.project.id, `${scene.machines.a1.name}/${scene.S.session}`, 0));
    if ((plain.body?.events?.length ?? 0) === 0) throw new Error(`the history route served S's plain writer nothing (${plain.status})`);
    return `nothing of S after its notice (${after}) and no ${stream.writer} in the have or backlog (of S's streams PB holds ${held.length ? held.join(', ') : 'none'}); ${stream.writer} by name: nothing (${page.status}); the plain writer: ${plain.body!.events.length} event(s); the inventory lists no stream`;
  });
  await report.check('3a', 'PA, the owner’s own old machine, gets no stream over HTTP either', async () => {
    const page = await probeGet<HistoryLogPage>(scene, scene.pa, historyLogPath(scene.project.id, stream.writer, 0));
    if ((page.body?.events?.length ?? 0) !== 0) throw new Error(`served ${page.body!.events.length} event(s)`);
    return `${stream.writer} by name: nothing (${page.status})`;
  });
  await report.check('3a', 'the archive, A1 archiving, holds no stream and none of the private tokens', async () => {
    const tok = token(scene, 'i3a-p');
    scene.privateTokens.push(tok);
    const r = await sayFrom(scene.T, tok, [scene.S]);
    if (r.rc !== 0) throw new Error(`T's say to S exited ${r.rc}: ${said(r)}`);
    await arrives(scene.S, tok);
    const before = await archiveHead(scene);
    await scene.designate(scene.machines.a1.name);
    const archive = await archiveAfter(scene, before, scene.privateTokens);
    const streams = archive.files.filter((f) => f.includes('~'));
    const leaked = Object.entries(archive.tokens).filter(([, n]) => n > 0);
    if (streams.length || leaked.length) throw new Error(`the archive holds ${[...streams, ...leaked.map(([t]) => t)].join(', ')}`);
    return `main at ${archive.head}: ${archive.files.length} file(s), no stream file, none of ${scene.privateTokens.length} private token(s)`;
  });
  report.bySuites('3a', CITED['3a']);
}

/** 3b: nothing else names S: L1's new events, and a split say. */
export async function item3b(scene: ReachScene, report: ReachReport): Promise<void> {
  if (scene.seats.L1 === undefined) {
    await ensure(scene, scene.S, 'listed');
    scene.seats.L1 = await spawnSeat(scene, scene.S, `o18-l1-${scene.tag}`);
  }
  await ensure(scene, scene.S, 'private');
  const L1 = scene.seats.L1;
  const b1 = scene.machines.b1.vm;
  await report.check('3b', 'L1, listed, names S as its spawner to no one after S’s notice', async () => {
    const tok = token(scene, 'i3b-l');
    const r = await sayFrom(L1, tok, [scene.U]);
    if (r.rc !== 0) throw new Error(`L1's say exited ${r.rc}: ${said(r)}`);
    await arrives(scene.U, tok);
    const after = await noticeTs(scene.S);
    const grep = await b1.grepHome(scene.S.session, after);
    if (grep.total !== 0) throw new Error(`B1 holds S's id after its notice: ${JSON.stringify(grep.files)}`);
    const list = await b1.asSession(scene.U.session, { listOrg: true });
    if (!list.lines.some((l) => l.includes(L1.session))) throw new Error('U does not see L1');
    if (list.lines.some((l) => l.includes(scene.S.session))) throw new Error('U’s list --org names S (L1’s origin?)');
    return 'L1’s message reached U; on B1 nothing after the notice names S, and U’s list shows L1 with no origin naming S';
  });
  await report.check('3b', 'a say to S and U together reaches B1 only as its own, naming neither S’s alias nor short', async () => {
    // Not a private marker: the say's public split carries it to U, which the archive keeps by right. Its private split
    // is in S's stream, which the archive's checks find in no file.
    const tok = token(scene, 'i3b-s');
    const r = await sayFrom(scene.T, tok, [scene.S, scene.U]);
    if (r.rc !== 0) throw new Error(`T's say exited ${r.rc}: ${said(r)}`);
    await arrives(scene.S, tok);
    await arrives(scene.U, tok);
    const events = await until(async () => {
      const e = await b1.events(tok);
      return e.length ? e : null;
    }, `${tok} in B1's log`, 60_000);
    const expected = `@${tagWordOf(scene.U)} hello ${tok}`;
    if (events.length !== 1 || events[0].text !== expected) throw new Error(`B1 holds ${JSON.stringify(events)}`);
    if (events[0].text.includes(scene.S.alias) || (scene.S.short !== undefined && events[0].text.includes(scene.S.short))) throw new Error('its text names S');
    return `B1 holds one event, “${expected}”, under ${events[0].writer}; S and U each got it once`;
  });
}

const tagWordOf = (s: ReachSession) => (s.short === undefined ? s.alias : `${s.alias}#${s.short}`);

/** 3c: a forged say to S under U's plain writer is refused at upload, U is told, B1's archive keeps the tombstone. */
export async function item3c(scene: ReachScene, report: ReachReport): Promise<void> {
  await ensure(scene, scene.S, 'private');
  const b1 = scene.machines.b1.vm;
  const writer = `${scene.machines.b1.name}/${scene.U.session}`;
  const alias = `o18-forged-${scene.tag}`;
  const tok = token(scene, 'i3c');
  let seq: number | null = null;
  await scene.designate(scene.machines.b1.name);
  const before = await archiveHead(scene);
  await report.check('3c', 'a forged say is refused at the hub’s upload, settled withheld', async () => {
    ({ seq } = await b1.forgeSay(scene.U.session, scene.S.session, alias, tok));
    if (seq === null) throw new Error('sminos gave the forged say no position');
    await until(async () => withheldHolds(uplinkWithheld(await b1.json('uplink')), writer, seq!), `${writer}:${seq} withheld in B1's uplink.json`, 90_000);
    return `${writer}:${seq} withheld in B1's uplink.json`;
  });
  await report.check('3c', 'the sending session gets the not-reachable notice', async () => {
    await arrives(scene.U, alias, 90_000);
    const row = await b1.row(scene.U.session, alias);
    if (row === null || !row.includes('not-reachable')) throw new Error(`U's row: ${row}`);
    return `U was told: ${row.slice(0, 160)}`;
  });
  await report.check('3c', 'the owner reads the position as a tombstone, and S never receives it', async () => {
    if (seq === null) throw new Error('no position');
    const log = await until(async () => {
      const l = await ownerLog(scene);
      return l.find((e) => e.event.writer === writer && e.event.seq === seq) ?? null;
    }, `${writer}:${seq} on the owner's socket`, 60_000);
    if ((log.event as { withheld?: unknown }).withheld !== true || names(log.event, tok)) throw new Error(`stored as ${JSON.stringify(log.event).slice(0, 200)}`);
    await never(scene.S, tok, 30_000);
    if ((await scene.machines.a1.vm.grepHome(tok)).total !== 0) throw new Error('A1’s sminos home holds the token');
    return `{writer, seq, withheld: true} at ${writer}:${seq}; S's transcript and A1's home hold nothing of it`;
  });
  await report.check('3c', 'the archive, B1 archiving, holds it only as its tombstone', async () => {
    const archive = await archiveAfter(scene, before, [tok]);
    const file = `log/${writer.replace('/', '.')}.jsonl`;
    const path = archive.files.find((f) => f.endsWith(`${writer.replace('/', '.')}.jsonl`)) ?? file;
    if (!archive.tombs.some((t) => t.file === path && t.seq === seq)) throw new Error(`no tombstone at ${path}:${seq} (${JSON.stringify(archive.tombs)})`);
    if ((archive.tokens[tok] ?? 0) !== 0) throw new Error('the archive holds the forged text');
    return `main at ${archive.head}: ${path} holds the tombstone at ${seq}, and the text nowhere`;
  });
  await report.check('3c', 'PB’s hand-signed say naming S is refused not-reachable', async () => {
    const r = await probeSay(scene, scene.pb, scene.S, token(scene, 'i3c-pb'));
    if (r.refusal?.reason !== 'not-reachable') throw new Error(`answered ${JSON.stringify(r.refusal)}`);
    return `${r.writer}:${r.seq} refused not-reachable`;
  });
}

/** Item 7: S, private, messaging U outside its audience is refused at its own CLI, and nothing is written. */
export async function item7(scene: ReachScene, report: ReachReport): Promise<void> {
  await ensure(scene, scene.S, 'private');
  const vm = scene.S.machine.vm;
  await report.check('7', 'S’s say to U refused at its CLI, nothing written', async () => {
    const tok = token(scene, 'i7');
    const [files, streams] = [await vm.logFiles(), await vm.json('streams')];
    const r = await sayFrom(scene.S, tok, [scene.U]);
    if (r.rc === 0 || !r.lines.some((l) => l.includes("can't be reached from this session"))) throw new Error(`exited ${r.rc}: ${said(r)}`);
    if (JSON.stringify(await vm.logFiles()) !== JSON.stringify(files) || JSON.stringify(await vm.json('streams')) !== JSON.stringify(streams)) throw new Error('the log or streams.json changed');
    await never(scene.U, tok, 20_000);
    return `refused: ${said(r).slice(0, 160)}; A1's log and streams.json unchanged; U got nothing`;
  });
}

/** Item 1: a person's own sessions message each other across machines, private included. */
export async function item1(scene: ReachScene, report: ReachReport): Promise<void> {
  await ensure(scene, scene.S, 'private');
  const marks = { a1: await scene.machines.a1.vm.laneA.sminos.logMark(), a2: await scene.machines.a2.vm.laneA.sminos.logMark() };
  const both = async (what: string) => {
    for (const [from, to] of [
      [scene.S, scene.T],
      [scene.T, scene.S],
    ] as const) {
      await report.check('1', `${from.label} → ${to.label}, ${what}`, async () => {
        const tok = token(scene, 'i1');
        scene.privateTokens.push(tok);
        const r = await sayFrom(from, tok, [to]);
        if (r.rc !== 0) throw new Error(`exited ${r.rc}: ${said(r)}`);
        if ((await arrives(to, tok)) !== 1) throw new Error('delivered more than once');
        const row = await to.machine.vm.row(to.session, tok);
        if (row === null || !row.includes(from.alias) || !row.includes(scene.a.email)) throw new Error(`the row: ${row?.slice(0, 200)}`);
        return `delivered once, from ${from.alias}, owned by ${scene.a.email}`;
      });
    }
  };
  await both('S private');
  await report.check('1', 'S writes under its stream of the owner alone', async () => {
    const stream = streamOfSession(scene.machines.a1.name, scene.S.session, [scene.a.member]);
    if (!names(await scene.machines.a1.vm.json('streams'), stream.writer)) throw new Error(`A1's streams.json lacks ${stream.writer}`);
    return `A1's streams.json holds ${stream.writer}`;
  });
  await setAccess(scene, scene.T, 'private');
  await both('both private');
  await report.check('1', 'no refused-reach on A1 or A2', async () => {
    for (const [m, mark] of [
      [scene.machines.a1, marks.a1],
      [scene.machines.a2, marks.a2],
    ] as const) {
      const lines = await m.vm.laneA.sminos.logSince(mark);
      if (lines.some((l) => l.includes('refused-reach'))) throw new Error(`${m.scene}: ${lines.find((l) => l.includes('refused-reach'))}`);
    }
    return 'neither daemon.log says refused-reach since the item began';
  });
}

/** Item 5: with T's endpoint unreachable, a message stays owed and is delivered once it answers. */
export async function item5(scene: ReachScene, report: ReachReport): Promise<void> {
  const a2 = scene.machines.a2.vm;
  await report.check('5', 'A2 frozen: the operator’s say to T stays owed, then is delivered once', async () => {
    const tok = token(scene, 'i5');
    await a2.mawsdState('freeze');
    let thawed = false;
    try {
      const r = await a2.operatorSay(tok, tagOf(scene.T));
      if (r.rc !== 0) throw new Error(`the operator's say exited ${r.rc}: ${said(r)}`);
      const owed = await until(async () => {
        const lines = await a2.owed();
        return lines.some((l) => l.trim() !== '' && !/^(nothing|none|no )/i.test(l.trim())) ? lines : null;
      }, 'an owed delivery', 30_000);
      await sleep(25_000);
      if ((await count(scene.T, tok)) !== 0) throw new Error('delivered while A2’s endpoint was frozen');
      await a2.mawsdState('thaw');
      thawed = true;
      if ((await arrives(scene.T, tok, 60_000)) !== 1) throw new Error('delivered more than once');
      return `“${said(r).slice(0, 80)}”; owed (${owed.filter((l) => l.trim()).length} line(s)) across 25 s; delivered once after the thaw`;
    } finally {
      if (!thawed) await a2.mawsdState('thaw').catch(() => {});
    }
  });
  await report.check('5', 'A2 stopped: S’s say to T is delivered once A2 starts again', async () => {
    const tok = token(scene, 'i5-x');
    scene.privateTokens.push(tok);
    await a2.mawsdState('stop');
    try {
      const r = await sayFrom(scene.S, tok, [scene.T]);
      if (r.rc !== 0) throw new Error(`S's say exited ${r.rc}: ${said(r)}`);
      await sleep(20_000);
      if ((await count(scene.T, tok)) !== 0) throw new Error('delivered while A2’s mawsd was down');
    } finally {
      await a2.mawsdState('start');
    }
    if ((await arrives(scene.T, tok, 120_000)) !== 1) throw new Error('delivered more than once');
    return 'nothing while A2 was down; delivered once after it started';
  });
}

/** Item 4: a Can message share opens messaging and nothing view-gated; its removal drops S. */
export async function item4(scene: ReachScene, report: ReachReport): Promise<void> {
  await ensure(scene, scene.S, 'private');
  await shareS(scene, 'list');
  await report.check('4', 'shared as Can message: U sees S, and b1 is listed it with its audience', async () => {
    await until(() => uSees(scene), 'S in U’s list --org', 90_000);
    const listing = (await b1Listings(scene)).find((l) => l.body.session === scene.S.session);
    if (listing === undefined) throw new Error('A1 lists S to b1 not');
    const fields = listing.body.fields as { audience?: string[]; policyRev?: number };
    if (!Array.isArray(fields.audience) || typeof fields.policyRev !== 'number') throw new Error(`the listing's fields: ${JSON.stringify(fields).slice(0, 200)}`);
    return `U's list names S; A1 lists S to b1, audience of ${fields.audience.length}, policyRev ${fields.policyRev}`;
  });
  await report.check('4', 'U messages S, owned by B', async () => {
    const tok = token(scene, 'i4');
    const r = await sayFrom(scene.U, tok, [scene.S]);
    if (r.rc !== 0) throw new Error(`exited ${r.rc}: ${said(r)}`);
    await arrives(scene.S, tok);
    const row = await scene.S.machine.vm.row(scene.S.session, tok);
    if (row === null || !row.includes(scene.b.email)) throw new Error(`the row: ${row?.slice(0, 200)}`);
    return `delivered, owned by ${scene.b.email}`;
  });
  await report.check('4', 'b1’s transcript read is refused', async () => {
    const remote = await b1ToA1(scene);
    try {
      const rows = await remote.call('sminos.rows', { session: scene.S.session, sub: 'none', limit: 5 });
      const sub = `o18-${scene.tag}`;
      await remote.channel.send({ t: 'sub', sub, session: { lane: 'A', id: scene.S.session }, view: 'full', cursor: null, credit: 1 << 20 });
      const answer = await remote.waitFor((m) => m.sub === sub && (m.t === 'ended' || m.t === 'subbed'), 'the answer to the subscription');
      if (rows.ok || answer.t !== 'ended') throw new Error(`sminos.rows ${rows.ok ? 'answered' : rows.code}; the subscription ${answer.t}`);
      return `sminos.rows refused ${rows.code}; the full subscription ended ${String(answer.reason)}`;
    } finally {
      remote.close();
    }
  });
  await report.check('4', 'unshared: S drops out of U’s projection', async () => {
    await shareS(scene, 'none');
    await until(async () => !(await uSees(scene)), 'S gone from U’s list --org', 90_000);
    const r = await scene.U.machine.vm.asSession(scene.U.session, { say: { token: token(scene, 'i4-x'), tags: [{ alias: scene.S.short ?? scene.S.alias }] } });
    if (r.rc === 0 || !r.lines.some((l) => l.includes('no member'))) throw new Error(`U's say was answered ${r.rc}: ${said(r)}`);
    return 'U’s list no longer names S, and @short answers “no member”';
  });
}

/** 3e: a message the hub admitted while the share stood, undelivered when it is removed, is never delivered. */
export async function item3e(scene: ReachScene, report: ReachReport): Promise<void> {
  await ensure(scene, scene.S, 'private');
  const a1 = scene.machines.a1.vm;
  await report.check('3e', 'admitted under the share, A1 stopped, the share removed: never delivered', async () => {
    await shareS(scene, 'list');
    await until(() => uSees(scene), 'S in U’s list --org', 90_000);
    const tok = token(scene, 'i3e');
    const notices = await count(scene.U, 'not-reachable');
    const mark = await a1.laneA.sminos.logMark();
    await a1.mawsdState('stop');
    try {
      const r = await sayFrom(scene.U, tok, [scene.S]);
      if (r.rc !== 0) throw new Error(`U's say exited ${r.rc}: ${said(r)}`);
      const stream = streamWriter(`${scene.machines.b1.name}/${scene.U.session}`, [scene.a.member, scene.b.member]);
      await until(async () => (await ownerLog(scene)).some((e) => e.event.writer === stream && names(e.event, tok)), `${tok} stored under ${stream}`, 60_000);
      await shareS(scene, 'none');
    } finally {
      await a1.mawsdState('start');
    }
    await never(scene.S, tok, 60_000);
    const lines = await a1.laneA.sminos.logSince(mark);
    if (!lines.some((l) => l.includes('refused-reach'))) throw new Error('A1’s daemon.log says no refused-reach');
    if ((await a1.events(tok)).length === 0) throw new Error('A1 never imported the event');
    if ((await count(scene.U, 'not-reachable')) !== notices) throw new Error('U was told of a refusal at the recipient');
    return 'stored by the hub; A1 imported it, said refused-reach, and never delivered it; U was told nothing';
  });
}

/** 3d: a stale say after a share removal is refused at upload, and the archive holds no file of its stream. */
export async function item3d(scene: ReachScene, report: ReachReport): Promise<void> {
  await ensure(scene, scene.S, 'private');
  const b1 = scene.machines.b1.vm;
  await report.check('3d', 'B1 frozen across the removal, then U’s stale say: refused at upload, U told', async () => {
    await shareS(scene, 'view');
    await until(() => uSees(scene), 'S in U’s list --org', 90_000);
    await scene.designate(scene.machines.b1.name);
    const before = await archiveHead(scene);
    const tok = token(scene, 'i3d');
    const notices = await count(scene.U, 'not-reachable');
    const stream = streamWriter(`${scene.machines.b1.name}/${scene.U.session}`, [scene.a.member, scene.b.member]);
    await b1.mawsdState('freeze');
    try {
      await shareS(scene, 'none');
      const r = await sayFrom(scene.U, tok, [scene.S]);
      if (r.rc !== 0) throw new Error(`U's stale say exited ${r.rc}: ${said(r)}`);
    } finally {
      await b1.mawsdState('thaw');
    }
    const seq = await until(async () => {
      const event = (await b1.events(tok)).find((e) => e.writer === stream);
      return event?.seq !== undefined && withheldHolds(uplinkWithheld(await b1.json('uplink')), stream, event.seq) ? event.seq : null;
    }, `${tok} withheld under ${stream}`, 120_000);
    await until(async () => (await count(scene.U, 'not-reachable')) > notices || null, 'the notice in U’s transcript', 60_000);
    await never(scene.S, tok, 60_000);
    const stored = (await ownerLog(scene)).find((e) => e.event.writer === stream && e.event.seq === seq);
    if ((stored?.event as { withheld?: unknown } | undefined)?.withheld !== true) throw new Error(`the owner reads ${stream}:${seq} as ${JSON.stringify(stored?.event).slice(0, 160)}`);
    const archive = await archiveAfter(scene, before, [tok]);
    if (archive.files.some((f) => f.includes('~')) || (archive.tokens[tok] ?? 0) !== 0) throw new Error('the archive holds the stream');
    return `${stream}:${seq} refused and kept as a tombstone; U told; S never got it; the archive (main at ${archive.head}) holds no file of the stream`;
  });
}

/** 6b and 6c: PA, the owner's machine with no `audience`: an old endpoint refused upstream, an old reader filtered. */
export async function item6b(scene: ReachScene, report: ReachReport): Promise<void> {
  await ensure(scene, scene.S, 'private');
  await report.check('6b', 'an old endpoint’s say to S refused not-reachable, its position a tombstone', async () => {
    const r = await probeSay(scene, scene.pa, scene.S, token(scene, 'i6b'));
    if (r.refusal?.reason !== 'not-reachable' || r.refusal.message !== undefined) throw new Error(`answered ${JSON.stringify(r.refusal)}`);
    const stored = await until(async () => (await ownerLog(scene)).find((e) => e.event.writer === r.writer && e.event.seq === r.seq) ?? null, `${r.writer}:1 on the owner's socket`, 60_000);
    if ((stored.event as { withheld?: unknown }).withheld !== true) throw new Error(`stored as ${JSON.stringify(stored.event).slice(0, 160)}`);
    return `${r.writer}:1 refused not-reachable with no message, read as a tombstone`;
  });
}

export async function item6c(scene: ReachScene, report: ReachReport): Promise<void> {
  await ensure(scene, scene.S, 'private');
  await report.check('6c', 'an old reader, the owner’s own: no stream of S in its have, its backlog or by name', async () => {
    const hello = await probeHello(scene, scene.pa);
    const streams = [...streamsOf(hello.have, scene.S.session), ...streamsOf(hello.backlog.map((e) => e.writer), scene.S.session)];
    if (streams.length) throw new Error(`PA was given ${streams.join(', ')}`);
    const stream = streamOfSession(scene.machines.a1.name, scene.S.session, [scene.a.member]).writer;
    const page = await probeGet<HistoryLogPage>(scene, scene.pa, historyLogPath(scene.project.id, stream, 0));
    if ((page.body?.events?.length ?? 0) !== 0) throw new Error(`the history route served ${page.body!.events.length} event(s)`);
    return `${hello.have.length} writer(s) in its have, ${hello.backlog.length} event(s) in its backlog, none of S's streams; ${stream} by name: nothing`;
  });
}

/** 6d: a device's human with no audience (an unchanged browser): refused toward private S, admitted toward listed T. */
export async function item6d(scene: ReachScene, report: ReachReport): Promise<void> {
  await ensure(scene, scene.S, 'private');
  await ensure(scene, scene.T, 'listed');
  const human = async (to: ReachSession, tok: string) => {
    const socket = await ProjectSocket.open(scene.hub, scene.person.headers, scene.project.id, 15_000);
    try {
      const draft: Omit<DeviceHuman, 'sig'> = { kind: 'human', from: 'human', member: scene.a.member, to: [{ session: to.session, alias: to.alias }], text: `o18 m6 acceptance ${tok}`, created: new Date().toISOString(), nonce: randomBytes(16).toString('base64url') };
      const event = await signEvent({ org: scene.org, project: scene.project.id }, draft, scene.a.device.channel.privateKey, scene.a.device.channel.pub);
      return (await socket.say(event as DeviceHuman)) as { t: string; refusal?: { reason: string } };
    } finally {
      socket.close();
    }
  };
  await report.check('6d', 'toward S, private: refused not-reachable, stored nowhere', async () => {
    const tok = token(scene, 'i6d-s');
    const answer = await human(scene.S, tok);
    if (answer.t !== 'refused' || answer.refusal?.reason !== 'not-reachable') throw new Error(`answered ${JSON.stringify(answer)}`);
    await never(scene.S, tok, 30_000);
    return 'refused not-reachable, no human-ack, nothing in S’s transcript';
  });
  await report.check('6d', 'toward T, listed: admitted and delivered', async () => {
    const tok = token(scene, 'i6d-t');
    const answer = await human(scene.T, tok);
    if (answer.t !== 'human-ack') throw new Error(`answered ${JSON.stringify(answer)}`);
    await arrives(scene.T, tok);
    return 'human-ack, delivered into T';
  });
}

/** 6e: an owner's machine on the old sminos, designated archiver: its endpoint withholds the stream, its archive holds none. */
export async function item6e(scene: ReachScene, report: ReachReport): Promise<void> {
  await ensure(scene, scene.S, 'private');
  const tok = token(scene, 'i6e');
  scene.privateTokens.push(tok);
  const r = await sayFrom(scene.T, tok, [scene.S]);
  if (r.rc !== 0) throw new Error(`T's say to S exited ${r.rc}: ${said(r)}`);
  const a3 = await scene.bringA3();
  const before = await archiveHead(scene);
  await scene.designate(a3.machine.name);
  await report.check('6e', 'A3’s endpoint took S’s private snapshot and withheld the stream from its sminos', async () => {
    const cache = await until(async () => {
      const c = await a3.machine.vm.json('policy-cache');
      const entry = (c?.sessions as Record<string, { audience?: unknown }> | undefined)?.[scene.S.session];
      return Array.isArray(entry?.audience) ? entry : null;
    }, 'S’s private snapshot in A3’s policy cache', 180_000, 5000);
    const files = (await a3.machine.vm.logFiles()).map((f) => f.name).filter((f) => f.includes('~'));
    if (files.length) throw new Error(`A3's log holds ${files.join(', ')}`);
    return `A3's cache holds S at an audience of ${(cache.audience as string[]).length}; its log holds no stream file`;
  });
  await report.check('6e', 'the archive A3 writes holds no stream and none of the private tokens', async () => {
    const archive = await archiveAfter(scene, before, scene.privateTokens, 360_000);
    const streams = archive.files.filter((f) => f.includes('~'));
    const leaked = Object.entries(archive.tokens).filter(([, n]) => n > 0);
    if (streams.length || leaked.length) throw new Error(`the archive holds ${[...streams, ...leaked.map(([t]) => t)].join(', ')}`);
    return `main at ${archive.head}, A3 archiving: no stream file, none of ${scene.privateTokens.length} private token(s)`;
  });
}

const RUNS: Record<ReachItem, (scene: ReachScene, report: ReachReport) => Promise<void>> = {
  '2': item2,
  '8': item8,
  '3a': item3a,
  '3b': item3b,
  '3c': item3c,
  '7': item7,
  '1': item1,
  '5': item5,
  '4': item4,
  '3e': item3e,
  '3d': item3d,
  '6b': item6b,
  '6c': item6c,
  '6d': item6d,
  '6e': item6e,
};

/** What the items report to: ItemReport's checks and notes. */
export type ReachReport = Pick<ItemReport, 'check' | 'add' | 'bySuites'>;

/** The preflight, then `items` in the run's order; an item that throws outside its checks fails, named. */
export async function runReachItems(scene: ReachScene, report: ReachReport, items: readonly ReachItem[]): Promise<void> {
  scene.log('-- the scene');
  await preflight(scene, report);
  for (const item of REACH_ITEMS) {
    if (!items.includes(item)) continue;
    scene.log(`-- item ${item}`);
    try {
      await RUNS[item](scene, report);
    } catch (error) {
      if (scene.cleanup.signal.aborted) throw error;
      report.add(item, 'fail', 'the item', error instanceof Error ? error.message : String(error));
    }
  }
}
