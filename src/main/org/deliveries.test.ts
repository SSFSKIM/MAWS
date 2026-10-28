// Direct revocation delivery (P5 O8 M3, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M3's "Direct
// delivery" and Proves; Interfaces §K; RL §5.2): a state the app signs that ends a key is owed to every machine of the
// roster at its signing (less one the state removes), kept with its signed bytes in signing.json, and sent as
// `endpoint.state` runs paged forward through the app's own line until each machine acknowledges it, recovery first.
//
// Each machine is a fake link backed by a real `EndpointOrg` (src/endpoint/org-sync.ts) over a real endpoint state
// directory, answering an `endpoint.state` act exactly as the endpoint's `#deliver` does (endpoint.ts), through the
// endpoint ledger's outcome mapping (`outcomeOf`, actions.ts): `done {version}` or `failed {code}`. The app's side is the
// real held view (held.ts) and signing store over a temporary profile. Every state is signed and verified by the
// package. No hub is reached by the deliveries: none is given to them.
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  generateSigningKey,
  keyId,
  NO_CERTIFICATES,
  signOrgState,
  signRecord,
  SIGNING_DOMAINS,
  signTransition,
  stateHash,
  verifySuccessor,
  type Certificates,
  type Device,
  type OrgState,
  type RootTransition,
  type Signed,
  type SignedOrgState,
  type SigningKey,
} from '../../../apps/org-protocol/src/index.ts';
import { EndpointOrg } from '../../endpoint/org-sync';
import { EndpointState } from '../../endpoint/state/store';
import type { MachineRef } from '@shared/machine/ref';

vi.mock('electron', () => ({ systemPreferences: { promptTouchID: () => Promise.reject(new Error('no system prompt in the suites')) } }));

import { createStateSigner } from '../device/step-up';
import type { LinkState } from '../machines/manager';
import type { ActOutcome, ActRequest } from '../machines/remote/link';
import { createDeliveries, runBytes, type Deliveries, type DeliveryLink } from './deliveries';
import { orgFiles, SIGNING_FILE, type Obligation, type SigningFile } from './files';
import { startHeldOrg, type HeldOrg } from './held';
import type { HubClient, HubResult, Served } from './hub-client';
import { heldOrgSession, type SignedIn } from './session';
import { createOrgSigner, type Edit } from './signer';
import { createSigningStore, type SigningStore } from './signing-store';

