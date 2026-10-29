// The items the endpoint acceptance run checks (P5 O10 M11; docs/doperpowers/plans/2026-10-27-p5-o10-endpoint.md,
// Acceptance 2-5, 8 and 9), each against a scene (`Scene`, endpoint-acceptance.ts builds it): a real `mawsd` with its
// endpoint enrolled and listed on the hub, a lane A session under the sminos beside it, and the test device as the
// owner's, reaching the machine over RL1's multiplex through the hub and over the direct listener. Every check is one
// report line; what an item changes (the policy, a device it adds) is undone before it ends, and registered on the
// run's cleanup in case it never gets there.
//
// What the run cannot show on a machine with no app (lane B's live half, O3), what is another child's (O12's phase 2,
// O14's cutover for item 7), and what only the suites can show (a kill between an fsync and its answer) are named under
// the item, never counted as shown.
import { randomBytes } from 'node:crypto';
import { canonicalize, endorseDevice, generateSigningKey, keyId, OP_HORIZON_S, signEvent, verifyEvent, verifyListing, type Action, type ByteDuplex, type Certificates, type KeyHolder, type Listing, type LogEventV2, type OrgState, type RevokedKey, type Signed, type SignedOrgState } from 'org-protocol';
import { ProjectSocket, type DeviceHuman } from 'org-protocol/test-support';
import type { Person } from './hub';
import type { EndpointMachine } from './endpoint-machine';
import { DirectPacer, dialDirect, openRemote, Remote, testDevice, throughTamper, upgradeStatus, type RelayDialer, type RunDevice } from './endpoint-remote';
import { laneAProblems, resumeCursor, type ItemReport, type Segment } from './endpoint-verdicts';
import type { Cleanup } from './proof';

export const ITEMS = ['2', '3', '4', '5', '8', '9'] as const;
export type Item = (typeof ITEMS)[number];

/** The words every event the run posts to a project log carries, so the owner can tell its residue from anything else. */
export const EVENT_MARK = 'o10 m11 acceptance';

/**
 * The run's writes to the hub's stored data (a device's signed `human` in a project's log), each admitted before it is
 * posted: in the run's project alone, marked `EVENT_MARK`, and in production at most `limit` (the owner's allowance), an
 * event refused or lost counting as well, since it may have been stored. What was posted is kept as the run's residue:
 * a project's log is never pruned.
 */
export class HubWrites {
  readonly #events: string[] = [];
  #admitted = 0;
  private constructor(
    readonly project: string,
    readonly limit: number | null,
  ) {}

  static production(project: string, limit = 5): HubWrites {
    return new HubWrites(project, limit);
  }

  static staging(project: string): HubWrites {
    return new HubWrites(project, null);
  }

  /** Throws unless an event of `text` may go to `project`; counts it when it may. */
  admit(project: string, text: string): void {
    if (project !== this.project) throw new Error(`the run writes events only in the machine’s project ${this.project}, not ${project}`);
    if (!text.startsWith(`${EVENT_MARK} `)) throw new Error(`an event the run writes is marked \`${EVENT_MARK}\``);
    if (this.limit !== null && this.#admitted >= this.limit) throw new Error(`the run writes at most ${this.limit} events to this hub`);
    this.#admitted++;
  }

  /** The hub's answer to one the run posted. */
  posted(project: string, answer: { t?: string; writer?: unknown; seq?: unknown }): void {
    if (project === this.project && answer.t === 'human-ack') this.#events.push(`${String(answer.writer)}:${String(answer.seq)}`);
  }

  kept(): string[] {
    return [`the project ${this.project} on the hub, and in it the run’s events ${this.#events.length ? this.#events.join(', ') : '(none acknowledged)'}`];
  }
}

/** An event of a project's log as the hub serves it: its offset and the event (its writer and seq). */
export type LoggedEvent = { offset: number; event: { writer: string; seq: number } & Record<string, unknown> };

/** The machine's own events this run's sessions wrote: those of the writers `<machine>/<session>` of the run's approved
 * sessions alone (lane A's, the local spawn's seat), after `since`, the offset the project's log stood at before lane A
 * started; the history before it, and any other session of the machine's, are never the run's. */
export function runOwnEvents<E extends LoggedEvent>(log: readonly E[], since: number, machine: string, sessions: readonly string[]): E[] {
  const writers = new Set(sessions.map((session) => `${machine}/${session}`));
  return log.filter((e) => e.offset > since && writers.has(e.event.writer));
}

/** The seat's session as `sminos spawn` prints it (`seat spawned: <group>/<alias>  [<short> / <session>] …`), or null. */
export function seatSession(lines: readonly string[]): string | null {
  for (const line of [...lines].reverse()) {
    const m = /^seat [a-z-]+: .*\[[0-9a-z]+ \/ ([0-9a-f-]{36})\]/.exec(line);
    if (m) return m[1];
  }
  return null;
}

/** The residue line for the machine's own events the run's sessions wrote, by writer, apart from `HubWrites`' budget. */
export function sessionResidue(project: string, since: number, events: readonly LoggedEvent[]): string {
  const by = new Map<string, number[]>();
  for (const { offset, event } of events) by.set(event.writer, [...(by.get(event.writer) ?? []), offset]);
  const writers = [...by].map(([writer, offsets]) => `${writer} ${offsets.length} (${offsets.length === 1 ? `offset ${offsets[0]}` : `offsets ${Math.min(...offsets)}–${Math.max(...offsets)}`})`);
  return `the machine’s own events in the project ${project} after offset ${since}, written by the run’s sessions (lane A, the spawn): ${writers.length ? writers.join(', ') : 'none'}`;
}

/** The lane A session the run watches, as its sminos reported it. */
export type LaneA = { session: string; launch: string; alias: string; project: string; checkout: string };

/** What the items run against (endpoint-acceptance.ts builds it). */
export type Scene = {
  target: 'staging' | 'local' | 'production';
  hub: string;
  org: string;
  person: Person;
  machine: EndpointMachine;
  name: string;
  ref: string;
  /** The org's states as the run holds them, the head last. */
  chain(): SignedOrgState[];
  /** The owner's device: a machine owner, an admin's (staging's admin device; production's device paired for the run). */
  owner: RunDevice;
  /** Signs the head's successor as the admin, posts it and adds it to the chain; null where the run holds no admin key
   * (production: the owner signs there, by hand). */
  amend: ((what: string, edit: (s: OrgState) => void | boolean) => Promise<SignedOrgState | null>) | null;
  /** The successor signed but not posted (for a delivery over a channel), and its posting after. */
  sign: ((edit: (s: OrgState) => void) => Promise<SignedOrgState>) | null;
  post: ((state: SignedOrgState) => Promise<void>) | null;
  /** A second member who holds nothing on the machine, and their device; null in production. */
  other: RunDevice | null;
  laneA: LaneA;
  relay: RelayDialer;
  pacer: DirectPacer;
  /** `staging-run.sh deploy` (then the item's forced cut); null where the run deploys nothing. */
  hubDeploy: (() => Promise<void>) | null;
  /** A step the owner takes by hand (production): printed, then waited for until `done`. */
  ownerStep: ((what: string, done: () => Promise<boolean>) => Promise<void>) | null;
  cleanup: Cleanup;
  log(line: string): void;
  /** The run's tag, in every name and marker it makes. */
  tag: string;
  /** What the run made that the read-back after its cleanup looks for: every device id it added. */
  made: { devices: string[] };
  /** The run's writes to the hub's stored data, each admitted by it (production's allowance enforced there). */
  hubWrites: HubWrites;
  /** The offset the lane A project's log stood at before lane A started: the run's own events come after it. */
  logFrom: number;
  /** The sessions the run started on the machine, its only writers there: lane A's, then the local spawn's seat. */
  sessions: string[];
};

const NO_CERTS: Certificates = { certs: [], retirements: [] };
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function until<T>(probe: () => T | null | undefined | false | Promise<T | null | undefined | false>, what: string, ms: number, every = 500): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await probe();
    if (value !== null && value !== undefined && value !== false) return value;
    if (Date.now() > deadline) throw new Error(`no ${what} within ${ms / 1000} s`);
    await sleep(every);
  }
}

// ---- the scene's means -----------------------------------------------------------------------------------------------

/** A carrier of the scene's: through the hub, or straight to the listener (paced under its per-source limit). */
function dialer(scene: Scene, carrier: 'relayed' | 'direct'): () => Promise<ByteDuplex> {
  if (carrier === 'relayed') return () => scene.relay.dial();
  return async () => {
    await scene.pacer.take();
    return dialDirect(scene.machine.directUrl);
  };
}

/** A device of the scene's over a carrier, its channel open and `caps` in. */
function open(scene: Scene, who: RunDevice, carrier: 'relayed' | 'direct', options: { dial?: () => Promise<ByteDuplex>; now?: () => Date } = {}): Promise<Remote> {
  return openRemote(testDevice(scene.org, who, scene.chain(), { now: options.now }), scene.ref, options.dial ?? dialer(scene, carrier));
}

