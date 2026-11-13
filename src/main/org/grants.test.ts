// A machine's rights from this Mac (P5 O8 M4b, grants.ts): the version above both marks, read just before signing; the
// draft judged before Touch ID and the signed grant verified before it is kept; delivery through this Mac's local door or
// another machine's link, each outcome read; the missing-grant judge and Re-grant…; grants.json failing closed; and every
// operation fenced by the sign-in it began under, ended during Touch ID, the ledger read or the act.
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  generateSigningKey,
  isAction,
  keyId,
  NO_CERTIFICATES,
  signRecord,
  SIGNING_DOMAINS,
  verifyGrant,
  type Action,
  type Grant,
  type OrgState,
  type Right,
  type RootTransition,
  type Signed,
  type SignedOrgState,
  type SigningKey,
} from '../../../apps/org-protocol/src/index.ts';
import type { MachineRef } from '@shared/machine/ref';
import { GrantsViewSchema } from '@shared/ipc/schema/org';
import { createRecordSigner, type Confirm, type StepUpPrompt } from '../device/step-up';
import type { ActOutcome, ActRequest, CallResult } from '../machines/remote/link';
import { GRANTS_FILE, orgFiles, type GrantsFile } from './files';
import { createGrants, missingGrants, nextVersion, type GrantDoor, type GrantLink, type Grants, type GrantsContext } from './grants';
import { createGrantsStore } from './grants-store';
import { createHeadPush, type DeliveryLink } from './deliveries';
import type { HeldOrg } from './held';

const ORG = 'org-grants-test';
const A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'; // the owner signing here (this Mac's member)
const B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'; // the member granted
const C = 'cccccccccccccccccccccccccccccccc'; // another owner, with a device of their own
const MINI = 'mref-mini-0000001' as MachineRef; // A's machine, over its link
const HOME = 'mref-home-0000001' as MachineRef; // this Mac's own machine (the door)
const STUDIO = 'mref-studio-00001' as MachineRef; // C's machine: A may not grant there
const SHARED = 'mref-shared-00001' as MachineRef; // org-owned: its admins grant
const NOW = Date.parse('2026-11-08T12:00:00.000Z');

let dir: string;
let aKey: SigningKey;
let cKey: SigningKey;
let keys: Record<string, SigningKey>;
let head: OrgState;
/** The app's accepted root transitions: the line the held view is on (deliveries.ts's `lineOf`). */
let transitions: Signed<RootTransition>[];

/** A deferred: `promise`, settled by `resolve`. */
type Deferred = { promise: Promise<void>; resolve: () => void };
function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}
async function until(check: () => boolean | Promise<boolean>, what: string, ms = 2_000): Promise<void> {
  const end = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 2));
  }
}

async function stateWith(machineKeys: Record<string, SigningKey>): Promise<OrgState> {
  const device = async (id: string, key: SigningKey) => ({ id, class: 'native-mac' as const, keyStorage: 'software' as const, channelPub: (await generateSigningKey()).pub, stepUpPub: key.pub });
  return {
    org: ORG,
    version: 7,
    prev: null,
    issued: new Date(NOW).toISOString(),
    root: { keys: [], recoveryPub: (await generateSigningKey()).pub },
    members: [
      { id: A, email: 'ana@example.com', role: 'admin', devices: [await device('dev-a', aKey)] },
      { id: B, email: 'bea@example.com', role: 'member', devices: [] },
      { id: C, email: 'cy@example.com', role: 'member', devices: [await device('dev-c', cKey)] },
    ],
    machines: [
      { name: 'mini', ref: MINI, pub: machineKeys[MINI].pub, owners: [A] },
      { name: 'home', ref: HOME, pub: machineKeys[HOME].pub, owners: [A] },
      { name: 'studio', ref: STUDIO, pub: machineKeys[STUDIO].pub, owners: [C] },
      { name: 'shared', ref: SHARED, pub: machineKeys[SHARED].pub, owners: 'org' },
    ],
    machineNames: [MINI, HOME, STUDIO, SHARED].map((ref) => ({ name: ref === MINI ? 'mini' : ref === HOME ? 'home' : ref === STUDIO ? 'studio' : 'shared', ref })),
    retired: [],
    revoked: [],
    delegations: [],
    projects: [],
  };
}

/** A machine's grant ledger, kept by grants.ts's intake rule (src/endpoint/grants.ts's `acceptGrant`). */
class Ledger {
  /** The machine's own head, which its intake judges under; null: the app's (`head`). */
  head: OrgState | null = null;
  grants: Record<string, Signed<Grant>> = {};
  highWater: Record<string, number> = {};
  heldKeys: string[];
  constructor(
    readonly ref: string,
    heldKey: string,
  ) {
    this.heldKeys = [heldKey];
  }
  /** `endpoint.grants`' answer: an entry for each member the machine's own head lists (src/endpoint/grants.ts). */
  answer() {
    return { members: (this.head ?? head).members.map((m) => ({ member: m.id, grant: this.grants[m.id] ?? null, highWater: this.highWater[m.id] ?? 0 })) };
  }
  async intake(value: unknown): Promise<{ ok: true } | { ok: false; code: string }> {
    const g = value as Signed<Grant>;
    if (g.body.machine !== this.ref) return { ok: false, code: 'other-machine' };
    const verdict = await verifyGrant(this.head ?? head, g, NO_CERTIFICATES, new Date(NOW));
    if (!verdict.ok) return { ok: false, code: verdict.code };
    if (!this.heldKeys.includes(g.body.machineKey)) return { ok: false, code: 'not-held' };
    if ((this.highWater[g.body.member] ?? 0) >= g.body.version) return { ok: false, code: 'not-newer' };
    this.grants[g.body.member] = g;
    this.highWater[g.body.member] = g.body.version;
    return { ok: true };
  }
}

/**
 * A machine's RL2 link over its ledger: the call and the grant's act as the endpoint answers them, with holds and
 * scripts; and `endpoint.state` (the head pushed, deliveries.ts's `bringTo`) adopting the run's newest state when it is
 * newer than the machine's head, `done` at the head, as endpoint.ts's `#deliver`.
 */
