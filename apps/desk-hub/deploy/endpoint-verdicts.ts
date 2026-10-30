// How the endpoint acceptance run (endpoint-acceptance.ts; P5 O10 M11) decides, apart from the scene that feeds it, so
// each rule is tested on its own (test/deploy/endpoint-verdicts.test.ts):
// - acceptance 2's lane A verdict: one logical subscription followed across its resumes, each answer and what came after
//   it on the same channel, judged against the endpoint's cursor (`(epoch, seq)`, contiguous within an epoch and resumed
//   exactly after the cursor a replay names), against the producer's own numbering (sminos's `n` on its upstream
//   subscription, 0 at the snapshot and +1 for each own message, across replays), and against the transcript's rows
//   (each produced row delivered once in the subscription's latest epoch);
// - its lane B verdict, the same rule on the engine host's cursor `(launchId, seq, idx)`: each event's cursor its own
//   id's, and every event the engine host's journal numbers in a launch the subscription answered delivered once, in
//   its order, across every resume;
// - the report: one line per check, then one `PASS <item>` / `FAIL <item>` / `NOT SHOWN <item>` per item, the joint
//   clauses this run cannot show named as outstanding;
// - the secrets a run handles (an enrollment code, its token and pairing secret, a service token, a pairing code): kept
//   out of every line it prints, and listed for the runner's search of the log afterwards.
import { appendFileSync } from 'node:fs';

export type Cursor = { epoch: string; seq: number };

/** A plane message as an `ev` or a `snap` carries it (sminos's `session` message, RL10). */
export type PlaneMessage = { kind?: unknown; sub?: unknown; n?: unknown; body?: unknown };

/** One subscription answer and what followed it on its channel, until the channel ended or the run moved on. */
export type Segment = {
  /** What came before it: `first`, or the disruption it resumes after. */
  after: string;
  /** The cursor the device sent (null: the first subscription). */
  cursor: Cursor | null;
  /** The answer the endpoint's design gives here (M8): a replay inside the ring and the resume window, a snapshot after
   * a restart. */
  expect: 'snapshot' | 'replay';
  /** The endpoint's answer; null when none came (an `ended`, or nothing). */
  subbed: { mode: string; epoch: string; seq: number } | null;
  /** The snapshot's pages joined, when the answer carried one. */
  snapshot: { epoch: string; seq: number; message: PlaneMessage } | null;
  events: Array<{ epoch: string; seq: number; message: PlaneMessage }>;
};

/** A transcript row's uuid as a plane message carries it: a `row`'s `body.row.uuid`. */
export function rowUuid(message: PlaneMessage): string | null {
  if (message.kind !== 'row') return null;
  const row = (message.body as { row?: { uuid?: unknown } } | null | undefined)?.row;
  return typeof row?.uuid === 'string' && row.uuid !== '' ? row.uuid : null;
}

/** The uuids of a snapshot's rows (sminos's `snapshot` body: `rows`, newest first). */
export function snapshotRows(message: PlaneMessage): string[] {
  const rows = (message.body as { rows?: unknown } | null | undefined)?.rows;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => (typeof (row as { uuid?: unknown })?.uuid === 'string' ? [(row as { uuid: string }).uuid] : []));
}

/** The cursor a resume after `segment` sends: its last event's, else its answer's. */
export function resumeCursor(segment: Segment): Cursor | null {
  const last = segment.events.at(-1);
  if (last) return { epoch: last.epoch, seq: last.seq };
  return segment.subbed ? { epoch: segment.subbed.epoch, seq: segment.subbed.seq } : null;
}

/**
 * What is wrong with one subscription followed across its resumes, `produced` being the producer's rows in transcript
 * order over the run (its own count of what the session wrote): none is an acceptance-2 pass for this subscription.
 * - each answer is the one expected, a replay under the cursor's epoch, and every event is the answer's epoch;
 * - the endpoint's seq runs +1 from the snapshot (or the cursor a replay names), with no gap and no repeat;
 * - sminos's `n` on the upstream subscription (its own messages: `sub` the epoch) runs +1 from the snapshot's 0, across
 *   every replay of that epoch;
 * - no row comes twice within an epoch, every produced row reaches some answer, and the latest epoch holds every row
 *   written after its own oldest (a restart's snapshot pages the newest rows only).
 */