/** Whether a device's channel open is refused (it rejects), and the endpoint's word for it from its log. */
async function refusedOpen(scene: Scene, who: RunDevice, carrier: 'relayed' | 'direct', reason: string, options: { clientClass?: RunDevice['clientClass'] } = {}): Promise<string> {
  const mark = await scene.machine.logMark();
  const device = testDevice(scene.org, { ...who, clientClass: options.clientClass ?? who.clientClass }, scene.chain());
  const opened = await device.open(dialer(scene, carrier), scene.ref, { timeoutMs: 15_000 }).then(
    (channel) => {
      channel.close('done');
      return true;
    },
    () => false,
  );
  if (opened) throw new Error(`the endpoint admitted ${who.id}`);
  const line = `endpoint: a ${carrier} channel was refused: ${reason}`;
  await until(async () => (await scene.machine.logSince(mark)).some((l) => l.includes(line)), `the endpoint's log line "${line}"`, 20_000, 1000);
  return `refused, and the endpoint logged "${reason}"`;
}

/** A fresh device of `member`'s, not yet in any state. */
async function freshDevice(member: string, id: string): Promise<RunDevice> {
  return { member, id, clientClass: 'native-mac', channel: await generateSigningKey(), stepUp: await generateSigningKey() };
}

/** A device's keys as a state's `revoked` (RL DL 24) or `retired` entries name them. */
async function heldKeys(device: RunDevice): Promise<Array<{ keyId: string; pub: string; holder: KeyHolder }>> {
  const keys: Array<['channel' | 'step-up', string]> = [['channel', device.channel.pub], ...(device.stepUp ? [['step-up', device.stepUp.pub] as ['step-up', string]] : [])];
  return Promise.all(keys.map(async ([key, pub]) => ({ keyId: await keyId(pub), pub, holder: { member: device.member, device: device.id, class: device.clientClass, key } })));
}

const revokedEntries = (keys: Awaited<ReturnType<typeof heldKeys>>): RevokedKey[] => keys.map(({ keyId, holder }) => ({ keyId, holder }));

const entry = (d: RunDevice) => ({ id: d.id, class: d.clientClass, keyStorage: 'software' as const, channelPub: d.channel.pub, ...(d.stepUp ? { stepUpPub: d.stepUp.pub } : {}) });

/**
 * A device of `member`'s added in a successor for this item, its removal registered on the cleanup (revoked, so its
 * keys verify nothing after the run). `endorse` signs the entry by an existing device of the member's, as a member's
 * second device must be.
 */
async function addDevice(scene: Scene, member: string, prefix: string, endorse: (d: ReturnType<typeof entry>) => Promise<Record<string, unknown>>): Promise<RunDevice> {
  if (scene.amend === null) throw new Error('no admin key in this run');
  const device = await freshDevice(member, `o10-${prefix}-${scene.tag}`);
  scene.made.devices.push(device.id);
  // Against the head as the hub serves it then (amend reads it afresh); a failure is the cleanup's to report.
  scene.cleanup.add(`revoke ${device.id}`, async () => void (await removeDevice(scene, device, 'revoked')));
  const signed = { ...entry(device), ...(await endorse(entry(device))) };
  await scene.amend(`${device.id} added`, (s) => void s.members.find((m) => m.id === member)!.devices.push(signed as never));
  return device;
}

/** The successor that takes `device` out: revoked (its keys never verify again), or retired as an honest departure. */
async function removeDevice(scene: Scene, device: RunDevice, how: 'revoked' | 'retired'): Promise<SignedOrgState | null> {
  if (scene.amend === null) throw new Error('no admin key in this run');
  const keys = await heldKeys(device);
  // Nothing posted when the head the hub serves no longer lists it (amend's edit runs on that head).
  return scene.amend(`${device.id} ${how}`, (s) => {
    const m = s.members.find((x) => x.id === device.member);
    if (m === undefined || !m.devices.some((d) => d.id === device.id)) return false;
    m.devices = m.devices.filter((d) => d.id !== device.id);
    if (how === 'revoked') s.revoked.push(...revokedEntries(keys));
    else s.retired.push(...keys.map((k) => ({ ...k, notAfter: s.issued })));
  });
}

/** A lane A action on the run's session, by `remote`'s device. */
function laneAAction(scene: Scene, remote: Remote, rpc: string, args: Record<string, unknown>, fields: Partial<Action> = {}): Action {
  const { session, launch } = scene.laneA;
  return remote.device.action({ machine: scene.ref, action: `sminos.${rpc}`, session, context: { lane: 'A', session, launch }, args: { session, ...args }, ...fields });
}

/** A `sminos.send` of `text` to the run's session. */
const send = (scene: Scene, remote: Remote, text: string, fields: Partial<Action> = {}) => laneAAction(scene, remote, 'send', { text }, fields);

/** A text no other of the run's holds, ending in its token, for counting a send's or words' arrival in the transcript. */
const marker = (scene: Scene, what: string) => `o10-m11 ${what} ${scene.tag}-${randomBytes(5).toString('hex')}`;
/** A person's words for the session: `marker`'s, under the run's event mark. */
const words = (scene: Scene, what: string) => `${EVENT_MARK} ${what} ${scene.tag}-${randomBytes(5).toString('hex')}`;
const tokenOf = (text: string) => text.slice(text.lastIndexOf(' ') + 1);

/** How many times `text` reached the session, now. */
const arrivals = (scene: Scene, text: string) => scene.machine.laneA.count(scene.laneA.session, tokenOf(text));

/** How many times `text` reached the session, waited out for `settleMs` so a late copy would show. */
async function effects(scene: Scene, text: string, settleMs = 8000): Promise<number> {
  await sleep(settleMs);
  return arrivals(scene, text);
}

// ---- 9: either carrier -----------------------------------------------------------------------------------------------

export async function item9(scene: Scene, report: ItemReport): Promise<void> {
  const other = scene.other;
  for (const carrier of ['relayed', 'direct'] as const) {
    await report.check('9', `the handshake and caps over the ${carrier} carrier`, async () => {
      const mine = await open(scene, scene.owner, carrier);
      const caps = mine.inbox.find((m) => m.t === 'caps')!;
      mine.close();
      const grades = (caps.machine as { grades?: string[] }).grades ?? [];
      if (caps.member !== scene.owner.member || !['spawn', 'shell', 'machine-admin'].every((g) => grades.includes(g))) throw new Error(`the owner's caps: ${JSON.stringify(caps)}`);
      if (other === null) return `the owner's device admitted, caps with ${grades.join(', ')}`;
      const theirs = await open(scene, other, carrier);
      const theirCaps = theirs.inbox.find((m) => m.t === 'caps')!;
      theirs.close();
      if ((theirCaps.machine as { grades?: string[] }).grades?.length !== 0) throw new Error(`a member who owns nothing was given ${JSON.stringify(theirCaps.machine)}`);
      return `the owner's caps carry ${grades.join(', ')}; a member who owns nothing gets none`;
    });
    await report.check('9', `an unknown device refused over the ${carrier} carrier`, async () => refusedOpen(scene, await freshDevice(scene.owner.member, `o10-ghost-${scene.tag}`), carrier, 'unknown-device'));
    await report.check('9', `a device claiming another class refused over the ${carrier} carrier`, async () => {
      if (other === null) return { skip: 'no second member in this run' };
      return refusedOpen(scene, other, carrier, 'class', { clientClass: 'web-cards' });
    });
    await report.check('9', `an altered frame closes the channel over the ${carrier} carrier`, async () => {
      let relay: ReturnType<typeof throughTamper>['relay'] | undefined;
      const inner = dialer(scene, carrier);
      const r = await open(scene, scene.owner, carrier, {
        dial: async () => {
          const spliced = throughTamper(await inner());
          relay = spliced.relay;
          return spliced.device;
        },
      });
      relay!.tamper('to-endpoint', { flip: -1 });
      await r.channel.send({ t: 'ping', at: Date.now() });
      const reason = await Promise.race([r.closed, sleep(20_000).then(() => 'still open')]);
      if (reason !== 'tag') throw new Error(`the channel ${reason === 'still open' ? 'stayed open' : `closed ${reason}`}, not tag`);
      return 'closed `tag`, the ping unanswered';
    });
  }
  if (scene.amend !== null && other !== null) {
    await report.check('9', 'a revoked device refused, and one a new state removes closed `removed`, over both carriers', async () => {
      const lost = await addDevice(scene, other.member, 'r', (d) => endorseBy(scene, other, d));
      await removeDevice(scene, lost, 'revoked');
      await waitForHead(scene);
      const said: string[] = [];
      for (const carrier of ['relayed', 'direct'] as const) said.push(`${carrier}: ${await refusedOpen(scene, lost, carrier, 'revoked')}`);
      for (const carrier of ['relayed', 'direct'] as const) {
        const leaving = await addDevice(scene, other.member, `x${carrier[0]}`, (d) => endorseBy(scene, other, d));
        await waitForHead(scene);
        const r = await open(scene, leaving, carrier);
        await removeDevice(scene, leaving, 'retired');
        const reason = await Promise.race([r.closed, sleep(30_000).then(() => 'still open')]);
        if (reason !== 'removed') throw new Error(`over ${carrier}, a removed device's channel ${reason === 'still open' ? 'stayed open' : `closed ${reason}`}`);
        said.push(`${carrier}: closed removed`);
      }
      return said.join('; ');
    });
  } else report.add('9', 'skip', 'a revoked device refused, and one a new state removes closed', 'no admin key in this run');

  await report.check('9', 'the direct listener binds only the tailnet’s addresses', async () => {
    const bound = await scene.machine.listening();
    if (bound.length === 0) throw new Error('nothing listens on the scratch port');
    const wrong = bound.filter((a) => !isTailnet(a));
    if (wrong.length) throw new Error(`bound to ${wrong.join(', ')}`);
    return `bound to ${bound.join(', ')}`;
  });
  await report.check('9', 'a call before the handshake verifies closes the connection', async () => {
    await scene.pacer.take();
    const inner = await dialDirect(scene.machine.directUrl);
    let sent = 0;
    const closed = new Promise<string>((resolve) => inner.onClose?.((reason) => resolve(reason)));
    const swapped: ByteDuplex = {
      send: (bytes) => (++sent === 1 ? inner.send(bytes) : inner.send(new TextEncoder().encode(JSON.stringify({ t: 'call', id: '1', name: 'daemon.status', input: {} })))),
      onBytes: (l) => inner.onBytes(l),
      onClose: (l) => inner.onClose?.(l),
      close: (r) => inner.close(r),
    };
    const device = testDevice(scene.org, scene.owner, scene.chain());
    const opening = device.open(() => Promise.resolve(swapped), scene.ref, { timeoutMs: 15_000 }).then(
      () => 'opened',
      () => 'refused',
    );
    const reason = await Promise.race([closed, sleep(15_000).then(() => null)]);
    if (reason === null) throw new Error('the connection stayed open after a pre-handshake call');
    if ((await opening) === 'opened') throw new Error('the channel opened');
    return `closed (${reason}) in place of h3's answer`;
  });
  await report.check('9', 'handshakes past the per-source limit answered `busy`', async () => {
    await scene.pacer.full();
    const answers: number[] = [];
    let busy = '';
    for (let i = 0; i < 4; i++) {
      const { status, body } = await upgradeStatus(scene.machine.directUrl);
      answers.push(status);
      if (status === 503) busy = body;
    }
    scene.pacer.drain();
    if (answers.slice(0, 3).some((s) => s !== 101) || answers[3] !== 503 || !busy.includes('busy')) throw new Error(`the upgrades were answered ${answers.join(', ')}${busy ? ` (${busy})` : ''}`);
    return `answered ${answers.join(', ')}, the fourth ${busy}`;
  });
  report.bySuites('9', 'test/endpoint/channel-suite.ts runs its cases unchanged over both carriers; the h3 page cap, the two-page catch-up and the overall rate limit are the suites’ (test/endpoint/direct-listener.test.ts)');
}

