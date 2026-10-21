// The dashboard's scale gate (P3-E2 M6 of docs/doperpowers/plans/2026-10-16-p3-e2-dashboard.md, acceptance 7, its
// "Acceptance seam and measurement definitions" and Decision Log 36; P3-E Decision Logs 36 and 42): the product build,
// the agent's real tools through the host's acceptance seam (src/engine-host/dashboards/e2e-seam.ts), and the scale bench
// (src/artifacts/dashboard/fixtures/bench.ts: a seeded 50,000-row ledger, explicitly synthetic, and twelve views of every
// kind, one a scatter of exactly 10,000 points). Rows, the candidates acceptance 7 names (ratified by the architect after
// measurement, never relaxed here):
//   1 bind      artifact_dataset validates, uploads and binds the 50,000 rows ≤ 2 s on the host (the call's wall time)
//   2 open      cold: the tab closed, a snapshot the host never read bound, the agent's holder released and the host's copy
//               proved unloaded (the seam's `loaded`, within 90 s); from the click on the library row to the frame after
//               the last of the twelve views is in the page ≤ 1,000 ms
//   3 render    one view of 10,000 points renders ≤ 200 ms (the chart view's `dash:view` User Timing entry: the
//               renderer's view and its insertion into the page, from the rows in hand), in each cold open
//   4 replace   from the first observed post-write revision announcement of the agent's replacement (the seam's
//               `announcedAt`: the public ArtifactStore.onChange `updated` at the answer's revision, from either producer;
//               not the durable commit) to the frame after the last view is drawn again ≤ 500 ms; an absent announcement
//               or a paint before it fails the trial; the call's start to that frame is end-to-end information
//   5 scroll    the source sheet scrolling the 50,000 raw rows: per scroll event, the main thread's time from the event to
//               the virtual rows' DOM commit (a Performance mark at each scroll event's timestamp, one at each commit the
//               rows' MutationObserver sees), p95 over every admitted trial's events pooled; each trial's own p95 and the
//               animation-frame interval's p95, max and cadence are information; any long task over 50 ms fails the row
//   6 renderer  the renderer process's own private memory (Electron's documented process.getProcessMemoryInfo().private,
//               read through the e2e-only preload getter window.__maws_processMemory) after the workload and no input,
//               sampled on the 10 s marks 0 through 60 inclusive (each sample and its completion overhead recorded):
//               any sample started at load 10 or more blocks the row; the later sample of the first consecutive pair
//               both started at or after 30 s and within 5 %, else the sample of the 60 s mark, ≤ 500 MB; a sample
//               started more than 1 s after its mark is kept and named but decides no pair (P3-F L249); a forced
//               collection's figures, taken after the binding samples, are a diagnostic only
// Admission (parent Decision Log 42): the first trial follows the measured specs' shared quiet admission (support/quiet.ts:
// the 1-minute load under 5 on two reads 30 s apart, at most five minutes here, recorded as the results' `quiet`; on its
// expiry the trials run as below), and every trial a bounded settle toward a 1-minute load below 10; a timing row
// (1 to 4) needs three admitted trials (started below 10), every one within its bound, at most five attempts; a trial at
// 10 or more is excluded, and fewer than three admitted is `hardware-blocked`, never met; the median and the best are
// description. Recorded beside them, with no bound: a bind at the parser's 200,000-row limit, a warm reopen, the sheet's
// read of every raw row. The run fails on a failed row, and separately on a hardware-blocked or unsettled one, naming
// them; everything is in `test-results/dashboard-scale.json` with the run's environment.
// Run on purpose only (the script sets the flag):
//   pnpm e2e:dashboard-scale        (scripts/e2e-build.sh plain && MAWS_DASHBOARD_SCALE=1 playwright test e2e/dashboard-scale.spec.ts)
import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus, platform, release, totalmem } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { BENCH_DATASET, BENCH_ROWS, BENCH_SCATTER_POINTS, BENCH_VIEWS, benchCsv, benchMarkdown } from '../src/artifacts/dashboard/fixtures/bench';
import { LOAD_BELOW, MEMORY_FLOOR_MS, MEMORY_LAST_MARK_MS, MEMORY_LATE_MS, MEMORY_SPACING_MS, memoryVerdict, percentile, privateMB, replacementInterval, REQUIRED_TRIALS, scrollVerdict, timingVerdict, type Verdict } from './support/dashboard-scale';
import { collectGarbage, jsHeapMB, load1, processMemory } from './support/document-scale';
import { REPO_ROOT } from './support/launch';
import { quietWait } from './support/quiet';
import { startApp, type AgentCall, type DashboardApp } from './support/dashboards';