class FakeLink implements GrantLink, DeliveryLink {
  up = true;
  calls = 0;
  acts: ActRequest[] = [];
  /** The versions of each `endpoint.state` run. */
  pushes: number[][] = [];
  /** Holds the next push's answer until released. */
  holdPush: Deferred | null = null;
  /** The answers of the next pushes, in order, before the machine's own. */
  pushScript: ActOutcome[] = [];
  opIds: string[] = [];
  /** Answers the next call with this, once. */
  callFails: CallResult | null = null;
  /** Holds the next call until released. */
  holdCall: Deferred | null = null;
  /** Holds the next act's outcome until released. */
  holdAct: Deferred | null = null;
  /** The outcomes of the next acts, in order, before the ledger's own. */
  script: ActOutcome[] = [];
  /** Runs once an act is sent, before its outcome. */
  onAct: (() => void) | null = null;
  readonly listeners = new Set<(state: 'up' | 'down') => void>();
  constructor(readonly ledger: Ledger) {}
  state = () => (this.up ? 'up' : 'down') as ReturnType<GrantLink['state']>;
  caps = (() => ({ member: A, device: 'dev-a', clientClass: 'native-mac', machine: { grades: [] }, stateVersion: (this.ledger.head ?? head).version })) as DeliveryLink['caps'];
  onState = ((listener: (state: 'up' | 'down') => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }) as GrantLink['onState'];
  setUp(up: boolean) {
    this.up = up;
    for (const l of [...this.listeners]) l(up ? 'up' : 'down');
  }
  call = (async (name: string, input: unknown): Promise<CallResult> => {
    this.calls++;
    expect([name, input]).toEqual(['endpoint.grants', null]);
    const hold = this.holdCall;
    this.holdCall = null;
    if (hold !== null) await hold.promise;
    const fails = this.callFails;
    this.callFails = null;
    return fails ?? { ok: true, output: this.ledger.answer() };
  }) as GrantLink['call'];
  act = ((request: ActRequest) => {
    if (request.action === 'endpoint.state') return this.push(request);
    this.acts.push(request);
    const opId = `op-${this.acts.length}-xxxxxxxxxxxxxxxx`;
    this.opIds.push(opId);
    const outcome = (async (): Promise<ActOutcome> => {
      this.onAct?.();
      const hold = this.holdAct;
      this.holdAct = null;
      const scripted = this.script.shift();
      if (hold !== null) await hold.promise;
      if (scripted !== undefined) return scripted;
      if (!this.up) return { state: 'refused', reason: 'offline' };
      const result = await this.ledger.intake((request.args as { grant: unknown }).grant);
      return result.ok ? { state: 'done', result: {} } : { state: 'failed', error: { code: result.code } };
    })();
    return { opId, opCreated: new Date(NOW).toISOString(), progress: () => 'sent', onProgress: () => () => {}, outcome };
  }) as GrantLink['act'];
  push(request: ActRequest): ReturnType<GrantLink['act']> {
    const states = (request.args as { states: SignedOrgState[] }).states;
    this.pushes.push(states.map((s) => s.state.version));
    const outcome = (async (): Promise<ActOutcome> => {
      const hold = this.holdPush;
      this.holdPush = null;
      const scripted = this.pushScript.shift();
      if (hold !== null) await hold.promise;
      if (scripted !== undefined) return scripted;
      if (!this.up) return { state: 'refused', reason: 'offline' };
      const newest = states[states.length - 1].state;
      const mine = this.ledger.head ?? head;
      if (newest.version < mine.version) return { state: 'failed', error: { code: 'not-newer' } };
      if (newest.version > mine.version) this.ledger.head = newest;
      return { state: 'done', result: { version: newest.version } };
    })();
    return { opId: `push-${this.pushes.length}`, opCreated: new Date(NOW).toISOString(), progress: () => 'sent', onProgress: () => () => {}, outcome };
  }
}

/** This Mac's endpoint through its local door (local-door.ts): a grant that fails `verifyGrant` is the door's refusal. */
class FakeDoor implements GrantDoor {
  acts: Action[] = [];
  reads = 0;
  /** The answers to the next acts, in order, before the door's own. */
  script: unknown[] = [];
  constructor(readonly ledger: Ledger) {}
  async act(action: Action): Promise<unknown> {
    this.acts.push(action);
    if (this.script.length > 0) return this.script.shift();
    if (!isAction(action)) return { state: 'refused', reason: 'malformed' };
    const verdict = await verifyGrant(this.ledger.head ?? head, action.args.grant as Signed<Grant>, NO_CERTIFICATES, new Date(NOW));
    if (!verdict.ok) return { state: 'refused', reason: verdict.code };
    const result = await this.ledger.intake(action.args.grant);
    return result.ok ? { state: 'done', result: {} } : { state: 'failed', error: { code: result.code } };
  }
  async grants() {
    this.reads++;
    return { ok: true as const, output: this.ledger.answer() };
  }
}

type Harness = Awaited<ReturnType<typeof harness>>;

async function harness(over: { damaged?: boolean } = {}) {
  const files = orgFiles({ userData: dir, log: () => {} });
  await files.ensure();
  const registration: { grants?: true } = {};
  if (over.damaged === true) {
    registration.grants = true;
    writeFileSync(join(dir, 'org', GRANTS_FILE), '{ not json', { mode: 0o600 });
  }
  let commits: Promise<unknown> = Promise.resolve();
  let turns = 0;
  const commit = <T>(body: () => Promise<T>) => {
    turns++;
    const turn = commits.then(body);
    commits = turn.catch(() => {});
    return turn;
  };
  const writes = { fail: false };
  const written: typeof files = { ...files, write: async (name, value) => (writes.fail ? Promise.reject(new Error('disk full')) : files.write(name, value)) };
  const store = createGrantsStore({ files: written, commit, registration: () => registration, markRegistration: async () => void (registration.grants = true) });
  const prompts: StepUpPrompt[] = [];
  const confirm = { answer: { ok: true } as Awaited<ReturnType<Confirm>>, during: null as (() => Promise<void> | void) | null };
  const signer = await createRecordSigner({
    key: aKey,
    confirm: async (prompt) => {
      prompts.push(prompt);
      await confirm.during?.();
      return confirm.answer;
    },
  });
  const mini = new FakeLink(new Ledger(MINI, await keyId(keys[MINI].pub)));
  const studio = new FakeLink(new Ledger(STUDIO, await keyId(keys[STUDIO].pub)));
  const shared = new FakeLink(new Ledger(SHARED, await keyId(keys[SHARED].pub)));
  const door = new FakeDoor(new Ledger(HOME, await keyId(keys[HOME].pub)));
  const links = new Map<string, FakeLink>([
    [MINI, mini],
    [STUDIO, studio],
    [SHARED, shared],
  ]);
  const session = { signIn: 1, signedIn: true };
  const clock = { now: NOW };
  const changed: string[] = [];
  const logs: string[] = [];
  const roster = new Set<() => void>();
  // The held view's line as the push reads it: versions 1 … head's, the head itself last.
  const view = () =>
    ({
      head: () => ({ state: head }),
      since: () => ({ states: Array.from({ length: head.version }, (_, i) => ({ state: i === head.version - 1 ? head : { ...head, version: i + 1 }, sigs: [] })), transitions }),
    }) as unknown as HeldOrg;
  const push = createHeadPush({ link: (ref) => links.get(ref) ?? null, view, log: (line) => void logs.push(line) });
  made.push(push);
  const grants = createGrants({
    context: (): GrantsContext | null => (session.signedIn ? { org: ORG, member: A, device: 'dev-a', head, certificates: NO_CERTIFICATES, signer, signIn: session.signIn } : null),
    store: () => store,
    local: HOME,
    door,
    link: (ref) => links.get(ref) ?? null,
    roster: () => [MINI, STUDIO, SHARED],
    onRoster: (listener) => {
      roster.add(listener);
      return () => void roster.delete(listener);
    },
    changed: (ref) => void changed.push(ref),
    bringTo: (ref, version) => push.bringTo(ref, version),
    now: () => clock.now,
    log: (line) => void logs.push(line),
  });
  made.push(grants);
  const disk = (): GrantsFile => JSON.parse(readFileSync(join(dir, 'org', GRANTS_FILE), 'utf8')) as GrantsFile;
  const issued = (ref: string, member: string) => {
    try {
      return disk().issued.find((i) => i.signed.body.machine === ref && i.signed.body.member === member);
    } catch {
      return undefined;
    }
  };
  return {
    grants,
    prompts,
    confirm,
    mini,
    studio,
    shared,
    door,
    session,
    changed,
    logs,
    disk,
    issued,
    signOut: () => {
      session.signedIn = false;
      session.signIn++;
      grants.fence();
    },
    signIn: () => void (session.signedIn = true),
    clock,
    writes,
    /** The commit queue held from now until the release it answers, and how many turns were asked of it. */
    block: () => {
      const held = deferred();
      void commit(() => held.promise);
      return held.resolve;
    },
    turns: () => turns,
  };
}

/** A grant signed by `key` for `member` on `ref`, as another device of the org would sign it. */
async function signedBy(key: SigningKey, ref: string, member: string, rights: Right[], version: number): Promise<Signed<Grant>> {
  const body: Grant = { org: ORG, machine: ref, machineKey: await keyId(keys[ref].pub), member, rights, version, issued: new Date(NOW).toISOString() };
  return signRecord(SIGNING_DOMAINS.grant, body, key.privateKey, key.pub);
}

const made: Array<Pick<Grants, 'close'>> = [];
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'maws-grants-'));
  aKey ??= await generateSigningKey();
  cKey ??= await generateSigningKey();
  keys = Object.fromEntries(await Promise.all([MINI, HOME, STUDIO, SHARED].map(async (ref) => [ref, await generateSigningKey()] as const)));
  head = await stateWith(keys);
  transitions = [];
});
afterEach(async () => {
  for (const g of made.splice(0)) await g.close();
  await rm(dir, { recursive: true, force: true });
});