const isTailnet = (address: string) => {
  const host = address.replace(/^\[/, '').replace(/\]?:\d+$/, '').replace(/%.*$/, '');
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d+\.\d+$/.test(host)) return true;
  return /^fd7a:115c:a1e0:/i.test(host);
};

/** The endorsement of `d` by `by`'s step-up key, as a member's second device carries it. */
async function endorseBy(scene: Scene, by: RunDevice, d: ReturnType<typeof entry>): Promise<Record<string, unknown>> {
  return { endorsement: await endorseDevice(scene.org, by.member, d, by.stepUp!.privateKey, by.stepUp!.pub) };
}

/** Waits until the endpoint holds the run's head (it learns it from the hub's notice). */
async function waitForHead(scene: Scene): Promise<void> {
  const version = scene.chain().at(-1)!.state.version;
  await until(async () => ((await scene.machine.status()).stateVersion ?? 0) >= version, `the endpoint at version ${version}`, 60_000, 1500);
}

// ---- 8: namespace grades ---------------------------------------------------------------------------------------------

export async function item8(scene: Scene, report: ItemReport): Promise<void> {
  const other = scene.other;
  const mine = await open(scene, scene.owner, 'relayed');
  const theirs = other === null ? null : await open(scene, other, 'relayed');
  try {
    const refusedAs = async (r: Remote, action: Action, want: string) => {
      const said = await r.act(action);
      if (said !== want) throw new Error(`${action.action} was answered ${said}, not ${want}`);
      return `${action.action}: ${said}`;
    };
    const digest = { session: scene.laneA.session, request: `o10-${scene.tag}-none`, tool: 'Bash', input_sha256: '0'.repeat(64) };
    if (theirs !== null) {
      await report.check('8', 'a `view` read on a session the member holds nothing on', async () => {
        const answer = await theirs.call('sminos.rows', { session: scene.laneA.session, sub: 'none', limit: 5 });
        if (answer.ok || answer.code !== 'grade') throw new Error(`sminos.rows was answered ${answer.ok ? 'ok' : answer.code}`);
        const sub = `v-${scene.tag}`;
        await theirs.channel.send({ t: 'sub', sub, session: { lane: 'A', id: scene.laneA.session }, view: 'full', cursor: null, credit: 1 << 20 });
        const ended = await theirs.waitFor((m) => m.sub === sub && (m.t === 'ended' || m.t === 'subbed'), 'the answer to the subscription');
        if (ended.t !== 'ended') throw new Error('a member who holds nothing was subscribed');
        return `sminos.rows refused grade; the subscription ended ${String(ended.reason)}`;
      });
      await report.check('8', 'a `converse`, an `approve` and a `manage` act refused below their grades', async () => {
        const said = [
          await refusedAs(theirs, send(scene, theirs, marker(scene, 'grade')), 'grade'),
          await refusedAs(theirs, laneAAction(scene, theirs, 'decide', { digest, decision: 'allow' }, { requestDigest: digest }), 'grade'),
          await refusedAs(theirs, laneAAction(scene, theirs, 'compact', {}), 'grade'),
        ];
        return said.join('; ');
      });
      await report.check('8', 'a spawn by a member without the machine’s `spawn` right', async () => refusedAs(theirs, theirs.device.action({ machine: scene.ref, action: 'sminos.spawn', args: { checkout: scene.laneA.checkout, brief: 'o10-m11: refused' } }), 'grade'));
      await report.check('8', 'the machine’s content-free reads, for any member', async () => {
        const status = await theirs.call('daemon.status', null);
        const listings = await theirs.call('endpoint.listings', {});
        if (!status.ok || !listings.ok) throw new Error(`daemon.status ${status.ok ? 'ok' : status.code}, endpoint.listings ${listings.ok ? 'ok' : listings.code}`);
        return 'daemon.status and endpoint.listings answered';
      });
    } else for (const check of ['a `view` read on a session the member holds nothing on', 'acts refused below their grades', 'the machine’s reads for any member']) report.add('8', 'skip', check, 'no second member in this run');
    await report.check('8', 'an owner’s spawn needs step-up', async () => {
      // The endpoint knows a checkout only from sminos's `machine` presence, which may come a while after lane A
      // starts, and the checkout is judged before presence: a spawn refused `unknown-checkout` (before anything runs) is
      // asked again, up to 60 s, and then fails with what the endpoint logged of presences and checkouts.
      const mark = await scene.machine.logMark();
      const deadline = Date.now() + 60_000;
      for (;;) {
        const said = await mine.act(mine.device.action({ machine: scene.ref, action: 'sminos.spawn', args: { checkout: scene.laneA.checkout, brief: 'o10-m11: refused' } }));
        if (said === 'step-up') return 'sminos.spawn: step-up';
        if (said !== 'unknown-checkout' || Date.now() > deadline) {
          const seen = said === 'unknown-checkout' ? (await scene.machine.logSince(mark)).filter((l) => /presence|checkout/i.test(l)).slice(-3) : [];
          throw new Error(`sminos.spawn was answered ${said}, not step-up${said === 'unknown-checkout' ? `: the checkout ${scene.laneA.checkout} still unknown after 60 s (the endpoint logged ${seen.join(' / ') || 'nothing of presences or checkouts'})` : ''}`);
        }
        await sleep(5000);
      }
    });
    await report.check('8', 'what production’s offer table doesn’t offer is refused `not-offered`, the owner’s too', async () => {
      const said: string[] = [];
      said.push(await refusedAs(mine, mine.device.action({ machine: scene.ref, action: 'pty.spawn', args: {} }), 'not-offered'));
      for (const name of ['settings.get', 'files.read', 'host.op']) {
        const answer = await mine.call(name, {});
        if (answer.ok || answer.code !== 'not-offered') throw new Error(`${name} was answered ${answer.ok ? 'ok' : answer.code}`);
        said.push(`${name}: not-offered`);
      }
      return said.join('; ');
    });
  } finally {
    mine.close();
    theirs?.close();
  }
  report.bySuites('8', 'test/endpoint/grades.test.ts sends one command of each grade class through a real channel over a fixture offer table, an `ungraded` namespace, the routing classes, a machine owner’s `pty.spawn` with no step-up and a shell-grant holder’s with one; the same-uid app never reaches the endpoint');
}

