// The scale gate's support (M9 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md, Acceptance 6; parent Decision
// Log 37; S7b's table in spikes/p3-store/findings.txt): the host seam's file channel (the engine host's
// `documents/kinds/document-perf.ts`, started under MAWS_E2E=1 and MAWS_DOCUMENT_PERF=1), the agents' batches in S7b's
// five-op mix quoting what each agent read, the page-side measurements S7b's editor page took (copied from
// `spikes/p3-store/s7/electron/editor-page.ts` and `main.ts`, never imported) reached through the product editor
// (Tiptap's `dom.editor`, the collaboration extension's `hold`, which is the tab's DocumentHandle, and its provider),
// the IME drive (S7b's `imeStep`), percentiles, and the rows the run records in `test-results/document-scale.json`.
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { join } from 'node:path';
import type { CDPSession, Page } from '@playwright/test';
import type { Step } from './hangul';

// ---- percentiles and rows -----------------------------------------------------------------------------------------

export interface Stats {
  n: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

export function stats(values: number[]): Stats {
  if (values.length === 0) return { n: 0, p50: NaN, p95: NaN, p99: NaN, max: NaN };
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p: number) => +sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)]!.toFixed(1);
  return { n: sorted.length, p50: at(0.5), p95: at(0.95), p99: at(0.99), max: +sorted[sorted.length - 1]!.toFixed(1) };
}

export const load1 = (): number => +loadavg()[0]!.toFixed(2);

/** One measure of S7b's table: what was measured, its bound, the value, whether it met the bound, the load then. */
export interface Row {
  row: string; // S7b's row number and part (e.g. "1 p95")
  measure: string;
  bound: string;
  limit: number | null; // the bound's number (≤), null for a recorded value with no bound
  value: number;
  unit: string;
  pass: boolean | null;
  load: number;
  note?: string;
}

export class Rows {
  readonly rows: Row[] = [];
  constructor(private readonly path: string, private readonly meta: Record<string, unknown>) {}

  add(row: string, measure: string, value: number, unit: string, limit: number | null, bound: string, note?: string): Row {
    const entry: Row = { row, measure, bound, limit, value: +value.toFixed(2), unit, pass: limit === null ? null : value <= limit, load: load1(), ...(note && { note }) };
    this.rows.push(entry);
    this.write();
    return entry;
  }

  write(extra: Record<string, unknown> = {}): void {
    mkdirSync(join(this.path, '..'), { recursive: true });
    const existing = existsSync(this.path) ? (JSON.parse(readFileSync(this.path, 'utf8')) as Record<string, unknown>) : {};
    Object.assign(this.meta, extra);
    writeFileSync(this.path, `${JSON.stringify({ ...existing, ...this.meta, rows: [...((existing.rows as Row[] | undefined) ?? []).filter((r) => !this.rows.some((mine) => mine.row === r.row && mine.measure === r.measure)), ...this.rows] }, null, 2)}\n`);
  }
}

// ---- the host seam's file channel -----------------------------------------------------------------------------------

export interface LoopStats {
  max: number;
  p99: number;
  mean: number;
}
export interface CallAnswer<R = unknown> {
  ok: true;
  isError: boolean;
  result?: R;
  text: string;
  wallMs: number;
  loop: LoopStats;
}

export class PerfSeam {
  private seq = 0;
  constructor(readonly dir: string) {}

  async send<T>(command: Record<string, unknown>, timeoutMs = 60_000): Promise<T> {
    const inbox = join(this.dir, 'in');
    mkdirSync(inbox, { recursive: true });
    const name = `${String(++this.seq).padStart(8, '0')}.json`;
    writeFileSync(join(inbox, `${name}.tmp`), JSON.stringify(command));
    renameSync(join(inbox, `${name}.tmp`), join(inbox, name));
    const out = join(this.dir, 'out', name);
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (existsSync(out)) {
        const answer = JSON.parse(readFileSync(out, 'utf8')) as { ok: boolean; error?: string };
        rmSync(out, { force: true });
        if (!answer.ok) throw new Error(`the seam refused ${String(command.cmd)}: ${answer.error}`);
        return answer as T;
      }
      if (Date.now() > deadline) throw new Error(`no answer from the document seam to ${String(command.cmd)} in ${timeoutMs} ms`);
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }

  seed(artifactId: string, state: Uint8Array): Promise<{ revision: number }> {
    return this.send({ cmd: 'seed', artifactId, state: Buffer.from(state).toString('base64') });
  }
  call<R>(session: string, tool: 'artifact_read' | 'artifact_edit', args: Record<string, unknown>, timeoutMs?: number): Promise<CallAnswer<R>> {
    return this.send({ cmd: 'call', session, tool, args }, timeoutMs);
  }
  heap(): Promise<{ heapUsed: number; rss: number }> {
    return this.send({ cmd: 'heap' });
  }
  release(session: string): Promise<unknown> {
    return this.send({ cmd: 'release', session });
  }
}

// ---- an agent: its read of the document and its batches in S7b's mix --------------------------------------------------

export interface ReadResult {
  revision: number;
  markdown: string;
  tabs?: unknown;
  complete?: boolean;
}

/** Each top-level block's markdown line (`… ^id`) of a read, by id. */
export function blocksOf(markdown: string): Map<string, string> {
  const blocks = new Map<string, string>();
  for (const line of markdown.split('\n')) {
    const marker = /(?:^| )\^([0-9a-z]+)$/.exec(line); // a table's marker stands on a line of its own
    if (marker) blocks.set(marker[1]!, line.slice(0, marker.index));
  }
  return blocks;
}

const WORDS = 'plan ships review notes owners budget risks timeline metrics draft launch scope users latency memory store version history editor comment'.split(' ');

export class Agent {
  readonly session: string;
  private readonly sections: number[];
  private run = 0;
  private turn = 0;
  readonly inserted: string[] = []; // ids of paragraphs this agent inserted, not yet deleted
  readonly deleted = new Set<string>(); // ids of its own inserts a later batch of this agent deleted
  private deleting: { run: number; id: string } | null = null;
  private lastInsertedText: string | null = null;
  readonly blocks = new Map<string, string>(); // what this agent knows of each block's markdown
  readonly applied: Array<{ run: number; revision: number; wallMs: number; loop: LoopStats; firstAfterRead: boolean; load: number }> = [];
  readonly refused: string[] = [];
  private readSince = true;

  constructor(name: string, sections: number[], private readonly random: () => number) {
    this.session = name;
    this.sections = sections;
  }

  /** What a read showed, folded in; the next batch is the first after it. */
  learn(read: ReadResult): void {
    for (const [id, line] of blocksOf(read.markdown)) this.blocks.set(id, line);
    this.readSince = true;
  }

  private within: ((s: number) => boolean) | null = null; // a batch confined to what one read showed

  private pick(offset: number, filter: (s: number) => boolean = () => true): number {
    const pool = this.sections.filter((s) => filter(s) && (this.within?.(s) ?? true));
    return pool[(this.turn * 7 + offset) % pool.length]!;
  }

  /**
   * The first batch after the agent's first read (M9's review): five ops, every target in a section that read showed
   * whole, the fifth an unscoped quote of a sentence it read (no insert of its own yet).
   */
  firstBatch(): { ops: Record<string, unknown>[]; run: number } {
    // only sections every target of which the read showed: the quoted paragraph, the rewritten one, the heading, the
    // fifth op's paragraph, and a table where a cell is set
    this.within = (s) => ['p2', 'p4', 'h', 'p5'].every((part) => this.blocks.has(`s${s}${part}`)) && (s % 3 !== 1 || this.blocks.has(`s${s}t`));
    try {
      const batch = this.nextBatch();
      if (batch.ops.length < 5) {
        const s = this.pick(4);
        const known = this.blocks.get(`s${s}p5`);
        if (!known) throw new Error(`${this.session} never read ^s${s}p5`);
        const sentence = known.split('. ')[1] ?? known.split('. ')[0]!;
        const quote = sentence.split(' ').slice(0, 6).join(' ');
        batch.ops.push({ op: 'replace_text', old: quote, new: quote.replace(/^(\S+)/, `$1 (${this.session})`) });
        this.blocks.set(`s${s}p5`, known.replace(quote, quote.replace(/^(\S+)/, `$1 (${this.session})`)));
      }
      return batch;
    } finally {
      this.within = null;
    }
  }