test.skip(process.env.MAWS_DASHBOARD_SCALE !== '1', 'the dashboard scale gate runs only under MAWS_DASHBOARD_SCALE=1');
test.describe.configure({ timeout: 1_500_000 });

const RESULTS = join(REPO_ROOT, 'test-results', 'dashboard-scale.json');
const PROOF = 'test-results/dashboard-proof';
const TITLE = '판매 원장 대시보드';
const AGENT = 'A';
const MAX_ATTEMPTS = 5; // three admitted trials at most this many attempts, never retried without end
const UNLOAD_MS = 90_000; // the bound on the host's unload of the released dashboard (its idle minute and a margin)
const FIRST_SETTLE_MS = 5 * 60_000; // the quiet admission's budget: after the build's CPU burst, which the 1-minute load trails
const TRIAL_SETTLE_MS = 90_000;
const SETTLE_BUDGET_MS = 6 * 60_000; // every trial's settle, together
const VIEWS = BENCH_VIEWS.length;
const SCATTER = String(BENCH_VIEWS.find((spec) => spec.view === 'scatter')!.title);
const RAW_TABLE = BENCH_VIEWS.findIndex((spec) => spec.view === 'table' && spec.columns === undefined && spec.agg === undefined);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

// ---- the load rule and the rows ---------------------------------------------------------------------------------------

interface Reading {
  at: string;
  load: number;
}
let settleSpent = 0;
/** Waits, a reading every 10 s, until the 1-minute load is below 10 or `maxMs` has passed; the readings say which. */
async function settle(maxMs: number): Promise<{ settled: boolean; readings: Reading[] }> {
  const started = Date.now();
  const deadline = started + maxMs;
  const readings: Reading[] = [];
  for (;;) {
    const load = load1();
    readings.push({ at: new Date().toISOString(), load });
    if (load < LOAD_BELOW) break;
    if (Date.now() >= deadline) break;
    await sleep(Math.min(10_000, Math.max(0, deadline - Date.now())));
  }
  settleSpent += Date.now() - started;
  return { settled: readings.at(-1)!.load < LOAD_BELOW, readings };
}
const trialSettle = () => settle(Math.max(0, Math.min(TRIAL_SETTLE_MS, SETTLE_BUDGET_MS - settleSpent)));

interface Trial {
  value: number;
  load: number; // at the trial's start, after its settle: admitted below 10
  loadAfter: number;
  settle: Reading[];
  note?: string;
}
interface Row {
  row: string;
  measure: string;
  bound: string;
  limit: number | null;
  unit: string;
  value: number | null; // the gated figure: a timing row's worst admitted trial, the pooled p95, the settled private memory
  median: number | null; // description
  best: number | null; // description
  verdict: Verdict;
  admitted: number;
  trials: Trial[];
  reason?: string;
  note?: string;
}

const fixed = (n: number | null) => (n === null || Number.isNaN(n) ? null : +n.toFixed(2));

class Rows {
  readonly rows: Row[] = [];
  private readonly extra: Record<string, unknown> = {};
  constructor(private readonly meta: Record<string, unknown>) {}

  add(entry: Row): Row {
    this.rows.push(entry);
    this.write();
    console.log(`[dashboard scale] ${entry.row}: ${entry.value ?? '—'} ${entry.unit} (${entry.verdict}; bound ${entry.bound}; ${entry.admitted} admitted of ${entry.trials.length}; loads ${entry.trials.map((t) => t.load).join(', ')})${entry.reason ? `; ${entry.reason}` : ''}${entry.note ? `; ${entry.note}` : ''}`);
    return entry;
  }

  /** A timing row (parent Decision Log 42): every admitted trial within the bound, three of them; or recorded. */
  timing(row: string, measure: string, unit: string, limit: number | null, bound: string, trials: Trial[], note?: string): Row {
    const judged = timingVerdict(trials, limit);
    const admittedValues = trials.filter((t) => t.load < LOAD_BELOW).map((t) => t.value);
    const values = trials.map((t) => t.value);
    return this.add({ row, measure, bound, limit, unit, value: fixed(admittedValues.length > 0 ? Math.max(...admittedValues) : null), median: fixed(values.length > 0 ? median(values) : null), best: fixed(values.length > 0 ? Math.min(...values) : null), verdict: judged.verdict, admitted: judged.admitted, trials: trials.map((t) => ({ ...t, value: +t.value.toFixed(2) })), ...(judged.reason && { reason: judged.reason }), ...(note && { note }) });
  }

