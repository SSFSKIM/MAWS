// The deck's scale gate (P3-C M10; docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, Acceptance 7; the parent's
// Decision Log 37 for S7b's bounds, judged per this child's Decision Log 24 (the parent's 63) on B's
// `e2e/document-scale.spec.ts` pattern): the product build with S7b's 100-slide deck (S6's bench shapes,
// `benchDeckFiles(100)`) seeded through the renderer's presentations seam, an agent session driven by the host's own
// tools through the deck's scale seam (`src/engine-host/presentations/scale-seam.ts`: A's real `artifact_read` and
// `artifact_publish`, so every publish is A's `publishDoc` over the deck's three-way publish), and the editor measured
// through the renderer seam's timings and drag probe. Rows, each with the 1-minute load at its trials:
//   1 open     cold to interactive with 100 live thumbnails ≤ 1,000 ms (the host's copy unloaded first; S7b 116 ms)
//   2 drag     move to frame p95 ≤ 24 ms while the agent republishes a slide every 0.7 s (the parent's Decision Log 108;
//              calibration: host-faithful 18.2 to 20.5 ms on the mini; S7b 8.9 ms in the spike; the stand-in 15.4 ms)
//   3 renderer working set ≤ 500 MB (read after a forced collection, B's Decision Log 44; the figure before it kept)
//   4 publish  one slide occupies the host loop ≤ 50 ms; the whole deck ≤ 200 ms (the loop's busy time over the call;
//              the longest single stretch kept beside it)
//   5 preview  a version's history preview ≤ 1,000 ms (on this deck; and on S7a's heavy deck: the export
//              MAWS_DECK_HISTORY names or, unset, one the soak generates in this job (P3-F W-E,
//              e2e/support/deck-history.ts), checked before it is applied; a generation or check failure fails the
//              heavy row by name, never a skip)
// Each row is met, marginal or failed (Decision Log 24): marginal for a miss under 20 % with the load at 10 or more
// during its trials; failed for a miss of 20 % or more, any miss below load 10, or any miss of a zero bound. A row
// measured in trials is judged on its best (the parent's Decision Log 54); every trial is in the results JSON,
// `test-results/presentations-scale.json`. The run exits 0 when no row failed and prints the marginal rows for P3-F.
// Run on purpose only, at the quietest load the machine gives:
//   pnpm e2e:presentations-scale   (the script sets MAWS_PRESENTATIONS_SCALE=1)
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { benchDeckFiles } from '../src/artifacts/slides/fixtures/bench';
import { checkDeckHistory, generateDeckHistory } from './support/deck-history';
import { collectGarbage, load1, MARGINAL_LOAD, MARGINAL_MISS, PerfSeam, processMemory, stats, verdictOf, type LoopStats, type Verdict } from './support/document-scale';
import { launchMaws, REPO_ROOT, type MawsLaunch } from './support/launch';

test.skip(process.env.MAWS_PRESENTATIONS_SCALE !== '1', 'the deck scale gate runs only under MAWS_PRESENTATIONS_SCALE=1');
test.describe.configure({ timeout: 1_200_000 });

const RESULTS = join(REPO_ROOT, 'test-results', 'presentations-scale.json');
const UNLOAD_WAIT_MS = 66_000; // the host's idle unload (A's IDLE_UNLOAD_MS, 60 s) and a margin
const TRIALS = 3;
const TITLE = 'Scale 100';
const AGENT = 'deck-agent';
const HEAVY = process.env.MAWS_DECK_HISTORY ?? '';
const HEAVY_GENERATION_MS = 360_000; // the soak's budget in the job: the ruling's about five minutes, and a margin
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

type Result<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } };
async function ok<T>(page: Page, name: string, input?: unknown): Promise<T> {
  const result = (await page.evaluate(([n, i]) => (window as unknown as { maws: { invoke(name: string, input: unknown): Promise<unknown> } }).maws.invoke(n as string, i), [name, input] as const)) as Result<T>;
  if (!result.ok) throw new Error(`${name} failed: ${result.error.code} ${result.error.message}`);
  return result.value;
}