  /** The next five-op batch (S7b's mix: a quoted word, a block rewrite, an insert after a heading, a cell, and a delete of an earlier insert or an unscoped quote). */
  nextBatch(extra?: { block: string; old: string; new: string }): { ops: Record<string, unknown>[]; run: number } {
    this.run += 1;
    this.turn += 1;
    const run = this.run;
    const r = this.random;
    const word = () => WORDS[Math.floor(r() * WORDS.length)]!;
    const a = this.pick(0);
    const quoteBlock = `s${a}p2`;
    const known = this.blocks.get(quoteBlock);
    if (!known) throw new Error(`${this.session} never read ^${quoteBlock}`);
    const first = known.split('. ')[0]!;
    const words = first.split(' ');
    const at = words.findIndex((w, k) => k >= 2 && /^[a-z]+$/.test(w));
    const replaced = [...words];
    replaced[at >= 0 ? at : words.length - 1] = `${this.session.replace(/\W/g, '')}w${run}`;
    const newFirst = replaced.join(' ');
    const ops: Record<string, unknown>[] = [{ op: 'replace_text', block: quoteBlock, old: first, new: newFirst }];
    this.blocks.set(quoteBlock, known.replace(first, newFirst));
    const b = this.pick(3);
    const rewrite = `${this.session} rewrote this block in run ${run}: the ${word()} ${word()} and the ${word()} ${word()} are on track.`;
    ops.push({ op: 'replace_block', id: `s${b}p4`, markdown: rewrite });
    this.blocks.set(`s${b}p4`, rewrite);
    const c = this.pick(5);
    const insertedText = `${this.session} inserted this paragraph in run ${run}.`;
    ops.push({ op: 'insert', after: `s${c}h`, markdown: `${insertedText} The ${word()} ${word()} ships with the ${word()}.` });
    const t = this.pick(2, (s) => s % 3 === 1);
    ops.push({ op: 'set_cell', table: `s${t}t`, row: 1 + Math.floor(r() * 3), col: Math.floor(r() * 3), markdown: String(Math.floor(r() * 10_000)) });
    if (extra) ops.push({ op: 'replace_text', block: extra.block, old: extra.old, new: extra.new });
    else if (run % 2 === 0 && this.inserted.length > 0) {
      const id = this.inserted.shift()!;
      this.deleting = { run, id };
      ops.push({ op: 'delete', id });
    }
    else if (this.lastInsertedText) ops.push({ op: 'replace_text', old: this.lastInsertedText, new: this.lastInsertedText.replace(' inserted ', ' added ') });
    this.lastInsertedText = insertedText;
    return { ops, run };
  }

  /** A batch's answer folded in: the paragraph it inserted, its measures. */
  record(run: number, answer: CallAnswer<{ revision: number; results: Array<{ newIds?: string[] }> }>): void {
    const deleting = this.deleting?.run === run ? this.deleting.id : null;
    this.deleting = null;
    if (answer.isError) {
      this.refused.push(answer.text);
      if (deleting) this.inserted.unshift(deleting);
      return;
    }
    if (deleting) this.deleted.add(deleting);
    const insert = answer.result!.results[2];
    if (insert?.newIds?.[0]) this.inserted.push(insert.newIds[0]);
    this.applied.push({ run, revision: answer.result!.revision, wallMs: answer.wallMs, loop: answer.loop, firstAfterRead: this.readSince, load: load1() });
    this.readSince = false;
  }
}

/** The agent's first read: the default 200 blocks from the start (the measured read, its replica made). */
export async function readFirst(seam: PerfSeam, agent: Agent, artifactId: string): Promise<CallAnswer<ReadResult>> {
  const first = await seam.call<ReadResult>(agent.session, 'artifact_read', { artifact: artifactId });
  if (first.isError) throw new Error(`${agent.session}'s read was refused: ${first.text}`);
  agent.learn(first.result!);
  return first;
}

/** The rest of the first tab after what the agent read, 1,000 blocks at a time. */
export async function readRest(seam: PerfSeam, agent: Agent, artifactId: string, after: ReadResult): Promise<void> {
  let last = [...blocksOf(after.markdown).keys()].at(-1);
  for (let k = 0; k < 10 && last; k++) {
    const more = await seam.call<ReadResult>(agent.session, 'artifact_read', { artifact: artifactId, from: last, count: 1000 });
    if (more.isError) throw new Error(`${agent.session}'s read from ^${last} was refused: ${more.text}`);
    const ids = [...blocksOf(more.result!.markdown).keys()];
    agent.learn(more.result!);
    if (ids.length <= 1) break;
    last = ids.at(-1);
  }
}

/** Reads the whole first tab as an agent would, 1,000 blocks at a time after the first read of 200. */
export async function readAll(seam: PerfSeam, agent: Agent, artifactId: string): Promise<CallAnswer<ReadResult>> {
  const first = await readFirst(seam, agent, artifactId);
  await readRest(seam, agent, artifactId, first.result!);
  return first;
}

// ---- page-side measurement (S7b's editor page, on the product editor) ---------------------------------------------