  write(extra: Record<string, unknown> = {}): void {
    Object.assign(this.extra, extra);
    mkdirSync(join(RESULTS, '..'), { recursive: true });
    writeFileSync(RESULTS, `${JSON.stringify({ ...this.meta, ...this.extra, judging: `parent Decision Log 42: the first trial after the shared quiet admission (\`quiet\`), every trial after a bounded settle toward a 1-minute load below ${LOAD_BELOW}; a timing row needs ${REQUIRED_TRIALS} admitted trials (started below ${LOAD_BELOW}) each within its bound, at most ${MAX_ATTEMPTS} attempts, fewer admitted hardware-blocked; the scroll row the p95 of every admitted event pooled, a long task over 50 ms failing it; the renderer's private memory (process.getProcessMemoryInfo, samples on the 10 s marks 0 through 60, every one below load ${LOAD_BELOW}: the first pair from 30 s within 5 %, else the 60 s sample); median and best descriptive`, rows: this.rows }, null, 2)}\n`);
  }
}

/** One trial: its settle, the measure, the loads around it. */
async function trial(measure: () => Promise<{ value: number; note?: string }>): Promise<Trial> {
  const { readings } = await trialSettle();
  const load = load1();
  const { value, note } = await measure();
  return { value, load, loadAfter: load1(), settle: readings, ...(note && { note }) };
}

/** Attempts until three are admitted (started below load 10), at most five: the excluded ones kept beside them. */
async function admittedTrials(attempt: (k: number) => Promise<Trial>): Promise<Trial[]> {
  const trials: Trial[] = [];
  for (let k = 0; k < MAX_ATTEMPTS && trials.filter((t) => t.load < LOAD_BELOW).length < REQUIRED_TRIALS; k++) trials.push(await attempt(k));
  return trials;
}

// ---- the app's surfaces --------------------------------------------------------------------------------------------

type Win = Window & Record<string, unknown>;

async function showLibrary(page: Page): Promise<void> {
  await page.locator('[data-region="sidebar"]').getByRole('button', { name: 'Artifacts', exact: true }).click();
  await expect(page.locator('[data-library]')).toBeVisible({ timeout: 15_000 });
}
async function closeTab(page: Page): Promise<void> {
  const close = page.getByRole('button', { name: `Close ${TITLE}`, exact: true });
  if ((await close.count()) === 0) return;
  await close.click();
  await expect(close).toHaveCount(0, { timeout: 15_000 });
}
/** Collects every `dash:view` User Timing entry from now on, under `key`, as {caption, ms}, until it is read. */
const observeViews = (page: Page, key: string) =>
  page.evaluate((k) => {
    const into: { caption: string; ms: number }[] = [];
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) if (entry.name === 'dash:view') into.push({ caption: String((entry as PerformanceMeasure).detail?.caption ?? ''), ms: entry.duration });
    });
    observer.observe({ type: 'measure' });
    (window as unknown as Win)[k] = { into, observer };
  }, key);
const viewTimings = (page: Page, key: string) =>
  page.evaluate((k) => {
    const held = (window as unknown as Win)[k] as { into: { caption: string; ms: number }[]; observer: PerformanceObserver };
    held.observer.disconnect();
    return [...held.into];
  }, key);

// In the page, both timed waits mark `done` at the frame after their condition first holds: a MutationObserver sees the
// condition, then requestAnimationFrame and a posted message, as near that frame's paint as a page sees it.

/** Opens the dashboard from the library: the click's timestamp to the frame after the last view is in the page, and the views' timings. */
async function openTimed(page: Page, id: string, key: string): Promise<{ ms: number; views: { caption: string; ms: number }[] }> {
  await showLibrary(page);
  await observeViews(page, key);
  await page.evaluate(
    ({ artifactId, count }) => {
      const state: { click: number | null; seen: boolean; done: number | null } = { click: null, seen: false, done: null };
      (window as unknown as Win).__dashOpen = state;
      document.addEventListener('click', (event) => {
        if ((event.target as Element | null)?.closest?.(`[data-artifact-row="${artifactId}"]`)) state.click ??= event.timeStamp;
      }, { capture: true, once: true });
      const drawn = () => {
        if (state.click === null) return false;
        const figures = document.querySelectorAll(`[data-artifact-tab="${artifactId}"] .ds-doc figure.dash-view`);
        return figures.length === count && Array.from(figures).every((figure) => figure.querySelector('.dash-figure > svg, .dash-figure > table') !== null && !figure.hasAttribute('aria-busy') && !figure.querySelector('.dash-loading'));
      };
      const observer = new MutationObserver(() => {
        if (state.seen || !drawn()) return;
        state.seen = true;
        observer.disconnect();
        requestAnimationFrame(() => {
          const channel = new MessageChannel();
          channel.port1.onmessage = () => void (state.done = performance.now());
          channel.port2.postMessage(0);
        });
      });
      observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-busy', 'class'] });
    },
    { artifactId: id, count: VIEWS },
  );
  await page.locator(`[data-library] article[data-artifact-row="${id}"]`).click({ timeout: 15_000 });
  await expect.poll(() => page.evaluate(() => (window as unknown as { __dashOpen: { done: number | null } }).__dashOpen.done !== null), { timeout: 60_000, message: 'every view drawn and painted' }).toBe(true);
  const { click, done } = await page.evaluate(() => (window as unknown as { __dashOpen: { click: number; done: number } }).__dashOpen);
  return { ms: done - click, views: await viewTimings(page, key) };
}

const ledgerCsv = (variant: number) => benchCsv(BENCH_ROWS, variant);

test('the dashboard scale gate on the 50,000-row bench: bind, cold open, a 10,000-point view, replacement, source scroll, the renderer', async () => {
  const first = await settle(0); // the load as the run starts, the build just done
  let app: DashboardApp | null = null;
  try {
    app = await startApp(PROOF);
    const { page, agent, launch } = app;
    await launch.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1600, 1000));
    const meta = {
      run: new Date().toISOString(),
      runId: process.env.GITHUB_RUN_ID ?? null,
      commit: process.env.GITHUB_SHA ?? null,
      environment: { platform: platform(), release: release(), cpus: cpus().length, cpu: cpus()[0]?.model ?? null, memoryGB: +(totalmem() / 2 ** 30).toFixed(1), node: process.version, electron: await launch.app.evaluate(() => process.versions.electron), runner: process.env.RUNNER_NAME ?? null },
      bench: `benchCsv(${BENCH_ROWS}) and BENCH_VIEWS (${VIEWS} views, the scatter ${BENCH_SCATTER_POINTS} points): src/artifacts/dashboard/fixtures/bench.ts`,
    };
    const rows = new Rows(meta);
    const quiet = await quietWait({ budgetMs: FIRST_SETTLE_MS });
    console.log(`[dashboard scale] the first trial's admission: ${quiet.summary}`);
    rows.write({ settle: { start: first.readings }, quiet });

