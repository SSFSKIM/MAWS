// The checkouts' watches across a mawsd restart (P5 O3-E M2; docs/doperpowers/plans/2026-10-30-p5-o3-e-checkout.md,
// Interfaces §E, D8), over a fake machine host whose git handler counts holds per owner on each connection, releases an
// owner at its `clientGone` (relayed when a carried ref ends, on the connection that carried it), drops an adoption that
// lands after its owner's release (the watcher's fence), answers in whatever order the test says, detaches (failing what
// it was sent `host_unavailable`) and times a request out.
import { describe, expect, it, vi } from 'vitest';
import { endableClientRef, type ClientRef } from '@shared/ipc/client';
import { ipcError, type IpcError } from '@shared/ipc/errors';
import type { CommandName, CommandResult, HostState } from '@shared/ipc/schema';
import type { FilesChanged } from '@shared/ipc/schema/files';
import { createWatchReplay } from './watch-replay';

type Answer = CommandResult<CommandName>;
const STATUS = { repoRoot: '/r', gitDir: '/r/.git', commonDir: '/r/.git', isWorktree: false, branch: 'main', head: 'h', upstream: null, remoteUrl: null, ahead: 0, behind: 0, dirty: false, files: [], stashCount: 0, checkedAt: '2026-10-30T00:00:00.000Z' };

interface Sent {
  owner: string;
  input: unknown;
  connection: number;
  settle(answer: Answer): void;
  settled: boolean;
}

// The daemon's side as the fake keeps it: holds per owner on the live connection.
function fakeMachineHost({ auto = true }: { auto?: boolean } = {}) {
  let connection = 1;
  let streaming = true;
  const stateListeners = new Set<(state: HostState) => void>();
  const streamingListeners = new Set<() => void>();
  let holds = new Map<string, number>();
  let released = new Set<string>(); // the fence: owners released on this connection
  const sent: Sent[] = [];
  const adopt = (owner: string, on: number) => {
    if (on !== connection || released.has(owner)) return; // the connection's refs ended, or the owner let go
    holds.set(owner, (holds.get(owner) ?? 0) + 1);
  };
  const host = {
    sent,
    holds: () => [...holds.values()].reduce((sum, n) => sum + n, 0),
    holders: () => [...holds.keys()],
    dispatch: vi.fn<(owner: string, name: string, input: unknown, client?: ClientRef) => Promise<Answer>>(),
    onState: (_owner: string, listener: (state: HostState) => void) => (stateListeners.add(listener), () => void stateListeners.delete(listener)),
    onStreaming: (_owner: string, listener: () => void) => (streamingListeners.add(listener), () => void streamingListeners.delete(listener)),
    streaming: () => streaming,
    // the connection drops: the supervisor fails what it sent, the host leaves `ready`, and the daemon's refs end
    detach() {
      const failing = sent.filter((entry) => !entry.settled && entry.connection === connection);
      streaming = false;
      connection += 1;
      holds = new Map();
      released = new Set();
      for (const entry of failing) {
        entry.settled = true;
        void Promise.resolve().then(() => resolveRaw(entry, { ok: false, error: ipcError('host_unavailable', 'machine disconnected before answering git.watch') }));
      }
      for (const listener of stateListeners) listener({ state: 'restarting', pid: null, restarts: 1, revision: connection } as HostState);
    },
    stream() {
      streaming = true;
      for (const listener of streamingListeners) listener();
    },
    // the supervisor's own deadline: the page is answered, the daemon may still adopt when its work lands
    timeOut(entry: Sent): () => void {
      entry.settled = true;
      resolveRaw(entry, { ok: false, error: ipcError('timeout', 'machine did not answer git.watch within 40 s') });
      return () => adopt(entry.owner, entry.connection);
    },
    get auto() {
      return auto;
    },
    set auto(value: boolean) {
      auto = value;
    },
  };
  // a settle that skips the daemon's adoption (the supervisor's own answers)
  const raw = new WeakMap<Sent, (answer: Answer) => void>();
  const resolveRaw = (entry: Sent, answer: Answer) => raw.get(entry)?.(answer);
  host.dispatch.mockImplementation(async (owner: string, name: string, input: unknown, client?: ClientRef): Promise<Answer> => {
    expect(owner).toBe('machine');
    expect(name).toBe('git.watch');
    expect(streaming).toBe(true);
    const on = connection;
    const id = client!.id;
    client!.onGone(() => {
      if (on !== connection) return;
      released.add(id);
      holds.delete(id);
    });
    return new Promise<Answer>((resolve) => {
      const entry: Sent = {
        owner: id, input, connection: on, settled: false,
        settle(answer) {
          if (entry.settled) return;
          entry.settled = true;
          if (answer.ok) adopt(id, on);
          resolve(answer);
        },
      };
      raw.set(entry, resolve);
      sent.push(entry);
      if (auto) entry.settle({ ok: true, value: STATUS });
    });
  });
  return host;
}

