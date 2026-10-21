// The heavy deck history the deck scale gate previews (P3-F W-E; docs/doperpowers/plans/2026-10-18-p3-f-finish.md
// §Measured bounds and Decision Log 6): S7a's heavy deck soak, generated inside the job with the soak's opt-in final-month
// export (spikes/p3-store/s7/soak/soak.mjs --export), never committed or fetched, then checked before the gate applies
// it. Free of Playwright, so test/support/deck-history.test.ts runs it under vitest.
// - generation runs the repository's supported S7a command with Node's own executable, refused unless that Node strips
//   `.ts` types by default (22.18 or later; the soak's deck is `.ts`), within a time budget; its wall time, the 1-minute loads around it, its exit and its
//   output's tail are answered whether it succeeds or not;
// - the check refuses by name a missing or empty file, a meta.json that is not JSON, a consumer field that is not finite
//   or a version timestamp that does not parse, and, for a generated export, a soak descriptor other than the one asked;
//   it answers each file's size and SHA-256 (integrity evidence) and the meta's workload and filesView fingerprints;
// - one descriptor's generations agree on `deckHistoryLogic` (P4: the soak is seeded and its restores author under ids
//   of its own); runs are compared by it, not by the files' bytes.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { loadavg } from 'node:os';
import { join } from 'node:path';

export const DECK_HISTORY_FILES = ['prev.bin', 'next.bin', 'attrs.bin', 'meta.json'] as const;
/** The soak the gate generates: S7a's heavy deck, three months, its preview inputs from the third. */
export const DECK_HISTORY_SOAK = { kind: 'deck', profile: 'heavy', encoding: 'delta', months: 3, month: 3, seed: 11 } as const;
export const DECK_HISTORY_SOAK_SCRIPT = 'spikes/p3-store/s7/soak/soak.mjs';
export const DECK_HISTORY_SOAK_ARGS = ['--kind', 'deck', '--profile', 'heavy', '--encoding', 'delta', '--months', '3'] as const;
/** The version kinds S7a's store records (its `version` calls), which meta.json's `kind` names. */
export const VERSION_KINDS = ['import', 'auto', 'turn', 'named', 'restore'] as const;

const load1 = () => +loadavg()[0]!.toFixed(2);
const tail = (text: string, lines = 20) => text.trimEnd().split('\n').slice(-lines).join('\n');

/** Whether this Node runs the soak's `.ts` files without a flag: its own report (`process.features.typescript`). */
export function nodeStripsTypes(typescript: unknown = (process.features as { typescript?: unknown }).typescript): boolean {
  return typescript === 'strip' || typescript === 'transform';
}

export interface DeckHistoryGeneration {
  ok: boolean;
  reason?: string;
  command: string[];
  wallMs: number;
  timeoutMs: number;
  loadStart: number;
  loadEnd: number;
  exitCode: number | null;
  signal: string | null;
  stdoutTail: string;
  stderrTail: string;
}

/**
 * Runs the soak into `dir` (its stores under `dir/db`), from `root`, with Node's own executable, killed after
 * `timeoutMs`. `script` and `args` stand in for the soak's in tests.
 */
export async function generateDeckHistory(dir: string, { root, timeoutMs, script = DECK_HISTORY_SOAK_SCRIPT, args = DECK_HISTORY_SOAK_ARGS, typescript = (process.features as { typescript?: unknown }).typescript }: { root: string; timeoutMs: number; script?: string; args?: readonly string[]; typescript?: unknown }): Promise<DeckHistoryGeneration> {
  const command = [process.execPath, script, ...args, '--export', dir];
  const loadStart = load1();
  const started = performance.now();
  const base = { command, timeoutMs, loadStart };
  if (!nodeStripsTypes(typescript)) return { ...base, ok: false, reason: `Node ${process.versions.node} does not strip .ts types by default (process.features.typescript ${String(typescript)}; the soak needs 22.18 or later)`, wallMs: 0, loadEnd: loadStart, exitCode: null, signal: null, stdoutTail: '', stderrTail: '' };
  const outcome = await new Promise<{ code: number | null; signal: string | null; stdout: string; stderr: string; timedOut: boolean; error?: string }>((resolve) => {
    execFile(command[0]!, command.slice(1), { cwd: root, timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' }, (error, stdout, stderr) => {
      const failed = error as (Error & { code?: number | string; signal?: string | null; killed?: boolean }) | null;
      resolve({
        code: failed ? (typeof failed.code === 'number' ? failed.code : null) : 0,
        signal: failed?.signal ?? null,
        stdout,
        stderr,
        timedOut: Boolean(failed?.killed),
        ...(failed && typeof failed.code !== 'number' && !failed.killed && { error: failed.message }),
      });
    });
  });
  const wallMs = Math.round(performance.now() - started);
  const ran = { ...base, wallMs, loadEnd: load1(), exitCode: outcome.code, signal: outcome.signal, stdoutTail: tail(outcome.stdout), stderrTail: tail(outcome.stderr) };
  if (outcome.timedOut) return { ...ran, ok: false, reason: `the soak did not finish within ${timeoutMs / 1000} s (killed by ${outcome.signal ?? 'its timeout'})` };
  if (outcome.error) return { ...ran, ok: false, reason: `the soak could not run: ${outcome.error}` };
  if (outcome.code !== 0) return { ...ran, ok: false, reason: `the soak exited ${outcome.code ?? outcome.signal}: ${tail(outcome.stderr || outcome.stdout, 3)}` };
  return { ...ran, ok: true };
}