    const { artifactId: id } = await agent.ok<{ artifactId: string }>(AGENT, 'artifact_create', { kind: 'dashboard', title: TITLE, content: benchMarkdown() });
    let variant = 0;
    /** The agent's replacement of the ledger with new bytes, from the revision it just read. */
    const replace = async (): Promise<AgentCall<{ revision: number; rows: number }>> => {
      const name = await agent.write(AGENT, 'ledger.csv', ledgerCsv(variant++));
      await agent.ok(AGENT, 'artifact_read', { artifact: id });
      const answer = await agent.call<{ revision: number; rows: number }>(AGENT, 'artifact_dataset', { artifact: id, baseRevision: 'last', id: BENCH_DATASET, title: '판매 원장', path: name }, { timeoutMs: 120_000 });
      if (answer.isError) throw new Error(`the agent's bind was refused: ${answer.text}`);
      expect(answer.result!.rows).toBe(BENCH_ROWS);
      return answer;
    };
    const loaded = async () => (await agent.loaded(id)).loaded;

    await test.step('1: artifact_dataset binds the 50,000-row ledger (each attempt new bytes), the dashboard closed', async () => {
      const trials = await admittedTrials(() =>
        trial(async () => {
          const answer = await replace();
          return { value: answer.wallMs, note: `host loop busy ${answer.busyMs.toFixed(1)} ms, its longest stretch ${answer.loop.max.toFixed(1)} ms` };
        }),
      );
      rows.timing('1 bind', `artifact_dataset on the host: read the ${BENCH_ROWS}-row CSV under the session's directory, parse and validate it, register its asset, write its descriptor in one commit (the call's wall time)`, 'ms', 2000, 'every admitted trial ≤ 2,000 ms', trials);
      const limit = await trial(async () => {
        const name = await agent.write(AGENT, 'limit.csv', benchCsv(200_000, 9));
        const answer = await agent.call<{ rows: number }>(AGENT, 'artifact_dataset', { artifact: id, baseRevision: 'last', id: 'limit', path: name }, { timeoutMs: 120_000 });
        if (answer.isError) throw new Error(`the limit bind was refused: ${answer.text}`);
        expect(answer.result!.rows).toBe(200_000);
        return { value: answer.wallMs, note: `host loop busy ${answer.busyMs.toFixed(1)} ms, longest stretch ${answer.loop.max.toFixed(1)} ms` };
      });
      rows.timing('1b bind at the row limit', 'artifact_dataset of a 200,000-row CSV (the parser’s row limit candidate), bound to no view', 'ms', null, 'recorded', [limit]);
    });

