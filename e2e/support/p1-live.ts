// The pure parts of E11's app-level live sittings (docs/doperpowers/plans/2026-10-06-e11-finish.md, Task 6.1; Design §5
// S3, S4, S6 and A-47 through e2e/p1-live.spec.ts, S1 through test/live/maws-ask-interrupt.live.test.ts): the run's cap and
// what each session may still spend, where the logs go, the scratch root every case of one run shares, the A-15
// reading in the standing rule's exact form and its log line, the screenshot's dominant colour, the site of a URL and
// the engine's init plugin list. Free of Playwright, so test/support/p1-live.test.ts runs it under vitest.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { inflateSync } from 'node:zlib';
import type { JournalRow } from '@shared/wire/journal';
import { a15DeltaText, compareA15 } from '../../test/support/owner-file';

type Env = Record<string, string | undefined>;

// ---- the caps ----------------------------------------------------------------------------------------------------------

// Each sitting's own cap (Design §5). The A-47 case is S4's: Decision Log 23 hands it to S4, whose one paid case leaves
// room, while S3 already holds back its side thread's allocation and its side question's reservation.
export const SITTING_CAP_USD = { s3: 0.5, s4: 0.4, s6: 0.3 } as const;
export type Sitting = keyof typeof SITTING_CAP_USD;

// The run's cap when MAWS_P1_LIVE_MAX_USD is unset: the three sittings' caps summed; each sitting stays within its own.
export const DEFAULT_CAP_USD = 1.2;

// The sitting each case's scratch directory (`<run root>/<case>`) spends for.
export const CASE_SITTING = { s3: 's3', 's4-browser': 's4', 's4-oopif': 's4', a47: 's4', s6: 's6' } as const satisfies Record<string, Sitting>;
export type CaseName = keyof typeof CASE_SITTING;

// MAWS_P1_LIVE_MAX_USD, the run's cap in US$; a value that is not a positive amount stops the run before it spends.
export function capUsd(env: Env = process.env): number {
  const raw = env.MAWS_P1_LIVE_MAX_USD;
  if (raw === undefined) return DEFAULT_CAP_USD;
  const cap = Number(raw);
  if (!Number.isFinite(cap) || cap <= 0) throw new Error(`MAWS_P1_LIVE_MAX_USD must be a positive amount in US$, not ${JSON.stringify(raw)}`);
  return cap;
}

const usd4 = (usd: number): number => Number(usd.toFixed(4));

// What a case spent that its journals' receipts do not show: a paid call with no receipt (a side question, a prompt
// whose result never came) charged its reservation or allocation. The spec keeps charges on disk so a fresh worker
// still counts them; a later charge under the same key replaces the earlier (a reservation settled once its receipt
// came).
export interface Charge {
  key: string;
  case: CaseName;
  label: string;
  usd: number;
}

export interface Spent {
  sittings: Record<Sitting, number>;
  run: number;
}

// Each sitting's spend: its cases' receipts (`receipts`, by case directory) plus their charges.
export function spentBySitting(receipts: Partial<Record<CaseName, number>>, charges: readonly Charge[]): Spent {
  const sittings: Record<Sitting, number> = { s3: 0, s4: 0, s6: 0 };
  for (const [name, usd] of Object.entries(receipts) as [CaseName, number][]) sittings[CASE_SITTING[name]] += usd;
  for (const charge of new Map(charges.map((c) => [c.key, c])).values()) sittings[CASE_SITTING[charge.case]] += charge.usd;
  return { sittings, run: Object.values(sittings).reduce((sum, usd) => sum + usd, 0) };
}

export interface Budget {
  sitting: Sitting;
  sittingLeft: number; // below 0 once overspent
  runLeft: number;
  usd: number; // what the next paid call may spend: the smaller remainder, never below 0
}

export function budgetOf(sitting: Sitting, spent: Spent, runCap: number): Budget {
  const sittingLeft = usd4(SITTING_CAP_USD[sitting] - spent.sittings[sitting]);
  const runLeft = usd4(runCap - spent.run);
  return { sitting, sittingLeft, runLeft, usd: Math.max(0, Math.min(sittingLeft, runLeft)) };
}

