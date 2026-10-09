// The supervisor's notices (E10 execution document, §Design 6, §Design 1 "The crash", §Design 11), app-wide: connected
// once at the app root, which is also what keeps the hosts store's `host.status` live while neither Diagnostics nor
// Settings is shown. Every `host.status` re-derives them:
// - `supervisor.updated`, a banner while an older build's supervisor serves live sessions (main armed its exit when
//   idle): Restart now, replaced in place as the count changes, dismissed when the mismatch ends; one the owner
//   dismissed stays dismissed until the mismatch ends.
// - `supervisor.incompatible`, a banner while main waits on a supervisor it cannot talk to that still runs sessions:
//   Restart now and Wait. Main armed that supervisor's exit-when-idle itself (Decision Log b2e4a1b1), so Wait only
//   acknowledges and dismisses; a launch refused with `host_unavailable` while still waiting shows it again (90f959f4).
// - `supervisor.crashed`, a toast once per unexpected exit main reports after the page's first word (a reload after a
//   crash does not repeat it), naming the interrupted sessions and the exit's cause when known.
import type { CommandName, IpcError, MawsBridge } from '@shared/ipc/schema';
import type { HostStatus } from '@shared/ipc/schema/host';
import { ipc, onCommandRefused } from '../ipc/client';
import { createHostsStore, useHosts } from '../stores/hosts';
import { createNoticesStore, useNotices } from '../stores/notices';
import { SUPERVISOR_NOTICES } from './copy';

export const SUPERVISOR_NOTICE_IDS = { updated: 'supervisor.updated', incompatible: 'supervisor.incompatible', crashed: 'supervisor.crashed' } as const;

// The renderer's commands that start or resume an engine process (a send resumes a released session, a fork launches
// its new one, a take-over resumes the session here; `session.launch` is the dev-only Resume live launcher's): refused
// while waiting, they bring the banner back.
const LAUNCHES: ReadonlySet<CommandName> = new Set<CommandName>(['session.start', 'session.send', 'session.fork', 'session.takeOver', 'session.launch', 'session.acquire' /* P2-A */]);

type Banner = 'updated' | 'incompatible';

export interface SupervisorNoticesDeps {
  client?: MawsBridge;
  hosts?: ReturnType<typeof createHostsStore>;
  notices?: ReturnType<typeof createNoticesStore>;
  refusals?: (listener: (name: CommandName, error: IpcError) => void) => () => void;
}

const waiting = (status: HostStatus | null) => status?.state === 'crashed' && status.reason === 'incompatible';

// Restart now, the banners', Diagnostics' and Settings' one act: stop the sessions, start this build's supervisor; a
// refusal is a warning toast. Settings' Stop all is the same call, said as a stop when refused (`failed`). Answers
// whether main took it.
export async function restartSupervisor(
  client: MawsBridge,
  notices: Pick<ReturnType<typeof createNoticesStore>, 'getState'>,
  failed: (why: string) => string = SUPERVISOR_NOTICES.restartFailed,
): Promise<boolean> {
  const result = await client.invoke('host.restart', { stopSessions: true });
  if (!result.ok) notices.getState().toast({ level: 'warning', text: failed(result.error.message), actions: [], dismissible: true });
  return result.ok;
}

export function connectSupervisorNotices({ client = ipc, hosts = useHosts, notices = useNotices, refusals = onCommandRefused }: SupervisorNoticesDeps = {}): () => void {
  const posted: Record<Banner, boolean> = { updated: false, incompatible: false }; // this banner was posted for the current mismatch
  const acknowledged: Record<Banner, boolean> = { updated: false, incompatible: false }; // the owner dismissed it, or chose Wait
  let lastExitAt: string | null | undefined; // undefined until the first word: what the page knew is not news
  const restart = () => void restartSupervisor(client, notices);

  const wanted = (status: HostStatus): Record<Banner, { text: string; actions: { label: string; run: () => void }[] } | null> => {
    const live = status.supervisor?.liveSessions ?? 0;
    return {
      updated:
        status.state === 'ready' && status.matches === 'build' && live > 0
          ? { text: SUPERVISOR_NOTICES.updated(live), actions: [{ label: SUPERVISOR_NOTICES.restartNow, run: restart }] }
          : null,
      incompatible: waiting(status)
        ? {
            text: SUPERVISOR_NOTICES.incompatible(status.waitingLiveSessions ?? 0),
            actions: [
              { label: SUPERVISOR_NOTICES.restartNow, run: restart },
              { label: SUPERVISOR_NOTICES.wait, run: () => acknowledge('incompatible') },
            ],
          }
        : null,
    };
  };

  const acknowledge = (kind: Banner) => {
    acknowledged[kind] = true;
    notices.getState().dismiss(SUPERVISOR_NOTICE_IDS[kind]);
  };

  const syncBanners = (status: HostStatus) => {
    const want = wanted(status);
    for (const kind of ['updated', 'incompatible'] as const) {
      const id = SUPERVISOR_NOTICE_IDS[kind];
      const notice = want[kind];
      if (notice === null) {
        if (posted[kind]) notices.getState().dismiss(id);
        posted[kind] = acknowledged[kind] = false;
        continue;
      }
      // A banner posted for this mismatch and gone from the store was dismissed by the owner (its ×).
      if (posted[kind] && !notices.getState().notices.some((n) => n.id === id)) acknowledged[kind] = true;
      if (acknowledged[kind]) continue;
      notices.getState().banner({ id, level: kind === 'updated' ? 'info' : 'warning', dismissible: kind === 'updated', ...notice });
      posted[kind] = true;
    }
  };

  const syncCrash = ({ lastExit }: HostStatus) => {
    const known = lastExitAt;
    lastExitAt = lastExit?.at ?? known ?? null;
    if (known === undefined || lastExit === null || lastExit.at === known) return;
    notices.getState().toast({
      id: SUPERVISOR_NOTICE_IDS.crashed,
      level: 'warning',
      text: SUPERVISOR_NOTICES.crashed(lastExit.code, lastExit.signal, lastExit.interrupted),
      actions: [],
      dismissible: true,
    });
  };

  const sync = (status: HostStatus) => {
    syncBanners(status);
    syncCrash(status);
  };

  const disconnectHosts = hosts.getState().connect();
  const current = hosts.getState().supervisor;
  if (current) sync(current);
  const offStore = hosts.subscribe((state, previous) => {
    if (state.supervisor && state.supervisor !== previous.supervisor) sync(state.supervisor);
  });
  const offRefusals = refusals((name, error) => {
    const status = hosts.getState().supervisor;
    if (!LAUNCHES.has(name) || error.code !== 'host_unavailable' || !waiting(status)) return;
    posted.incompatible = acknowledged.incompatible = false;
    syncBanners(status!);
  });

  return () => {
    offRefusals();
    offStore();
    disconnectHosts();
  };
}