const okView = async (h: Harness, ref: string) => {
  const view = GrantsViewSchema.parse(await h.grants.view({ ref }));
  if (!view.ok) throw new Error(`the view refused: ${view.reason}`);
  return view;
};

describe('the version', () => {
  it('is above the ledger’s mark, even for a member whose grant is gone while the mark stays', async () => {
    const h = await harness();
    // A revoked signer's grant was dropped by the ledger; its mark stays at 4.
    h.mini.ledger.highWater[B] = 4;
    const result = await h.grants.set({ ref: MINI, member: B, rights: ['spawn'] });
    expect(result).toEqual({ ok: true, version: 5, delivered: 'done' });
    expect(h.mini.ledger.grants[B].body).toMatchObject({ version: 5, rights: ['spawn'], member: B, machine: MINI, machineKey: await keyId(keys[MINI].pub) });
  });

  it('is above the issued record’s too, when the record is ahead of the ledger', async () => {
    const h = await harness();
    // the act can't go: the grant stays pending at 1
    h.mini.script.push({ state: 'refused', reason: 'offline' });
    expect(await h.grants.set({ ref: MINI, member: B, rights: ['spawn'] })).toEqual({ ok: true, version: 1, delivered: 'pending' });
    // The ledger never saw it (mark 0); the next grant still goes above the record's 1.
    expect(await h.grants.set({ ref: MINI, member: B, rights: ['spawn', 'shell'] })).toEqual({ ok: true, version: 2, delivered: 'done' });
    expect(h.mini.ledger.grants[B].body.rights).toEqual(['spawn', 'shell']);
    expect(nextVersion(undefined, 0)).toBe(1);
  });

  it('refuses `ledger-unread` when the ledger can’t be read, before anything is asked or kept', async () => {
    const h = await harness();
    h.mini.callFails = { ok: false, error: { code: 'unavailable' } };
    expect(await h.grants.set({ ref: MINI, member: B, rights: ['spawn'] })).toMatchObject({ ok: false, reason: 'ledger-unread' });
    h.mini.up = false;
    expect(await h.grants.set({ ref: MINI, member: B, rights: ['spawn'] })).toMatchObject({ ok: false, reason: 'ledger-unread' });
    expect(h.prompts).toEqual([]);
    expect(h.mini.acts).toEqual([]);
    expect(h.issued(MINI, B)).toBeUndefined();
  });

  it('on `not-newer`, reads once more and answers “another device changed it”: one more confirmation, started by the person', async () => {
    const h = await harness();
    // Another owner's device signs a higher version while this one is asked.
    h.confirm.during = async () => {
      h.confirm.during = null;
      await h.mini.ledger.intake(await signedBy(aKey, MINI, B, ['shell'], 3));
    };
    const first = await h.grants.set({ ref: MINI, member: B, rights: ['spawn'] });
    expect(first).toEqual({ ok: true, version: 1, delivered: { refused: 'not-newer' } });
    expect(h.prompts).toHaveLength(1);
    expect(h.mini.acts).toHaveLength(1); // never sent again on its own
    expect(h.mini.calls).toBe(2); // the read before signing, and the one more after not-newer
    expect(h.issued(MINI, B)?.delivered).toEqual({ refused: 'not-newer' });
    const view = await okView(h, MINI);
    expect(view.grants).toEqual([{ member: B, rights: ['shell'], version: 3, state: 'on-machine' }]);
    // "Sign again": one more confirmation, above the new mark.
    expect(await h.grants.set({ ref: MINI, member: B, rights: ['spawn'] })).toEqual({ ok: true, version: 4, delivered: 'done' });
    expect(h.prompts).toHaveLength(2);
  });

  it('reads a resend of a grant the ledger already kept (`not-newer`, this very grant) as done', async () => {
    const h = await harness();
    // The first send lands, but its answer is lost: unknown, so the grant stays pending.
    const hold = (h.mini.holdAct = deferred());
    h.mini.script.push({ state: 'unknown', reason: 'channel-lost' });
    const answer = h.grants.set({ ref: MINI, member: B, rights: ['spawn'] });
    await until(() => h.mini.acts.length === 1, 'the act sent');
    await h.mini.ledger.intake((h.mini.acts[0].args as { grant: Signed<Grant> }).grant);
    hold.resolve();
    expect(await answer).toEqual({ ok: true, version: 1, delivered: 'pending' });
    // The next pass sends it again: not-newer, and the ledger holds this very grant.
    await h.grants.send();
    expect(h.mini.acts).toHaveLength(2);
    expect(h.issued(MINI, B)?.delivered).toBe('done');
  });
});