type Stat = { p50: number; p95: number; max: number };
interface DeckSeam {
  __maws_presentations: {
    seed(artifactId: string, files: Record<string, string>): Promise<{ changed: string[]; held: string[] }>;
    order(artifactId: string): Promise<string[]>;
    timings(artifactId: string): { surface: string; timings: { openedAt: number; syncedAt?: number; drawnAt?: number; thumbnails?: number; previewMs?: number[] } }[];
    dragProbe: { start(artifactId: string): void; stop(): { moves: number; withTransaction: number; inputToTxMs: Stat; inputToFrameMs: Stat; longTasks: number } };
  };
  __maws_documents: { open(artifactId: string): Promise<number>; applyState(id: number, state: Uint8Array): void; state(id: number): { unsaved: number }; close(id: number): void };
}
const deckSeam = (page: Page) => page.evaluate(() => typeof (window as unknown as Partial<DeckSeam>).__maws_presentations);
const timingsOf = (page: Page, id: string) => page.evaluate((a) => (window as unknown as DeckSeam).__maws_presentations.timings(a), id);

// ---- the rows: Decision Log 24's verdict over a row's trials ---------------------------------------------------------

interface Trial {
  value: number;
  load: number;
  note?: string;
}
interface Row {
  row: string;
  measure: string;
  bound: string;
  limit: number | null;
  unit: string;
  value: number; // the judged figure: the best trial's, or the trials' median for a per-publish bound
  judgedBy: 'best' | 'median';
  load: number; // the highest 1-minute load among the row's trials ("during the run", Decision Log 24)
  verdict: Verdict;
  trials: Trial[]; // every trial, raw, with its load
  note?: string;
}

class Rows {
  readonly rows: Row[] = [];
  private readonly extra: Record<string, unknown> = {};
  constructor(private readonly meta: Record<string, unknown>) {}

  /** A row judged on its best trial (the parent's Decision Log 54), or on the trials' median (`judgedBy: 'median'`). */
  add(row: string, measure: string, unit: string, limit: number | null, bound: string, trials: Trial[], note?: string, judgedBy: 'best' | 'median' = 'best'): Row {
    const judged = judgedBy === 'best' ? Math.min(...trials.map((t) => t.value)) : median(trials.map((t) => t.value));
    const load = Math.max(...trials.map((t) => t.load));
    const entry: Row = { row, measure, bound, limit, unit, value: +judged.toFixed(2), judgedBy, load, verdict: verdictOf(judged, limit, load), trials: trials.map((t) => ({ ...t, value: +t.value.toFixed(2) })), ...(note && { note }) };
    this.rows.push(entry);
    this.write();
    console.log(`[deck scale] ${row}: ${entry.value} ${unit} (${judgedBy}; ${entry.verdict}; bound ${bound}; trials ${trials.map((t) => `${t.value.toFixed(1)} at load ${t.load}`).join(', ')})`);
    return entry;
  }

  /** A row that could not be measured, failed by name (P3-F W-E: the heavy deck's generation or check). */
  failed(row: string, measure: string, unit: string, limit: number, bound: string, reason: string): Row {
    const entry: Row = { row, measure, bound, limit, unit, value: Number.NaN, judgedBy: 'best', load: load1(), verdict: 'failed', trials: [], note: reason };
    this.rows.push(entry);
    this.write();
    console.log(`[deck scale] ${row}: failed (${reason})`);
    return entry;
  }

  write(extra: Record<string, unknown> = {}): void {
    Object.assign(this.extra, extra);
    mkdirSync(join(RESULTS, '..'), { recursive: true });
    writeFileSync(RESULTS, `${JSON.stringify({ ...this.meta, ...this.extra, judging: { marginalMiss: MARGINAL_MISS, marginalLoad: MARGINAL_LOAD, rule: 'Decision Log 24: marginal under a 20 % miss at load ≥ 10; failed at a 20 % miss or more, any miss below load 10, any miss of a zero bound; a row judged on its best trial (the parent’s Decision Log 54), a per-publish bound on the median of its publishes (judgedBy)' }, rows: this.rows }, null, 2)}\n`);
  }
}

