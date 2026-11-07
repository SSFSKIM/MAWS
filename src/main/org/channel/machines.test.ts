// The channel's machines (P5 O8 M7b, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M7b's Main bullet, its
// Proves' `machines.test.ts`, and the Decision Log's "M7b's channel feed"): each machine's to-human entries for a project
// a tab holds, this Mac's from its spine (`channel.history`, `channel.changed` on main's taps) and each roster machine's
// over its link (the `channel` feed, `channel.history` for older pages), merged by time, kept per machine in one reader's
// cache. Fake links and an in-memory store, over the real schemas.
import { afterEach, describe, expect, it } from 'vitest';
import type { HostEntry } from '@shared/ipc/schema/channel';
import type { MachineRef } from '@shared/machine/ref';
import type { CallResult, Subscription, SubscribeRequest, SubscriptionSink } from '../../machines/remote/link';
import type { LinkState } from '../../machines/manager';
import { heldOrgSession, type SignedIn } from '../session';
import { createChannelMachines, type ChannelLink, type ChannelMachines, type LocalAnswer, type MachinesCacheFile, type MachinesStore, type ProjectHosts } from './machines';

const PROJECT = '1f0e2d3c-4b5a-4968-8776-a5b4c3d2e1f0';
const OTHER = '2a1b3c4d-5e6f-4a0b-8c1d-2e3f4a5b6c7d';
const LOCAL = 'local-mac-0000000001' as MachineRef;
const MINI = 'mini-machine-000000001' as MachineRef;
const VM = 'devcloud-vm-000000001' as MachineRef;
const T0 = Date.parse('2026-11-06T12:00:00.000Z');
const iso = (minute: number) => new Date(T0 + minute * 60_000).toISOString();

/** An entry said at `minute`; `id` is its machine's (a plain id here, an opaque cursor over a link). */
const entry = (id: string, minute: number, text = id, extra: Partial<HostEntry> = {}): HostEntry =>
  ({ id, project: PROJECT, appSessionId: null, engineSessionId: 'la-1', lane: 'A', kind: 'message', text, at: iso(minute), src: `${PROJECT}/mini%2Fla-1/${id}`, ...extra }) as HostEntry;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until<T>(check: () => T | null | undefined | false, what: string, ms = 2_000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = check();
    if (value !== null && value !== undefined && value !== false) return value;
    if (Date.now() > deadline) throw new Error(`no ${what} within ${ms} ms`);
    await sleep(2);
  }
}

type Sub = { request: SubscribeRequest; sink: SubscriptionSink; closed: boolean };