function lab(options?: { auto?: boolean }) {
  const host = fakeMachineHost(options);
  const emitted: FilesChanged[] = [];
  const replay = createWatchReplay({ hosts: host as never, emit: (_name, payload) => void emitted.push(payload) });
  host.onStreaming('machine', () => replay.replay()); // as daemon-spine.ts wires it
  const page = endableClientRef('page:3.1');
  const watch = (directory = '/r', client: ClientRef = page) => replay.dispatch('git.watch', { directory }, client);
  const unwatch = (directory = '/r', client: ClientRef = page) => replay.dispatch('git.unwatch', { directory }, client);
  return { host, replay, page, emitted, watch, unwatch };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const failed = (code: IpcError['code']) => ({ ok: false, error: expect.objectContaining({ code }) });

describe('the watch replay', () => {
  it('owns git.watch and git.unwatch only', () => {
    const { replay } = lab();
    expect(['git.watch', 'git.unwatch', 'git.status', 'files.watch'].map((name) => replay.owns(name))).toEqual([true, true, false, false]);
  });

  it('ends at one hold after a watch, an unwatch and a re-watch in one connection, the unwatch relayed as the first unit’s clientGone', async () => {
    const { host, watch, unwatch } = lab();
    expect(await watch()).toEqual({ ok: true, value: STATUS });
    expect(host.holds()).toBe(1);
    const first = host.sent[0]!.owner;
    expect(await unwatch()).toEqual({ ok: true, value: undefined });
    expect(host.holds()).toBe(0); // the first unit's ref ended: the daemon released its owner
    expect(await watch()).toEqual({ ok: true, value: STATUS });
    expect(host.holds()).toBe(1);
    expect(host.holders()).not.toContain(first);
    expect(host.sent).toHaveLength(2); // no git.unwatch is ever sent
  });

  it('drops the daemon’s late adoption when the watch is unwatched while its send is in flight, answering the watch with its send', async () => {
    const { host, watch, unwatch } = lab({ auto: false });
    const watching = watch();
    await vi.waitFor(() => expect(host.sent).toHaveLength(1));
    expect(await unwatch()).toEqual({ ok: true, value: undefined });
    host.sent[0]!.settle({ ok: true, value: STATUS }); // the fence drops it
    expect(await watching).toEqual({ ok: true, value: STATUS });
    expect(host.holds()).toBe(0);
  });

  it('answers a watch made during a restart once the host streams, and one unwatched before then with internal, nothing sent', async () => {
    const { host, watch, unwatch } = lab();
    host.detach();
    const kept = watch('/r');
    const dropped = watch('/s');
    await tick();
    expect(host.sent).toHaveLength(0);
    expect(await unwatch('/s')).toEqual({ ok: true, value: undefined });
    expect(await dropped).toEqual(failed('internal'));
    host.stream();
    expect(await kept).toEqual({ ok: true, value: STATUS });
    expect(host.sent.map((entry) => entry.input)).toEqual([{ directory: '/r' }]);
    expect(host.holds()).toBe(1);
  });

  it('sends both live units again in order at a reconnect, answering the pending page request by its unit’s new send', async () => {
    const { host, watch, unwatch } = lab({ auto: false });
    const one = watch();
    await vi.waitFor(() => expect(host.sent).toHaveLength(1));
    host.sent[0]!.settle({ ok: true, value: STATUS });
    expect(await one).toEqual({ ok: true, value: STATUS });
    const two = watch();
    await vi.waitFor(() => expect(host.sent).toHaveLength(2));
    host.detach(); // the second's send fails host_unavailable after the connection ended: a transport failure
    await tick();
    let answered = false;
    void two.then(() => void (answered = true));
    await tick();
    expect(answered).toBe(false); // still pending
    host.auto = true;
    host.stream();
    expect(await two).toEqual({ ok: true, value: STATUS });
    const resent = host.sent.slice(2);
    expect(resent.map((entry) => entry.owner)).toEqual([host.sent[0]!.owner, host.sent[1]!.owner]); // in order, each unit its own ref
    expect(host.holds()).toBe(2);
    await unwatch();
    expect(host.holds()).toBe(1);
  });

  it('requeues both units when the host detaches again before a replay settled, ignoring the stale answer', async () => {
    const { host, watch } = lab();
    await watch();
    await watch();
    host.auto = false;
    host.detach();
    host.stream(); // the first unit's resend in flight
    await vi.waitFor(() => expect(host.sent).toHaveLength(3));
    host.detach(); // before it answered
    await tick();
    host.auto = true;
    host.stream();
    await vi.waitFor(() => expect(host.holds()).toBe(2));
    expect(host.sent.slice(3).map((entry) => entry.owner)).toEqual([host.sent[0]!.owner, host.sent[1]!.owner]);
    await tick();
    expect(host.holds()).toBe(2);
  });

  it('ends a unit the supervisor timed out, releasing a hold adopted after the timeout, answers timeout, and a re-watch holds one', async () => {
    const { host, watch } = lab({ auto: false });
    const watching = watch();
    await vi.waitFor(() => expect(host.sent).toHaveLength(1));
    const landsLate = host.timeOut(host.sent[0]!);
    expect(await watching).toEqual(failed('timeout'));
    landsLate(); // the daemon's work lands after main's deadline: the fence (the unit's ref ended) drops it
    expect(host.holds()).toBe(0);
    host.auto = true;
    expect(await watch()).toEqual({ ok: true, value: STATUS });
    expect(host.holds()).toBe(1);
  });

  it('takes a refusal the front answers while the connection streams (a spine the lock refused) as terminal', async () => {
    const { host, watch, replay } = lab({ auto: false });
    const watching = watch();
    await vi.waitFor(() => expect(host.sent).toHaveLength(1));
    host.sent[0]!.settle({ ok: false, error: ipcError('host_unavailable', 'the spine is held by another MAWS') });
    expect(await watching).toEqual(failed('host_unavailable'));
    host.detach();
    host.stream();
    replay.replay();
    await tick();
    expect(host.sent).toHaveLength(1); // no unit retained, nothing sent again
  });

  it('ends every unit’s ref when the page ends, so the daemon holds nothing for it', async () => {
    const { host, watch, page } = lab();
    await watch('/r');
    await watch('/r');
    await watch('/s');
    expect(host.holds()).toBe(3);
    page.end();
    expect(host.holds()).toBe(0);
    host.detach();
    host.stream();
    await tick();
    expect(host.sent).toHaveLength(3); // nothing given back for a page that ended
  });

  it('invalidates each live files watch once per distinct session and directory at each streaming, and nothing let go', async () => {
    const { host, replay, page, emitted } = lab();
    const other = endableClientRef('page:4.1');
    replay.forwarded('files.watch', { appSessionId: 's1', path: '/r/src' }, page);
    replay.forwarded('files.watch', { appSessionId: 's1', path: '/r/src' }, other);
    replay.forwarded('files.watch', { appSessionId: 's1', path: '/r/docs' }, page);
    replay.forwarded('files.unwatch', { appSessionId: 's1', path: '/r/docs' }, page);
    replay.forwarded('files.watch', { appSessionId: 's2', path: '/q' }, other);
    replay.forwarded('files.read', { appSessionId: 's2', path: '/q/a' }, other);
    host.detach();
    host.stream();
    expect(emitted).toEqual([
      { appSessionId: 's1', path: '/r/src', kind: 'invalidated' },
      { appSessionId: 's2', path: '/q', kind: 'invalidated' },
    ]);
    // each holder's files store re-watches what the invalidation dropped (files/store.ts's reinstall)
    replay.forwarded('files.watch', { appSessionId: 's1', path: '/r/src' }, page);
    replay.forwarded('files.watch', { appSessionId: 's1', path: '/r/src' }, other);
    replay.forwarded('files.watch', { appSessionId: 's2', path: '/q' }, other);
    other.end();
    host.detach();
    host.stream();
    expect(emitted.slice(2)).toEqual([{ appSessionId: 's1', path: '/r/src', kind: 'invalidated' }]);
  });

  // The review's lifecycle (fix round 1): the invalidation's reinstall is a files.watch with no unwatch of the
  // connection before it, so each streaming's counts start over and the reinstall alone holds the pair
  it('invalidates nothing a page closed after a reconnect’s reinstall: watch, reconnect, reinstall, unwatch, reconnect', async () => {
    const { host, replay, page, emitted } = lab();
    replay.forwarded('files.watch', { appSessionId: 's1', path: '/r/src' }, page);
    host.detach();
    host.stream();
    expect(emitted).toEqual([{ appSessionId: 's1', path: '/r/src', kind: 'invalidated' }]);
    replay.forwarded('files.watch', { appSessionId: 's1', path: '/r/src' }, page); // the reinstall
    replay.forwarded('files.unwatch', { appSessionId: 's1', path: '/r/src' }, page); // the pane closed: its last holder
    host.detach();
    host.stream();
    expect(emitted).toHaveLength(1);
    // a pair the page never re-watched after an invalidation is not given back again either
    replay.forwarded('files.watch', { appSessionId: 's1', path: '/r/docs' }, page);
    host.detach();
    host.stream();
    host.detach();
    host.stream();
    expect(emitted.slice(1)).toEqual([{ appSessionId: 's1', path: '/r/docs', kind: 'invalidated' }]);
  });

  it('ends every unit’s ref at stop', async () => {
    const { host, watch, replay } = lab();
    await watch();
    replay.stop();
    expect(host.holds()).toBe(0);
  });
});
