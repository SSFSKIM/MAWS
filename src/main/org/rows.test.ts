// The remote rows (P5 O8 M2, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M2's Proves for rows.test.ts):
// verification against the held head and its retries, the snapshot's replace rule, the high-water mark per key and the
// only evidence that drops one, the cache verified at load, `complete` and `pending`, the roster filter, `mine`, the key
// table's row key for a listing's project (the project registry's M10), coalescing and signed out. A fake feed and session over real signed states, listings and
// certificates (the protocol package's signing), and an in-memory org directory.
import { afterEach, describe, expect, it } from 'vitest';
import { generateSigningKey, keyId, NO_CERTIFICATES, type Listing, type Signed } from '../../../apps/org-protocol/src/index.ts';
import { iso } from '../../../test/endpoint/org-fixtures';
import { fakeFeed, fakeLinks, HOUR, hex, memoryFiles, ORG, random, World } from '../../../test/org/rows-world';
import type { OrgRows } from '@shared/ipc/schema/org';
import type { MachineRef } from '@shared/machine/ref';
import type { OrgKey } from '@shared/machine/org-key';
import { createRemoteRows, LISTINGS_FILE, listingHash, type ListingsFile, type RemoteRows } from './rows';


type Harness = Awaited<ReturnType<typeof start>>;
const running: RemoteRows[] = [];