describe('signing', () => {
  it('refuses a non-owner’s grant before Touch ID, and brings an owner’s draft to exactly one confirmation', async () => {
    const h = await harness();
    const refused = await h.grants.set({ ref: STUDIO, member: B, rights: ['spawn'] });
    expect(refused).toMatchObject({ ok: false, reason: 'ineligible', problems: ['signer-not-owner'] });
    expect(h.prompts).toEqual([]);
    expect(h.studio.calls).toBe(0); // judged before the ledger is read
    expect(h.studio.acts).toEqual([]);

    expect(await h.grants.set({ ref: MINI, member: B, rights: ['spawn', 'machine-admin'] })).toMatchObject({ ok: true });
    expect(h.prompts).toHaveLength(1);
    expect(h.prompts[0].summary).toBe('Grant spawn, machine-admin on mini to bea@example.com');
    expect(h.prompts[0].text).toBe(`Machine: mini (${MINI})\nMember: bea@example.com\nRights: spawn, machine-admin\nVersion: 1`);
    // An admin grants on an org-owned machine.
    expect(await h.grants.set({ ref: SHARED, member: B, rights: ['shell'] })).toMatchObject({ ok: true, delivered: 'done' });
  });

  it('judges the draft again on the head held after the ledger read, before Touch ID', async () => {
    const h = await harness();
    const hold = (h.mini.holdCall = deferred());
    const answer = h.grants.set({ ref: MINI, member: B, rights: ['spawn'] });
    await until(() => h.mini.calls === 1, 'the read out');
    head = { ...head, version: 8, machines: head.machines.map((m) => (m.ref === MINI ? { ...m, owners: [C] } : m)) };
    hold.resolve();
    expect(await answer).toMatchObject({ ok: false, reason: 'ineligible', problems: ['signer-not-owner'] });
    expect(h.prompts).toEqual([]);
  });

  it('refuses an unknown member or machine, a right named twice, and the rights the member already holds', async () => {
    const h = await harness();
    expect(await h.grants.set({ ref: MINI, member: 'dddddddddddddddddddddddddddddddd', rights: ['spawn'] })).toMatchObject({ ok: false, reason: 'ineligible', problems: ['member-not-listed'] });
    expect(await h.grants.set({ ref: 'mref-unknown-0001', member: B, rights: ['spawn'] })).toMatchObject({ ok: false, reason: 'ineligible', problems: ['machine-not-listed'] });
    expect(await h.grants.set({ ref: MINI, member: B, rights: ['spawn', 'spawn'] })).toMatchObject({ ok: false, reason: 'invalid' });
    expect(await h.grants.set({ ref: MINI, member: B, rights: [] })).toMatchObject({ ok: false, reason: 'no-change' });
    await h.grants.set({ ref: MINI, member: B, rights: ['shell', 'spawn'] });
    expect(await h.grants.set({ ref: MINI, member: B, rights: ['spawn', 'shell'] })).toMatchObject({ ok: false, reason: 'no-change' });
    expect(h.prompts).toHaveLength(1);
  });

  it('withdraws with a grant of no rights at the next version', async () => {
    const h = await harness();
    await h.grants.set({ ref: MINI, member: B, rights: ['spawn'] });
    expect(await h.grants.set({ ref: MINI, member: B, rights: [] })).toEqual({ ok: true, version: 2, delivered: 'done' });
    expect(h.prompts[1].summary).toBe("Withdraw bea@example.com's rights on mini");
    expect(h.prompts[1].text).toContain('Rights: none (withdraws every right)');
    expect(h.mini.ledger.grants[B].body.rights).toEqual([]);
    expect((await okView(h, MINI)).grants).toEqual([]);
  });

  it('verifies the signed grant against the head held after Touch ID: one no longer valid is neither kept nor sent', async () => {
    const h = await harness();
    h.confirm.during = () => {
      // the machine's owners change while the person is asked
      head = { ...head, version: 8, machines: head.machines.map((m) => (m.ref === MINI ? { ...m, owners: [C] } : m)) };
    };
    expect(await h.grants.set({ ref: MINI, member: B, rights: ['spawn'] })).toEqual({ ok: false, reason: 'refused', detail: 'unknown-signer' }); // the verdict's code alone: the sheet's line says the rest (U11a board 540)
    expect(h.prompts).toHaveLength(1);
    expect(h.issued(MINI, B)).toBeUndefined();
    expect(h.mini.acts).toEqual([]);
  });

  it('refuses a grant whose head moved between its verification and its keep (the queued commit): nothing kept or sent', async () => {
    const h = await harness();
    let release: (() => void) | null = null;
    let turns = 0;
    h.confirm.during = () => {
      release = h.block(); // the commit queue busy with another writer when the keep asks for its turn
      turns = h.turns();
    };
    const answer = h.grants.set({ ref: MINI, member: B, rights: ['spawn'] });
    await until(() => release !== null && h.turns() > turns, 'the keep queued');
    // An adoption lands first: the machine's owners change, this member and device stay listed.
    head = { ...head, version: 8, machines: head.machines.map((m) => (m.ref === MINI ? { ...m, owners: [C] } : m)) };
    release!();
    expect(await answer).toMatchObject({ ok: false, reason: 'stale' });
    expect(h.issued(MINI, B)).toBeUndefined();
    expect(h.mini.acts).toEqual([]);
  });

  it('refuses a re-grant whose head moved between verification and keep the same way', async () => {
    const h = await harness();
    await h.grants.set({ ref: MINI, member: B, rights: ['spawn'] });
    h.mini.ledger.grants = {};
    h.mini.ledger.highWater = {};
    const view = await okView(h, MINI);
    let release: (() => void) | null = null;
    let turns = 0;
    h.confirm.during = () => {
      release = h.block();
      turns = h.turns();
    };
    const answer = h.grants.regrant({ ref: MINI, digest: view.digest! });
    await until(() => release !== null && h.turns() > turns, 'the keep queued');
    head = { ...head, version: 8, machines: head.machines.map((m) => (m.ref === MINI ? { ...m, owners: [C] } : m)) };
    release!();
    expect(await answer).toMatchObject({ ok: false, reason: 'stale' });
    expect(h.issued(MINI, B)?.signed.body.version).toBe(1);
    expect(h.mini.acts).toHaveLength(1);
  });

  it('refuses `storage` when the record can’t be written, and sends nothing', async () => {
    const h = await harness();
    await h.grants.set({ ref: MINI, member: B, rights: ['spawn'] }); // the file exists, its mark written
    h.writes.fail = true;
    expect(await h.grants.set({ ref: MINI, member: C, rights: ['spawn'] })).toMatchObject({ ok: false, reason: 'storage' });
    expect(h.mini.acts).toHaveLength(1);
  });

  it('signs nothing on a cancel, and one grant at a time', async () => {
    const h = await harness();
    h.confirm.answer = { ok: false, reason: 'cancelled' };
    expect(await h.grants.set({ ref: MINI, member: B, rights: ['spawn'] })).toMatchObject({ ok: false, reason: 'cancelled' });
    expect(h.issued(MINI, B)).toBeUndefined();
    h.confirm.answer = { ok: true };
    const held = deferred();
    h.confirm.during = () => held.promise;
    const first = h.grants.set({ ref: MINI, member: B, rights: ['spawn'] });
    await until(() => h.prompts.length === 2, 'the second confirmation');
    expect(await h.grants.set({ ref: MINI, member: C, rights: ['spawn'] })).toMatchObject({ ok: false, reason: 'busy' });
    held.resolve();
    expect(await first).toMatchObject({ ok: true });
  });
});