/** The editor of `artifactId` in the page's main area (Tiptap's `dom.editor`), its handle and provider. */
// the live editor (M9 fix wave: a version is drawn by a preview editor of its own beside it)
export const EDITOR_SELECTOR = (artifactId: string) => `[data-artifact-tab="${artifactId}"] .ds-doc .ProseMirror[data-editor="live"]`;

export interface KeyRecord {
  tIn: number; // the keydown's timeStamp (page clock)
  tTx?: number;
  tRaf?: number;
  tPost?: number;
  local?: number; // the local update count after the keystroke's transaction
  clock?: number; // the replica's own clock after it
}
export interface TypingReport {
  origin: number; // performance.timeOrigin
  keys: KeyRecord[];
  acks: number[]; // per local update (1-based by index + 1): when the host acknowledged it
  slow: Array<{ name: string; start: number; duration: number }>; // Event Timing entries of 16 ms or more
  longTasks: Array<{ start: number; duration: number }>;
  clientID: number;
  holds: Array<{ on: number; off?: number; buffered: number; flushMs?: number; updatesInFlush?: number; byCap: boolean }>;
  providerLog: string[];
  imeInputs: Array<{ tIn: number; tRaf?: number }>;
}

/** Installs S7b's per-keystroke measurement on the editor of `artifactId` (window A). */
export async function instrumentTyping(page: Page, artifactId: string): Promise<{ clientID: number }> {
  return page.evaluate((selector) => {
    type AnyFn = (...args: never[]) => unknown;
    interface Handle {
      doc: { clientID: number; on(name: 'update', fn: (u: Uint8Array, origin: unknown) => void): void; store: { getClock(client: number): number } };
      provider: { holdRemote: (on: boolean) => void; buffered: unknown[]; log: (line: string) => void };
      subscribe(fn: (state: { unsaved: number }) => void): () => void;
      state(): { unsaved: number };
    }
    interface EditorLike {
      extensionManager: { extensions: Array<{ name: string; options: { hold: Handle } }> };
      on(name: 'transaction', fn: (props: { transaction: { docChanged: boolean; getMeta(key: string): unknown } }) => void): void;
    }
    const dom = document.querySelector(selector) as (HTMLElement & { editor?: EditorLike }) | null;
    if (!dom?.editor) throw new Error(`no editor at ${selector}`);
    const editor = dom.editor;
    const handle = editor.extensionManager.extensions.find((e) => e.name === 'collaboration')!.options.hold;
    const provider = handle.provider;
    const rel = () => performance.now();
    const afterPaint = () =>
      new Promise<{ raf: number; post: number }>((resolve) =>
        requestAnimationFrame(() => {
          const raf = rel();
          const channel = new MessageChannel();
          channel.port1.onmessage = () => resolve({ raf, post: rel() });
          channel.port2.postMessage(null);
        }),
      );
    const S: TypingReportState = { measuring: false, keys: [], acks: [], local: 0, slow: [], longTasks: [], pending: null, holds: [], providerLog: [], imeInputs: [], inFlush: null, clientID: handle.doc.clientID };
    interface TypingReportState {
      measuring: boolean;
      keys: Array<{ tIn: number; ime: boolean; tTx?: number; tRaf?: number; tPost?: number; local?: number; clock?: number }>;
      acks: number[];
      local: number;
      slow: Array<{ name: string; start: number; duration: number }>;
      longTasks: Array<{ start: number; duration: number }>;
      pending: TypingReportState['keys'][number] | null;
      holds: Array<{ on: number; off?: number; buffered: number; flushMs?: number; updatesInFlush?: number; byCap: boolean }>;
      providerLog: string[];
      imeInputs: Array<{ tIn: number; tRaf?: number }>;
      inFlush: { updates: number } | null;
      clientID: number;
    }
    (window as unknown as { __scale: TypingReportState }).__scale = S;
    handle.doc.on('update', (_update, origin) => {
      if (origin !== provider) S.local += 1;
      if (S.inFlush) S.inFlush.updates += 1;
    });
    handle.subscribe((state) => {
      const durable = S.local - state.unsaved;
      while (S.acks.length < durable) S.acks.push(rel());
    });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) if (S.measuring) S.longTasks.push({ start: entry.startTime, duration: entry.duration });
    }).observe({ type: 'longtask', buffered: false });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) if (S.measuring) S.slow.push({ name: entry.name, start: entry.startTime, duration: entry.duration });
    }).observe({ type: 'event', durationThreshold: 16, buffered: false } as PerformanceObserverInit);
    dom.addEventListener(
      'keydown',
      (event) => {
        if (!S.measuring) return;
        S.pending = { tIn: event.timeStamp, ime: event.keyCode === 229 };
        S.keys.push(S.pending);
      },
      true,
    );
    // a composition step has no transaction of its own every time: its frame is the one after the input event
    dom.addEventListener(
      'input',
      (event) => {
        if (!S.measuring || !(event as InputEvent).isComposing) return;
        const record: { tIn: number; tRaf?: number } = { tIn: event.timeStamp };
        S.imeInputs.push(record);
        void afterPaint().then((p) => (record.tRaf = p.raf));
      },
      true,
    );
    editor.on('transaction', ({ transaction }) => {
      // the binding's own transactions (a remote change, its fix-ups): `isBindingTransaction` of src/artifacts/yjs
      if (!S.measuring || !transaction.docChanged || ['y-sync-transaction', 'y-sync-append', 'y-sync$'].some((key) => transaction.getMeta(key) != null)) return;
      const key = S.pending;
      if (!key || key.tTx !== undefined) return;
      key.tTx = rel();
      queueMicrotask(() => {
        key.local = S.local;
        key.clock = handle.doc.store.getClock(handle.doc.clientID);
      });
      void afterPaint().then((p) => {
        key.tRaf = p.raf;
        key.tPost = p.post;
      });
    });
    // the composition hold: each set and clear, the flush's time and how many doc updates it applied
    const holdRemote = provider.holdRemote.bind(provider) as AnyFn as (on: boolean) => void;
    let byCap = false;
    const log = provider.log.bind(provider) as AnyFn as (line: string) => void;
    provider.log = (line: string) => {
      S.providerLog.push(line);
      if (line.includes('cap')) byCap = true;
      log(line);
    };
    provider.holdRemote = (on: boolean) => {
      if (on) {
        const open = S.holds.at(-1);
        if (!open || open.off !== undefined) S.holds.push({ on: rel(), buffered: 0, byCap: false });
        holdRemote(true);
        return;
      }
      const hold = S.holds.at(-1);
      const buffered = provider.buffered.length;
      S.inFlush = { updates: 0 };
      const started = rel();
      holdRemote(false);
      const flushMs = rel() - started;
      if (hold && hold.off === undefined) Object.assign(hold, { off: rel(), buffered, flushMs, updatesInFlush: S.inFlush.updates, byCap });
      S.inFlush = null;
      byCap = false;
    };
    return { clientID: handle.doc.clientID };
  }, EDITOR_SELECTOR(artifactId));
}

