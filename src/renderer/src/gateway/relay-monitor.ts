// The relay monitor (C11 execution document, Interfaces "Gateway", *Relay monitor*): while any session runs routed
// through ClaudeUsage's relay, check the relay every 30 s and say so, app-wide, when it stops answering. One banner per
// outage through C5's notices (a fixed id, so the store keeps one), dismissed when the relay answers again (with no
// toast: the banner leaving says so, the word cut's C154); a banner the user dismissed is not posted again for the same
// outage. Live processes are left alone: the engine reports its failed requests itself, and MAWS never relaunches on
// its own initiative (D-16).
import type { RelayHealth } from '@shared/engine/relay-health';
import type { ActionId } from '@shared/keymap/actions';
import { formatAgo } from '@shared/app/date-format';
import { runAction as runShellAction } from '../keymap/actions-runtime';
import { useNotices, type NoticesState } from '../stores/notices';
import { useSessions, type SessionsState } from '../stores/sessions';
import { throughClaudeUsage } from './observed-route';
import { useGateway, type GatewayStore } from './store';

export const RELAY_POLL_MS = 30_000;
export const RELAY_BANNER_ID = 'relay:down';

const LIVE = new Set(['starting', 'initializing', 'ready']);
export const hasLiveGatewaySession = (state: SessionsState): boolean => [...state.engine.values()].some((s) => throughClaudeUsage(s, null) === true && LIVE.has(s.process)); // P5 O7 M9: what it was observed reaching

export interface RelayMonitorDeps {
  gateway: GatewayStore;
  sessions: typeof useSessions;
  notices: { getState(): Pick<NoticesState, 'banner' | 'toast' | 'dismiss' | 'notices'> };
  runAction(id: ActionId): void;
}

// How long the relay has not answered, from the first check that found it down to the latest (mockup 06 vignette 02).
// In the display locale (`@shared/app/date-format`): "now", "30 seconds ago", "1 minute ago".
const since = (fromIso: string, toIso: string): string => formatAgo(Math.max(0, Date.parse(toIso) - Date.parse(fromIso)), { seconds: true });

// The word cut (C153): how long, and the consequence
const bannerText = (outageSince: string, checkedAt: string): string => `ClaudeUsage's relay stopped answering ${since(outageSince, checkedAt)} · requests fail until it is back`;

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
      return;
    }
    // One banner per outage: posted at its first failed check, then kept current in place (how long) while it is shown;
    // once dismissed it stays dismissed until the relay answers again.
    if (outage !== null && !bannerShown()) return;
    outage ??= { since: health.checkedAt };
    notices.getState().banner({
      id: RELAY_BANNER_ID,
      level: 'warning',
      text: bannerText(outage.since, health.checkedAt),
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