describe('delivery', () => {
  it('records pending before the send, then the outcome', async () => {
    const h = await harness();
    const hold = (h.mini.holdAct = deferred());
    let atSend: unknown;
    h.mini.onAct = () => (atSend = h.issued(MINI, B)?.delivered);
    const answer = h.grants.set({ ref: MINI, member: B, rights: ['spawn'] });
    await until(() => h.mini.acts.length === 1, 'the act sent');
    expect(atSend).toBe('sending'); // the write-ahead, just before the act
    expect(h.mini.acts[0]).toMatchObject({ action: 'endpoint.grant', stepUp: 'never' });
    hold.resolve();
    expect(await answer).toMatchObject({ delivered: 'done' });
    expect(h.issued(MINI, B)?.delivered).toBe('done');
    expect(h.changed).toContain(MINI);
  });

  it('sends an orphaned op (`unknown expired`) again at once, as a new op', async () => {
    const h = await harness();
    h.mini.script.push({ state: 'unknown', reason: 'expired' });
    expect(await h.grants.set({ ref: MINI, member: B, rights: ['spawn'] })).toMatchObject({ delivered: 'done' });
    expect(h.mini.acts).toHaveLength(2);
    expect(new Set(h.mini.opIds).size).toBe(2);
    expect(h.mini.acts[1].args).toEqual(h.mini.acts[0].args);
  });

  it('keeps an offline machine’s grant pending, and sends it when the link comes up', async () => {
    const h = await harness();
    h.mini.script.push({ state: 'refused', reason: 'offline' });
    expect(await h.grants.set({ ref: MINI, member: B, rights: ['spawn'] })).toMatchObject({ delivered: 'pending' });
    expect(h.issued(MINI, B)?.op).toBe(h.mini.opIds[0]);
    h.mini.setUp(false);
    h.mini.setUp(true);
    await until(() => h.issued(MINI, B)?.delivered === 'done', 'delivered at the link up');
    expect(h.issued(MINI, B)?.op).toBeUndefined();
    const view = await okView(h, MINI);
    expect(view.grants).toEqual([{ member: B, rights: ['spawn'], version: 1, state: 'on-machine' }]);
  });

  it('records the ledger’s own refusal (`not-held`) as final', async () => {
    const h = await harness();
    h.mini.ledger.heldKeys = ['AAAAAAAAAAAAAAAAAAAAAA']; // its ledger holds no such key
    expect(await h.grants.set({ ref: MINI, member: B, rights: ['spawn'] })).toMatchObject({ delivered: { refused: 'not-held' } });
    const view = await okView(h, MINI);
    expect(view.grants).toEqual([{ member: B, rights: ['spawn'], version: 1, state: 'refused', reason: 'not-held' }]);
  });

  it('keeps the head the grant was signed under with it', async () => {
    const h = await harness();
    await h.grants.set({ ref: MINI, member: B, rights: ['spawn'] });
    expect(h.issued(MINI, B)?.headVersion).toBe(head.version);
  });

  it('pushes the signing head to a machine one version behind (a member just added), then sends the grant: one confirmation', async () => {
    const h = await harness();
    h.mini.ledger.head = { ...head, members: head.members.filter((m) => m.id !== B) }; // 7: no B yet
    head = { ...head, version: 8 }; // B added
    expect(await h.grants.set({ ref: MINI, member: B, rights: ['spawn'] })).toEqual({ ok: true, version: 1, delivered: 'done' });
    // Its ledger answered no entry for B (its head doesn't list B): the head pushed, the ledger read once more.
    expect(h.mini.calls).toBe(2);
    expect(h.mini.pushes[0]).toEqual([7, 8]);
    expect(h.mini.ledger.head?.version).toBe(8);
    expect(h.mini.acts).toHaveLength(1);
    expect(h.prompts).toHaveLength(1);
  });

  it('refuses `ledger-unread`, asking nothing, when the push can’t bring the machine to the member: no mark is guessed', async () => {
    const h = await harness();
    h.mini.ledger.head = { ...head, members: head.members.filter((m) => m.id !== B) };
    head = { ...head, version: 8 };
    h.mini.pushScript.push({ state: 'refused', reason: 'offline' });
    expect(await h.grants.set({ ref: MINI, member: B, rights: ['spawn'] })).toMatchObject({ ok: false, reason: 'ledger-unread' });
    expect(h.mini.pushes).toHaveLength(1);
    expect(h.prompts).toEqual([]);
    expect(h.issued(MINI, B)).toBeUndefined();
  });

  it('refuses `ledger-unread` through the door when this Mac’s own endpoint hasn’t seen the member yet: nothing to push, try again shortly', async () => {
    const h = await harness();
    h.door.ledger.head = { ...head, members: head.members.filter((m) => m.id !== B) };
    head = { ...head, version: 8 };
    const answer = await h.grants.set({ ref: HOME, member: B, rights: ['spawn'] });
    expect(answer).toMatchObject({ ok: false, reason: 'ledger-unread' });
    expect(answer).toEqual({ ok: false, reason: 'ledger-unread', detail: 'this Mac’s own endpoint hasn’t seen this member yet' }); // the sheet's line says to try again (U11a board 540)
    expect(h.prompts).toEqual([]);
  });

  it('pushes the held head before a re-grant too, when the machine’s ledger answers none of the missing members', async () => {
    const h = await harness();
    await h.grants.set({ ref: MINI, member: B, rights: ['spawn'] });
    h.mini.ledger.grants = {};
    h.mini.ledger.highWater = {};
    const view = await okView(h, MINI);
    const pushed = h.mini.pushes.length;
    h.mini.ledger.head = { ...head, version: 6, members: head.members.filter((m) => m.id !== B) }; // behind, as one enrolled again from an older head
    expect(await h.grants.regrant({ ref: MINI, digest: view.digest! })).toEqual({ ok: true, results: [{ member: B, version: 2, delivered: 'done' }] });
    expect(h.mini.pushes[pushed]).toEqual([6, 7]); // before the read, then the delivery's own
    expect(h.prompts).toHaveLength(2);
  });

  it('sends nothing while the machine’s answer is below the signing head, the push has no answer or its link dropped: pending, sent at the next pass once it is there', async () => {
    const answers: ActOutcome[] = [
      { state: 'done', result: { version: 6 } },
      { state: 'unknown', reason: 'expired' },
      { state: 'refused', reason: 'offline' },
    ];
    for (const answer of answers) {
      const h = await harness();
      h.mini.pushScript.push(answer);
      if (answer.state === 'done') h.mini.pushScript.push(answer); // the forward run after it answers no further
      expect(await h.grants.set({ ref: MINI, member: B, rights: ['spawn'] }), JSON.stringify(answer)).toMatchObject({ delivered: 'pending' });
      expect(h.mini.acts).toEqual([]);
      expect(h.issued(MINI, B)?.delivered).toBe('pending');
      await h.grants.send();
      expect(h.mini.acts).toHaveLength(1);
      expect(h.issued(MINI, B)?.delivered).toBe('done');
      await h.grants.close();
    }
  });

  it('sends nothing when the app’s line moved while the push was out, and reads pending meanwhile', async () => {
    const h = await harness();
    const hold = (h.mini.holdPush = deferred());
    const answer = h.grants.set({ ref: MINI, member: B, rights: ['spawn'] });
    await until(() => h.mini.pushes.length === 1, 'the push sent');
    expect((await okView(h, MINI)).grants).toEqual([{ member: B, rights: ['spawn'], version: 1, state: 'pending' }]);
    // A recovery adopted while the push was out: the machine's answer is for a line the app has left.
    transitions = [{ body: { org: ORG, fromVersion: 6, newRootKeys: [], issued: new Date(NOW).toISOString() }, kid: 'k', sig: 's' } as unknown as Signed<RootTransition>];
    hold.resolve();
    expect(await answer).toMatchObject({ delivered: 'pending' });
    expect(h.mini.acts).toEqual([]);
    await h.grants.send();
    expect(h.mini.pushes.at(-1)).toEqual([6, 7]); // the recovery-first run on the new line
    expect(h.issued(MINI, B)?.delivered).toBe('done');
  });

  it('records every verdict final, through the link and the door, in either shape: never sent again', async () => {
    for (const code of ['malformed', 'bad-signature', 'revoked', 'not-listed', 'unknown-signer', 'contested', 'not-held', 'other-machine']) {
      for (const shape of ['failed', 'refused'] as const) {
        const h = await harness();
        const outcome = shape === 'failed' ? ({ state: 'failed', error: { code } } as const) : ({ state: 'refused', reason: code } as const);
        h.mini.script.push(outcome);
        expect(await h.grants.set({ ref: MINI, member: B, rights: ['spawn'] }), `${code} as ${shape}`).toMatchObject({ delivered: { refused: code } });
        h.door.script.push(outcome);
        expect(await h.grants.set({ ref: HOME, member: B, rights: ['spawn'] }), `${code} as ${shape} at the door`).toMatchObject({ delivered: { refused: code } });
        await h.grants.send();
        h.mini.setUp(false);
        h.mini.setUp(true);
        await h.grants.send();
        expect(h.mini.acts).toHaveLength(1);
        expect(h.door.acts).toHaveLength(1);
        await h.grants.close();
      }
    }
  });

  it('never resends a refused grant, though a later head would take it: signing it again is a new confirmation', async () => {
    const h = await harness();
    h.mini.script.push({ state: 'failed', error: { code: 'unknown-signer' } });
    expect(await h.grants.set({ ref: MINI, member: B, rights: ['spawn'] })).toMatchObject({ delivered: { refused: 'unknown-signer' } });
    head = { ...head, version: 8 }; // a later head (the ownership restored)
    h.mini.setUp(false);
    h.mini.setUp(true);
    await h.grants.send();
    expect(h.mini.acts).toHaveLength(1);
    expect((await okView(h, MINI)).grants).toEqual([{ member: B, rights: ['spawn'], version: 1, state: 'refused', reason: 'unknown-signer' }]);
    expect(await h.grants.set({ ref: MINI, member: B, rights: ['spawn'] })).toEqual({ ok: true, version: 2, delivered: 'done' });
    expect(h.prompts).toHaveLength(2);
    expect(h.mini.acts).toHaveLength(2);
  });

  it('sends through the door at once, with no push (its head can’t be read), and records a refusal from a door behind as final', async () => {
    const h = await harness();
    // Its head lags the one this Mac signs under: it still lists another owner for its machine.
    h.door.ledger.head = { ...head, version: 6, machines: head.machines.map((m) => (m.ref === HOME ? { ...m, owners: [C] } : m)) };
    expect(await h.grants.set({ ref: HOME, member: B, rights: ['spawn'] })).toMatchObject({ delivered: { refused: 'unknown-signer' } });
    await h.grants.send();
    expect(h.door.acts).toHaveLength(1);
    expect(h.mini.pushes).toEqual([]);
    h.door.ledger.heldKeys = ['AAAAAAAAAAAAAAAAAAAAAA'];
    h.door.ledger.head = null;
    expect(await h.grants.set({ ref: HOME, member: C, rights: ['spawn'] })).toMatchObject({ delivered: { refused: 'not-held' } });
  });

  it('delivers a grant under the head it was kept with, not the one before Touch ID', async () => {
    const h = await harness();
    h.mini.ledger.head = { ...head }; // 7
    h.confirm.during = () => void (head = { ...head, version: 8 });
    h.mini.pushScript.push({ state: 'done', result: { version: 7 } }, { state: 'done', result: { version: 7 } });
    expect(await h.grants.set({ ref: MINI, member: B, rights: ['spawn'] })).toMatchObject({ delivered: 'pending' });
    expect(h.issued(MINI, B)?.headVersion).toBe(8);
    expect(h.mini.acts).toEqual([]);
  });

  it('delivers a re-grant under the head it was kept with, not the one before Touch ID', async () => {
    const g = await harness();
    await g.grants.set({ ref: MINI, member: B, rights: ['spawn'] });
    g.mini.ledger.grants = {};
    g.mini.ledger.highWater = {};
    const view = await okView(g, MINI);
    g.mini.ledger.head = { ...head }; // 8
    g.confirm.during = () => void (head = { ...head, version: 9 });
    g.mini.pushScript.push({ state: 'done', result: { version: 8 } }, { state: 'done', result: { version: 8 } });
    expect(await g.grants.regrant({ ref: MINI, digest: view.digest! })).toEqual({ ok: true, results: [{ member: B, version: 2, delivered: 'pending' }] });
    expect(g.issued(MINI, B)?.headVersion).toBe(9);
    expect(g.mini.acts).toHaveLength(1); // the first grant's act only
  });

  it('goes through the local door for this Mac’s own machine, and over the link for every other one', async () => {
    const h = await harness();
    expect(await h.grants.set({ ref: HOME, member: B, rights: ['spawn'] })).toEqual({ ok: true, version: 1, delivered: 'done' });
    expect(h.door.reads).toBe(1);
    expect(h.door.acts).toHaveLength(1);
    const action = h.door.acts[0];
    expect(isAction(action)).toBe(true);
    expect(action).toMatchObject({ v: 1, org: ORG, machine: HOME, device: 'dev-a', action: 'endpoint.grant' });
    expect(action.stepUp).toBeUndefined();
    expect(await verifyGrant(head, action.args.grant as Signed<Grant>, NO_CERTIFICATES, new Date(NOW))).toEqual({ ok: true });
    expect(h.mini.calls + h.mini.acts.length).toBe(0);

    expect(await h.grants.set({ ref: MINI, member: B, rights: ['spawn'] })).toMatchObject({ delivered: 'done' });
    expect(h.door.reads + h.door.acts.length).toBe(2); // nothing more through the door
    expect(h.mini.calls).toBe(1);
    expect(h.mini.acts).toHaveLength(1);
  });

});