export const startMeasuring = (page: Page) =>
  page.evaluate(() => {
    const S = (window as unknown as { __scale: { measuring: boolean; keys: unknown[]; slow: unknown[]; longTasks: unknown[]; holds: unknown[]; imeInputs: unknown[]; providerLog: unknown[] } }).__scale;
    S.keys = [];
    S.slow = [];
    S.longTasks = [];
    S.holds = [];
    S.imeInputs = [];
    S.providerLog = [];
    S.measuring = true;
  });

export const typingReport = (page: Page): Promise<TypingReport> =>
  page.evaluate(() => {
    const S = (window as unknown as { __scale: { measuring: boolean } & Omit<TypingReport, 'origin'> }).__scale;
    S.measuring = false;
    return { origin: performance.timeOrigin, keys: S.keys, acks: S.acks, slow: S.slow, longTasks: S.longTasks, clientID: S.clientID, holds: S.holds, providerLog: S.providerLog, imeInputs: S.imeInputs };
  });

/** Window B's watch: each new clock of A's client the replica receives, when, and the frame after. */
export async function watchRemote(page: Page, artifactId: string, client: number): Promise<void> {
  await page.evaluate(
    ([selector, watched]) => {
      interface Handle {
        doc: { on(name: 'update', fn: (u: Uint8Array, origin: unknown) => void): void; store: { getClock(client: number): number } };
        provider: unknown;
      }
      const dom = document.querySelector(selector) as (HTMLElement & { editor?: { extensionManager: { extensions: Array<{ name: string; options: { hold: Handle } }> } } }) | null;
      if (!dom?.editor) throw new Error(`no editor at ${selector}`);
      const handle = dom.editor.extensionManager.extensions.find((e) => e.name === 'collaboration')!.options.hold;
      const seen: Array<{ clock: number; at: number; raf?: number }> = [];
      let last = handle.doc.store.getClock(watched);
      (window as unknown as { __remote: typeof seen }).__remote = seen;
      handle.doc.on('update', (_update, origin) => {
        if (origin !== handle.provider) return;
        const clock = handle.doc.store.getClock(watched);
        if (clock <= last) return;
        last = clock;
        const entry: { clock: number; at: number; raf?: number } = { clock, at: performance.timeOrigin + performance.now() };
        seen.push(entry);
        requestAnimationFrame(() => (entry.raf = performance.timeOrigin + performance.now()));
      });
    },
    [EDITOR_SELECTOR(artifactId), client] as const,
  );
}
export const remoteSeen = (page: Page) => page.evaluate(() => (window as unknown as { __remote: Array<{ clock: number; at: number; raf?: number }> }).__remote);

