// The checkouts' watches across a `mawsd` restart, on the daemon shape (P5 O3-E M2;
// docs/doperpowers/plans/2026-10-30-p5-o3-e-checkout.md, Interfaces §E, D8). `mawsd` counts a `git.watch` hold per asking
// client and releases every hold of a connection when it ends, so a restart leaves the pages' Environment rows and
// Files panes watching nothing. Main keeps what each page watches and gives it back at each streaming of the `machine`
// host, as the mirror gives back the visibility claims.
//
// git: main dispatches a page's `git.watch` and `git.unwatch` itself. Per (page, directory) it keeps the ordered units
// of the page's live watches, each unit a `ClientRef` of its own under which its watch is sent, so the daemon counts the
// unit's holds under that owner. Ending a unit's ref is the one release: the supervisor relays it as `clientGone` after
// the request, the front ends that owner's ref, git's handler releases the owner, and the watcher's fence drops an
// adoption still in flight. So an unwatch, a page's end and a deadline left undecided all release whatever the daemon
// holds or will hold, with nothing inferred from answers. A unit is `queued` (not sent under this connection), `sent`
// (its one send in flight; one per entry) or `installed` (answered `ok` under this connection). An answer is judged by
// its connection: under the connection it went on, `ok` installs and a refusal is terminal (the front's `host_unavailable`
// for a spine it cannot load included, which a retry would loop on); after that connection ended, it is a transport
// failure and the unit goes back to the queue with its page request pending. Each entry's driver sends while the host
// streams, so a page's call made during a restart is answered once it streams. A replayed first watch of a root emits
// `git.changed` as `initial`, which every window's git store applies.
//
// No page request waits without bound (the final review's finding 1). A page's watch is held only as the supervisor
// would hold its request: while the host starts or restarts. At `crashed` (the crash limit, an unreachable daemon) the
// supervisor fails what it held and answers at once while crashed, so the replay answers every unit whose page request
// is pending `host_unavailable`, and a watch made while crashed at once; and whatever the state, a page request still
// pending at the command's budget from the page's call answers the supervisor's own `timeout`. A unit answered either
// way is removed and its ref ended, as a terminal answer is; an installed unit (its page answered) stays, given back
// when the host streams again.
//
// files: a files watch installs and lists nothing, so a re-sent `files.watch` would leave a pane stale for what changed
// while disconnected. Main only observes `files.watch` and `files.unwatch` on their way through, and at each streaming
// emits `files.changed {kind: 'invalidated'}` once per distinct live (session, directory), on which the renderer's
// files store re-lists and re-watches under the page's ref (src/renderer/src/tools/code/files/store.ts). That reinstall
// is a `files.watch` with no `files.unwatch` for the connection before it, so the counts start over at each streaming
// once its invalidations are out: each connection counts only what was watched on it.
//
// The O6 link's watches of another machine's session are not given back here (O7's, with the link's reconnect).
import { REQUEST_TIMEOUT_MS, type HostSupervisor } from '@shared/host/host-supervisor';
import { endableClientRef, type ClientRef, type EndableClientRef } from '@shared/ipc/client';
import { ipcError } from '@shared/ipc/errors';
import type { CommandInput, CommandName, CommandResult } from '@shared/ipc/schema';
import type { FilesChanged } from '@shared/ipc/schema/files';

export interface WatchReplay {
  owns(name: string): boolean; // git.watch and git.unwatch: main's host dispatch routes a page's call through `dispatch`
  dispatch(name: 'git.watch' | 'git.unwatch', input: unknown, client: ClientRef): Promise<CommandResult<CommandName>>; // the page's answer
  forwarded(name: string, input: unknown, client: ClientRef | undefined): void; // files.watch and files.unwatch, observed
  replay(): void; // at each streaming of the machine host: every unit sent again in order; each live files pair invalidated
  stop(): void;
}

export interface WatchReplayOptions {
  hosts: Pick<HostSupervisor, 'dispatch' | 'onState' | 'onStreaming' | 'streaming' | 'snapshot'>;
  emit(name: 'files.changed', payload: FilesChanged): void;
  budgetsMs?: Readonly<Partial<Record<CommandName, number>>>; // the machine host's (COMMAND_BUDGETS_MS): a page's watch is answered within git.watch's
}

