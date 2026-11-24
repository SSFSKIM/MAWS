// The composer's prestart of a New chat's engine (ticket 851, M3; docs/doperpowers/plans/2026-11-24-prestart-engine.md,
// D8, D10). While a person types in an unstarted New chat that starts on this machine, the composer asks its spine to
// start the engine Send would launch (`session.intent.prestart`), so Send finds it initialized. The leading edge of the
// first edit that leaves the box non-empty asks at once (a typing pause, which the draft's save waits for, is not waited
// for); after that at most once every 10 s while it stays non-empty, so a prestart the host ended comes back with the
// next keystroke. Each request carries a token the composer mints before it asks (M3's review, Decision Log 13), so a
// tab that moves to another machine withdraws what it sent (`session.intent.prestart.withdraw`) and keeps its draft,
// whether that request's answer came, comes late, crossed an older one's, or never comes (its caller's deadline passed
// while the spine still worked on it). The xhigh panel (scalpel-3, finding 6): a refresh still on its way may not have
// reached the spine when the tab moves, so the request before it may still be the spine's live one; the move withdraws
// every token sent since the last move that no later request's answer has superseded, the oldest first (the spine's few
// tombstones keep the newest). A request answered (whatever its status) reached the spine, which ended every earlier
// request of the tab there; answers change nothing else here. An older spine refuses both commands, which reads as
// skipped: nothing is shown either way.
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';

export const PRESTART_EVERY_MS = 10_000;
const TOKENS_KEPT = 4; // the tokens a move may withdraw, the newest kept (the spine keeps as many tombstones per intent)

// Per tab: when it last asked (null: the next edit asks at once), and the tokens sent since its last move that the spine
// may still hold as the tab's request, oldest first.
interface Tab {
  last: number | null;
  tokens: string[];
}
const tabs = new Map<AppSessionId, Tab>();
const tabOf = (tab: AppSessionId): Tab => tabs.get(tab) ?? tabs.set(tab, { last: null, tokens: [] }).get(tab)!;

export const resetPrestarts = (): void => tabs.clear(); // for suites

/** An edit of an unstarted New chat's box that starts on this machine: asks for its prestart when one is due. */
export function notePrestartEdit(tab: AppSessionId, doc: { empty: boolean }, client: MawsBridge, now = Date.now()): void {
  if (doc.empty) return;
  const state = tabOf(tab);
  if (state.last !== null && now - state.last < PRESTART_EVERY_MS) return;
  state.last = now;
  const token = crypto.randomUUID();
  state.tokens = [...state.tokens, token].slice(-TOKENS_KEPT);
  const reached = () => {
    const at = state.tokens.indexOf(token); // the request reached the spine: every earlier one of the tab ended there
    if (at > 0) state.tokens = state.tokens.slice(at);
  };
  void client.invoke('session.intent.prestart', { appSessionId: tab, token }).then((result) => (result.ok ? reached() : undefined), () => undefined); // no answer: skipped
}

/** The tab now starts on another machine: the prestart serving it goes; its draft stays as it is. */
export function leftThisMachine(tab: AppSessionId, client: MawsBridge): void {
  const state = tabs.get(tab);
  if (state === undefined) return;
  const tokens = state.tokens;
  state.tokens = [];
  state.last = null; // back on this machine, its next edit asks at once
  for (const token of tokens) void client.invoke('session.intent.prestart.withdraw', { appSessionId: tab, token }).catch(() => undefined);
}