/** The keystrokes' "painted in window B" times: A's keystroke (absolute) to B's frame after it saw that clock. */
export function paintedInB(report: TypingReport, seen: Array<{ clock: number; at: number; raf?: number }>): number[] {
  const out: number[] = [];
  for (const key of report.keys) {
    if (key.clock === undefined) continue;
    const t = report.origin + key.tIn;
    const hit = seen.find((s) => s.clock >= key.clock! && s.raf !== undefined);
    if (hit) out.push(hit.raf! - t);
  }
  return out;
}

/** The keystroke measures of a typing report (S7b's rows 1 to 3). */
export function keystrokeMeasures(report: TypingReport) {
  const typed = report.keys.filter((k) => !('ime' in k && (k as { ime?: boolean }).ime));
  const framed = typed.filter((k) => k.tRaf !== undefined);
  const acked = typed.filter((k) => k.local !== undefined && report.acks[k.local - 1] !== undefined);
  // Event Timing reports only entries of 16 ms or more; a keystroke without one was presented in under 16 ms, counted at 16
  const keydowns = report.slow.filter((e) => e.name === 'keydown');
  const presented = typed.map((k) => keydowns.find((e) => Math.abs(e.start - k.tIn) < 1)?.duration ?? 16);
  return {
    keystrokes: typed.length,
    noTransaction: typed.filter((k) => k.tTx === undefined).length,
    frame: stats(framed.map((k) => k.tRaf! - k.tIn)),
    postPaint: stats(framed.map((k) => k.tPost! - k.tIn)),
    presented: stats(presented),
    presentedReported: keydowns.length,
    ack: stats(acked.map((k) => report.acks[k.local! - 1]! - k.tIn)),
    acked: acked.length,
    longTasks: { n: report.longTasks.length, max: Math.max(0, ...report.longTasks.map((l) => l.duration)) },
  };
}

// ---- opening, history and memory ------------------------------------------------------------------------------------

/** Arms the page to time an open: from the pointer press that opens `artifactId` to the frame after its editor holds at least `minBlocks` blocks. */
export async function armOpen(page: Page, artifactId: string, minBlocks: number): Promise<void> {
  await page.evaluate(
    ([selector, min]) => {
      const w = window as unknown as { __open: { t0?: number; tFound?: number; raf?: number; post?: number; blocks?: number } | null };
      const open: { t0?: number; tFound?: number; raf?: number; post?: number; blocks?: number } = {};
      w.__open = open;
      const press = (event: Event) => {
        if (open.t0 === undefined) open.t0 = event.timeStamp;
      };
      document.addEventListener('pointerdown', press, true);
      const check = () => {
        if (open.t0 === undefined || open.tFound !== undefined) return;
        const dom = document.querySelector(selector);
        if (!dom || dom.childElementCount < min) return;
        open.tFound = performance.now();
        open.blocks = dom.childElementCount;
        observer.disconnect();
        document.removeEventListener('pointerdown', press, true);
        requestAnimationFrame(() => {
          open.raf = performance.now();
          const channel = new MessageChannel();
          channel.port1.onmessage = () => (open.post = performance.now());
          channel.port2.postMessage(null);
        });
      };
      const observer = new MutationObserver(check);
      observer.observe(document.body, { childList: true, subtree: true });
    },
    [EDITOR_SELECTOR(artifactId), minBlocks] as const,
  );
}
export async function openResult(page: Page): Promise<{ toPaintMs: number; toPostPaintMs: number; blocks: number }> {
  const deadline = Date.now() + 30_000;
  for (;;) {
    const open = await page.evaluate(() => (window as unknown as { __open: { t0?: number; raf?: number; post?: number; blocks?: number } | null }).__open);
    if (open?.post !== undefined) return { toPaintMs: open.raf! - open.t0!, toPostPaintMs: open.post - open.t0!, blocks: open.blocks! };
    if (Date.now() > deadline) throw new Error(`the open never painted: ${JSON.stringify(open)}`);
    await page.waitForTimeout(25);
  }
}

