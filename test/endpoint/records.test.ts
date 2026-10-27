// The machine's records and notices at the hub (O10 M3), on a fake connection: a listing signed again only when a field
// changes, sent again byte for byte at each welcome, re-signed under a new key, its revision rising across a lost
// file; withdrawn by a signed `gone` revision (or dropped, if no connection carried it); naming no session for a notify
// while its listing is judged again; a record refused for now tried again with the backoff; the endpoint record issued
// later each time; and `notify`'s counts, told once each, reconciled at a welcome and across a restart, with `wrote`
// once per event and held while no connection is up.
import { generateSigningKey, keyId, NO_CERTIFICATES, verifyListing, type Listing, type OrgState, type Signed, type SigningKey } from 'org-protocol';
import { describe, expect, it } from 'vitest';
import type { HubUpFrame } from '../../src/endpoint/hub-link';
import { EndpointRecords, Listings, RecordRetries, resolveOwners, type RecordsContext } from '../../src/endpoint/listings';
import { Notifier, type NotifyContext } from '../../src/endpoint/notify';
import type { ListingsFile, NotifiedFile } from '../../src/endpoint/state/store';
import { mintRef } from './fake-services';
import { genesis, memberId, newDevice, successor } from './org-fixtures';

async function world() {
  const admin = memberId();
  const other = memberId();
  const device = await newDevice('a1');
  const recovery = await generateSigningKey();
  const ref = mintRef();
  let machineKey: SigningKey = await generateSigningKey();
  let head = await successor(await genesis('org-test', admin, device, recovery), [device], (s) => {
    s.members.push({ id: other, email: 'b@example.com', role: 'member', devices: [] });
    s.machines.push({ name: 'mini', ref, pub: machineKey.pub, owners: [admin] });
    s.machineNames.push({ name: 'mini', ref });
  });
  let file: ListingsFile = {};
  let clock = Date.parse('2026-10-27T10:00:00.000Z');
  let connected = true;
  const sent: HubUpFrame[] = [];
  const relayed = new Set(['p1']);
  const ctx: RecordsContext = {
    ref: () => ref,
    key: () => ({ key: machineKey, keyId: kid }),
    head: () => ({ state: head.state, certificates: NO_CERTIFICATES }),
    now: () => clock,
    send: (frame) => connected && (sent.push(frame), true),
    relays: (project) => relayed.has(project),
    store: { read: () => file, write: (next) => void (file = next) },
    log: () => {},
  };
  let kid = await keyId(machineKey.pub);
  return {
    admin,
    other,
    ref,
    ctx,
    sent,
    relayed,
    listings: () => sent.filter((f): f is { t: 'listing'; record: Signed<Listing> } => f.t === 'listing'),
    get file() {
      return file;
    },
    set file(next: ListingsFile) {
      file = next;
    },
    get head() {
      return head;
    },
    tick: (ms = 1) => void (clock += ms),
    connect: (on: boolean) => void (connected = on),
    async amend(edit: (s: OrgState) => void) {
      head = await successor(head, [device], edit);
    },
    async rekey() {
      machineKey = await generateSigningKey();
      kid = await keyId(machineKey.pub);
      await this.amend((s) => void (s.machines.find((m) => m.ref === ref)!.pub = machineKey.pub));
    },
  };
}

const report = { session: 's1', project: 'p1', lane: 'A' as const, state: 'working', title: 'Fix it', owners: ['@machine'] };