const ORG = 'org-deliveries';
const DAY = 86_400_000;
const NOW = Date.parse('2026-10-28T12:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();
const memberId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');

// ---- The org ---------------------------------------------------------------------------------------------------------

type TestDevice = { device: Device; channel: SigningKey; stepUp: SigningKey };
async function newDevice(id: string): Promise<TestDevice> {
  const channel = await generateSigningKey();
  const stepUp = await generateSigningKey();
  return { channel, stepUp, device: { id, class: 'native-mac', keyStorage: 'software', channelPub: channel.pub, stepUpPub: stepUp.pub } };
}

const OWNER = memberId();
const M1 = 'machine-one-00000001' as MachineRef;
const M2 = 'machine-two-00000002' as MachineRef;
const M3 = 'machine-three-000003' as MachineRef;
type Keys = { admin: TestDevice; app: TestDevice; old: TestDevice; other: TestDevice; recovery: SigningKey; machines: Record<string, SigningKey> };
let made: Keys | null = null;
async function keys(): Promise<Keys> {
  made ??= {
    admin: await newDevice('dev-admin'),
    app: await newDevice('dev-app'),
    old: await newDevice('dev-old'),
    other: await newDevice('dev-other'),
    recovery: await generateSigningKey(),
    machines: { [M1]: await generateSigningKey(), [M2]: await generateSigningKey(), [M3]: await generateSigningKey() },
  };
  return made;
}

/** The genesis: the owner's devices (the deployment admin's and this Mac's both roots), three enrolled machines. */
async function genesis(issued = NOW - 90 * DAY): Promise<SignedOrgState> {
  const k = await keys();
  const names: Record<string, string> = { [M1]: 'one', [M2]: 'two', [M3]: 'three' };
  const state: OrgState = {
    org: ORG,
    version: 1,
    prev: null,
    issued: iso(issued),
    root: { keys: [await keyId(k.admin.stepUp.pub), await keyId(k.app.stepUp.pub)], recoveryPub: k.recovery.pub },
    members: [{ id: OWNER, email: 'owner@example.com', role: 'admin', devices: [k.admin.device, k.app.device, k.old.device, k.other.device] }],
    machines: [M1, M2, M3].map((ref) => ({ name: names[ref], ref, pub: k.machines[ref].pub, owners: 'org' as const })),
    machineNames: [M1, M2, M3].map((ref) => ({ name: names[ref], ref })),
    retired: [],
    revoked: [],
    delegations: [],
    projects: [],
  };
  return signOrgState(state, [k.admin.stepUp]);
}

/** `head`'s successor, signed by the deployment admin's root, `edit` applied. */
async function next(head: SignedOrgState, issued: number, edit: (s: OrgState) => void | Promise<void> = () => {}): Promise<SignedOrgState> {
  const state = structuredClone(head.state);
  state.version += 1;
  state.prev = await stateHash(head.state);
  state.issued = iso(Math.max(issued, Date.parse(head.state.issued)));
  await edit(state);
  return signOrgState(state, [(await keys()).admin.stepUp]);
}

/** `n` successors of `head`, a minute apart from `from`. */
async function run(head: SignedOrgState, n: number, from: number, edit?: (s: OrgState) => void): Promise<SignedOrgState[]> {
  const out: SignedOrgState[] = [];
  let at = head;
  for (let i = 0; i < n; i++) out.push((at = await next(at, from + i * 60_000, edit)));
  return out;
}

/** A device removed and both its keys revoked: a state that ends keys. */
const revokeDevice = (which: 'old' | 'other') => async (s: OrgState) => {
  const { device } = (await keys())[which];
  for (const m of s.members) m.devices = m.devices.filter((d) => d.id !== device.id);
  s.revoked.push(
    { keyId: await keyId(device.channelPub), holder: { member: OWNER, device: device.id, class: device.class, key: 'channel' } },
    { keyId: await keyId(device.stepUpPub!), holder: { member: OWNER, device: device.id, class: device.class, key: 'step-up' } },
  );
};

/** An enrolled machine removed from the org, its key revoked. */
const removeMachine = (ref: MachineRef) => async (s: OrgState) => {
  const entry = s.machines.find((m) => m.ref === ref)!;
  s.machines = s.machines.filter((m) => m.ref !== ref);
  s.revoked.push({ keyId: await keyId(entry.pub), holder: { machine: ref } });
};

/** The recovery key's transition rewinding to `fromVersion`, the deployment admin the one root after it. */
async function recoveryFrom(fromVersion: number, issued = NOW): Promise<Signed<RootTransition>> {
  const k = await keys();
  return signTransition({ org: ORG, fromVersion, newRootKeys: [k.admin.stepUp.pub], issued: iso(issued) }, k.recovery.privateKey, k.recovery.pub);
}
const dropAppRoot = (s: OrgState) => void (s.root.keys = s.root.keys.slice(0, 1));

// ---- A machine: a fake link over a real EndpointOrg -----------------------------------------------------------------

const dirs: string[] = [];
const closers: Array<() => void> = [];
afterEach(async () => {
  for (const close of closers.splice(0)) close();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

type Respond = 'deliver' | 'offline' | 'lose';

/**
 * One machine's link: `up` or down, `caps().stateVersion` the endpoint's live head (or a fixed, stale value), and each
 * `endpoint.state` act answered as the endpoint answers it. `script` answers the next acts in turn (`lose`: applied, its
 * answer lost; `offline`: nothing sent), then `respond`.
 */
class Machine implements DeliveryLink {
  runs: number[][] = [];
  script: Respond[] = [];
  respond: Respond = 'deliver';
  caps_: number | 'live' | null = 'live';
  up = true;
  /** Runs before each act's answer: what the app's files held as it was sent. */
  onAct: ((request: ActRequest) => void) | null = null;
  readonly #listeners = new Set<(state: LinkState) => void>();

  constructor(readonly org: EndpointOrg) {}

  state(): LinkState {
    return this.up ? 'up' : 'down';
  }
  setUp(up: boolean): void {
    this.up = up;
    for (const listener of [...this.#listeners]) listener(this.state());
  }
  onState(listener: (state: LinkState) => void): () => void {
    this.#listeners.add(listener);
    return () => void this.#listeners.delete(listener);
  }
  caps(): ReturnType<DeliveryLink['caps']> {
    const stateVersion = this.caps_ === 'live' ? this.org.head().state.version : this.caps_;
    return stateVersion === null ? null : { member: OWNER, device: 'dev-app', clientClass: 'native-mac', machine: { grades: [] }, stateVersion };
  }
  head(): SignedOrgState {
    return this.org.head();
  }
  act(request: ActRequest): ReturnType<DeliveryLink['act']> {
    expect(request).toMatchObject({ action: 'endpoint.state', stepUp: 'never' });
    const { states, transitions } = request.args as { states: SignedOrgState[]; transitions: Signed<RootTransition>[] };
    this.runs.push(states.map((s) => s.state.version));
    this.onAct?.(request);
    const respond = this.script.shift() ?? this.respond;
    const outcome = (async (): Promise<ActOutcome> => {
      if (respond === 'offline') return { state: 'refused', reason: 'offline' };
      const answer = await this.#deliver(states, transitions);
      return respond === 'lose' ? { state: 'unknown', reason: 'closed' } : answer;
    })();
    return { opId: 'op', opCreated: iso(NOW), progress: () => 'sent', onProgress: () => () => {}, outcome } as ReturnType<DeliveryLink['act']>;
  }

  /** endpoint.ts's `#deliver`, read through actions.ts's `outcomeOf`. */
  async #deliver(states: SignedOrgState[], transitions: Signed<RootTransition>[]): Promise<ActOutcome> {
    const result = await this.org.adopt(states, transitions ?? []);
    const head = this.org.head().state;
    if (result.adopted > 0) return { state: 'done', result: { version: head.version, ...(result.rewound ? { rewound: true } : {}) } };
    const held = states.find((s) => s?.state?.version === head.version);
    if (held !== undefined && (await stateHash(held.state)) === (await stateHash(head))) return { state: 'done', result: { version: head.version } };
    return { state: 'failed', error: { code: result.refused ?? 'not-newer' } };
  }
}

/** A machine whose endpoint holds `chain` (and `transitions`), its window cut at `now`. */
async function machine(chain: SignedOrgState[], options: { transitions?: Signed<RootTransition>[]; now?: number } = {}): Promise<Machine> {
  const g = chain[0];
  const state = EndpointState.open(await tempDir('maws-endpoint-'));
  state.setOrg({ version: 1, org: ORG, pinned: { roots: g.state.root.keys, recoveryPub: g.state.root.recoveryPub }, head: null, chain: [], hashes: [], certificates: NO_CERTIFICATES, acceptedTransitions: [], highWater: 0 });
  const org = new EndpointOrg(state, { log: () => {}, now: () => options.now ?? NOW });
  const first = chain.findIndex((s, i) => i > 0 && s.state.version !== chain[i - 1].state.version + 1);
  // A chain with a rewind in it (the superseded states, then the recovered line) is adopted in two steps.
  if (first === -1) expect((await org.adopt(chain, options.transitions ?? [])).adopted).toBe(chain.length);
  else {
    expect((await org.adopt(chain.slice(0, first), [])).adopted).toBe(first);
    expect((await org.adopt(chain.slice(first), options.transitions ?? [])).rewound).toBe(true);
  }
  return new Machine(org);
}

// ---- The app ---------------------------------------------------------------------------------------------------------

type App = {
  dir: string;
  held: HeldOrg;
  store: SigningStore;
  deliveries: Deliveries;
  machines: Map<MachineRef, Machine>;
  roster: MachineRef[];
  rosterChanged(): void;
  disk(): SigningFile;
  /** `signed` owed as the signer writes it: its obligation, through the deliveries' own hook. */
  oblige(signed: SignedOrgState, parent: OrgState): Promise<Obligation>;
  adopt(states: SignedOrgState[], transitions?: Signed<RootTransition>[]): Promise<void>;
  /** A next start over the same files: a new held view, store and deliveries. */
  restart(): Promise<App>;
  /** Holds the next signing.json write until `release`; `reached` resolves once it is waiting. */
  pauseSigningWrite(): { reached: Promise<void>; release(): void };
};

type AppOptions = { roster?: MachineRef[]; maxBytes?: number; retryMs?: number; certificates?: Certificates };

async function app(chain: SignedOrgState[], options: AppOptions = {}): Promise<App> {
  const dir = await tempDir('maws-deliveries-');
  const base = orgFiles({ userData: dir, log: () => {} });
  expect(await base.ensure()).toEqual({ ok: true });
  let gate: { open: Promise<void>; arrived(): void } | null = null;
  const files: typeof base = {
    ...base,
    async write(name, value) {
      if (name === SIGNING_FILE && gate !== null) {
        const held = gate;
        gate = null;
        held.arrived();
        await held.open;
      }
      return base.write(name, value);
    },
  };
  let anchor: Parameters<Parameters<typeof startHeldOrg>[0]['saveAnchor']>[0] | null = null;
  const saveAnchor = async (a: NonNullable<typeof anchor>) => void (anchor = a);
  const g = chain[0];
  const started = await startHeldOrg({ files, anchor: null, saveAnchor, pins: { roots: g.state.root.keys, recoveryPub: g.state.root.recoveryPub }, first: { chain, transitions: [], certificates: options.certificates ?? NO_CERTIFICATES }, log: () => {} });
  if (!started.ok) throw new Error(started.reason);
  const registration: { signing?: true } = {};
  const machines = new Map<MachineRef, Machine>();
  const roster = { list: options.roster ?? [M1, M2, M3] };

  async function compose(held: HeldOrg): Promise<App> {
    let commits: Promise<unknown> = Promise.resolve();
    const commit = <T>(body: () => Promise<T>): Promise<T> => {
      const turn = commits.then(body);
      commits = turn.catch(() => {});
      return turn;
    };
    const store = await createSigningStore({ files, commit, registration: () => registration, markRegistration: async () => void (registration.signing = true) });
    const listeners = new Set<() => void>();
    const deliveries = createDeliveries({
      store,
      roster: () => roster.list,
      onRoster(listener) {
        listeners.add(listener);
        return () => void listeners.delete(listener);
      },
      link: (ref) => machines.get(ref) ?? null,
      view: () => held,
      timing: { ...(options.maxBytes === undefined ? {} : { DELIVERY_MAX_BYTES: options.maxBytes }), ...(options.retryMs === undefined ? {} : { DELIVERY_RETRY_MS: options.retryMs }) },
      log: () => {},
    });
    closers.push(() => deliveries.close());
    const a: App = {
      dir,
      held,
      store,
      deliveries,
      machines,
      get roster() {
        return roster.list;
      },
      set roster(list: MachineRef[]) {
        roster.list = list;
      },
      rosterChanged: () => [...listeners].forEach((l) => l()),
      disk: () => JSON.parse(readFileSync(join(dir, 'org', SIGNING_FILE), 'utf8')) as SigningFile,
      async oblige(signed, parent) {
        const ob = await deliveries.obligation(signed, parent);
        expect(ob).not.toBeNull();
        await store.update((f) => {
          f.deliveries.push(ob!);
          return { next: f, value: undefined };
        });
        return ob!;
      },
      async adopt(states, transitions = []) {
        const result = await held.adoptServed({ chain: states, head: null, transitions, certificates: null });
        expect(result.refused).toBeUndefined();
      },
      pauseSigningWrite() {
        let arrived!: () => void;
        let release!: () => void;
        const reached = new Promise<void>((resolve) => (arrived = resolve));
        gate = { open: new Promise<void>((resolve) => (release = resolve)), arrived };
        return { reached, release };
      },
      async restart() {
        const again = await startHeldOrg({ files, anchor, saveAnchor, log: () => {} });
        if (!again.ok) throw new Error(again.reason);
        return compose(again.held);
      },
    };
    return a;
  }
  return compose(started.held);
}

/** The one obligation's owed machines on disk (none once it settled). */
const owed = (a: App): string[] => a.disk().deliveries.flatMap((o) => o.owed);

async function until(check: () => boolean, what: string, ms = 5_000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

const sameHead = async (m: Machine, s: SignedOrgState) => (await stateHash(m.head().state)) === (await stateHash(s.state));

// ---- Which states, to whom ------------------------------------------------------------------------------------------

describe('which states are delivered, and to whom', () => {
  it('owes a state that ends keys to the roster at its signing; the weekly no-change successor and a rotation that keeps its machine are not delivered to fewer', async () => {
    const g = await genesis();
    const a = await app([g]);
    expect(await a.deliveries.obligation(await next(g, NOW), g.state)).toBeNull();

    const revoking = await next(g, NOW, revokeDevice('old'));
    expect(await a.deliveries.obligation(revoking, g.state)).toEqual({ hash: await stateHash(revoking.state), signed: revoking, owed: [M1, M2, M3], known: {}, probed: {}, tooLarge: [] });

    // A machine's key retired as it rotates: a key ended, and the machine, still enrolled under a new key, still owed.
    const rotated = await generateSigningKey();
    const rotation = await next(g, NOW, async (s) => {
      const entry = s.machines.find((m) => m.ref === M1)!;
      s.retired.push({ keyId: await keyId(entry.pub), pub: entry.pub, notAfter: s.issued, holder: { machine: M1 } });
      entry.pub = rotated.pub;
    });
    expect((await a.deliveries.obligation(rotation, g.state))?.owed).toEqual([M1, M2, M3]);
  });

  it('excludes a delegated machine only by a certificate the parent verifies, and never one the state keeps enrolled', async () => {
    const g = await genesis();
    const delegationKey = await generateSigningKey();
    const id = memberId();
    const withDelegation = await next(g, NOW - DAY, (s) => void s.delegations.push({ id, pub: delegationKey.pub, prefix: 'vm-', expires: iso(NOW + 30 * DAY), maxUses: 10, offlineRevokeS: 0, owners: 'org' }));
    const dropping = await next(withDelegation, NOW, async (s) => {
      s.delegations = [];
      s.revoked.push({ keyId: await keyId(delegationKey.pub), holder: { delegation: id, prefix: 'vm-' } });
    });
    const vm = `${id}_${'v'.repeat(22)}` as MachineRef; // a certificate's ref: the delegation's id, then 128 random bits
    const cert = (machine: string, name: string, key: SigningKey) =>
      signRecord(SIGNING_DOMAINS.machineCert, { org: ORG, machine, name, pub: key.pub, delegation: id, use: 1, issued: iso(NOW - DAY) }, key.privateKey, key.pub);
    const genuine = await signRecord(SIGNING_DOMAINS.machineCert, { org: ORG, machine: vm, name: 'vm-one', pub: (await generateSigningKey()).pub, delegation: id, use: 1, issued: iso(NOW - DAY) }, delegationKey.privateKey, delegationKey.pub);
    // A forged certificate (its own key, not the delegation's) naming an enrolled machine under the dropped delegation,
    // and a copy genuinely signed by the delegation that claims another enrolled machine.
    const forged = await cert(M1, 'vm-two', await generateSigningKey());
    const copied = await signRecord(SIGNING_DOMAINS.machineCert, { org: ORG, machine: M2, name: 'vm-three', pub: (await generateSigningKey()).pub, delegation: id, use: 2, issued: iso(NOW - DAY) }, delegationKey.privateKey, delegationKey.pub);
    const a = await app([g, withDelegation], { roster: [M1, M2, M3, vm], certificates: { certs: [forged, copied, genuine], retirements: [] } });
    expect((await a.deliveries.obligation(dropping, withDelegation.state))?.owed).toEqual([M1, M2, M3]);
  });

  it('never owes a machine the state itself removes, nor sends it anything', async () => {
    const g = await genesis();
    const removing = await next(g, NOW, removeMachine(M2));
    const a = await app([g, removing]);
    a.machines.set(M1, await machine([g]));
    a.machines.set(M2, await machine([g]));
    const ob = await a.oblige(removing, g.state);
    expect(ob.owed).toEqual([M1, M3]);
    await a.deliveries.send();
    expect(a.machines.get(M2)!.runs).toEqual([]);
    expect(await sameHead(a.machines.get(M1)!, removing)).toBe(true);
    expect(owed(a)).toEqual([M3]);
  });
});

// ---- Paging forward -------------------------------------------------------------------------------------------------

describe('runs paging forward through the app’s line', () => {
  it('starts at caps().stateVersion, at the last acknowledged version, or at genesis, each forward run after the cursor', async () => {
    const g = await genesis();
    const line = [g, ...(await run(g, 6, NOW - 10 * DAY))];
    const target = await next(line.at(-1)!, NOW, revokeDevice('old'));
    line.push(target); // versions 1 … 8, the revocation at 8
    const a = await app(line, { roster: [M1, M2, M3], maxBytes: runBytes(line.slice(2, 4), []) + 512 }); // two states a run

    const fromCaps = await machine(line.slice(0, 3)); // head 3, caps 3
    const fromGenesis = await machine(line.slice(0, 5)); // head 5, no caps
    fromGenesis.caps_ = null;
    const fromCursor = await machine(line.slice(0, 3)); // head 3; its second run's answer lost, then sent again
    fromCursor.script = ['deliver', 'offline'];
    a.machines.set(M1, fromCaps);
    a.machines.set(M2, fromGenesis);
    a.machines.set(M3, fromCursor);
    await a.oblige(target, line[6].state);

    await a.deliveries.send();
    expect(fromCaps.runs).toEqual([[3, 4], [5, 6], [7, 8]]);
    // not-newer or rollback moves the start past each run's last state, until a run meets the head
    expect(fromGenesis.runs).toEqual([[1, 2], [3, 4], [5, 6], [7, 8]]);
    expect(fromCursor.runs).toEqual([[3, 4], [5, 6]]);
    expect(owed(a)).toEqual([M3]);
    expect(a.disk().deliveries[0].known[M3]).toMatchObject({ version: 4 });

    await a.deliveries.send();
    // From the cursor at 4, not from caps (still 4, whose run would start at 4).
    expect(fromCursor.runs).toEqual([[3, 4], [5, 6], [5, 6], [7, 8]]);
    for (const m of [fromCaps, fromGenesis, fromCursor]) expect(await sameHead(m, target)).toBe(true);
    expect(a.disk().deliveries).toEqual([]);
    expect(a.deliveries.owing()).toEqual([]);
  });

  it('progresses one state a run when one fits the bound and two don’t; a single state over the bound reads `too-large` until the machine catches up', async () => {
    const g = await genesis();
    const s2 = await next(g, NOW - 3 * DAY);
    // Version 3 carries a few thousand projects (more than the bound alone); version 4 drops them and revokes.
    const s3 = await next(s2, NOW - 2 * DAY, (s) => void (s.projects = Array.from({ length: 3000 }, (_, i) => ({ id: `project-${i}`, name: `Project number ${i}` }))));
    const s4 = await next(s3, NOW - DAY, async (s) => {
      s.projects = [];
      await revokeDevice('old')(s);
    });
    const s5 = await next(s4, NOW);
    const one = runBytes([s5], []) + 64;
    // Each of 1, 2, 4 and 5 fits alone, no two together, and 3 not even alone.
    for (const s of [g, s2, s4]) expect(runBytes([s], [])).toBeLessThanOrEqual(one);
    expect(runBytes([g, s2], [])).toBeGreaterThan(one);
    expect(runBytes([s3], [])).toBeGreaterThan(one);

    const a = await app([g, s2], { roster: [M1, M2], maxBytes: one });
    const slow = await machine([g]);
    a.machines.set(M1, slow);
    await a.adopt([s3, s4, s5]);
    await a.oblige(s4, s3.state);

    await a.deliveries.send();
    expect(slow.runs).toEqual([[1], [2]]);
    expect(a.deliveries.owing()).toEqual([{ version: 4, machines: [M1, M2], tooLarge: [M1] }]);

    // The machine catches up through its own hub sync, then the next retry acknowledges it at its head.
    expect((await slow.org.adopt([s3, s4], [])).adopted).toBe(2);
    await a.deliveries.send();
    expect(slow.runs).toEqual([[1], [2], [4]]);
    expect(a.deliveries.owing()).toEqual([{ version: 4, machines: [M2], tooLarge: [] }]);
  });

  it('brings a machine more than a run behind to the target in bounded steps, with no hub', async () => {
    const g = await genesis();
    const line = [g, ...(await run(g, 18, NOW - 10 * DAY))];
    const target = await next(line.at(-1)!, NOW, revokeDevice('old'));
    line.push(target); // versions 1 … 20
    const a = await app(line, { roster: [M1], maxBytes: runBytes(line.slice(1, 4), []) + 512 }); // three states a run
    const behind = await machine(line.slice(0, 2));
    a.machines.set(M1, behind);
    await a.oblige(target, line[18].state);
    await a.deliveries.send();
    expect(behind.runs).toEqual([[2, 3, 4], [5, 6, 7], [8, 9, 10], [11, 12, 13], [14, 15, 16], [17, 18, 19], [20]]);
    expect(await sameHead(behind, target)).toBe(true);
    expect(a.disk().deliveries).toEqual([]);
  });
});

// ---- Acknowledgement ------------------------------------------------------------------------------------------------

describe('acknowledgement', () => {
  it('acknowledges a machine already ahead of the state at its head', async () => {
    const g = await genesis();
    const target = await next(g, NOW - DAY, revokeDevice('old'));
    const later = await run(target, 2, NOW - 3_600_000);
    const a = await app([g, target, ...later], { roster: [M1] });
    const ahead = await machine([g, target, ...later]);
    a.machines.set(M1, ahead);
    await a.oblige(target, g.state);
    await a.deliveries.send();
    expect(ahead.runs).toEqual([[4]]);
    expect(a.disk().deliveries).toEqual([]);
  });

  it('acknowledges a machine whose acknowledgement was lost and which advanced before the retry', async () => {
    const g = await genesis();
    const s2 = await next(g, NOW - DAY);
    const target = await next(s2, NOW - 3_600_000, revokeDevice('old'));
    const a = await app([g, s2, target], { roster: [M1] });
    const m = await machine([g, s2]);
    m.script = ['lose'];
    a.machines.set(M1, m);
    await a.oblige(target, s2.state);

    await a.deliveries.send();
    expect(m.runs).toEqual([[2, 3]]);
    expect(await sameHead(m, target)).toBe(true); // applied, its answer lost
    expect(owed(a)).toEqual([M1]);

    // The machine moves on (its own hub sync), and so does the app.
    const s4 = await next(target, NOW);
    expect((await m.org.adopt([s4], [])).adopted).toBe(1);
    await a.adopt([s4]);
    await a.deliveries.send();
    expect(m.runs).toEqual([[2, 3], [4]]);
    expect(a.disk().deliveries).toEqual([]);
  });

  it('acknowledges a machine ahead of the app’s own head only once the app adopts that far', async () => {
    const g = await genesis();
    const target = await next(g, NOW - DAY, revokeDevice('old'));
    const later = await run(target, 2, NOW - 3_600_000);
    const a = await app([g, target], { roster: [M1] });
    const ahead = await machine([g, target, ...later]);
    a.machines.set(M1, ahead);
    await a.oblige(target, g.state);

    await a.deliveries.send();
    expect(ahead.runs).toEqual([]);
    expect(owed(a)).toEqual([M1]);

    await a.adopt(later);
    await a.deliveries.send();
    expect(ahead.runs).toEqual([[4]]);
    expect(a.disk().deliveries).toEqual([]);
  });
});

// ---- The pending state --------------------------------------------------------------------------------------------

/** The slot as the signer keeps it: `signed` pending on `parent`, exposed to the hub (a post whose answer never came). */
async function pend(a: App, signed: SignedOrgState, parent: SignedOrgState): Promise<void> {
  const ob = await a.deliveries.obligation(signed, parent.state);
  const parentHash = await stateHash(parent.state);
  await a.store.update((f) => {
    f.pending = { signed, parent: parentHash, exposed: { hub: true, machines: [] } };
    f.deliveries.push(ob!);
    return { next: f, value: undefined };
  });
}

describe('the pending state', () => {
  it('is delivered while the hub withholds it, the machine written into its exposure before the act', async () => {
    const g = await genesis();
    const s2 = await next(g, NOW - DAY);
    const a = await app([g, s2], { roster: [M1] });
    const pending = await next(s2, NOW, revokeDevice('old'));
    await pend(a, pending, s2);
    const m = await machine([g]);
    const exposedAtAct: string[][] = [];
    m.onAct = () => exposedAtAct.push(a.disk().pending!.exposed.machines);
    a.machines.set(M1, m);

    await a.deliveries.send();
    expect(m.runs).toEqual([[1, 2, 3]]);
    expect(exposedAtAct).toEqual([[M1]]);
    expect(await sameHead(m, pending)).toBe(true);
    // Delivery settled apart from publication: the slot stays for the hub, the obligation is done.
    expect(a.disk().pending?.exposed).toEqual({ hub: true, machines: [M1] });
    expect(a.disk().deliveries).toEqual([]);
  });

  it('sends nothing when a sibling is adopted while the exposure write waits: the run is planned again and suspended', async () => {
    const g = await genesis();
    const a = await app([g], { roster: [M1] });
    const pending = await next(g, NOW, revokeDevice('old'));
    await pend(a, pending, g);
    const m = await machine([g]);
    a.machines.set(M1, m);
    const pause = a.pauseSigningWrite();
    const sending = a.deliveries.send();
    await pause.reached; // the run [1, 2] is planned, the pending state a candidate; its exposure write is on its way
    await a.adopt([await next(g, NOW - 60_000)]); // the deployment admin's state at version 2: the slot is now a fork
    pause.release();
    await sending;
    expect(m.runs).toEqual([]);
    expect(await sameHead(m, g)).toBe(true);
    expect(a.deliveries.owing()).toEqual([{ version: 2, machines: [M1], tooLarge: [] }]);
  });

  it('suspends the pending state’s sends while it is a fork', async () => {
    const g = await genesis();
    const a = await app([g], { roster: [M1] });
    const pending = await next(g, NOW, revokeDevice('old'));
    await pend(a, pending, g);
    // The deployment admin's state at the same version reaches the app: the slot is now `pending-fork`.
    await a.adopt([await next(g, NOW - 60_000)]);
    const m = await machine([g]);
    a.machines.set(M1, m);
    await a.deliveries.send();
    expect(m.runs).toEqual([]);
    expect(a.deliveries.owing()).toEqual([{ version: 2, machines: [M1], tooLarge: [] }]);
  });

  it('outlives the slot’s clearing across a crash', async () => {
    const g = await genesis();
    const a = await app([g], { roster: [M1] });
    const pending = await next(g, NOW, revokeDevice('old'));
    await pend(a, pending, g);
    // The hub took it: the held chain adopts it and the slot clears; then the app stops before any delivery.
    await a.adopt([pending]);
    await a.store.update((f) => {
      f.pending = null;
      return { next: f, value: undefined };
    });
    a.deliveries.close();

    const b = await a.restart();
    const m = await machine([g]);
    b.machines.set(M1, m);
    expect(b.deliveries.owing()).toEqual([{ version: 2, machines: [M1], tooLarge: [] }]);
    await b.deliveries.send();
    expect(m.runs).toEqual([[1, 2]]);
    expect(b.disk().deliveries).toEqual([]);
  });
});

// ---- A removal that loses the hub race ------------------------------------------------------------------------------

/** The hub, as far as the signer meets it: posts judged by `verifySuccessor` against its head. */
class FakeHub implements HubClient {
  online = false;
  constructor(public states: SignedOrgState[]) {}
  async postState(signed: SignedOrgState): Promise<HubResult<{ version: number }>> {
    if (!this.online) return { ok: false, kind: 'unreachable', detail: 'the hub is down' };
    const verdict = await verifySuccessor(this.states.at(-1)!, signed, []);
    if (!verdict.ok) return { ok: false, kind: 'status', status: 409, error: verdict.code };
    this.states.push(signed);
    return { ok: true, value: { version: signed.state.version } };
  }
  async chain(since: number): Promise<HubResult<Served>> {
    if (!this.online) return { ok: false, kind: 'unreachable', detail: 'the hub is down' };
    return { ok: true, value: { chain: this.states.filter((s) => s.state.version > since), head: this.states.at(-1)!, transitions: [], certificates: NO_CERTIFICATES } };
  }
  me(): never {
    throw new Error('unused');
  }
  state(): never {
    throw new Error('unused');
  }
  postPending(): never {
    throw new Error('unused');
  }
}

describe('a removal that loses the hub race', () => {
  it('is discarded with its obligation: no abandoned byte is sent to an owed machine that reconnects, and the machine that took it is named', async () => {
    const g = await genesis();
    const a = await app([g], { roster: [M1, M2] });
    const hub = new FakeHub([g]);
    const k = await keys();
    const stateSigner = await createStateSigner({ key: k.app.stepUp, confirm: async () => ({ ok: true }) });
    const session = heldOrgSession({} as SignedIn);
    a.held.onAdopted(() => session.changed());
    const signer = createOrgSigner({ session, held: () => a.held, signer: () => stateSigner, marked: () => true, hub: () => hub, store: a.store, deliveries: a.deliveries, now: () => NOW, log: () => {} });
    closers.push(() => signer.close());
    const taker = await machine([g]);
    const late = await machine([g]);
    late.setUp(false);
    a.machines.set(M1, taker);
    a.machines.set(M2, late);
    a.rosterChanged();

    // The hub is down: the removal is signed and kept pending, and the deliveries take it to the machine that is up.
    const removal: Edit = { summary: 'remove dev-old', lines: [], apply: revokeDevice('old') };
    expect(await signer.sign(removal)).toMatchObject({ ok: false, reason: 'hub' });
    await until(() => taker.runs.length === 1 && owed(a).length === 1, 'the delivery to the machine that is up');
    expect(owed(a)).toEqual([M2]);

    // The deployment admin's refresh lands at the hub first: the app's proposal is a fork, discarded on the owner's word.
    hub.states.push(await next(g, NOW - 60_000));
    hub.online = true;
    await signer.settle();
    expect(signer.pending()).toMatchObject({ version: 2, fork: true });
    expect(await signer.discardPending(true)).toMatchObject({ ok: true, unsent: false, forkAt: 2 });
    expect(a.disk().deliveries).toEqual([]);
    expect(a.disk().abandoned).toEqual([{ hash: expect.any(String), version: 2, hub: true, machines: [M1] }]);

    // The owed machine reconnects: nothing is sent.
    late.setUp(true);
    await a.deliveries.send();
    expect(late.runs).toEqual([]);
    expect(a.deliveries.owing()).toEqual([]);
  });
});

// ---- After a recovery -----------------------------------------------------------------------------------------------

describe('after a recovery', () => {
  /**
   * The org's line: 1 … 3 (the base, issued 60 days ago), then a branch 4°, 5°, 6° the recovery key says was forged; the
   * recovery from version 3 and the recovered 4′, then the revocation 5′ the app signs on the recovered line.
   */
  async function recovered() {
    const g = await genesis(NOW - 90 * DAY);
    const s2 = await next(g, NOW - 80 * DAY);
    const base = await next(s2, NOW - 60 * DAY);
    const forged = await run(base, 3, NOW - 59 * DAY);
    forged[2] = await next(forged[1], NOW - DAY);
    const t = await recoveryFrom(3);
    const r4 = await next(base, NOW - 3_600_000, dropAppRoot);
    const target = await next(r4, NOW, revokeDevice('old'));
    return { g, s2, base, forged, t, r4, target };
  }

  it('brings each machine on the superseded branch onto the app’s line by the recovery-first run: above the recovered head, at an equal version, and past its window', async () => {
    const { g, s2, base, forged, t, r4, target } = await recovered();
    const a = await app([g, s2, base, forged[0], forged[1]], { roster: [M1, M2, M3] });
    await a.adopt([r4], [t]); // the app rewinds
    await a.adopt([target]);

    const above = await machine([g, s2, base, ...forged], { now: NOW - 50 * DAY }); // head 6°, the base in its window
    const equal = await machine([g, s2, base, forged[0], forged[1]], { now: NOW - 50 * DAY }); // head 5°
    const windowless = await machine([g, s2, base, forged[0], forged[1]]); // the base 60 days old: out of its window
    a.machines.set(M1, above);
    a.machines.set(M2, equal);
    a.machines.set(M3, windowless);
    await a.oblige(target, r4.state);

    await a.deliveries.send();
    for (const m of [above, equal, windowless]) {
      expect(m.runs).toEqual([[3, 4, 5]]);
      expect(await sameHead(m, target)).toBe(true);
    }
    expect(a.disk().deliveries).toEqual([]);
  });

  it('reads `too-large` when the probe can’t hold the base with the state after it, never sending the base alone or counting the probe as tried', async () => {
    const { g, s2, base, forged, t, r4, target } = await recovered();
    const a = await app([g, s2, base, forged[0], forged[1]], { roster: [M1], maxBytes: runBytes([target], [t]) + 64 }); // one state a run
    await a.adopt([r4], [t]);
    await a.adopt([target]);
    expect(runBytes([base, r4], [t])).toBeGreaterThan(runBytes([target], [t]) + 64);
    const superseded = await machine([g, s2, base, forged[0], forged[1]], { now: NOW - 50 * DAY }); // head 5°
    a.machines.set(M1, superseded);
    await a.oblige(target, r4.state);

    await a.deliveries.send();
    expect(superseded.runs.filter((r) => r[0] === 3)).toEqual([]);
    expect(await sameHead(superseded, forged[1])).toBe(true);
    expect(a.deliveries.owing()).toEqual([{ version: 5, machines: [M1], tooLarge: [M1] }]);
    expect(a.disk().deliveries[0].probed).toEqual({});
  });

  it('resets every cursor when the app adopts a rewind: the next run is the recovery-first one', async () => {
    const g = await genesis(NOW - 90 * DAY);
    const s2 = await next(g, NOW - 80 * DAY);
    const target = await next(s2, NOW - 70 * DAY, revokeDevice('old'));
    const s4 = await next(target, NOW - 60 * DAY);
    const s5 = await next(s4, NOW - 50 * DAY);
    const t = await recoveryFrom(4);
    const r5 = await next(s4, NOW - DAY, dropAppRoot);
    const a = await app([g, s2, target, s4, s5], { roster: [M1], maxBytes: runBytes([s4, r5], [t]) + 256 }); // two states a run, the transition included
    const m = await machine([g]);
    m.script = ['deliver', 'offline'];
    a.machines.set(M1, m);
    await a.oblige(target, s2.state);
    await a.deliveries.send();
    expect(m.runs).toEqual([[1, 2], [3, 4]]);
    expect(a.disk().deliveries[0].known[M1]).toMatchObject({ version: 2 });

    // A recovery from version 4 rewinds the app's line above the target; the cursor at 2 no longer stands, so the next
    // run is the probe from the base, not the forward run [3, 4].
    await a.adopt([r5], [t]);
    await a.deliveries.send();
    expect(m.runs.slice(2)).toEqual([[4, 5], [2, 3]]);
    expect(a.disk().deliveries).toEqual([]);
  });

  it('exits the probe on real endpoints below the base (`not-newer`) and past the first page of an accepted recovery (`rollback`), each probed once on the line', async () => {
    const g = await genesis(NOW - 90 * DAY);
    const s2 = await next(g, NOW - 80 * DAY);
    const s3 = await next(s2, NOW - 70 * DAY);
    const base = await next(s3, NOW - 60 * DAY); // version 4
    const forged = await next(base, NOW - 59 * DAY);
    const t = await recoveryFrom(4);
    const r5 = await next(base, NOW - 4 * 3_600_000, dropAppRoot);
    const target = await next(r5, NOW - 3 * 3_600_000, revokeDevice('old')); // version 6
    const after = await run(target, 2, NOW - 2 * 3_600_000); // 7′, 8′
    const a = await app([g, s2, s3, base, forged], { roster: [M1, M2], maxBytes: runBytes([base, r5, target], [t]) + 256 }); // three states a run
    await a.adopt([r5], [t]);
    await a.adopt([target, ...after]);

    const below = await machine([g, s2]); // head 2, below the base's predecessor
    const accepted = await machine([g, s2, s3, base, forged, r5, target, ...after], { transitions: [t], now: NOW - 50 * DAY }); // head 8′, the base in its window when it took the recovery
    for (const m of [below, accepted]) m.script = ['deliver', 'offline']; // the probe answered, the next run's answer lost
    a.machines.set(M1, below);
    a.machines.set(M2, accepted);
    await a.oblige(target, r5.state);

    await a.deliveries.send();
    expect(below.runs).toEqual([[4, 5, 6], [2, 3, 4]]);
    expect(accepted.runs).toEqual([[4, 5, 6], [8]]);
    const ob = a.disk().deliveries[0];
    expect(Object.keys(ob.probed).sort()).toEqual([M1, M2].sort());
    expect(ob.known).toEqual({});

    // The next send finds each machine's head again, with no second probe on this line.
    await a.deliveries.send();
    expect(below.runs.slice(2)).toEqual([[2, 3, 4], [5, 6, 7]]);
    expect(accepted.runs.slice(2)).toEqual([[8]]);
    for (const m of [below, accepted]) expect(m.runs.filter((r) => r[0] === 4 && r.length === 3 && r[1] === 5)).toHaveLength(1);
    expect(a.disk().deliveries).toEqual([]);
  });

  it('drops an obligation whose state a recovery superseded, sending nothing of it', async () => {
    const g = await genesis(NOW - 90 * DAY);
    const s2 = await next(g, NOW - 80 * DAY);
    const target = await next(s2, NOW - 70 * DAY, revokeDevice('old'));
    const a = await app([g, s2, target], { roster: [M1] });
    await a.oblige(target, s2.state);
    const t = await recoveryFrom(2);
    await a.adopt([await next(s2, NOW - DAY, dropAppRoot)], [t]);
    const m = await machine([g]);
    a.machines.set(M1, m);
    await a.deliveries.send();
    expect(m.runs).toEqual([]);
    expect(a.disk().deliveries).toEqual([]);
  });
});

// ---- When it is sent again, and to whom it stops being owed --------------------------------------------------------

describe('retries and the roster', () => {
  it('sends again when an owed machine’s link comes up', async () => {
    const g = await genesis();
    const target = await next(g, NOW, revokeDevice('old'));
    const a = await app([g, target], { roster: [M1] });
    const m = await machine([g]);
    m.setUp(false);
    a.machines.set(M1, m);
    a.rosterChanged();
    await a.oblige(target, g.state);
    await a.deliveries.send();
    expect(m.runs).toEqual([]);
    m.setUp(true);
    await until(() => a.disk().deliveries.length === 0, 'the delivery at link up');
    expect(m.runs).toEqual([[1, 2]]);
  });

  it('sends again on the clock', async () => {
    const g = await genesis();
    const target = await next(g, NOW, revokeDevice('old'));
    const a = await app([g, target], { roster: [M1], retryMs: 25 });
    const m = await machine([g]);
    m.respond = 'offline';
    a.machines.set(M1, m);
    await a.oblige(target, g.state);
    await a.deliveries.send();
    expect(owed(a)).toEqual([M1]);
    m.respond = 'deliver';
    await until(() => a.disk().deliveries.length === 0, 'the retry on the clock');
    expect(await sameHead(m, target)).toBe(true);
  });

  it('no longer owes a machine that leaves the roster, and keeps owing one the held org still lists while the roster is empty', async () => {
    const g = await genesis();
    const target = await next(g, NOW - DAY, revokeDevice('old'));
    const a = await app([g, target], { roster: [M1, M2] });
    await a.oblige(target, g.state);
    let told = 0;
    a.deliveries.onChanged(() => told++);

    // Signed out (or before the roster is computed): the roster is empty, but the head still lists both.
    a.roster = [];
    a.rosterChanged();
    await a.deliveries.send();
    expect(owed(a)).toEqual([M1, M2]);

    // The org removes M2: it leaves the roster and the head.
    await a.adopt([await next(target, NOW, removeMachine(M2))]);
    a.roster = [M1];
    a.rosterChanged();
    await until(() => a.deliveries.owing()[0]?.machines.length === 1, 'M2 no longer owed');
    expect(owed(a)).toEqual([M1]);
    expect(a.deliveries.owing()).toEqual([{ version: 2, machines: [M1], tooLarge: [] }]);
    expect(told).toBeGreaterThan(0);
  });
});