async function start(
  w: World,
  options: { files?: ReturnType<typeof memoryFiles>; roster?: string[]; keys?: Record<string, string>; coalesce?: number; unverifiedMax?: number; onNow?: () => void; links?: ReturnType<typeof fakeLinks>; channelMs?: number } = {},
) {
  const feed = fakeFeed();
  // M6b: every machine's link down unless a case brings it up, so M2's cases see the hub alone
  const links = options.links ?? fakeLinks('down');
  const files = options.files ?? memoryFiles();
  let roster = (options.roster ?? [w.m1.ref, w.m2.ref, w.d.ref]) as MachineRef[];
  let keys = options.keys ?? {};
  const rosterListeners = new Set<() => void>();
  const keyListeners = new Set<() => void>();
  const emitted: OrgRows[] = [];
  const logs: string[] = [];
  const rows = createRemoteRows({
    session: w.session,
    feed: feed.feed,
    roster: () => roster,
    onRoster: (listener) => (rosterListeners.add(listener), () => void rosterListeners.delete(listener)),
    keys: { keyOf: (id) => (keys[id] ?? null) as OrgKey | null, onKeys: (listener) => (keyListeners.add(listener), () => void keyListeners.delete(listener)) },
    link: (ref) => links.link(ref),
    files,
    emit: (next) => emitted.push(next),
    now: () => (options.onNow?.(), w.clock),
    timing: { ROWS_COALESCE_MS: options.coalesce ?? 1, ROWS_CACHE_WRITE_MS: 1, ROWS_CHANNEL_MS: options.channelMs ?? 3_600_000, ...(options.unverifiedMax === undefined ? {} : { UNVERIFIED_MAX: options.unverifiedMax }) },
    log: (line) => logs.push(line),
  });
  running.push(rows);
  await rows.loaded;
  return {
    rows,
    feed,
    links,
    files,
    emitted,
    logs,
    settle: () => rows.settled(),
    setRoster(next: string[]) {
      roster = next as MachineRef[];
      rosterListeners.forEach((l) => l());
    },
    setKeys(next: Record<string, string>) {
      keys = next;
      keyListeners.forEach((l) => l());
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

/** Lets an answered call reach the rows' queue, then waits for it. */
async function drain(h: Harness): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await new Promise((resolve) => setImmediate(resolve));
    await h.settle();
  }
}

/** M6b: the machine's channel answers with these listings (the rows asked to read again when no call is out). */
async function channel(h: Harness, ref: string, ...records: Signed<Listing>[]): Promise<void> {
  if (h.links.calls(ref).length === 0) {
    h.rows.refreshChannel(ref as MachineRef);
    await drain(h);
  }
  expect(h.links.answer(ref, records), 'a channel call was out').toBe(true);
  await drain(h);
}

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

  it('file a listing under the key table’s entry for its project, and one the table has none for under none, emitted again when a key is given', async () => {
    const w = await World.make();
    const h = await start(w, { keys: { 'proj-1': 'smns:proj-1' } });
    await push(h, await w.list(w.m1, 'keyed', 1, { project: 'proj-1' }), await w.list(w.m1, 'alone', 1, { project: 'proj-2' }), await w.list(w.m1, 'none', 1, { project: null }));
    const keys = () => Object.fromEntries(h.rows.rows().rows.map((r) => [r.session, r.orgKey]));
    expect(keys()).toEqual({ keyed: 'smns:proj-1', alone: null, none: null });
    h.emitted.length = 0;
    h.setKeys({ 'proj-1': 'smns:proj-1', 'proj-2': 'id:proj-2' });
    await pause(10);
    expect(keys()).toEqual({ keyed: 'smns:proj-1', alone: 'id:proj-2', none: null });
    expect(h.emitted.at(-1)?.rows.find((r) => r.session === 'alone')?.orgKey).toBe('id:proj-2');
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

describe('channel listings (M6b)', () => {
  /** Rows over links that are up, signed in as `member`. */
  async function up(w: World, options: Parameters<typeof start>[1] = {}) {
    const h = await start(w, { links: fakeLinks('up'), ...options });
    await drain(h);
    return h;
  }

  it("keep a channel-only private listing, with its audience and policyRev, across a hub snapshot that lacks it", async () => {
    const w = await World.make();
    const h = await up(w);
    await channel(h, w.m1.ref, await w.list(w.m1, 'p', 20, { audience: [w.A, w.B].sort(), policyRev: 4 }));
    await snapshot(h, [await w.list(w.m1, 'pub', 3)]);
    expect(h.shown()).toEqual(['p r20', 'pub r3']);
    expect(h.rows.rows().rows[0]).toMatchObject({ session: 'p', audience: [w.A, w.B].sort(), policyRev: 4 });
    expect(h.rows.rows().rows[1]).not.toHaveProperty('audience');
  });

  it('keep a session learned from the hub through public -> private, a channel refresh, a hub reconnect and a delayed older gone', async () => {
    const w = await World.make();
    const h = await up(w);
    const shown: string[][] = [];
    const look = () => shown.push(h.shown());
    await snapshot(h, [await w.list(w.m1, 's', 10)]);
    look();
    await channel(h, w.m1.ref, await w.list(w.m1, 's', 12, { audience: [w.A], policyRev: 2 })); // it went private
    look();
    await channel(h, w.m1.ref, await w.list(w.m1, 's', 14, { audience: [w.A], policyRev: 2 })); // a refresh, signed again
    look();
    await snapshot(h, []); // the hub's reconnect: the withdrawn listing is in no page
    look();
    await push(h, await w.gone(w.m1, 's', 11)); // the endpoint's withdrawal, delayed
    look();
    expect(shown).toEqual([['s r10'], ['s r12'], ['s r14'], ['s r14'], ['s r14']]);
  });

  it('draw a private listing signed again for each answer as it was first shown, emitting nothing, while the marks follow the newest (Task 3)', async () => {
    const w = await World.make();
    const h = await up(w);
    const fields = { title: 'private work', audience: [w.A], policyRev: 4 };
    const first = await w.list(w.m1, 'p', 20, fields);
    await channel(h, w.m1.ref, first);
    await pause(5);
    const emitted = h.emitted.length;
    // the endpoint keeps no private listing, so each answer signs it again at a new revision and issue time
    for (const revision of [80, 140]) {
      w.clock += 60_000;
      await channel(h, w.m1.ref, await w.list(w.m1, 'p', revision, fields));
    }
    await pause(5);
    expect(h.rows.rows().rows).toMatchObject([{ session: 'p', revision: 20, issued: first.body.issued, audience: [w.A], policyRev: 4 }]);
    expect(h.emitted.length, 'no rows went out for a listing that says nothing new').toBe(emitted);
    // the newest record is still the mark: a withdrawal below it is a replay, ignored
    await push(h, await w.gone(w.m1, 'p', 100));
    expect(h.shown()).toEqual(['p r20']);
    // what it says changing shows at once, at its own revision and time
    w.clock += 60_000;
    const renamed = await w.list(w.m1, 'p', 200, { ...fields, title: 'renamed' });
    await channel(h, w.m1.ref, renamed);
    expect(h.rows.rows().rows).toMatchObject([{ session: 'p', revision: 200, issued: renamed.body.issued, title: 'renamed' }]);
  });

  it("leave at the channel's omission with no hub membership, but not while the hub holds them", async () => {
    const w = await World.make();
    const h = await up(w);
    const pub = await w.list(w.m1, 'pub', 5);
    await snapshot(h, [pub]);
    await channel(h, w.m1.ref, pub, await w.list(w.m1, 'p', 20, { audience: [w.A] }));
    expect(h.shown()).toEqual(['p r20', 'pub r5']);
    await channel(h, w.m1.ref, await w.list(w.m2, 'other', 1)); // omits both, and names another machine's session
    expect(h.shown()).toEqual(['pub r5']);
  });

  it('leave at a gone of a higher revision from the hub, whichever source held them, and never come back below it', async () => {
    const w = await World.make();
    const h = await up(w);
    const p20 = await w.list(w.m1, 'p', 20, { audience: [w.A] });
    await channel(h, w.m1.ref, p20);
    await push(h, await w.gone(w.m1, 'p', 21));
    expect(h.shown()).toEqual([]);
    await channel(h, w.m1.ref, p20);
    expect(h.shown()).toEqual([]);
    await channel(h, w.m1.ref, await w.list(w.m1, 'p', 22, { audience: [w.A] }));
    expect(h.shown()).toEqual(['p r22']);
  });

  it("ask the machine's channel at once when the hub withdraws a row the channel held, so a private one comes back", async () => {
    const w = await World.make();
    const h = await up(w);
    const ten = await w.list(w.m1, 's', 10);
    await snapshot(h, [ten]);
    await channel(h, w.m1.ref, ten); // the channel lists the public session too
    await push(h, await w.gone(w.m1, 's', 11)); // it went private: the hub's withdrawal lands first
    expect(h.shown()).toEqual([]);
    expect(h.links.calls(w.m1.ref)).toHaveLength(1); // asked at once
    expect(h.links.answer(w.m1.ref, [await w.list(w.m1, 's', 12, { audience: [w.A] })])).toBe(true);
    await drain(h);
    expect(h.shown()).toEqual(['s r12']);
    // a withdrawal of a row only the hub held asks nothing
    await push(h, await w.list(w.m1, 'pub', 1), await w.gone(w.m1, 'pub', 2));
    await drain(h);
    expect(h.links.calls(w.m1.ref)).toHaveLength(0);
  });

  it('take nothing from a call that failed: a dropped link keeps what the last answer showed', async () => {
    const w = await World.make();
    const h = await up(w);
    await channel(h, w.m1.ref, await w.list(w.m1, 'p', 20, { audience: [w.A] }));
    h.rows.refreshChannel(w.m1.ref as MachineRef);
    await drain(h);
    h.links.setState(w.m1.ref, 'down');
    expect(h.links.fail(w.m1.ref)).toBe(true);
    await drain(h);
    expect(h.shown()).toEqual(['p r20']);
    // an answer that is not a list of listings says nothing either
    h.links.setState(w.m1.ref, 'up');
    await drain(h);
    h.links.calls(w.m1.ref)[0].resolve({ ok: true, output: { nope: true } });
    await drain(h);
    expect(h.shown()).toEqual(['p r20']);
    expect(h.logs.some((line) => line.includes('not a list'))).toBe(true);
  });

  it('judge a channel record under the same marks as a hub one: a conflict at a mark is ignored, a replay below it too', async () => {
    const w = await World.make();
    const h = await up(w);
    await push(h, await w.list(w.m1, 's', 10), await w.gone(w.m1, 's', 11));
    await channel(h, w.m1.ref, await w.list(w.m1, 's', 10));
    expect(h.shown()).toEqual([]);
    await channel(h, w.m1.ref, await w.list(w.m1, 's', 11, { title: 'not the gone one' }));
    expect(h.shown()).toEqual([]);
    expect(h.logs.some((line) => line.includes('conflicting record'))).toBe(true);
    const stranger = { ref: w.m1.ref, key: await generateSigningKey() };
    await channel(h, w.m1.ref, await w.list(stranger, 'forged', 1));
    expect(h.shown()).toEqual([]);
    expect(h.rows.rows().pending).toEqual([w.m1.ref]);
    // the next answer lacks it: no source shows it, so it waits no more
    await channel(h, w.m1.ref);
    expect(h.rows.rows().pending).toEqual([]);
  });

  it('keep each source apart across a relaunch: a channel-held row stays through a snapshot that lacks it, and goes at the next omission', async () => {
    const w = await World.make();
    let h = await up(w);
    await channel(h, w.m1.ref, await w.list(w.m1, 'p', 20, { audience: [w.A] }));
    await snapshot(h, [await w.list(w.m1, 'pub', 3)]);
    h = await relaunch(w, h, { links: fakeLinks('down') });
    expect(h.shown()).toEqual(['p r20', 'pub r3']);
    await snapshot(h, []);
    expect(h.shown()).toEqual(['p r20']);
    h.links.setState(w.m1.ref, 'up');
    await drain(h);
    expect(h.links.answer(w.m1.ref, [])).toBe(true);
    await drain(h);
    expect(h.shown()).toEqual([]);
  });

  it('read a machine at its link up, at a new head and on asking, one call at a time, and every ROWS_CHANNEL_MS while up', async () => {
    const w = await World.make();
    const h = await up(w, { channelMs: 40 });
    const calls = () => h.links.calls(w.m1.ref).length;
    expect(calls()).toBe(1); // the sign-in's
    expect(h.links.calls(w.m1.ref)[0]).toMatchObject({ name: 'endpoint.listings', input: null });
    h.rows.refreshChannel(w.m1.ref as MachineRef);
    await w.adopt();
    await drain(h);
    expect(calls()).toBe(1); // one out at a time: the asks wait for it
    h.links.answer(w.m1.ref, []);
    await drain(h);
    expect(calls()).toBe(1); // then one more for them all
    h.links.answer(w.m1.ref, []);
    await drain(h);
    expect(calls()).toBe(0);
    await pause(80);
    expect(calls()).toBe(1); // the period's
    h.links.setState(w.m1.ref, 'down');
    h.links.fail(w.m1.ref);
    await drain(h);
    await pause(80);
    expect(calls()).toBe(0); // nothing while down
    h.links.setState(w.m1.ref, 'up');
    expect(calls()).toBe(1); // its link up
  });

  it("are one reader's: another member of the org signed in sees none of the last one's channel rows, nor an answer asked for them", async () => {
    const w = await World.make();
    const h = await up(w);
    await snapshot(h, [await w.list(w.m1, 'pub', 3)]);
    await channel(h, w.m1.ref, await w.list(w.m1, 'only-a', 12, { audience: [w.A], policyRev: 3 }));
    expect(h.shown()).toEqual(['only-a r12', 'pub r3']);
    // a call asked for A is out when B signs in
    h.rows.refreshChannel(w.m1.ref as MachineRef);
    await drain(h);
    w.session.set(w.signedIn(w.B));
    expect(h.rows.rows().rows.map((r) => r.session)).not.toContain('only-a'); // not even before the change is judged
    await drain(h);
    expect(h.rows.rows().member).toBe(w.B);
    expect(h.shown()).toEqual(['pub r3']);
    expect(h.links.answer(w.m1.ref, [await w.list(w.m1, 'only-a', 13, { audience: [w.A], policyRev: 4 })])).toBe(true);
    await drain(h);
    expect(h.shown()).toEqual(['pub r3']);
    // B's own read follows, and holds what it answers
    await channel(h, w.m1.ref, await w.list(w.m1, 'only-b', 7, { audience: [w.B], policyRev: 1 }));
    expect(h.shown()).toEqual(['only-b r7', 'pub r3']);
    await h.rows.close(); // flushes the cache's deferred write
    expect(h.cache()).toMatchObject({ member: w.B });
  });

  it("restore channel rows from the cache only for the member who read them; the hub's for any", async () => {
    const w = await World.make();
    let h = await up(w);
    await snapshot(h, [await w.list(w.m1, 'pub', 3)]);
    await channel(h, w.m1.ref, await w.list(w.m1, 'only-a', 12, { audience: [w.A], policyRev: 3 }));
    await h.rows.close(); // flushes the cache's deferred write
    expect(h.cache()).toMatchObject({ member: w.A });
    w.session.set(w.signedIn(w.B));
    h = await start(w, { files: h.files, links: fakeLinks('down') });
    await drain(h);
    expect(h.rows.rows().member).toBe(w.B);
    expect(h.shown()).toEqual(['pub r3']);
    // and back as A, whose read the file no longer holds once B's run wrote it
    await h.rows.close();
    w.session.set(w.signedIn(w.A));
    h = await start(w, { files: h.files, links: fakeLinks('down') });
    await drain(h);
    expect(h.shown()).toEqual(['pub r3']);
  });

  it('read nothing while signed out, drop an answer that lands signed out, and read every machine again at the next sign-in', async () => {
    const w = await World.make();
    w.session.set(null);
    const h = await up(w);
    expect(h.links.calls(w.m1.ref)).toHaveLength(0);
    w.session.set(w.signedIn());
    await drain(h);
    expect(h.links.calls(w.m1.ref)).toHaveLength(1);
    w.session.set(null);
    await drain(h);
    h.links.answer(w.m1.ref, [await w.list(w.m1, 'p', 20)]);
    await drain(h);
    w.session.set(w.signedIn());
    await drain(h);
    expect(h.shown()).toEqual([]);
    expect(h.links.calls(w.m1.ref)).toHaveLength(1);
  });
});
