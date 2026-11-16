// What this window last read of the to-human mod's file of fold summaries, per session, and when it reads it (UX wave
// U2b; the execution document, Interfaces §M, "The reads"; decisions 29 and 32). The owner service reads the file
// (`ownerChannel.folds`, src/services/owner/folds.ts); the window asks it on a fixed round, since the summary of a
// stretch is made by the mod after the stretch closes and no event says it was written:
//
// - a round is a read 3, 8, 20 and 45 seconds after it starts, whatever an earlier read of it answered; a mount of a
//   session's view reads once at once and starts a round, as does each close of a stretch and each end of a turn
//   (`foldsMoved`); each return of the window's focus reads once each key a view mounts;
// - one read is out for a key at a time: reads that fall due while one is out are sent as one when it answers;
// - a successful read is taken whole (fewer runs than before among it: the mod rewrote or removed its file); a read
//   that fails, or answers `runs: null` (the file unreadable), changes nothing;
// - an answer for a key with no mount left, or older than a read sent after it, is dropped; the last mount's going
//   cancels the key's timers;
// - a daemon that does not know the command (`unknown_command`) or refuses it (an older build's `not-offered`) stops
//   the key for the window's life.
//
// Only this machine's sessions are read: the slot enables the reads for no other (test/lane-b/renderer-guards.test.ts
// lists this file among those guarded elsewhere). The runs are held after the last mount goes, so a view mounted again
// draws the summaries it had at once, while its own round reads them again.
import { useEffect } from 'react';
import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import type { StoredRun } from '@shared/owner/folds';
import { ipc } from '../ipc/client';
import type { TurnState } from '../transcript/model/reduce';
import type { Row, TurnId } from '../transcript/model/rows';

/** A round's reads, in milliseconds after it starts (decision 29). */
export const ROUND_AFTER_MS: readonly number[] = [3_000, 8_000, 20_000, 45_000];

export interface FoldReadsState {
  runs: ReadonlyMap<AppSessionId, readonly StoredRun[]>;
}

export interface FoldReads {
  store: StoreApi<FoldReadsState>;
  /** A view of the session mounts: one read at once, then a round. The disposer releases the mount. */
  mount(appSessionId: AppSessionId): () => void;
  /** A stretch of the session closed or its turn ended: a round, for a key a view mounts. */
  round(appSessionId: AppSessionId): void;
  /** Every key's timers cancelled and its answers dropped, the runs forgotten (tests). */
  reset(): void;
}

export interface FoldReadsDeps {
  client?: MawsBridge;
  /** Runs `task` after `ms`; the answer cancels it. */
  after?: (ms: number, task: () => void) => () => void;
  /** Hears each return of the window's focus; the answer stops listening. */
  onFocus?: (listener: () => void) => () => void;
}

const afterTimeout = (ms: number, task: () => void) => {
  const timer = setTimeout(task, ms);
  return () => clearTimeout(timer);
};
const onWindowFocus = (listener: () => void) => {
  window.addEventListener('focus', listener);
  return () => window.removeEventListener('focus', listener);
};

interface Key {
  mounts: number;
  sent: number; // the reads sent; an answer stands only if it answers the last one, so a key's reads are taken in order
  out: boolean; // a read is out
  due: boolean; // a read fell due while one was out
  timers: Set<() => void>;
}

export function createFoldReads({ client = ipc, after = afterTimeout, onFocus = onWindowFocus }: FoldReadsDeps = {}): FoldReads {
  const store = createStore<FoldReadsState>()(() => ({ runs: new Map() }));
  const keys = new Map<AppSessionId, Key>();
  const stopped = new Set<AppSessionId>(); // refused for the window's life
  let offFocus: (() => void) | null = null;

  const keyOf = (appSessionId: AppSessionId): Key => {
    let key = keys.get(appSessionId);
    if (key === undefined) keys.set(appSessionId, (key = { mounts: 0, sent: 0, out: false, due: false, timers: new Set() }));
    return key;
  };
  const cancel = (key: Key) => {
    for (const off of key.timers) off();
    key.timers.clear();
  };
  const settle = (key: Key) => {
    cancel(key);
    key.sent += 1; // drops the answer of a read still out
    key.out = false;
    key.due = false;
  };

  const read = (appSessionId: AppSessionId) => {
    const key = keys.get(appSessionId);
    if (key === undefined || key.mounts === 0 || stopped.has(appSessionId)) return;
    if (key.out) {
      key.due = true;
      return;
    }
    key.out = true;
    const asked = ++key.sent;
    void client.invoke('ownerChannel.folds', { appSessionId }).then((result) => {
      if (asked !== key.sent) return;
      key.out = false;
      if (result.ok) {
        const { runs } = result.value;
        if (runs !== null) store.setState((s) => ({ runs: new Map(s.runs).set(appSessionId, runs) }));
      } else if (result.error.code === 'unknown_command' || refused(result.error.issues)) {
        stopped.add(appSessionId);
        settle(key);
        return;
      }
      if (key.due) {
        key.due = false;
        read(appSessionId);
      }
    });
  };

  const round = (appSessionId: AppSessionId) => {
    const key = keys.get(appSessionId);
    if (key === undefined || key.mounts === 0 || stopped.has(appSessionId)) return;
    for (const ms of ROUND_AFTER_MS) {
      const off = after(ms, () => {
        key.timers.delete(off);
        read(appSessionId);
      });
      key.timers.add(off);
    }
  };

  const focused = () => {
    for (const [appSessionId, key] of keys) if (key.mounts > 0) read(appSessionId);
  };

  return {
    store,
    mount(appSessionId) {
      const key = keyOf(appSessionId);
      key.mounts += 1;
      offFocus ??= onFocus(focused);
      read(appSessionId);
      round(appSessionId);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        key.mounts -= 1;
        if (key.mounts > 0) return;
        settle(key);
        if ([...keys.values()].every((each) => each.mounts === 0)) {
          offFocus?.();
          offFocus = null;
        }
      };
    },
    round,
    reset() {
      for (const key of keys.values()) settle(key);
      keys.clear();
      stopped.clear();
      offFocus?.();
      offFocus = null;
      store.setState({ runs: new Map() });
    },
  };
}