// ---- 3: the trust cases ----------------------------------------------------------------------------------------------

/**
 * A relay of the run's own between the device and a carrier that holds every byte the device sends while `hold` is
 * on and lets them go in order after, as a hostile relay delays a frame without breaking the sequence behind it.
 */
function gated(inner: ByteDuplex): { device: ByteDuplex; hold(on: boolean): void } {
  let holding = false;
  const held: Uint8Array[] = [];
  return {
    device: { send: (b) => (holding ? void held.push(Uint8Array.from(b)) : inner.send(b)), onBytes: (l) => inner.onBytes(l), onClose: (l) => inner.onClose?.(l), close: (r) => inner.close(r) },
    hold(on) {
      holding = on;
      if (!on) for (const b of held.splice(0)) inner.send(b);
    },
  };
}

/** A relay of the run's own that keeps the last frame the device sent, to send it again on the run's word. */
function replaying(inner: ByteDuplex): { device: ByteDuplex; replayLast(): void } {
  let last: Uint8Array | null = null;
  return {
    device: {
      send: (b) => {
        last = Uint8Array.from(b);
        inner.send(b);
      },
      onBytes: (l) => inner.onBytes(l),
      onClose: (l) => inner.onClose?.(l),
      close: (r) => inner.close(r),
    },
    replayLast() {
      if (last !== null) inner.send(last);
    },
  };
}

/**
 * Whether the late original was answered as a tombstoned op: sminos refuses it `tombstoned` before its ledger
 * (sminos_rpc.py, `refuse_loose`), as DX6's failed outcome, which the endpoint passes on as `{state: 'failed', error:
 * {code: 'tombstoned'}}`; `{state: 'refused', reason: 'tombstoned'}` is the same refusal in RL4's words.
 */
export function isTombstoned(answer: { t: unknown; outcome?: unknown }): boolean {
  if (answer.t !== 'done') return false;
  const o = answer.outcome as { state?: unknown; reason?: unknown; error?: { code?: unknown } } | undefined;
  return (o?.state === 'failed' && o.error?.code === 'tombstoned') || (o?.state === 'refused' && o.reason === 'tombstoned');
}

export async function item3(scene: Scene, report: ItemReport): Promise<void> {
  await report.check('3', 'an action frame the relay replays closes the channel, and the action runs once', async () => {
    // The relay lets the original through and sends its bytes again once it was acknowledged: a frame repeated at
    // once is closed on before the original is handed on (the endpoint runs nothing for a channel that closed), which
    // shows only the close; a replay after the original ran shows both halves.
    let relay: ReturnType<typeof replaying> | undefined;
    const r = await open(scene, scene.owner, 'relayed', {
      dial: async () => (relay = replaying(await scene.relay.dial())).device,
    });
    const text = marker(scene, 'replayed');
    const action = send(scene, r, text);
    const said = await r.act(action);
    if (said !== 'accepted') throw new Error(`the original was answered ${said}`);
    await r.done(action.opId);
    relay!.replayLast();
    const reason = await Promise.race([r.closed, sleep(20_000).then(() => 'still open')]);
    if (reason !== 'sequence') throw new Error(reason === 'still open' ? 'the channel stayed open after a replayed frame' : `the channel closed ${reason}, not sequence`);
    const count = await effects(scene, text);
    if (count !== 1) throw new Error(`the action ran ${count} times`);
    return 'closed `sequence`; the transcript shows the send once';
  });
  await report.check('3', 'an action resent under a used nonce is refused `replayed`', async () => {
    const r = await open(scene, scene.owner, 'direct');
    try {
      const text = marker(scene, 'nonce');
      const action = send(scene, r, text);
      const first = await r.act(action);
      if (first !== 'accepted') throw new Error(`the first copy was answered ${first}`);
      const again = await r.act(action);
      if (again !== 'replayed') throw new Error(`the copy under the same nonce was answered ${again}`);
      const count = await effects(scene, text);
      if (count !== 1) throw new Error(`the action ran ${count} times`);
      return 'the copy refused `replayed`; the transcript shows the send once';
    } finally {
      r.close();
    }
  });
  await report.check('3', 'an action more than 60 s old by the machine’s clock is refused `stale`', async () => {
    const r = await open(scene, scene.owner, 'direct');
    try {
      const old = new Date(Date.now() - 90_000).toISOString();
      const text = marker(scene, 'stale');
      const said = await r.act(send(scene, r, text, { created: old, opCreated: old }));
      if (said !== 'stale') throw new Error(`answered ${said}`);
      if ((await effects(scene, text, 3000)) !== 0) throw new Error('the stale action ran');
      return 'refused `stale`, nothing ran';
    } finally {
      r.close();
    }
  });
  await report.check('3', 'a reseal under the same opId returns the stored result and runs nothing', async () => {
    const r = await open(scene, scene.owner, 'direct');
    try {
      const text = marker(scene, 'reseal');
      const action = send(scene, r, text);
      if ((await r.act(action)) !== 'accepted') throw new Error('the first copy was refused');
      const first = await r.done(action.opId);
      const resealed = r.device.reseal(action);
      const from = r.inbox.length;
      const said = await r.act(resealed);
      if (said !== 'accepted') throw new Error(`the reseal was answered ${said}`);
      const second = await r.done(resealed.opId, from);
      if (canonicalize(first) !== canonicalize(second)) throw new Error(`the reseal answered ${JSON.stringify(second)}, the original ${JSON.stringify(first)}`);
      const count = await effects(scene, text);
      if (count !== 1) throw new Error(`the transcript shows it ${count} times`);
      return `both answered ${String(first.state)}; the transcript shows one effect`;
    } finally {
      r.close();
    }
  });
  await report.check('3', 'a lost acknowledgement resolves through query, answered only to the member who sent it', async () => {
    let relay: ReturnType<typeof throughTamper>['relay'] | undefined;
    const r = await open(scene, scene.owner, 'relayed', {
      dial: async () => {
        const spliced = throughTamper(await scene.relay.dial());
        relay = spliced.relay;
        return spliced.device;
      },
    });
    const text = marker(scene, 'lost-ack');
    const action = send(scene, r, text);
    relay!.tamper('to-device', 'drop'); // the ack
    relay!.tamper('to-device', 'drop'); // the done
    await r.channel.send({ t: 'act', action });
    await effects(scene, text, 6000);
    r.close();
    const q = await open(scene, scene.owner, 'direct');
    const mine = await q.query(action.opId, action.opCreated, 'sminos');
    q.close();
    if (mine.state !== 'done') throw new Error(`the sender's query answered ${JSON.stringify(mine)}`);
    if (scene.other === null) return `the sender's query answered done; no second member to ask in this run`;
    const t = await open(scene, scene.other, 'direct');
    const theirs = await t.query(action.opId, action.opCreated, 'sminos');
    t.close();
    if (theirs.state !== 'refused' || theirs.outcome !== undefined) throw new Error(`another member's query answered ${JSON.stringify(theirs)}`);
    return `the sender's query answered done; another member's refused ${String(theirs.reason)}, revealing nothing`;
  });
  await report.check('3', '`not-received` only once the id is tombstoned: the original, released late, is refused', async () => {
    const gate: { hold(on: boolean): void } = { hold: () => {} };
    const r = await open(scene, scene.owner, 'relayed', {
      dial: async () => {
        const g = gated(await scene.relay.dial());
        gate.hold = g.hold;
        return g.device;
      },
    });
    const text = marker(scene, 'late');
    const action = send(scene, r, text);
    gate.hold(true);
    await r.channel.send({ t: 'act', action });
    const q = await open(scene, scene.owner, 'direct');
    const queried = await q.query(action.opId, action.opCreated, 'sminos');
    q.close();
    const from = r.inbox.length;
    gate.hold(false);
    if (queried.state !== 'not-received') throw new Error(`the query answered ${JSON.stringify(queried)} while the original was held`);
    const answer = await r.waitFor((m) => (m.t === 'ack' && m.state === 'refused' && m.opId === action.opId) || (m.t === 'done' && m.opId === action.opId), 'the late original’s answer', from, 30_000);
    r.close();
    const count = await effects(scene, text, 3000);
    if (count !== 0) throw new Error(`the late original ran ${count} times`);
    if (!isTombstoned(answer)) throw new Error(`the late original was answered ${JSON.stringify(answer.t === 'done' ? answer.outcome : answer)}, not its tombstone's refusal`);
    return `the query answered not-received; the original, let go after it, was answered ${JSON.stringify(answer.outcome)} and never ran`;
  });
  await report.check('3', 'an `opCreated` older than OP_HORIZON is refused `expired`, and so is its query', async () => {
    const r = await open(scene, scene.owner, 'direct');
    try {
      const old = new Date(Date.now() - (OP_HORIZON_S + 120) * 1000).toISOString();
      const action = send(scene, r, marker(scene, 'expired'), { opCreated: old });
      const said = await r.act(action);
      if (said !== 'expired') throw new Error(`the action was answered ${said}`);
      const queried = await r.query(action.opId, old, 'sminos');
      if (queried.state !== 'expired') throw new Error(`its query answered ${JSON.stringify(queried)}`);
      return 'the action and its query both `expired`';
    } finally {
      r.close();
    }
  });
  await report.check('3', 'an action frame altered in the relay closes the channel, and nothing runs', async () => {
    let relay: ReturnType<typeof throughTamper>['relay'] | undefined;
    const r = await open(scene, scene.owner, 'relayed', {
      dial: async () => {
        const spliced = throughTamper(await scene.relay.dial());
        relay = spliced.relay;
        return spliced.device;
      },
    });
    const text = marker(scene, 'altered');
    relay!.tamper('to-endpoint', { flip: -1 });
    await r.channel.send({ t: 'act', action: send(scene, r, text) });
    const reason = await Promise.race([r.closed, sleep(20_000).then(() => 'still open')]);
    if (reason !== 'tag') throw new Error(`the channel ${reason === 'still open' ? 'stayed open' : `closed ${reason}`}`);
    if ((await effects(scene, text, 3000)) !== 0) throw new Error('the altered action ran');
    return 'closed `tag`; nothing ran';
  });
  if (scene.amend !== null && scene.sign !== null && scene.post !== null) {
    await report.check('3', 'a device a new org state removes is refused at once', async () => {
      const second = await addDevice(scene, scene.owner.member, 'o2', (d) => endorseBy(scene, scene.owner, d));
      await waitForHead(scene);
      const r = await open(scene, second, 'relayed');
      await removeDevice(scene, second, 'revoked');
      const reason = await Promise.race([r.closed, sleep(30_000).then(() => 'still open')]);
      if (reason !== 'removed') throw new Error(`its channel ${reason === 'still open' ? 'stayed open' : `closed ${reason}`}`);
      await refusedOpen(scene, second, 'direct', 'revoked');
      return 'its channel closed `removed`, and a new one refused `revoked`';
    });
    await report.check('3', 'a device removed by a state delivered over an admin’s channel is refused at once', async () => {
      const third = await addDevice(scene, scene.owner.member, 'o3', (d) => endorseBy(scene, scene.owner, d));
      await waitForHead(scene);
      const doomed = await open(scene, third, 'direct');
      const keys = revokedEntries(await heldKeys(third));
      const state = await scene.sign!((s) => {
        const m = s.members.find((x) => x.id === third.member)!;
        m.devices = m.devices.filter((d) => d.id !== third.id);
        s.revoked.push(...keys);
      });
      const admin = await open(scene, scene.owner, 'relayed');
      const action = admin.device.action({ machine: scene.ref, action: 'endpoint.state', args: { states: [state], transitions: [] } });
      const acked = await admin.act(action);
      if (acked !== 'accepted') throw new Error(`the delivery was answered ${acked}`);
      const outcome = await admin.done(action.opId);
      const reason = await Promise.race([doomed.closed, sleep(30_000).then(() => 'still open')]);
      admin.close();
      await scene.post!(state);
      if (reason !== 'removed') throw new Error(`its channel ${reason === 'still open' ? 'stayed open' : `closed ${reason}`}`);
      if (outcome.state !== 'done') throw new Error(`the delivery's outcome: ${JSON.stringify(outcome)}`);
      return `the delivery answered done; the removed device's channel closed \`removed\`; the hub given the same state after`;
    });
  } else if (scene.ownerStep !== null) {
    // Production: the owner removes the run's own device by hand; this is the run's last step (runItems orders it).
    report.add('3', 'skip', 'a device removed by a state delivered over an admin’s channel', 'production: the run holds no admin key; the suites show it (test/endpoint/channel-suite.ts)');
  } else report.add('3', 'skip', 'a device removed by a new org state', 'no admin key in this run');
  report.bySuites('3', 'the machine answers an admin’s delivery only after the state is on disk: test/endpoint/org-sync.test.ts kills between the write and the answer');
}

