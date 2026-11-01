// "+ Session" on another machine, main's side of its attempts (P5 O7 M4, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md,
// "`session.spawn`"; M4c fix wave 2 and the milestone review, the architect's rulings). A spawn is a `machine` act,
// stepped up, claimed under an opId the act table queries until it settles. One attempt is kept per attempt key: the
// invoke envelope's `session` for a spawn, which the renderer fills with the New chat tab's bare id, or `<tab>~<n>` once
// the person chose to start anew (an attempt key only: it never reaches the machine, an op or a log line as a session).
// Main outlives a reload of the page, and the key outlives it too.
//
// - While the attempt is out, the next ask under its key (Check again, or Send) awaits that same act, whatever its input:
//   never a second act, so never a second session. Another key's spawn is its own attempt, however alike its input.
// - An answer is consumed only by a page still there to take it: a waiter whose page went (a reload, a closed window:
//   its `ClientRef` ended) leaves the outcome kept for the key, as is one nobody waited for. What is kept is a small
//   tombstone (the answer, and for an `unknown` the op it came from), the act let go, until the key's next ask reads it
//   or `tombstoneMs` passes.
// - `unknown` (the op expired, the link that carried it ended, the ledger couldn't say) is never a pending start, and
//   never the end of the attempt: the machine's ledger may record the outcome later (an engine host adopted across a
//   restart), so each ask under the key queries the same op again (`RemoteLink.requery`), answered the real outcome once
//   there is one. Only a new key (the person's explicit "Start a new session") makes a new act.
// - The machine's link replaced: an attempt out on the old link is kept `unknown` with its op (asked again on the next
//   link). The adapter stopped: nothing is kept.
import type { Executor } from 'org-protocol';
import type { ClientRef } from '@shared/ipc/client';
import { ipcError } from '@shared/ipc/errors';
import type { CommandName, CommandResult } from '@shared/ipc/schema';
import type { MachineRef } from '@shared/machine/ref';
import type { ActHandle, ActOutcome, RemoteLink } from '../machines/remote/link';
import { outcomeAsResult, pendingResult } from './remote-outcomes';

type Fields = Record<string, unknown>;
type Op = { opId: string; opCreated: string; executor: Executor };

/** Main's words for a spawn whose outcome can't be known yet: the person checks again, or checks the machine. */
export const SPAWN_UNKNOWN_WORDS = (machine: string): string => `Couldn’t confirm whether it started on ${machine}; check again, or check ${machine}’s sessions`;

const EXECUTOR: Executor = 'machine';

type Out = { machine: MachineRef; name: string; link: RemoteLink; state: 'out'; handle: ActHandle; op: Op; waiting: number };
type Said = { machine: MachineRef; state: 'said'; result: CommandResult<CommandName>; until: number; of: ActHandle; op: Op | null }; // `op`: an unknown's, asked again
type Attempt = Out | Said;

export interface SpawnAttemptsDeps {
  now(): number;
  log(line: string): void;
  pendingMs: number; // the answer's bound from the moment the act went out (the sheet's time is the person's)
  tombstoneMs: number; // how long an answer not yet taken is kept for its key
  bounded(handle: ActHandle, deadline: number): Promise<ActOutcome | 'pending'>;
}

export interface SpawnAttempts {
  /** `from`: the attempt key (the envelope's session); `client`: the page asking, whose end leaves the answer kept. */
  spawn(link: RemoteLink, fields: Fields, from: string | undefined, client: ClientRef): Promise<CommandResult<CommandName>>;
  /** The links changed: an attempt out on a link that is no longer its machine's is kept `unknown`, with its op. */
  linksChanged(current: (machine: MachineRef) => RemoteLink | null): void;
  stop(): void;
  /** What is kept, by key (tests): an act out, or a tombstone. */
  kept(): Array<{ key: string; state: 'out' | 'said' }>;
}

const unknownResult = (machine: string): CommandResult<CommandName> => ({ ok: false, error: ipcError('internal', SPAWN_UNKNOWN_WORDS(machine), { refusal: 'unknown' }) });
const isGone = (client: ClientRef): boolean => {
  let gone = false;
  client.onGone(() => (gone = true))(); // runs at once for a page already gone
  return gone;
};