type Answer = CommandResult<CommandName>;
type Connection = object; // one per streaming of the machine host: what a send's answer is judged by

interface Unit {
  readonly ref: EndableClientRef;
  state: 'queued' | 'sent' | 'installed';
  removed: boolean;
  request: ((answer: Answer) => void) | null; // the page's git.watch, until answered
  deadline: ReturnType<typeof setTimeout> | null; // the budget from the page's call, while its request is pending
}

interface Entry {
  readonly input: CommandInput<'git.watch'>;
  readonly units: Unit[];
  sending: Unit | null; // the send in flight, whichever connection it went on
  forget(): void; // off its page once it holds no unit and sends nothing
}

interface Page {
  readonly git: Map<string, Entry>; // by directory
  readonly files: Map<string, { appSessionId: FilesChanged['appSessionId']; path: string; count: number }>; // by session and directory
  off(): void;
}

const OWNED: ReadonlySet<string> = new Set(['git.watch', 'git.unwatch']);
const ok: Answer = { ok: true, value: undefined as never };

export function createWatchReplay({ hosts, emit, budgetsMs }: WatchReplayOptions): WatchReplay {
  const pages = new Map<string, Page>();
  let connection: Connection | null = hosts.streaming('machine') ? {} : null;
  let crashed = hosts.snapshot('machine').state === 'crashed'; // the supervisor holds no request while crashed
  let ordinal = 0;
  let stopped = false;
  const budgetMs = budgetsMs?.['git.watch'] ?? REQUEST_TIMEOUT_MS; // as the supervisor bounds the send
  const unavailable = (): Answer => ({ ok: false, error: ipcError('host_unavailable', 'machine is crashed; cannot answer git.watch') });

  const answer = (unit: Unit, result: Answer) => {
    const request = unit.request;
    unit.request = null;
    if (unit.deadline !== null) clearTimeout(unit.deadline);
    unit.deadline = null;
    request?.(result);
  };
  const end = (entry: Entry, unit: Unit) => {
    unit.removed = true;
    const at = entry.units.indexOf(unit);
    if (at !== -1) entry.units.splice(at, 1);
    unit.ref.end();
  };

  function drive(entry: Entry): void {
    if (connection === null || entry.sending !== null || stopped) return;
    const unit = entry.units.find((candidate) => candidate.state === 'queued');
    if (unit === undefined) return;
    const on = connection;
    unit.state = 'sent';
    entry.sending = unit;
    void hosts
      .dispatch('machine', 'git.watch', entry.input, unit.ref)
      .catch((error: unknown): Answer => ({ ok: false, error: ipcError('internal', error instanceof Error ? error.message : String(error)) }))
      .then((result) => answered(entry, unit, on, result));
  }

  function answered(entry: Entry, unit: Unit, on: Connection, result: Answer): void {
    if (entry.sending === unit) entry.sending = null;
    if (unit.removed) answer(unit, result); // unwatched while in flight: its watch request takes this answer
    else if (on !== connection && crashed && unit.request !== null) settleUnavailable(entry, unit); // and the host is down for good
    else if (on !== connection) unit.state = 'queued'; // the connection ended under it: sent again on the next
    else if (result.ok) {
      unit.state = 'installed';
      answer(unit, result);
    } else {
      end(entry, unit); // terminal: harmless if nothing was adopted, a late adoption released
      answer(unit, result);
    }
    if (entry.units.length === 0 && entry.sending === null) entry.forget();
    else drive(entry);
  }

  // A page request the replay may not hold on: the unit removed, its ref ended, the page answered.
  function settle(entry: Entry, unit: Unit, result: Answer): void {
    if (!unit.removed) end(entry, unit);
    answer(unit, result);
    if (entry.units.length === 0 && entry.sending === null) entry.forget();
  }
  const settleUnavailable = (entry: Entry, unit: Unit) => settle(entry, unit, unavailable());

  function pageOf(client: ClientRef): Page | null {
    const page = pages.get(client.id);
    if (page) return page;
    const created: Page = { git: new Map(), files: new Map(), off: () => {} };
    pages.set(client.id, created);
    created.off = client.onGone(() => gone(client.id, created));
    return pages.get(client.id) === created ? created : null; // a page already gone ended at once
  }

  function gone(id: string, page: Page): void {
    if (pages.get(id) !== page) return;
    pages.delete(id);
    for (const entry of page.git.values()) {
      for (const unit of [...entry.units]) {
        end(entry, unit);
        answer(unit, { ok: false, error: ipcError('internal', 'the page ended before it was watched') });
      }
    }
    page.git.clear();
    page.files.clear();
  }

  function watch(input: CommandInput<'git.watch'>, client: ClientRef): Promise<Answer> {
    const page = pageOf(client);
    if (page === null || stopped) return Promise.resolve({ ok: false, error: ipcError('internal', 'the page ended before it was watched') });
    if (crashed) return Promise.resolve(unavailable());
    let entry = page.git.get(input.directory);
    if (!entry) {
      const created: Entry = { input, units: [], sending: null, forget: () => void (page.git.get(input.directory) === created && page.git.delete(input.directory)) };
      page.git.set(input.directory, (entry = created));
    }
    const unit: Unit = { ref: endableClientRef(`${client.id}~git.watch.${++ordinal}`), state: 'queued', removed: false, request: null, deadline: null };
    const result = new Promise<Answer>((resolve) => (unit.request = resolve));
    const at = entry;
    unit.deadline = setTimeout(() => settle(at, unit, { ok: false, error: ipcError('timeout', `machine did not answer git.watch within ${budgetMs / 1000} s`) }), budgetMs);
    entry.units.push(unit);
    drive(entry);
    return result;
  }

  function unwatch(input: CommandInput<'git.unwatch'>, client: ClientRef): Answer {
    const entry = pages.get(client.id)?.git.get(input.directory);
    const unit = entry?.units.at(-1);
    if (!entry || !unit) return ok;
    const inFlight = entry.sending === unit;
    end(entry, unit);
    if (unit.state === 'queued' && !inFlight) answer(unit, { ok: false, error: ipcError('internal', 'released before it was watched') });
    if (entry.units.length === 0 && entry.sending === null) entry.forget();
    return ok;
  }

  const offs = [
    // the host left streaming (every transition does): what was installed ended with the connection
    hosts.onState('machine', (state) => {
      connection = null;
      crashed = state.state === 'crashed';
      for (const page of pages.values()) for (const entry of page.git.values()) for (const unit of entry.units) unit.state = 'queued';
      if (!crashed) return;
      // what waits for a send not in flight is answered now; a send in flight is failed by the supervisor's detach
      for (const page of pages.values()) {
        for (const entry of [...page.git.values()]) for (const unit of [...entry.units]) if (unit.request !== null && entry.sending !== unit) settleUnavailable(entry, unit);
      }
    }),
  ];

  return {
    owns: (name) => OWNED.has(name),
    async dispatch(name, input, client) {
      if (name === 'git.watch') return watch(input as CommandInput<'git.watch'>, client);
      return unwatch(input as CommandInput<'git.unwatch'>, client);
    },
    forwarded(name, input, client) {
      if ((name !== 'files.watch' && name !== 'files.unwatch') || client === undefined || stopped) return;
      const { appSessionId, path } = input as Pick<FilesChanged, 'appSessionId' | 'path'>; // validated by the router
      const key = `${appSessionId}\n${path}`;
      if (name === 'files.watch') {
        const page = pageOf(client);
        if (page === null) return;
        const held = page.files.get(key);
        if (held) held.count += 1;
        else page.files.set(key, { appSessionId, path, count: 1 });
        return;
      }
      const files = pages.get(client.id)?.files;
      const held = files?.get(key);
      if (held && --held.count <= 0) files!.delete(key);
    },
    replay() {
      if (stopped) return;
      connection = {};
      const pairs = new Map<string, FilesChanged>();
      for (const page of pages.values()) {
        for (const [key, { appSessionId, path }] of page.files) pairs.set(key, { appSessionId, path, kind: 'invalidated' });
        page.files.clear(); // each holder's reinstall (a files.watch, no unwatch before it) is what this connection counts
        for (const entry of page.git.values()) {
          for (const unit of entry.units) if (unit !== entry.sending) unit.state = 'queued';
          drive(entry);
        }
      }
      for (const payload of pairs.values()) emit('files.changed', payload);
    },
    stop() {
      stopped = true;
      for (const off of offs) off();
      for (const [id, page] of [...pages]) {
        page.off();
        gone(id, page);
      }
    },
  };
}
