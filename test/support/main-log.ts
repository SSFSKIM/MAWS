// The gate case's reading of the logs (P5 O15 M2b §I, docs/doperpowers/plans/2026-11-10-p5-o15-recomposition.md): a
// line of `main.log`, `mawsd.log` or `host.log` is `<ISO-8601 UTC with ms> <text>` (§H), and the case reads the lines
// §H lists by their text, in the forms their writers give them. The endpoint's lines reach `mawsd.log` under mawsd's
// `[endpoint] ` prefix and the engine host's stream lines reach `host.log` as `warn: [engine-host] …` (Decision Log 24),
// so both prefixes are optional here. This is the instrument M4's 7e reads with on the day, and the case reads the app's
// own file through it, so the gate proves the lines as well as the behaviour.
import { existsSync, readFileSync } from 'node:fs';

export interface LogLine {
  /** The line's time, ms since the epoch: the wall clock of the process that said it. */
  at: number;
  text: string;
}

const STAMPED = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z) (.*)$/;

/** A line's time and text; null for a line with no time first (a host's stray output, a blank). */
export function parseLogLine(line: string): LogLine | null {
  const match = STAMPED.exec(line);
  if (match === null) return null;
  const at = Date.parse(match[1]!);
  return Number.isNaN(at) ? null : { at, text: match[2]! };
}

export const parseLogText = (text: string): LogLine[] => text.split('\n').flatMap((line) => parseLogLine(line) ?? []);

/** A log's lines, its previous generation (`<path>.1`, §H's rotation) first; a log not written yet has none. */
export function readLogLines(path: string): LogLine[] {
  return [`${path}.1`, path].flatMap((file) => (existsSync(file) ? parseLogText(readFileSync(file, 'utf8')) : []));
}

/** A position as the lines write it, `<epoch>:<seq>:<idx or ->`; null for `none` or anything else. */
export function positionOf(text: string): { epoch: string; seq: number; idx: number | null } | null {
  const match = /^(.+):(\d+):(\d+|-)$/.exec(text);
  return match === null ? null : { epoch: match[1]!, seq: Number(match[2]), idx: match[3] === '-' ? null : Number(match[3]) };
}

export type Mode = 'replay' | 'snapshot' | 'missing';
export type Which = 'direct' | 'relay' | "today's";

/** The lines the case reads, each as its fields. */
export type CaseLine =
  | { kind: 'wake'; sleptMs: number; source: 'resume' | 'clock' }
  | { kind: 'reach-window'; reason: 'wake' | 'network' }
  | { kind: 'link-wake'; ref: string; sleptMs: number; dropped: string }
  | { kind: 'up'; ref: string; carrier: 'direct' | 'relay' }
  | { kind: 'lost'; ref: string; carrier: string; reason: string }
  | { kind: 'subbed'; ref: string; id: string; what: string; mode: Mode; position: string; asked: string }
  | { kind: 'first'; ref: string; id: string; what: string; delivery: 'event' | 'snapshot'; position: string }
  | { kind: 'repeated'; ref: string; id: string; position: string }
  | { kind: 'attempt-failed'; ref: string; which: Which; why: string }
  | { kind: 'lane-spent'; ref: string; lane: 'direct' | 'relay'; why: string }
  | { kind: 'floor'; ref: string; afterMs: number; why: string }
  | { kind: 'catch-up'; ref: string; which: Which; dial: number }
  | { kind: 'acts-ahead'; ref: string; messages: number; bytes: number }
  | { kind: 'feed-wake'; sleptMs: number; what: string }
  | { kind: 'feed-connected'; host: string }
  | { kind: 'feed-last-page'; records: number; pages: number }
  | { kind: 'endpoint-subbed'; channel: string; id: string; what: string; mode: Mode; position: string; asked: string; ms: number }
  | { kind: 'journal'; app: string; after: number | null; rows: number; ms: number; checkpoint: number | null };

