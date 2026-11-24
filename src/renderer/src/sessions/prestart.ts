// The composer's prestart of a New chat's engine (ticket 851, M3; docs/doperpowers/plans/2026-11-24-prestart-engine.md,
// D8, D10). While a person types in an unstarted New chat that starts on this machine, the composer asks its spine to
// start the engine Send would launch (`session.intent.prestart`), so Send finds it initialized. The leading edge of the
// first edit that leaves the box non-empty asks at once (a typing pause, which the draft's save waits for, is not waited
// for); after that at most once every 10 s while it stays non-empty, so a prestart the host ended comes back with the
// next keystroke. Each answer that started or found one carries a token; a tab that moves to another machine withdraws by
// it (`session.intent.prestart.withdraw`) and keeps its draft. An older spine refuses both commands, which reads as
// skipped: nothing is shown either way.
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';

export const PRESTART_EVERY_MS = 10_000;

// Per tab: when it last asked (null: the next edit asks at once), the token of the prestart serving it, and the count of
// its moves away from this machine, so an answer that crosses a move is withdrawn when it lands.
interface Tab {
  last: number | null;
  token: string | null;
  moves: number;
}
const tabs = new Map<AppSessionId, Tab>();
const tabOf = (tab: AppSessionId): Tab => tabs.get(tab) ?? tabs.set(tab, { last: null, token: null, moves: 0 }).get(tab)!;

export const resetPrestarts = (): void => tabs.clear(); // for suites

/** An edit of an unstarted New chat's box that starts on this machine: asks for its prestart when one is due. */
export function notePrestartEdit(tab: AppSessionId, doc: { empty: boolean }, client: MawsBridge, now = Date.now()): void {
  if (doc.empty) return;
  const state = tabOf(tab);
  if (state.last !== null && now - state.last < PRESTART_EVERY_MS) return;
  state.last = now;
  const moves = state.moves;
  void client.invoke('session.intent.prestart', { appSessionId: tab }).then(
    (answer) => {
      const token = answer.ok ? answer.value.token : null;
      if (state.moves === moves) state.token = token;
      else if (token !== null) withdraw(tab, token, client); // the tab moved away while this was asked
    },
    () => {}, // no answer: skipped
  );
}

/** The tab now starts on another machine: the prestart serving it goes; its draft stays as it is. */
export function leftThisMachine(tab: AppSessionId, client: MawsBridge): void {
  const state = tabs.get(tab);
  if (state === undefined) return;
  const token = state.token;
  state.moves += 1;
  state.token = null;
  state.last = null; // back on this machine, its next edit asks at once
  if (token !== null) withdraw(tab, token, client);
}

function withdraw(tab: AppSessionId, token: string, client: MawsBridge): void {
  void client.invoke('session.intent.prestart.withdraw', { appSessionId: tab, token }).catch(() => undefined);
}