describe('missing grants', () => {
  /** B granted spawn on mini at 3 under the old key; mini then enrolled again with a new key and an empty ledger. */
  async function reenrolled(h: Harness) {
    for (let v = 0; v < 3; v++) await h.grants.set({ ref: MINI, member: B, rights: v % 2 === 0 ? ['spawn'] : ['shell'] });
    expect(h.issued(MINI, B)).toMatchObject({ delivered: 'done', signed: { body: { version: 3, rights: ['spawn'] } } });
    const fresh = await generateSigningKey();
    keys[MINI] = fresh;
    head = { ...head, version: 9, machines: head.machines.map((m) => (m.ref === MINI ? { ...m, pub: fresh.pub } : m)) };
    h.mini.ledger.grants = {};
    h.mini.ledger.highWater = {};
    h.mini.ledger.heldKeys = [await keyId(fresh.pub)];
  }

  it('finds a grant the ledger lost (enrolled again with a new key), and re-grants it for the current key above both marks', async () => {
    const h = await harness();
    await reenrolled(h);
    const view = await okView(h, MINI);
    expect(view.missing).toEqual([{ member: B, rights: ['spawn'], version: 3 }]);
    expect(view.digest).not.toBeNull();
    const prompts = h.prompts.length;
    const result = await h.grants.regrant({ ref: MINI, digest: view.digest! });
    expect(result).toEqual({ ok: true, results: [{ member: B, version: 4, delivered: 'done' }] });
    expect(h.prompts).toHaveLength(prompts + 1);
    expect(h.prompts.at(-1)!.summary).toBe('Re-grant spawn on mini to bea@example.com');
    expect(h.mini.ledger.grants[B].body).toMatchObject({ machineKey: await keyId(keys[MINI].pub), rights: ['spawn'], version: 4 });
    expect((await okView(h, MINI)).missing).toEqual([]);
  });

  it('finds them on a ledger kept but lost member by member, re-granting several under one confirmation', async () => {
    const h = await harness();
    await h.grants.set({ ref: MINI, member: B, rights: ['spawn'] });
    await h.grants.set({ ref: MINI, member: C, rights: ['shell'] });
    h.mini.ledger.grants = {};
    h.mini.ledger.highWater = {};
    const view = await okView(h, MINI);
    expect(view.missing).toEqual([
      { member: B, rights: ['spawn'], version: 1 },
      { member: C, rights: ['shell'], version: 1 },
    ]);
    const prompts = h.prompts.length;
    expect(await h.grants.regrant({ ref: MINI, digest: view.digest! })).toEqual({
      ok: true,
      results: [
        { member: B, version: 2, delivered: 'done' },
        { member: C, version: 2, delivered: 'done' },
      ],
    });
    expect(h.prompts).toHaveLength(prompts + 1);
    expect(h.prompts.at(-1)!.summary).toBe('Re-grant 2 grants on mini');
    expect(h.prompts.at(-1)!.text).toContain('1 of 2\nMachine: mini');
  });

  it('never offers a withdrawal, a grant still deliverable for the current key, one another device replaced, or one a kept ledger still holds', async () => {
    const h = await harness();
    const key = await keyId(keys[MINI].pub);
    await h.grants.set({ ref: MINI, member: B, rights: ['spawn'] });
    await h.grants.set({ ref: MINI, member: B, rights: [] }); // withdrawn
    await h.grants.set({ ref: MINI, member: C, rights: ['spawn'] }); // kept by the ledger
    h.mini.ledger.grants = { [C]: h.mini.ledger.grants[C] };
    h.mini.ledger.highWater = { [C]: 1 };
    expect(missingGrants(h.disk(), MINI, h.mini.ledger.answer().members, key)).toEqual([]);
    // Another device's higher grant: the ledger's mark is past this Mac's.
    h.mini.ledger.highWater[C] = 5;
    expect(missingGrants(h.disk(), MINI, h.mini.ledger.answer().members, key)).toEqual([]);
    // A pending one for the machine's current key is still on its way: not missing.
    h.mini.script.push({ state: 'refused', reason: 'offline' });
    await h.grants.set({ ref: MINI, member: B, rights: ['shell'] });
    h.mini.ledger.highWater = {};
    expect(missingGrants(h.disk(), MINI, h.mini.ledger.answer().members, key).map((i) => i.signed.body.member)).toEqual([C]);
    expect((await okView(h, MINI)).missing).toEqual([{ member: C, rights: ['spawn'], version: 1 }]);
  });

  it('recovers a grant whose reply was lost before the machine was enrolled again: pending for the old key, re-granted for the new', async () => {
    const h = await harness();
    // The machine takes it, but its answer is lost: this Mac keeps it pending.
    h.mini.script.push({ state: 'unknown', reason: 'channel-lost' });
    expect(await h.grants.set({ ref: MINI, member: B, rights: ['spawn'] })).toMatchObject({ delivered: 'pending' });
    // Enrolled again with a new key and an empty ledger.
    const fresh = await generateSigningKey();
    keys[MINI] = fresh;
    head = { ...head, version: 9, machines: head.machines.map((m) => (m.ref === MINI ? { ...m, pub: fresh.pub } : m)) };
    h.mini.ledger.grants = {};
    h.mini.ledger.highWater = {};
    h.mini.ledger.heldKeys = [await keyId(fresh.pub)];
    const view = await okView(h, MINI);
    expect(view.missing).toEqual([{ member: B, rights: ['spawn'], version: 1 }]);
    // The same rights again are no no-change: the pending intent names a key the machine no longer holds.
    expect(await h.grants.set({ ref: MINI, member: B, rights: ['spawn'] })).toEqual({ ok: true, version: 2, delivered: 'done' });
    expect(h.mini.ledger.grants[B].body.machineKey).toBe(await keyId(fresh.pub));
    expect((await okView(h, MINI)).missing).toEqual([]);
  });

  it('re-grants that lost-reply grant through Re-grant… too', async () => {
    const h = await harness();
    h.mini.script.push({ state: 'unknown', reason: 'channel-lost' });
    await h.grants.set({ ref: MINI, member: B, rights: ['spawn'] });
    const fresh = await generateSigningKey();
    keys[MINI] = fresh;
    head = { ...head, version: 9, machines: head.machines.map((m) => (m.ref === MINI ? { ...m, pub: fresh.pub } : m)) };
    h.mini.ledger.grants = {};
    h.mini.ledger.highWater = {};
    h.mini.ledger.heldKeys = [await keyId(fresh.pub)];
    const view = await okView(h, MINI);
    expect(await h.grants.regrant({ ref: MINI, digest: view.digest! })).toEqual({ ok: true, results: [{ member: B, version: 2, delivered: 'done' }] });
  });

  it('still finds the lost-reply grant once a pass resent it and the re-enrolled machine refused it (`not-listed`, its key no longer current)', async () => {
    const h = await harness();
    h.mini.script.push({ state: 'unknown', reason: 'channel-lost' });
    await h.grants.set({ ref: MINI, member: B, rights: ['spawn'] });
    const fresh = await generateSigningKey();
    keys[MINI] = fresh;
    head = { ...head, version: 9, machines: head.machines.map((m) => (m.ref === MINI ? { ...m, pub: fresh.pub } : m)) };
    h.mini.ledger.grants = {};
    h.mini.ledger.highWater = {};
    h.mini.ledger.heldKeys = [await keyId(fresh.pub)];
    await h.grants.send(); // the machine judges it by verifyGrant first: the old key is not the machine's now
    expect(h.issued(MINI, B)).toMatchObject({ delivered: { refused: 'not-listed' } });
    const view = await okView(h, MINI);
    expect(view.missing).toEqual([{ member: B, rights: ['spawn'], version: 1 }]);
    expect(await h.grants.regrant({ ref: MINI, digest: view.digest! })).toEqual({ ok: true, results: [{ member: B, version: 2, delivered: 'done' }] });
  });

  it('judges no-change against the key that speaks for the machine after the ledger read, not before it', async () => {
    const h = await harness();
    h.mini.script.push({ state: 'refused', reason: 'offline' });
    await h.grants.set({ ref: MINI, member: B, rights: ['spawn'] }); // pending, for the machine's key now
    const fresh = await generateSigningKey();
    const hold = (h.mini.holdCall = deferred());
    const answer = h.grants.set({ ref: MINI, member: B, rights: ['spawn'] });
    await until(() => h.mini.calls > 0, 'the ledger read');
    // Enrolled again while the read was out: the pending grant names a key the machine no longer has.
    keys[MINI] = fresh;
    head = { ...head, version: 9, machines: head.machines.map((m) => (m.ref === MINI ? { ...m, pub: fresh.pub } : m)) };
    h.mini.ledger.heldKeys = [await keyId(fresh.pub)];
    hold.resolve();
    expect(await answer).toEqual({ ok: true, version: 2, delivered: 'done' });
    expect(h.mini.ledger.grants[B].body.machineKey).toBe(await keyId(fresh.pub));
  });

  it('refuses a re-grant whose missing grants are not the ones shown (`stale`), or when none is missing (`none`), asking nothing', async () => {
    const h = await harness();
    await reenrolled(h);
    const view = await okView(h, MINI);
    const prompts = h.prompts.length;
    expect(await h.grants.regrant({ ref: MINI, digest: 'another-digest' })).toMatchObject({ ok: false, reason: 'stale' });
    await h.grants.regrant({ ref: MINI, digest: view.digest! });
    expect(await h.grants.regrant({ ref: MINI, digest: view.digest! })).toMatchObject({ ok: false, reason: 'none' });
    expect(h.prompts).toHaveLength(prompts + 1);
  });
});