export function laneAProblems(segments: Segment[], produced: string[]): string[] {
  const problems: string[] = [];
  if (segments.length === 0) return ['no subscription was made'];
  // Per epoch: the endpoint's next seq, sminos's next n, and the rows seen.
  const epochs = new Map<string, { seq: number; n: number; rows: Set<string> }>();
  let latest: string | null = null;
  for (const [i, segment] of segments.entries()) {
    const where = `after ${segment.after}`;
    const { subbed } = segment;
    if (subbed === null) {
      problems.push(`${where}: the subscription was not answered`);
      continue;
    }
    if (subbed.mode !== segment.expect) problems.push(`${where}: answered ${subbed.mode}, expected ${segment.expect}`);
    let state = epochs.get(subbed.epoch);
    if (subbed.mode === 'replay') {
      if (segment.cursor === null || subbed.epoch !== segment.cursor.epoch) problems.push(`${where}: a replay under epoch ${subbed.epoch}, not the cursor's ${segment.cursor?.epoch ?? '(none)'}`);
      else if (state === undefined) problems.push(`${where}: a replay of epoch ${subbed.epoch}, which this run never saw begin`);
      else if (segment.cursor.seq + 1 !== state.seq) problems.push(`${where}: the cursor named seq ${segment.cursor.seq}, but the device had seen up to ${state.seq - 1}`);
    } else {
      if (epochs.has(subbed.epoch)) problems.push(`${where}: a ${subbed.mode} under epoch ${subbed.epoch}, which an earlier answer used`);
      if (segment.snapshot === null) problems.push(`${where}: a ${subbed.mode} answer with no snapshot`);
      else {
        if (segment.snapshot.epoch !== subbed.epoch || segment.snapshot.seq !== subbed.seq) problems.push(`${where}: the snapshot at (${segment.snapshot.epoch}, ${segment.snapshot.seq}), the answer at (${subbed.epoch}, ${subbed.seq})`);
        if (segment.snapshot.message.kind !== 'snapshot' || segment.snapshot.message.n !== 0) problems.push(`${where}: the snapshot is no sminos snapshot at n 0`);
      }
      const snapped = segment.snapshot ? snapshotRows(segment.snapshot.message) : [];
      const twice = snapped.filter((uuid, at) => snapped.indexOf(uuid) !== at);
      for (const uuid of new Set(twice)) problems.push(`${where}: the snapshot of epoch ${subbed.epoch} carries the row ${uuid} twice`);
      state = { seq: subbed.seq + 1, n: 1, rows: new Set(snapped) };
      epochs.set(subbed.epoch, state);
    }
    if (state === undefined) continue;
    latest = subbed.epoch;
    for (const event of segment.events) {
      if (event.epoch !== subbed.epoch) {
        problems.push(`${where}: an event under epoch ${event.epoch}, not the answer's ${subbed.epoch}`);
        continue;
      }
      if (event.seq !== state.seq) problems.push(`${where}: seq ${event.seq} where ${state.seq} was next (${event.seq < state.seq ? 'a repeat' : `${event.seq - state.seq} lost`})`);
      state.seq = Math.max(state.seq, event.seq + 1);
      const own = event.message.sub === subbed.epoch;
      if (own) {
        if (event.message.n !== state.n) problems.push(`${where}: sminos's n ${String(event.message.n)} where ${state.n} was next`);
        if (typeof event.message.n === 'number') state.n = Math.max(state.n, event.message.n + 1);
      }
      const uuid = rowUuid(event.message);
      if (uuid !== null) {
        if (state.rows.has(uuid)) problems.push(`${where}: the row ${uuid} came twice in epoch ${subbed.epoch}`);
        state.rows.add(uuid);
      }
    }
    if (i === segments.length - 1 && segment.events.length === 0 && segment.snapshot === null && subbed.mode !== 'replay') problems.push(`${where}: nothing came after the answer`);
  }
  if (latest !== null) {
    const seen = new Set([...epochs.values()].flatMap((epoch) => [...epoch.rows]));
    const missing = produced.filter((uuid) => !seen.has(uuid));
    if (missing.length > 0) problems.push(`${missing.length} of the ${produced.length} rows the session wrote reached no answer of the subscription (first: ${missing[0]})`);
    // A snapshot pages the newest rows only (`more`), so the latest epoch starts at its oldest row and holds every one
    // written after it.
    const rows = epochs.get(latest)!.rows;
    const from = produced.findIndex((uuid) => rows.has(uuid));
    const holes = from < 0 ? [] : produced.slice(from).filter((uuid) => !rows.has(uuid) && seen.has(uuid));
    if (holes.length > 0) problems.push(`the latest epoch, ${latest}, lacks ${holes.length} row${holes.length === 1 ? '' : 's'} the session wrote after its oldest (first: ${holes[0]})`);
  }
  return problems;
}

