// `host.browserWork` (P5 O17 M7; docs/doperpowers/plans/2026-11-01-p5-o17-browser.md, M7 and Interfaces §E; D20): the
// engine host's half of the browser fence. `mawsd` holds browser work for each session with a headless tab in its render
// host, and tells this host the whole held set as a snapshot, first on every fresh link and at each change. Modelled on
// attachment.ts: taken only from the served client whose hello listed `host.attachment` (`mawsd`'s permanent link), for
// itself and not forwarded for another client; anything else is answered `internal` with nothing changed.
//
// A snapshot is applied to every live row before it is answered: a row it names is `held`, every other row's entry is
// cleared, each set on its session and published as its status. The set is kept for the link's life and gives its
// verdict to every row created after it (a launch, or an adoption that finishes later). With no snapshot applied on the
// current link, an adopted row reads `unknown` from its reservation: the kept set is per engine-host process, so a
// successor's adoptions all read `unknown` until `mawsd`'s first snapshot to it. The link's end voids the set and turns
// every `held` into `unknown`; the next snapshot settles both. Nothing here enters the checkpoint, journal, roster or
// session hosts (O16's condition, R4): the hold lives on the session's status, which budget.ts `holdsWork` reads.
//
// The idle release (idle-release.ts) asks, through the table, for a due session held by its headless tab alone; that ask
// is `host.browserIdle` to the declaring client, which closes the session's tabs. A fresh link's first snapshot has
// every session still waiting ask again.
import type { AppSessionId } from '@shared/graph/ids';
import { namesClient } from '@shared/host/client-refs';
import { HostCommandError, type HostClientHooks, type HostEmit, type HostOn } from '@shared/host/runtime';
import type { ClientRef } from '@shared/ipc/client';
import { ipcError } from '@shared/ipc/errors';
import type { ProcessTable } from './process-table';
import type { EngineSession } from './session';

export type BrowserWorkSessions = Pick<ProcessTable, 'list' | 'onRowsChanged' | 'onBrowserIdleDue' | 'browserSnapshotApplied'>;

export function registerBrowserWork(on: HostOn, emit: HostEmit, client: Pick<HostClientHooks, 'declaresAttachment' | 'onClientGone'>, sessions: BrowserWorkSessions): void {
  // The current link's kept set, with the connection that applied it; null while the link has applied none
  let link: { connection: ClientRef; held: ReadonlySet<AppSessionId> } | null = null;
  const given = new WeakSet<EngineSession>(); // the rows that had their verdict at their creation
  for (const session of sessions.list()) given.add(session);
  const live = () => sessions.list().filter((session) => session.lifecycle !== 'exited');

  const linkEnded = (connection?: ClientRef) => {
    if (link === null || (connection !== undefined && link.connection !== connection)) return;
    link = null;
    for (const session of live()) if (session.status().work?.holds?.browser === 'held') session.setBrowserHold('unknown');
  };
  client.onClientGone(() => linkEnded());

  // A row created after the registration: the kept set's verdict, or, with none, `unknown` for an adopted row. Told at
  // its reservation, before its start, so its first status carries it.
  sessions.onRowsChanged(() => {
    for (const session of sessions.list()) {
      if (given.has(session)) continue;
      given.add(session);
      const status = session.status();
      const hold = link !== null ? (link.held.has(status.appSessionId) ? 'held' : null) : status.holder?.adopted === true ? 'unknown' : null;
      if (hold !== null) session.setBrowserHold(hold, false);
    }
  });

  on('host.browserWork', async ({ held }, ctx) => {
    if (!client.declaresAttachment() || namesClient(ctx.client)) throw new HostCommandError(ipcError('internal', 'host.browserWork from a client whose hello did not list host.attachment, or for another client: nothing changed'));
    const fresh = link?.connection !== ctx.client;
    link = { connection: ctx.client, held: new Set(held as AppSessionId[]) };
    const kept = link.held;
    for (const session of live()) session.setBrowserHold(kept.has(session.status().appSessionId) ? 'held' : null);
    if (!fresh) return;
    const connection = ctx.client;
    connection.onGone(() => linkEnded(connection)); // its end, ready or not (a link lost before its ready line too)
    sessions.browserSnapshotApplied();
  });

  sessions.onBrowserIdleDue((appSessionId) => {
    if (client.declaresAttachment()) emit('host.browserIdle', { appSessionId });
  });
}
