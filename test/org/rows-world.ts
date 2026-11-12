// The remote rows' world (P5 O8 M2; M6b's channel listings): the org as the hub serves it, over real signed states,
// listings and certificates (the protocol package's signing), a fake Registry feed, an in-memory org directory, and
// fake RL2 links whose `endpoint.listings` calls a test answers. Shared by src/main/org/rows.test.ts and
// test/org/rows-enumerated.test.ts.
import {
  generateSigningKey,
  LISTING_GONE,
  NO_CERTIFICATES,
  signRecord,
  SIGNING_DOMAINS,
  type Certificates,
  type Listing,
  type MachineCert,
  type OrgView,
  type ProjectLocation,
  type ProjectsRecord,
  type Signed,
  type SignedOrgState,
  type SigningKey,
} from '../../apps/org-protocol/src/index.ts';
import type { MachineRef } from '@shared/machine/ref';
import type { LinkState } from '../../src/main/machines/manager';
import type { CallResult } from '../../src/main/machines/remote/link';
import type { OrgFiles } from '../../src/main/org/files';
import type { RegistryFeed } from '../../src/main/org/registry-feed';
import type { ListingsLink } from '../../src/main/org/rows';
import { heldOrgSession, type SignedIn } from '../../src/main/org/session';
import { genesis, iso, memberId, newDevice, successor, type TestDevice } from '../endpoint/org-fixtures';

export const ORG = 'org-rows';
export const HOUR = 3_600_000;
export const random = (n: number) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'[b % 64]).join('');
export const hex = () => memberId();

export type Machine = { ref: string; key: SigningKey };

/** The org as the hub serves it: a head the test moves, the certificate set it serves, and the session's clock. */
export class World {
  admin!: TestDevice;
  A!: string;
  B!: string;
  chain: SignedOrgState[] = [];
  certs: Certificates = NO_CERTIFICATES;
  clock = Date.now();
  m1!: Machine;
  m2!: Machine;
  delegation!: { id: string; key: SigningKey; expires: string };
  d!: Machine & { cert: Signed<MachineCert> };
  readonly view: OrgView = {
    head: () => this.chain[this.chain.length - 1],
    certificates: () => this.certs,
    since: () => ({ states: [], transitions: [] }),
    advance: async () => {},
  };
  readonly session = heldOrgSession(null);

  static async make(): Promise<World> {
    const w = new World();
    w.admin = await newDevice('app');
    w.A = hex();
    w.B = hex();
    const recovery = await generateSigningKey();
    w.m1 = { ref: `m1${random(20)}`, key: await generateSigningKey() };
    w.m2 = { ref: `m2${random(20)}`, key: await generateSigningKey() };
    const delegationKey = await generateSigningKey();
    const id = hex();
    w.delegation = { id, key: delegationKey, expires: iso(w.clock + HOUR) };
    const dKey = await generateSigningKey();
    const dRef = `${id}_${random(22)}`;
    w.d = { ref: dRef, key: dKey, cert: await w.certify(dRef, dKey) };
    w.certs = { certs: [w.d.cert], retirements: [] };
    const bDevice = await newDevice('b-app');
    w.chain = [await genesis(ORG, w.A, w.admin, recovery, iso(w.clock - HOUR))];
    w.chain.push(
      await successor(w.chain[0], [w.admin], (s) => {
        s.members.push({ id: w.B, email: 'b@example.com', role: 'member', devices: [bDevice.device] });
        s.machines.push({ name: 'mac-one', ref: w.m1.ref, pub: w.m1.key.pub, owners: [w.A] }, { name: 'mac-two', ref: w.m2.ref, pub: w.m2.key.pub, owners: [w.B] });
        s.machineNames.push({ name: 'mac-one', ref: w.m1.ref }, { name: 'mac-two', ref: w.m2.ref });
        s.delegations.push({ id, pub: delegationKey.pub, prefix: 'vm-', expires: w.delegation.expires, maxUses: 10, offlineRevokeS: 0, owners: [w.A] });
      }),
    );
    w.session.set(w.signedIn());
    return w;
  }

  signedIn(member = this.A): SignedIn {
    return {
      identity: { org: ORG, member, device: 'app', clientClass: 'native-mac', channelKey: this.admin.channel, build: 'test', capabilities: [] },
      view: this.view,
      stepUp: { sign: () => Promise.reject(new Error('no step-up here')), signActions: () => Promise.reject(new Error('no step-up here')) },
      hub: { url: 'http://127.0.0.1:1', headers: async () => ({}) },
    };
  }

  certify(ref: string, key: SigningKey, name = 'vm-one'): Promise<Signed<MachineCert>> {
    const body: MachineCert = { org: ORG, machine: ref, name, pub: key.pub, delegation: this.delegation.id, use: 1, issued: iso(this.clock) };
    return signRecord(SIGNING_DOMAINS.machineCert, body, this.delegation.key.privateKey, this.delegation.key.pub);
  }

  /** A successor head, adopted: the session says so. */
  async adopt(edit: Parameters<typeof successor>[2] = () => {}, issued?: string): Promise<SignedOrgState> {
    const next = await successor(this.chain[this.chain.length - 1], [this.admin], edit, issued);
    this.chain.push(next);
    this.session.changed();
    return next;
  }

  head(): SignedOrgState {
    return this.chain[this.chain.length - 1];
  }

  list(machine: Machine, session: string, revision: number, fields: Partial<Listing['fields']> = {}, org = ORG): Promise<Signed<Listing>> {
    const body: Listing = { org, machine: machine.ref, session, revision, issued: iso(this.clock), fields: { owners: [this.A], project: null, lane: 'A', state: 'busy', title: `${session} r${revision}`, ...fields } };
    return signRecord(SIGNING_DOMAINS.listing, body, machine.key.privateKey, machine.key.pub);
  }