    await test.step('2 and 3: open cold (a snapshot never read, the holder released, the host’s copy proved unloaded); the 10,000-point view’s render in each; warm once', async () => {
      const render: Trial[] = [];
      const cold = await admittedTrials(async (k) => {
        await closeTab(page);
        // a snapshot the host has never read (its parse cache misses it: a bind parses apart from the reader), the
        // agent's replicas closed, then the host's idle unload of the dashboard nobody holds, observed
        await replace();
        await agent.release(AGENT);
        const releasedAt = Date.now();
        await expect.poll(loaded, { timeout: UNLOAD_MS, intervals: [1_000], message: `the host unloads the released dashboard within ${UNLOAD_MS / 1000} s` }).toBe(false);
        const unloadedIn = Date.now() - releasedAt;
        let views: { caption: string; ms: number }[] = [];
        const done = await trial(async () => {
          expect(await loaded(), 'still unloaded as the open starts').toBe(false);
          const open = await openTimed(page, id, `__dashCold${k}`);
          views = open.views;
          return { value: open.ms, note: `unloaded ${(unloadedIn / 1000).toFixed(1)} s after the release; ${open.views.length} views drawn; slowest ${Math.max(...open.views.map((v) => v.ms)).toFixed(1)} ms` };
        });
        const scatter = views.filter((v) => v.caption === SCATTER).map((v) => v.ms);
        expect(scatter.length, 'the 10,000-point view was drawn and timed').toBeGreaterThan(0);
        render.push({ ...done, value: Math.max(...scatter), note: `the scatter's dash:view entries ${scatter.map((ms) => ms.toFixed(1)).join(', ')} ms` });
        return done;
      });
      rows.timing('2 open cold', `cold open: the click on the library row to the frame after the last of ${VIEWS} views is in the page; first the tab closed, a snapshot the host has never read bound, the agent's holder released and the host's copy proved unloaded (the seam's loaded, ≤ ${UNLOAD_MS / 1000} s)`, 'ms', 1000, 'every admitted trial ≤ 1,000 ms', cold);
      rows.timing('3 render 10,000 points', `one view of ${BENCH_SCATTER_POINTS} points (the scatter): the chart view's dash:view entry, the renderer's view and its insertion into the page, from the rows in hand, in each cold open (the largest of an open's entries)`, 'ms', 200, 'every admitted trial ≤ 200 ms', render);
      await closeTab(page);
      const warm = await trial(async () => {
        const open = await openTimed(page, id, '__dashWarm');
        return { value: open.ms };
      });
      rows.timing('2b open warm', 'warm reopen: the same, the host’s copy and parse cache loaded', 'ms', null, 'recorded', [warm]);
      await page.locator(`[data-artifact-tab="${id}"]`).screenshot({ path: `${PROOF}/scale-open.png` });
    });

