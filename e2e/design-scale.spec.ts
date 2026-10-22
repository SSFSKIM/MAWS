// The design scale gate (docs/doperpowers/plans/2026-10-16-p3-e1-design-workbench.md, M6, acceptance 7; E0's ratified
// table, spikes/p3-design/findings.txt (b)): the product build, the 24-board bench design (E0's exact mix with its card
// grids, src/artifacts/design/fixtures/bench.ts, one board 4,096×8,192) seeded through the renderer's design seam, an agent
// session driven through the host's scale seam (C's DeckScaleSeam under MAWS_DESIGN_PERF: A's real `artifact_read` and
// `artifact_publish` as the session, a design's publish through its adapter, the host loop sampled around each call).
// Every row is measured on the product's own routes, at the trials' 1-minute load, and judged on its WORST trial; no
// best-of-trials and no high-load waiver: a trial at a load of 10 or more is not acceptance, and the run fails then (the one
// median-judged row is DL39's one-board publish over the bench).
//   1 open      artifact-cold (the host's copy unloaded, seed and earlier replicas closed, nothing holding the design) in
//               a ready app: the library row's press (its pointerdown's timestamp) to every board's canvas laid out (the
//               tab's drawnAt, which waits each canvas's first layout pass); the tab constructor to drawn beside it; every
//               board's identity, size and element count verified in the DOM at ready                       ≤ 1,000 ms
//   2 frames    real wheel input through the world's own handler (pan at 25 %; a pinch zoom from fit to about 100 % and
//               back): a DevTools trace's main-thread work per frame, each top-level task whole in the renderer's
//               BeginFrame interval it starts in, never clipped at the frame's end, so a task longer than a frame reads
//               its whole length at any display rate (the input's handling, React, style, layout, paint, layerization
//               and commit all count; e2e/support/design-frames.ts), p95 over the active frames; not E0's 4 ms
//               callback-CPU stand-in. The window's display rate is recorded with the machine, not judged      ≤ 10 ms
//   2 drops     the rAF-gap proxy over its calibrated idle interval (≤ 2 %); the compositor's own PipelineReporter drops
//               beside it, separately labelled (≤ 2 %, or unavailable when the trace carries none)
//   2 stress    the same frame rows, a pan and a pinch zoom each in its own rows, for at least 5 s while the owner drags a
//               board by its title and the agent republishes that board (a card's fill, content unrelated to the frame)
//               on a 0.7 s grid: the gesture's window and every publication's request and answer on one clock, at least
//               3 publications asked and answered inside the window or the trial is unreadable; the cadence and changed
//               paths recorded; the dragged frame and the agent's fill both stand after it
//   3 relayout  a Theme background change through the Theme rail (the design's overrides: the scope moves, every canvas
//               invalidated in one batch), the world's scope verified to hold the requested token: the wall time of the
//               one FireAnimationFrame callback that holds all 24 canvases' first layout after the scope stood (DL39;
//               its thread time, the frame's following style/layout/paint, the Enter→last latency and the listeners'
//               spread recorded beside it, none of them judged)                                            ≤ 50 ms
//   4 memory    the renderer's working set (its window's own PID in Electron's metrics, KiB → MiB), ordinary and after a
//               forced collection, with every export window closed (a missing, non-finite or non-positive reading is
//               unreadable): ordinary ≤ 500 MB (500 × 10⁶ bytes)
//   5 publish   the host loop's busy time over one agent publish (DL39, DL40): each bench board alone once, the median of
//               the 24 ≤ 65 ms; every heaviest board (182 elements: the posters, the 4,096² and the 4,096×8,192) alone three
//               times, the worst ≤ 100 ms; the whole design's 24 boards with the manifest unchanged, the worst ≤ 300 ms;
//               the longest gap and wall time beside each
//   6 pdf       every board as one PDF through main's export service: the request to the committed file, its 24 pages
//               checked against each board's native size                                                    < 55 s
// The first trial waits, after the seed, for the measured specs' shared quiet admission (support/quiet.ts: the 1-minute
// load under 5 on two reads 30 s apart, at most three minutes; on its expiry the trials run as above), recorded as the
// results' `quiet`. Raw trials, frame lists, publish cadences, the machine and its loads go to
// test-results/design-scale.json, each trial's trace to test-results/design-scale/. Run on purpose only, at the quietest
// load the machine gives:
//   pnpm e2e:design-scale          (MAWS_DESIGN_SCALE=1 inline; never in a default list)
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { cpus, loadavg, release, totalmem } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { BENCH_CARD, BENCH_CARD_FILLS, benchBoards, benchDesignFiles, type BenchBoard } from '../src/artifacts/design/fixtures/bench';
import { frameWork, inside, rafDrops, relayoutCallback, type FrameWork, type RafDrops, type Span, type TraceEvent } from './support/design-frames';
import { armLayoutProbe, boardOf, boardsOf, disarmLayoutProbe, findIn, frameOf, headerAction, layoutProbeResult, ok, seamInstalled, seed, tabsOf, type TabView } from './support/design';
import { PerfSeam, type LoopStats } from './support/document-scale';
import { launchMaws, REPO_ROOT, type MawsLaunch } from './support/launch';
import { quietWait } from './support/quiet';

test.skip(process.env.MAWS_DESIGN_SCALE !== '1', 'the design scale gate runs only under MAWS_DESIGN_SCALE=1');
test.describe.configure({ timeout: 3_600_000 });