// ---- acceptance 2, lane B --------------------------------------------------------------------------------------------

/** Lane B's cursor, the engine host's: the launch, the journal row and the event's index in it (none at a launch's
 * start, before its first event). */
export type LaneBCursor = { epoch: string; seq: number; idx?: number };

/** An event as the engine host numbers it: its id `<appSessionId>:<launchId>:<seq>:<idx>`'s parts. */
export type LaneBEvent = { epoch: string; seq: number; idx: number };

/**
 * One answer of a lane B subscription and what followed it on its channel, until the channel ended, the run moved on, or
 * the endpoint answered again on it (a relaunch's `subbed`, which starts the next).
 */
export type LaneBSegment = {
  after: string;
  cursor: LaneBCursor | null;
  /** The answer M8 gives here: a `replay` for a cursor on the launch the session still runs, else a `snapshot`. */
  expect: 'snapshot' | 'replay';
  subbed: { mode: string; epoch: string; seq: number; idx?: number } | null;
  /** The opening's replace-whole state (its `snap` pages joined): where it stands, and the parts it carries. */
  state: { epoch: string; seq: number; idx?: number; parts: string[] } | null;
  /** Each `ev`: its cursor, and the event's own id and `seq` (null for one the endpoint sent as `omitted`). */
  events: Array<{ epoch: string; seq: number; idx?: number; id: string | null; eventSeq: unknown }>;
  /** The endpoint's `paused` (as `paused <reason>`) and `resumed` within it, in order. */
  controls: string[];
  /** The `ended` reason, when the endpoint ended the subscription within it. */
  ended: string | null;
};

/** The replace-whole parts every lane B opening carries (M8; @shared/host/stream-catchup.ts's STREAM_PARTS). */
export const LANE_B_STATE = ['status', 'queue', 'pendingItems', 'catalog'] as const;

const at = (c: { epoch: string; seq: number; idx?: number }) => `(${c.epoch}, ${c.seq}${c.idx === undefined ? '' : `, ${c.idx}`})`;
const cursorOf = (c: { epoch: string; seq: number; idx?: number }): LaneBCursor => ({ epoch: c.epoch, seq: c.seq, ...(c.idx === undefined ? {} : { idx: c.idx }) });

/** The cursor a resume after `segment` sends: its last event's, else its answer's. */
export function laneBResume(segment: LaneBSegment): LaneBCursor | null {
  const last = segment.events.at(-1) ?? segment.subbed;
  return last ? cursorOf(last) : null;
}