// Why a case must not start, or null: either remainder spent, or what is left not covering `need`, an amount the case
// commits that no session flag bounds below the remainder (a side thread's allocation, a side question's reservation,
// what a running session may still spend under the budget it launched with).
export function budgetRefusal(budget: Budget, runCap: number = DEFAULT_CAP_USD, need?: { usd: number; for: string }): string | null {
  const name = budget.sitting.toUpperCase();
  if (budget.sittingLeft <= 0) return `not run (budget): ${name} has spent its US$${SITTING_CAP_USD[budget.sitting].toFixed(2)} cap`;
  if (budget.runLeft <= 0) return `not run (budget): the run has spent its US$${runCap.toFixed(2)} cap`;
  if (need !== undefined && budget.usd < need.usd) return `not run (budget): US$${budget.usd.toFixed(4)} left (${name} US$${budget.sittingLeft.toFixed(4)}, the run US$${budget.runLeft.toFixed(4)}) does not cover the US$${need.usd.toFixed(4)} for ${need.for}`;
  return null;
}

// ---- where things go ----------------------------------------------------------------------------------------------------

// The directory the sittings' logs are written to (`live-<sitting>.txt`), for the sitting to copy into evidence.
export const liveOutDir = (env: Env = process.env): string => resolve(env.MAWS_P1_LIVE_OUT ?? '/tmp/maws-e11-p1-live');

// One sitting's log: each line appended to `<dir>/live-<sitting>.txt` as it happens (a failing case still leaves its
// record) and echoed to the runner's output. Nothing is written before the first line (a skipped run leaves no file).
export function sittingLog(dir: string, sitting: string): (line: string) => void {
  const file = join(dir, `live-${sitting}.txt`);
  return (line) => {
    mkdirSync(dir, { recursive: true });
    appendFileSync(file, `${line}\n`);
    console.log(`   [${sitting}] ${line}`);
  };
}

// The scratch root every case of one run shares (Design §5's `/private/tmp/maws-e11-<sitting>-<stamp>`): Playwright
// starts a fresh worker after a failed case, so the stamp is the runner's pid (the worker's parent), unless
// MAWS_P1_LIVE_STAMP names one; the run's spend is read from the journals under it.
export const runRoot = (env: Env = process.env, runnerPid: number = process.ppid): string => `/private/tmp/maws-e11-p1live-${env.MAWS_P1_LIVE_STAMP ?? `r${runnerPid}`}`;

// The installed engine (the installer's link, resolved), as a fresh install of MAWS finds it, and its version.
export function installedEngine(home: string = homedir()): { bin: string; version: string } {
  const bin = realpathSync(join(home, '.local/bin/claude'));
  const version = /\d+\.\d+\.\d+/.exec(execFileSync(bin, ['--version'], { encoding: 'utf8', timeout: 30_000 }))?.[0] ?? '';
  return { bin, version };
}

// ---- the owner file (A-15) ----------------------------------------------------------------------------------------------

export interface A15Reading {
  keys: string[]; // the owner's ~/.claude.json `projects` keys under /tmp and /private/tmp, sorted
  digest: string; // what the standing rule's command prints through `| shasum`
}

// The standing rule's check, verbatim (Python's sorted list, printed), read only; the keys again as JSON beside it.
export function a15Reading(home: string = homedir()): A15Reading {
  const script = `import json;d=json.load(open(${JSON.stringify(join(home, '.claude.json'))}));k=sorted(k for k in d.get('projects',{}) if k.startswith('/tmp') or k.startswith('/private/tmp'));print(k);print(json.dumps(k))`;
  const [printed, json] = execFileSync('/usr/bin/python3', ['-c', script], { encoding: 'utf8' }).split('\n');
  return { keys: JSON.parse(json!) as string[], digest: createHash('sha1').update(`${printed}\n`).digest('hex') };
}

// One reading's log line against the run's first, through the shared comparison (test/support/owner-file.ts: a key
// under `ours`, the sitting's own scratch, appearing or vanishing is a breach; any other is recorded).
export function a15Line(label: string, first: A15Reading, now: A15Reading, ours: readonly string[]): string {
  return `A-15 ${label}: ${now.keys.length} keys, sha1 ${now.digest} (${a15DeltaText(compareA15(first.keys, now.keys, ours))})`;
}