describe('listings', () => {
  it('signs a listing the head verifies, @machine resolved to the machine’s owners, and again only when a field changes', async () => {
    const w = await world();
    const listings = new Listings(w.ctx);
    await listings.report(report);
    await listings.report(report);
    expect(w.listings()).toHaveLength(1);
    const [first] = w.listings();
    expect(first.record.body).toMatchObject({ org: 'org-test', machine: w.ref, session: 's1', fields: { owners: [w.admin], project: 'p1', lane: 'A', state: 'working', title: 'Fix it' } });
    expect(await verifyListing(w.head.state, first.record, NO_CERTIFICATES, new Date())).toEqual({ ok: true });
    w.tick();
    await listings.report({ ...report, state: 'waiting' });
    expect(w.listings()).toHaveLength(2);
    expect(w.listings()[1].record.body.revision).toBeGreaterThan(first.record.body.revision);
    expect(listings.listed('s1')).toEqual({ project: 'p1' });
  });

  it('lists no private session and none in a project it doesn’t relay; a project opened later lists it at the next refresh', async () => {
    const w = await world();
    const listings = new Listings(w.ctx);
    await listings.report({ ...report, session: 'secret', access: 'private' });
    await listings.report({ ...report, session: 'elsewhere', project: 'p2' });
    expect(w.sent).toEqual([]);
    expect(listings.listed('secret')).toBeNull();
    w.relayed.add('p2');
    await listings.refresh();
    expect(w.listings().map((l) => l.record.body.session)).toEqual(['elsewhere']);
  });

  it('re-issues an @machine listing when the machine’s owners or the org’s admins change, and keeps an explicit owner', async () => {
    const w = await world();
    const listings = new Listings(w.ctx);
    await listings.report(report);
    expect(w.listings()[0].record.body.fields.owners).toEqual([w.admin]);
    await w.amend((s) => void (s.machines[0].owners = 'org'));
    await listings.refresh();
    // An org-owned machine's owners are the admins: the same set, so nothing new.
    expect(w.listings()).toHaveLength(1);
    await w.amend((s) => void (s.members.find((m) => m.id === w.other)!.role = 'admin'));
    await listings.refresh();
    expect(w.listings()).toHaveLength(2);
    expect(w.listings()[1].record.body.fields.owners).toEqual([w.admin, w.other]);
    // Explicit owners stand beside the token, each once; what isn't a member id never leaves.
    const third = memberId();
    expect(await resolveOwners([third, '@machine', w.admin, 'not-a-member-id'], w.head.state, w.ref, NO_CERTIFICATES, new Date())).toEqual([third, w.admin, w.other]);
  });

  it('sends every listing it holds again at each welcome, byte for byte, and one made while no connection was up', async () => {
    const w = await world();
    const listings = new Listings(w.ctx);
    w.connect(false);
    await listings.report(report);
    expect(w.sent).toEqual([]);
    expect(Object.keys(w.file)).toEqual(['s1']);
    w.connect(true);
    await listings.welcome();
    await listings.welcome();
    expect(w.listings()).toHaveLength(2);
    expect(JSON.stringify(w.listings()[1].record)).toBe(JSON.stringify(w.file.s1.record));
    expect(w.listings()[0].record).toBe(w.listings()[1].record);
  });

  it('after a restart, sends what its file holds at the welcome before sminos reports anything, and signs a new key’s anew', async () => {
    const w = await world();
    await new Listings(w.ctx).report(report);
    const held = w.file.s1.record;
    const restarted = new Listings(w.ctx);
    await restarted.welcome();
    expect(w.listings().at(-1)!.record).toEqual(held);
    await w.rekey();
    // Under the new key a held record goes again only once its session is reported: it is signed then.
    const before = w.sent.length;
    await restarted.welcome();
    expect(w.sent.length).toBe(before);
    await restarted.report(report);
    const resigned = w.listings().at(-1)!.record;
    expect(resigned.sig.kid).not.toBe(held.sig.kid);
    expect(resigned.body.revision).toBeGreaterThan(held.body.revision);
    expect(await verifyListing(w.head.state, resigned, NO_CERTIFICATES, new Date())).toEqual({ ok: true });
  });

  it('keeps its revisions rising past a lost file (the clock’s milliseconds)', async () => {
    const w = await world();
    const listings = new Listings(w.ctx);
    await listings.report(report);
    const first = w.file.s1.revision;
    w.file = {};
    w.tick(5);
    await listings.report({ ...report, state: 'idle' });
    expect(w.file.s1.revision).toBeGreaterThan(first);
  });
});