// ---- 4: policy -------------------------------------------------------------------------------------------------------

export async function item4(scene: Scene, report: ItemReport): Promise<void> {
  const before = await scene.machine.policy();
  scene.cleanup.add('restore the endpoint’s policy', async () => void (await scene.machine.policy({ readOnly: before.read_only, ceiling: before.ceiling })));
  const mine = await open(scene, scene.owner, 'direct');
  try {
    // Two clauses under one read-only stretch: production runs the first, never the second (a remote spawn).
    await scene.machine.policy({ readOnly: true });
    try {
      await report.check('4', '`--read-only on` refuses a send, while reads and subscriptions go on', async () => {
        const text = marker(scene, 'read-only');
        const said = await mine.act(send(scene, mine, text));
        const listings = await mine.call('endpoint.listings', {});
        const sub = `ro-${scene.tag}`;
        await mine.channel.send({ t: 'sub', sub, session: { lane: 'A', id: scene.laneA.session }, view: 'full', cursor: null, credit: 1 << 20 });
        const subbed = await mine.waitFor((m) => m.sub === sub && (m.t === 'subbed' || m.t === 'ended'), 'the subscription’s answer');
        await mine.channel.send({ t: 'unsub', sub });
        if (said !== 'read-only') throw new Error(`a send was answered ${said}`);
        if (!listings.ok || subbed.t !== 'subbed') throw new Error(`under read-only the listings were ${listings.ok ? 'served' : listings.code}, the subscription ${subbed.t}`);
        if ((await effects(scene, text, 3000)) !== 0) throw new Error('the send ran under read-only');
        return 'the send refused `read-only`; the listings served and a subscription answered';
      });
      await report.check('4', '`--read-only on` refuses a spawn', async () => {
        const spawn = await mine.act(await mine.device.stepUp(mine.device.action({ machine: scene.ref, action: 'sminos.spawn', args: { checkout: scene.laneA.checkout, brief: 'o10-m11: refused' } })));
        if (spawn !== 'read-only') throw new Error(`a stepped-up spawn was answered ${spawn}`);
        return 'a stepped-up spawn refused `read-only`';
      });
    } finally {
      await scene.machine.policy({ readOnly: false });
    }
    await report.check('4', 'a spawn whose permission mode is above the ceiling is refused `ceiling`', async () => {
      await scene.machine.policy({ ceiling: 'default' });
      try {
        const said = await mine.act(await mine.device.stepUp(mine.device.action({ machine: scene.ref, action: 'sminos.spawn', args: { checkout: scene.laneA.checkout, brief: 'o10-m11: refused', permission_mode: 'acceptEdits' } })));
        if (said !== 'ceiling') throw new Error(`answered ${said}`);
        return 'with the ceiling at `default`, an `acceptEdits` spawn refused `ceiling`';
      } finally {
        await scene.machine.policy({ ceiling: before.ceiling });
      }
    });
    await report.check('4', 'a spawn into a directory that is no known checkout is refused `unknown-checkout`', async () => {
      const said = await mine.act(await mine.device.stepUp(mine.device.action({ machine: scene.ref, action: 'sminos.spawn', args: { checkout: `/nonexistent/o10-m11-${scene.tag}`, brief: 'o10-m11: refused' } })));
      if (said !== 'unknown-checkout') throw new Error(`answered ${said}`);
      return 'refused `unknown-checkout`';
    });
  } finally {
    mine.close();
  }
  await report.check('4', 'a local `sminos spawn` from the machine runs, untouched by the endpoint', async () => {
    const probe = scene.machine.laneA.sminos;
    if (probe === null) return { skip: 'no real sminos in this scene' };
    const alias = `o10-local-${scene.tag}`;
    const mark = await scene.machine.logMark();
    scene.cleanup.add(`retire ${alias}`, () => probe.retire(alias));
    const spawned = await probe.localSpawn(alias);
    // Production's guard (vm/production.sh): 10, a claude supervisor or background seat of the owner's ran already, so
    // nothing was spawned; 11, the seat's environment was not the scratch config's and the stub's, so it was killed.
    if (spawned.rc === 10 || spawned.rc === 11) return { skip: `not shown on production: ${spawned.lines.at(-1) ?? `exit ${spawned.rc}`}` };
    if (spawned.rc !== 0) throw new Error(`sminos spawn exited ${spawned.rc}: ${spawned.lines.slice(-3).join(' / ')}`);
    const seat = seatSession(spawned.lines);
    if (seat === null) throw new Error(`sminos spawn named no seat session: ${spawned.lines.slice(-3).join(' / ')}`);
    scene.sessions.push(seat);
    const touched = (await scene.machine.logSince(mark)).filter((l) => l.includes(alias) || /endpoint: .*(rpc|spawn)/i.test(l));
    if (touched.length) throw new Error(`the endpoint's log mentions it: ${touched[0]}`);
    await probe.retire(alias);
    return `spawned ${alias} (exit 0), and the endpoint logged nothing of it`;
  });
  const after = await scene.machine.policy();
  if (after.read_only !== before.read_only || after.ceiling !== before.ceiling) report.add('4', 'fail', 'the policy restored', `it is ${JSON.stringify(after)}, was ${JSON.stringify(before)}`);
}

// ---- 5: sminos hands over --------------------------------------------------------------------------------------------