describe('the view', () => {
  it('reads the machine’s own word, marks this Mac’s pending grants, and shows the last answer as of its time while offline', async () => {
    const h = await harness();
    await h.mini.ledger.intake(await signedBy(aKey, MINI, C, ['shell'], 2)); // another of A's devices granted C
    h.mini.script.push({ state: 'refused', reason: 'offline' });
    await h.grants.set({ ref: MINI, member: B, rights: ['spawn'] });
    const live = await okView(h, MINI);
    expect(live).toMatchObject({ live: true, asOf: new Date(NOW).toISOString(), missing: [], digest: null });
    expect(live.grants).toEqual([
      { member: B, rights: ['spawn'], version: 1, state: 'pending' },
      { member: C, rights: ['shell'], version: 2, state: 'on-machine' },
    ]);
    h.mini.up = false;
    const offline = await okView(h, MINI);
    expect(offline).toMatchObject({ live: false, asOf: new Date(NOW).toISOString() });
    expect(offline.grants).toEqual(live.grants);
  });

  it('says so when grants.json is damaged, and signs no grant', async () => {
    const h = await harness({ damaged: true });
    expect(await h.grants.view({ ref: MINI })).toEqual({ ok: false, ref: MINI, reason: 'damaged' });
    expect(await h.grants.set({ ref: MINI, member: B, rights: ['spawn'] })).toMatchObject({ ok: false, reason: 'damaged' });
    expect(await h.grants.regrant({ ref: MINI, digest: 'x' })).toMatchObject({ ok: false, reason: 'damaged' });
    expect(h.prompts).toEqual([]);
    expect(h.mini.calls + h.mini.acts.length).toBe(0);
  });

  it('reads signed out with no sign-in, and drops the answers held for an ended one', async () => {
    const h = await harness();
    await okView(h, MINI);
    h.signOut();
    expect(await h.grants.view({ ref: MINI })).toEqual({ ok: false, ref: MINI, reason: 'signed-out' });
    h.signIn();
    h.mini.up = false;
    expect(await okView(h, MINI)).toMatchObject({ live: false, asOf: null });
  });
});