describe('withdrawing a listing (RL6’s `gone`; the remote layer’s Decision Log 27)', () => {
  it('signs a last `gone` revision when a listed session leaves or goes private, with every field but its lane empty, and lists it again higher', async () => {
    const w = await world();
    const listings = new Listings(w.ctx);
    await listings.report(report);
    const live = w.file.s1.record;
    w.tick();
    await listings.gone('s1');
    const left = w.listings().at(-1)!.record;
    expect(left.body).toMatchObject({ org: 'org-test', machine: w.ref, session: 's1', fields: { owners: [], project: null, lane: 'A', state: 'gone', title: '' } });
    expect(left.body.revision).toBeGreaterThan(live.body.revision);
    expect(await verifyListing(w.head.state, left, NO_CERTIFICATES, new Date())).toEqual({ ok: true });
    // listings.json keeps it like any other record, and no notify may name the session.
    expect(w.file.s1.record).toEqual(left);
    expect(listings.listed('s1')).toBeNull();
    await listings.gone('s1');
    expect(w.listings()).toHaveLength(2);

    // Reported again: a new, higher revision.
    w.tick();
    await listings.report(report);
    const back = w.listings().at(-1)!.record;
    expect(back.body.fields.state).toBe('working');
    expect(back.body.revision).toBeGreaterThan(left.body.revision);

    // Gone private: withdrawn, once.
    w.tick();
    await listings.report({ ...report, access: 'private' });
    await listings.report({ ...report, access: 'private', title: 'still private' });
    const hidden = w.listings().slice(3);
    expect(hidden.map((l) => l.record.body.fields)).toEqual([{ owners: [], project: null, lane: 'A', state: 'gone', title: '' }]);
    expect(hidden[0].record.body.revision).toBeGreaterThan(back.body.revision);

    // A welcome sends the tombstone again as it holds it.
    await listings.welcome();
    expect(w.listings().at(-1)!.record).toBe(w.file.s1.record);
    expect(w.file.s1.record.body.fields.state).toBe('gone');
  });

  it('signs nothing for a session it never listed', async () => {
    const w = await world();
    const listings = new Listings(w.ctx);
    await listings.report({ ...report, access: 'private' });
    await listings.gone('s1');
    await listings.gone('never-seen');
    expect(w.sent).toEqual([]);
  });

  it('owes a withdrawal it can’t sign yet (no head) until the next refresh, and signs a tombstone made under an old key again at a welcome', async () => {
    const w = await world();
    let ready = true;
    const listings = new Listings({ ...w.ctx, head: () => (ready ? w.ctx.head() : null) });
    await listings.report(report);
    ready = false;
    await listings.gone('s1');
    await listings.welcome();
    expect(w.listings()).toHaveLength(1);
    ready = true;
    await listings.refresh();
    const left = w.listings().at(-1)!.record;
    expect(left.body.fields.state).toBe('gone');
    await listings.refresh();
    expect(w.listings()).toHaveLength(2);

    await w.rekey();
    w.tick();
    await listings.welcome();
    const resigned = w.listings().at(-1)!.record;
    expect(resigned.sig.kid).not.toBe(left.sig.kid);
    expect(resigned.body.fields).toEqual(left.body.fields);
    expect(resigned.body.revision).toBeGreaterThan(left.body.revision);
  });

  it('drops, rather than withdraws, a listing no connection carried: nothing of a session made private reaches the hub, after a restart too', async () => {
    const w = await world();
    w.connect(false);
    const listings = new Listings(w.ctx);
    await listings.report(report);
    await listings.report({ ...report, session: 's2' });
    await listings.report({ ...report, access: 'private' });
    expect(listings.listed('s2')).toBeNull();
    await listings.gone('s2');
    expect(w.file).toEqual({});
    w.connect(true);
    await new Listings(w.ctx).welcome();
    expect(w.sent).toEqual([]);
  });

  it('tells the hub before the tombstone that a withdrawn session holds nothing pending', async () => {
    const w = await world();
    const order: string[] = [];
    const listings = new Listings({ ...w.ctx, withdrawing: (session, project) => void order.push(`withdrawing ${session} in ${project}`), send: (frame) => (order.push(frame.t), w.ctx.send(frame)) });
    await listings.report(report);
    await listings.gone('s1');
    expect(order).toEqual(['listing', 'withdrawing s1 in p1', 'listing']);
  });
});

describe('a listing in the making (review finding 2)', () => {
  it('names no session for a notify while its listing is being judged again, and says when it is current', async () => {
    const w = await world();
    const current: string[] = [];
    const listings = new Listings({ ...w.ctx, listedNow: (session) => void current.push(session) });
    await listings.report(report);
    expect(current).toEqual(['s1']);
    // The machine's owners change: until the listing naming them is sent, a notify would push the old owners.
    await w.amend((s) => void (s.machines.find((m) => m.ref === w.ref)!.owners = [w.admin, w.other]));
    const refreshing = listings.refresh();
    expect(listings.listed('s1')).toBeNull();
    await refreshing;
    expect(w.listings().at(-1)!.record.body.fields.owners).toEqual([w.admin, w.other]);
    expect(listings.listed('s1')).toEqual({ project: 'p1' });
    expect(current).toEqual(['s1', 's1']);
    // Judged again and unchanged: current again, with nothing signed.
    const again = listings.report(report);
    expect(listings.listed('s1')).toBeNull();
    await again;
    expect(listings.listed('s1')).toEqual({ project: 'p1' });
    expect(current).toEqual(['s1', 's1', 's1']);
    expect(w.listings()).toHaveLength(2);
  });
});

