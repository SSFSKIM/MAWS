// The dashboard's scale gate (P3-E2 M6 of docs/doperpowers/plans/2026-10-16-p3-e2-dashboard.md, acceptance 7; P3-E
// Decision Log 36 (4) and (5)): the product build, the agent's real tools through the host's acceptance seam
// (src/engine-host/dashboards/e2e-seam.ts), and the scale bench (src/artifacts/dashboard/fixtures/bench.ts: a seeded
// 50,000-row ledger, explicitly synthetic, and twelve views of every kind, one a scatter of exactly 10,000 points).
// Rows, the candidates acceptance 7 names (ratified after measurement by the architect, never relaxed here):
//   1 bind      artifact_dataset validates, uploads and binds the 50,000 rows ≤ 2 s on the host (the call's wall time)
//   2 open      cold (the host restarted, so its copy and its parse cache are cold; the tab closed) from the click on the
//               library row to every one of the twelve views drawn ≤ 1,000 ms
//   3 render    one view of 10,000 points renders ≤ 200 ms (the chart view's `dash:view` User Timing entry: the
//               renderer's view and its insertion into the page, from the rows in hand)
//   4 replace   from the agent's replacement answering (its commit landed) to every view drawn again ≤ 500 ms
//   5 scroll    the source sheet scrolling the 50,000 raw rows: per scroll event, the main thread's time from the event to
//               the virtual rows' DOM commit, p95 ≤ 16 ms, from Performance marks the page takes (a mark at each scroll
//               event's timestamp, a mark at each commit the rows' MutationObserver sees); every long task over 50 ms
//               during a scroll fails the row on its own; the animation-frame interval's p95 and max and the cadence
//               they imply are recorded beside it, never folded into the bound (the mini's display runs near 54 Hz)
//   6 renderer  the renderer's working set ≤ 500 MB, read after a forced collection
// Recorded beside them, with no bound: a bind at the parser's 200,000-row limit, a warm reopen, the sheet's read of every
// raw row, each call's host loop and the JS heap. The load rule (E2's own, Decision Log 36 (4)): after the build, a
// bounded settle until the 1-minute load is below 10, and again before every trial; a trial measured at a load of 10
// or more makes its row `hardware-blocked`, never met and never a product failure. Each row is judged on the median of
// its trials (every trial and the best kept beside it). The run fails on any failed row, and separately on any
// hardware-blocked row, naming them; everything is in `test-results/dashboard-scale.json` with the run's environment.
// Run on purpose only (the script sets the flag):
//   pnpm e2e:dashboard-scale        (scripts/e2e-build.sh plain && MAWS_DASHBOARD_SCALE=1 playwright test e2e/dashboard-scale.spec.ts)
import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus, platform, release, totalmem } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { BENCH_DATASET, BENCH_ROWS, BENCH_SCATTER_POINTS, BENCH_VIEWS, benchCsv, benchMarkdown } from '../src/artifacts/dashboard/fixtures/bench';
import { collectGarbage, jsHeapMB, load1, processMemory } from './support/document-scale';
import { REPO_ROOT } from './support/launch';
import { restartHost, startApp, type DashboardApp } from './support/dashboards';

test.skip(process.env.MAWS_DASHBOARD_SCALE !== '1', 'the dashboard scale gate runs only under MAWS_DASHBOARD_SCALE=1');
test.describe.configure({ timeout: 1_500_000 });

const RESULTS = join(REPO_ROOT, 'test-results', 'dashboard-scale.json');
const PROOF = 'test-results/dashboard-proof';
const TITLE = '판매 원장 대시보드';
const AGENT = 'A';
const TRIALS = 3;
const LOAD_BELOW = 10;
const FIRST_SETTLE_MS = 5 * 60_000; // after the build's CPU burst, which the 1-minute load trails
const TRIAL_SETTLE_MS = 90_000;
const SETTLE_BUDGET_MS = 6 * 60_000; // every settle after the first, together
const VIEWS = BENCH_VIEWS.length;
const SCATTER = String(BENCH_VIEWS.find((spec) => spec.view === 'scatter')!.title);
const RAW_TABLE = BENCH_VIEWS.findIndex((spec) => spec.view === 'table' && spec.columns === undefined && spec.agg === undefined);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
const pct = (xs: number[], p: number) => (xs.length === 0 ? NaN : [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.ceil(p * xs.length) - 1)]!);

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

