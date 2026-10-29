// The remote rows (P5 O8 M2, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M2's Proves for rows.test.ts):
// verification against the held head and its retries, the snapshot's replace rule, the high-water mark per key and the
// only evidence that drops one, the cache verified at load, `complete` and `pending`, the roster filter, `mine`, the join
// to the local org projects, coalescing and signed out. A fake feed and session over real signed states, listings and
// certificates (the protocol package's signing), and an in-memory org directory.
import { afterEach, describe, expect, it } from 'vitest';
import {
  generateSigningKey,
  keyId,
  LISTING_GONE,
  NO_CERTIFICATES,
  signRecord,
  SIGNING_DOMAINS,
  type Certificates,
  type Listing,
  type MachineCert,
  type OrgView,
  type Signed,
  type SignedOrgState,
  type SigningKey,
} from '../../../apps/org-protocol/src/index.ts';
import { genesis, iso, memberId, newDevice, successor, type TestDevice } from '../../../test/endpoint/org-fixtures';
import type { OrgRows } from '@shared/ipc/schema/org';
import type { ProjectRecord } from '@shared/ipc/schema/session';
import type { MachineRef } from '@shared/machine/ref';
import { repoProjectId } from '../index/org-project';
import type { OrgFiles } from './files';
import type { RegistryFeed } from './registry-feed';
import { createRemoteRows, LISTINGS_FILE, listingHash, type ListingsFile, type RemoteRows } from './rows';
import { heldOrgSession, type SignedIn } from './session';

const ORG = 'org-rows';
const HOUR = 3_600_000;
const random = (n: number) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'[b % 64]).join('');
const hex = () => memberId();

type Machine = { ref: string; key: SigningKey };

/** The org as the hub serves it: a head the test moves, the certificate set it serves, and the session's clock. */
class World {
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
      stepUp: { sign: () => Promise.reject(new Error('no step-up here')) },
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

  gone(machine: Machine, session: string, revision: number): Promise<Signed<Listing>> {
    return this.list(machine, session, revision, { owners: [], project: null, title: '', state: LISTING_GONE });
  }
}

function fakeFeed() {
  const sets = {
    open: new Set<() => void>(),
    close: new Set<() => void>(),
    state: new Set<(version: number) => void>(),
    listings: new Set<(page: { records: Signed<Listing>[]; last: boolean }) => void>(),
    listing: new Set<(record: Signed<Listing>) => void>(),
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
  };
}