/** A link as machines.ts reads one: its state and `h2` list, its calls answered by `answer`, its subscriptions recorded. */
class FakeLink implements ChannelLink {
  readonly subs: Sub[] = [];
  readonly calls: Array<{ name: string; input: Record<string, unknown> }> = [];
  #state: LinkState = 'up';
  #states = new Set<(state: LinkState) => void>();
  #caps = new Set<() => void>();
  constructor(
    readonly machine: MachineRef,
    readonly name: string,
    public peer: string[] | null = ['rl2.feeds', 'rl2.channel'],
    public answer: (input: Record<string, unknown>) => CallResult | Promise<CallResult> = () => ({ ok: true, output: { entries: [], more: false } }),
  ) {}
  state = () => this.#state;
  peerCapabilities = () => this.peer;
  onState(listener: (state: LinkState) => void) {
    this.#states.add(listener);
    return () => void this.#states.delete(listener);
  }
  onCaps(listener: () => void) {
    this.#caps.add(listener);
    return () => void this.#caps.delete(listener);
  }
  call(name: string, input: unknown): Promise<CallResult> {
    this.calls.push({ name, input: input as Record<string, unknown> });
    return Promise.resolve(this.answer(input as Record<string, unknown>));
  }
  subscribe(request: SubscribeRequest, sink: SubscriptionSink): Subscription {
    const sub: Sub = { request, sink, closed: false };
    this.subs.push(sub);
    return { id: `s${this.subs.length}`, cursor: () => null, close: () => void (sub.closed = true) };
  }
  set(state: LinkState, peer: string[] | null = this.peer) {
    this.#state = state;
    this.peer = peer;
    for (const listener of [...this.#states]) listener(state);
    for (const listener of [...this.#caps]) listener();
  }
  /** The feed's opening as the link delivers it: `subbed`, then the snapshot page joined. */
  snapshot(entries: HostEntry[], more = false, sub = this.live()) {
    sub.sink.subbed('snapshot', { epoch: 'channel:boot', seq: 0 });
    sub.sink.snapshot({ epoch: 'channel:boot', seq: 0 }, { entries, more });
  }
  ev(seq: number, e: HostEntry, sub = this.live()) {
    sub.sink.event({ epoch: 'channel:boot', seq }, { entry: e });
  }
  live(): Sub {
    const open = this.subs.filter((s) => !s.closed);
    if (open.length !== 1) throw new Error(`${open.length} open subscriptions on ${this.name}`);
    return open[0];
  }
}

const reader = (member: string): SignedIn => ({ identity: { org: 'org-1', member, device: 'app', clientClass: 'native-mac', build: 'test', capabilities: [] } }) as unknown as SignedIn;

let machines: ChannelMachines | null = null;
afterEach(async () => {
  await machines?.close();
  machines = null;
});

function harness(options: { member?: string | null; local?: HostEntry[] | ((input: Record<string, unknown>) => LocalAnswer); links?: FakeLink[]; file?: unknown; entries?: number; bytes?: number } = {}) {
  const session = heldOrgSession(options.member === null ? null : reader(options.member ?? 'A'));
  const links = new Map((options.links ?? []).map((l) => [l.machine, l]));
  let roster: MachineRef[] = [...links.keys()];
  const rosterListeners = new Set<() => void>();
  const tap = new Set<(payload: { project: string; entry: HostEntry }) => void>();
  const localCalls: Array<Record<string, unknown>> = [];
  const local = options.local ?? [];
  const files = new Map<string, unknown>(options.file === undefined ? [] : [[PROJECT, JSON.parse(JSON.stringify(options.file))]]);
  const writes: MachinesCacheFile[] = [];
  const store: MachinesStore = {
    read: async (project) => files.get(project) ?? null,
    write: async (project, file) => {
      writes.push(JSON.parse(JSON.stringify(file)) as MachinesCacheFile);
      files.set(project, JSON.parse(JSON.stringify(file)));
    },
  };
  const now = { at: T0 };
  machines = createChannelMachines({
    session,
    local: LOCAL,
    localName: 'MacBook',
    history: async (input) => {
      localCalls.push(input);
      if (typeof local === 'function') return local(input);
      return { ok: true, value: { entries: local.filter((e) => e.project === input.project), more: false } };
    },
    onChanged: (listener) => {
      tap.add(listener);
      return () => void tap.delete(listener);
    },
    roster: () => roster,
    onRoster: (listener) => {
      rosterListeners.add(listener);
      return () => void rosterListeners.delete(listener);
    },
    link: (ref) => (roster.includes(ref) ? (links.get(ref) ?? null) : null),
    store,
    commit: (body) => body(),
    timing: { CHANNEL_WRITE_MS: 1, FEED_BACKOFF_MS: [5, 10], ...(options.entries === undefined ? {} : { CHANNEL_MACHINE_ENTRIES: options.entries }), ...(options.bytes === undefined ? {} : { CHANNEL_MACHINE_BYTES: options.bytes }) },
    now: () => now.at,
    log: () => {},
  });
  const created = machines;
  return {
    session,
    links,
    files,
    writes,
    now,
    localCalls,
    machines: created,
    async open(project = PROJECT): Promise<ProjectHosts> {
      const hosts = created.open(project);
      await hosts.loaded;
      return hosts;
    },
    say: (e: HostEntry) => tap.forEach((listener) => listener({ project: e.project, entry: e })),
    setRoster(next: MachineRef[]) {
      roster = next;
      rosterListeners.forEach((listener) => listener());
    },
  };
}

const texts = (hosts: ProjectHosts) => hosts.entries().map((h) => h.text);
const state = (hosts: ProjectHosts, machine: MachineRef) => hosts.machines().find((m) => m.machine === machine);

describe('the merge', () => {
  it('merges this Mac’s spine and each roster machine’s feed by time, each entry keyed by its machine', async () => {
    const mini = new FakeLink(MINI, 'mini');
    const h = harness({ local: [entry('l3', 3, 'mac at 3'), entry('l1', 1, 'mac at 1')], links: [mini] });
    const hosts = await h.open();
    expect(mini.subs.map((s) => s.request)).toEqual([{ feed: 'channel', project: PROJECT }]);
    mini.snapshot([entry('m2', 2, 'mini at 2')]);
    await until(() => texts(hosts).length === 3 && hosts, 'three entries');
    expect(texts(hosts)).toEqual(['mac at 1', 'mini at 2', 'mac at 3']);
    expect(hosts.entries().map((e) => [e.machine, e.key])).toEqual([
      [LOCAL, `${LOCAL} l1`],
      [MINI, `${MINI} m2`],
      [LOCAL, `${LOCAL} l3`],
    ]);
    mini.ev(1, entry('m4', 4, 'mini at 4'));
    h.say(entry('l5', 5, 'mac at 5'));
    h.say(entry('x', 6, 'another project', { project: OTHER }));
    expect(texts(hosts)).toEqual(['mac at 1', 'mini at 2', 'mac at 3', 'mini at 4', 'mac at 5']);
    expect(hosts.machines()).toEqual([
      { machine: LOCAL, name: 'MacBook', state: 'live', asOf: expect.any(String) },
      { machine: MINI, name: 'mini', state: 'live', asOf: expect.any(String) },
    ]);
  });

  it('orders by each entry’s own time, then its id, never by when it arrived', async () => {
    const mini = new FakeLink(MINI, 'mini');
    const h = harness({ links: [mini] });
    const hosts = await h.open();
    mini.snapshot([entry('b', 5, 'five')]);
    await until(() => texts(hosts).length === 1, 'the snapshot');
    mini.ev(1, entry('d', 9, 'nine'));
    mini.ev(2, entry('a', 2, 'two, recovered late')); // a lower entry the endpoint recovered after a later one
    mini.ev(3, entry('c', 5, 'five, its id after b'));
    expect(texts(hosts)).toEqual(['two, recovered late', 'five', 'five, its id after b', 'nine']);
  });

  it('dedupes by entry id per machine: an id heard at two seqs, through history after an ev, and the same id on two machines kept apart', async () => {
    const page = [entry('p2', 2), entry('p1', 1)];
    const mini = new FakeLink(MINI, 'mini', undefined, (input) => ({ ok: true, output: input.before === 'm3' ? { entries: [entry('m3', 3, 'again'), ...page], more: false } : { entries: [], more: false } }));
    const vm = new FakeLink(VM, 'vm');
    const h = harness({ links: [mini, vm] });
    const hosts = await h.open();
    mini.snapshot([entry('m4', 4), entry('m3', 3)], true);
    await until(() => texts(hosts).length === 4, 'the snapshot and its older page');
    mini.ev(1, entry('m5', 5));
    mini.ev(2, entry('m5', 5)); // one entry at two seqs
    vm.snapshot([entry('m5', 5, 'vm’s own m5')]);
    await until(() => hosts.entries().length === 6, 'vm’s entry');
    const keys = hosts.entries().map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual([`${MINI} p1`, `${MINI} p2`, `${MINI} m3`, `${MINI} m4`, `${VM} m5`, `${MINI} m5`]); // at one time, by key
    expect(hosts.entries().find((e) => e.key === `${MINI} m3`)?.text).toBe('m3'); // the first copy stands: an entry never changes
  });
});

describe('paging', () => {
  it('pages older entries with channel.history from the snapshot’s oldest, to the newest 500 per machine', async () => {
    const all = Array.from({ length: 700 }, (_, i) => entry(`e${String(699 - i).padStart(3, '0')}`, 699 - i)); // newest first
    const after = (id: unknown) => (id === undefined ? 0 : all.findIndex((e) => e.id === id) + 1);
    const mini = new FakeLink(MINI, 'mini', undefined, (input) => {
      const from = after(input.before);
      const slice = all.slice(from, from + (input.limit as number));
      return { ok: true, output: { entries: slice, more: from + slice.length < all.length } };
    });
    const h = harness({ links: [mini] });
    const hosts = await h.open();
    mini.snapshot(all.slice(0, 200), true);
    await until(() => hosts.entries().length === 500, '500 entries');
    expect(mini.calls.map((c) => [c.name, c.input])).toEqual([
      ['channel.history', { project: PROJECT, before: 'e500', limit: 200 }],
      ['channel.history', { project: PROJECT, before: 'e300', limit: 100 }],
    ]);
    expect(hosts.entries()[0].id).toBe('e200');
    expect(hosts.entries().at(-1)!.id).toBe('e699');
  });

  it('takes a whole read as the machine’s entries: one it no longer shows the member goes', async () => {
    const mini = new FakeLink(MINI, 'mini');
    const h = harness({ links: [mini] });
    const hosts = await h.open();
    mini.snapshot([entry('kept', 2), entry('hidden', 1)]);
    await until(() => texts(hosts).length === 2, 'two');
    mini.set('down');
    mini.set('up');
    mini.snapshot([entry('kept', 2)]); // the next opening: its session no longer shared
    await until(() => texts(hosts).length === 1, 'one');
    expect(texts(hosts)).toEqual(['kept']);
  });
});

describe('offline', () => {
  it('keeps an offline machine’s entries "as of" its last live time, and live again at its next snapshot', async () => {
    const mini = new FakeLink(MINI, 'mini');
    const h = harness({ links: [mini] });
    const hosts = await h.open();
    mini.snapshot([entry('m1', 1)]);
    await until(() => state(hosts, MINI)?.state === 'live', 'live');
    h.now.at = T0 + 3_600_000;
    mini.set('down');
    expect(state(hosts, MINI)).toEqual({ machine: MINI, name: 'mini', state: 'offline', asOf: new Date(T0 + 3_600_000).toISOString() });
    expect(texts(hosts)).toEqual(['m1']);
    h.now.at = T0 + 7_200_000;
    mini.set('up');
    expect(state(hosts, MINI)?.state).toBe('offline'); // up, but nothing read on this channel yet
    mini.snapshot([entry('m2', 2), entry('m1', 1)]);
    await until(() => state(hosts, MINI)?.state === 'live', 'live again');
    expect(texts(hosts)).toEqual(['m1', 'm2']);
  });

  it('draws a relaunch’s cache "as of" while the machine’s link is down, from one reader’s file', async () => {
    const mini = new FakeLink(MINI, 'mini');
    const first = harness({ links: [mini] });
    const hosts = await first.open();
    mini.snapshot([entry('m1', 1, 'cached')]);
    await until(() => texts(hosts).length === 1, 'the entry');
    first.now.at = T0 + 60_000;
    mini.set('down');
    await hosts.close();
    const file = first.files.get(PROJECT) as MachinesCacheFile;
    expect(file).toMatchObject({ version: 1, org: 'org-1', member: 'A', project: PROJECT });
    await machines!.close();

    const down = new FakeLink(MINI, 'mini');
    down.set('down');
    const again = harness({ links: [down], file });
    const reopened = await again.open();
    expect(texts(reopened)).toEqual(['cached']);
    expect(state(reopened, MINI)).toEqual({ machine: MINI, name: 'mini', state: 'offline', asOf: new Date(T0 + 60_000).toISOString() });
  });
});

describe('the roster', () => {
  it('drops a machine that leaves the roster: its entries, its feed and its place in the cache', async () => {
    const mini = new FakeLink(MINI, 'mini');
    const vm = new FakeLink(VM, 'vm');
    const h = harness({ links: [mini, vm] });
    const hosts = await h.open();
    mini.snapshot([entry('m1', 1, 'mini')]);
    vm.snapshot([entry('v1', 2, 'vm')]);
    await until(() => texts(hosts).length === 2, 'both');
    h.setRoster([MINI]);
    expect(texts(hosts)).toEqual(['mini']);
    expect(hosts.machines().map((m) => m.machine)).toEqual([LOCAL, MINI]);
    expect(vm.subs[0].closed).toBe(true);
    await until(() => h.writes.at(-1)?.machines.every((m) => m.machine !== VM) && h.writes.at(-1)!.machines.some((m) => m.machine === MINI), 'the cache without vm');
  });

  it('keeps every machine while signed out, when the roster empties with the session', async () => {
    const mini = new FakeLink(MINI, 'mini');
    const h = harness({ links: [mini] });
    const hosts = await h.open();
    mini.snapshot([entry('m1', 1)]);
    await until(() => texts(hosts).length === 1, 'the entry');
    h.session.set(null);
    h.setRoster([]);
    expect(texts(hosts)).toEqual(['m1']);
    expect(state(hosts, MINI)?.state).toBe('offline');
  });
});

describe('an older peer', () => {
  it('never asks an endpoint without `rl2.channel` for the feed: it reads channel.history once on open, with no live updates', async () => {
    const mini = new FakeLink(MINI, 'mini', ['rl2.feeds'], () => ({ ok: true, output: { entries: [entry('m1', 1, 'read once')], more: false } }));
    const h = harness({ links: [mini] });
    const hosts = await h.open();
    await until(() => texts(hosts).length === 1, 'the read');
    expect(mini.subs).toEqual([]);
    expect(mini.calls).toEqual([{ name: 'channel.history', input: { project: PROJECT, limit: 200 } }]);
    expect(state(hosts, MINI)?.state).toBe('read');
    mini.set('down');
    mini.set('up');
    await sleep(20);
    expect(mini.calls).toHaveLength(1);
    expect(mini.subs).toEqual([]);
  });

  it('reads as unavailable, greyed, when even channel.history is missing, and asks no more on that channel', async () => {
    const mini = new FakeLink(MINI, 'mini', ['rl2.feeds'], () => ({ ok: false, error: { code: 'not-offered' } }));
    const h = harness({ links: [mini] });
    const hosts = await h.open();
    await until(() => state(hosts, MINI)?.state === 'unavailable', 'unavailable');
    expect(texts(hosts)).toEqual([]);
    await sleep(20);
    expect(mini.calls).toHaveLength(1);
    expect(mini.subs).toEqual([]);
  });

  it('falls back to channel.history when the link ends the feed `not-offered` (a later channel’s peer without it)', async () => {
    const mini = new FakeLink(MINI, 'mini', undefined, () => ({ ok: true, output: { entries: [entry('m1', 1, 'from history')], more: false } }));
    const h = harness({ links: [mini] });
    const hosts = await h.open();
    mini.peer = ['rl2.feeds'];
    mini.live().sink.ended('not-offered');
    await until(() => texts(hosts).length === 1, 'the read');
    expect(state(hosts, MINI)?.state).toBe('read');
    expect(mini.subs).toHaveLength(1);
  });

  it('reads this Mac’s spine as unavailable when the daemon has no channel.history', async () => {
    const h = harness({ local: () => ({ ok: false, code: 'unknown_command' }) });
    const hosts = await h.open();
    await until(() => state(hosts, LOCAL)?.state === 'unavailable', 'unavailable');
  });
});

describe('the feed’s ends', () => {
  it('opens a feed ended `behind` again at once and one ended `unavailable` after a backoff', async () => {
    const mini = new FakeLink(MINI, 'mini');
    const h = harness({ links: [mini] });
    await h.open();
    mini.live().sink.ended('behind');
    await until(() => mini.subs.length === 2, 'a second feed');
    mini.subs[1].sink.ended('unavailable');
    await until(() => mini.subs.length === 3, 'a third feed');
    expect(mini.subs.map((s) => s.request)).toEqual(Array(3).fill({ feed: 'channel', project: PROJECT }));
  });
});

describe('the cache', () => {
  const fileOf = (member: string, machines: MachinesCacheFile['machines']): MachinesCacheFile => ({ version: 1, org: 'org-1', member, project: PROJECT, machines });

  it('is one reader’s: another member’s file reads empty, and switching member resets it', async () => {
    const down = new FakeLink(MINI, 'mini');
    down.set('down');
    const other = harness({ links: [down], member: 'B', file: fileOf('A', [{ machine: MINI, name: 'mini', asOf: iso(1), entries: [entry('a1', 1, 'A’s')] }]) });
    const empty = await other.open();
    expect(texts(empty)).toEqual([]);
    await machines!.close();

    const mini = new FakeLink(MINI, 'mini');
    const h = harness({ links: [mini], member: 'A' });
    const hosts = await h.open();
    mini.snapshot([entry('a1', 1, 'A’s')]);
    await until(() => texts(hosts).length === 1, 'A’s entry');
    const resets: boolean[] = [];
    hosts.onChanged((reset) => resets.push(reset));
    h.session.set(reader('B'));
    expect(texts(hosts)).toEqual([]);
    expect(resets).toContain(true);
    await until(() => mini.subs.length === 2 && mini.subs[0].closed, 'B’s own feed');
    mini.snapshot([entry('b1', 2, 'B’s')], false, mini.subs[1]);
    await until(() => texts(hosts).length === 1, 'B’s entry');
    await until(() => (h.files.get(PROJECT) as MachinesCacheFile | undefined)?.member === 'B', 'B’s file');
    const file = h.files.get(PROJECT) as MachinesCacheFile;
    expect(file.machines.flatMap((m) => m.entries.map((e) => e.text))).toEqual(['B’s']);
  });

  it('is bounded per machine, newest kept, and a file outside its bounds or its project reads empty at load', async () => {
    const mini = new FakeLink(MINI, 'mini');
    const h = harness({ links: [mini], entries: 3 });
    const hosts = await h.open();
    mini.snapshot([entry('e5', 5), entry('e4', 4), entry('e3', 3), entry('e2', 2), entry('e1', 1)]);
    await until(() => texts(hosts).length === 3, 'three');
    expect(texts(hosts)).toEqual(['e3', 'e4', 'e5']);
    await until(() => h.writes.at(-1)?.machines.find((m) => m.machine === MINI)?.entries.length === 3, 'the file bounded');
    await machines!.close();

    const over = fileOf('A', [{ machine: MINI, name: 'mini', asOf: iso(1), entries: [entry('e1', 1), entry('e2', 2), entry('e3', 3), entry('e4', 4)] }]);
    const elsewhere = fileOf('A', [{ machine: MINI, name: 'mini', asOf: iso(1), entries: [entry('e1', 1, 'x', { project: OTHER })] }]);
    const twice = fileOf('A', [{ machine: MINI, name: 'mini', asOf: iso(1), entries: [entry('e1', 1), entry('e1', 1)] }]);
    for (const file of [over, elsewhere, twice, { version: 1, org: 'org-1', member: 'A', project: PROJECT, machines: [{ machine: 'not a ref', name: 'x', asOf: null, entries: [] }] }]) {
      const down = new FakeLink(MINI, 'mini');
      down.set('down');
      const loaded = harness({ links: [down], file, entries: 3 });
      expect(texts(await loaded.open())).toEqual([]);
      await machines!.close();
    }
  });

  it('is bounded in bytes per machine, the newest kept', async () => {
    const mini = new FakeLink(MINI, 'mini');
    const h = harness({ links: [mini], bytes: 2_000 }); // each entry is about 820 bytes of JSON
    const hosts = await h.open();
    const big = (id: string, minute: number) => entry(id, minute, 'x'.repeat(600));
    mini.snapshot([big('b3', 3), big('b2', 2), big('b1', 1)]);
    await until(() => texts(hosts).length === 2, 'two of three');
    expect(hosts.entries().map((e) => e.id)).toEqual(['b2', 'b3']);
  });
});
