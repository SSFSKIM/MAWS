// "+ Session" on another machine, main's side of its attempts (P5 O7 M4, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md,
// "`session.spawn`"; M4c fix wave 2, the architect's rulings). A spawn is a `machine` act, stepped up, claimed under an
// opId the act table queries until it settles. One New chat tab's spawn is one attempt, kept by the tab it is made from
// (the invoke envelope's `session`, the tab's bare id: main outlives a reload of the page, and the tab keeps its id):
//
// - While the attempt is out, the tab's next ask (Check again, or Send) awaits that same act, whatever its input: never a
//   second act, so never a second session. Another tab's spawn is its own attempt, however alike its input.
// - An outcome no caller was waiting for is kept as a small tombstone (the answer alone; the act and its input let go)
//   until the tab reads it or `tombstoneMs` passes, so a late outcome is still said to the tab that asked.
// - A terminal `unknown` (the op expired, the link that carried it ended) is not a pending start: it is said as such
//   ("couldn't confirm"), and only the tab's deliberate next Send, after that answer, makes a new act.
// - The machine's link replaced, or the adapter stopped, its attempts end as `unknown` tombstones, their acts let go.
import { ipcError } from '@shared/ipc/errors';
import type { CommandName, CommandResult } from '@shared/ipc/schema';
import type { MachineRef } from '@shared/machine/ref';
import type { ActHandle, ActOutcome, RemoteLink } from '../machines/remote/link';
import { outcomeAsResult, pendingResult } from './remote-outcomes';

type Fields = Record<string, unknown>;

/** Main's words for a spawn whose outcome can't be known: the person checks the machine before starting again. */
export const SPAWN_UNKNOWN_WORDS = (machine: string): string => `Couldn’t confirm whether it started on ${machine}; check ${machine}’s sessions before starting again`;

type Attempt =
  | { machine: MachineRef; name: string; link: RemoteLink; state: 'out'; handle: ActHandle; waiting: number }
  | { machine: MachineRef; state: 'said'; result: CommandResult<CommandName>; until: number; of: ActHandle }; // `of`: the act it ended

export interface SpawnAttemptsDeps {
  now(): number;
  log(line: string): void;
  pendingMs: number; // the answer's bound from the moment the act went out (the sheet's time is the person's)
  tombstoneMs: number; // how long an outcome nobody waited for is kept for its tab
  bounded(handle: ActHandle, deadline: number): Promise<ActOutcome | 'pending'>;
}

export interface SpawnAttempts {
  spawn(link: RemoteLink, fields: Fields, from: string | undefined): Promise<CommandResult<CommandName>>;
  /** The links changed: an attempt whose machine's link is no longer the one it went out on ends `unknown`, its act let go. */
  linksChanged(current: (machine: MachineRef) => RemoteLink | null): void;
  stop(): void;
  /** What is kept, by attempt (tests): an act out, or a tombstone. */
  kept(): Array<{ key: string; state: 'out' | 'said' }>;
}

export function createSpawnAttempts(deps: SpawnAttemptsDeps): SpawnAttempts {
  const attempts = new Map<string, Attempt>();

  const resultOf = (machine: string, outcome: ActOutcome): CommandResult<CommandName> =>
    outcome.state === 'unknown' ? { ok: false, error: ipcError('internal', SPAWN_UNKNOWN_WORDS(machine), { refusal: 'unknown' }) } : outcomeAsResult('session.spawn', machine, outcome);

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

  async function answer(link: RemoteLink, key: string, attempt: Extract<Attempt, { state: 'out' }>, what: string): Promise<CommandResult<CommandName>> {
    attempt.waiting += 1;
    let outcome: ActOutcome | 'pending';
    try {
      outcome = await deps.bounded(attempt.handle, deps.now() + deps.pendingMs);
    } finally {
      attempt.waiting -= 1;
    }
    if (outcome === 'pending') {
      deps.log(`lane B: session.spawn on ${link.name}/${what} (${attempt.handle.opId}) unconfirmed at the pending bound; kept for its tab`);
      return pendingResult('session.spawn', link.name);
    }
    const current = attempts.get(key);
    if (current === attempt || (current?.state === 'said' && current.of === attempt.handle)) attempts.delete(key); // said to its tab
    return resultOf(link.name, outcome);
  }

  return {
    async spawn(link, fields, from) {
      sweep();
      const what = String(fields.checkout ?? '');
      if (from === undefined) {
        // no tab named: one act, answered at its outcome or the bound, nothing kept
        const handle = link.act({ action: 'session.spawn', args: fields, executor: 'machine', stepUp: 'required' });
        await sent(handle);
        const outcome = await deps.bounded(handle, deps.now() + deps.pendingMs);
        return outcome === 'pending' ? pendingResult('session.spawn', link.name) : resultOf(link.name, outcome);
      }
      const key = `${link.machine}\n${from}`;
      const kept = attempts.get(key);
      if (kept?.state === 'said') {
        attempts.delete(key);
        return kept.result;
      }
      if (kept?.state === 'out') return answer(link, key, kept, what);
      const handle = link.act({ action: 'session.spawn', args: fields, executor: 'machine', stepUp: 'required' });
      const attempt: Extract<Attempt, { state: 'out' }> = { machine: link.machine, name: link.name, link, state: 'out', handle, waiting: 1 };
      attempts.set(key, attempt);
      // an outcome nobody waits for becomes its tombstone: the answer alone, the act let go
      void handle.outcome.then((outcome) => {
        if (attempts.get(key) !== attempt || attempt.waiting > 0) return;
        deps.log(`lane B: session.spawn on ${link.name}/${what} (${handle.opId}) settled late: ${outcome.state}${'reason' in outcome ? ` ${outcome.reason}` : ''}; kept for its tab`);
        attempts.set(key, { machine: link.machine, state: 'said', result: resultOf(link.name, outcome), until: deps.now() + deps.tombstoneMs, of: handle });
      });
      try {
        await sent(handle);
      } finally {
        attempt.waiting -= 1;
      }
      return answer(link, key, attempt, what);
    },
    linksChanged(current) {
      for (const [key, attempt] of attempts) {
        if (attempt.state !== 'out' || current(attempt.machine) === attempt.link) continue;
        attempts.set(key, { machine: attempt.machine, state: 'said', result: { ok: false, error: ipcError('internal', SPAWN_UNKNOWN_WORDS(attempt.name), { refusal: 'unknown' }) }, until: deps.now() + deps.tombstoneMs, of: attempt.handle });
      }
    },
    stop() {
      attempts.clear();
    },
    kept: () => [...attempts].map(([key, attempt]) => ({ key, state: attempt.state })),
  };
}