/**
 * Arms the page to time a history preview's enter (`mode: 'enter'`: the preview's own editor bound to the version and
 * drawn — at least `minBlocks` blocks — and the bar's change count drawn, which waits for the preview's extra
 * background render of every tab, Decision Log 30, then the frame after) or leave (`'leave'`: the preview editor gone,
 * the bar gone and the live editor shown again, then the frame after), from the pointer press.
 */
export async function armHistory(page: Page, artifactId: string, mode: 'enter' | 'leave', minBlocks = 1): Promise<void> {
  await page.evaluate(
    ([scopeSelector, which, min]) => {
      const w = window as unknown as { __hist: { t0?: number; raf?: number; post?: number } };
      const state: { t0?: number; raf?: number; post?: number; done?: boolean } = {};
      w.__hist = state;
      const scope = document.querySelector(scopeSelector);
      if (!scope) throw new Error(`no ${scopeSelector}`);
      type Pm = HTMLElement & { editor?: { storage: { collaboration?: { history: unknown } } } };
      const preview = () => scope.querySelector<Pm>('.ProseMirror[data-editor="preview"]');
      const live = () => scope.querySelector<Pm>('.ProseMirror[data-editor="live"]');
      const press = (event: Event) => {
        if (state.t0 === undefined) state.t0 = event.timeStamp;
      };
      document.addEventListener('pointerdown', press, true);
      const bar = () => document.querySelector('[role="toolbar"][aria-label="Version preview"]');
      const ready = () => {
        if (which === 'enter') {
          const shown = preview();
          return !!shown && shown.editor?.storage.collaboration?.history != null && shown.querySelectorAll('p, h1, h2, h3').length >= min && /\d+ changes?/.test(bar()?.textContent ?? '');
        }
        const back = live();
        return preview() === null && bar() === null && !!back && back.closest('[hidden]') === null;
      };
      const check = () => {
        if (state.t0 === undefined || state.done) return;
        if (!ready()) return;
        state.done = true;
        observer.disconnect();
        document.removeEventListener('pointerdown', press, true);
        requestAnimationFrame(() => {
          state.raf = performance.now();
          const channel = new MessageChannel();
          channel.port1.onmessage = () => (state.post = performance.now());
          channel.port2.postMessage(null);
        });
      };
      const observer = new MutationObserver(check);
      observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true });
    },
    [`[data-artifact-tab="${artifactId}"]`, mode, minBlocks] as const,
  );
}
export async function historyResult(page: Page): Promise<{ toPaintMs: number; toPostPaintMs: number }> {
  const deadline = Date.now() + 30_000;
  for (;;) {
    const state = await page.evaluate(() => (window as unknown as { __hist: { t0?: number; raf?: number; post?: number } }).__hist);
    if (state.post !== undefined) return { toPaintMs: state.raf! - state.t0!, toPostPaintMs: state.post - state.t0! };
    if (Date.now() > deadline) throw new Error(`the history view never painted: ${JSON.stringify(state)}`);
    await page.waitForTimeout(25);
  }
}

/** Every renderer's working set (MB) by window id, and the engine host's (a utility process). */
export async function processMemory(app: import('@playwright/test').ElectronApplication): Promise<{ renderers: Array<{ windowId: number; pid: number; workingSetMB: number }>; utility: Array<{ pid: number; name: string; workingSetMB: number }> }> {
  return app.evaluate(({ app: electronApp, BrowserWindow }) => {
    const metrics = electronApp.getAppMetrics();
    const byPid = new Map(metrics.map((m) => [m.pid, m]));
    const renderers = BrowserWindow.getAllWindows().map((win) => {
      const pid = win.webContents.getOSProcessId();
      return { windowId: win.id, pid, workingSetMB: +((byPid.get(pid)?.memory.workingSetSize ?? 0) / 1024).toFixed(1) };
    });
    const utility = metrics.filter((m) => m.type === 'Utility').map((m) => ({ pid: m.pid, name: m.serviceName ?? m.name ?? '', workingSetMB: +(m.memory.workingSetSize / 1024).toFixed(1) }));
    return { renderers, utility };
  });
}

/** The renderer's JavaScript heap in use (MB), through the page's DevTools protocol. */
export async function jsHeapMB(page: Page): Promise<number> {
  const cdp = await page.context().newCDPSession(page);
  try {
    const { usedSize } = (await cdp.send('Runtime.getHeapUsage')) as { usedSize: number };
    return +(usedSize / 1024 / 1024).toFixed(1);
  } finally {
    await cdp.detach();
  }
}

/** A full garbage collection in the page's renderer (DevTools protocol), for a working set read after it. */
export async function collectGarbage(page: Page): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send('HeapProfiler.collectGarbage');
  } finally {
    await cdp.detach();
  }
}

