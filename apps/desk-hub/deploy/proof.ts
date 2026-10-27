// What every proof command (probe, fake-check, redeploy-check, measure, frame-cost) holds to, since each enrolls
// machines and registers a project, and a project and its events outlive the machine's revocation:
// - it runs only in a throwaway org, named with `--test-org`, never the configuration's own (`--config`'s), and only
//   while the deployment serves that org, checked before anything is enrolled or written;
// - it cleans up what it enrolled or minted, each step attempted whatever happened before, and fails when one fails;
//   a command run under `interruptible` does so however it ends, a SIGINT or SIGTERM included.
import { AsyncLocalStorage } from 'node:async_hooks';
import { checkTestTarget, type DeployConfig } from './config';
import { settledWithin, type Person } from './hub';

export const TEST_ORG_OPTION = { 'test-org': { type: 'string' } } as const;

/** The throwaway org a proof command was told to run in, or null (with why, on stderr). */
export function testOrgArg(value: string | undefined, ownersOrg: string): string | null {
  if (!value) {
    console.error('--test-org <id> is required: the throwaway org the deployment serves now (deploy --org-id <id> first)');
    return null;
  }
  if (value === ownersOrg) {
    console.error(`--test-org ${value} is the configuration's own org: the proofs run only in a throwaway org`);
    return null;
  }
  return value;
}

/** Refuses unless the deployment serves `org` now: the check every proof makes before its first enrollment or write. */
export async function assertServesOrg(person: Person, org: string): Promise<void> {
  const served = (await person.json<{ org: { id: string } }>('/api/me')).org.id;
  if (served !== org) throw new Error(`the deployment serves the org ${served}, not the throwaway ${org}: refusing to enroll or write anything`);
}

/** `assertServesOrg` for a command: false, with why on stderr, where it would throw. */
export async function servesOrg(person: Person, org: string): Promise<boolean> {
  try {
    await assertServesOrg(person, org);
    return true;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return false;
  }
}

/** `checkTestTarget` for a command that writes org state: false, with why on stderr, where it would throw. Checked
 * before a credential is read or anything is asked of the hub. */
export function isTestTarget(config: DeployConfig): boolean {
  try {
    checkTestTarget(config, 'write org state for a test');
    return true;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return false;
  }
}

/** How long one cleanup step may take before the steps after it run anyway (a request to a stalled hub, say). */
export const STEP_MS = 30_000;
/** How long an interrupted run's work has to settle — a request it has in flight landing — before the cleanup runs. */
export const SETTLE_MS = 5_000;

/** Set while a cleanup runs: its requests pass `Cleanup.check` once the work's are refused. */
const cleaning = new AsyncLocalStorage<true>();

/**
 * Cleanup steps, registered as soon as there is something to undo and run last first, every one of them, each within
 * `stepMs`. Its `signal` and `check` stop the work when the run is interrupted (`interruptible`).
 */
export class Cleanup {
  private readonly steps: Array<{ what: string; run: () => Promise<void> }> = [];
  private running: string | undefined;
  private readonly interruption = new AbortController();
  /** Aborted when the run is interrupted: the work stops at its next step. */
  readonly signal: AbortSignal = this.interruption.signal;

  constructor(private readonly stepMs = STEP_MS) {}

  add(what: string, run: () => Promise<void>): void {
    this.steps.push({ what, run });
  }

  /** Stops the work: `signal` aborts, and `check` throws from now on everywhere but in the cleanup. */
  interrupt(why: string): void {
    if (!this.signal.aborted) this.interruption.abort(new Error(why));
  }

  /** Throws once the run is interrupted, unless called from the cleanup: what the work's requests pass first. */
  check(): void {
    if (this.signal.aborted && !cleaning.getStore()) throw this.signal.reason as Error;
  }

  /** What is not yet undone: the step running, then those still to run, in the order they will. */
  get pending(): string[] {
    return [...(this.running === undefined ? [] : [this.running]), ...this.steps.map((s) => s.what).reverse()];
  }