const LINK = String.raw`^\[machines\] (\S+): `;
const MODE = '(replay|snapshot|missing)';
const WHICH = "(direct|relay|today's)";
const READERS: { pattern: RegExp; read(m: RegExpExecArray): CaseLine }[] = [
  { pattern: /^\[wake\] slept (\d+) ms \((resume|clock)\)$/, read: (m) => ({ kind: 'wake', sleptMs: Number(m[1]), source: m[2] as 'resume' | 'clock' }) },
  { pattern: /^\[reach\] window open for 60 s \((wake|network)\)$/, read: (m) => ({ kind: 'reach-window', reason: m[1] as 'wake' | 'network' }) },
  { pattern: new RegExp(`${LINK}wake after (\\d+) ms: dropped (.*)$`), read: (m) => ({ kind: 'link-wake', ref: m[1]!, sleptMs: Number(m[2]), dropped: m[3]! }) },
  { pattern: new RegExp(`${LINK}up over the (direct|relay) carrier`), read: (m) => ({ kind: 'up', ref: m[1]!, carrier: m[2] as 'direct' | 'relay' }) },
  { pattern: new RegExp(`${LINK}the (\\S*) channel was lost \\((.*)\\); reconnecting$`), read: (m) => ({ kind: 'lost', ref: m[1]!, carrier: m[2]!, reason: m[3]! }) },
  {
    pattern: new RegExp(`${LINK}subscription (\\S+) (.+?): subbed ${MODE} at (\\S+), asked from (\\S+)$`),
    read: (m) => ({ kind: 'subbed', ref: m[1]!, id: m[2]!, what: m[3]!, mode: m[4] as Mode, position: m[5]!, asked: m[6]! }),
  },
  {
    pattern: new RegExp(`${LINK}subscription (\\S+) (.+?): first (event|snapshot) after subbed, at (\\S+)$`),
    read: (m) => ({ kind: 'first', ref: m[1]!, id: m[2]!, what: m[3]!, delivery: m[4] as 'event' | 'snapshot', position: m[5]! }),
  },
  { pattern: new RegExp(`${LINK}subscription (\\S+): dropped a repeated event at (\\S+)$`), read: (m) => ({ kind: 'repeated', ref: m[1]!, id: m[2]!, position: m[3]! }) },
  { pattern: new RegExp(`${LINK}attempt failed \\(${WHICH}\\): (.*)$`), read: (m) => ({ kind: 'attempt-failed', ref: m[1]!, which: m[2] as Which, why: m[3]! }) },
  { pattern: new RegExp(`${LINK}lane (direct|relay): spent \\((.*)\\)$`), read: (m) => ({ kind: 'lane-spent', ref: m[1]!, lane: m[2] as 'direct' | 'relay', why: m[3]! }) },
  { pattern: new RegExp(`${LINK}floor after (\\d+) ms: today's attempts from here \\((.*)\\)$`), read: (m) => ({ kind: 'floor', ref: m[1]!, afterMs: Number(m[2]), why: m[3]! }) },
  { pattern: new RegExp(`${LINK}attempt \\(${WHICH}\\): catch-up, dial (\\d+)$`), read: (m) => ({ kind: 'catch-up', ref: m[1]!, which: m[2] as Which, dial: Number(m[3]) }) },
  { pattern: new RegExp(`${LINK}wrote (\\d+) act message\\(s\\), (\\d+) bytes, ahead of the subscriptions$`), read: (m) => ({ kind: 'acts-ahead', ref: m[1]!, messages: Number(m[2]), bytes: Number(m[3]) }) },
  { pattern: /^\[org-feed\] wake after (\d+) ms: (.*)$/, read: (m) => ({ kind: 'feed-wake', sleptMs: Number(m[1]), what: m[2]! }) },
  { pattern: /^\[org-feed\] connected to (\S+)$/, read: (m) => ({ kind: 'feed-connected', host: m[1]! }) },
  { pattern: /^\[org-feed\] listings: last page, (\d+) records in (\d+) pages$/, read: (m) => ({ kind: 'feed-last-page', records: Number(m[1]), pages: Number(m[2]) }) },
  {
    pattern: new RegExp(`^(?:\\[endpoint\\] )?endpoint: channel (\\S+) sub (\\S+) (.+?): subbed ${MODE} at (\\S+), asked from (\\S+), after (\\d+) ms$`),
    read: (m) => ({ kind: 'endpoint-subbed', channel: m[1]!, id: m[2]!, what: m[3]!, mode: m[4] as Mode, position: m[5]!, asked: m[6]!, ms: Number(m[7]) }),
  },
  {
    pattern: /^(?:warn: )?(?:\[engine-host\] )?session\.events (\S+) after (\d+|start): from the journal, (\d+) rows read in (\d+) ms(?:, from the checkpoint at seq (\d+))?$/,
    read: (m) => ({ kind: 'journal', app: m[1]!, after: m[2] === 'start' ? null : Number(m[2]), rows: Number(m[3]), ms: Number(m[4]), checkpoint: m[5] === undefined ? null : Number(m[5]) }),
  },
];

/** The fields of a line the case reads, from its text after the time; null for any other line. */
export function caseLineOf(text: string): CaseLine | null {
  for (const { pattern, read } of READERS) {
    const match = pattern.exec(text);
    if (match !== null) return read(match);
  }
  return null;
}