/** The editor's caret at the end of block `blockId`, focused, resolving once the DOM holds it (the harness's `placeCaret`). */
export async function caretAtEnd(page: Page, artifactId: string, blockId: string): Promise<void> {
  await page.evaluate(
    async ([selector, id]) => {
      interface PMNode {
        attrs: Record<string, unknown>;
        isTextblock: boolean;
        nodeSize: number;
      }
      interface View {
        dom: HTMLElement;
        focus(): void;
        posAtDOM(node: Node, offset: number): number;
        state: { doc: { descendants(fn: (node: PMNode, pos: number) => boolean | void): void } };
      }
      const dom = document.querySelector(selector) as (HTMLElement & { editor?: { view: View; commands: { setTextSelection(pos: number): void; scrollIntoView(): void } } }) | null;
      const editor = dom?.editor;
      if (!editor) throw new Error(`no editor at ${selector}`);
      let pos = -1;
      editor.view.state.doc.descendants((node, at) => {
        if (pos >= 0) return false;
        if (node.attrs.id === id && node.isTextblock) {
          pos = at + node.nodeSize - 1;
          return false;
        }
        return true;
      });
      if (pos < 0) throw new Error(`no text block ^${id}`);
      editor.commands.setTextSelection(pos);
      editor.view.focus();
      editor.commands.scrollIntoView();
      const deadline = Date.now() + 2_000;
      for (;;) {
        const selection = document.getSelection();
        if (editor.view.dom.contains(document.activeElement) && selection?.isCollapsed && selection.focusNode && editor.view.posAtDOM(selection.focusNode, selection.focusOffset) === pos) return;
        if (Date.now() > deadline) throw new Error(`the editor never took the focus at ${pos}`);
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    },
    [EDITOR_SELECTOR(artifactId), blockId] as const,
  );
}

/** A block's text in the page's editor (ProseMirror's own). */
export const blockText = (page: Page, artifactId: string, blockId: string): Promise<string | null> =>
  page.evaluate(
    ([selector, id]) => {
      const dom = document.querySelector(selector) as (HTMLElement & { editor?: { state: { doc: { descendants(fn: (node: { attrs: Record<string, unknown>; textContent: string }) => boolean): void } } } }) | null;
      let text: string | null = null;
      dom?.editor?.state.doc.descendants((node) => {
        if (text !== null) return false;
        if (node.attrs.id === id) {
          text = node.textContent;
          return false;
        }
        return true;
      });
      return text;
    },
    [EDITOR_SELECTOR(artifactId), blockId] as const,
  );

/** The replica's save state in the page (the editor's handle). */
export const replicaState = (page: Page, artifactId: string) =>
  page.evaluate((selector) => {
    const dom = document.querySelector(selector) as (HTMLElement & { editor?: { extensionManager: { extensions: Array<{ name: string; options: { hold: { state(): { phase: string; synced: boolean; unsaved: number; revision: number } } } }> } } }) | null;
    return dom?.editor?.extensionManager.extensions.find((e) => e.name === 'collaboration')?.options.hold.state() ?? null;
  }, EDITOR_SELECTOR(artifactId));

// ---- the IME drive (S7b's `imeStep`, as e2e/document-editor.spec.ts sends it) ---------------------------------------------

export async function imeStep(cdp: CDPSession, step: Step, steps: Step[]): Promise<void> {
  switch (step.kind) {
    case 'key':
      await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', windowsVirtualKeyCode: 229, nativeVirtualKeyCode: 229, key: step.key, code: step.code });
      break;
    case 'compose':
      await cdp.send('Input.imeSetComposition', { text: step.text, selectionStart: step.text.length, selectionEnd: step.text.length });
      break;
    case 'commit':
      await cdp.send('Input.insertText', { text: step.text });
      break;
    case 'plain':
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32, text: ' ', unmodifiedText: ' ' });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
      break;
    case 'backspace':
      await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', windowsVirtualKeyCode: 229, nativeVirtualKeyCode: 229, key: 'Backspace', code: 'Backspace' });
      break;
  }
  if (step.kind === 'compose') {
    const previous = steps
      .slice(0, steps.indexOf(step))
      .reverse()
      .find((s): s is Extract<Step, { kind: 'key' }> => s.kind === 'key');
    if (previous) await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: previous.keyCode, key: previous.key, code: previous.code });
  }
  if (step.kind === 'compose' || step.kind === 'plain') await new Promise((resolve) => setTimeout(resolve, 60 + Math.random() * 30));
}