// ---- the app ------------------------------------------------------------------------------------------------------

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

/** Opens the deck from the library in a main tab; answers its open-to-drawn time once the stage and every thumbnail are drawn. */
async function openTimed(page: Page, id: string, title: string): Promise<{ ms: number; syncedMs: number; thumbnails: number; tab: Locator }> {
  await showLibrary(page);
  await page.locator('[data-library]').getByRole('article', { name: title, exact: true }).click({ timeout: 15_000 });
  const tab = page.locator(`[data-region="main"] [data-artifact-tab="${id}"]`);
  await expect(tab.locator('[data-deck-editor]')).toBeVisible({ timeout: 30_000 });
  await expect(tab.locator('[data-slide-thumb] .maws-slide')).toHaveCount(100, { timeout: 30_000 });
  let timings: { openedAt: number; syncedAt?: number; drawnAt?: number; thumbnails?: number } | undefined;
  await expect
    .poll(async () => {
      timings = (await timingsOf(page, id)).find((t) => t.timings.drawnAt !== undefined)?.timings;
      return timings !== undefined;
    }, { timeout: 30_000, message: 'the open is drawn' })
    .toBe(true);
  return { ms: timings!.drawnAt! - timings!.openedAt, syncedMs: (timings!.syncedAt ?? NaN) - timings!.openedAt, thumbnails: timings!.thumbnails ?? 0, tab };
}

async function closeTab(page: Page, title: string): Promise<void> {
  await page.getByRole('button', { name: `Close ${title}`, exact: true }).click();
  await expect(page.getByRole('button', { name: `Close ${title}`, exact: true })).toHaveCount(0, { timeout: 15_000 });
}

/** A header action by its label: its button, or its entry under More actions when the header folded it there. */
async function headerAction(page: Page, label: string): Promise<void> {
  const header = page.locator('[data-region="main"] [data-editor-header]');
  const button = header.getByRole('button', { name: label, exact: true });
  if (await button.isVisible()) return button.click();
  await header.getByRole('button', { name: 'More actions', exact: true }).click();
  await page.getByRole('menuitemcheckbox', { name: label }).or(page.getByRole('menuitem', { name: label })).click();
}

// ---- the agent, through the host's scale seam -----------------------------------------------------------------------

interface DeckCall<R> {
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

/** The agent's view of the deck: its last read's files, updated by what it publishes. */
class DeckAgent {
  files: Record<string, string> = {};
  private turn = 0;
  constructor(private readonly seam: PerfSeam, readonly artifactId: string) {}

  async read(): Promise<DeckCall<ReadResult>> {
    const answer = await this.seam.send<DeckCall<ReadResult>>({ cmd: 'call', session: AGENT, tool: 'artifact_read', args: { artifact: this.artifactId } });
    if (answer.isError) throw new Error(`the agent's read was refused: ${answer.text}`);
    this.files = { ...answer.result!.files };
    return answer;
  }

  /** One publish of `paths`, each slide's first font size stepped (64 → 65 → 64 …), from the revision it last saw. */
  async publish(paths: string[]): Promise<DeckCall<PublishResult>> {
    this.turn += 1;
    const sent: Record<string, string> = {};
    for (const path of paths) {
      sent[path] = this.files[path]!.replace(/font-size:(\d+)px/, (_m, size: string) => `font-size:${this.turn % 2 === 1 ? Number(size) + 1 : Number(size) - 1}px`);
      if (sent[path] === this.files[path]) throw new Error(`${path} has no font size to step`);
    }
    const answer = await this.seam.send<DeckCall<PublishResult>>({ cmd: 'call', session: AGENT, tool: 'artifact_publish', args: { artifact: this.artifactId, baseRevision: 'last', files: sent } });
    if (answer.isError) throw new Error(`the agent's publish was refused: ${answer.text}`);
    expect(answer.result!.changed.sort()).toEqual([...paths].sort());
    Object.assign(this.files, sent);
    return answer;
  }