export interface DeckHistoryMeta {
  month: number;
  versionAt: string;
  kind: (typeof VERSION_KINDS)[number];
  enc: string;
  provenanceRows: number;
  s7aWalk: { slides: number; elements: number };
  ms: Record<string, number>;
  restores?: { at: string; from: string; ms: number; bytes: number }[];
  soak?: typeof DECK_HISTORY_SOAK;
  workload?: unknown;
  filesView?: unknown;
}

/** What two generations of one descriptor agree on: the meta less its timings and the restores' sizes. */
export function deckHistoryLogic({ month, versionAt, kind, enc, provenanceRows, s7aWalk, restores, soak, workload, filesView }: DeckHistoryMeta) {
  return { month, versionAt, kind, enc, provenanceRows, s7aWalk, restores: restores?.map(({ at, from }) => ({ at, from })), soak, workload, filesView };
}

export type DeckHistoryCheck = { ok: true; meta: DeckHistoryMeta; files: Record<string, { bytes: number; sha256: string }> } | { ok: false; reason: string };

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** The export in `dir`, checked before anything is applied; `generated` also requires the soak descriptor asked for. */
export function checkDeckHistory(dir: string, { generated }: { generated: boolean }): DeckHistoryCheck {
  const files: Record<string, { bytes: number; sha256: string }> = {};
  for (const name of DECK_HISTORY_FILES) {
    const path = join(dir, name);
    if (!existsSync(path)) return { ok: false, reason: `the heavy deck export in ${dir} has no ${name}` };
    const bytes = statSync(path).size;
    if (bytes === 0) return { ok: false, reason: `the heavy deck export's ${name} is empty` };
    files[name] = { bytes, sha256: createHash('sha256').update(readFileSync(path)).digest('hex') };
  }
  let meta: Record<string, unknown>;
  try {
    meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8')) as Record<string, unknown>;
  } catch (error) {
    return { ok: false, reason: `the heavy deck export's meta.json is not JSON: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (meta === null || typeof meta !== 'object' || Array.isArray(meta)) return { ok: false, reason: 'the heavy deck export’s meta.json is not an object' };
  const bad = (field: string, why: string): DeckHistoryCheck => ({ ok: false, reason: `the heavy deck export's meta.json ${field} ${why}: ${JSON.stringify(meta[field.split('.')[0]!])}` });
  if (!finite(meta.month) || !Number.isInteger(meta.month) || meta.month < 1) return bad('month', 'is not a month number');
  if (typeof meta.versionAt !== 'string' || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(meta.versionAt) || !Number.isFinite(Date.parse(`${meta.versionAt.replace(' ', 'T')}:00Z`))) return bad('versionAt', 'is not the version’s timestamp (YYYY-MM-DD HH:MM, UTC)');
  if (!(VERSION_KINDS as readonly unknown[]).includes(meta.kind)) return bad('kind', `is not a version kind (${VERSION_KINDS.join(', ')})`);
  if (typeof meta.enc !== 'string' || meta.enc === '') return bad('enc', 'is not the version’s encoding');
  if (!finite(meta.provenanceRows) || meta.provenanceRows < 0) return bad('provenanceRows', 'is not a row count');
  const walk = meta.s7aWalk as { slides?: unknown; elements?: unknown } | null;
  if (!walk || typeof walk !== 'object' || !finite(walk.slides) || !finite(walk.elements)) return bad('s7aWalk', 'is not S7a’s walk ({slides, elements})');
  const ms = meta.ms as Record<string, unknown> | null;
  if (!ms || typeof ms !== 'object' || Array.isArray(ms) || Object.keys(ms).length === 0 || !Object.values(ms).every(finite)) return bad('ms', 'is not the soak’s preview timings');
  if (generated) {
    const soak = meta.soak as Record<string, unknown> | undefined;
    const asked = Object.entries(DECK_HISTORY_SOAK);
    if (!soak || typeof soak !== 'object' || asked.some(([key, value]) => soak[key] !== value)) return bad('soak', `is not the soak asked for (${JSON.stringify(DECK_HISTORY_SOAK)})`);
    if (meta.month !== DECK_HISTORY_SOAK.month) return bad('month', `is not the soak's month ${DECK_HISTORY_SOAK.month}`);
  }
  return { ok: true, meta: meta as unknown as DeckHistoryMeta, files };
}