function memoryFiles(store = new Map<string, string>()): OrgFiles & { store: Map<string, string> } {
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

const project = (key: string, source: 'smns' | 'remote' | 'repository' | 'folder', smnsId: string | null): ProjectRecord =>
  ({ id: `p-${key}`, name: key, directory: `/src/${key}`, order: 0, createdAt: iso(0), org: { key, name: key, source, smnsId } }) as ProjectRecord;

type Harness = Awaited<ReturnType<typeof start>>;
const running: RemoteRows[] = [];

async function start(
  w: World,
  options: { files?: ReturnType<typeof memoryFiles>; roster?: string[]; projects?: ProjectRecord[]; coalesce?: number; unverifiedMax?: number; onNow?: () => void } = {},
) {
  const feed = fakeFeed();
  const files = options.files ?? memoryFiles();
  let roster = (options.roster ?? [w.m1.ref, w.m2.ref, w.d.ref]) as MachineRef[];
  let projects = options.projects ?? [];
  const rosterListeners = new Set<() => void>();
  const projectListeners = new Set<() => void>();
  const emitted: OrgRows[] = [];
  const logs: string[] = [];
  const rows = createRemoteRows({
    session: w.session,
    feed: feed.feed,
    roster: () => roster,
    onRoster: (listener) => (rosterListeners.add(listener), () => void rosterListeners.delete(listener)),
    localProjects: async () => projects,
    onLocalProjects: (listener) => (projectListeners.add(listener), () => void projectListeners.delete(listener)),
    files,
    emit: (next) => emitted.push(next),
    now: () => (options.onNow?.(), w.clock),
    timing: { ROWS_COALESCE_MS: options.coalesce ?? 1, ROWS_CACHE_WRITE_MS: 1, ...(options.unverifiedMax === undefined ? {} : { UNVERIFIED_MAX: options.unverifiedMax }) },
    log: (line) => logs.push(line),
  });
  running.push(rows);
  await rows.loaded;
  return {
    rows,
    feed,
    files,
    emitted,
    logs,
    settle: () => rows.settled(),
    setRoster(next: string[]) {
      roster = next as MachineRef[];
      rosterListeners.forEach((l) => l());
    },
    setProjects(next: ProjectRecord[]) {
      projects = next;
      projectListeners.forEach((l) => l());
    },
    /** The rows as `<session> r<revision>`. */
    shown: () => rows.rows().rows.map((r) => `${r.session} r${r.revision}`),
    cache: () => JSON.parse(files.store.get(LISTINGS_FILE) ?? 'null') as ListingsFile | null,
  };
}

/** Pushes each record live and waits for them to apply. */
async function push(h: Harness, ...records: Signed<Listing>[]): Promise<void> {
  for (const record of records) h.feed.push(record);
  await h.settle();
}

/** A fresh feed connection: open, then the snapshot's pages (the last marked). */
async function snapshot(h: Harness, ...pages: Signed<Listing>[][]): Promise<void> {
  h.feed.open();
  pages.forEach((records, i) => h.feed.page(records, i === pages.length - 1));
  if (pages.length === 0) h.feed.page([], true);
  await h.settle();
}

/** Ends the run (flushing the cache) and starts another over the same directory. */
async function relaunch(w: World, h: Harness, options: Parameters<typeof start>[1] = {}): Promise<Harness> {
  await h.rows.close();
  return start(w, { files: h.files, ...options });
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

afterEach(async () => {
  await Promise.all(running.splice(0).map((rows) => rows.close()));
});

describe('verification', () => {
  it('shows a record that verifies against the held head, and holds back one that does not', async () => {
    const w = await World.make();
    const h = await start(w);
    const stranger = { ref: w.m1.ref, key: await generateSigningKey() };
    await push(h, await w.list(w.m1, 's1', 5), await w.list(stranger, 's2', 5), await w.list(w.m1, 's3', 5, {}, 'another-org'));
    expect(h.shown()).toEqual(['s1 r5']);
    expect(h.rows.rows().pending).toEqual([w.m1.ref]);
  });

  it('tries a failing record again at the next head', async () => {
    const w = await World.make();
    const m3 = { ref: `m3${random(20)}`, key: await generateSigningKey() };
    const h = await start(w, { roster: [w.m1.ref, m3.ref] });
    await push(h, await w.list(m3, 's1', 5));
    expect(h.shown()).toEqual([]);
    expect(h.rows.rows().pending).toEqual([m3.ref]);
    await w.adopt((s) => {
      s.machines.push({ name: 'mac-three', ref: m3.ref, pub: m3.key.pub, owners: [w.A] });
      s.machineNames.push({ name: 'mac-three', ref: m3.ref });
    });
    await h.settle();
    expect(h.shown()).toEqual(['s1 r5']);
    expect(h.rows.rows().pending).toEqual([]);
  });

  it('drops the rows of a machine a head removes', async () => {
    const w = await World.make();
    const h = await start(w);
    await push(h, await w.list(w.m1, 's1', 5), await w.list(w.m2, 's2', 5));
    expect(h.shown()).toEqual(expect.arrayContaining(['s1 r5', 's2 r5']));
    const m2kid = await keyId(w.m2.key.pub);
    await w.adopt((s) => {
      s.machines = s.machines.filter((m) => m.ref !== w.m2.ref);
      s.retired.push({ keyId: m2kid, pub: w.m2.key.pub, notAfter: iso(w.clock), holder: { machine: w.m2.ref } });
    });
    await h.settle();
    expect(h.shown()).toEqual(['s1 r5']);
    expect(h.rows.rows().pending).toEqual([]);
  });

  it('keeps the newest records the waiting set can hold', async () => {
    const w = await World.make();
    const h = await start(w, { unverifiedMax: 2 });
    const refs = [`x1${random(20)}`, `x2${random(20)}`, `x3${random(20)}`];
    h.setRoster(refs);
    for (const ref of refs) await push(h, await w.list({ ref, key: await generateSigningKey() }, 's', 1));
    expect(h.rows.rows().pending).toEqual(refs.slice(1));
  });
});

describe('the snapshot and the revisions', () => {
  it('replaces the rows at the last page, keeping a raced higher revision and a key a live frame brought', async () => {
    const w = await World.make();
    const h = await start(w);
    await snapshot(h, [await w.list(w.m1, 'a', 5), await w.list(w.m1, 'b', 5)]);
    expect(h.shown()).toEqual(['a r5', 'b r5']);
    h.feed.close();
    h.feed.open();
    h.feed.push(await w.list(w.m1, 'a', 7)); // a live frame raced the snapshot
    h.feed.push(await w.list(w.m1, 'd', 1)); // listed after the snapshot was taken
    h.feed.page([await w.list(w.m1, 'a', 6), await w.list(w.m1, 'c', 1)], false);
    await h.settle();
    expect(h.rows.rows().complete).toBe(false);
    h.feed.page([], true);
    await h.settle();
    expect(h.shown()).toEqual(['a r7', 'c r1', 'd r1']);
    expect(h.rows.rows().complete).toBe(true);
    // b left the rows and keeps its mark
    await h.rows.close();
    expect(h.cache()!.marks[`${w.m1.ref}/b`]).toMatchObject({ revision: 5, gone: false });
  });

  it('orders by revision, and a gone record removes the row', async () => {
    const w = await World.make();
    const h = await start(w);
    await push(h, await w.list(w.m1, 's', 5), await w.list(w.m1, 's', 4));
    expect(h.shown()).toEqual(['s r5']);
    await push(h, await w.list(w.m1, 's', 6));
    expect(h.shown()).toEqual(['s r6']);
    await push(h, await w.gone(w.m1, 's', 7));
    expect(h.shown()).toEqual([]);
  });

  it('ignores a replay below a gone mark live, after a reconnect whose snapshot omits the key, and after a relaunch', async () => {
    const w = await World.make();
    let h = await start(w);
    const ten = await w.list(w.m1, 's', 10);
    await snapshot(h, [ten]);
    await push(h, await w.gone(w.m1, 's', 11));
    await push(h, ten);
    expect(h.shown()).toEqual([]);
    await snapshot(h, []);
    await push(h, ten);
    expect(h.shown()).toEqual([]);
    h = await relaunch(w, h);
    await push(h, ten);
    await snapshot(h, [ten]);
    expect(h.shown()).toEqual([]);
    await push(h, await w.list(w.m1, 's', 12));
    expect(h.shown()).toEqual(['s r12']);
  });

  it('restores a live row from the cache at its mark and keeps it across unchanged snapshots; a gone mark stays empty; a conflict is ignored', async () => {
    const w = await World.make();
    let h = await start(w);
    const j = await w.list(w.m1, 'j', 5);
    await push(h, j, await w.gone(w.m1, 'k', 3));
    h = await relaunch(w, h);
    expect(h.shown()).toEqual(['j r5']);
    expect(h.rows.rows().complete).toBe(false);
    await snapshot(h, [j]);
    await snapshot(h, [j]);
    expect(h.shown()).toEqual(['j r5']);
    await push(h, await w.gone(w.m1, 'k', 3));
    expect(h.shown()).toEqual(['j r5']);
    await push(h, await w.list(w.m1, 'j', 5, { title: 'another' }));
    expect(h.rows.rows().rows[0].title).toBe('j r5');
    expect(h.logs.some((line) => line.includes('conflicting record'))).toBe(true);
  });
});

describe('the marks', () => {
  it('outlive a certificate set that leaves out the signing machine, and a contested ref', async () => {
    const w = await World.make();
    const h = await start(w);
    const ten = await w.list(w.d, 's', 10);
    await push(h, ten, await w.gone(w.d, 's', 11));
    // the hub serves a set without the certificate for one refresh, then with it again
    w.certs = NO_CERTIFICATES;
    w.session.changed();
    await h.settle();
    w.certs = { certs: [w.d.cert], retirements: [] };
    w.session.changed();
    await push(h, ten);
    expect(h.shown()).toEqual([]);
    // a second live certificate for the ref contests it, then goes
    const twelve = await w.list(w.d, 's', 12);
    await push(h, twelve);
    expect(h.shown()).toEqual(['s r12']);
    w.certs = { certs: [w.d.cert, await w.certify(w.d.ref, await generateSigningKey())], retirements: [] };
    w.session.changed();
    await h.settle();
    expect(h.shown()).toEqual([]);
    expect(h.rows.rows().pending).toEqual([w.d.ref]);
    w.certs = { certs: [w.d.cert], retirements: [] };
    w.session.changed();
    await push(h, ten);
    expect(h.shown()).toEqual(['s r12']);
    // the live row's certificate left out while a reconnect's snapshot omits the key: only the mark is left to guard it
    w.certs = NO_CERTIFICATES;
    w.session.changed();
    await snapshot(h, []);
    w.certs = { certs: [w.d.cert], retirements: [] };
    w.session.changed();
    await push(h, ten);
    expect(h.shown()).toEqual([]);
    await h.rows.close();
    expect(h.cache()!.marks[`${w.d.ref}/s`]).toMatchObject({ revision: 12, delegation: w.delegation.id });
  });

  it("outlive their delegation's expires, so a late renewal does not reopen a replay", async () => {
    const w = await World.make();
    const h = await start(w);
    const ten = await w.list(w.d, 's', 10);
    await push(h, ten, await w.gone(w.d, 's', 11));
    const deadline = Date.parse(w.delegation.expires);
    w.clock = deadline + 60_000;
    w.session.changed(); // a refresh past the deadline, the renewal withheld
    await h.settle();
    await w.adopt((s) => {
      s.delegations = s.delegations.map((d) => (d.id === w.delegation.id ? { ...d, expires: iso(deadline + 24 * HOUR) } : d));
    }, iso(deadline - 60_000));
    await push(h, ten);
    expect(h.shown()).toEqual([]);
    await push(h, await w.list(w.d, 's', 12));
    expect(h.shown()).toEqual(['s r12']);
  });

  it('drop only when the head retires or revokes their key, or revokes their delegation; never by count', async () => {
    const w = await World.make();
    let h = await start(w);
    const ten = await w.list(w.m1, 'old', 10);
    await push(h, ten, await w.gone(w.m1, 'old', 11), await w.gone(w.m2, 'x', 2), await w.gone(w.d, 'y', 2));
    await h.rows.close();
    // many thousand marks after the first: none of them pushes it out
    const file = h.cache()!;
    const m2kid = await keyId(w.m2.key.pub);
    for (let i = 0; i < 20_000; i++) file.marks[`${w.m2.ref}/filler-${i}`] = { revision: 1, hash: `h${i}`, kid: m2kid, delegation: null, gone: true };
    h.files.store.set(LISTINGS_FILE, JSON.stringify(file));
    h = await start(w, { files: h.files });
    for (let i = 0; i < 50; i++) h.feed.push(await w.list(w.m2, `live-${i}`, 1));
    await push(h, ten);
    expect(h.shown()).not.toContain('old r10');
    await h.rows.close();
    expect(Object.keys(h.cache()!.marks)).toHaveLength(3 + 20_000 + 50);

    // the evidence, one kind at a time
    h = await start(w, { files: h.files });
    const fresh = await generateSigningKey();
    const m1kid = await keyId(w.m1.key.pub);
    await w.adopt((s) => {
      s.machines = s.machines.map((m) => (m.ref === w.m1.ref ? { ...m, pub: fresh.pub } : m));
      s.retired.push({ keyId: m1kid, pub: w.m1.key.pub, notAfter: iso(w.clock), holder: { machine: w.m1.ref } });
    });
    await h.rows.close();
    let marks = h.cache()!.marks;
    expect(marks[`${w.m1.ref}/old`]).toBeUndefined();
    expect(marks[`${w.m2.ref}/x`]).toBeDefined();

    h = await start(w, { files: h.files });
    await w.adopt((s) => {
      s.machines = s.machines.filter((m) => m.ref !== w.m2.ref);
      s.revoked.push({ keyId: m2kid, holder: { machine: w.m2.ref } });
    });
    await h.rows.close();
    marks = h.cache()!.marks;
    expect(Object.keys(marks).filter((key) => key.startsWith(w.m2.ref))).toEqual([]);
    expect(marks[`${w.d.ref}/y`]).toMatchObject({ delegation: w.delegation.id });

    h = await start(w, { files: h.files });
    const delegationKid = await keyId(w.delegation.key.pub);
    await w.adopt((s) => {
      s.delegations = s.delegations.filter((d) => d.id !== w.delegation.id);
      s.revoked.push({ keyId: delegationKid, holder: { delegation: w.delegation.id, prefix: 'vm-' } });
    });
    await h.rows.close();
    expect(h.cache()!.marks).toEqual({});
  });

  it('take their delegation only from a certificate that verifies, so revoking a forged one drops nothing', async () => {
    const w = await World.make();
    let h = await start(w);
    const ten = await w.list(w.d, 's', 10);
    await push(h, ten);
    // the hub serves, ahead of the genuine certificate, a copy naming another delegation
    const other = { id: hex(), key: await generateSigningKey() };
    await w.adopt((s) => {
      s.delegations.push({ id: other.id, pub: other.key.pub, prefix: 'zz-', expires: w.delegation.expires, maxUses: 10, offlineRevokeS: 0, owners: [w.A] });
    });
    w.certs = { certs: [{ ...w.d.cert, body: { ...w.d.cert.body, delegation: other.id } }, w.d.cert], retirements: [] };
    w.session.changed();
    await push(h, await w.gone(w.d, 's', 11));
    expect(h.shown()).toEqual([]);
    h = await relaunch(w, h);
    expect(h.cache()!.marks[`${w.d.ref}/s`]).toMatchObject({ revision: 11, delegation: w.delegation.id, gone: true });
    const otherKid = await keyId(other.key.pub);
    await w.adopt((s) => {
      s.delegations = s.delegations.filter((d) => d.id !== other.id);
      s.revoked.push({ keyId: otherKid, holder: { delegation: other.id, prefix: 'zz-' } });
    });
    await push(h, ten);
    expect(h.shown()).toEqual([]);
    await snapshot(h, [ten]);
    expect(h.shown()).toEqual([]);
  });
});

describe('the cache', () => {
  it('is verified at load, and a record that is not its mark is skipped', async () => {
    const w = await World.make();
    const files = memoryFiles();
    const forged = await w.list({ ref: w.m1.ref, key: await generateSigningKey() }, 'forged', 5);
    const honest = await w.list(w.m1, 'honest', 5);
    const altered = await w.list(w.m1, 'altered', 5);
    const file: ListingsFile = {
      version: 1,
      org: ORG,
      records: [forged, honest, { ...altered, body: { ...altered.body, fields: { ...altered.body.fields, title: 'changed' } } }],
      marks: {
        [`${w.m1.ref}/forged`]: { revision: 5, hash: listingHash(forged), kid: forged.sig.kid, delegation: null, gone: false },
        [`${w.m1.ref}/honest`]: { revision: 5, hash: listingHash(honest), kid: honest.sig.kid, delegation: null, gone: false },
        [`${w.m1.ref}/altered`]: { revision: 5, hash: listingHash(altered), kid: altered.sig.kid, delegation: null, gone: false },
      },
    };
    files.store.set(LISTINGS_FILE, JSON.stringify(file));
    const h = await start(w, { files });
    expect(h.shown()).toEqual(['honest r5']);
    expect(h.rows.rows().pending).toEqual([w.m1.ref]);
    expect(h.logs.some((line) => line.includes('altered'))).toBe(true);
  });

  it("discards another org's cache, its marks included", async () => {
    const w = await World.make();
    const files = memoryFiles();
    const other = await w.list(w.m1, 'k', 11);
    files.store.set(
      LISTINGS_FILE,
      JSON.stringify({ version: 1, org: 'another-org', records: [other], marks: { [`${w.m1.ref}/k`]: { revision: 11, hash: 'x', kid: other.sig.kid, delegation: null, gone: true } } }),
    );
    const h = await start(w, { files });
    expect(h.shown()).toEqual([]);
    await push(h, await w.list(w.m1, 'k', 10));
    expect(h.shown()).toEqual(['k r10']);
  });
});

describe('coverage', () => {
  it('reads complete only after the last page, with the head at the version announced at open', async () => {
    const w = await World.make();
    let h = await start(w);
    await push(h, await w.list(w.m1, 's', 5));
    h = await relaunch(w, h);
    expect(h.shown()).toEqual(['s r5']);
    expect(h.rows.rows().complete).toBe(false); // the cache alone
    const announced = w.head().state.version + 1;
    h.feed.open();
    h.feed.state(announced);
    h.feed.page([await w.list(w.m1, 's', 5)], false);
    await h.settle();
    expect(h.rows.rows().complete).toBe(false); // before the last page
    h.feed.page([], true);
    await h.settle();
    expect(h.rows.rows().complete).toBe(false); // the head below the announced version
    await w.adopt();
    await h.settle();
    expect(h.rows.rows().complete).toBe(true);
    h.feed.close();
    h.feed.open();
    await h.settle();
    expect(h.rows.rows().complete).toBe(false); // a reopened feed starts over
  });

  it("names a machine pending while its newly keyed listings wait for the state that rotated its key", async () => {
    const w = await World.make();
    const h = await start(w);
    await snapshot(h, [await w.list(w.m1, 's', 10)]);
    const rotated = { ref: w.m1.ref, key: await generateSigningKey() };
    h.feed.close();
    h.feed.open();
    h.feed.state(w.head().state.version + 1);
    h.feed.page([await w.list(rotated, 's', 20)], true);
    await h.settle();
    expect(h.rows.rows()).toMatchObject({ complete: false, pending: [w.m1.ref] });
    const oldKid = await keyId(w.m1.key.pub);
    await w.adopt((s) => {
      s.machines = s.machines.map((m) => (m.ref === w.m1.ref ? { ...m, pub: rotated.key.pub } : m));
      s.retired.push({ keyId: oldKid, pub: w.m1.key.pub, notAfter: iso(w.clock), holder: { machine: w.m1.ref } });
    });
    await h.settle();
    expect(h.rows.rows()).toMatchObject({ complete: true, pending: [] });
    expect(h.shown()).toEqual(['s r20']);
  });

  it('keeps a machine pending while its waiting record is judged again, until the judgment lands', async () => {
    const w = await World.make();
    // the clock is read as each record is verified: there the rows are read as `org.rows` or an emission would
    const probes: OrgRows[] = [];
    let probing = false;
    const h = await start(w, { onNow: () => void (probing && probes.push(h.rows.rows())) });
    await snapshot(h, [await w.list(w.m1, 's', 10)]);
    const rotated = { ref: w.m1.ref, key: await generateSigningKey() };
    h.feed.close();
    h.feed.open();
    h.feed.state(w.head().state.version + 1);
    h.feed.page([await w.list(rotated, 't', 1)], true);
    await h.settle();
    expect(h.rows.rows()).toMatchObject({ complete: false, pending: [w.m1.ref], rows: [] });
    probing = true;
    const oldKid = await keyId(w.m1.key.pub);
    await w.adopt((s) => {
      s.machines = s.machines.map((m) => (m.ref === w.m1.ref ? { ...m, pub: rotated.key.pub } : m));
      s.retired.push({ keyId: oldKid, pub: w.m1.key.pub, notAfter: iso(w.clock), holder: { machine: w.m1.ref } });
    });
    await h.settle();
    probing = false;
    expect(probes.length).toBeGreaterThan(0);
    for (const probe of probes) {
      if (!probe.rows.some((r) => r.session === 't')) expect(probe.pending).toEqual([w.m1.ref]);
    }
    expect(h.rows.rows()).toMatchObject({ complete: true, pending: [] });
    expect(h.shown()).toEqual(['t r1']);
  });
});

describe('the rows', () => {
  it('are only those of machines in the roster', async () => {
    const w = await World.make();
    const h = await start(w, { roster: [w.m1.ref] });
    await push(h, await w.list(w.m1, 's1', 1), await w.list(w.m2, 's2', 1, { owners: [w.B] }));
    expect(h.shown()).toEqual(['s1 r1']);
    expect(h.rows.rows().machines).toEqual([w.m1.ref]);
    h.setRoster([w.m1.ref, w.m2.ref]);
    expect(h.shown()).toEqual(expect.arrayContaining(['s1 r1', 's2 r1']));
  });

  it('carry mine, the lane and its availability', async () => {
    const w = await World.make();
    const h = await start(w);
    await push(h, await w.list(w.m1, 'a', 1, { owners: [w.B, w.A], lane: 'A' }), await w.list(w.m2, 'b', 1, { owners: [w.B], lane: 'B' }));
    const rows = Object.fromEntries(h.rows.rows().rows.map((r) => [r.session, r]));
    expect(rows.a).toMatchObject({ mine: true, lane: 'A', availability: 'foreign_held', owners: [w.B, w.A] });
    expect(rows.b).toMatchObject({ mine: false, lane: 'B', availability: null });
  });

  // M5 (Interfaces §L): the owners' names come from the held head, beside the member "you" is judged against
  it('name every owner a row lists from the held head, an unlisted id as a former member, and carry the signed-in member', async () => {
    const w = await World.make();
    const gone = hex();
    const h = await start(w);
    await push(h, await w.list(w.m1, 'a', 1, { owners: [w.B, w.A] }), await w.list(w.m2, 'b', 1, { owners: [w.B, gone] }));
    expect(h.rows.rows()).toMatchObject({
      member: w.A,
      members: [
        { id: w.B, email: 'b@example.com', name: 'B' },
        { id: w.A, email: 'owner@example.com', name: 'Owner' },
        { id: gone, email: null, name: 'former member' },
      ],
    });
    // a head that renames a member renames it in the rows; one whose names collide widens both
    await w.adopt((s) => {
      s.members.find((m) => m.id === w.B)!.email = 'owner.b@example.com';
    });
    await h.settle();
    expect(h.rows.rows().members.map((m) => [m.email, m.name])).toEqual([['owner.b@example.com', 'owner.b'], ['owner@example.com', 'owner'], [null, 'former member']]);
    w.session.set(null);
    await h.settle();
    expect(h.rows.rows()).toMatchObject({ members: [], member: null });
  });

  it('join the local org projects by smnsId and by repoProjectId with the signed-in org, and nothing else', async () => {
    const w = await World.make();
    const remote = 'github.com/owner/repo';
    const projects = [project('smns:proj-1', 'smns', 'proj-1'), project(`remote:${remote}`, 'remote', null), project('repo:abc:1', 'repository', null)];
    const h = await start(w, { projects });
    await push(
      h,
      await w.list(w.m1, 'smns', 1, { project: 'proj-1' }),
      await w.list(w.m1, 'remote', 1, { project: repoProjectId(ORG, remote) }),
      await w.list(w.m1, 'elsewhere', 1, { project: repoProjectId('another-org', remote) }),
      await w.list(w.m1, 'none', 1, { project: null }),
    );
    const keys = () => Object.fromEntries(h.rows.rows().rows.map((r) => [r.session, r.orgKey]));
    expect(keys()).toEqual({ smns: 'smns:proj-1', remote: `remote:${remote}`, elsewhere: null, none: null });
    h.setProjects([]);
    await pause(10);
    expect(keys()).toEqual({ smns: null, remote: null, elsewhere: null, none: null });
  });

  it('are emitted whole, coalesced', async () => {
    const w = await World.make();
    const h = await start(w, { coalesce: 40 });
    await pause(60);
    h.emitted.length = 0;
    h.feed.push(await w.list(w.m1, 'a', 1));
    h.feed.push(await w.list(w.m1, 'b', 1));
    h.feed.push(await w.list(w.m1, 'c', 1));
    await h.settle();
    await pause(80);
    expect(h.emitted).toHaveLength(1);
    expect(h.emitted[0].rows.map((r) => r.session)).toEqual(['a', 'b', 'c']);
  });

  it('are none while signed out, and come back at sign-in', async () => {
    const w = await World.make();
    const h = await start(w);
    await snapshot(h, [await w.list(w.m1, 's', 1)]);
    w.session.set(null);
    await h.settle();
    expect(h.rows.rows()).toMatchObject({ rows: [], complete: false, pending: [] });
    await pause(10);
    expect(h.emitted.at(-1)!.rows).toEqual([]);
    w.session.set(w.signedIn());
    await h.settle();
    expect(h.shown()).toEqual(['s r1']);
  });
});