/** An event's place as its id names it (`<app>:<launch>:<seq>:<idx>`), or null for an id of another shape. */
export function laneBEventOf(app: string, id: unknown): LaneBEvent | null {
  if (typeof id !== 'string' || !id.startsWith(`${app}:`)) return null;
  const rest = id.slice(app.length + 1);
  const i = rest.lastIndexOf(':');
  const s = i > 0 ? rest.lastIndexOf(':', i - 1) : -1;
  if (s <= 0 || i === rest.length - 1 || i === s + 1) return null;
  const seq = Number(rest.slice(s + 1, i));
  const idx = Number(rest.slice(i + 1));
  if (!Number.isSafeInteger(seq) || !Number.isSafeInteger(idx) || idx < 0) return null;
  return { epoch: rest.slice(0, s), seq, idx };
}

/**
 * What is wrong with one lane B subscription followed across its resumes, `produced` being every event the engine
 * host's journal numbers for the session, in order (its own record of what the session wrote): none is an acceptance-2
 * pass for this subscription.
 * - each answer is the one expected, and carries the session's whole replace-whole state at its own position; a replay
 *   goes on from the cursor's own `(launchId, seq, idx)`, the last event the device had; a snapshot (lane B's goes on
 *   from its launch's start, M8) is of a launch no earlier answer streamed;
 * - each event's cursor is its own id's (`launchId`, `seq`, `idx`) and `seq`'s, and is the next event the engine host
 *   numbered in that launch after the last one delivered: no gap, no repeat;
 * - every event of every launch the subscription answered reached it, and the engine host has no launch it never
 *   answered;
 * - the subscription was never left paused (with no app, the session's events stay available) nor ended.
 */
