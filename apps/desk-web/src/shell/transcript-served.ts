// Whether a session's machine serves its transcript, as the session's own subscription told the desk (DX4): rows say it
// does; an `end {session-ended}` before any snapshot says it holds none. Resume is offered only once it is known
// to (`conversation/capabilities.ts`): `claude --bg --resume` of a session its machine holds no transcript of starts an
// empty session (the owner's desk, 2026-10-19: a `--bg` copy that took a seat's name was resumed into nothing). It is
// known while a view holds the session's owner, which learns it and forgets it at its last release
// (`depth/owner/session-owner.ts`); kept here, apart from the session view's chunk, so the channel's header reads it
// without loading that chunk.
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

/** `served`: the subscription holds rows of it; `none`: the machine answered that it holds no transcript of the session. */
export type TranscriptServed = 'served' | 'none';

type Session = { project: string; machine: string; session: string };
/** What the owner that learned it (`by`) last learned of each session. */
const known = createStore<Record<string, { by: object; served: TranscriptServed }>>(() => ({}));
const keyOf = (s: Session) => `${s.project}\u0000${s.machine}\u0000${s.session}`;

/**
 * What `by`, the session's owner, learned of it; null forgets it. A forget from an owner that is no longer the one that
 * last told is ignored, so an older owner living out its holds never erases what the current one knows.
 */
export function learnServed(session: Session, by: object, served: TranscriptServed | null): void {
  const key = keyOf(session);
  known.setState((all) => {
    if (served !== null) return all[key]?.by === by && all[key].served === served ? all : { ...all, [key]: { by, served } };
    if (all[key]?.by !== by) return all;
    const rest = { ...all };
    delete rest[key];
    return rest;
  }, true);
}

export function transcriptServed(session: Session): TranscriptServed | null {
  return known.getState()[keyOf(session)]?.served ?? null;
}

/** Whether the session's machine serves its transcript; null while no view's subscription has said. */
export function useTranscriptServed(session: Session): TranscriptServed | null {
  return useStore(known, (all) => all[keyOf(session)]?.served ?? null);
}
