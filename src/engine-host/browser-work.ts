// `host.browserWork` (P5 O17 M7; docs/doperpowers/plans/2026-11-01-p5-o17-browser.md, M7 and Interfaces §E; D20): the
// engine host's half of the browser fence. `mawsd` holds browser work for each session with a headless tab in its render
// host, and tells this host the whole held set as a snapshot, first on every fresh link and at each change. Modelled on
// attachment.ts: taken only from the served client whose hello listed `host.attachment` (`mawsd`'s permanent link), for
// itself and not forwarded for another client; anything else is answered `internal` with nothing changed.
//
// A snapshot is applied to every row before it is answered: a live row it names is `held`, every other row's entry is
// cleared (an exited row's included), each set on its session and published as its status. The set is kept for the link's life and gives its
// verdict to every row created after it (a launch, or an adoption that finishes later). With no snapshot applied on the
// current link, an adopted row reads `unknown` from its reservation, and so does a launched one while a declaring link is
// up: the kept set is per engine-host process, so a successor's adoptions all read `unknown` until `mawsd`'s first
// snapshot to it. The link's end voids the set and turns every `held` into `unknown`, once however it is heard; a
// publication that finds the client gone during a snapshot ends the link there, the rest of it not applied. The next
// snapshot settles both. An empty snapshot keeps the shared empty set; each link keeps one subscription to its end. Nothing here enters the checkpoint, journal, roster or
// session hosts (O16's condition, R4): the hold lives on the session's status, which budget.ts `holdsWork` reads.
//
// The idle release (idle-release.ts) asks, through the table, for a due session held by its headless tab alone; that ask
// is `host.browserIdle` to the declaring client, which closes the session's tabs. A fresh link's first snapshot has
// every session still waiting ask again.
//
// The first snapshot on each link is logged with how many sessions it holds. M8's scene 6 stages both arrival orders of an
// adoption and the snapshot at e2e with two holds read under MAWS_E2E=1 alone (`e2eHoldFor`): one on a snapshot's
// application (here), one on the start's adoptions (index.ts).
import { existsSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import type { AppSessionId } from '@shared/graph/ids';
import { namesClient } from '@shared/host/client-refs';
import { HostCommandError, type HostClientHooks, type HostEmit, type HostOn } from '@shared/host/runtime';
import type { ClientRef } from '@shared/ipc/client';
import { ipcError } from '@shared/ipc/errors';
import type { ProcessTable } from './process-table';

export type BrowserWorkSessions = Pick<ProcessTable, 'list' | 'onReserved' | 'onBrowserIdleDue' | 'browserSnapshotApplied'>;

export interface BrowserWorkOptions {
  log?: (line: string) => void;
  hold?: () => Promise<void>; // the e2e's hold on a snapshot's application (MAWS_E2E_BROWSER_WORK_HOLD)
}

// The kept set of every link whose snapshot named no session: shared, so an empty snapshot keeps nothing of its own
const NONE: ReadonlySet<AppSessionId> = new Set();

export function registerBrowserWork(on: HostOn, emit: HostEmit, client: Pick<HostClientHooks, 'declaresAttachment' | 'onClientGone'>, sessions: BrowserWorkSessions, opts: BrowserWorkOptions = {}): void {
  // The connection whose snapshots are the kept set (null while the current link has applied none), and that set
  let applied: ClientRef | null = null;
  let kept: ReadonlySet<AppSessionId> = NONE;

  // The applying link's end, heard once whichever way it comes (the runtime's gone hook for a ready client, the
  // connection's own end for any): the set is void and every `held` becomes `unknown`
  const linkEnded = () => {
    if (applied === null) return;
    applied = null;
    kept = NONE;
    for (const session of sessions.list()) if (session.lifecycle !== 'exited' && session.status().work?.holds?.browser === 'held') session.setBrowserHold('unknown');
  };
  client.onClientGone(linkEnded);

  // A row created later: the kept set's verdict; with none applied on the current link, `unknown` for an adopted row and
  // for any row while a declaring link is up (its first snapshot settles it), clear otherwise (no `mawsd` link: main's
  // own). Told at its reservation, before its start, so its first status carries it; nothing is kept per row.
  sessions.onReserved((session) => {
    const status = session.status();
    const hold = applied !== null ? (kept.has(status.appSessionId) ? 'held' : null) : status.holder?.adopted === true || client.declaresAttachment() ? 'unknown' : null;
    if (hold !== null) session.setBrowserHold(hold, false);
  });

  on('host.browserWork', async ({ held }, ctx) => {
    if (!client.declaresAttachment() || namesClient(ctx.client)) throw new HostCommandError(ipcError('internal', 'host.browserWork from a client whose hello did not list host.attachment, or for another client: nothing changed'));
    if (opts.hold) await opts.hold();
    const connection = ctx.client;
    const fresh = applied !== connection;
    if (fresh) {
      linkEnded(); // an earlier link's set, if its end was not heard
      applied = connection;
      connection.onGone(linkEnded); // run at once when it has already ended: then nothing is applied
      if (applied !== connection) return;
    }
    kept = held.length === 0 ? NONE : new Set(held as AppSessionId[]);
    // Each row set and published in turn. A publication that finds the client gone ends the link at once (the runtime's
    // gone hook): `linkEnded` has turned every `held` into `unknown`, and the rest of the snapshot is not applied
    for (const session of sessions.list()) {
      if (applied !== connection) return;
      session.setBrowserHold(session.lifecycle !== 'exited' && kept.has(session.status().appSessionId) ? 'held' : null); // an exited row holds nothing
    }
    if (!fresh || applied !== connection) return;
    opts.log?.(`browser work: the first snapshot on this link holds ${kept.size} session(s)`);
    sessions.browserSnapshotApplied();
  });

  sessions.onBrowserIdleDue((appSessionId) => {
    if (client.declaresAttachment()) emit('host.browserIdle', { appSessionId });
  });
}

// M8's scene 6 (e2e only): armed only under MAWS_E2E=1 with `key` naming a file, read once where the host starts; then
// a wait while that file exists (read every 100 ms, at most E2E_HOLD_MAX_MS), as the tool server's hold
// (tool-server/e2e-hold.ts). Unarmed it is undefined, and nothing of it is made. Waits end in the order they began: two
// snapshots held together (`mawsd` sends the next once the first's forward has timed out) apply in the order they came,
// as without the hold.
export const E2E_HOLD_MAX_MS = 120_000;
export interface E2eHoldDeps {
  exists(path: string): boolean;
  sleep(ms: number): Promise<unknown>;
  now(): number;
}
export function e2eHoldFor(env: NodeJS.ProcessEnv, key: 'MAWS_E2E_BROWSER_WORK_HOLD' | 'MAWS_E2E_ADOPTION_HOLD', deps?: E2eHoldDeps): (() => Promise<void>) | undefined {
  if (env.MAWS_E2E !== '1') return undefined;
  const path = env[key];
  if (!path) return undefined;
  const { exists, sleep: wait, now } = deps ?? { exists: existsSync, sleep: (ms: number) => sleep(ms), now: Date.now };
  const held = async () => {
    const until = now() + E2E_HOLD_MAX_MS;
    while (exists(path) && now() < until) await wait(100);
  };
  let last: Promise<void> = Promise.resolve();
  return () => (last = last.then(held));
}
