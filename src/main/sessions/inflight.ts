// P2-A (2026-10-09; X16, the execution document §5.3): the session service's in-flight registry. Every lifecycle run that
// can launch an engine for an app id (an acquisition, a record's `session.start`, an intent's setup, a take-over)
// registers here synchronously, before its first await: that tick is the linearization point of "one launch per
// session", so a later acquisition joins the run instead of launching a second engine or being refused `starting`.
// An entry answers twice: `guarded`, the `StartOutcome` its guards gave (what a joining record `session.start` answers),
// and `done`, the `AcquireOutcome` at the run's end (ready, after a start's first message went to the host, or its
// failure), when the entry goes. Main's memory only (D-16).
import type { AppSessionId } from '@shared/graph/ids';
import type { StartOptions } from '@shared/ipc/schema/session';
import type { AcquireOutcome, SetupEvent, StartOutcome } from '@shared/sessions/setup';
import type { Setup } from './setup-steps';

export type InflightKind = 'acquire' | 'record-start' | 'setup' | 'take-over';

export interface Inflight {
  readonly kind: InflightKind;
  readonly options: string; // canonical JSON of the run's start options (`{}` for none): equal options join
  readonly guarded: Promise<StartOutcome>;
  readonly done: Promise<AcquireOutcome>;
}

// What the run that opened an entry settles it with. `guard` is idempotent; `end` resolves `guarded` too when the run
// ended before its guards answered (a refusal in the run's words), removes the entry, then settles `done`.
export interface Registration {
  readonly entry: Inflight;
  guard(outcome: StartOutcome): void;
  end(result: { outcome: AcquireOutcome } | { error: unknown }): void;
}

export class InflightRegistry {
  private readonly entries = new Map<AppSessionId, Inflight>();

  // `changed` runs after every registration and removal (the service publishes the id's memory there).
  constructor(private readonly changed: (appSessionId: AppSessionId) => void) {}

  get(appSessionId: AppSessionId): Inflight | undefined {
    return this.entries.get(appSessionId);
  }

  has(appSessionId: AppSessionId): boolean {
    return this.entries.has(appSessionId);
  }

  open(appSessionId: AppSessionId, kind: InflightKind, options: StartOptions = {}): Registration {
    const guarded = settleable<StartOutcome>();
    const done = settleable<AcquireOutcome>();
    const entry: Inflight = { kind, options: canonicalOptions(options), guarded: guarded.promise, done: done.promise };
    this.entries.set(appSessionId, entry);
    this.changed(appSessionId);
    let ended = false;
    return {
      entry,
      guard: guarded.resolve,
      end: (result) => {
        if (ended) return;
        ended = true;
        if ('error' in result) guarded.reject(result.error);
        else guarded.resolve(endedBeforeGuards(appSessionId, result.outcome));
        if (this.entries.get(appSessionId) === entry) {
          this.entries.delete(appSessionId);
          this.changed(appSessionId);
        }
        if ('error' in result) done.reject(result.error);
        else done.resolve(result.outcome);
      },
    };
  }
}

// The answer a joining start gets from a run that ended before its guards answered: the run's own refusal when it has
// that shape, else `refused` (busy) in the run's words.
function endedBeforeGuards(appSessionId: AppSessionId, outcome: AcquireOutcome): StartOutcome {
  if (outcome.status === 'ready') return { status: 'already_live', appSessionId };
  if (outcome.status === 'failed') return { status: 'refused', appSessionId, reason: 'busy', message: outcome.message };
  return outcome;
}

// One promise that never goes unhandled: a rejection nobody joined is not an error of its own.
function settleable<T>(): { promise: Promise<T>; resolve(value: T): void; reject(error: unknown): void } {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  promise.catch(() => {});
  return { promise, resolve, reject };
}

export function canonicalOptions(options: StartOptions): string {
  return JSON.stringify(Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined).sort(([a], [b]) => a.localeCompare(b))));
}

// The setup's end, as an acquisition answers it.
export function acquireOutcomeOf(appSessionId: AppSessionId, outcome: SetupEvent['outcome']): AcquireOutcome {
  switch (outcome?.kind) {
    case 'ready':
      return { status: 'ready', appSessionId, launched: true, joined: false };
    case 'relay_unreachable':
      return { status: 'relay_unreachable', appSessionId, health: outcome.health };
    case 'held':
      return { status: 'held', appSessionId, holder: outcome.holder, attach: outcome.attach };
    case 'error':
      return { status: 'failed', appSessionId, message: outcome.message, resources: outcome.resources };
    default:
      return { status: 'failed', appSessionId, message: 'MAWS could not tell how the start ended.', resources: { worktree: null, record: 'kept', transcript: 'none' } };
  }
}

// A guard's answer that ran nothing, as an acquisition answers it (`already_live` is ready, launched by someone else;
// `starting` never comes without a run).
export function acquireOutcomeOfGuard(outcome: StartOutcome): AcquireOutcome {
  if (outcome.status === 'already_live' || outcome.status === 'starting') return { status: 'ready', appSessionId: outcome.appSessionId, launched: false, joined: false };
  return outcome;
}

// The setup with its `emit` wrapped to keep the id's last end (`ready` or `failed`) as it streams (the take-over's pattern).
export function capturingSetup(s: Setup, appSessionId: AppSessionId): { setup: Setup; outcome(): SetupEvent['outcome'] } {
  let last: SetupEvent['outcome'] = null;
  const setup: Setup = {
    ...s,
    emit: (name, payload) => {
      if (name === 'session.setup') {
        const event = payload as SetupEvent;
        if (event.appSessionId === appSessionId && (event.phase === 'ready' || event.phase === 'failed')) last = event.outcome;
      }
      return s.emit(name, payload);
    },
  };
  return { setup, outcome: () => last };
}
