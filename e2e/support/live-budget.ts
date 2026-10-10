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

// What the sessions under a MAWS profile spent, from their journals' receipts.
export function spentUnder(userData: string): number {
  const dir = join(userData, 'engine-host', 'journal');
  if (!existsSync(dir)) return 0;
  let usd = 0;
  for (const id of readdirSync(dir)) {
    for (const file of readdirSync(join(dir, id)).filter((f) => f.endsWith('.jsonl'))) {
      usd += journalCost(readFileSync(join(dir, id, file), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as JournalRow)).costUsd;
    }
  }
  return usd;
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