// ---- the screenshot -------------------------------------------------------------------------------------------------------

// An 8-bit, non-interlaced RGB or RGBA PNG's pixels (what Chromium's capture encodes), each row's filter undone.
function decodePng(png: Buffer): { width: number; height: number; channels: number; pixels: Buffer } {
  const signature = '89504e470d0a1a0a';
  if (png.length < 33 || png.subarray(0, 8).toString('hex') !== signature) throw new Error('not a PNG');
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  const [depth, colourType, , , interlace] = png.subarray(24, 29);
  const channels = colourType === 6 ? 4 : colourType === 2 ? 3 : 0;
  if (depth !== 8 || channels === 0 || interlace !== 0) throw new Error(`a PNG this reader does not decode (bit depth ${depth}, colour type ${colourType}, interlace ${interlace})`);
  const idat: Buffer[] = [];
  for (let at = 8; at < png.length; ) {
    const length = png.readUInt32BE(at);
    const type = png.toString('ascii', at + 4, at + 8);
    if (type === 'IDAT') idat.push(png.subarray(at + 8, at + 8 + length));
    at += 12 + length;
  }
  const data = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = data[y * (stride + 1)]!;
    const line = data.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? pixels[y * stride + i - channels]! : 0;
      const b = y > 0 ? pixels[(y - 1) * stride + i]! : 0;
      const c = i >= channels && y > 0 ? pixels[(y - 1) * stride + i - channels]! : 0;
      const p = a + b - c;
      const paeth = Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c) ? a : Math.abs(p - b) <= Math.abs(p - c) ? b : c;
      const predicted = [0, a, b, Math.floor((a + b) / 2), paeth][filter];
      if (predicted === undefined) throw new Error(`a PNG row with filter ${filter}`);
      pixels[y * stride + i] = (line[i]! + predicted) & 0xff;
    }
  }
  return { width, height, channels, pixels };
}

// The colour most pixels have (alpha ignored), and the share of the image it covers.
export function dominantColour(png: Buffer): { rgb: [number, number, number]; share: number } {
  const { width, height, channels, pixels } = decodePng(png);
  const counts = new Map<number, number>();
  for (let at = 0; at < pixels.length; at += channels) {
    const key = (pixels[at]! << 16) | (pixels[at + 1]! << 8) | pixels[at + 2]!;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const [key, count] = [...counts].reduce((best, entry) => (entry[1] > best[1] ? entry : best));
  return { rgb: [(key >> 16) & 0xff, (key >> 8) & 0xff, key & 0xff], share: count / (width * height) };
}

// The largest per-channel difference between two colours (a display profile may shift a capture's values a little).
export const colourDistance = (a: readonly number[], b: readonly number[]): number => Math.max(...a.map((v, k) => Math.abs(v - b[k]!)));

// ---- sites and plugins ----------------------------------------------------------------------------------------------------

// A URL's site: its scheme and registrable domain (the last two labels; no public-suffix list, which the loopback and
// the pages these sittings name never need), or the host itself for an address or a single-label name.
export function siteOf(url: string): string {
  const { protocol, hostname } = new URL(url);
  const address = /^\[.*\]$/.test(hostname) || /^\d+(\.\d+){3}$/.test(hostname);
  const labels = hostname.split('.');
  return `${protocol}//${address || labels.length <= 2 ? hostname : labels.slice(-2).join('.')}`;
}

// The plugin list of the journal's first engine `system/init` frame, each plugin with its `path` (so one the sitting
// installed under its own scratch is told apart from the owner's), or null before one.
export function initPluginsOf(rows: readonly JournalRow[]): { name: string; source: string; path?: string }[] | null {
  const init = rows.find((row) => row.direction === 'in' && (row.frame as { type?: unknown }).type === 'system' && (row.frame as { subtype?: unknown }).subtype === 'init');
  return init ? ((init.frame as { plugins?: { name: string; source: string; path?: string }[] }).plugins ?? []) : null;
}