export function laneBProblems(segments: LaneBSegment[], app: string, produced: LaneBEvent[]): string[] {
  const problems: string[] = [];
  if (segments.length === 0) return ['no subscription was made'];
  const key = (e: LaneBEvent) => `${e.epoch} ${e.seq} ${e.idx}`;
  // The engine host's events by launch, and each one's place in its launch.
  const launches = new Map<string, LaneBEvent[]>();
  const place = new Map<string, number>();
  for (const e of produced) {
    const list = launches.get(e.epoch) ?? [];
    place.set(key(e), list.length);
    list.push(e);
    launches.set(e.epoch, list);
  }
  // Per launch the subscription answered: the place of the next event it owes, and the last position delivered.
  const streamed = new Map<string, { next: number; last: LaneBCursor }>();
  for (const [i, segment] of segments.entries()) {
    const where = `after ${segment.after}`;
    const control = segment.controls.at(-1);
    if (control !== undefined && control !== 'resumed') problems.push(`${where}: left ${control}, never resumed`);
    if (segment.ended !== null) problems.push(`${where}: the endpoint ended the subscription (${segment.ended})`);
    const { subbed } = segment;
    if (subbed === null) {
      problems.push(`${where}: the subscription was not answered`);
      continue;
    }
    if (subbed.mode !== segment.expect) problems.push(`${where}: answered ${subbed.mode}, expected ${segment.expect}`);
    // Every opening, a replay's too, carries the session's replace-whole state at its answer's position: it changes
    // outside the journal's sequence, so events alone can leave a settled card or an edited queue stale (M8).
    if (segment.state === null) problems.push(`${where}: a ${subbed.mode} answer with no state`);
    else {
      if (at(segment.state) !== at(subbed)) problems.push(`${where}: the state at ${at(segment.state)}, the answer at ${at(subbed)}`);
      const lacks = LANE_B_STATE.filter((part) => !segment.state!.parts.includes(part));
      if (lacks.length > 0) problems.push(`${where}: the ${subbed.mode}'s state lacks ${lacks.join(', ')}`);
    }
    let state = streamed.get(subbed.epoch);
    if (subbed.mode === 'replay') {
      const cursor = segment.cursor;
      if (cursor === null || cursor.epoch !== subbed.epoch) problems.push(`${where}: a replay of launch ${subbed.epoch}, not the cursor's ${cursor?.epoch ?? '(none)'}`);
      else if (at(subbed) !== at(cursor)) problems.push(`${where}: a replay from ${at(subbed)}, not from the cursor ${at(cursor)}`);
      else if (state === undefined) problems.push(`${where}: a replay of launch ${subbed.epoch}, which this run never saw begin`);
      else if (at(state.last) !== at(cursor)) problems.push(`${where}: the cursor named ${at(cursor)}, but the device had last ${at(state.last)}`);
    } else {
      if (state !== undefined) problems.push(`${where}: a ${subbed.mode} of launch ${subbed.epoch}, which an earlier answer streamed: its events come again`);
      if (subbed.seq !== 0 || subbed.idx !== undefined) problems.push(`${where}: a ${subbed.mode} from ${at(subbed)}, not from its launch's start`);
      state = { next: 0, last: cursorOf(subbed) };
      streamed.set(subbed.epoch, state);
    }
    if (state === undefined) continue;
    const list = launches.get(subbed.epoch) ?? [];
    for (const event of segment.events) {
      if (event.epoch !== subbed.epoch) {
        problems.push(`${where}: an event of launch ${event.epoch} under the answer's ${subbed.epoch}`);
        continue;
      }
      if (event.id !== null) {
        const own = laneBEventOf(app, event.id);
        if (own === null || own.epoch !== event.epoch || own.seq !== event.seq || own.idx !== event.idx || event.eventSeq !== event.seq) problems.push(`${where}: the event ${event.id} (seq ${String(event.eventSeq)}) came at the cursor ${at(event)}`);
      }
      const k = event.idx === undefined ? undefined : place.get(key({ epoch: event.epoch, seq: event.seq, idx: event.idx }));
      if (k === undefined) {
        // A launch the engine host's record lacks whole is named once, below, rather than at each of its events.
        if (list.length > 0) problems.push(`${where}: ${at(event)}, which the engine host's journal does not number`);
      } else {
        if (k < state.next) problems.push(`${where}: ${at(event)} came again (a repeat)`);
        else if (k > state.next) problems.push(`${where}: ${at(event)} where ${at(list[state.next])} was next (${k - state.next} lost)`);
        state.next = Math.max(state.next, k + 1);
      }
      state.last = cursorOf(event);
    }
    if (i === segments.length - 1 && segment.events.length === 0 && segment.state === null && subbed.mode !== 'replay') problems.push(`${where}: nothing came after the answer`);
  }
  for (const [epoch, { next }] of streamed) {
    const list = launches.get(epoch) ?? [];
    if (list.length === 0) problems.push(`the engine host's journal numbers no event of launch ${epoch}, which the subscription answered (the session launched again since?)`);
    else if (next < list.length) problems.push(`${list.length - next} of the ${list.length} events the engine host numbered in launch ${epoch} reached no answer of the subscription (first: ${at(list[next])})`);
  }
  for (const epoch of launches.keys()) if (!streamed.has(epoch)) problems.push(`the engine host's launch ${epoch} reached no answer of the subscription`);
  return problems;
}

// ---- the report ------------------------------------------------------------------------------------------------------

export type CheckStatus = 'pass' | 'fail' | 'skip';

/**
 * The run's report: each check one line as it ends, `<status> <item> <check>: <detail>`, and after the run one line per
 * item, in the order given: `PASS <item>` when every check of it passed, `FAIL <item>` when one failed (or none ran),
 * `NOT SHOWN <item>: <why>` when none failed but some could not run here. What an item's acceptance holds beyond this
 * run (another child's joint clause, a suite's proof) is named under it, `  outstanding: …` or `  by the suites: …`.
 */
export class ItemReport {
  readonly #checks = new Map<string, Array<{ status: CheckStatus; check: string; detail: string }>>();
  readonly #notes = new Map<string, string[]>();

  constructor(
    readonly items: readonly string[],
    private readonly print: (line: string) => void,
    /** Once it aborts (an interrupted run), no further check starts. */
    private readonly signal?: AbortSignal,
  ) {
    for (const item of items) this.#checks.set(item, []);
  }