const RESULTS = join(REPO_ROOT, 'test-results', 'design-scale.json');
const TRACES = join(REPO_ROOT, 'test-results', 'design-scale');
const UNLOAD_WAIT_MS = 66_000; // the host's idle unload (A's IDLE_UNLOAD_MS, 60 s) and a margin
const TRIALS = 3;
const LOAD_LIMIT = 10;
const QUIET_WAIT_MS = 10 * 60_000;
const PUBLISH_EVERY_MS = 700;
const STRESS_MS = 5_000; // a contention gesture's least length: several publications fit wholly inside it
const TITLE = 'Scale 24';
const AGENT = 'design-agent';
const POPPLER = '/opt/homebrew/bin';
const BOARDS = benchBoards();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const load1 = (): number => +loadavg()[0]!.toFixed(2);
const boardPath = (id: string) => `project/boards/${id}.html`;
const rgbOf = (hex: string) => `rgb(${[1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16)).join(', ')})`;
/** The median: the middle value, or the mean of the middle two of an even count. */
const median = (xs: number[]) => {
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

/** Waits (bounded) for a 1-minute load under the limit; answers the load the trial starts at. */
async function quiet(): Promise<number> {
  const until = Date.now() + QUIET_WAIT_MS;
  while (load1() >= LOAD_LIMIT && Date.now() < until) await sleep(15_000);
  return load1();
}

// ---- rows: each judged on its worst trial; a trial at load ≥ 10 is not acceptance ------------------------------------

type Verdict = 'met' | 'missed' | 'not acceptance (load ≥ 10)' | 'unreadable' | 'recorded';
interface Trial {
  /** null when the trial could not be read (its error says why); never a stand-in number. */
  value: number | null;
  load: number;
  note?: string;
  error?: string;
}
interface Row {
  row: string;
  measure: string;
  unit: string;
  bound: string;
  limit: number | null;
  /** Strictly below the limit (the PDF's "< 55 s"), else at most. */
  strict?: boolean;
  judgedBy: 'worst' | 'median';
  value: number | null; // the worst trial's, or the trials' median (judgedBy)
  verdict: Verdict;
  loads: number[];
  trials: Trial[];
}

class Rows {
  readonly rows: Row[] = [];
  private readonly extra: Record<string, unknown> = {};
  constructor(private readonly meta: Record<string, unknown>) {}

  /** A row judged on its worst trial, or (DL39's one-board publish row alone) on the median of its trials. */
  add(row: string, measure: string, unit: string, limit: number | null, bound: string, trials: Trial[], strict = false, judgedBy: 'worst' | 'median' = 'worst'): Row {
    const read = trials.filter((t) => t.value !== null).map((t) => t.value!);
    const worst = read.length === 0 ? null : judgedBy === 'median' ? median(read) : Math.max(...read);
    const loads = trials.map((t) => t.load);
    const verdict: Verdict =
      trials.length === 0 || trials.some((t) => t.value === null) ? 'unreadable'
      : limit === null ? 'recorded'
      : loads.some((l) => l >= LOAD_LIMIT) ? 'not acceptance (load ≥ 10)'
      : (strict ? worst! < limit : worst! <= limit) ? 'met'
      : 'missed';
    const entry: Row = { row, measure, unit, bound, limit, ...(strict && { strict }), judgedBy, value: worst === null ? null : +worst.toFixed(3), verdict, loads, trials: trials.map((t) => ({ ...t, value: t.value === null ? null : +t.value.toFixed(3) })) };
    this.rows.push(entry);
    this.write();
    console.log(`[design scale] ${row}: ${entry.value ?? '—'} ${unit} (${judgedBy} of ${trials.length}; ${verdict}; bound ${bound}; trials ${trials.map((t) => `${t.value === null ? `unreadable (${t.error})` : t.value.toFixed(2)} at load ${t.load}`).join(', ')})`);
    return entry;
  }

  write(extra: Record<string, unknown> = {}): void {
    Object.assign(this.extra, extra);
    mkdirSync(join(RESULTS, '..'), { recursive: true });
    writeFileSync(RESULTS, `${JSON.stringify({ ...this.meta, ...this.extra, judging: { rule: 'each row on its worst trial (DL39: the one-board publish row on the median of all 24 boards, its heaviest boards on their worst); a trial at a 1-minute load of 10 or more is not acceptance; an unreadable trial is never replaced by a number', loadLimit: LOAD_LIMIT }, rows: this.rows }, null, 2)}\n`);
  }
}

// ---- the app --------------------------------------------------------------------------------------------------------

let launch: MawsLaunch | null = null;
let userData: string | null = null;
test.afterEach(async () => {
  await launch?.cleanup();
  launch = null;
  if (userData) rmSync(userData, { recursive: true, force: true });
  userData = null;
});

async function showLibrary(page: Page): Promise<void> {
  await page.locator('[data-region="sidebar"]').getByRole('button', { name: 'Artifacts', exact: true }).click();
  await expect(page.locator('[data-library]')).toBeVisible({ timeout: 15_000 });
}

/** The newest main tab showing the design (a closed tab's state never answers for the one opened after it). */
const mainTab = async (page: Page, id: string): Promise<TabView | undefined> => (await tabsOf(page, id)).filter((t) => t.surface === 'main').sort((a, b) => b.timings.openedAt - a.timings.openedAt)[0];

/** What the main tab draws, read at ready: each board's identity, drawn size and element nodes. */
async function drawnBoards(tab: Locator): Promise<{ id: string; w: number; h: number; elements: number }[]> {
  return tab.locator('[data-design-world] [data-board-id]').evaluateAll((nodes) =>
    nodes.map((n) => {
      const slide = n.querySelector<HTMLElement>('.maws-slide');
      return { id: (n as HTMLElement).dataset.boardId!, w: slide?.offsetWidth ?? -1, h: slide?.offsetHeight ?? -1, elements: slide ? slide.querySelectorAll('[data-eid]').length : -1 };
    }),
  );
}

/** Opens the design from the library in a main tab: the row's press to every canvas laid out, and what was drawn. */
async function openTimed(page: Page, id: string): Promise<{ inputToReady: number; constructorToDrawn: number; inputToConstructor: number; tab: Locator; drawn: Awaited<ReturnType<typeof drawnBoards>> }> {
  await showLibrary(page);
  // the press's own timestamp (the page's clock, as the tab's timings are)
  await page.evaluate(() => {
    const w = window as unknown as { __designPress?: number | null };
    w.__designPress = null;
    window.addEventListener('pointerdown', (e) => (w.__designPress ??= e.timeStamp), { capture: true, once: true });
  });
  await page.locator('[data-library]').getByRole('article', { name: TITLE, exact: true }).click({ timeout: 15_000 });
  const tab = page.locator(`[data-region="main"] [data-artifact-tab="${id}"]`);
  await expect(tab.locator('[data-design-editor]')).toBeVisible({ timeout: 30_000 });
  await expect.poll(async () => (await mainTab(page, id))?.timings.drawnAt !== undefined, { timeout: 60_000, message: 'every board of the open is laid out' }).toBe(true);
  const timings = (await mainTab(page, id))!.timings;
  const press = await page.evaluate(() => (window as unknown as { __designPress?: number | null }).__designPress ?? null);
  if (press === null) throw new Error('the library row’s press was not seen');
  const drawn = await drawnBoards(tab);
  return { inputToReady: timings.drawnAt! - press, constructorToDrawn: timings.drawnAt! - timings.openedAt, inputToConstructor: timings.openedAt - press, tab, drawn };
}

async function closeTab(page: Page): Promise<void> {
  await page.getByRole('button', { name: `Close ${TITLE}`, exact: true }).click();
  await expect(page.getByRole('button', { name: `Close ${TITLE}`, exact: true })).toHaveCount(0, { timeout: 15_000 });
}

// ---- the agent, through the host's scale seam -----------------------------------------------------------------------

interface ToolCall<R> {
  ok: true;
  isError: boolean;
  result?: R;
  text: string;
  wallMs: number;
  loop: LoopStats;
  busyMs: number;
}
type ReadResult = { revision: number; files: Record<string, string> };
type PublishResult = { revision: number; changed: string[] };

/** The agent's view of the design: its last read's files, updated by what it publishes. */
class DesignAgent {
  files: Record<string, string> = {};
  constructor(private readonly seam: PerfSeam, readonly artifactId: string) {}

  async read(): Promise<ToolCall<ReadResult>> {
    const answer = await this.seam.send<ToolCall<ReadResult>>({ cmd: 'call', session: AGENT, tool: 'artifact_read', args: { artifact: this.artifactId } });
    if (answer.isError) throw new Error(`the agent's read was refused: ${answer.text}`);
    this.files = { ...answer.result!.files };
    return answer;
  }

  /** The card's fill on a board as the agent last saw it. */
  fillOf(boardId: string): string {
    const tag = /<div\b[^>]*\bid="c0"[^>]*>/.exec(this.files[boardPath(boardId)] ?? '')?.[0];
    const fill = tag ? /background:\s*([^;"]+)/.exec(tag)?.[1]?.trim() : undefined;
    if (!fill) throw new Error(`${boardId}'s ${BENCH_CARD} has no fill in the agent's read`);
    return fill;
  }

  /**
   * One publish restyling each board's card (its fill toggled), from the revision it last saw; with `manifest`, the
   * manifest as last read rides along unchanged (sent, not changed).
   */
  async publish(boardIds: string[], options: { manifest?: boolean } = {}): Promise<ToolCall<PublishResult> & { fills: Record<string, string>; sent: number }> {
    const sent: Record<string, string> = {};
    const fills: Record<string, string> = {};
    for (const boardId of boardIds) {
      const path = boardPath(boardId);
      const now = this.fillOf(boardId).toLowerCase();
      const next = now === BENCH_CARD_FILLS[0] ? BENCH_CARD_FILLS[1] : BENCH_CARD_FILLS[0];
      sent[path] = this.files[path]!.replace(/<div\b[^>]*\bid="c0"[^>]*>/, (tag) => tag.replace(/background:\s*[^;"]+/, `background:${next}`));
      if (sent[path] === this.files[path]) throw new Error(`${path}: the card's fill did not change`);
      fills[boardId] = next;
    }
    const boards = Object.keys(sent).sort();
    if (options.manifest) sent['project/canvas.json'] = this.files['project/canvas.json']!;
    const answer = await this.seam.send<ToolCall<PublishResult>>({ cmd: 'call', session: AGENT, tool: 'artifact_publish', args: { artifact: this.artifactId, baseRevision: 'last', files: sent } });
    if (answer.isError) throw new Error(`the agent's publish was refused: ${answer.text}`);
    expect([...answer.result!.changed].sort(), 'the publish changed exactly the restyled boards').toEqual(boards);
    Object.assign(this.files, sent);
    return { ...answer, fills, sent: Object.keys(sent).length };
  }
}

interface Publication {
  due: number;
  requestedAt: number;
  answeredAt: number;
  wallMs: number;
  busyMs: number;
  loopMaxMs: number;
  changed: string[];
}
/** The agent republishing `boardId` on a 0.7 s grid until `until` settles; each publication's actual start recorded. */
async function republishing(agent: DesignAgent, boardId: string, until: Promise<unknown>): Promise<Publication[]> {
  let done = false;
  void until.finally(() => (done = true));
  const t0 = Date.now();
  const out: Publication[] = [];
  for (let k = 1; !done; k++) {
    await sleep(Math.max(0, t0 + k * PUBLISH_EVERY_MS - Date.now()));
    if (done) break;
    const requestedAt = Date.now();
    const answer = await agent.publish([boardId]);
    out.push({ due: t0 + k * PUBLISH_EVERY_MS, requestedAt, answeredAt: Date.now(), wallMs: answer.wallMs, busyMs: answer.busyMs, loopMaxMs: answer.loop.max, changed: answer.result!.changed });
  }
  return out;
}

// ---- the page's frames ------------------------------------------------------------------------------------------------

const TRACE_CATEGORIES = ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'disabled-by-default-devtools.timeline.frame', 'toplevel', 'blink.user_timing', 'benchmark', 'cc'];

/** The window's trace could not be started (nothing of the gesture ran under it). */
class TraceUnavailable extends Error {}

/** `run` under a DevTools trace of the window (Chromium's Tracing domain on the page's session), its events answered. */
async function traced<T>(page: Page, run: () => Promise<T>): Promise<{ result: T; events: TraceEvent[] }> {
  const cdp = await page.context().newCDPSession(page);
  const events: TraceEvent[] = [];
  cdp.on('Tracing.dataCollected', ({ value }) => events.push(...(value as unknown as TraceEvent[])));
  const complete = new Promise<void>((resolve) => cdp.once('Tracing.tracingComplete', () => resolve()));
  try {
    await cdp.send('Tracing.start', { transferMode: 'ReportEvents', traceConfig: { recordMode: 'recordAsMuchAsPossible', includedCategories: TRACE_CATEGORIES, excludedCategories: ['*'] } });
  } catch (error) {
    await cdp.detach().catch(() => {});
    throw new TraceUnavailable(error instanceof Error ? error.message : String(error));
  }
  let result: T;
  try {
    result = await run();
  } finally {
    await cdp.send('Tracing.end');
    await complete;
    await cdp.detach();
  }
  return { result: result!, events };
}

/** `count` idle animation frame timestamps (the proxy's calibration). */
const idleFrames = (page: Page, count = 61) =>
  page.evaluate(
    (n) =>
      new Promise<number[]>((resolve) => {
        const stamps: number[] = [];
        const tick = (t: number) => {
          stamps.push(t);
          if (stamps.length >= n) resolve(stamps);
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    count,
  );
const startFrames = (page: Page) =>
  page.evaluate(() => {
    const r: { on: boolean; stamps: number[] } = { on: true, stamps: [] };
    (window as unknown as { __designRaf: typeof r }).__designRaf = r;
    const tick = (t: number) => {
      if (!r.on) return;
      r.stamps.push(t);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    performance.mark('design-scale-start');
  });
const stopFrames = (page: Page) =>
  page.evaluate(() => {
    performance.mark('design-scale-end');
    const r = (window as unknown as { __designRaf: { on: boolean; stamps: number[] } }).__designRaf;
    r.on = false;
    return r.stamps;
  });

interface FrameTrial {
  work: FrameWork | null;
  drops: RafDrops | null;
  /** The gesture's own start and end on the test's clock (Date.now(), as a publication's requestedAt and answeredAt). */
  span: Span;
  error?: string;
}
/** A gesture measured: its trace's frame work and the rAF proxy, the trace kept on disk. */
async function measureFrames(page: Page, name: string, gesture: () => Promise<void>): Promise<FrameTrial> {
  const idle = await idleFrames(page);
  let span: Span = { startedAt: NaN, endedAt: NaN };
  const run = async () => {
    await startFrames(page);
    const startedAt = Date.now();
    try {
      await gesture();
    } finally {
      span = { startedAt, endedAt: Date.now() };
      await sleep(100); // the last input's frame
    }
    return stopFrames(page);
  };
  const errors: string[] = [];
  let stamps: number[];
  let events: TraceEvent[] | null = null;
  try {
    ({ result: stamps, events } = await traced(page, run));
  } catch (error) {
    if (!(error instanceof TraceUnavailable)) throw error;
    // no trace could be started: the gesture runs untraced for the rAF proxy alone, the frame work unreadable
    errors.push(`trace unavailable: ${error.message}`);
    stamps = await run();
  }
  const out: FrameTrial = { work: null, drops: null, span };
  if (events) {
    mkdirSync(TRACES, { recursive: true });
    writeFileSync(join(TRACES, `${name}.trace.json`), JSON.stringify({ traceEvents: events }));
    try {
      out.work = frameWork(events, 'design-scale-start', 'design-scale-end');
    } catch (error) {
      errors.push(`trace: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  try {
    out.drops = rafDrops(idle, stamps);
  } catch (error) {
    errors.push(`rAF: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (errors.length > 0) out.error = errors.join('; ');
  return out;
}

// ---- memory ---------------------------------------------------------------------------------------------------------

/** The window's renderer working set: its own PID found in Electron's metrics (no PID, no figure), KiB → MiB and bytes. */
async function rendererMemory(launch: MawsLaunch): Promise<{ pid: number; windows: number; workingSetKiB: number; mib: number; bytes: number }> {
  const read = await launch.app.evaluate(({ app, BrowserWindow }) => {
    const windows = BrowserWindow.getAllWindows();
    const pid = windows[0]!.webContents.getOSProcessId();
    const metric = app.getAppMetrics().find((m) => m.pid === pid);
    return { pid, windows: windows.length, workingSetKiB: metric ? metric.memory.workingSetSize : null };
  });
  if (read.workingSetKiB === null) throw new Error(`no metrics entry for the window's renderer pid ${read.pid}`);
  if (!Number.isFinite(read.workingSetKiB) || read.workingSetKiB <= 0) throw new Error(`the window's renderer pid ${read.pid} reads a working set of ${read.workingSetKiB} KiB`);
  return { pid: read.pid, windows: read.windows, workingSetKiB: read.workingSetKiB, mib: read.workingSetKiB / 1024, bytes: read.workingSetKiB * 1024 };
}

/** Each page's size in PDF points, from pdfinfo. */
function pageSizes(pdf: string): [number, number][] {
  const info = execFileSync(join(POPPLER, 'pdfinfo'), ['-f', '1', '-l', '999', pdf], { encoding: 'utf8' });
  return [...info.matchAll(/^Page\s+\d+ size:\s+([\d.]+) x ([\d.]+) pts/gm)].map((m) => [Number(m[1]), Number(m[2])]);
}

const worldPoint = async (tab: Locator) => {
  const box = (await tab.locator('[data-design-world]').boundingBox())!;
  return { box, mid: { x: box.x + box.width / 2, y: box.y + box.height / 2 } };
};
/** How many boards the world shows now, wholly or in part (what a pan's frames actually draw). */
const boardsInView = (tab: Locator) =>
  tab.locator('[data-design-world]').evaluate((world) => {
    const w = world.getBoundingClientRect();
    return Array.from(world.querySelectorAll('[data-board-id]')).filter((b) => {
      const r = b.getBoundingClientRect();
      return r.right > w.left && r.left < w.right && r.bottom > w.top && r.top < w.bottom;
    }).length;
  });
/** The first board brought to the middle of the world by the product's own commands: Zoom to board, then 25 % about it. */
const toFirstBoardAt25 = async (page: Page, tab: Locator, board: BenchBoard) => {
  await tab.getByRole('button', { name: `Board ${board.title} options`, exact: true }).click();
  await page.getByRole('menuitem', { name: 'Zoom to board' }).click();
  await tab.getByRole('combobox', { name: 'Zoom' }).selectOption('0.25');
};

test('the design scale gate on the 24-board bench: cold open, pan and zoom frame work and drops (alone and under a drag with the agent publishing), re-layout, memory, host publishes, the PDF', async () => {
  const loads: Record<string, number> = { start: load1() };
  userData = mkdtempSync('/tmp/maws-e2e-design-scale-');
  const perf = join(userData, 'design-perf');
  launch = await launchMaws({ userData, env: { MAWS_DESIGN_PERF: perf } });
  const { page, app } = launch;
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1600, 1000));
  await expect.poll(async () => (await ok<{ state: string }>(page, 'engine.hostState')).state, { timeout: 30_000, message: 'the engine host is ready' }).toBe('ready');
  await expect.poll(() => seamInstalled(page), { message: 'the renderer seam is installed' }).toBe('object');
  const seam = new PerfSeam(perf);
  await expect.poll(() => existsSync(join(perf, 'in')), { timeout: 10_000, message: 'the host started the design scale seam' }).toBe(true);
  const machine = {
    cpu: cpus()[0]?.model,
    cores: cpus().length,
    memoryGiB: +(totalmem() / 2 ** 30).toFixed(1),
    os: `${process.platform} ${release()}`,
    // the display the window is on, whose refresh paces the renderer's frames (recorded, not judged)
    ...(await app.evaluate(({ screen, BrowserWindow }) => {
      const bounds = BrowserWindow.getAllWindows()[0]!.getBounds();
      const display = screen.getDisplayMatching(bounds);
      return { electron: process.versions.electron, chrome: process.versions.chrome, display: { hz: display.displayFrequency, scale: display.scaleFactor }, window: bounds };
    })),
    build: process.env.MAWS_E2E_BUILD_KEY ?? null,
  };
  console.log(`[design scale] the window's display: ${machine.display.hz} Hz at scale ${machine.display.scale}`);
  const rows = new Rows({ run: new Date().toISOString(), design: 'benchDesignFiles(): E0’s 24-board mix with its card grids (src/artifacts/design/fixtures/bench.ts)', boards: BOARDS.map((b) => ({ id: b.id, size: b.size, w: b.w, h: b.h, elements: b.elements })), machine, loads });
  const failures: string[] = [];

  // the design, made by the owner and seeded from the bench's files; the seed's replica closes once the host has them
  const { artifact } = await ok<{ artifact: { id: string } }>(page, 'artifacts.create', { kind: 'design', title: TITLE });
  const id = artifact.id;
  const seeded = await seed(page, id, benchDesignFiles(TITLE));
  expect(seeded.held).toEqual([]);
  expect((await boardsOf(page, id)).map((b) => [b.id, b.frame])).toEqual(BOARDS.map((b) => [b.id, { x: b.x, y: b.y, w: b.w, h: b.h }]));
  const admission = await quietWait(); // the first trial's (support/quiet.ts), after the build, the launch and the seed
  console.log(`[design scale] the first trial's admission: ${admission.summary}`);
  rows.write({ quiet: admission });

  await test.step('1: open artifact-cold, three times: the row’s press to every canvas laid out, every board verified', async () => {
    const trials: Trial[] = [];
    const constructor: Trial[] = [];
    for (let k = 0; k < TRIALS; k++) {
      await sleep(UNLOAD_WAIT_MS); // nothing holds the design: the host unloads it
      const load = await quiet();
      const open = await openTimed(page, id);
      const end = load1();
      const want = BOARDS.map((b) => ({ id: b.id, w: b.w, h: b.h, elements: b.elements }));
      const mismatched = want.filter((b) => !open.drawn.some((d) => d.id === b.id && d.w === b.w && d.h === b.h && d.elements === b.elements));
      const note = `${open.drawn.length} boards drawn; constructor → drawn ${open.constructorToDrawn.toFixed(1)} ms; press → constructor ${open.inputToConstructor.toFixed(1)} ms${k === 0 ? '; the window’s first design open' : ''}`;
      if (open.drawn.length !== BOARDS.length || mismatched.length > 0) trials.push({ value: null, load: Math.max(load, end), error: `drawn boards differ from the bench: ${JSON.stringify({ drawn: open.drawn, mismatched })}` });
      else trials.push({ value: open.inputToReady, load: Math.max(load, end), note });
      constructor.push({ value: open.constructorToDrawn, load: Math.max(load, end) });
      await closeTab(page);
    }
    rows.add('1 open cold', 'artifact-cold open in a ready app: the library row’s pointerdown to every board’s canvas laid out (drawnAt), identities, sizes and element counts verified', 'ms', 1000, '≤ 1,000 ms (E0 123 ms world-only warm)', trials);
    rows.add('1 open cold (constructor)', 'the same opens: the tab’s constructor (openedAt) to every canvas laid out', 'ms', null, 'recorded beside row 1', constructor);
  });

  const { tab } = await openTimed(page, id);
  await tab.getByRole('combobox', { name: 'Zoom' }).selectOption('fit-all');
  const agent = new DesignAgent(seam, id);
  const first = await agent.read();
  expect(Object.keys(agent.files).filter((p) => p.startsWith('project/boards/'))).toHaveLength(24);
  rows.write({ agentFirstRead: { wallMs: first.wallMs, loopMaxMs: first.loop.max, busyMs: first.busyMs, load: load1() } });

  await test.step('5: the agent’s publishes through A’s real publish, the design open: every board once, the heaviest three times each, the whole design five times', async () => {
    await agent.publish([BOARDS[0]!.id]); // warm-up: the session's base becomes its own publish
    const publishOne = async (board: BenchBoard): Promise<Trial> => {
      const load = await quiet();
      const answer = await agent.publish([board.id]);
      await sleep(300);
      return { value: answer.busyMs, load: Math.max(load, load1()), note: `${board.id} (${board.size}, ${board.w}×${board.h}, ${board.elements} elements); longest loop gap ${answer.loop.max.toFixed(1)} ms; wall ${answer.wallMs.toFixed(1)} ms; changed ${answer.result!.changed.join(', ')}` };
    };
    // DL39: every bench board once, in the bench's order, judged on their median; the heaviest boards (every board tied
    // at the most elements: the 4,096×8,192 and whichever others reach it), three trials each, judged on their worst
    const sweep: Trial[] = [];
    for (const board of BOARDS) sweep.push(await publishOne(board));
    const most = Math.max(...BOARDS.map((b) => b.elements));
    const heaviest = BOARDS.filter((b) => b.elements === most);
    const heavy: Trial[] = [];
    for (const board of heaviest) for (let k = 0; k < TRIALS; k++) heavy.push(await publishOne(board));
    const whole: Trial[] = [];
    for (let k = 0; k < 5; k++) {
      const load = await quiet();
      const answer = await agent.publish(BOARDS.map((b) => b.id), { manifest: true });
      whole.push({ value: answer.busyMs, load: Math.max(load, load1()), note: `longest loop gap ${answer.loop.max.toFixed(1)} ms; wall ${answer.wallMs.toFixed(1)} ms; ${answer.sent} files sent (the manifest unchanged among them), ${answer.result!.changed.length} changed` });
      await sleep(1_000);
    }
    rows.add('5 publish one board (median of the bench)', 'each of the 24 bench boards published alone by the agent’s session through A’s real artifact_publish, once, in the bench’s order: the host loop’s busy time over the call (the 1 ms sampler’s gaps past its tick), the median of the 24; every board’s figure kept', 'ms', 65, '≤ 65 ms, median of the bench boards (DL40)', sweep, false, 'median');
    rows.add('5 publish one board (heaviest)', `the heaviest bench boards (${heaviest.map((b) => `${b.id} ${b.w}×${b.h}`).join(', ')}, ${most} elements) each published alone ${TRIALS} times: the host loop’s busy time over the call, the worst`, 'ms', 100, '≤ 100 ms, the heaviest board (DL39)', heavy);
    rows.add('5 publish whole design', 'the whole design in one publish: all 24 boards, each changed, and the manifest sent unchanged: the host loop’s busy time over the call', 'ms', 300, '≤ 300 ms', whole);
  });

  const frameRows = (label: string, what: string, trials: (FrameTrial & { load: number; note?: string })[]) => {
    rows.add(`2 ${label} frame work p95`, `${what}: main-thread work per frame (each top-level task whole in the renderer's BeginFrame interval it starts in, never clipped at the frame's end, so a task longer than a frame reads its whole length; the input's handling, React, style, layout, paint, layerization and commit), p95 over the active frames (DevTools trace)`, 'ms', 10, '≤ 10 ms of main-thread work per frame (DL40; not E0’s 0.4 ms callback CPU)', trials.map((t) => (t.work ? { value: t.work.active.p95, load: t.load, note: `${t.work.active.n} active of ${t.work.all.n} frames; all-frames p95 ${t.work.all.p95.toFixed(2)} ms; active max ${t.work.active.max.toFixed(2)} ms; ${t.work.inputs} inputs dispatched${t.note ? `; ${t.note}` : ''}` } : { value: null, load: t.load, error: t.error })));
    rows.add(`2 ${label} dropped (rAF proxy)`, `${what}: the rAF-gap proxy, frames skipped over the span’s frames at the calibrated idle interval`, '%', 2, '≤ 2 % (E0 0–0.4 %)', trials.map((t) => (t.drops ? { value: t.drops.share * 100, load: t.load, note: `${t.drops.dropped} of ${t.drops.expected} at ${t.drops.intervalMs.toFixed(2)} ms; longest gap ${t.drops.longestGapMs.toFixed(1)} ms` } : { value: null, load: t.load, error: t.error })));
    const compositor = trials.map((t) => t.work?.compositor ?? null);
    if (compositor.every((c) => c !== null))
      rows.add(`2 ${label} dropped (compositor)`, `${what}: the compositor’s PipelineReporter frames dropped, of its frames in the window`, '%', 2, '≤ 2 %', trials.map((t) => ({ value: (t.work!.compositor!.dropped / Math.max(1, t.work!.compositor!.frames)) * 100, load: t.load, note: `${t.work!.compositor!.dropped} of ${t.work!.compositor!.frames}; ${t.work!.compositor!.droppedFrameEvents} DroppedFrame events` })));
    else rows.write({ [`compositor ${label}`]: `unavailable: ${compositor.filter((c) => c === null).length} of ${trials.length} traces carry no PipelineReporter for the renderer (the rAF proxy row stands alone; no zero is substituted)` });
  };

  await test.step('2: pan at 25 % and a pinch zoom from fit to about 100 % and back, through the world’s wheel handler, three times each', async () => {
    const pans: (FrameTrial & { load: number; note?: string })[] = [];
    const zooms: (FrameTrial & { load: number; note?: string })[] = [];
    for (let k = 0; k < TRIALS; k++) {
      // anchored on real boards: the first phone at the world's middle at 25 %, so the pan's path (right and down, then
      // back) runs over the phones, tablets, desktops, slides, posters and the square rather than the empty middle of
      // the whole world's fit (the first run's setup, which panned over nothing)
      await toFirstBoardAt25(page, tab, BOARDS[0]!);
      const { mid } = await worldPoint(tab);
      await page.mouse.move(mid.x, mid.y);
      const before = (await mainTab(page, id))!.viewport!;
      const seenBefore = await boardsInView(tab);
      if (seenBefore === 0) failures.push(`pan ${k + 1}: no board in view at its start`);
      let load = await quiet();
      const pan = await measureFrames(page, `pan-${k + 1}`, async () => {
        for (let i = 0; i < 240; i++) {
          await page.mouse.wheel(i < 120 ? 12 : -12, i < 120 ? 18 : -18);
          await page.waitForTimeout(8);
        }
      });
      const after = (await mainTab(page, id))!.viewport!;
      const seenAfter = await boardsInView(tab);
      pans.push({ ...pan, load: Math.max(load, load1()), note: `the view panned through (${before.x.toFixed(0)}, ${before.y.toFixed(0)}) → turned back at its far end (${after.x.toFixed(0)}, ${after.y.toFixed(0)}) at zoom ${after.zoom}; ${seenBefore} boards in view at the start, ${seenAfter} at the end` });
      if (after.zoom !== 0.25) failures.push(`pan ${k + 1}: the zoom moved (${after.zoom})`);

      await tab.getByRole('combobox', { name: 'Zoom' }).selectOption('fit-all');
      const desktop = BOARDS.find((b) => b.size === 'desktop')!;
      const at = (await tab.locator(`[data-board-id="${desktop.id}"]`).boundingBox())!;
      await page.mouse.move(at.x + at.width / 2, at.y + at.height / 2);
      const fit = (await mainTab(page, id))!.viewport!.zoom;
      load = await quiet();
      let peak = 0;
      const zoom = await measureFrames(page, `zoom-${k + 1}`, async () => {
        await page.keyboard.down('Control');
        try {
          // each step zooms by e^(±0.027) about the pointer (the world's ⌃-wheel rule): 120 in take fit (about 4 %) to
          // about 100 %, 120 out bring it back
          for (let i = 0; i < 240; i++) {
            await page.mouse.wheel(0, i < 120 ? -2.7 : 2.7);
            if (i === 119) peak = (await mainTab(page, id))!.viewport!.zoom;
            await page.waitForTimeout(8);
          }
        } finally {
          await page.keyboard.up('Control');
        }
      });
      const back = (await mainTab(page, id))!.viewport!.zoom;
      zooms.push({ ...zoom, load: Math.max(load, load1()), note: `zoom ${fit.toFixed(4)} (fit) → ${peak.toFixed(4)} → ${back.toFixed(4)} over 240 pinch steps` });
      if (!(peak > fit * 10)) failures.push(`zoom ${k + 1}: the pinch did not zoom in (fit ${fit}, peak ${peak})`);
    }
    frameRows('pan', 'a pan at 25 % by 240 real wheel events', pans);
    frameRows('zoom', 'a pinch (⌃-wheel) zoom from fit in and back out about a desktop board, 240 real wheel events', zooms);
  });

  // the gesture under contention: the owner's title drag of a board while the agent republishes that board's card every
  // 0.7 s, with a pan (the wheel) or a pinch zoom (⌃-wheel) running through the world's handler all along; at least five
  // seconds of it, so several publications run wholly inside the measured window, which is what the trial claims
  // the stress drag's reach from its press, screen px: its loop goes 59 × 0.75 right and 39 × 0.5 down, its far turning
  // point 45 right and 20 down (the loop below)
  const STRESS_REACH = { x: 45, y: 20 };
  const STRESS_MARGIN = 20;
  const stressTrial = async (kind: 'pan' | 'zoom', k: number): Promise<{ trial: FrameTrial & { load: number; note?: string }; record: Record<string, unknown> }> => {
    // the first phone brought to the middle of the world by the product's own commands (Zoom to board, then 25 % about
    // the world's middle), every board still mounted: its title then lies inside the world with room for the drag
    const dragged: BenchBoard = BOARDS.find((b) => b.size === 'phone')!;
    await toFirstBoardAt25(page, tab, dragged);
    await expect(tab.locator('[data-board-id] .maws-slide[data-board]')).toHaveCount(BOARDS.length);
    const { box: world } = await worldPoint(tab);
    const t = await tab.locator(`[data-board-title="${dragged.id}"]`).boundingBox();
    // the press must land on the title, and the drag's own reach (its loop and its far turning point, at most 45 × 20
    // screen px from the press) must stay inside the world with a margin: a guard on the actual room, whatever width the
    // panel and the inspector leave the world (the first run's fixed 300 px assumed a world about 700 px wide; it is 452)
    if (!(t && t.x > world.x + STRESS_MARGIN && t.y > world.y + STRESS_MARGIN && t.x + Math.min(20, t.width / 2) + STRESS_REACH.x < world.x + world.width - STRESS_MARGIN && t.y + t.height / 2 + STRESS_REACH.y < world.y + world.height - STRESS_MARGIN))
      throw new Error(`${dragged.id}'s title does not lie inside the world at 25 % with room for the drag (${JSON.stringify(t)} in ${JSON.stringify(world)})`);
    const start = (await frameOf(page, id, dragged.id))!;
    const title = (await tab.locator(`[data-board-title="${dragged.id}"]`).boundingBox())!;
    const from = { x: title.x + Math.min(20, title.width / 2), y: title.y + title.height / 2 };
    const load = await quiet();
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    const publishes = republishing(agent, dragged.id, released);
    publishes.catch(() => {}); // settled below
    let published: PromiseSettledResult<Publication[]>;
    let frames: FrameTrial;
    try {
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      frames = await measureFrames(page, `stress-${kind}-${k + 1}`, async () => {
        if (kind === 'zoom') await page.keyboard.down('Control');
        try {
          const t0 = Date.now();
          for (let i = 0; i < 240 || Date.now() - t0 < STRESS_MS; i++) {
            const leg = i % 120; // there and back again, every 120 steps
            const out = Math.floor(i / 60) % 2 === 0;
            await page.mouse.move(from.x + (leg < 60 ? leg : 120 - leg) * 0.75, from.y + (i % 40) * 0.5);
            if (kind === 'pan' && i % 2 === 0) await page.mouse.wheel(out ? 10 : -10, out ? 14 : -14);
            if (kind === 'zoom') await page.mouse.wheel(0, out ? -2.7 : 2.7);
            await page.waitForTimeout(8);
          }
          // the drag ends at its far turning point, whatever phase the time-bound loop stopped in: 45 × 20 screen px
          // from the press, far past the six-pixel snap reach, so the frame always lands moved
          for (let j = 1; j <= 5; j++) await page.mouse.move(from.x + 9 * j, from.y + 4 * j);
        } finally {
          if (kind === 'zoom') await page.keyboard.up('Control');
        }
      });
      await page.mouse.up();
    } finally {
      release(); // the agent's workload ends with the drag, whether it finished or threw (its error wins)
      [published] = await Promise.allSettled([publishes]);
    }
    if (published.status === 'rejected') throw published.reason;
    const pubs = published.value;
    const within = inside(pubs, frames!.span);
    const lastFill = pubs.length > 0 ? agent.fillOf(dragged.id) : null;
    // the dragged frame stands (moved, written, drawn) and the agent's restyle of its card with it
    await sleep(500);
    const end = (await frameOf(page, id, dragged.id))!;
    const drawn = await tab.locator(`[data-board-id="${dragged.id}"]`).evaluate((n) => [(n as HTMLElement).style.left, (n as HTMLElement).style.top]);
    const card = findIn((await boardOf(page, id, dragged.id)).children, BENCH_CARD)?.style.background;
    const cardDrawn = await tab.locator(`[data-board-id="${dragged.id}"] .design-board-canvas [data-eid="${BENCH_CARD}"]`).evaluate((n) => (n as HTMLElement).style.getPropertyValue('background-color'));
    const intervals = pubs.slice(1).map((p, j) => p.requestedAt - pubs[j]!.requestedAt);
    const record = {
      gesture: kind,
      trial: k + 1,
      board: dragged.id,
      window: { ...frames!.span, ms: frames!.span.endedAt - frames!.span.startedAt },
      inside: { indexes: within.indexes, count: within.count, intervalsMs: within.intervalsMs },
      publishes: pubs.length,
      everyMs: PUBLISH_EVERY_MS,
      intervalsMs: intervals,
      requestedAt: pubs.map((p) => p.requestedAt),
      answeredAt: pubs.map((p) => p.answeredAt),
      lateMs: pubs.map((p) => p.requestedAt - p.due),
      hostStartApproxMs: pubs.map((p) => +(p.answeredAt - p.wallMs - pubs[0]!.requestedAt).toFixed(1)),
      changed: pubs.map((p) => p.changed),
      busyMs: pubs.map((p) => +p.busyMs.toFixed(2)),
    };
    const problems: string[] = [];
    if (pubs.some((p) => p.changed.length !== 1 || p.changed[0] !== boardPath(dragged.id))) problems.push('a publication changed something other than the dragged board');
    if (end.x === start.x && end.y === start.y) problems.push(`the dragged frame did not move (${JSON.stringify(start)})`);
    if (drawn[0] !== `${end.x}px` || drawn[1] !== `${end.y}px`) problems.push(`the world draws ${drawn.join(', ')} for the frame ${end.x}, ${end.y}`);
    if (lastFill !== null && card !== lastFill) problems.push(`the card's fill is ${card}, not the agent's last ${lastFill}`);
    if (lastFill !== null && cardDrawn !== rgbOf(lastFill)) problems.push(`the world draws the card in ${cardDrawn}, not the agent's last ${lastFill}`);
    if (problems.length > 0) failures.push(`stress ${kind} ${k + 1}: ${problems.join('; ')}`);
    const note = `dragged ${dragged.id} ${JSON.stringify(start)} → ${JSON.stringify(end)}; window ${record.window.ms} ms; ${within.count} of ${pubs.length} publications asked and answered inside it (indexes ${within.indexes.join(', ')}; every ${within.intervalsMs.length ? median(within.intervalsMs) : '—'} ms, max ${within.intervalsMs.length ? Math.max(...within.intervalsMs) : '—'}); card ${card} (drawn ${cardDrawn})`;
    // under three publications inside the window the trial proves no contention: unreadable, never a passing figure
    const contended = within.count >= 3;
    const trial = contended ? { ...frames!, load: Math.max(load, load1()), note } : { ...frames!, work: null, drops: null, load: Math.max(load, load1()), note, error: `only ${within.count} publications asked and answered inside the measured window (${record.window.ms} ms); at least 3 are required` };
    return { trial, record };
  };

  await test.step('2 (stress): a pan, then a pinch zoom, while the owner drags a board by its title and the agent republishes that board every 0.7 s, three times each', async () => {
    const records: Record<string, unknown>[] = [];
    for (const kind of ['pan', 'zoom'] as const) {
      const trials: (FrameTrial & { load: number; note?: string })[] = [];
      for (let k = 0; k < TRIALS; k++) {
        const { trial, record } = await stressTrial(kind, k);
        trials.push(trial);
        records.push(record);
        rows.write({ stressPublications: records });
      }
      frameRows(`stress ${kind}`, kind === 'pan' ? 'a pan by real wheel events during an owner’s title drag of a board while the agent republishes that board every 0.7 s (at least 3 publications inside the window)' : 'a pinch (⌃-wheel) zoom in and out during an owner’s title drag of a board while the agent republishes that board every 0.7 s (at least 3 publications inside the window)', trials);
    }
  });

  await test.step('3: re-layout every board after a Theme background change, three times: the one callback that lays all 24 out once the scope holds the new value', async () => {
    await tab.getByRole('combobox', { name: 'Zoom' }).selectOption('fit-all');
    await headerAction(page, 'Theme');
    const theme = tab.locator('[data-deck-rail="theme"]');
    await expect(theme).toBeVisible();
    const background = theme.getByRole('textbox', { name: 'Background', exact: true });
    const scopeOf = tab.locator('[data-design-world] .deck-ds-scope[data-ds-scope]').first();
    const trials: Trial[] = [];
    const latencies: Trial[] = [];
    for (let k = 0; k < TRIALS; k++) {
      const colour = ['#123456', '#654321', '#2b7a78'][k]!;
      const mark = `design-relayout-${k + 1}`;
      await background.fill(colour);
      const load = await quiet();
      // the probe marks each canvas's layout and the moment the requested override stands in the world's scope style
      const probe = await armLayoutProbe(page, id, 'main', { mark, scope: { token: '--ds-color-bg', value: colour } });
      let traceEvents: TraceEvent[];
      let enterAt: number | null = null;
      let result: Awaited<ReturnType<typeof layoutProbeResult>> | null = null;
      try {
        try {
          ({ events: traceEvents } = await traced(page, async () => {
          await page.evaluate((m) => {
            const w = window as unknown as { __designEnter?: number | null };
            w.__designEnter = null;
            window.addEventListener(
              'keydown',
              (e) => {
                if (e.key !== 'Enter') return;
                w.__designEnter ??= e.timeStamp;
                performance.mark(`${m}:enter`);
              },
              { capture: true, once: true },
            );
          }, mark);
          await background.press('Enter');
          await expect.poll(async () => {
            const now = await layoutProbeResult(page, probe);
            return now.scopeAt !== null && BOARDS.every((b) => (now.layouts[b.id] ?? []).some((t) => t >= now.scopeAt!));
          }, { timeout: 15_000, message: 'the scope took the new value and every board laid out again after it' }).toBe(true);
          await sleep(100); // the pass's frame, traced whole
          enterAt = await page.evaluate(() => (window as unknown as { __designEnter?: number | null }).__designEnter ?? null);
          result = await layoutProbeResult(page, probe);
          }));
        } catch (error) {
          if (!(error instanceof TraceUnavailable)) throw error;
          trials.push({ value: null, load: Math.max(load, load1()), error: `trace unavailable: ${error.message}` });
          continue;
        }
      } finally {
        await disarmLayoutProbe(page, probe);
      }
      mkdirSync(TRACES, { recursive: true });
      writeFileSync(join(TRACES, `relayout-${k + 1}.trace.json`), JSON.stringify({ traceEvents }));
      // the change itself, read after the measure (forcing style is harmless now): the scope the boards draw in holds it
      const drawnToken = (await scopeOf.evaluate((n) => getComputedStyle(n).getPropertyValue('--ds-color-bg'))).trim().toLowerCase();
      const r = result as Awaited<ReturnType<typeof layoutProbeResult>> | null;
      const at = r?.scopeAt ?? null;
      const firsts = r && at !== null ? BOARDS.map((b) => r.layouts[b.id]!.find((t) => t >= at)!) : [];
      const latencyNote = r && at !== null && enterAt !== null ? `Enter → scope ${(at - enterAt).toFixed(2)} ms; Enter → first fresh layout ${(Math.min(...firsts) - enterAt).toFixed(2)} ms, last ${(Math.max(...firsts) - enterAt).toFixed(2)} ms (listener spread ${(Math.max(...firsts) - Math.min(...firsts)).toFixed(2)} ms)` : 'no latency read';
      if (r && at !== null && enterAt !== null) latencies.push({ value: Math.max(...firsts) - enterAt, load: Math.max(load, load1()), note: latencyNote });
      if (drawnToken !== colour) {
        trials.push({ value: null, load: Math.max(load, load1()), error: `the world's scope reads --ds-color-bg ${drawnToken || '(none)'}, not the requested ${colour}` });
        continue;
      }
      try {
        const pass = relayoutCallback(traceEvents, mark, BOARDS.map((b) => b.id));
        trials.push({ value: pass.wallMs, load: Math.max(load, load1()), note: `callback ${String(pass.callback)}: wall ${pass.wallMs.toFixed(2)} ms, thread (CPU) ${pass.cpuMs === null ? 'not traced' : `${pass.cpuMs.toFixed(2)} ms`}; ${pass.beforeFirstMarkMs.toFixed(2)} ms before the first board’s listener (the measure and write phases), listeners over ${pass.marksSpanMs.toFixed(2)} ms; scope → callback ${pass.scopeToCallbackMs.toFixed(2)} ms; the frame’s style, layout and paint after it ${pass.followingMs === null ? 'not traced' : `${pass.followingMs.toFixed(2)} ms`}; ${latencyNote}` });
      } catch (error) {
        trials.push({ value: null, load: Math.max(load, load1()), error: `${error instanceof Error ? error.message : String(error)}; ${latencyNote}` });
      }
    }
    rows.add('3 relayout', 'a Theme background change (the design’s overrides; the world’s scope verified to hold the requested --ds-color-bg): the wall time of the one animation-frame callback that ran all 24 canvases’ first layout pass after the scope stood (DevTools trace; its measure and write phases included; a synchronous callback, so no scheduling wait; its thread time noted, not judged)', 'ms', 50, '≤ 50 ms (E0 13.5 ms, a stand-in)', trials);
    rows.add('3 relayout (latency)', 'the same changes: the Enter to the last of 24 fresh layouts after the scope stood (an upper bound including the frame wait), recorded beside row 3', 'ms', null, 'recorded beside row 3', latencies);
  });

  await test.step('6: every board as one PDF through main’s export service, three times: the request to the committed file, its 24 pages checked', async () => {
    const trials: Trial[] = [];
    for (let k = 0; k < TRIALS; k++) {
      const load = await quiet();
      const started = Date.now();
      const { path } = await ok<{ path: string }>(page, 'artifacts.export', { artifactId: id, format: 'pdf' });
      const answered = Date.now();
      const problems: string[] = [];
      if (!existsSync(path)) problems.push('no file at the answered path');
      else {
        const stat = statSync(path);
        if (stat.size === 0) problems.push('an empty file');
        const sizes = pageSizes(path);
        if (sizes.length !== 24) problems.push(`${sizes.length} pages`);
        sizes.forEach(([w, h], i) => {
          const b = BOARDS[i];
          if (b && (Math.abs(w - b.w * 0.75) > 1 || Math.abs(h - b.h * 0.75) > 1)) problems.push(`page ${i + 1} is ${w}×${h} pt for ${b.id} (${b.w}×${b.h} px)`);
        });
        rmSync(path);
      }
      trials.push(problems.length > 0 ? { value: null, load, error: problems.join('; ') } : { value: answered - started, load: Math.max(load, load1()), note: '24 pages at each board’s native size' });
    }
    rows.add('6 pdf all boards', 'every board as one PDF through main’s export service (the menu’s route): the request to its answer with the file committed, 24 native pages checked', 'ms', 55_000, '< 55 s', trials, true);
  });

  await test.step('4: the renderer’s working set with every export window closed, ordinary and after a forced collection', async () => {
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), { timeout: 30_000, message: 'every export window closed' }).toBe(1);
    const load = await quiet();
    const reading = async () => {
      try {
        return await rendererMemory(launch!);
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    };
    const ordinary = await reading();
    const cdp = await page.context().newCDPSession(page);
    try {
      await cdp.send('HeapProfiler.collectGarbage');
    } finally {
      await cdp.detach();
    }
    await sleep(1_000);
    const collected = await reading();
    const pids = [ordinary, collected].map((r) => (typeof r === 'string' ? null : r.pid));
    if (pids[0] !== null && pids[1] !== null && pids[0] !== pids[1]) failures.push(`the renderer's pid changed between the readings (${pids[0]} → ${pids[1]})`);
    // a missing, non-finite or non-positive working set is unreadable, never a passing figure
    const trial = (r: Awaited<ReturnType<typeof reading>>, note?: string): Trial => (typeof r === 'string' ? { value: null, load: Math.max(load, load1()), error: r } : { value: r.mib, load: Math.max(load, load1()), note: `pid ${r.pid}, ${r.workingSetKiB} KiB${note ? `; ${note}` : ''}` });
    rows.add('4 renderer memory', 'the window’s renderer working set (its own pid in the metrics), ordinary, with the design open after every row above and every export window closed; the bound read as 500 × 10⁶ bytes', 'MiB', 500e6 / 2 ** 20, '≤ 500 MB (476.8 MiB; E0 276)', [trial(ordinary, typeof collected === 'string' ? `after a forced collection: ${collected}` : `after a forced collection ${collected.mib.toFixed(1)} MiB`)]);
    rows.add('4 renderer memory (after collection)', 'the same renderer after HeapProfiler.collectGarbage', 'MiB', null, 'recorded beside row 4', [trial(collected)]);
  });

  loads.end = load1();
  await seam.send({ cmd: 'release', session: AGENT });
  rows.write({ loads, failures });
  const failed = rows.rows.filter((r) => r.verdict !== 'met' && r.verdict !== 'recorded');
  expect([...failures, ...failed.map((r) => `${r.row}: ${r.value ?? '—'} ${r.unit} against ${r.limit} (${r.verdict}; loads ${r.loads.join(', ')})`)], `rows not met (the figures are in ${RESULTS})`).toEqual([]);
  expect(launch.consoleErrors(), 'the console stays free of errors').toEqual([]);
});