export function createSpawnAttempts(deps: SpawnAttemptsDeps): SpawnAttempts {
  const attempts = new Map<string, Attempt>();

  const resultOf = (machine: string, outcome: ActOutcome): CommandResult<CommandName> => (outcome.state === 'unknown' ? unknownResult(machine) : outcomeAsResult('session.spawn', machine, outcome));
  const tombstone = (attempt: Out, outcome: ActOutcome): Said => ({
    machine: attempt.machine,
    state: 'said',
    result: resultOf(attempt.name, outcome),
    until: deps.now() + deps.tombstoneMs,
    of: attempt.handle,
    op: outcome.state === 'unknown' ? attempt.op : null,
  });

  const sweep = () => {
    const now = deps.now();
    for (const [key, attempt] of attempts) if (attempt.state === 'said' && attempt.until <= now) attempts.delete(key);
  };

  /** Its act out, until the person's confirmation sends it (the sheet and Touch ID are theirs, not the machine's). */
  const sent = (handle: ActHandle) =>
    new Promise<void>((resolve) => {
      if (handle.progress() !== 'waiting') return resolve();
      const off = handle.onProgress((progress) => {
        if (progress === 'waiting') return;
        off();
        resolve();
      });
      void handle.outcome.then(() => (off(), resolve()));
    });

  /** The attempt out under `key`: an outcome nobody waits for becomes its tombstone. */
  function track(key: string, link: RemoteLink, handle: ActHandle, op: Op, waiting: number): Out {
    const attempt: Out = { machine: link.machine, name: link.name, link, state: 'out', handle, op, waiting };
    attempts.set(key, attempt);
    void handle.outcome.then((outcome) => {
      if (attempts.get(key) !== attempt || attempt.waiting > 0) return;
      deps.log(`lane B: session.spawn on ${link.name} (${handle.opId}) settled with nobody waiting: ${outcome.state}${'reason' in outcome ? ` ${outcome.reason}` : ''}; kept`);
      attempts.set(key, tombstone(attempt, outcome));
    });
    return attempt;
  }

  async function answer(link: RemoteLink, key: string, attempt: Out, client: ClientRef): Promise<CommandResult<CommandName>> {
    attempt.waiting += 1;
    let gone = false;
    const off = client.onGone(() => (gone = true));
    let outcome: ActOutcome | 'pending';
    try {
      outcome = await deps.bounded(attempt.handle, deps.now() + deps.pendingMs);
    } finally {
      attempt.waiting -= 1;
      off();
    }
    if (outcome === 'pending') {
      deps.log(`lane B: session.spawn on ${link.name} (${attempt.handle.opId}) unconfirmed at the pending bound; kept`);
      return pendingResult('session.spawn', link.name);
    }
    const current = attempts.get(key);
    // Taken only by a page still there, and never an unknown: that stays, its op asked again at the next ask.
    if (current === attempt) {
      if (gone || outcome.state === 'unknown') attempts.set(key, tombstone(attempt, outcome));
      else attempts.delete(key);
    } else if (current?.state === 'said' && current.of === attempt.handle && !gone && outcome.state !== 'unknown') attempts.delete(key);
    return resultOf(link.name, outcome);
  }

  return {
    async spawn(link, fields, from, client) {
      sweep();
      if (from === undefined) {
        // no attempt key: one act, answered at its outcome or the bound, nothing kept
        const handle = link.act({ action: 'session.spawn', args: fields, executor: EXECUTOR, stepUp: 'required' });
        await sent(handle);
        const outcome = await deps.bounded(handle, deps.now() + deps.pendingMs);
        return outcome === 'pending' ? pendingResult('session.spawn', link.name) : resultOf(link.name, outcome);
      }
      const key = `${link.machine}\n${from}`;
      const kept = attempts.get(key);
      if (kept?.state === 'out') return answer(link, key, kept, client);
      // an unknown: its op asked again (the ledger may have recorded the outcome since), never a new act
      if (kept?.state === 'said' && kept.op !== null) return answer(link, key, track(key, link, link.requery(kept.op), kept.op, 0), client);
      if (kept?.state === 'said') {
        if (!isGone(client)) attempts.delete(key); // read by a page that is there
        return kept.result;
      }
      const handle = link.act({ action: 'session.spawn', args: fields, executor: EXECUTOR, stepUp: 'required' });
      const attempt = track(key, link, handle, { opId: handle.opId, opCreated: handle.opCreated, executor: EXECUTOR }, 1);
      try {
        await sent(handle);
      } finally {
        attempt.waiting -= 1;
      }
      return answer(link, key, attempt, client);
    },
    linksChanged(current) {
      for (const [key, attempt] of attempts) {
        if (attempt.state !== 'out' || current(attempt.machine) === attempt.link) continue;
        attempts.set(key, { machine: attempt.machine, state: 'said', result: unknownResult(attempt.name), until: deps.now() + deps.tombstoneMs, of: attempt.handle, op: attempt.op });
      }
    },
    stop() {
      attempts.clear();
    },
    kept: () => [...attempts].map(([key, attempt]) => ({ key, state: attempt.state })),
  };
}