  /** Runs every step, each whatever the others did, a step registered meanwhile included; what failed, as
   * `<what>: <why>`. A step past `stepMs` is given up (it may still finish) and counts as failed. */
  run(): Promise<string[]> {
    return cleaning.run(true, async () => {
      const failures: string[] = [];
      for (let step = this.steps.pop(); step; step = this.steps.pop()) {
        this.running = step.what;
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const late = new Promise<'late'>((resolve) => (timer = setTimeout(() => resolve('late'), this.stepMs)));
          if ((await Promise.race([step.run(), late])) === 'late') failures.push(`${step.what}: not done within ${this.stepMs / 1000} s; the steps after it ran anyway`);
        } catch (error) {
          failures.push(`${step.what}: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
          clearTimeout(timer);
        }
      }
      this.running = undefined;
      for (const failure of failures) console.error(`cleanup failed: ${failure}`);
      return failures;
    });
  }
}

/** The signals that end a run early — an operator's Ctrl-C, a timeout's kill — and the status each leaves. */
const SIGNAL_STATUS = { SIGINT: 130, SIGTERM: 143 } as const;
type EndingSignal = keyof typeof SIGNAL_STATUS;

export type InterruptOptions = {
  /** How long the work has, once interrupted, to settle before the cleanup runs (default SETTLE_MS). */
  settleMs?: number;
  /** Where the signals come from: the process, or a suite's emitter. */
  signals?: Pick<NodeJS.EventEmitter, 'on' | 'off'>;
  /** Ends the process at a second signal: `process.exit`, or a suite's spy. */
  exit?: (status: number) => void;
};

/**
 * A command's run: `work` (its status; a throw is a FAIL, status 1), then `finish` (its cleanup and what it reports
 * after, given the status and answering the command's), however the run ends. A SIGINT or SIGTERM interrupts it: the
 * work is stopped (`cleanup.interrupt`: its requests refused from then on), given `settleMs` for what it has in
 * flight, and `finish` runs; the status is then 130 or 143. A second signal exits at once, naming the cleanup steps not
 * yet done.
 */
export async function interruptible(
  cleanup: Cleanup,
  work: () => Promise<number>,
  finish: (status: number) => Promise<number>,
  { settleMs = SETTLE_MS, signals = process, exit = (status) => process.exit(status) }: InterruptOptions = {},
): Promise<number> {
  let caught: EndingSignal | undefined;
  let interrupted!: () => void;
  const interruption = new Promise<undefined>((resolve) => (interrupted = () => resolve(undefined)));
  const handlers = (Object.keys(SIGNAL_STATUS) as EndingSignal[]).map((signal) => {
    const handler = () => {
      if (caught) {
        const left = cleanup.pending;
        console.error(`${signal} again: exiting now; ${left.length ? `possibly left behind, not yet undone: ${left.join('; ')}` : 'nothing was left to undo'}`);
        return exit(SIGNAL_STATUS[signal]);
      }
      caught = signal;
      console.error(`${signal}: stopping the run, then undoing what it made (a second ${signal} exits at once, leaving what is not yet undone)`);
      cleanup.interrupt(`interrupted by ${signal}`);
      interrupted();
    };
    signals.on(signal, handler);
    return { signal, handler };
  });
  try {
    const running = work().catch((error: unknown) => {
      console.error(`FAIL: ${error instanceof Error ? error.message : String(error)}`);
      return 1;
    });
    const status = await Promise.race([running, interruption]);
    if (caught) await settledWithin(running, settleMs);
    const finished = await cleaning.run(true, () => finish(caught ? SIGNAL_STATUS[caught] : status!));
    return caught ? SIGNAL_STATUS[caught] : finished;
  } finally {
    for (const { signal, handler } of handlers) signals.off(signal, handler);
  }
}

/** Revokes a machine, which deletes its service token; one the hub does not hold (never enrolled, or gone) counts as
 * revoked. Any other answer throws. */
export async function revoke(person: Person, name: string): Promise<void> {
  const response = await person.fetch(`/api/machines/${encodeURIComponent(name)}`, { method: 'DELETE' });
  if (response.status === 200 || response.status === 404) return;
  throw new Error(`revoking ${name}: ${response.status} ${(await response.text()).slice(0, 200)}`);
}