  slidePaths(): string[] {
    return Object.keys(this.files).filter((path) => path.startsWith('project/slides/')).sort();
  }
}

/** The agent republishing one slide every `everyMs` (the second slide on, round robin) until `until` settles. */
async function republishing(agent: DeckAgent, until: Promise<unknown>, everyMs: number): Promise<DeckCall<PublishResult>[]> {
  let done = false;
  void until.finally(() => (done = true));
  const slides = agent.slidePaths().slice(1);
  const answers: DeckCall<PublishResult>[] = [];
  for (let k = 0; !done; k++) {
    await sleep(everyMs);
    if (done) break;
    answers.push(await agent.publish([slides[k % slides.length]!]));
  }
  return answers;
}

test('the deck scale gate on S7b’s 100-slide deck: cold open, drag with an agent republishing, the renderer, the publishes, the history preview', async () => {
  const loads: Record<string, number> = { start: load1() };
  userData = mkdtempSync('/tmp/maws-e2e-presentations-scale-');
  launch = await launchMaws({ userData, env: { MAWS_PRESENTATIONS_SCALE: '1' } });
  const { page, app } = launch;
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1600, 1000));
  await expect.poll(async () => (await ok<{ state: string }>(page, 'engine.hostState')).state, { timeout: 30_000, message: 'the engine host is ready' }).toBe('ready');
  await expect.poll(() => deckSeam(page), { message: 'the renderer seam is installed' }).toBe('object');
  const seam = new PerfSeam(join(userData, 'presentations-scale'));
  await expect.poll(() => existsSync(join(seam.dir, 'in')), { timeout: 10_000, message: 'the host started the deck scale seam' }).toBe(true);
  const rows = new Rows({ run: new Date().toISOString(), deck: 'benchDeckFiles(100): S6’s seven bench shapes cycled, S7b’s 100-slide deck', loads });

  // the deck, made by the owner and seeded from S7b's files, versioned as seeded
  const { artifact } = await ok<{ artifact: { id: string } }>(page, 'artifacts.create', { kind: 'presentation', title: TITLE });
  const id = artifact.id;
  const seeded = await page.evaluate(([a, f]) => (window as unknown as DeckSeam).__maws_presentations.seed(a!, f as Record<string, string>), [id, benchDeckFiles(100)] as const);
  expect(seeded.held).toEqual([]);
  expect(await page.evaluate((a) => (window as unknown as DeckSeam).__maws_presentations.order(a), id)).toHaveLength(100);
  await ok(page, 'artifacts.saveVersion', { artifactId: id, label: 'Seeded', note: 'S7b’s 100-slide deck' });

  await test.step('1: open cold (the host’s copy unloaded) with 100 live thumbnails, three times; warm, three times', async () => {
    const cold: Trial[] = [];
    const warm: Trial[] = [];
    for (let k = 0; k < TRIALS; k++) {
      await sleep(UNLOAD_WAIT_MS); // nothing holds the deck: the host unloads it
      const load = load1();
      const open = await openTimed(page, id, TITLE);
      expect(open.thumbnails).toBe(100);
      cold.push({ value: open.ms, load, note: `synced at ${open.syncedMs.toFixed(1)} ms; ${open.thumbnails} thumbnails${k === 0 ? '; the window’s first open of a deck' : ''}` });
      await closeTab(page, TITLE);
      const warmLoad = load1();
      const again = await openTimed(page, id, TITLE);
      warm.push({ value: again.ms, load: warmLoad, note: `synced at ${again.syncedMs.toFixed(1)} ms` });
      await closeTab(page, TITLE);
    }
    rows.add('1 open cold', 'open cold to interactive: the editor’s createState to the stage and 100 live thumbnails drawn, the host’s copy unloaded first', 'ms', 1000, '≤ 1,000 ms (S7b 116)', cold);
    rows.add('1 open warm', 'open warm: the same, reopened at once (the host’s copy loaded)', 'ms', 1000, '≤ 1,000 ms', warm);
  });

