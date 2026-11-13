// The hidden store (UX wave U7, O-16; docs/doperpowers/plans/2026-11-12-ux-wave-U7-sidebar-title-bar-destinations.md,
// Interfaces §E): the `sidebar.hidden` key read once and written 250 ms after the last change, never over a read that
// did not answer; `afterLook`, the one rule for when a hidden session returns, as a table; the connection's looks, once
// per route; the drop rule and the bound.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import { addressOf } from '@shared/machine/address';
import { digest, record, remoteRow } from '../../../../test/support/builders';
import { fakeClient } from '../../../../test/support/fake-client';
import { at, OTHER_MACHINE, TEST_MACHINE } from '../../../../test/support/machine';
import { resetShellStores } from '../test-support/shell-stores';
import { afterLook, connectHidden, createHiddenStore, entryAt, HIDDEN_KEY, HIDDEN_MAX, HIDDEN_WRITE_DELAY_MS, QUIET_MS, working, type HiddenEntry, type HiddenSources, type Look } from './hidden';
import { useMachines } from './machines';
import { useSessions, type ListedSession } from './sessions';

const DELAY = 5;
const wait = (ms = DELAY * 4) => new Promise((resolve) => setTimeout(resolve, ms));
const T0 = Date.parse('2026-11-12T10:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();
const MIN = 60_000;
const A = at('app-a' as AppSessionId);
const B = at('app-b' as AppSessionId);
const GONE = at('gone' as AppSessionId);
const studio = (id: string) => addressOf(OTHER_MACHINE, id) as AppSessionId;

const AT_REST: Look = { route: 'says', working: false };
const BUSY: Look = { route: 'says', working: true };
const sourcesOf = (looks: Map<AppSessionId, Look>, over: Partial<HiddenSources> = {}): HiddenSources => ({
  lookOf: (id) => looks.get(id) ?? { route: 'nothing' },
  gone: () => false,
  turnEndedAt: () => null,
  ...over,
});

describe('working', () => {
  it('reads a phase or a listing as it is, a transcript by its newest record against QUIET_MS, and nothing as unknown', () => {
    expect(working({ route: 'runs', working: true, turnStartedAt: null }, T0)).toBe(true);
    expect(working(AT_REST, T0)).toBe(false);
    expect(working({ route: 'transcript', newestAt: iso(T0 - QUIET_MS + 1000) }, T0)).toBe(true);
    expect(working({ route: 'transcript', newestAt: iso(T0 - QUIET_MS - 1000) }, T0)).toBe(false);
    expect(working({ route: 'transcript', newestAt: null }, T0)).toBe(false);
    expect(working({ route: 'nothing' }, T0)).toBeNull();
  });

  it('makes an entry armed at the hide only when the look finds the session not working', () => {
    expect(entryAt(AT_REST, T0)).toEqual({ at: iso(T0), armedAt: iso(T0) });
    expect(entryAt(BUSY, T0)).toEqual({ at: iso(T0), armedAt: null });
    expect(entryAt({ route: 'nothing' }, T0)).toEqual({ at: iso(T0), armedAt: null });
  });
});

// One row per case of "What it proves" (M3): an entry, the looks in order, and what each look answers.
describe('afterLook', () => {
  type Step = [Look, number, 'returns' | 'same' | 'armed'];
  const runs = (isWorking: boolean, turnStartedAt: number | null): Look => ({ route: 'runs', working: isWorking, turnStartedAt: turnStartedAt === null ? null : iso(turnStartedAt) });
  const transcript = (newest: number): Look => ({ route: 'transcript', newestAt: iso(newest) });
  const rows: [string, HiddenEntry, Step[]][] = [
    ['runs: hidden at rest, then a turn', entryAt(runs(false, T0 - 10 * MIN), T0), [[runs(true, T0 + MIN), T0 + MIN, 'returns']]],
    ['runs: hidden mid-turn; the turn goes on, ends, the next begins', entryAt(runs(true, T0 - MIN), T0), [
      [runs(true, T0 - MIN), T0 + MIN, 'same'],
      [runs(false, T0 - MIN), T0 + 2 * MIN, 'armed'],
      [runs(true, T0 + 3 * MIN), T0 + 3 * MIN, 'returns'],
    ]],
    ['runs: a turn start later than the hide returns it, unarmed', { at: iso(T0), armedAt: null }, [[runs(true, T0 + 1000), T0 + MIN, 'returns']]],
    ['runs: a turn start earlier than the hide does not, armed', { at: iso(T0), armedAt: iso(T0) }, [[runs(true, T0 - 1000), T0 + MIN, 'same']]],
    ['says: hidden at rest, then a turn', entryAt(AT_REST, T0), [[BUSY, T0 + MIN, 'returns']]],
    ['says: hidden mid-turn; the turn goes on, ends, the next begins', entryAt(BUSY, T0), [
      [BUSY, T0 + MIN, 'same'],
      [AT_REST, T0 + 2 * MIN, 'armed'],
      [AT_REST, T0 + 3 * MIN, 'same'],
      [BUSY, T0 + 4 * MIN, 'returns'],
    ]],
    ['says: a listing re-issued for a rename while busy, hidden mid-turn', entryAt(BUSY, T0), [[BUSY, T0 + MIN, 'same'], [BUSY, T0 + 2 * MIN, 'same']]],
    ['says: a listing re-issued for a rename while at rest, hidden at rest', entryAt(AT_REST, T0), [[AT_REST, T0 + MIN, 'same'], [AT_REST, T0 + 2 * MIN, 'same']]],
    ['the first look of a run: armed, found working', { at: iso(T0), armedAt: iso(T0) }, [[BUSY, T0 + 60 * MIN, 'returns']]],
    ['the first look of a run: armed, found at rest', { at: iso(T0), armedAt: iso(T0) }, [[AT_REST, T0 + 60 * MIN, 'same']]],
    ['the first look of a run: unarmed, found working', { at: iso(T0), armedAt: null }, [[BUSY, T0 + 60 * MIN, 'same']]],
    ['the first look of a run: unarmed, found at rest', { at: iso(T0), armedAt: null }, [[AT_REST, T0 + 60 * MIN, 'armed']]],
    ['transcript: hidden with its newest record ten minutes old, then a record', entryAt(transcript(T0 - 10 * MIN), T0), [
      [transcript(T0 - 10 * MIN), T0 + MIN, 'same'],
      [transcript(T0 + 2 * MIN), T0 + 2 * MIN, 'returns'],
    ]],
    ['transcript: hidden thirty seconds after a record; quiet, then a record', entryAt(transcript(T0 - 30_000), T0), [
      [transcript(T0 - 30_000), T0 + MIN, 'same'],
      [transcript(T0 - 30_000), T0 + 3 * MIN, 'armed'],
      [transcript(T0 + 4 * MIN), T0 + 4 * MIN, 'returns'],
    ]],
    ['nothing: no digest and no listing says anything', { at: iso(T0), armedAt: null }, [[{ route: 'nothing' }, T0 + MIN, 'same']]],
  ];

  it.each(rows)('%s', (_name, entry, steps) => {
    let current = entry;
    for (const [look, now, expected] of steps) {
      const next = afterLook(current, look, now);
      if (expected === 'returns') {
        expect(next).toBe('returns');
        return;
      }
      if (expected === 'same') expect(next).toBe(current);
      else expect(next).toEqual({ at: current.at, armedAt: iso(now) });
      current = next as HiddenEntry;
    }
  });
});

describe('hidden store: reading and writing', () => {
  let clock = T0;
  const now = () => clock;
  beforeEach(() => {
    clock = T0;
  });
  afterEach(() => vi.useRealTimers());

  it(`writes a hide once, ${HIDDEN_WRITE_DELAY_MS} ms later, armed when the session was not working and unarmed when it was`, async () => {
    const fake = fakeClient({ 'layout.get': { value: null }, 'layout.set': undefined });
    const store = createHiddenStore(fake.client, { now });
    store.getState().attach(sourcesOf(new Map([[A, AT_REST], [B, BUSY]])));
    await store.getState().load();
    vi.useFakeTimers();
    store.getState().hide(A);
    store.getState().hide(B);
    expect([...store.getState().hidden.keys()]).toEqual([A, B]);
    vi.advanceTimersByTime(HIDDEN_WRITE_DELAY_MS - 1);
    expect(fake.invoked('layout.set')).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(fake.invoked('layout.set')).toEqual([{ key: HIDDEN_KEY, value: { version: 1, hidden: { [A]: { at: iso(T0), armedAt: iso(T0) }, [B]: { at: iso(T0), armedAt: null } } } }]);
    expect(fake.invoked('layout.get')).toEqual([{ key: HIDDEN_KEY }]);
  });

  it('counts each hide and unhide in acts, and leaves a hide of a hidden session, or an unhide of a shown one, alone', async () => {
    const store = createHiddenStore(fakeClient({ 'layout.get': { value: null }, 'layout.set': undefined }).client, { writeDelayMs: DELAY, now });
    await store.getState().load();
    store.getState().hide(A);
    store.getState().hide(A);
    store.getState().unhide(A);
    store.getState().unhide(A);
    expect(store.getState().acts).toBe(2);
  });

  it('with the first read held open, draws a hide at once and, when the read answers with another entry, keeps and writes both', async () => {
    const fake = fakeClient({ 'layout.set': undefined });
    const store = createHiddenStore(fake.client, { writeDelayMs: DELAY, now });
    store.getState().hide(A);
    expect(store.getState().hidden.has(A)).toBe(true);
    expect(fake.invoked('layout.get')).toEqual([{ key: HIDDEN_KEY }]);
    await wait();
    expect(fake.invoked('layout.set')).toEqual([]); // a write now would replace what the read brings
    const stored = { at: iso(T0 - MIN), armedAt: null };
    await fake.reply('layout.get', { value: { version: 1, hidden: { [B]: stored } } });
    expect([...store.getState().hidden.keys()].sort()).toEqual([A, B].sort());
    await wait();
    expect(fake.invoked('layout.set')).toEqual([{ key: HIDDEN_KEY, value: { version: 1, hidden: { [B]: stored, [A]: { at: iso(T0), armedAt: null } } } }]);
  });

  it('applies an unhide made before the read answered over the stored entry', async () => {
    const fake = fakeClient({ 'layout.set': undefined });
    const store = createHiddenStore(fake.client, { writeDelayMs: DELAY, now });
    void store.getState().load();
    store.getState().hide(A);
    store.getState().unhide(A);
    await fake.reply('layout.get', { value: { version: 1, hidden: { [A]: { at: iso(T0 - MIN), armedAt: null }, [B]: { at: iso(T0 - MIN), armedAt: null } } } });
    expect([...store.getState().hidden.keys()]).toEqual([B]);
    await wait();
    expect(fake.invoked('layout.set')).toEqual([{ key: HIDDEN_KEY, value: { version: 1, hidden: { [B]: { at: iso(T0 - MIN), armedAt: null } } } }]);
  });

  it('writes nothing at a read that answers with no act made', async () => {
    const fake = fakeClient({ 'layout.get': { value: { version: 1, hidden: { [A]: { at: iso(T0), armedAt: null } } } }, 'layout.set': undefined });
    const store = createHiddenStore(fake.client, { writeDelayMs: DELAY, now });
    await store.getState().load();
    await wait();
    expect([...store.getState().hidden.keys()]).toEqual([A]);
    expect(fake.invoked('layout.set')).toEqual([]);
  });

  it('with the read refused, draws a hide and writes nothing; the next act reads again', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fake = fakeClient({ 'layout.set': undefined });
    const store = createHiddenStore(fake.client, { writeDelayMs: DELAY, now });
    store.getState().hide(A);
    await fake.fail('layout.get');
    expect(store.getState().hidden.has(A)).toBe(true);
    await wait();
    expect(fake.invoked('layout.set')).toEqual([]);
    store.getState().hide(B);
    expect(fake.invoked('layout.get')).toHaveLength(2);
    await fake.reply('layout.get', { value: { version: 1, hidden: { [at('app-c')]: { at: iso(T0 - MIN), armedAt: null } } } });
    await wait();
    expect(Object.keys((fake.invoked('layout.set')[0] as { value: { hidden: object } }).value.hidden).sort()).toEqual([A, B, at('app-c')].sort());
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });

  it('keeps a hide drawn when the read throws, and reads again at the next act', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fake = fakeClient({ 'layout.set': undefined });
    let throws = true;
    const client = { ...fake.client, invoke: (name: string, input: unknown) => (throws && name === 'layout.get' ? Promise.reject(new Error('no bridge')) : (fake.client.invoke as (name: string, input: unknown) => Promise<unknown>)(name, input)) } as unknown as MawsBridge;
    const store = createHiddenStore(client, { writeDelayMs: DELAY, now });
    store.getState().hide(A);
    await wait();
    expect(store.getState().hidden.has(A)).toBe(true);
    expect(fake.invoked('layout.set')).toEqual([]);
    throws = false;
    store.getState().unhide(A);
    await fake.reply('layout.get', { value: null });
    await wait();
    expect(fake.invoked('layout.set')).toEqual([{ key: HIDDEN_KEY, value: { version: 1, hidden: {} } }]);
    error.mockRestore();
  });

  it('reads a value the schema refuses as empty, with one warning, and the next act writes over it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fake = fakeClient({ 'layout.get': { value: { version: 2, hidden: { [B]: { at: 'x', armedAt: null } } } }, 'layout.set': undefined });
    const store = createHiddenStore(fake.client, { writeDelayMs: DELAY, now });
    await store.getState().load();
    expect(store.getState().hidden.size).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
    store.getState().hide(A);
    await wait();
    expect(fake.invoked('layout.set')).toEqual([{ key: HIDDEN_KEY, value: { version: 1, hidden: { [A]: { at: iso(T0), armedAt: null } } } }]);
    warn.mockRestore();
  });

  it('logs a refused write, keeps its state, and writes the whole value again at the next change', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fake = fakeClient({ 'layout.get': { value: null } });
    const store = createHiddenStore(fake.client, { writeDelayMs: DELAY, now });
    await store.getState().load();
    store.getState().hide(A);
    await wait();
    await fake.fail('layout.set');
    expect(error).toHaveBeenCalledTimes(1);
    expect(store.getState().hidden.has(A)).toBe(true);
    store.getState().hide(B);
    await wait();
    expect(fake.invoked('layout.set')[1]).toEqual({ key: HIDDEN_KEY, value: { version: 1, hidden: { [A]: { at: iso(T0), armedAt: null }, [B]: { at: iso(T0), armedAt: null } } } });
    error.mockRestore();
  });

  it(`holds at most ${HIDDEN_MAX} entries: other machines' oldest go first, this Mac's oldest only when no other is left`, async () => {
    const entry = (minutes: number) => ({ at: iso(T0 - minutes * MIN), armedAt: null });
    const others = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [studio(`s${i}`), entry(1000 + i)])); // s9 the oldest
    const mine = Object.fromEntries(Array.from({ length: HIDDEN_MAX - 10 }, (_, i) => [at(`m${i}`), entry(5000 + i)])); // older still
    const fake = fakeClient({ 'layout.get': { value: { version: 1, hidden: { ...others, ...mine } } }, 'layout.set': undefined });
    const store = createHiddenStore(fake.client, { writeDelayMs: DELAY, now });
    await store.getState().load();
    store.getState().hide(A);
    await wait();
    const written = (fake.invoked('layout.set').at(-1) as { value: { hidden: Record<string, HiddenEntry> } }).value.hidden;
    expect(Object.keys(written)).toHaveLength(HIDDEN_MAX);
    expect(written[studio('s9')]).toBeUndefined();
    expect(written[studio('s8')]).toBeDefined();
    expect(written[A]).toBeDefined();
    expect(store.getState().hidden.size).toBe(HIDDEN_MAX);

    const onlyMine = Object.fromEntries(Array.from({ length: HIDDEN_MAX }, (_, i) => [at(`m${i}`), entry(5000 + i)])); // m499 the oldest
    const fake2 = fakeClient({ 'layout.get': { value: { version: 1, hidden: onlyMine } }, 'layout.set': undefined });
    const store2 = createHiddenStore(fake2.client, { writeDelayMs: DELAY, now });
    await store2.getState().load();
    store2.getState().hide(A);
    await wait();
    const written2 = (fake2.invoked('layout.set').at(-1) as { value: { hidden: Record<string, HiddenEntry> } }).value.hidden;
    expect(Object.keys(written2)).toHaveLength(HIDDEN_MAX);
    expect(written2[at('m499')]).toBeUndefined();
    expect(written2[A]).toBeDefined();
  });
});