export async function item5(scene: Scene, report: ItemReport): Promise<void> {
  const probe = scene.machine.laneA.sminos;
  await report.check('5', 'sminos runs no DX2 uplink, and holds no hub credential', async () => {
    if (probe === null) return { skip: 'no real sminos in this scene' };
    const { lines, hubJson } = await probe.status();
    const rl10 = lines.find((l) => l.startsWith('uplink: RL10 (local-only), running'));
    const dx2 = lines.find((l) => /^uplink: (running|not running)/.test(l));
    if (!rl10 || dx2 || hubJson) throw new Error(`daemon status says ${lines.filter((l) => l.startsWith('uplink')).join(' / ') || 'no uplink line'}; hub.json ${hubJson ? 'present' : 'absent'}`);
    return `${rl10}; no hub.json, so no DX2 stream can open`;
  });
  await report.check('5', 'the hub sees the machine through its endpoint alone', async () => {
    const { machines } = await scene.person.json<{ machines: Array<{ name: string; online?: boolean }> }>('/api/machines');
    const row = machines.find((m) => m.name === scene.name);
    const endpoint = await scene.person.fetch(`/api/machines/${encodeURIComponent(scene.ref)}/endpoint`);
    const record = endpoint.status === 200 ? ((await endpoint.json()) as { record?: { body?: { addresses?: string[] } } }) : null;
    if (!row || record === null) throw new Error(`the hub ${row ? 'serves no endpoint record' : 'lists no such machine'}`);
    return `listed${row.online ? ', online' : ''}, its RL6 endpoint record served (${record.record?.body?.addresses?.length ?? 0} address(es))`;
  });
  await report.check('5', 'the session’s listing goes up signed by the machine', async () => {
    const listing = await until(async () => {
      const { listings } = await scene.person.json<{ listings: Signed<Listing>[] }>('/api/listings');
      return listings.find((l) => l.body.session === scene.laneA.session && l.body.machine === scene.ref);
    }, 'a listing of the session', 60_000, 2000);
    const head = scene.chain().at(-1)!.state;
    const verdict = await verifyListing(head, listing, NO_CERTS, new Date());
    if (!verdict.ok) throw new Error(`the listing does not verify: ${verdict.code}`);
    return `revision ${listing.body.revision}, owners ${listing.body.fields.owners.length}, verified against the head`;
  });
  await report.check('5', 'a device’s words arrive verified and are delivered into the session', async () => {
    if (probe === null) return { skip: 'no real sminos in this scene: words reach the session through it' };
    const text = words(scene, 'words');
    await say(scene, scene.owner, text);
    const count = await until(async () => (await arrivals(scene, text)) || null, 'the words in the transcript', 90_000, 3000);
    if (count !== 1) throw new Error(`delivered ${count} times`);
    return 'the owner device’s signed human event reached the transcript once';
  });
  await report.check('5', 'the machine’s own events go up signed', async () => {
    // Only this run's: the machine's writers' events after the offset the log stood at before lane A started, which
    // its sessions write (their lifecycle); never the history before it, a cut-over machine's DX2 years included.
    const socket = await ProjectSocket.open(scene.hub, scene.person.headers, scene.laneA.project, 15_000);
    try {
      let own: LoggedEvent[] = [];
      const deadline = Date.now() + 60_000;
      for (;;) {
        socket.log.length = 0; // each read the whole stretch again, once
        await socket.catchUp(scene.logFrom);
        own = runOwnEvents(socket.log as LoggedEvent[], scene.logFrom, scene.name, scene.sessions);
        if (own.length > 0 || Date.now() > deadline) break;
        await sleep(3000);
      }
      if (own.length === 0) {
        if (probe === null) return { skip: 'no real sminos in this scene: nothing writes the machine’s own events' };
        throw new Error(`no event of the machine’s after offset ${scene.logFrom} within 60 s, though lane A’s session runs`);
      }
      const head = scene.chain().at(-1)!.state;
      for (const { event } of own) {
        const verdict = await verifyEvent({ org: scene.org, project: scene.laneA.project }, head, event as unknown as LogEventV2, NO_CERTS, new Date());
        if (!verdict.ok) throw new Error(`${event.writer}:${event.seq} does not verify: ${verdict.code}`);
      }
      return `the ${own.length} event(s) the run’s sessions wrote after offset ${scene.logFrom} verify under the machine’s key`;
    } finally {
      socket.close();
    }
  });
  // The hub asks a resend only for a gap it sees, which nothing here can make it see: a live run can't force one, and a
  // check that compared the stored events after a cut would show no resend at all.
  report.add('5', 'skip', 'a forced resend is byte-identical', 'not forceable live (the hub asks `resend` only on a gap it sees); test/endpoint/rl10/conversation.json resends from the signature ledger and compares the bytes');
  if (probe !== null && scene.amend !== null) {
    await report.check('5', 'a new state’s revocations reach sminos, and an owed delivery from the removed device is not delivered as words', async () => {
      const lost = await addDevice(scene, scene.owner.member, 'o4', (d) => endorseBy(scene, scene.owner, d));
      await waitForHead(scene);
      await probe.stopSession();
      let resumed = false;
      scene.cleanup.add('resume the lane A session', async () => void (resumed ? undefined : await probe.resumeSession()));
      const revokedText = words(scene, 'revoked');
      const keptText = words(scene, 'kept');
      await say(scene, lost, revokedText);
      await say(scene, scene.owner, keptText);
      // sminos imports both and owes their delivery to a session with no engine: revoked only once both are in its log.
      await until(async () => ((await probe.imported(tokenOf(revokedText))) > 0 && (await probe.imported(tokenOf(keptText))) > 0) || null, 'both words in sminos’s project log', 90_000, 3000);
      await removeDevice(scene, lost, 'revoked');
      const kid = await keyId(lost.channel.pub);
      const held = await until(async () => {
        const revoked = await probe.revoked();
        return revoked?.keys?.includes(kid) ? revoked : null;
      }, "the removed device's key in sminos's revocations", 90_000, 3000);
      const { launch } = await probe.resumeSession();
      resumed = true;
      scene.laneA.launch = launch;
      await until(async () => (await arrivals(scene, keptText)) || null, 'the kept words delivered', 120_000, 3000);
      await sleep(10_000);
      const refused = await arrivals(scene, revokedText);
      if (refused !== 0) throw new Error('the removed device’s words were delivered');
      return `sminos holds the revocation (version ${held.version ?? '?'}); after the session came back the other device's words were delivered and the removed one's never`;
    });
  } else report.add('5', 'skip', 'revocations reach sminos', probe === null ? 'no real sminos in this scene' : 'no admin key in this run (production: the owner’s remove-device step shows it)');
  report.bySuites('5', 'test/endpoint/rl10/conversation.json pins RL10 frame by frame (a byte-identical resend from the signature ledger, a forged event refused, `query` and the tombstone); lane A actions by opId are item 3’s, through sminos’s ledger');
  report.outstanding('5', 'the sminos half is O12 phase 2’s RL10 client; this item is joint with it');
}

/** A device's signed `human` to the run's session, posted on the project's log as its app posts one. */
async function say(scene: Scene, who: RunDevice, text: string): Promise<void> {
  const socket = await ProjectSocket.open(scene.hub, scene.person.headers, scene.laneA.project, 15_000);
  try {
    const draft: Omit<DeviceHuman, 'sig'> = { kind: 'human', from: 'human', member: who.member, to: [{ session: scene.laneA.session, alias: scene.laneA.alias }], text, created: new Date().toISOString(), nonce: randomBytes(16).toString('base64url') };
    scene.hubWrites.admit(scene.laneA.project, text);
    const event = await signEvent({ org: scene.org, project: scene.laneA.project }, draft, who.channel.privateKey, who.channel.pub);
    const answer = await socket.say(event);
    scene.hubWrites.posted(scene.laneA.project, answer as { t?: string });
    if ((answer as { t?: string }).t !== 'human-ack') throw new Error(`the hub refused the words: ${JSON.stringify(answer).slice(0, 200)}`);
  } finally {
    socket.close();
  }
}

// ---- 2: resume without loss ------------------------------------------------------------------------------------------

/** One subscription followed across its channel's ends, each answer and what came after it a segment. */
class Track {
  readonly segments: Segment[] = [];
  remote: Remote | null = null;
  #from = 0;

  constructor(
    readonly scene: Scene,
    readonly sub: string,
    readonly carrier: 'relayed' | 'direct',
  ) {}

  /** The current segment's events and snapshot, read again from the channel's inbox. */
  #collect(): void {
    const segment = this.segments.at(-1);
    const remote = this.remote;
    if (segment === undefined || remote === null) return;
    const mine = remote.inbox.slice(this.#from).filter((m) => m.sub === this.sub);
    const subbed = mine.find((m) => m.t === 'subbed');
    segment.subbed = subbed ? { mode: String(subbed.mode), epoch: String(subbed.epoch), seq: Number(subbed.seq) } : null;
    const pages = mine.filter((m) => m.t === 'snap');
    const last = pages.findIndex((m) => m.last === true);
    segment.snapshot = last < 0 ? null : { epoch: String(pages[0].epoch), seq: Number(pages[0].seq), message: JSON.parse(pages.slice(0, last + 1).map((m) => m.body as string).join('')) };
    segment.events = mine.filter((m) => m.t === 'ev').map((m) => ({ epoch: String(m.epoch), seq: Number(m.seq), message: m.body as Segment['events'][number]['message'] }));
  }