  const { tab } = await openTimed(page, id, TITLE);
  const agent = new DeckAgent(seam, id);
  const firstRead = await agent.read();
  expect(agent.slidePaths()).toHaveLength(100);
  rows.write({ agentFirstRead: { wallMs: firstRead.wallMs, loopMaxMs: firstRead.loop.max, busyMs: firstRead.busyMs, load: load1() } });

  await test.step('4: publishes through the real publishDoc, the deck open in the editor: one slide, seven times; the whole deck, five times', async () => {
    const slides = agent.slidePaths();
    const one: Trial[] = [];
    const oneLoop: number[] = [];
    await agent.publish([slides[5]!]); // warm-up: the session's base becomes its own publish
    for (let k = 0; k < 7; k++) {
      const load = load1();
      const answer = await agent.publish([slides[(5 + k * 13) % slides.length]!]);
      one.push({ value: answer.busyMs, load, note: `loop’s longest stretch ${answer.loop.max.toFixed(1)} ms; wall ${answer.wallMs.toFixed(1)} ms` });
      oneLoop.push(answer.loop.max);
      await sleep(300);
    }
    const whole: Trial[] = [];
    const wholeLoop: number[] = [];
    for (let k = 0; k < 5; k++) {
      const load = load1();
      const answer = await agent.publish(slides);
      whole.push({ value: answer.busyMs, load, note: `loop’s longest stretch ${answer.loop.max.toFixed(1)} ms; wall ${answer.wallMs.toFixed(1)} ms` });
      wholeLoop.push(answer.loop.max);
      await sleep(1_000);
    }
    // a publish's figure is its median (M3's measure): the bound is per publish, so one quiet publish of seven is no proof
    rows.add('4 publish one slide', 'a one-slide publish through A’s publishDoc on the 100-slide deck (the agent’s session, after its own publish): the host loop’s busy time over the call, median of 7', 'ms', 50, '≤ 50 ms', one, `longest stretch p95 ${stats(oneLoop).p95} ms`, 'median');
    rows.add('4 publish whole deck', 'a whole-deck publish (100 slide files, each changed) through A’s publishDoc: the host loop’s busy time over the call, median of 5', 'ms', 200, '≤ 200 ms', whole, `longest stretch max ${Math.max(...wholeLoop).toFixed(1)} ms`, 'median');
  });

  await test.step('2: drag move to frame on the cover’s pinned picture while the agent republishes a slide every 0.7 s, three times', async () => {
    const trials: Trial[] = [];
    for (let k = 0; k < TRIALS; k++) {
      const target = tab.locator('[data-stage-slide] img[data-eid]').first();
      const box = (await target.boundingBox())!;
      const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      const load = load1();
      await page.evaluate((a) => (window as unknown as DeckSeam).__maws_presentations.dragProbe.start(a), id);
      let release!: () => void;
      const dragged = new Promise<void>((resolve) => (release = resolve));
      const publishes = republishing(agent, dragged, 700);
      publishes.catch(() => {}); // settled in the finally below
      let publishing: PromiseSettledResult<DeckCall<PublishResult>[]>;
      try {
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        for (let i = 1; i <= 200; i++) {
          await page.mouse.move(from.x + (k % 2 === 0 ? -i : i) * 0.8, from.y + (i % 40));
          await page.waitForTimeout(16);
        }
        await page.mouse.up();
      } finally {
        // the agent's workload ends with the drag, whether the drag finished or threw (its error wins)
        release();
        [publishing] = await Promise.allSettled([publishes]);
      }
      if (publishing.status === 'rejected') throw publishing.reason;
      const published = publishing.value;
      const drag = await page.evaluate(() => (window as unknown as DeckSeam).__maws_presentations.dragProbe.stop());
      expect(published.length, 'the agent republished during the drag').toBeGreaterThan(2);
      expect(drag.withTransaction, 'the drag wrote on its moves').toBeGreaterThan(100);
      trials.push({ value: drag.inputToFrameMs.p95, load: Math.max(load, load1()), note: `${drag.withTransaction}/${drag.moves} moves wrote; move → transaction p95 ${drag.inputToTxMs.p95} ms; move → frame p50 ${drag.inputToFrameMs.p50}, max ${drag.inputToFrameMs.max} ms; ${drag.longTasks} long tasks; the agent published ${published.length} slides (busy p95 ${stats(published.map((p) => p.busyMs)).p95} ms)` });
      await sleep(1_000);
    }
    rows.add('2 drag p95', 'drag move to frame, p95 over 200 pointer moves, while the agent republishes one slide every 0.7 s through publishDoc', 'ms', 24, 'p95 ≤ 24 ms (host-faithful 18.2 to 20.5 ms on the mini; S7b 8.9 ms in the spike; the stand-in 15.4 ms)', trials);
  });