    await test.step('4: the agent’s replacement, from its first observed post-write revision announcement to every view painted again', async () => {
      const failures: string[] = [];
      const trials = await admittedTrials(() =>
        trial(async () => {
          await page.evaluate(
            ({ artifactId, count }) => {
              const frames = () => Array.from(document.querySelectorAll(`[data-artifact-tab="${artifactId}"] .ds-doc figure.dash-view .dash-figure`));
              const old = frames().map((frame) => frame.firstElementChild);
              const state: { seen: boolean; done: number | null } = { seen: false, done: null };
              (window as unknown as Win).__dashSwap = state;
              const drawn = () => {
                const now = frames();
                return now.length === count && now.every((frame, i) => frame.firstElementChild !== old[i] && frame.querySelector(':scope > svg, :scope > table') !== null && !frame.closest('figure')!.hasAttribute('aria-busy'));
              };
              const observer = new MutationObserver(() => {
                if (state.seen || !drawn()) return;
                state.seen = true;
                observer.disconnect();
                requestAnimationFrame(() => {
                  const channel = new MessageChannel();
                  channel.port1.onmessage = () => void (state.done = Date.now());
                  channel.port2.postMessage(0);
                });
              });
              observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-busy'] });
            },
            { artifactId: id, count: VIEWS },
          );
          const answer = await replace();
          await expect.poll(() => page.evaluate(() => (window as unknown as { __dashSwap: { done: number | null } }).__dashSwap.done !== null), { timeout: 60_000, message: 'every view drawn again and painted' }).toBe(true);
          const painted = await page.evaluate(() => (window as unknown as { __dashSwap: { done: number } }).__dashSwap.done);
          const interval = replacementInterval(answer.announcedAt, painted);
          const endToEnd = `the call's start to the paint ${painted - answer.startedAt} ms (the bind ${answer.wallMs.toFixed(0)} ms)`;
          if (!interval.ok) {
            failures.push(interval.reason);
            return { value: Number.POSITIVE_INFINITY, note: `${interval.reason}; ${endToEnd}` };
          }
          return { value: interval.value, note: `${endToEnd}; announced ${answer.announcedAt! - answer.startedAt} ms after the call's start` };
        }),
      );
      rows.timing('4 replace to all views', `a replacement by the agent (artifact_dataset, new bytes): from its first observed post-write revision announcement (the seam's announcedAt, the public ArtifactStore.onChange updated at the answer's revision; not the durable commit) to the frame after the last of ${VIEWS} views is drawn again in the open tab (host and page on one clock)`, 'ms', 500, 'every admitted trial ≤ 500 ms', trials, failures.length > 0 ? failures.join('; ') : undefined);
    });