type Verdict = 'met' | 'failed' | 'recorded' | 'hardware-blocked';
interface Trial {
  value: number;
  load: number; // at the trial's start, after its settle
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
  value: number; // the trials' median
  best: number;
  verdict: Verdict;
  trials: Trial[];
  note?: string;
}

class Rows {
  readonly rows: Row[] = [];
  private readonly extra: Record<string, unknown> = {};
  constructor(private readonly meta: Record<string, unknown>) {}

  /** A row judged on its trials' median; `failedBy` a reason that fails it whatever its value (a long task). */
  add(row: string, measure: string, unit: string, limit: number | null, bound: string, trials: Trial[], note?: string, failedBy?: string): Row {
    const value = median(trials.map((t) => t.value));
    const blocked = trials.some((t) => t.load >= LOAD_BELOW);
    const verdict: Verdict = limit === null ? 'recorded' : blocked ? 'hardware-blocked' : failedBy !== undefined || !(value <= limit) ? 'failed' : 'met';
    const entry: Row = { row, measure, bound, limit, unit, value: +value.toFixed(2), best: +Math.min(...trials.map((t) => t.value)).toFixed(2), verdict, trials: trials.map((t) => ({ ...t, value: +t.value.toFixed(2) })), ...((note || failedBy) && { note: [failedBy, note].filter(Boolean).join('; ') }) };
    this.rows.push(entry);
    this.write();
    console.log(`[dashboard scale] ${row}: ${entry.value} ${unit} (median of ${trials.length}; best ${entry.best}; ${verdict}; bound ${bound}; loads ${trials.map((t) => t.load).join(', ')})${entry.note ? `; ${entry.note}` : ''}`);
    return entry;
  }

  write(extra: Record<string, unknown> = {}): void {
    Object.assign(this.extra, extra);
    mkdirSync(join(RESULTS, '..'), { recursive: true });
    writeFileSync(RESULTS, `${JSON.stringify({ ...this.meta, ...this.extra, judging: `E2's load rule (P3-E Decision Log 36 (4)): every trial after a bounded settle to a 1-minute load below ${LOAD_BELOW}; a trial at ${LOAD_BELOW} or more makes its row hardware-blocked; a row judged on its trials' median, the best kept beside it; a long task over 50 ms during a scroll fails the scroll row on its own`, rows: this.rows }, null, 2)}\n`);
  }
}

/** One trial: its settle, the measure, the loads around it. */
async function trial(measure: () => Promise<{ value: number; note?: string }>): Promise<Trial> {
  const { readings } = await trialSettle();
  const load = load1();
  const { value, note } = await measure();
  return { value, load, loadAfter: load1(), settle: readings, ...(note && { note }) };
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
/** Collects every `dash:view` User Timing entry from now on, under `key`, as {caption, ms}. */
const observeViews = (page: Page, key: string) =>
  page.evaluate((k) => {
    const into: { caption: string; ms: number }[] = [];
    (window as unknown as Win)[k] = into;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) if (entry.name === 'dash:view') into.push({ caption: String((entry as PerformanceMeasure).detail?.caption ?? ''), ms: entry.duration });
    }).observe({ type: 'measure' });
  }, key);
const viewTimings = (page: Page, key: string) => page.evaluate((k) => [...((window as unknown as Win)[k] as { caption: string; ms: number }[])], key);