  await test.step('5: the history preview of the seeded version, three times', async () => {
    await ok(page, 'artifacts.saveVersion', { artifactId: id, label: 'After the run' });
    await headerAction(page, 'Version history');
    const rail = tab.getByRole('complementary', { name: 'Version history' });
    await expect(rail).toBeVisible();
    const bar = tab.getByRole('toolbar', { name: 'Version preview' });
    const trials: Trial[] = [];
    for (let k = 0; k < TRIALS; k++) {
      const before = (await timingsOf(page, id))[0]?.timings.previewMs?.length ?? 0;
      const load = load1();
      await rail.getByRole('button', { name: /^Version Seeded/ }).click();
      await expect(bar).toBeVisible();
      await expect.poll(async () => (await timingsOf(page, id))[0]?.timings.previewMs?.length ?? 0, { timeout: 30_000 }).toBe(before + 1);
      trials.push({ value: (await timingsOf(page, id))[0]!.timings.previewMs!.at(-1)!, load });
      await bar.getByRole('button', { name: 'Back to presentation' }).click();
      await expect(bar).toBeHidden();
    }
    rows.add('5 preview', 'history preview of a version (the seeded one, against the deck after the run’s publishes and drags): the controller’s request to the slide drawn with its marks', 'ms', 1000, '≤ 1,000 ms', trials);
  });

  await test.step('3: the renderer’s working set after the previews, and after a forced collection', async () => {
    const before = await processMemory(app);
    await collectGarbage(page);
    await sleep(500);
    const after = await processMemory(app);
    const load = load1();
    for (const renderer of after.renderers) {
      const was = before.renderers.find((r) => r.windowId === renderer.windowId)?.workingSetMB;
      rows.add(`3 renderer ${renderer.windowId}`, `the renderer’s working set (window ${renderer.windowId}) with the deck open after the drags and the previews, read after a forced collection`, 'MB', 500, '≤ 500 MB', [{ value: renderer.workingSetMB, load }], `${was ?? '?'} MB before the collection`);
    }
    rows.write({ memory: { before, after } });
  });