describe('a record the hub refused for now (review finding 5)', () => {
  it('sends a listing again byte for byte while it is still the session’s latest, and nothing for one replaced since', async () => {
    const w = await world();
    const listings = new Listings(w.ctx);
    await listings.report(report);
    const first = w.file.s1.record;
    expect(await listings.resend('s1', first.body.revision)).toBe(true);
    expect(w.listings().at(-1)!.record).toBe(first);
    w.tick();
    await listings.report({ ...report, state: 'idle' });
    const before = w.sent.length;
    expect(await listings.resend('s1', first.body.revision)).toBe(false);
    expect(await listings.resend('never-listed', 1)).toBe(false);
    expect(w.sent.length).toBe(before);
  });

  it('tries each refused record again with the link’s backoff, one timer per record, all dropped when the connection ends', () => {
    const timers: { ms: number; run: () => void; cleared: boolean }[] = [];
    const retries = new RecordRetries({
      random: () => 1,
      setTimer: (run, ms) => {
        const timer = { ms, run, cleared: false };
        timers.push(timer);
        return () => void (timer.cleared = true);
      },
    });
    const ran: string[] = [];
    retries.retry('listing s1 5', () => void ran.push('s1'));
    retries.retry('listing s1 5', () => void ran.push('s1 twice'));
    retries.retry('endpoint', () => void ran.push('endpoint'));
    expect(timers.map((t) => t.ms)).toEqual([1000, 1000]);
    timers[0].run();
    expect(ran).toEqual(['s1']);
    // Refused again: the next wait doubles.
    retries.retry('listing s1 5', () => void ran.push('s1'));
    expect(timers.at(-1)!.ms).toBe(2000);
    retries.clear();
    expect(timers.slice(1).every((t) => t.cleared)).toBe(true);
    retries.retry('listing s1 5', () => {});
    expect(timers.at(-1)!.ms).toBe(1000);
  });
});

describe('the endpoint record', () => {
  it('is issued later each time, and again when the addresses change', async () => {
    const w = await world();
    const records = new EndpointRecords(w.ctx);
    await records.issue();
    await records.issue();
    await records.setAddresses(['100.64.0.2', '100.64.0.1']);
    await records.setAddresses(['100.64.0.1', '100.64.0.2']);
    const sent = w.sent.filter((f) => f.t === 'endpoint').map((f) => (f as { record: { body: { issued: string; addresses: string[] } } }).record.body);
    expect(sent.map((r) => r.addresses)).toEqual([[], [], ['100.64.0.1', '100.64.0.2']]);
    expect(new Set(sent.map((r) => r.issued)).size).toBe(3);
    expect([...sent.map((r) => r.issued)].sort()).toEqual(sent.map((r) => r.issued));
  });
});

