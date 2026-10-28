// Main's interest report (P5 O2 M2: docs/doperpowers/plans/2026-10-27-p5-o2-mawsd.md, M2 "Interest"; P5 §2 "Idle
// release"): the sessions this app holds open, which the engine host's idle release never stops. The set is what the
// inactive sweep keeps (P5 O3-C, D11: one set, `appInterest`, read by both): every project's session and agent tabs in
// `main.tabs` (src/main/layout/open-session-tabs.ts), with the sessions on screen (the spine's view's visible set). It goes out as `host.interest`, the whole set replacing the last, on every change
// (coalesced to one send per 250 ms) and at once at every engine-host streaming, since the host now serving (a restart,
// another supervisor) holds no set from this app until told. Nothing goes out while the host is not streaming; the
// engine host ends this client's set itself when its connection ends.
import type { AppSessionId } from '@shared/graph/ids';
import type { CommandInput, CommandResult } from '@shared/ipc/schema';
import type { MachineRef } from '@shared/machine/ref';
import type { SpineView } from '@shared/spine/view';
import { sessionsInTabs } from '../layout/open-session-tabs';
import type { LayoutFileStore } from '../layout/store';

export const INTEREST_COALESCE_MS = 250;

// P5 O6: the tabs hold addresses; the engine host is this machine's, so the set is the local machine's bare ids.
export function interestSet(mainTabs: unknown, onScreen: Iterable<AppSessionId>, local: MachineRef): AppSessionId[] {
  return [...new Set([...sessionsInTabs(mainTabs, local), ...onScreen])].sort();
}

// P5 O3-C (D11): the app's interest, memoized: read again only after `main.tabs` is written or a session's visibility
// changes. The report sends it, and on the embedded shape it is the sweep's `interest()` (at O3-D, mawsd's union of every
// client's report). A tab is written at once when it opens but nothing before the layout hydrates, so a session on
// screen counts too: a tab opened in that window is the one on screen.
export interface AppInterest {
  set(): ReadonlySet<AppSessionId>;
  onChange(listener: () => void): () => void; // `main.tabs` written, or a session's visibility changed
  stop(): void;
}

export function appInterest(layout: Pick<LayoutFileStore, 'get' | 'onChange'>, view: Pick<SpineView, 'visibleSessions' | 'on'>, local: MachineRef): AppInterest {
  let memo: ReadonlySet<AppSessionId> | null = null;
  const onChange = (listener: () => void) => {
    const changed = () => {
      memo = null;
      listener();
    };
    const offs = [layout.onChange((key) => { if (key === 'main.tabs') changed(); }), view.on('visible', changed)];
    return () => offs.forEach((off) => off());
  };
  const stop = onChange(() => {}); // the memo's own, first, so no listener reads a stale set
  return { set: () => (memo ??= new Set(interestSet(layout.get('main.tabs'), view.visibleSessions(), local))), onChange, stop };
}

export interface InterestDeps {
  sessions(): Iterable<AppSessionId>; // the set now (the app's interest)
  onChange(listener: () => void): () => void; // `main.tabs` written, or a session's visibility changed
  streaming(): boolean;
  onStreaming(listener: () => void): () => void;
  dispatch(input: CommandInput<'host.interest'>): Promise<CommandResult<'host.interest'>>;
}

export function startInterest(deps: InterestDeps): () => void {
  let sent: string | null = null; // the set the host now streaming last accepted (or is being sent), joined
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  const send = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (stopped || !deps.streaming()) return;
    const sessions = [...new Set(deps.sessions())].sort();
    const key = sessions.join('\n');
    if (key === sent) return;
    sent = key;
    const failed = (error: unknown) => {
      if (sent === key) sent = null; // sent again at the next change
      console.warn('[sessions] host.interest failed', error);
    };
    deps.dispatch({ sessions }).then((result) => {
      if (!result.ok) failed(result.error);
    }, failed);
  };
  const offs = [
    deps.onChange(() => {
      timer ??= setTimeout(send, INTEREST_COALESCE_MS);
    }),
    deps.onStreaming(() => {
      sent = null;
      send();
    }),
  ];
  send();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    timer = null;
    offs.forEach((off) => off());
  };
}