  await test.step('5 (heavy): the preview of a 3-month-old version of S7a’s heavy deck, the named export or one generated in this job', async () => {
    const from = HEAVY || 'generated in this job';
    const measure = `history preview of a 3-month-old version of S7a’s heavy deck against today (${from})`;
    const scratch = HEAVY ? null : mkdtempSync(join(tmpdir(), 'maws-deck-history-'));
    const dir = HEAVY || scratch!;
    try {
      if (scratch) {
        test.setTimeout(test.info().timeout + HEAVY_GENERATION_MS);
        const generated = await generateDeckHistory(scratch, { root: REPO_ROOT, timeoutMs: HEAVY_GENERATION_MS });
        rows.write({ heavyGeneration: generated });
        if (!generated.ok) {
          rows.failed('5 preview heavy', measure, 'ms', 1000, '≤ 1,000 ms (M8’s bound)', `the heavy deck was not generated: ${generated.reason}`);
          return;
        }
      }
      const check = checkDeckHistory(dir, { generated: scratch !== null });
      rows.write({ heavyExport: { from, ...check } });
      if (!check.ok) {
        rows.failed('5 preview heavy', measure, 'ms', 1000, '≤ 1,000 ms (M8’s bound)', check.reason);
        return;
      }
      await closeTab(page, TITLE);
      const { artifact: heavy } = await ok<{ artifact: { id: string } }>(page, 'artifacts.create', { kind: 'presentation', title: 'Heavy deck' });
      const apply = async (file: string) => {
        const bytes = [...readFileSync(join(dir, file))];
        await page.evaluate(async ([artifactId, state]) => {
          const docs = (window as unknown as DeckSeam).__maws_documents;
          const handle = await docs.open(artifactId as string);
          docs.applyState(handle, new Uint8Array(state as number[]));
          for (let i = 0; i < 600 && docs.state(handle).unsaved > 0; i++) await new Promise((r) => setTimeout(r, 50));
          docs.close(handle);
        }, [heavy.id, bytes] as const);
      };
      await apply('prev.bin');
      await ok(page, 'artifacts.saveVersion', { artifactId: heavy.id, label: 'Three months ago' });
      await apply('next.bin');
      await ok(page, 'artifacts.saveVersion', { artifactId: heavy.id, label: 'Today' });
      await showLibrary(page);
      await page.locator('[data-library]').getByRole('article', { name: 'Heavy deck', exact: true }).click();
      const heavyTab = page.locator(`[data-region="main"] [data-artifact-tab="${heavy.id}"]`);
      await expect(heavyTab.locator('[data-deck-editor]')).toBeVisible({ timeout: 30_000 });
      await headerAction(page, 'Version history');
      const rail = heavyTab.getByRole('complementary', { name: 'Version history' });
      const bar = heavyTab.getByRole('toolbar', { name: 'Version preview' });
      const trials: Trial[] = [];
      for (let k = 0; k < TRIALS; k++) {
        // the 3-month-old version against today, as S7a measured it and M8's case reads it: a click, then a shift-click
        const load = load1();
        await rail.getByRole('button', { name: /^Version Three months ago/ }).click();
        await expect(bar).toBeVisible();
        await rail.getByRole('button', { name: /^Version Today/ }).click({ modifiers: ['Shift'] });
        await expect(bar.locator('.deck-history-heading')).toHaveText('Three months ago → Today');
        await expect.poll(async () => (await timingsOf(page, heavy.id))[0]?.timings.previewMs?.length ?? 0, { timeout: 30_000 }).toBe(2 * (k + 1));
        trials.push({ value: (await timingsOf(page, heavy.id))[0]!.timings.previewMs!.at(-1)!, load });
        await bar.getByRole('button', { name: 'Back to presentation' }).click();
      }
      rows.add('5 preview heavy', measure, 'ms', 1000, '≤ 1,000 ms (M8’s bound)', trials);
    } finally {
      if (scratch) rmSync(scratch, { recursive: true, force: true });
    }
  });

  loads.end = load1();
  await seam.send({ cmd: 'release', session: AGENT });
  const marginal = rows.rows.filter((r) => r.verdict === 'marginal');
  rows.write({ loads, marginal: marginal.map((r) => ({ row: r.row, value: r.value, limit: r.limit, unit: r.unit, load: r.load })) });
  if (marginal.length > 0) console.log(`marginal rows (P3-F re-measures below load 10):\n${marginal.map((r) => `  ${r.row}: ${r.value} ${r.unit} against ${r.limit} at load ${r.load}`).join('\n')}`);
  const failed = rows.rows.filter((r) => r.verdict === 'failed');
  expect(failed.map((r) => `${r.row}: ${r.value} ${r.unit} against ${r.limit} at load ${r.load}`), `bounds failed (Decision Log 24; the figures are in ${RESULTS})`).toEqual([]);
  expect(launch.consoleErrors(), 'the console stays free of errors').toEqual([]);
});