describe('a sign-in that ends mid-flight', () => {
  it('during Touch ID: nothing is kept or sent', async () => {
    const h = await harness();
    h.confirm.during = () => h.signOut();
    expect(await h.grants.set({ ref: MINI, member: B, rights: ['spawn'] })).toMatchObject({ ok: false, reason: 'cancelled' });
    expect(h.issued(MINI, B)).toBeUndefined();
    expect(h.mini.acts).toEqual([]);
  });

  it('while the ledger read is out: nothing is asked, kept or sent', async () => {
    const h = await harness();
    h.mini.holdCall = deferred();
    const hold = h.mini.holdCall;
    const answer = h.grants.set({ ref: MINI, member: B, rights: ['spawn'] });
    await until(() => h.mini.calls === 1, 'the read out');
    h.signOut();
    hold.resolve();
    expect(await answer).toMatchObject({ ok: false, reason: 'signed-out' });
    expect(h.prompts).toEqual([]);
    expect(h.issued(MINI, B)).toBeUndefined();
    expect(h.mini.acts).toEqual([]);
  });

  it('while the act is out: its outcome is recorded all the same (the record’s, not the sign-in’s)', async () => {
    const h = await harness();
    h.mini.holdAct = deferred();
    const hold = h.mini.holdAct;
    const answer = h.grants.set({ ref: MINI, member: B, rights: ['spawn'] });
    await until(() => h.mini.acts.length === 1, 'the act out');
    h.signOut();
    hold.resolve();
    expect(await answer).toMatchObject({ ok: true, delivered: 'done' });
    expect(h.issued(MINI, B)?.delivered).toBe('done');
  });

  it('a refusal that lands after a sign-out stays final: the next sign-in, ownership restored, never resends it', async () => {
    const h = await harness();
    h.mini.holdAct = deferred();
    const hold = h.mini.holdAct;
    h.mini.script.push({ state: 'failed', error: { code: 'unknown-signer' } });
    const answer = h.grants.set({ ref: MINI, member: B, rights: ['spawn'] });
    await until(() => h.mini.acts.length === 1, 'the act out');
    h.signOut();
    hold.resolve();
    expect(await answer).toMatchObject({ delivered: { refused: 'unknown-signer' } });
    head = { ...head, version: 8 }; // the ownership restored
    h.signIn();
    await h.grants.send();
    h.mini.setUp(false);
    h.mini.setUp(true);
    await h.grants.send();
    expect(h.mini.acts).toHaveLength(1);
    expect(h.issued(MINI, B)?.delivered).toEqual({ refused: 'unknown-signer' });
    expect((await okView(h, MINI)).grants).toEqual([{ member: B, rights: ['spawn'], version: 1, state: 'refused', reason: 'unknown-signer' }]);
  });

  it('a quit (close) during Touch ID, the read or the act joins it and writes nothing after', async () => {
    for (const at of ['confirm', 'read', 'act'] as const) {
      const h = await harness();
      const hold = deferred();
      if (at === 'confirm') h.confirm.during = () => hold.promise;
      if (at === 'read') h.mini.holdCall = hold;
      if (at === 'act') h.mini.holdAct = hold;
      const answer = h.grants.set({ ref: MINI, member: B, rights: ['spawn'] });
      await until(() => (at === 'confirm' ? h.prompts.length === 1 : at === 'read' ? h.mini.calls === 1 : h.mini.acts.length === 1), `the ${at} out`);
      const before = at === 'act' ? JSON.stringify(h.disk()) : null;
      let closed = false;
      const closing = h.grants.close().then(() => (closed = true));
      await new Promise((r) => setTimeout(r, 10));
      expect(closed, `close waits for the ${at}`).toBe(false);
      hold.resolve();
      await closing;
      await answer;
      // The act's outcome is the record's: written before the close resolves, nothing after it.
      if (at === 'act') expect(before).toContain('"sending"');
      if (at === 'act') expect(h.issued(MINI, B)?.delivered).toBe('done');
      else expect(h.issued(MINI, B)).toBeUndefined();
      const after = existsSync(join(dir, 'org', GRANTS_FILE)) ? readFileSync(join(dir, 'org', GRANTS_FILE), 'utf8') : null;
      await new Promise((r) => setTimeout(r, 10));
      expect(existsSync(join(dir, 'org', GRANTS_FILE)) ? readFileSync(join(dir, 'org', GRANTS_FILE), 'utf8') : null).toBe(after);
    }
  });
});

describe('a refused grant never lands without a new confirmation (the branch review)', () => {
  it('a pass holding an old snapshot sends nothing a re-grant has since replaced or refused', async () => {
    const h = await harness();
    h.shared.script.push({ state: 'refused', reason: 'offline' });
    await h.grants.set({ ref: SHARED, member: B, rights: ['spawn'] }); // pending, first in the file
    h.mini.script.push({ state: 'unknown', reason: 'channel-lost' }, { state: 'unknown', reason: 'channel-lost' });
    await h.grants.set({ ref: MINI, member: B, rights: ['spawn'] });
    await h.grants.set({ ref: MINI, member: C, rights: ['shell'] }); // both pending: their answers lost
    const fresh = await generateSigningKey();
    keys[MINI] = fresh;
    head = { ...head, version: 9, machines: head.machines.map((m) => (m.ref === MINI ? { ...m, pub: fresh.pub } : m)) };
    h.mini.ledger.grants = {};
    h.mini.ledger.highWater = {};
    h.mini.ledger.heldKeys = [await keyId(fresh.pub)];
    const view = await okView(h, MINI);
    expect(view.missing.map((m) => m.member)).toEqual([B, C]);
    // A pass takes its snapshot, then waits on the slow machine...
    const slow = (h.shared.holdAct = deferred());
    const passing = h.grants.send();
    await until(() => h.shared.acts.length === 2, 'the pass on the slow machine');
    // ...while the re-grant replaces both, B's refused.
    h.mini.script.push({ state: 'failed', error: { code: 'unknown-signer' } });
    const regranted = await h.grants.regrant({ ref: MINI, digest: view.digest! });
    expect(regranted).toMatchObject({ ok: true, results: [{ member: B, delivered: { refused: 'unknown-signer' } }, { member: C, delivered: 'done' }] });
    const acts = h.mini.acts.length;
    slow.resolve();
    await passing;
    expect(h.mini.acts).toHaveLength(acts); // neither the replaced grants nor the refused one
    expect(h.issued(MINI, B)?.delivered).toEqual({ refused: 'unknown-signer' });
  });

  it('a pass sends nothing a re-grant replaced while the pass’s head push was out (the write-ahead finds it no longer the latest)', async () => {
    const h = await harness();
    h.mini.script.push({ state: 'unknown', reason: 'channel-lost' });
    await h.grants.set({ ref: MINI, member: B, rights: ['spawn'] }); // pending: its answer lost
    const fresh = await generateSigningKey();
    keys[MINI] = fresh;
    head = { ...head, version: 9, machines: head.machines.map((m) => (m.ref === MINI ? { ...m, pub: fresh.pub } : m)) };
    h.mini.ledger.grants = {};
    h.mini.ledger.highWater = {};
    h.mini.ledger.heldKeys = [await keyId(fresh.pub)];
    const view = await okView(h, MINI);
    const pushed = (h.mini.holdPush = deferred());
    const passing = h.grants.send(); // the pass reads version 1 pending, and pushes
    await until(() => h.mini.pushes.length === 2, 'the pass’s push out');
    const regranted = h.grants.regrant({ ref: MINI, digest: view.digest! }); // keeps version 2, then joins that push
    await until(() => h.issued(MINI, B)?.signed.body.version === 2, 'the re-grant kept');
    const acts = h.mini.acts.length;
    pushed.resolve();
    expect(await regranted).toMatchObject({ ok: true, results: [{ member: B, version: 2, delivered: 'done' }] });
    await passing;
    expect(h.mini.acts.slice(acts).map((a) => (a.args as { grant: Signed<Grant> }).grant.body.version)).toEqual([2]);
  });

  it('a refusal whose outcome write fails is never resent: the write is retried, never the grant', async () => {
    const h = await harness();
    h.mini.script.push({ state: 'failed', error: { code: 'unknown-signer' } });
    h.mini.onAct = () => void (h.writes.fail = true); // the write-ahead landed; the outcome's write fails
    expect(await h.grants.set({ ref: MINI, member: B, rights: ['spawn'] })).toMatchObject({ ok: false, reason: 'storage' });
    h.mini.onAct = null;
    h.writes.fail = false;
    head = { ...head, version: 8 }; // the ownership restored
    await h.grants.send();
    expect(h.mini.acts).toHaveLength(1);
    expect(h.issued(MINI, B)?.delivered).toEqual({ refused: 'unknown-signer' }); // written at the pass
  });

  it('an entry left `sending` across a restart is final (`outcome-unknown`) and never sent; a `pending` one is sent', async () => {
    const h = await harness();
    h.shared.script.push({ state: 'refused', reason: 'offline' });
    await h.grants.set({ ref: SHARED, member: B, rights: ['spawn'] }); // pending: nothing ran
    const out = (h.mini.holdAct = deferred()); // the act out when the process ends
    void h.grants.set({ ref: MINI, member: B, rights: ['spawn'] });
    await until(() => h.mini.acts.length === 1, 'the act out');
    expect(h.disk().issued.map((i) => i.delivered)).toEqual(['pending', 'sending']);

    const again = await harness(); // the next start, over the same files
    await again.grants.send();
    expect(again.mini.acts).toEqual([]);
    expect(again.issued(MINI, B)?.delivered).toEqual({ refused: 'outcome-unknown' });
    expect(again.shared.acts).toHaveLength(1);
    expect(again.issued(SHARED, B)?.delivered).toBe('done');
    out.resolve(); // (the old process is gone in life; here it is let end)
  });
});