  /** Opens a channel and subscribes, resuming from the last segment's cursor; the answer is the one `expect` names. */
  async subscribe(after: string, expect: Segment['expect'], ms = 120_000): Promise<string> {
    this.#collect();
    const previous = this.segments.at(-1);
    const cursor = previous === undefined ? null : resumeCursor(previous);
    const started = Date.now();
    const remote = await until(async () => open(this.scene, this.scene.owner, this.carrier).catch(() => null), `a ${this.carrier} channel`, ms, 2000);
    this.remote = remote;
    this.#from = remote.inbox.length;
    this.segments.push({ after, cursor, expect, subbed: null, snapshot: null, events: [] });
    await remote.channel.send({ t: 'sub', sub: this.sub, session: { lane: 'A', id: this.scene.laneA.session }, view: 'full', cursor, credit: 4 << 20 });
    const answer = await remote.waitFor((m) => m.sub === this.sub && (m.t === 'subbed' || m.t === 'ended'), `the answer to ${this.sub}`, this.#from, 30_000);
    if (answer.t === 'ended') throw new Error(`${this.sub} ended ${String(answer.reason)}`);
    return `${String(answer.mode)} after ${((Date.now() - started) / 1000).toFixed(1)} s`;
  }

  /** Waits for the channel to close (a cut the run made), its segment kept. */
  async closed(ms: number): Promise<string> {
    const remote = this.remote;
    if (remote === null) return 'no channel';
    const reason = await Promise.race([remote.closed, sleep(ms).then(() => null)]);
    this.#collect();
    if (reason === null) throw new Error(`the ${this.carrier} channel stayed open`);
    this.remote = null;
    return reason;
  }

  /** The events received so far in the current segment. */
  count(): number {
    this.#collect();
    return this.segments.at(-1)?.events.length ?? 0;
  }

  finish(): void {
    this.#collect();
    this.remote?.close();
  }
}

/**
 * New rows asked for (`start`), and each track's events growing past where they stood before the asking: a replay that
 * caught up while it ran, or rows that landed before `start` returned, count as progress; none within `ms` is a stall.
 */
export async function flowingAfter(start: () => Promise<void>, tracks: Array<{ carrier: string; count(): number }>, what: string, ms = 60_000): Promise<void> {
  const from = tracks.map((track) => track.count());
  await start();
  for (const [i, track] of tracks.entries()) await until(() => track.count() > from[i], `${track.carrier} events ${what}`, ms, 500);
}

/** A watcher run beside a long step: its failure held as its answer while the step runs (never an unhandled
 * rejection), and thrown when it is joined. */
export function watchDuring<T>(watch: () => Promise<T>): { join(): Promise<T> } {
  const held = watch().then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );
  return {
    join: async () => {
      const answer = await held;
      if (!answer.ok) throw answer.error;
      return answer.value;
    },
  };
}

export async function item2(scene: Scene, report: ItemReport): Promise<void> {
  const relayed = new Track(scene, `r-${scene.tag}`, 'relayed');
  const direct = new Track(scene, `d-${scene.tag}`, 'direct');
  scene.cleanup.add('close item 2’s channels', async () => {
    relayed.finish();
    direct.finish();
  });
  let stretch = 0;
  /** A stretch of rows the session writes by itself, asked for over the direct channel. */
  const ticks = async (count: number) => {
    const via = direct.remote ?? (await open(scene, scene.owner, 'direct'));
    await scene.machine.laneA.ticks(count, `${scene.tag}${++stretch}`, async (text) => {
      const action = send(scene, via, text);
      const said = await via.act(action);
      if (said !== 'accepted') throw new Error(`the stretch's send was answered ${said}`);
    });
    if (via !== direct.remote) via.close();
  };
  /** A new stretch of `count` rows, and each track's events growing from before it was asked for. */
  const fresh = (what: string, tracks: Track[], count = 10) => flowingAfter(() => ticks(count), tracks, what);
  const ok = await report.check('2', 'both carriers subscribed to the lane A session, rows flowing', async () => {
    const a = await relayed.subscribe('first', 'snapshot');
    const b = await direct.subscribe('first', 'snapshot');
    await fresh('from the first stretch', [relayed, direct], 40);
    return `relayed ${a}, direct ${b}`;
  });
  if (!ok) return;

  await report.check('2', 'the endpoint’s RL1 socket cut by force: the relayed channel resumes by replay, the direct one never drops', async () => {
    await ticks(40); // rows being written as the cut lands
    const cut = await scene.machine.cutHubSocket();
    const reason = await relayed.closed(60_000);
    const resumed = await relayed.subscribe('the hub socket cut', 'replay');
    if (direct.remote === null) throw new Error('the direct channel dropped');
    // Rows asked for after the resume: a replay that caught up with the stretch meanwhile is no stall.
    await fresh('after the cut and the replay', [relayed, direct]);
    if (direct.remote === null) throw new Error('the direct channel dropped');
    return `${cut}; the relayed channel closed ${reason} and resumed (${resumed})`;
  });

  await report.check('2', 'a hub deploy, then the forced cut: the relayed channel resumes by replay', async () => {
    if (scene.hubDeploy === null) return { skip: 'this scene deploys no hub' };
    await ticks(60);
    // The deploy may or may not cut RL1 or the Machine socket within its window (O11 M8): any cut while it runs is
    // resumed at once, inside the 120 s window; the forced cut after it makes the cut certain.
    let deploying = true;
    const watching = watchDuring(async () => {
      const said: string[] = [];
      while (deploying) {
        const remote = relayed.remote;
        if (remote === null) break;
        const reason = await Promise.race([remote.closed, sleep(2000).then(() => null)]);
        if (reason === null) continue;
        relayed.finish();
        relayed.remote = null;
        said.push(`cut by the deploy (${reason}), resumed ${await relayed.subscribe('a cut during the hub deploy', 'replay')}`);
      }
      return said;
    });
    let during: string[];
    try {
      await scene.hubDeploy!();
    } finally {
      // The watcher stops at its next turn (2 s at most, or the resume it is in), and is joined before anything else.
      deploying = false;
      during = await watching.join();
    }
    // A long deploy outlasts the stretch it started with: a new one, so the forced cut falls among rows being written.
    await fresh('after the deploy, before the forced cut', [relayed], 30);
    const cut = await scene.machine.cutHubSocket();
    const reason = await relayed.closed(60_000);
    const resumed = await relayed.subscribe('the hub deploy and its forced cut', 'replay');
    await fresh('after the forced cut', [relayed]);
    return `${during.length ? `${during.join('; ')}; ` : 'the deploy cut nothing; '}${cut}; closed ${reason}, resumed (${resumed})`;
  });

  await report.check('2', '`mawsd restart`: both channels close `restart` and resume by snapshot under a new epoch', async () => {
    await fresh('before the restart', [direct], 40);
    await scene.machine.restart();
    const [r, d] = await Promise.all([relayed.closed(60_000), direct.closed(60_000)]);
    if (r !== 'restart' || d !== 'restart') throw new Error(`the channels closed ${r} and ${d}`);
    await until(async () => {
      const s = await scene.machine.status();
      return s.hub.connected && s.listener.bound && s.rl10.connected;
    }, 'the endpoint back on the hub, the listener and RL10', 120_000, 2000);
    const a = await relayed.subscribe('mawsd restart', 'snapshot');
    const b = await direct.subscribe('mawsd restart', 'snapshot');
    await fresh('after the restart', [relayed, direct]);
    return `relayed ${a}, direct ${b}`;
  });

  // The verdict: the session's own transcript, once it stops growing, against each subscription.
  let produced: string[] = [];
  await until(async () => {
    const rows = await scene.machine.laneA.rows(scene.laneA.session);
    const settled = rows.length === produced.length;
    produced = rows;
    return settled && rows.length > 0;
  }, 'the transcript at rest', 180_000, 5000);
  await sleep(3000);
  for (const track of [relayed, direct]) {
    await report.check('2', `lane A over the ${track.carrier} carrier: every event once, by the endpoint’s cursor, sminos’s numbering and the transcript`, async () => {
      track.finish();
      const problems = laneAProblems(track.segments, produced);
      if (problems.length) throw new Error(problems.slice(0, 5).join('; '));
      const events = track.segments.reduce((n, s) => n + s.events.length, 0);
      return `${track.segments.length} answers (${track.segments.map((s) => s.subbed?.mode).join(', ')}), ${events} events, ${produced.length} transcript rows all held`;
    });
  }
  report.outstanding('2', 'lane B’s live half needs an app-less event source on a machine with no app, O3’s (P5 DL 29); until then M8’s suites prove it (test/endpoint/subscriptions-b.test.ts)');
}

// ---- production ------------------------------------------------------------------------------------------------------

const both = (check: string) => ['relayed', 'direct'].map((carrier) => check.replace('<carrier>', carrier));

