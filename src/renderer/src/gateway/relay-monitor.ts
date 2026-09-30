// The relay monitor (C11 execution document, Interfaces "Gateway", *Relay monitor*): while any session runs routed
// through ClaudeUsage's relay, check the relay every 30 s and say so, app-wide, when it stops answering. One banner per
// outage through C5's notices (a fixed id, so the store keeps one), dismissed with a toast when the relay answers again;
// a banner the user dismissed is not posted again for the same outage. Live processes are left alone: the engine
// reports its failed requests itself, and MAWS never relaunches on its own initiative (D-16).
import type { RelayHealth } from '@shared/engine/relay-health';
import type { ActionId } from '@shared/keymap/actions';
import { runAction as runShellAction } from '../keymap/actions-runtime';
import { useNotices, type NoticesState } from '../stores/notices';
import { useSessions, type SessionsState } from '../stores/sessions';
import { useGateway, type GatewayStore } from './store';

export const RELAY_POLL_MS = 30_000;
export const RELAY_BANNER_ID = 'relay:down';

const LIVE = new Set(['starting', 'initializing', 'ready']);
const liveGatewaySessions = (state: SessionsState): number =>
  [...state.engine.values()].filter((s) => s.gateway.mode === 'gateway' && LIVE.has(s.process)).length;

export const hasLiveGatewaySession = (state: SessionsState): boolean => liveGatewaySessions(state) > 0;

export interface RelayMonitorDeps {
  gateway: GatewayStore;
  sessions: typeof useSessions;
  notices: { getState(): Pick<NoticesState, 'banner' | 'toast' | 'dismiss' | 'notices'> };
  runAction(id: ActionId): void;
}

// How long the relay has not answered, from the first check that found it down to the latest (mockup 06 vignette 02).
function since(fromIso: string, toIso: string): string {
  const s = Math.max(0, Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  return `${Math.floor(s / 3600)} h ago`;
}

function bannerText(live: number, outageSince: string, checkedAt: string): string {
  const sessions = live === 1 ? '1 live session keeps its process; its next request fails' : `${live} live sessions keep their process; their next request fails`;
  return `ClaudeUsage's relay stopped answering ${since(outageSince, checkedAt)} · ${sessions} until it is back · new sessions will offer Direct`;
}

export function startRelayMonitor(
  deps: RelayMonitorDeps = { gateway: useGateway, sessions: useSessions, notices: useNotices, runAction: (id) => runShellAction(id) },
): () => void {
  const { gateway, sessions, notices } = deps;
  let timer: ReturnType<typeof setInterval> | null = null;
  let outage: { since: string } | null = null;

  const check = () => void gateway.getState().refreshRelay(true).catch((error: unknown) => console.warn('[gateway] relay check failed', error));
  const bannerShown = () => notices.getState().notices.some((n) => n.id === RELAY_BANNER_ID);

  const observe = (health: RelayHealth) => {
    if (health.ok) {
      if (outage === null) return;
      outage = null;
      if (bannerShown()) notices.getState().dismiss(RELAY_BANNER_ID);
      notices.getState().toast({ level: 'info', text: 'Relay is back', actions: [], dismissible: true });
      return;
    }
    // One banner per outage: posted at its first failed check, then kept current in place (how long, how many live
    // sessions) while it is shown; once dismissed it stays dismissed until the relay answers again.
    if (outage !== null && !bannerShown()) return;
    outage ??= { since: health.checkedAt };
    notices.getState().banner({
      id: RELAY_BANNER_ID,
      level: 'warning',
      text: bannerText(liveGatewaySessions(sessions.getState()), outage.since, health.checkedAt),
      actions: [
        { label: 'Open ClaudeUsage', run: () => deps.runAction('gateway.openClaudeUsage') },
        { label: 'Retry', run: check },
      ],
      dismissible: true,
    });
  };

  const follow = (state: SessionsState) => {
    const live = hasLiveGatewaySession(state);
    if (live && timer === null) {
      timer = setInterval(check, RELAY_POLL_MS);
      check();
    } else if (!live && timer !== null) {
      clearInterval(timer);
      timer = null;
      if (outage !== null && bannerShown()) notices.getState().dismiss(RELAY_BANNER_ID); // no live session is left to warn about
      outage = null;
    }
  };

  const offRelay = gateway.subscribe((next, prev) => {
    if (timer !== null && next.relay !== prev.relay && next.relay) observe(next.relay);
  });
  const offSessions = sessions.subscribe(follow);
  follow(sessions.getState());
  return () => {
    offRelay();
    offSessions();
    if (timer !== null) clearInterval(timer);
    timer = null;
  };
}