describe('hidden store: the connection', () => {
  let clock = T0;
  const now = () => clock;
  const offs: (() => void)[] = [];
  const setRecords = (...records: ReturnType<typeof record>[]) => useSessions.setState({ records: new Map(records.map((r) => [r.appId, r])) });
  const setDigests = (...digests: ReturnType<typeof digest>[]) => useSessions.setState({ digests: new Map(digests.map((d) => [d.appSessionId, d])) });
  const setListed = (...listed: ListedSession[]) => useSessions.setState({ listed: new Map(listed.map((l) => [l.appId, l])) });
  const listing = (id: string, state: string): ListedSession => ({ ...remoteRow(OTHER_MACHINE, id, { state }), appId: studio(id) });
  const connected = async (stored: Record<string, HiddenEntry> | null = null) => {
    const fake = fakeClient({ 'layout.get': { value: stored === null ? null : { version: 1, hidden: stored } }, 'layout.set': undefined });
    const store = createHiddenStore(fake.client, { writeDelayMs: DELAY, now });
    offs.push(connectHidden(store));
    await store.getState().load();
    return { fake, store };
  };
  const written = (fake: ReturnType<typeof fakeClient>) => (fake.invoked('layout.set').at(-1) as { value: { hidden: Record<string, HiddenEntry> } } | undefined)?.value.hidden;

  beforeEach(() => {
    clock = T0;
    resetShellStores();
    useMachines.setState({ roster: 'unread', machines: new Map(), loaded: new Set() });
  });
  afterEach(() => {
    offs.splice(0).forEach((off) => off());
    useMachines.setState({ roster: 'unread', machines: new Map(), loaded: new Set() });
  });

  it('a record MAWS runs: hidden at rest, it returns when its turn start is later than the hide', async () => {
    setRecords(record(A));
    setDigests(digest(A, { phase: 'idle', turnStartedAt: iso(T0 - 10 * MIN) }));
    const { store } = await connected();
    store.getState().hide(A);
    expect(store.getState().hidden.get(A)).toEqual({ at: iso(T0), armedAt: iso(T0) });
    clock = T0 + MIN;
    setDigests(digest(A, { phase: 'working', turnStartedAt: iso(T0 + MIN) }));
    expect(store.getState().hidden.has(A)).toBe(false);
  });

  it('a terminal record MAWS drives through its bridge: hidden mid-turn, armed at rest, and back at its next turn; the arming is written', async () => {
    setRecords(record(A, { holder: { kind: 'terminal', pid: 7 } }));
    setDigests(digest(A, { phase: 'working' }));
    const { fake, store } = await connected();
    store.getState().hide(A);
    expect(store.getState().hidden.get(A)).toEqual({ at: iso(T0), armedAt: null });
    await wait();
    clock = T0 + MIN;
    setDigests(digest(A, { phase: 'idle' }));
    expect(store.getState().hidden.get(A)).toEqual({ at: iso(T0), armedAt: iso(T0 + MIN) });
    await wait();
    expect(written(fake)).toEqual({ [A]: { at: iso(T0), armedAt: iso(T0 + MIN) } });
    clock = T0 + 2 * MIN;
    setDigests(digest(A, { phase: 'working' }));
    expect(store.getState().hidden.has(A)).toBe(false);
  });

  it('a foreign record: hidden with its newest record ten minutes old, it returns at a newer record', async () => {
    setRecords(record(A, { holder: { kind: 'terminal', pid: 7 } }));
    setDigests(digest(A, { phase: 'foreign', lastTurnEndedAt: iso(T0 - 10 * MIN) }));
    const { store } = await connected();
    store.getState().hide(A);
    expect(store.getState().hidden.get(A)).toEqual({ at: iso(T0), armedAt: iso(T0) });
    clock = T0 + MIN;
    setDigests(digest(A, { phase: 'foreign', lastTurnEndedAt: iso(T0 + MIN) }));
    expect(store.getState().hidden.has(A)).toBe(false);
  });

  it('a foreign record found working is looked at again once QUIET_MS has passed, with nothing else changing', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      setRecords(record(A, { holder: { kind: 'terminal', pid: 7 } }));
      setDigests(digest(A, { phase: 'foreign', lastTurnEndedAt: iso(T0 - 30_000) }));
      const fake = fakeClient({ 'layout.get': { value: null }, 'layout.set': undefined });
      const store = createHiddenStore(fake.client, { writeDelayMs: DELAY, now });
      offs.push(connectHidden(store));
      await store.getState().load();
      store.getState().hide(A);
      expect(store.getState().hidden.get(A)?.armedAt).toBeNull();
      clock = T0 - 30_000 + QUIET_MS + 1;
      vi.advanceTimersByTime(QUIET_MS);
      expect(store.getState().hidden.get(A)?.armedAt).toBe(iso(clock));
    } finally {
      vi.useRealTimers();
    }
  });

  it('a listing: hidden at rest, it returns when its listing says busy', async () => {
    setListed(listing('b1', 'idle'));
    const { store } = await connected();
    store.getState().hide(studio('b1'));
    expect(store.getState().hidden.get(studio('b1'))).toEqual({ at: iso(T0), armedAt: iso(T0) });
    setListed({ ...listing('b1', 'idle'), revision: 2, title: 'Renamed' }); // re-issued for a rename: no turn
    expect(store.getState().hidden.has(studio('b1'))).toBe(true);
    setListed(listing('b1', 'busy'));
    expect(store.getState().hidden.has(studio('b1'))).toBe(false);
  });

  it('an address with neither digest nor listing is left as it is', async () => {
    const { store } = await connected();
    store.getState().hide(studio('b9'));
    expect(store.getState().hidden.get(studio('b9'))).toEqual({ at: iso(T0), armedAt: null });
    clock = T0 + 60 * MIN;
    setListed(listing('b1', 'busy'));
    setDigests(digest(A, { phase: 'working' }));
    expect(store.getState().hidden.get(studio('b9'))).toEqual({ at: iso(T0), armedAt: null });
  });

  it('looks at every stored entry once the read has answered: the first look of a run', async () => {
    setListed(listing('b1', 'busy'), listing('b2', 'idle'));
    const { store } = await connected({ [studio('b1')]: { at: iso(T0 - MIN), armedAt: iso(T0 - MIN) }, [studio('b2')]: { at: iso(T0 - MIN), armedAt: null } });
    expect(store.getState().hidden.has(studio('b1'))).toBe(false); // armed and found working
    expect(store.getState().hidden.get(studio('b2'))).toEqual({ at: iso(T0 - MIN), armedAt: iso(T0) }); // unarmed and found at rest
  });

  it("drops this Mac's entry once this Mac is loaded and holds no record at the address, and not before", async () => {
    setRecords(record(A));
    const { fake, store } = await connected({ [GONE]: { at: iso(T0 - MIN), armedAt: null } });
    store.getState().hide(A);
    expect(store.getState().hidden.has(GONE)).toBe(true); // an empty list at a start is not evidence
    useMachines.getState().setLoaded(TEST_MACHINE);
    expect(store.getState().hidden.has(GONE)).toBe(false);
    expect(store.getState().hidden.has(A)).toBe(true);
    setRecords();
    expect(store.getState().hidden.has(A)).toBe(false);
    await wait();
    expect(written(fake)).toEqual({});
  });

  it("never drops another machine's entry for its absence: rows incomplete and empty, the machine pending, then complete without it", async () => {
    const rows = (over: { complete?: boolean; pending?: string[] } = {}) =>
      useSessions.getState().applyRows({ machines: [OTHER_MACHINE], rows: [], complete: over.complete ?? true, pending: (over.pending ?? []) as never[], members: [], member: null });
    const { store } = await connected({ [studio('b1')]: { at: iso(T0 - MIN), armedAt: null }, [studio('b2')]: { at: iso(T0 - MIN), armedAt: iso(T0 - MIN) } });
    useMachines.getState().setLoaded(TEST_MACHINE);
    rows({ complete: false });
    rows({ pending: [OTHER_MACHINE] });
    rows();
    useMachines.getState().setLoaded(OTHER_MACHINE);
    expect([...store.getState().hidden.keys()].sort()).toEqual([studio('b1'), studio('b2')].sort());
  });

  it('an unhidden session leads until its next turn ends: by its digest for one MAWS runs, by a look at rest after one working for any other', async () => {
    setRecords(record(A));
    setDigests(digest(A, { phase: 'idle', lastTurnEndedAt: iso(T0 - MIN) }));
    setListed(listing('b1', 'idle'));
    const { store } = await connected({ [A]: { at: iso(T0 - 2 * MIN), armedAt: iso(T0 - 2 * MIN) }, [studio('b1')]: { at: iso(T0 - 2 * MIN), armedAt: null } });
    store.getState().unhide(A);
    store.getState().unhide(studio('b1'));
    expect([...store.getState().leading].sort()).toEqual([A, studio('b1')].sort());
    clock = T0 + MIN;
    setDigests(digest(A, { phase: 'working', turnStartedAt: iso(T0 + MIN), lastTurnEndedAt: iso(T0 - MIN) }));
    setListed(listing('b1', 'idle'));
    expect([...store.getState().leading].sort()).toEqual([A, studio('b1')].sort());
    clock = T0 + 2 * MIN;
    setDigests(digest(A, { phase: 'idle', turnStartedAt: iso(T0 + MIN), lastTurnEndedAt: iso(T0 + 2 * MIN) }));
    expect([...store.getState().leading]).toEqual([studio('b1')]);
    setListed(listing('b1', 'busy'));
    expect([...store.getState().leading]).toEqual([studio('b1')]);
    setListed(listing('b1', 'idle'));
    expect([...store.getState().leading]).toEqual([]);
  });
});