    await test.step('5: the source sheet scrolls the 50,000 raw rows: event to DOM commit pooled over three admitted trials; the long tasks and the frame cadence beside it', async () => {
      const tab = page.locator(`[data-artifact-tab="${id}"]`);
      await tab.locator('.ds-doc figure.dash-view').nth(RAW_TABLE).locator('button.dash-source-label').click();
      const sheet = page.getByRole('dialog', { name: /^Source of / });
      await expect(sheet).toBeVisible();
      const readAll = await trial(async () => {
        const started = Date.now();
        await sheet.getByRole('button', { name: `All source rows (${BENCH_ROWS.toLocaleString('en-US')})` }).click();
        await expect(sheet.getByRole('table', { name: 'Rows' })).toHaveAttribute('aria-rowcount', String(BENCH_ROWS + 1), { timeout: 60_000 });
        return { value: Date.now() - started };
      });
      rows.timing('5b sheet reads every raw row', `the sheet's bounded pages of the ${BENCH_ROWS}-row snapshot read and shown (the click to its row count; the tab's reader may hold them from the raw table view)`, 'ms', null, 'recorded', [readAll]);
      const table = sheet.getByRole('table', { name: 'Rows' });
      const box = (await table.boundingBox())!;
      const seenTrials: { work: number[]; load: number; longTasks: number[] }[] = [];
      const trials = await admittedTrials(() =>
        trial(async () => {
          await table.evaluate((scroller) => {
            scroller.scrollTop = 0;
            const rows = scroller.querySelector('.dash-sheet-rows')!;
            const record = { frames: [] as number[], longTasks: [] as number[], done: false, stop: () => {} };
            (window as unknown as Win).__dashScroll = record;
            performance.clearMarks('dash:scroll');
            performance.clearMarks('dash:commit');
            // one listener and two observers per trial, each removed when the trial ends
            const onScroll = (event: Event) => void performance.mark('dash:scroll', { startTime: event.timeStamp });
            scroller.addEventListener('scroll', onScroll, { passive: true });
            const commits = new MutationObserver(() => void performance.mark('dash:commit'));
            commits.observe(rows, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'aria-rowindex'] });
            const longTasks = new PerformanceObserver((list) => list.getEntries().forEach((entry) => record.longTasks.push(entry.duration)));
            longTasks.observe({ type: 'longtask' });
            record.stop = () => {
              scroller.removeEventListener('scroll', onScroll);
              commits.disconnect();
              longTasks.disconnect();
            };
            const frame = (at: number) => {
              record.frames.push(at);
              if (!record.done) requestAnimationFrame(frame);
            };
            requestAnimationFrame(frame);
          });
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
          for (let i = 0; i < 150; i++) {
            await page.mouse.wheel(0, 120);
            await page.waitForTimeout(16);
          }
          // jumps across the whole snapshot, as a scrollbar drag lands
          for (let i = 1; i <= 20; i++)
            await table.evaluate(async (scroller, fraction) => {
              scroller.scrollTop = fraction * (scroller.scrollHeight - scroller.clientHeight);
              await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            }, i / 20);
          await page.waitForTimeout(300);
          const seen = await table.evaluate(() => {
            const record = (window as unknown as { __dashScroll: { frames: number[]; longTasks: number[]; done: boolean; stop(): void } }).__dashScroll;
            record.done = true;
            record.stop();
            const scrolls = performance.getEntriesByName('dash:scroll').map((m) => m.startTime);
            const commits = performance.getEntriesByName('dash:commit').map((m) => m.startTime);
            performance.clearMarks('dash:scroll');
            performance.clearMarks('dash:commit');
            return { scrolls, commits, frames: record.frames, longTasks: record.longTasks };
          });
          // each scroll event's time to the first rows commit after it (an event whose commit came later, past the next
          // event, is charged the whole wait); an event no commit followed is counted apart
          const work: number[] = [];
          let uncommitted = 0;
          for (const at of seen.scrolls) {
            const commit = seen.commits.find((c) => c >= at);
            if (commit === undefined) uncommitted += 1;
            else work.push(commit - at);
          }
          seenTrials.push({ work, load: Number.NaN, longTasks: seen.longTasks }); // its start load set below, from the trial's
          const intervals = seen.frames.slice(1).map((at, i) => at - seen.frames[i]!);
          return {
            value: percentile(work, 0.95),
            note: `this trial's own p95 (information); ${seen.scrolls.length} scroll events, ${work.length} committed (${uncommitted} without a commit after them); work p50 ${percentile(work, 0.5).toFixed(2)}, max ${Math.max(...work).toFixed(2)} ms; rAF interval p50 ${percentile(intervals, 0.5).toFixed(2)} (cadence ${(1000 / percentile(intervals, 0.5)).toFixed(1)} Hz), p95 ${percentile(intervals, 0.95).toFixed(2)}, max ${Math.max(...intervals).toFixed(2)} ms; long tasks ${seen.longTasks.length} (longest ${Math.max(0, ...seen.longTasks).toFixed(1)} ms)`,
          };
        }),
      );
      // the trial's admission is its start load, the same as every row's
      seenTrials.forEach((t, k) => (t.load = trials[k]!.load));
      const judged = scrollVerdict(seenTrials, 16);
      rows.add({
        row: '5 source scroll',
        measure: `the source sheet scrolling ${BENCH_ROWS} raw rows (150 wheel steps of 120 px, then 20 jumps across the snapshot): per scroll event, the main thread's time from the event to the virtual rows' DOM commit (Performance marks), p95 over every admitted trial's events pooled`,
        bound: 'pooled p95 ≤ 16 ms; any long task over 50 ms fails it',
        limit: 16,
        unit: 'ms',
        value: fixed(judged.pooledP95),
        median: fixed(median(judged.perTrialP95)),
        best: fixed(Math.min(...judged.perTrialP95)),
        verdict: judged.verdict,
        admitted: seenTrials.filter((t) => t.load < LOAD_BELOW).length,
        trials: trials.map((t) => ({ ...t, value: +t.value.toFixed(2) })),
        ...(judged.reason && { reason: judged.reason }),
        note: `${judged.events} admitted events pooled; per-trial p95 ${judged.perTrialP95.map((v) => v.toFixed(2)).join(', ')} ms and the frame cadence are information, never the bound`,
      });
      await page.screenshot({ path: `${PROOF}/scale-sheet.png` });
      await page.keyboard.press('Escape');
    });

    await test.step('6: the renderer’s private memory after the workload and no input, sampled for a minute; a forced collection’s figures after it', async () => {
      // the target renderer's own process.getProcessMemoryInfo() through the e2e-only preload getter; absent, the row
      // fails by name (no fallback, no wider gate)
      const privateNow = async (): Promise<number> => {
        const read = await page.evaluate(async () => {
          const getter = (window as unknown as { __maws_processMemory?: () => Promise<unknown> }).__maws_processMemory;
          return typeof getter === 'function' ? { info: await getter() } : { absent: true as const };
        });
        if ('absent' in read) throw new Error('window.__maws_processMemory is absent: the sandboxed preload did not see MAWS_E2E=1 (no fallback)');
        return privateMB(read.info);
      };
      // the binding samples, on the 10 s marks 0 through 60 inclusive and no other: every one kept, the schedule never
      // extended or shifted to seek a settled pair; its completion overhead recorded beside it
      const t0 = Date.now();
      const samples: { startedAt: number; completedAt: number; load: number; mb: number }[] = [];
      for (let mark = 0; mark <= MEMORY_LAST_MARK_MS; mark += MEMORY_SPACING_MS) {
        const due = t0 + mark;
        if (Date.now() < due) await sleep(due - Date.now());
        const startedAt = Date.now() - t0;
        const load = load1();
        const mb = await privateNow();
        samples.push({ startedAt, completedAt: Date.now() - t0, load, mb }); // raw: memoryVerdict rounds only what it reports (P4 L189)
      }
      const judged = memoryVerdict(samples, 500);
      // the diagnostic, after the binding samples: the same renderer after a forced collection (never the gate)
      await collectGarbage(page);
      await sleep(500);
      const collected = { privateMB: +(await privateNow()).toFixed(1), workingSetMB: (await processMemory(launch.app)).renderers[0]?.workingSetMB ?? Number.NaN, jsHeapMB: await jsHeapMB(page) };
      rows.write({ memory: { samples, judged, afterForcedCollection: collected } });
      rows.add({
        row: '6 renderer',
        measure: `the renderer process's own private memory (process.getProcessMemoryInfo().private, Electron's documented renderer API) with the ${VIEWS}-view dashboard open after the scrolls and replacements, no input, sampled on the ${MEMORY_SPACING_MS / 1000} s marks 0 through ${MEMORY_LAST_MARK_MS / 1000} s: the later sample of the first consecutive pair both started at or after ${MEMORY_FLOOR_MS / 1000} s and within 5 % (a sample started more than ${MEMORY_LATE_MS / 1000} s after its mark kept and named, in no pair), else the sample of the ${MEMORY_LAST_MARK_MS / 1000} s mark; every sample started below load ${LOAD_BELOW}`,
        bound: '≤ 500 MB, idle from 30 s',
        limit: 500,
        unit: 'MB',
        value: judged.value,
        median: null,
        best: null,
        verdict: judged.verdict,
        admitted: samples.filter((sample) => sample.load < LOAD_BELOW).length,
        trials: samples.map((sample, k) => ({ value: +sample.mb.toFixed(1), load: sample.load, loadAfter: sample.load, settle: [], note: `the ${(k * MEMORY_SPACING_MS) / 1000} s mark: started ${(sample.startedAt / 1000).toFixed(1)} s, completed ${(sample.completedAt / 1000).toFixed(1)} s (overhead ${sample.completedAt - sample.startedAt} ms)${judged.excluded.some((e) => e.mark === k * MEMORY_SPACING_MS) ? `; started more than ${MEMORY_LATE_MS / 1000} s late, in no deciding pair` : ''}` })),
        ...(judged.reason && { reason: judged.reason }),
        note: `after a forced collection (diagnostic only): private ${collected.privateMB} MB, working set ${collected.workingSetMB} MB, JS heap ${collected.jsHeapMB} MB`,
      });
    });

    await agent.release(AGENT);
    const failed = rows.rows.filter((r) => r.verdict === 'failed');
    const blocked = rows.rows.filter((r) => r.verdict === 'hardware-blocked' || r.verdict === 'unsettled');
    rows.write({ settleSpentMs: settleSpent, end: { load: load1() }, failed: failed.map((r) => r.row), hardwareBlockedOrUnsettled: blocked.map((r) => r.row) });
    expect(failed.map((r) => `${r.row}: ${r.value} ${r.unit} against ${r.limit}${r.reason ? ` (${r.reason})` : ''}`), `bounds failed (every figure is in ${RESULTS})`).toEqual([]);
    expect(blocked.map((r) => `${r.row} ${r.verdict}: ${r.reason ?? ''}`), `hardware-blocked or unsettled: never a bound met (${RESULTS})`).toEqual([]);
    expect(launch.consoleErrors(), 'the console stays free of errors').toEqual([]);
  } finally {
    await app?.close();
  }
});