  /** The project registry: `machine`'s projects record at `revision`, signed with its key. */
  projects(machine: Machine, revision: number, locations: ProjectLocation[] = [], known: ProjectsRecord['known'] = [], org = ORG): Promise<Signed<ProjectsRecord>> {
    const body: ProjectsRecord = { org, machine: machine.ref, revision, issued: iso(this.clock), locations, known };
    return signRecord(SIGNING_DOMAINS.projects, body, machine.key.privateKey, machine.key.pub);
  }

  gone(machine: Machine, session: string, revision: number): Promise<Signed<Listing>> {
    return this.list(machine, session, revision, { owners: [], project: null, title: '', state: LISTING_GONE });
  }
}

export function fakeFeed() {
  const sets = {
    open: new Set<() => void>(),
    close: new Set<() => void>(),
    state: new Set<(version: number) => void>(),
    listings: new Set<(page: { records: Signed<Listing>[]; last: boolean }) => void>(),
    listing: new Set<(record: Signed<Listing>) => void>(),
    projectsPages: new Set<(page: { records: Signed<ProjectsRecord>[]; last: boolean }) => void>(),
    projects: new Set<(record: Signed<ProjectsRecord>) => void>(),
  };
  const on =
    <T>(set: Set<T>) =>
    (listener: T) => {
      set.add(listener);
      return () => void set.delete(listener);
    };
  const feed: RegistryFeed = {
    onOpen: on(sets.open),
    onClose: on(sets.close),
    onState: on(sets.state),
    onRemoved: () => () => {},
    onCredentialsEnded: () => () => {},
    onListings: on(sets.listings),
    onListing: on(sets.listing),
    onProjectsPages: on(sets.projectsPages),
    onProjects: on(sets.projects),
    connected: () => true,
    probe: () => {},
    close: () => {},
  };
  return {
    feed,
    open: () => sets.open.forEach((l) => l()),
    close: () => sets.close.forEach((l) => l()),
    state: (version: number) => sets.state.forEach((l) => l(version)),
    page: (records: Signed<Listing>[], last: boolean) => sets.listings.forEach((l) => l({ records, last })),
    push: (record: Signed<Listing>) => sets.listing.forEach((l) => l(record)),
    /** The project registry: a `projects-all` page, and a live `projects` frame. */
    projectsPage: (records: Signed<ProjectsRecord>[], last: boolean) => sets.projectsPages.forEach((l) => l({ records, last })),
    projectsRecord: (record: Signed<ProjectsRecord>) => sets.projects.forEach((l) => l(record)),
  };
}

export function memoryFiles(store = new Map<string, string>()): OrgFiles & { store: Map<string, string> } {
  return {
    dir: '/profile/org',
    store,
    check: async () => ({ ok: true }),
    ensure: async () => ({ ok: true }),
    read: async (name) => (store.has(name) ? (JSON.parse(store.get(name)!) as unknown) : null),
    write: async (name, value) => void store.set(name, JSON.stringify(value)),
    remove: async (name) => void store.delete(name),
  };
}

/**
 * Each machine's RL2 link as the rows read it (M6b): its state, which a test moves, and its `endpoint.listings` calls,
 * held until the test answers, fails or drops them, oldest first.
 */
export function fakeLinks(initial: LinkState = 'up') {
  type Call = { name: string; input: unknown; resolve(result: CallResult): void };
  type Held = { state: LinkState; listeners: Set<(state: LinkState) => void>; calls: Call[]; link: ListingsLink };
  const links = new Map<string, Held>();
  const of = (ref: string): Held => {
    let held = links.get(ref);
    if (held === undefined) {
      const made: Held = {
        state: initial,
        listeners: new Set(),
        calls: [],
        link: {
          state: () => made.state,
          onState: (listener) => (made.listeners.add(listener), () => void made.listeners.delete(listener)),
          call: (name, input) => new Promise<CallResult>((resolve) => made.calls.push({ name, input, resolve })),
        },
      };
      links.set(ref, (held = made));
    }
    return held;
  };
  return {
    /** The machine's one link, as `Machines.remote` gives the same link for a machine while it lives. */
    link: (ref: MachineRef): ListingsLink => of(ref).link,
    /** The calls not answered yet. */
    calls: (ref: string): readonly Call[] => of(ref).calls,
    /** Answers the oldest call with these listings; whether one was waiting. */
    answer(ref: string, listings: readonly Signed<Listing>[]): boolean {
      const call = of(ref).calls.shift();
      call?.resolve({ ok: true, output: { listings } });
      return call !== undefined;
    },
    /** Fails the oldest call with `code`; whether one was waiting. */
    fail(ref: string, code = 'offline'): boolean {
      const call = of(ref).calls.shift();
      call?.resolve({ ok: false, error: { code } });
      return call !== undefined;
    },
    setState(ref: string, state: LinkState): void {
      const held = of(ref);
      held.state = state;
      for (const listener of [...held.listeners]) listener(state);
    },
  };
}

/** The project registry: a declared location as a record states it, a minted plain folder unless `over` says otherwise. */
export const location = (pid: string, id: string, path: string, over: Partial<ProjectLocation> = {}): ProjectLocation => ({
  pid,
  id,
  key: `folder:x:${pid}`,
  name: path.split('/').pop()!,
  path,
  source: 'folder',
  stated: 'minted',
  ...over,
});