describe('notify', () => {
  const setup = () => {
    const sent: unknown[] = [];
    let up = true;
    const listed = new Set(['s1', 's2']);
    let file: NotifiedFile = {};
    const ctx: NotifyContext = {
      send: (frame) => up && (sent.push({ ...frame }), true),
      listed: (session) => (listed.has(session) ? { project: 'p1' } : null),
      store: { read: () => file, write: (next) => void (file = next) },
      log: () => {},
    };
    const notifier = new Notifier(ctx);
    return { notifier, sent, listed, ctx, file: () => file, up: (on: boolean) => void (up = on) };
  };
  const notify = (session: string, kind: string, pending: number) => ({ t: 'notify', session, project: 'p1', kind, pending });

  it('tells a rise as `waiting` and a fall as `settled`, each change once, from each project’s whole pending set', () => {
    const { notifier, sent } = setup();
    notifier.pendingSet('p1', [{ session: 's1' }]);
    notifier.pendingSet('p1', [{ session: 's1' }]);
    notifier.pendingSet('p1', [{ session: 's1' }, { session: 's1' }, { session: 's2' }]);
    notifier.pendingSet('p1', [{ session: 's1' }]);
    notifier.pendingSet('p1', []);
    expect(sent).toEqual([notify('s1', 'waiting', 1), notify('s1', 'waiting', 2), notify('s2', 'waiting', 1), notify('s1', 'settled', 1), notify('s2', 'settled', 0), notify('s1', 'settled', 0)]);
  });

  it('notifies nothing for a session that isn’t listed', () => {
    const { notifier, sent } = setup();
    notifier.pendingSet('p1', [{ session: 'private' }]);
    notifier.hostMessage({ kind: 'host', session: 'private', project: 'p1', sub: null, body: { event: { kind: 'message', writer: 'w', seq: 1 } } });
    expect(sent).toEqual([]);
  });

  it('tells a session’s count and its `wrote` once its listing is sent, and a welcome drops a `wrote` still unlisted', () => {
    const { notifier, sent, listed } = setup();
    const host = (session: string, seq: number) => ({ kind: 'host', session, project: 'p1', sub: null, body: { event: { kind: 'message', writer: 'mini/host', seq } } });
    notifier.pendingSet('p1', [{ session: 's3' }]);
    notifier.hostMessage(host('s3', 1));
    notifier.hostMessage(host('private', 2));
    expect(sent).toEqual([]);
    listed.add('s3');
    notifier.listed('s3');
    expect(sent).toEqual([notify('s3', 'waiting', 1), notify('s3', 'wrote', 1)]);
    notifier.welcome();
    listed.add('private');
    notifier.listed('private');
    expect(sent).toHaveLength(2);
  });

  it('after a restart, settles a count it told before it when the first pending set leaves the session out (review finding 4)', () => {
    const { notifier, sent, ctx, file } = setup();
    notifier.pendingSet('p1', [{ session: 's1' }, { session: 's2' }]);
    notifier.pendingSet('p1', [{ session: 's1' }]);
    expect(file()).toEqual({ s1: { project: 'p1', pending: 1 } });
    const restarted = new Notifier(ctx);
    restarted.pendingSet('p2', []);
    restarted.pendingSet('p1', []);
    expect(sent.slice(3)).toEqual([notify('s1', 'settled', 0)]);
    expect(file()).toEqual({});
  });

  it('owes a withdrawn session’s `settled 0` while no connection is up, across a restart, and pays it at the welcome though the session is unlisted (round 2 finding 1)', () => {
    const { notifier, sent, listed, ctx, file, up } = setup();
    notifier.pendingSet('p1', [{ session: 's1' }, { session: 's2' }]);
    up(false);
    listed.delete('s1');
    listed.delete('s2');
    notifier.withdrawn('s1', 'p1');
    notifier.withdrawn('s2', 'p1');
    expect(sent).toHaveLength(2);
    up(true);
    // The same process reconnects: both are paid.
    notifier.welcome();
    expect(sent.slice(2)).toEqual([notify('s1', 'settled', 0), notify('s2', 'settled', 0)]);
    notifier.welcome();
    expect(sent).toHaveLength(4);
    expect(file()).toEqual({});

    // Owed across a restart: kept on disk until it is sent.
    listed.add('s2');
    notifier.pendingSet('p1', [{ session: 's2' }]);
    expect(sent.slice(4)).toEqual([notify('s2', 'waiting', 1)]);
    listed.delete('s2');
    up(false);
    notifier.withdrawn('s2', 'p1');
    const restarted = new Notifier(ctx);
    up(true);
    restarted.welcome();
    expect(sent.slice(5)).toEqual([notify('s2', 'settled', 0)]);
    expect(file()).toEqual({});
  });

  it('keeps an owed `settled 0` through a `forget` that comes first after a restart (round 3 finding 1)', () => {
    const { notifier, sent, listed, ctx, file, up } = setup();
    notifier.pendingSet('p1', [{ session: 's1' }]);
    up(false);
    listed.delete('s1');
    notifier.withdrawn('s1', 'p1');
    const restarted = new Notifier(ctx);
    restarted.forget('s1');
    up(true);
    restarted.welcome();
    expect(sent).toEqual([notify('s1', 'waiting', 1), notify('s1', 'settled', 0)]);
    expect(file()).toEqual({});
  });

  it('pays an owed `settled 0` at the welcome though the session is listed again, before any count is restated (round 3 finding 2)', () => {
    const { notifier, sent, listed, ctx, file, up } = setup();
    notifier.pendingSet('p1', [{ session: 's1' }]);
    up(false);
    listed.delete('s1');
    notifier.withdrawn('s1', 'p1');
    const restarted = new Notifier(ctx);
    listed.add('s1');
    up(true);
    restarted.welcome();
    restarted.pendingSet('p1', []);
    expect(sent).toEqual([notify('s1', 'waiting', 1), notify('s1', 'settled', 0)]);
    expect(file()).toEqual({});
    // A count restated later is told after the zero, as usual.
    restarted.pendingSet('p1', [{ session: 's1' }]);
    expect(sent.slice(2)).toEqual([notify('s1', 'waiting', 1)]);
  });

  it('carries the count it last told in a `wrote` after a restart, before sminos restates the set, and keeps what it told (round 2 finding 2)', () => {
    const { notifier, sent, ctx, file } = setup();
    const host = (seq: number) => ({ kind: 'host', session: 's1', project: 'p1', sub: null, body: { event: { kind: 'message', writer: 'mini/host', seq } } });
    notifier.pendingSet('p1', [{ session: 's1' }]);
    const restarted = new Notifier(ctx);
    restarted.hostMessage(host(1));
    restarted.pendingSet('p1', [{ session: 's1' }]);
    expect(sent).toEqual([notify('s1', 'waiting', 1), notify('s1', 'wrote', 1)]);
    // A `wrote` with a count the hub wasn't told is bookkept like any other notify: the set restating it tells nothing.
    restarted.pending('s1', 2);
    restarted.hostMessage(host(2));
    restarted.pendingSet('p1', [{ session: 's1' }]);
    expect(sent.slice(2)).toEqual([notify('s1', 'waiting', 2), notify('s1', 'wrote', 2), notify('s1', 'settled', 1)]);
    expect(file()).toEqual({ s1: { project: 'p1', pending: 1 } });
  });

  it('settles a withdrawn session’s count at the hub, then tells it nothing more', () => {
    const { notifier, sent, listed } = setup();
    notifier.pendingSet('p1', [{ session: 's1' }, { session: 's1' }]);
    // By the time it is withdrawn the session no longer qualifies (it left, or is private): its project comes from its listing.
    listed.delete('s1');
    notifier.withdrawn('s1', 'p1');
    notifier.withdrawn('s1', 'p1');
    notifier.pendingSet('p1', [{ session: 's1' }]);
    expect(sent).toEqual([notify('s1', 'waiting', 2), notify('s1', 'settled', 0)]);
  });

  it('tells at the welcome what changed while no connection was up, as one change', () => {
    const { notifier, sent, up } = setup();
    notifier.pendingSet('p1', [{ session: 's1' }]);
    up(false);
    notifier.pendingSet('p1', [{ session: 's1' }, { session: 's1' }, { session: 's1' }]);
    notifier.pendingSet('p1', [{ session: 's1' }, { session: 's1' }]);
    up(true);
    notifier.welcome();
    notifier.welcome();
    expect(sent).toEqual([notify('s1', 'waiting', 1), notify('s1', 'waiting', 2)]);
  });

  it('sends `wrote` once per to-human event outside a subscription, and holds one that came while no connection was up', () => {
    const { notifier, sent, up } = setup();
    const host = (seq: number, extra: Partial<{ sub: string | null; kind: string; eventKind: string }> = {}) => ({
      kind: extra.kind ?? 'host',
      session: 's1',
      project: 'p1',
      sub: extra.sub ?? null,
      body: { event: { kind: extra.eventKind ?? 'message', writer: 'mini/host', seq } },
    });
    notifier.hostMessage(host(1));
    notifier.hostMessage(host(1));
    notifier.hostMessage(host(2, { sub: 'sub-1' }));
    notifier.hostMessage(host(3, { eventKind: 'status' }));
    notifier.hostMessage(host(4, { kind: 'presence' }));
    expect(sent).toEqual([notify('s1', 'wrote', 0)]);
    up(false);
    notifier.hostMessage(host(5));
    up(true);
    notifier.welcome();
    notifier.welcome();
    expect(sent).toEqual([notify('s1', 'wrote', 0), notify('s1', 'wrote', 0)]);
  });
});
