// The live specs' engine cap (P2-F W-T, Design §6's R1 and R2; the tracker's P2-A live-harness row). The product passes
// no `--max-budget-usd` (`launch-mapping.ts`, untouched), so a live spec that must meet P1's "at most US$1" rule at the
// engine reaches it through a forwarding script in its scratch root, P2-C's form (`e2e/to-human-live.spec.ts`, which
// writes the same script with its own budget bookkeeping): every argument goes to the installed engine unchanged (D-1), and a session process (stream-json
// input) also gets `--max-budget-usd` with what the run's cap leaves, written before each launch from the receipts
// spent so far. A launch's session processes each start with what was left at that launch. The script carries the
// system-prompt snapshot flag's literal only when the engine's own bytes do, so the app's declaration scan reads it as
// it reads the engine. With MAWS_LIVE_MAX_USD unset the spec launches the engine itself, as before.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { JournalRow } from '@shared/wire/journal';
import { binaryDeclares, SYSTEM_PROMPT_SNAPSHOT_FLAG } from '../../src/engine-host/binary-info';
import { JournalReader } from '../../src/engine-host/journal';
import { journalCost } from '../../test/live/support/live';

// The run's cap in US$ from MAWS_LIVE_MAX_USD: null when unset; above 0 and at most 1 when set, else a throw (a value
// that cannot cap the run never runs it uncapped).
export function liveMaxUsd(env: Record<string, string | undefined> = process.env): number | null {
  const raw = env.MAWS_LIVE_MAX_USD;
  if (raw === undefined) return null;
  const cap = Number(raw);
  if (raw.trim() === '' || !(cap > 0 && cap <= 1)) throw new Error(`MAWS_LIVE_MAX_USD must be above 0 and at most 1, not "${raw}"`);
  return cap;
}

// What the sessions under a MAWS profile spent, from their journals' receipts, session by session (sessionSpent).
export function spentUnder(userData: string): number {
  const dir = join(userData, 'engine-host', 'journal');
  if (!existsSync(dir)) return 0;
  return readdirSync(dir).reduce((usd, id) => usd + sessionSpent(join(dir, id)), 0);
}

const rowsOf = (file: string): JournalRow[] => readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as JournalRow);
const metaRow = (rows: readonly JournalRow[], event: string) => rows.findLast((r) => r.direction === 'meta' && (r.frame as { event?: unknown }).event === event);

const exitAt = (rows: readonly JournalRow[]): number => Date.parse(metaRow(rows, 'exit')?.at ?? ''); // NaN: none journaled

// Whether a launch carries on the cumulative figure of the launch before it: it resumes, and the `cost-state` on disk
// when it spawned was that launch's, since that launch journaled a clean exit (code 0, no signal) before this one
// spawned and after every earlier launch's exit (`earlier`, the latest of those; NaN once one was never journaled, its
// end unknown). Host lifetimes can overlap over one profile (the engine allows a concurrent resume,
// pass2/resume-live-second.jsonl), and a resume restores whichever exit wrote last, not the launch just before it.
function continues(rows: readonly JournalRow[], before: readonly JournalRow[], earlier: number): boolean {
  const spawn = metaRow(rows, 'spawn');
  const exit = metaRow(before, 'exit');
  if (spawn === undefined || exit === undefined) return false;
  const { args } = spawn.frame as { args?: unknown };
  const { code, signal } = exit.frame as { code?: unknown; signal?: unknown };
  const ended = Date.parse(exit.at);
  return Array.isArray(args) && args.includes('--resume') && code === 0 && signal === null && earlier < ended && ended < Date.parse(spawn.at);
}

// What one session spent, from its journal directory: its launches in launch order (JournalReader: by their first row,
// each launch's rotations after its base file in index order), the cost read once over the stream (journalCost: the
// figure is cumulative, a drop opening a segment), since a resumed process restores the `cost-state` its session's last
// exit recorded (src/main/sessions/restored-cost.ts) and so carries the earlier launch's spend in its own figure. A
// launch continues that stream only when `continues` holds; otherwise (a fresh launch, one after a kill or an exit
// never journaled, or one spawned while an earlier launch still ran or after another exited last, whose restored figure
// is unknown) the stream so far is counted whole and the launch starts its own, which can only over-count, the safe
// side of a cap.
export function sessionSpent(dir: string): number {
  let usd = 0;
  let stream: JournalRow[] = [];
  let before: JournalRow[] | null = null; // the launch before
  let earlier = -Infinity; // the latest exit of the launches before `before`
  for (const launch of JournalReader.launches(dir)) {
    const rows = launch.files.flatMap(rowsOf);
    if (before) {
      if (!continues(rows, before, earlier)) {
        usd += journalCost(stream).costUsd;
        stream = [];
      }
      earlier = Math.max(earlier, exitAt(before));
    }
    stream.push(...rows);
    before = rows;
  }
  return usd + journalCost(stream).costUsd;
}

export interface CappedEngine {
  bin: string; // what MAWS_E2E_ENGINE_BIN names for the run's launches
  cap: number | null;
  // Before every launch: records what the cap leaves after `spentUsd` (null, and nothing written, without a cap).
  budget(spentUsd: number): number | null;
}

// A value as one shell word: single-quoted, each quote inside it closed, escaped and reopened, so no character of it (a
// quote, a newline, `$`, a backtick) is shell syntax.
export const shellWord = (value: string): string => `'${value.replaceAll("'", `'\\''`)}'`;

// The forwarding script's source (this module's and P2-C's). A path reaches it as a quoted word where the script runs it
// and JSON-encoded where a comment names it, since a raw newline would end the comment and run the rest as a command.
export function forwardingScript({ label, real, budgetFile, declares, cap }: { label: string; real: string; budgetFile: string; declares: boolean; cap: number }): string {
  return [
    '#!/bin/sh',
    `# ${label}: forwards every argument to the installed Claude Code at ${JSON.stringify(real)}, unmodified.`,
    declares ? `# That binary declares ${SYSTEM_PROMPT_SNAPSHOT_FLAG}, which this script passes through.` : '# That binary does not declare the system-prompt snapshot flag.',
    `# A session process (stream-json input) also gets --max-budget-usd with what the run's cap (US$${cap}) leaves.`,
    `case " $* " in *" --input-format "*) exec ${shellWord(real)} --max-budget-usd "$(cat ${shellWord(budgetFile)})" "$@" ;; esac`,
    `exec ${shellWord(real)} "$@"`,
    '',
  ].join('\n');
}

export async function cappedEngine({ root, real, cap = liveMaxUsd() }: { root: string; real: string; cap?: number | null }): Promise<CappedEngine> {
  if (cap === null) return { bin: real, cap, budget: () => null };
  const bin = join(root, 'claude-capped');
  const budgetFile = join(root, 'claude-capped.budget');
  const declares = await binaryDeclares(real, SYSTEM_PROMPT_SNAPSHOT_FLAG);
  writeFileSync(bin, forwardingScript({ label: 'MAWS live run', real, budgetFile, declares, cap }), { mode: 0o755 });
  const budget = (spentUsd: number): number => {
    const left = cap - spentUsd;
    if (left < 0.05) throw new Error(`not run (budget): US$${left.toFixed(4)} left of US$${cap}`);
    writeFileSync(budgetFile, left.toFixed(4));
    return left;
  };
  budget(0);
  return { bin, cap, budget };
}

// The cap as a run's log names it.
export const capWords = (engine: CappedEngine): string => (engine.cap === null ? 'none (MAWS_LIVE_MAX_USD unset)' : `US$${engine.cap} at the engine through ${engine.bin}`);