// A refusal of the command for the key (an older build's `not-offered`, a remote route's), which a later read gets too.
const refused = (issues: unknown): boolean => typeof issues === 'object' && issues !== null && (issues as { refusal?: unknown }).refusal != null;

/** The window's reads. */
export const foldReads = createFoldReads();

/** A stretch of the session closed, or its turn ended: a round of reads, if a view of it is mounted. */
export const foldsMoved = (appSessionId: AppSessionId): void => foldReads.round(appSessionId);

/**
 * The runs the window holds for the session while `enabled` (a mirror is drawn on it, decision 32): the view's mount of
 * the reads, which end when it turns false or the key changes. Undefined until a read answers, and while not enabled.
 */
export function useStoredFolds(appSessionId: AppSessionId | null, enabled: boolean, reads: FoldReads = foldReads): readonly StoredRun[] | undefined {
  const on = enabled && appSessionId !== null;
  useEffect(() => (on ? reads.mount(appSessionId) : undefined), [on, appSessionId, reads]);
  return useStore(reads.store, (s) => (on ? s.runs.get(appSessionId) : undefined));
}

// MAWS's own lines, and a prompt not yet taken: none of them is a row the person reads after a stretch's work.
const UNREAD = new Set<Row['kind']>(['time', 'divider', 'receipt', 'record_fold']);

/**
 * Whether a row the person reads stands after the drawn rows' last record line: the stretch that line folds has closed
 * (a message or a prompt came after its work). The view starts a round of reads when this turns true.
 */
export function lastStretchClosed(drawn: readonly Row[]): boolean {
  const at = drawn.findLastIndex((row) => row.kind === 'record_fold');
  if (at < 0) return false;
  return drawn.slice(at + 1).some((row) => !UNREAD.has(row.kind) && !(row.kind === 'user' && row.pending !== undefined));
}

/**
 * The moments at which the mod asks for a summary, as the view shows them: each stretch closed, by its key; each turn
 * closed, by its id; each turn started and still open, by its id; and whether one runs.
 */
export interface FoldMoments {
  closed: readonly string[];
  ended: readonly TurnId[];
  started: readonly TurnId[];
  working: boolean;
}

/**
 * The stretches the drawn rows show closed (`drawn`: the mirror's output), and the turns read from their own state,
 * since a turn of text alone draws no turn line (fix wave 2). Every record line's stretch has closed but the last one's,
 * which has closed once a row the person reads stands after it (`lastStretchClosed`). `ended`: the turns whose state is
 * closed. `started`: the turns open and started (`accepted`), which end, as the view tells it, once none runs; a prompt
 * queued behind the running turn has its own turn, open and not yet started, and is in neither (fix wave 3).
 */
export function foldMoments(drawn: readonly Row[], turns: ReadonlyMap<TurnId, TurnState> | undefined, working: boolean): FoldMoments {
  const lines = drawn.flatMap((row) => (row.kind === 'record_fold' ? [row.stretch] : []));
  const closed = lastStretchClosed(drawn) ? lines : lines.slice(0, -1);
  const ended: TurnId[] = [];
  const started: TurnId[] = [];
  for (const turn of turns?.values() ?? []) {
    if (turn.state === 'closed') ended.push(turn.id);
    else if (turn.accepted) started.push(turn.id);
  }
  return { closed, ended, started, working };
}

/**
 * Watches the moments a view shows, change by change: true when a stretch has closed or a turn has ended that had not
 * before (several in one change answer true once). The first moments it is shown are what was already so, and answer
 * false (the mount's own round reads them): its turns closed, and its started turns too while none runs. After them, a
 * started turn has ended under "none runs" only if this watch saw it open while one ran (`ran`; fix wave 4): whether one
 * runs can be another channel's word than the turns' state (a bridge's port, `atRest`), so a turn whose start reaches
 * the view while the port still says none runs has not ended at its start.
 */
export function momentWatch(): (moments: FoldMoments) => boolean {
  let seen: { closed: Set<string>; ended: Set<TurnId> } | null = null;
  const ran = new Set<TurnId>();
  return ({ closed, ended, started, working }) => {
    if (working) for (const id of started) ran.add(id);
    if (seen === null) {
      seen = { closed: new Set(closed), ended: new Set([...ended, ...(working ? [] : started)]) };
      return false;
    }
    const before = seen.closed.size + seen.ended.size;
    for (const key of closed) seen.closed.add(key);
    for (const id of ended) seen.ended.add(id);
    if (!working) for (const id of started) if (ran.has(id)) seen.ended.add(id);
    return seen.closed.size + seen.ended.size > before;
  };
}