/** Opens the dashboard from the library; answers the click's timestamp to every view drawn, in ms, and the views' timings. */
async function openTimed(page: Page, id: string, key: string): Promise<{ ms: number; views: { caption: string; ms: number }[] }> {
  await showLibrary(page);
  await observeViews(page, key);
  await page.evaluate(
    ({ artifactId, count }) => {
      const state: { click: number | null; drawn: number | null } = { click: null, drawn: null };
      (window as unknown as Win).__dashOpen = state;
      document.addEventListener('click', (event) => {
        if ((event.target as Element | null)?.closest?.(`[data-artifact-row="${artifactId}"]`)) state.click ??= event.timeStamp;
      }, { capture: true, once: true });
      const drawn = () => {
        const figures = document.querySelectorAll(`[data-artifact-tab="${artifactId}"] .ds-doc figure.dash-view`);
        return figures.length === count && Array.from(figures).every((figure) => figure.querySelector('.dash-figure > svg, .dash-figure > table') !== null && !figure.hasAttribute('aria-busy') && !figure.querySelector('.dash-loading'));
      };
      const observer = new MutationObserver(() => {
        if (state.click === null || !drawn()) return;
        state.drawn = performance.now();
        observer.disconnect();
      });
      observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-busy', 'class'] });
    },
    { artifactId: id, count: VIEWS },
  );
  await page.locator(`[data-library] article[data-artifact-row="${id}"]`).click({ timeout: 15_000 });
  await expect.poll(() => page.evaluate(() => (window as unknown as { __dashOpen: { drawn: number | null } }).__dashOpen.drawn !== null), { timeout: 60_000, message: 'every view drawn' }).toBe(true);
  const { click, drawn } = await page.evaluate(() => (window as unknown as { __dashOpen: { click: number; drawn: number } }).__dashOpen);
  return { ms: drawn - click, views: await viewTimings(page, key) };
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
    const settled = await settle(FIRST_SETTLE_MS);
    rows.write({ settle: { start: first.readings, afterBuild: settled.readings, settled: settled.settled } });
    settleSpent = 0;

    const { artifactId: id } = await agent.ok<{ artifactId: string }>(AGENT, 'artifact_create', { kind: 'dashboard', title: TITLE, content: benchMarkdown() });
    let variant = 0;
    const replace = async () => {
      const name = await agent.write(AGENT, 'ledger.csv', ledgerCsv(variant++));
      await agent.ok(AGENT, 'artifact_read', { artifact: id }); // the session's base, after any host restart
      const answer = await agent.call<{ revision: number; rows: number }>(AGENT, 'artifact_dataset', { artifact: id, baseRevision: 'last', id: BENCH_DATASET, title: '판매 원장', path: name }, { timeoutMs: 120_000 });
      if (answer.isError) throw new Error(`the agent's bind was refused: ${answer.text}`);
      expect(answer.result!.rows).toBe(BENCH_ROWS);
      return answer;
    };

    await test.step('1: artifact_dataset binds the 50,000-row ledger, three times (each new bytes), the dashboard closed', async () => {
      const trials: Trial[] = [];
      for (let k = 0; k < TRIALS; k++)
        trials.push(
          await trial(async () => {
            const answer = await replace();
            return { value: answer.wallMs, note: `host loop busy ${answer.busyMs.toFixed(1)} ms, its longest stretch ${answer.loop.max.toFixed(1)} ms` };
          }),
        );
      rows.add('1 bind', `artifact_dataset on the host: read the ${BENCH_ROWS}-row CSV under the session's directory, parse and validate it, register its asset, write its descriptor in one commit (the call's wall time)`, 'ms', 2000, '≤ 2,000 ms', trials);
      // the parser's row limit (DATASET_LIMITS.rows), recorded: a dataset no view binds
      const limit = await trial(async () => {
        const name = await agent.write(AGENT, 'limit.csv', benchCsv(200_000, 9));
        const answer = await agent.call<{ rows: number }>(AGENT, 'artifact_dataset', { artifact: id, baseRevision: 'last', id: 'limit', path: name }, { timeoutMs: 120_000 });
        if (answer.isError) throw new Error(`the limit bind was refused: ${answer.text}`);
        expect(answer.result!.rows).toBe(200_000);
        return { value: answer.wallMs, note: `host loop busy ${answer.busyMs.toFixed(1)} ms, longest stretch ${answer.loop.max.toFixed(1)} ms` };
      });
      rows.add('1b bind at the row limit', 'artifact_dataset of a 200,000-row CSV (the parser’s row limit candidate), bound to no view', 'ms', null, 'recorded', [limit]);
    });

    await test.step('2 and 3: open cold (the host restarted) three times; the 10,000-point view’s render in each; warm once', async () => {
      const cold: Trial[] = [];
      const render: Trial[] = [];
      for (let k = 0; k < TRIALS; k++) {
        await closeTab(page);
        await restartHost(page);
        let views: { caption: string; ms: number }[] = [];
        cold.push(
          await trial(async () => {
            const open = await openTimed(page, id, `__dashCold${k}`);
            views = open.views;
            return { value: open.ms, note: `${open.views.length} views drawn; slowest ${Math.max(...open.views.map((v) => v.ms)).toFixed(1)} ms` };
          }),
        );
        const scatter = views.filter((v) => v.caption === SCATTER).map((v) => v.ms);
        expect(scatter.length, 'the 10,000-point view was drawn and timed').toBeGreaterThan(0);
        render.push({ ...cold.at(-1)!, value: Math.max(...scatter), note: `the scatter's dash:view entries ${scatter.map((ms) => ms.toFixed(1)).join(', ')} ms` });
      }
      rows.add('2 open cold', `cold open: the click on the library row to all ${VIEWS} views drawn, the engine host restarted first (its copy and its parse cache cold, the tab closed)`, 'ms', 1000, '≤ 1,000 ms', cold);
      rows.add('3 render 10,000 points', `one view of ${BENCH_SCATTER_POINTS} points (the scatter): the chart view's dash:view entry, the renderer's view and its insertion into the page, from the rows in hand, during each cold open`, 'ms', 200, '≤ 200 ms', render);
      await closeTab(page);
      const warm = await trial(async () => {
        const open = await openTimed(page, id, '__dashWarm');
        return { value: open.ms };
      });
      rows.add('2b open warm', 'warm reopen: the same, the host’s copy and parse cache loaded', 'ms', null, 'recorded', [warm]);
      await page.locator(`[data-artifact-tab="${id}"]`).screenshot({ path: `${PROOF}/scale-open.png` });
    });

    await test.step('4: the agent’s replacement to every view drawn again, three times', async () => {
      const trials: Trial[] = [];
      for (let k = 0; k < TRIALS; k++) {
        trials.push(
          await trial(async () => {
            await page.evaluate(({ artifactId, count }) => {
              const frames = () => Array.from(document.querySelectorAll(`[data-artifact-tab="${artifactId}"] .ds-doc figure.dash-view .dash-figure`));
              const old = frames().map((frame) => frame.firstElementChild);
              const state: { drawn: number | null } = { drawn: null };
              (window as unknown as Win).__dashSwap = state;
              const observer = new MutationObserver(() => {
                const now = frames();
                if (now.length !== count || !now.every((frame, i) => frame.firstElementChild !== old[i] && frame.querySelector(':scope > svg, :scope > table') !== null && !frame.closest('figure')!.hasAttribute('aria-busy'))) return;
                state.drawn = Date.now();
                observer.disconnect();
              });
              observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-busy'] });
            }, { artifactId: id, count: VIEWS });
            const answer = await replace();
            await expect.poll(() => page.evaluate(() => (window as unknown as { __dashSwap: { drawn: number | null } }).__dashSwap.drawn !== null), { timeout: 60_000, message: 'every view drawn again' }).toBe(true);
            const drawn = await page.evaluate(() => (window as unknown as { __dashSwap: { drawn: number } }).__dashSwap.drawn);
            return { value: drawn - answer.endedAt, note: `from the call's start ${(drawn - answer.endedAt + answer.wallMs).toFixed(0)} ms (the bind ${answer.wallMs.toFixed(0)} ms)` };
          }),
        );
      }
      rows.add('4 replace to all views', `a replacement by the agent (artifact_dataset, new bytes) from its answer, just after its commit, to all ${VIEWS} views drawn again in the open tab (host and page on one clock)`, 'ms', 500, '≤ 500 ms', trials);
    });

    await test.step('5: the source sheet scrolls the 50,000 raw rows: event to DOM commit, three times; the long tasks and the frame cadence beside it', async () => {
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
      rows.add('5b sheet reads every raw row', `the sheet's bounded pages of the ${BENCH_ROWS}-row snapshot read and shown (the click to its row count)`, 'ms', null, 'recorded', [readAll]);
      const table = sheet.getByRole('table', { name: 'Rows' });
      const box = (await table.boundingBox())!;
      const trials: Trial[] = [];
      const longest: number[] = [];
      for (let k = 0; k < TRIALS; k++) {
        trials.push(
          await trial(async () => {
            await table.evaluate((scroller) => {
              scroller.scrollTop = 0;
              const rows = scroller.querySelector('.dash-sheet-rows')!;
              const record = { scrolls: [] as number[], commits: [] as number[], frames: [] as number[], longTasks: [] as number[], done: false };
              (window as unknown as Win).__dashScroll = record;
              performance.clearMarks('dash:scroll');
              performance.clearMarks('dash:commit');
              scroller.addEventListener('scroll', (event) => void performance.mark('dash:scroll', { startTime: event.timeStamp }), { passive: true });
              new MutationObserver(() => void performance.mark('dash:commit')).observe(rows, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'aria-rowindex'] });
              new PerformanceObserver((list) => list.getEntries().forEach((entry) => record.longTasks.push(entry.duration))).observe({ type: 'longtask' });
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
              const record = (window as unknown as { __dashScroll: { frames: number[]; longTasks: number[]; done: boolean } }).__dashScroll;
              record.done = true;
              const scrolls = performance.getEntriesByName('dash:scroll').map((m) => m.startTime);
              const commits = performance.getEntriesByName('dash:commit').map((m) => m.startTime);
              performance.clearMarks('dash:scroll');
              performance.clearMarks('dash:commit');
              return { scrolls, commits, frames: record.frames, longTasks: record.longTasks };
            });
            // each scroll event's time to the first rows commit after it (an event whose commit came later, past the
            // next event, is charged the whole wait); an event no commit followed is counted apart
            const work: number[] = [];
            let uncommitted = 0;
            for (const at of seen.scrolls) {
              const commit = seen.commits.find((c) => c >= at);
              if (commit === undefined) uncommitted += 1;
              else work.push(commit - at);
            }
            const intervals = seen.frames.slice(1).map((at, i) => at - seen.frames[i]!);
            const overLong = seen.longTasks.filter((ms) => ms > 50);
            longest.push(Math.max(0, ...seen.longTasks));
            return {
              value: pct(work, 0.95),
              note: `${seen.scrolls.length} scroll events, ${work.length} committed (${uncommitted} without a commit after them); work p50 ${pct(work, 0.5).toFixed(2)}, max ${Math.max(...work).toFixed(2)} ms; rAF interval p50 ${pct(intervals, 0.5).toFixed(2)} (cadence ${(1000 / pct(intervals, 0.5)).toFixed(1)} Hz), p95 ${pct(intervals, 0.95).toFixed(2)}, max ${Math.max(...intervals).toFixed(2)} ms; long tasks ${seen.longTasks.length} (over 50 ms: ${overLong.map((ms) => ms.toFixed(1)).join(', ') || 'none'})`,
            };
          }),
        );
      }
      const failedBy = longest.some((ms) => ms > 50) ? `a long task over 50 ms during a scroll (longest per trial ${longest.map((ms) => ms.toFixed(1)).join(', ')} ms)` : undefined;
      rows.add('5 source scroll', `the source sheet scrolling ${BENCH_ROWS} raw rows (150 wheel steps of 120 px, then 20 jumps across the snapshot): per scroll event, the main thread's time from the event to the virtual rows' DOM commit, p95 (Performance marks)`, 'ms', 16, 'p95 ≤ 16 ms; any long task over 50 ms fails it', trials, 'the frame cadence is information, never the bound', failedBy);
      await page.screenshot({ path: `${PROOF}/scale-sheet.png` });
      await page.keyboard.press('Escape');
    });

    await test.step('6: the renderer’s working set with the dashboard open, after a forced collection', async () => {
      const memory = await trial(async () => {
        const before = await processMemory(launch.app);
        await collectGarbage(page);
        await sleep(500);
        const after = await processMemory(launch.app);
        const heap = await jsHeapMB(page);
        rows.write({ memory: { before, after, jsHeapMB: heap } });
        const main = after.renderers[0]!;
        return { value: main.workingSetMB, note: `window ${main.windowId}; ${before.renderers[0]?.workingSetMB ?? '?'} MB before the collection; JS heap ${heap} MB` };
      });
      rows.add('6 renderer', `the renderer's working set with the ${VIEWS}-view dashboard open after the scrolls and replacements, read after a forced collection`, 'MB', 500, '≤ 500 MB', [memory]);
    });

    await agent.release(AGENT);
    const failed = rows.rows.filter((r) => r.verdict === 'failed');
    const blocked = rows.rows.filter((r) => r.verdict === 'hardware-blocked');
    rows.write({ settleSpentMs: settleSpent, end: { load: load1() }, failed: failed.map((r) => r.row), hardwareBlocked: blocked.map((r) => r.row) });
    expect(failed.map((r) => `${r.row}: ${r.value} ${r.unit} against ${r.limit}${r.note ? ` (${r.note})` : ''}`), `bounds failed (every figure is in ${RESULTS})`).toEqual([]);
    expect(blocked.map((r) => `${r.row}: loads ${r.trials.map((t) => t.load).join(', ')}`), `hardware-blocked: a trial ran at a 1-minute load of ${LOAD_BELOW} or more (never a bound met; ${RESULTS})`).toEqual([]);
    expect(launch.consoleErrors(), 'the console stays free of errors').toEqual([]);
  } finally {
    await app?.close();
  }
});