/**
 * What production runs (acceptance 7), by name: each clause VM-local on the production machine (channels and
 * subscriptions from the paired device, the stub lane A session and actions to it, `mawsd restart` of its unit, a cut of
 * mawsd's own RL1 socket, its policy toggled and restored), or a read of the hub. `hub-write` clauses post to the
 * production hub's stored data, which the owner allowed within `HubWrites.production`'s bounds (five marked events in
 * the machine's own project, kept as residue); `productionAdmit(false)` holds them back. Any clause not named here is
 * skipped, so a clause added later runs in production only once someone lists it.
 */
export const PRODUCTION_CLAUSES: Record<string, 'vm' | 'read' | 'hub-write'> = Object.fromEntries([
  ...both('9 the handshake and caps over the <carrier> carrier').map((c) => [c, 'vm']),
  ...both('9 an unknown device refused over the <carrier> carrier').map((c) => [c, 'vm']),
  ...both('9 a device claiming another class refused over the <carrier> carrier').map((c) => [c, 'vm']),
  ...both('9 an altered frame closes the channel over the <carrier> carrier').map((c) => [c, 'vm']),
  ['9 the direct listener binds only the tailnet’s addresses', 'vm'],
  ['9 a call before the handshake verifies closes the connection', 'vm'],
  ['9 handshakes past the per-source limit answered `busy`', 'vm'],
  ['8 a `view` read on a session the member holds nothing on', 'vm'],
  ['8 a `converse`, an `approve` and a `manage` act refused below their grades', 'vm'],
  ['8 the machine’s content-free reads, for any member', 'vm'],
  ['8 what production’s offer table doesn’t offer is refused `not-offered`, the owner’s too', 'vm'],
  ['3 an action frame the relay replays closes the channel, and the action runs once', 'vm'],
  ['3 an action resent under a used nonce is refused `replayed`', 'vm'],
  ['3 an action more than 60 s old by the machine’s clock is refused `stale`', 'vm'],
  ['3 a reseal under the same opId returns the stored result and runs nothing', 'vm'],
  ['3 a lost acknowledgement resolves through query, answered only to the member who sent it', 'vm'],
  ['3 `not-received` only once the id is tombstoned: the original, released late, is refused', 'vm'],
  ['3 an `opCreated` older than OP_HORIZON is refused `expired`, and so is its query', 'vm'],
  ['3 an action frame altered in the relay closes the channel, and nothing runs', 'vm'],
  ['3 the run’s own device, removed by the owner, is refused at once', 'vm'],
  ['4 `--read-only on` refuses a send, while reads and subscriptions go on', 'vm'],
  // Ruled: only when vm/production.sh shows no claude supervisor or background seat of the owner's before it, and the
  // seat's environment the scratch config's and the stub's after it (else the seat is killed and the clause skipped).
  ['4 a local `sminos spawn` from the machine runs, untouched by the endpoint', 'vm'],
  ['5 sminos runs no DX2 uplink, and holds no hub credential', 'read'],
  ['5 the hub sees the machine through its endpoint alone', 'read'],
  ['5 the session’s listing goes up signed by the machine', 'read'],
  ['5 the machine’s own events go up signed', 'read'],
  ['5 a device’s words arrive verified and are delivered into the session', 'hub-write'],
  ['5 the owner’s removal reaches the machine’s sminos', 'read'],
  ['2 both carriers subscribed to the lane A session, rows flowing', 'vm'],
  ['2 the endpoint’s RL1 socket cut by force: the relayed channel resumes by replay, the direct one never drops', 'vm'],
  ['2 `mawsd restart`: both channels close `restart` and resume by snapshot under a new epoch', 'vm'],
  ...both('2 lane A over the <carrier> carrier: every event once, by the endpoint’s cursor, sminos’s numbering and the transcript').map((c) => [c, 'vm']),
]);

/** A spawn the real daemon is asked to refuse: were its refusal broken, it would launch a seat with the daemon's own
 * environment, so production never asks it. */
const SPAWN_PROBE = 'never in production: a broken refusal would launch a seat with the production daemon’s environment; staging runs it, and test/endpoint/grades.test.ts proves the refusal';

/** Clauses production never runs, and why. */
const NEVER_IN_PRODUCTION: Record<string, string> = {
  '4 `--read-only on` refuses a spawn': SPAWN_PROBE,
  '4 a spawn whose permission mode is above the ceiling is refused `ceiling`': SPAWN_PROBE,
  '4 a spawn into a directory that is no known checkout is refused `unknown-checkout`': SPAWN_PROBE,
  '8 an owner’s spawn needs step-up': SPAWN_PROBE,
  '8 a spawn by a member without the machine’s `spawn` right': SPAWN_PROBE,
  '2 a hub deploy, then the forced cut: the relayed channel resumes by replay': 'never in production: no hub deploy',
  '9 a revoked device refused, and one a new state removes closed `removed`, over both carriers': 'never in production: the run amends no org state there',
  '3 a device a new org state removes is refused at once': 'never in production: the run amends no org state there',
  '3 a device removed by a state delivered over an admin’s channel is refused at once': 'never in production: the run amends no org state there',
  '5 a new state’s revocations reach sminos, and an owed delivery from the removed device is not delivered as words': 'never in production: the run amends no org state there (the owner’s removal shows the revocation)',
};

/** Production's gate for `ItemReport.admit`: its allowlist, its hub writes behind `hubWrites`. */
export function productionAdmit(hubWrites: boolean): (item: string, check: string) => string | null {
  return (item, check) => {
    const key = `${item} ${check}`;
    if (NEVER_IN_PRODUCTION[key] !== undefined) return NEVER_IN_PRODUCTION[key];
    const kind = PRODUCTION_CLAUSES[key];
    if (kind === undefined) return 'not on production’s allowlist';
    if (kind === 'hub-write' && !hubWrites) return 'writes the production hub’s stored data, which this run is not allowed';
    return null;
  };
}

/** The items in the run's order: the ones that change the machine's links last, the removal of the run's own device
 * (production's owner step) after everything. */
export async function runItems(scene: Scene, report: ItemReport, items: readonly string[]): Promise<void> {
  const order: Array<[Item, (s: Scene, r: ItemReport) => Promise<void>]> = [
    ['9', item9],
    ['8', item8],
    ['3', item3],
    ['4', item4],
    ['5', item5],
    ['2', item2],
  ];
  if (scene.target === 'production') report.admit = productionAdmit(true);
  for (const [item, run] of order) {
    if (!items.includes(item)) continue;
    scene.log(`-- item ${item}`);
    try {
      await run(scene, report);
    } catch (error) {
      if (scene.cleanup.signal.aborted) throw error;
      report.add(item, 'fail', 'the item', error instanceof Error ? error.message : String(error));
    }
  }
  if (scene.ownerStep !== null && scene.amend === null) await ownersRemoval(scene, report, items);
}

/**
 * Production's last step: the owner removes the run's own device by hand while its channel is open. Its channel closes
 * `removed` at once and a new one is refused (item 3), and the removal's revocation reaches the machine's sminos (item 5).
 */
/**
 * How a channel ended around a removal the run waits for: its close, watched from before the wait began; `still open`
 * only when no close came within `ms` after the removal was seen (the deadline starts there, not at the wait's start).
 */
export function closeAfterRemoval(closed: Promise<string>, removal: Promise<unknown>, ms: number): Promise<string> {
  return Promise.race([closed, removal.then(() => sleep(ms)).then(() => 'still open')]);
}

async function ownersRemoval(scene: Scene, report: ItemReport, items: readonly string[]): Promise<void> {
  const device = scene.owner;
  const r = await open(scene, device, 'relayed');
  const removed = async () => {
    const { head } = await scene.person.json<{ head: SignedOrgState | null }>('/api/org/state');
    return head !== null && !head.state.members.some((m) => m.devices.some((d) => d.id === device.id));
  };
  const stepping = scene.ownerStep!(`run \`production-run.sh admin remove-device ${device.id}\` now; the run watches its channel`, removed);
  const closing = closeAfterRemoval(r.closed, stepping, 30_000);
  closing.catch(() => {}); // the owner's step failing is reported by `stepping` itself
  await stepping;
  const kid = await keyId(device.channel.pub);
  if (items.includes('3')) {
    await report.check('3', 'the run’s own device, removed by the owner, is refused at once', async () => {
      const reason = await closing;
      if (reason !== 'removed') throw new Error(`its channel ${reason === 'still open' ? 'stayed open' : `closed ${reason}`}`);
      return 'its open channel closed `removed`';
    });
  }
  if (items.includes('5')) {
    await report.check('5', 'the owner’s removal reaches the machine’s sminos', async () => {
      const probe = scene.machine.laneA.sminos;
      if (probe === null) return { skip: 'no sminos probe on this machine' };
      const revoked = await until(async () => {
        const held = await probe.revoked();
        return held?.keys?.includes(kid) || held?.devices?.includes(device.id) ? held : null;
      }, "the device in sminos's revocations", 120_000, 3000);
      return `sminos holds it (revocations version ${revoked.version ?? '?'})`;
    });
  }
}