  /** Whether a check may run here: null, or why not (production's allowlist; endpoint-items.ts's `productionAdmit`). */
  admit: ((item: string, check: string) => string | null) | null = null;

  /** Runs one check: its detail when it passes, `{skip}` when it cannot run in this scene, its error when it fails. */
  async check(item: string, check: string, run: () => Promise<string | { skip: string }>): Promise<boolean> {
    this.signal?.throwIfAborted();
    const refused = this.admit?.(item, check) ?? null;
    if (refused !== null) {
      this.add(item, 'skip', check, refused);
      return true;
    }
    try {
      const detail = await run();
      if (typeof detail === 'string') this.add(item, 'pass', check, detail);
      else this.add(item, 'skip', check, detail.skip);
      return true;
    } catch (error) {
      this.signal?.throwIfAborted();
      this.add(item, 'fail', check, error instanceof Error ? error.message : String(error));
      return false;
    }
  }

  add(item: string, status: CheckStatus, check: string, detail: string): void {
    const checks = this.#checks.get(item);
    if (checks === undefined) throw new Error(`no item ${item} in this run`);
    checks.push({ status, check, detail });
    this.print(`${status === 'pass' ? 'ok  ' : status === 'fail' ? 'FAIL' : 'skip'} ${item} ${check}: ${detail}`);
  }

  /** A clause of the item this run does not show, with whose it is: printed under its summary line. */
  outstanding(item: string, text: string): void {
    this.#notes.set(item, [...(this.#notes.get(item) ?? []), `outstanding: ${text}`]);
  }

  /** A clause the endpoint's suites prove and the live run does not repeat. */
  bySuites(item: string, text: string): void {
    this.#notes.set(item, [...(this.#notes.get(item) ?? []), `by the suites: ${text}`]);
  }

  /** The verdict of one item. */
  verdict(item: string): { word: 'PASS' | 'FAIL' | 'NOT SHOWN'; why?: string } {
    const checks = this.#checks.get(item) ?? [];
    if (checks.some((c) => c.status === 'fail')) return { word: 'FAIL' };
    if (checks.length === 0) return { word: 'FAIL', why: 'nothing was checked' };
    const skipped = checks.filter((c) => c.status === 'skip');
    if (skipped.length > 0) return { word: 'NOT SHOWN', why: skipped.map((c) => `${c.check} (${c.detail})`).join('; ') };
    return { word: 'PASS' };
  }

  /** One line per item, its notes under it; whether every item passed. */
  summary(): boolean {
    let ok = true;
    for (const item of this.items) {
      const { word, why } = this.verdict(item);
      if (word !== 'PASS') ok = false;
      this.print(`${word} ${item}${why ? `: ${why}` : ''}`);
      for (const note of this.#notes.get(item) ?? []) this.print(`  ${note}`);
    }
    return ok;
  }
}

// ---- secrets ---------------------------------------------------------------------------------------------------------

/**
 * The secrets a run handled. `scrub` takes each out of a line before it is printed, as a last guard behind lines built
 * from ids, counts and reasons alone; each is also appended to `scanList` (one a line, mode 0600), the runner's list
 * for its search of the run's log afterwards (staging-run.sh's secret_scan), which the runner removes.
 */
export class Secrets {
  readonly #values = new Set<string>();
  constructor(private readonly scanList: string | null = null) {}

  add(value: string | undefined | null): void {
    // Short values would scrub ordinary words; every secret the run handles is far longer.
    if (!value || value.length < 16 || this.#values.has(value)) return;
    this.#values.add(value);
    if (this.scanList !== null) appendFileSync(this.scanList, `${value}\n`, { mode: 0o600 });
  }

  scrub(line: string): string {
    let out = line;
    for (const value of this.#values) out = out.split(value).join('<secret>');
    return out;
  }

  /** `print` behind the scrub. */
  guard(print: (line: string) => void): (line: string) => void {
    return (line) => print(this.scrub(line));
  }
}
