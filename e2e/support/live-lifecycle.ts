// The end of a paid live run (P3-C M10, extracted from the form P3-L's and P3-D's live specs shared: e2e/library-live.spec.ts,
// e2e/design-systems-live.spec.ts, which end through it since P4 W2-D, as the other live specs do).
//
// Contract. `endLiveRun` runs every step whatever an earlier one threw, notes each failure as "<what>: <message>" and
// answers them in order (the caller fails the test on the first, after its own bookkeeping):
//   1. the session stopped: its status read (its engine pid kept when none was recorded) and, unless it has exited,
//      `session.stop` asked and the status polled until `exited` (30 s);
//   2. `beforeCleanup` (the caller's copies out of the profile while the app still runs);
//   3. the app closed (`cleanup`);
//   4. the engine process gone: a detached host can outlive the app, so the app's close proves nothing about the
//      engine; a recorded pid still alive whose command names claude is a failure and is killed (a pid reused by
//      another program is left alone);
//   5. a line naming the engine process's end.
// `liveSpend` is the run's money from its journal: the receipts (the engine's cumulative `total_cost_usd`), and the
// exposure accounted against the cap, at the whole cap when a prompt was sent and no receipt settles it (a failed,
// stopped or unjournalled turn), since an absent receipt must never read as no spend (p1-live.ts's `chargeOf`).
// Free of Playwright: the session is reached through the `LiveSession` port the spec builds, so
// test/support/live-lifecycle.test.ts runs it under vitest.
import type { JournalRow } from '@shared/wire/journal';
import { chargeOf } from './p1-live';
import { isAlive, ps } from './processes';

/** The session as the live spec reaches it (its `session.status` and `session.stop`). */
export interface LiveSession {
  status(): Promise<{ process: string; pid: number | null }>;
  stop(): Promise<void>;
}

/** The process table, injectable for the unit test. */
export interface ProcessPort {
  isAlive(pid: number): boolean;
  command(pid: number): string;
  kill(pid: number): void;
  sleep(ms: number): Promise<void>;
}

const REAL: ProcessPort = {
  isAlive,
  command: (pid) => ps(pid, 'command'),
  kill: (pid) => process.kill(pid, 'SIGKILL'),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export const STOP_TIMEOUT_MS = 30_000;

export interface LiveRunEnd {
  /** Each step's failure, in order; empty when every step held. */
  errors: unknown[];
  /** The engine's pid: the one recorded, else the session's last status's. */
  enginePid: number | null;
}

export async function endLiveRun(
  opts: { session: LiveSession | null; enginePid: number | null; cleanup: (() => Promise<void>) | null; beforeCleanup?: () => void; note: (line: string) => void },
  port: ProcessPort = REAL,
): Promise<LiveRunEnd> {
  const errors: unknown[] = [];
  let enginePid = opts.enginePid;
  const failed = (what: string) => (error: unknown) => {
    opts.note(`${what}: ${error instanceof Error ? error.message : String(error)}`);
    errors.push(error);
  };
  if (opts.session !== null) {
    const session = opts.session;
    await (async () => {
      const status = await session.status();
      enginePid ??= status.pid;
      if (status.process === 'exited') return;
      await session.stop();
      for (const deadline = Date.now() + STOP_TIMEOUT_MS; (await session.status()).process !== 'exited'; ) {
        if (Date.now() > deadline) throw new Error(`the session did not exit within ${STOP_TIMEOUT_MS / 1000} s of session.stop`);
        await port.sleep(200);
      }
    })().catch(failed('the session could not be stopped'));
  }
  try {
    opts.beforeCleanup?.();
  } catch (error) {
    failed('the copies before the cleanup failed')(error);
  }
  await opts.cleanup?.().catch(failed('the app’s cleanup failed'));
  if (enginePid !== null && port.isAlive(enginePid)) {
    const command = port.command(enginePid);
    if (/claude/.test(command)) {
      failed('the engine outlived the app')(new Error(`pid ${enginePid} (${command}) still runs after the app closed; killed`));
      try {
        port.kill(enginePid);
      } catch {
        // gone since the check
      }
    }
  }
  opts.note(`engine process: ${enginePid === null ? 'none recorded (no launch reached ready)' : `pid ${enginePid} ${port.isAlive(enginePid) ? 'STILL ALIVE' : 'gone'}`}`);
  return { errors, enginePid };
}

export interface LiveSpend {
  receipts: number[]; // the main lane's `total_cost_usd`, in order (cumulative per process)
  receipted: number;
  settled: boolean; // a receipt came after the last prompt
  accounted: number; // the exposure held against the cap
  basis: 'no prompt sent' | 'no journal: the whole cap' | 'settled by its receipt' | 'unreceipted turn: the whole cap';
}

export function liveSpend(rows: readonly JournalRow[], capUsd: number, prompted: boolean): LiveSpend {
  const charge = chargeOf(rows, capUsd);
  const receipts = rows
    .filter((row) => row.direction === 'in' && (row.frame as { type?: unknown }).type === 'result' && ((row.frame as { parent_tool_use_id?: unknown }).parent_tool_use_id ?? null) === null)
    .map((row) => (row.frame as { total_cost_usd?: unknown }).total_cost_usd)
    .filter((usd): usd is number => typeof usd === 'number' && Number.isFinite(usd));
  const noJournal = prompted && rows.length === 0;
  const basis = !prompted ? 'no prompt sent' : noJournal ? 'no journal: the whole cap' : charge.settled ? 'settled by its receipt' : 'unreceipted turn: the whole cap';
  return { receipts, receipted: charge.receipted, settled: charge.settled, accounted: noJournal ? capUsd : charge.usd, basis };
}
