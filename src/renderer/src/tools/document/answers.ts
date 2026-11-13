// UX wave U5a (docs/doperpowers/plans/2026-11-12-ux-wave-U5a-comment-card.md, M7; decision 20, A17): when the agent's
// answer to a document comment arrives, read for one card host over one document. The answer arrives at the first of
// two signals: the comment's thread gains a message whose author is a session (an edit that names the thread, or a
// reply), or the turn of the side thread that host's card shows on the thread ends.
//
// One answer is told once. An answer usually gives both signals (a side thread that edits the passage, then ends its
// turn), in either order as the document and the session's digest reach the window: a message written inside a turn of
// the card's side thread (the turn running, or its start and end around the message's time) is that turn's answer, and
// the turn's end tells nothing more, nor the other way round. Which side thread a thread's card showed is remembered
// with what was told, so a message that arrives after its turn ended and its card closed (the fold at that end) is still
// that turn's. Both are kept per document, host and thread across the host's remounts (a tab switch, the margin moving
// the card), and a mount takes what the document already holds as read, so nothing that arrived before it, or while no
// overlay was mounted, is told.
import { listThreads, observeThreads, type Thread, type ThreadMessage } from '@artifacts/document/threads';
import type { Doc } from '@artifacts/yjs';
import type { AppSessionId } from '@shared/graph/ids';
import { useCommentCard } from '../../side/card/store';
import { useSessions } from '../../stores/sessions';

// per document, by `${hostId}\0${threadId}`: the answers told (`turn:<child>:<its start>` or `message:<id>`), and the
// side thread the host's card last showed on that thread
interface Memory {
  told: Map<string, Set<string>>;
  sides: Map<string, AppSessionId>;
}
const memories = new WeakMap<Doc, Memory>();

interface Followed {
  threadId: string;
  child: AppSessionId;
  ended: string | null; // the side thread's last turn end when it was last read
}

/** Calls `onAnswer(threadId)` once for each answer that arrives while it runs; returns the stop. */
export function watchAnswers(doc: Doc, hostId: string, onAnswer: (threadId: string) => void): () => void {
  const memory = memories.get(doc) ?? { told: new Map<string, Set<string>>(), sides: new Map<string, AppSessionId>() };
  memories.set(doc, memory);
  const placeOf = (threadId: string) => `${hostId}\u0000${threadId}`;
  const answer = (threadId: string, key: string) => {
    const place = placeOf(threadId);
    const keys = memory.told.get(place) ?? new Set<string>();
    memory.told.set(place, keys);
    if (keys.has(key)) return;
    keys.add(key);
    onAnswer(threadId);
  };

  // the side thread this host's card shows on a thread of the document, if it does
  let followed: Followed | null = null;
  const lastEnd = (child: AppSessionId) => useSessions.getState().digests.get(child)?.lastTurnEndedAt ?? null;
  const follow = () => {
    const { open } = useCommentCard.getState();
    const on = open?.hostId === hostId && open.phase.kind === 'thread' && open.target?.kind === 'artifact' ? { threadId: open.target.threadId, child: open.phase.child } : null;
    if (on === null) followed = null;
    else if (followed?.threadId !== on.threadId || followed.child !== on.child) {
      followed = { ...on, ended: lastEnd(on.child) };
      memory.sides.set(placeOf(on.threadId), on.child);
    }
  };
  const turnKey = (child: AppSessionId, startedAt: string) => `turn:${child}:${startedAt}`;
  // a session's message: the answer of the turn of the side thread a card showed on its thread (open or since closed)
  // that it was written in, else its own
  const keyOf = (threadId: string, message: ThreadMessage): string => {
    const child = memory.sides.get(placeOf(threadId));
    const digest = child === undefined ? undefined : useSessions.getState().digests.get(child);
    const start = digest?.turnStartedAt ?? null;
    if (child !== undefined && digest !== undefined && start !== null) {
      const running = digest.phase === 'working' || digest.phase === 'waiting';
      const end = digest.lastTurnEndedAt === null ? NaN : Date.parse(digest.lastTurnEndedAt);
      if (running || (message.at >= Date.parse(start) && message.at <= end)) return turnKey(child, start);
    }
    return `message:${message.id}`;
  };

  const messagesOf = (thread: Thread) => new Set(thread.messages.map((message) => message.id));
  const seen = new Map(listThreads(doc).map((thread) => [thread.id, messagesOf(thread)]));
  const read = () => {
    for (const thread of listThreads(doc)) {
      const known = seen.get(thread.id);
      if (known === undefined) {
        seen.set(thread.id, messagesOf(thread)); // a new thread (one an agent opened itself is no answer)
        continue;
      }
      for (const message of thread.messages) {
        if (known.has(message.id)) continue;
        known.add(message.id);
        if (message.by.kind === 'session') answer(thread.id, keyOf(thread.id, message));
      }
    }
  };
  const turnEnded = () => {
    follow();
    if (followed === null) return;
    const ended = lastEnd(followed.child);
    if (ended === null || ended === followed.ended) return;
    followed.ended = ended;
    const start = useSessions.getState().digests.get(followed.child)?.turnStartedAt ?? ended;
    answer(followed.threadId, turnKey(followed.child, start));
  };

  follow();
  const offThreads = observeThreads(doc, () => {
    follow();
    read();
  });
  const offCard = useCommentCard.subscribe(follow);
  const offSessions = useSessions.subscribe(turnEnded);
  return () => {
    offThreads();
    offCard();
    offSessions();
  };
}
