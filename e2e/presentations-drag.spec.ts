// The drag on S7b's 100-slide deck while an agent republishes through the host (P4-B2 M0;
// docs/doperpowers/plans/2026-10-21-p4-b2-slides-boards.md D17; the tracker's rows 212 and 231; P3's Decision Log 108).
// The class-1 drag case, moved here from e2e/presentations.spec.ts so its measured group selects it by file: the product
// build with S6's bench deck seeded through the renderer's presentations seam, the app launched under
// MAWS_PRESENTATIONS_SCALE=1 so the engine host serves the deck's scale seam, and an agent session
// (e2e/support/deck-agent.ts) republishing one slide every 0.7 s through A's real `artifact_publish`, its first font size
// stepped, while the cover's pinned picture is dragged over 200 pointer moves: the scale gate's row 2 workload
// (e2e/presentations-scale.spec.ts). The renderer seam's drag probe splits each move into queue, handler and paint, and
// counts the agent's updates as the tab's replica applies them (src/renderer/src/tools/presentation/drag-stats.ts).
// P4-B2 M6 (D17's gesture hold): the drag holds the tab's remote frames, so the agent's publishes wait in the replica's
// buffer and apply merged at the drop, or when the hold's 5 s cap clears it first; the probe records the frames held at
// the drop, each cap and the frames the hold released at either. An agent trial whose hold released none of the agent's
// frames is a problem (the cap is counted over an empty buffer too, so a cap alone proves nothing held), and so is a
// control trial whose hold released any.
// One case, two runs:
// - class 1 (`pnpm e2e:presentations`, MAWS_PRESENTATIONS_PERF unset): one drag with the agent, its fidelity regression
//   (each publish answered by the host with a rising revision, the tab's replica integrating the last publish's row
//   as a remote apply, the deck reading back the agent's last font size after the drop); its move-to-frame p95 and the
//   16 ms target logged as evidence, with no bound (the architect's ruling at P4-B2 M0's merge: a class-1 group runs
//   beside other jobs, and every measured bound is the load rule's, asserted in the measured group alone).
// - measured (`pnpm e2e:presentations-drag`, MAWS_PRESENTATIONS_PERF=1, a MEASURED_E2E group): after the measured specs'
//   quiet admission (support/quiet.ts), four no-agent control trials alternating with four agent trials, the drag's
//   direction turning with each pair so both kinds drag both ways; the agent trials judged on their best (the parent's
//   Decision Log 54) against the 24 ms bound, the control trials recorded with no bound, and the 16 ms target read on
//   both. A control trial must see no remote apply; every agent trial must pass the fidelity regression.
// Both write `test-results/presentations-drag.json` (every trial's whole split, its publishes and its 1-minute load,
// rewritten after each trial) and print the record between PRESENTATIONS_DRAG_RESULT_BEGIN and _END in the log.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { benchDeckFiles } from '../src/artifacts/slides/fixtures/bench';
import type { DragStats } from '../src/renderer/src/tools/presentation/drag-stats';
import { DeckAgent, fidelityProblems, republishing, type DeckCall, type PublishResult } from './support/deck-agent';
import { load1, PerfSeam, verdictOf, type Verdict } from './support/document-scale';
import { launchMaws, REPO_ROOT, type MawsLaunch } from './support/launch';
import { quietWait, type QuietAdmission } from './support/quiet';

const MEASURED = process.env.MAWS_PRESENTATIONS_PERF === '1';
const RESULTS = join(REPO_ROOT, 'test-results', 'presentations-drag.json');
const BOUND_MS = 24; // P3's Decision Log 108: the host-faithful drag's p95
const TARGET_MS = 16; // D17: a target recorded beside the bound, not a bound
const MOVES = 200;
const MOVE_EVERY_MS = 16;
const PUBLISH_EVERY_MS = 700;
const PAIRS = 4; // the measured run's control and agent trials, alternating
/** The pointer's step `i` of a drag out and back: out for the first half of the moves, back over the second. */
const outAndBack = (i: number) => (i <= MOVES / 2 ? i : MOVES - i);
const TITLE = 'Bench drag';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : +((s[mid - 1]! + s[mid]!) / 2).toFixed(2);
};

type Result<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } };
async function ok<T>(page: Page, name: string, input?: unknown): Promise<T> {
  const result = (await page.evaluate(([n, i]) => (window as unknown as { maws: { invoke(name: string, input: unknown): Promise<unknown> } }).maws.invoke(n as string, i), [name, input] as const)) as Result<T>;
  if (!result.ok) throw new Error(`${name} failed: ${result.error.code} ${result.error.message}`);
  return result.value;
}

interface Seam {
  __maws_presentations: {
    seed(artifactId: string, files: Record<string, string>): Promise<{ changed: string[]; held: string[] }>;
    files(artifactId: string): Promise<Record<string, string>>;
    dragProbe: { start(artifactId: string): void; stop(): DragStats };
    frames(artifactId: string): { surface: string; received: number; held: number; capped: number; released: number; integrated: number }[];
  };
}

let launch: MawsLaunch | null = null;
test.afterEach(async () => {
  await launch?.cleanup();
  launch = null;
});

/** The app under MAWS_PRESENTATIONS_SCALE=1, its renderer seam installed and the host's deck scale seam started. */
async function ready(): Promise<{ page: Page; seam: PerfSeam }> {
  launch = await launchMaws({ env: { MAWS_PRESENTATIONS_SCALE: '1' } });
  await launch.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1600, 1000));
  const { page } = launch;
  await expect.poll(async () => (await ok<{ state: string }>(page, 'engine.hostState')).state, { timeout: 20_000, message: 'the engine host is ready' }).toBe('ready');
  await expect.poll(() => page.evaluate(() => typeof (window as unknown as Partial<Seam>).__maws_presentations), { message: 'the seam is installed' }).toBe('object');
  const seam = new PerfSeam(join(launch.userData, 'presentations-scale'));
  await expect.poll(() => existsSync(join(seam.dir, 'in')), { timeout: 10_000, message: 'the host started the deck scale seam' }).toBe(true);
  return { page, seam };
}

async function createDeck(page: Page, title: string, files: Record<string, string>): Promise<string> {
  const { artifact } = await ok<{ artifact: { id: string } }>(page, 'artifacts.create', { kind: 'presentation', title });
  const seeded = await page.evaluate(([a, f]) => (window as unknown as Seam).__maws_presentations.seed(a, f), [artifact.id, files] as const);
  expect(seeded.held).toEqual([]);
  return artifact.id;
}

// The deck opened from the library: its editor in an `artifact` main tab, every thumbnail drawn.
async function openFromLibrary(page: Page, title: string, artifactId: string): Promise<Locator> {
  await page.locator('[data-region="sidebar"]').getByRole('button', { name: 'Artifacts', exact: true }).click();
  await page.locator('[data-library]').getByRole('article', { name: title, exact: true }).click();
  const tab = page.locator(`[data-region="main"] [data-artifact-tab="${artifactId}"]`);
  await expect(tab.locator('[data-deck-editor]')).toBeVisible({ timeout: 15_000 });
  await expect(tab.locator('[data-slide-thumb] .maws-slide')).toHaveCount(100, { timeout: 30_000 });
  return tab;
}

type Kind = 'control' | 'agent';
interface Trial {
  kind: Kind;
  order: number;
  direction: -1 | 1;
  load: number; // the higher of the 1-minute loads at the trial's start and end
  drag: DragStats;
  publishes: { revision: number; busyMs: number; wallMs: number }[];
  problems: string[];
}

/** One drag of the cover's pinned picture, with the agent republishing (`agent`) or with no agent at all (`control`). */
async function dragOnce(page: Page, tab: Locator, id: string, agent: DeckAgent, kind: Kind, order: number, direction: -1 | 1): Promise<Trial> {
  const box = (await tab.locator('[data-stage-slide] img[data-eid]').first().boundingBox())!;
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const load = load1();
  const revisionBefore = agent.revision;
  await page.evaluate((a) => (window as unknown as Seam).__maws_presentations.dragProbe.start(a), id);
  let release!: () => void;
  const dragged = new Promise<void>((resolve) => (release = resolve));
  const publishes = kind === 'agent' ? republishing(agent, dragged, PUBLISH_EVERY_MS) : Promise.resolve<DeckCall<PublishResult>[]>([]);
  publishes.catch(() => {}); // settled in the finally below
  let publishing: PromiseSettledResult<DeckCall<PublishResult>[]>;
  try {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    // out and back (the first half in `direction`): every trial starts where the picture was drawn at first, since a
    // drift of 160 px a trial took it off the slide drawn at the default chrome (about 256 px wide) after two trials,
    // and every later press missed it (run 39675318425: trials 3 to 8 wrote nothing)
    for (let i = 1; i <= MOVES; i++) {
      await page.mouse.move(from.x + direction * outAndBack(i) * 0.8, from.y + (i % 40));
      await page.waitForTimeout(MOVE_EVERY_MS);
    }
    await page.mouse.up();
  } finally {
    // the agent's workload ends with the drag, whether the drag finished or threw (its error wins)
    release();
    [publishing] = await Promise.allSettled([publishes]);
  }
  if (publishing.status === 'rejected') throw publishing.reason;
  const published = publishing.value;
  // the last publish reaches the tab after the host answered it (those the hold kept, at the drop): wait, at most 10 s,
  // for the tab's replica to integrate its row (the fidelity regression says whether it did)
  const last = Math.max(revisionBefore, ...published.map((p) => p.result!.revision));
  const integrated = async () => (await page.evaluate((a) => (window as unknown as Seam).__maws_presentations.frames(a), id))[0]?.integrated ?? 0;
  for (const deadline = Date.now() + 10_000; published.length > 0 && Date.now() < deadline && (await integrated()) < last; ) await sleep(50);
  const drag = await page.evaluate(() => (window as unknown as Seam).__maws_presentations.dragProbe.stop());
  const remote = drag.remote.duringMoves + drag.remote.afterDrop;
  const problems: string[] = [];
  if (drag.withTransaction <= 100) problems.push(`only ${drag.withTransaction} of ${drag.moves} moves wrote`); // a move held by a snap writes nothing
  if (kind === 'control' && remote > 0) problems.push(`the control trial’s replica applied ${remote} remote updates`);
  if (kind === 'control' && drag.hold.released > 0) problems.push(`the control trial’s gesture hold released ${drag.hold.released} frames`);
  if (kind === 'agent') {
    if (published.length <= 2) problems.push(`the agent republished ${published.length} slides during the drag, not more than 2`);
    // M6: a publish lands while the pointer moves, so the hold buffers it and releases it at the drop or its cap (the
    // cap fires over an empty buffer too: only a frame released shows one held)
    if (drag.hold.released === 0) problems.push('the gesture hold held and released none of the agent’s frames');
    const readBack = await page.evaluate((a) => (window as unknown as Seam).__maws_presentations.files(a), id);
    problems.push(...fidelityProblems({ revisionBefore, published, remoteApplies: remote, integrated: await integrated(), agentFiles: agent.files, readBack }));
  }
  return { kind, order, direction, load: Math.max(load, load1()), drag, publishes: published.map((p) => ({ revision: p.result!.revision, busyMs: +p.busyMs.toFixed(1), wallMs: +p.wallMs.toFixed(1) })), problems };
}

function trialLine({ kind, order, direction, load, drag: d, publishes, problems }: Trial): string {
  return [
    `[deck drag] ${kind} trial ${order + 1} (${direction < 0 ? 'leftward' : 'rightward'}, load ${load}): move → frame p95 ${d.inputToFrameMs.p95} ms (the ${TARGET_MS} ms target ${d.inputToFrameMs.p95 <= TARGET_MS ? 'met' : 'not met'}), p50 ${d.inputToFrameMs.p50}, max ${d.inputToFrameMs.max}`,
    `queue p95 ${d.queueMs.p95}, handler p95 ${d.handlerMs.p95}, paint p95 ${d.paintMs.p95} ms (move → transaction p95 ${d.inputToTxMs.p95})`,
    `${d.touched} moves touched by a remote apply, the untouched moves' move → frame p95 ${d.untouchedToFrameMs.p95} ms`,
    `remote applies ${d.remote.duringMoves} during the moves and ${d.remote.afterDrop} after the drop (apply p95 ${d.remote.applyMs.p95} ms)`,
    `the hold had ${d.hold.heldAtDrop} frames at the drop and released ${d.hold.released} in all, ${d.hold.capsMs.length > 0 ? `its 5 s cap cleared it at ${d.hold.capsMs.join(', ')} ms` : 'its 5 s cap never reached'}`,
    `${d.withTransaction}/${d.moves} moves wrote over ${d.durationMs} ms; ${d.longTasks} long tasks; ${publishes.length} publishes${problems.length > 0 ? `; problems: ${problems.join('; ')}` : ''}`,
  ].join('; ');
}

/** Each kind's trials summed up (the medians are over the trials' own p95s), the bound's verdict and the target's reading. */
function summarize(trials: Trial[]) {
  const of = (kind: Kind) => {
    const mine = trials.filter((t) => t.kind === kind);
    if (mine.length === 0) return null;
    const p95s = (pick: (d: DragStats) => number) => mine.map((t) => pick(t.drag));
    const toFrame = p95s((d) => d.inputToFrameMs.p95);
    return {
      trials: mine.length,
      load: Math.max(...mine.map((t) => t.load)),
      toFrameP95: toFrame,
      best: Math.min(...toFrame),
      median: median(toFrame),
      medianP95: { toTx: median(p95s((d) => d.inputToTxMs.p95)), queue: median(p95s((d) => d.queueMs.p95)), handler: median(p95s((d) => d.handlerMs.p95)), paint: median(p95s((d) => d.paintMs.p95)), untouchedToFrame: median(p95s((d) => d.untouchedToFrameMs.p95)) },
      touched: mine.reduce((n, t) => n + t.drag.touched, 0),
      remote: { duringMoves: mine.reduce((n, t) => n + t.drag.remote.duringMoves, 0), afterDrop: mine.reduce((n, t) => n + t.drag.remote.afterDrop, 0) },
      hold: { heldAtDrop: mine.reduce((n, t) => n + t.drag.hold.heldAtDrop, 0), capped: mine.filter((t) => t.drag.hold.capsMs.length > 0).length /* M6: trials the cap cleared */, released: mine.reduce((n, t) => n + t.drag.hold.released, 0) },
      publishes: mine.reduce((n, t) => n + t.publishes.length, 0),
    };
  };
  const control = of('control');
  const agent = of('agent')!;
  const verdict: Verdict = verdictOf(agent.best, BOUND_MS, agent.load);
  return {
    control,
    agent,
    bound: { ms: BOUND_MS, on: 'the agent trials’ best move → frame p95 (the parent’s Decision Log 54)', value: agent.best, load: agent.load, verdict },
    target: { ms: TARGET_MS, agent: { best: agent.best, met: agent.best <= TARGET_MS }, control: control && { best: control.best, met: control.best <= TARGET_MS } },
  };
}

test('the drag on the 100-slide deck while an agent republishes through the host: the publishes faithful, and (measured, beside no-agent control trials) move to frame p95 within 24 ms', async () => {
  test.setTimeout(MEASURED ? 600_000 : 180_000);
  const loads: Record<string, number> = { start: load1() };
  const { page, seam } = await ready();
  const id = await createDeck(page, TITLE, benchDeckFiles(100));
  const tab = await openFromLibrary(page, TITLE, id);
  const agent = new DeckAgent(seam, id);
  await agent.read();
  expect(agent.slidePaths()).toHaveLength(100);
  await agent.publish([agent.slidePaths()[1]!]); // as row 2's publishes precede its drag: the session's base becomes its own publish
  const record = {
    run: new Date().toISOString(),
    mode: MEASURED ? 'measured: no-agent control trials alternating with agent trials' : 'class 1: one agent trial',
    deck: 'benchDeckFiles(100): S6’s seven bench shapes cycled, S7b’s 100-slide deck; the cover’s pinned picture dragged',
    workload: { moves: MOVES, moveEveryMs: MOVE_EVERY_MS, stepPx: 0.8, publishEveryMs: PUBLISH_EVERY_MS, publish: 'one slide (the second on, in turn), its first font size stepped, through artifact_publish in the host (e2e/support/deck-agent.ts)' },
    judging: MEASURED
      ? { boundMs: BOUND_MS, targetMs: TARGET_MS, rule: 'Decision Log 24 over the agent trials’ best (the parent’s Decision Log 54): marginal under a 20 % miss at load ≥ 10, failed otherwise; the control trials recorded, no bound' }
      : { boundMs: null, targetMs: TARGET_MS, rule: 'class 1: the p95 logged as evidence, no bound (the bound is the measured group’s)' },
    loads,
    quiet: null as QuietAdmission | null,
    trials: [] as Trial[],
  };
  const write = (extra: Record<string, unknown> = {}) => {
    mkdirSync(dirname(RESULTS), { recursive: true });
    writeFileSync(RESULTS, `${JSON.stringify({ ...record, ...extra }, null, 2)}\n`);
  };
  if (MEASURED) {
    record.quiet = await quietWait(); // the first trial's (support/quiet.ts), after the build, the launch and the seed
    console.log(`[deck drag] the first trial's admission: ${record.quiet.summary}`);
  }
  write();

  const kinds: Kind[] = MEASURED ? Array.from({ length: PAIRS }, (): Kind[] => ['control', 'agent']).flat() : ['agent'];
  for (const [order, kind] of kinds.entries()) {
    const trial = await dragOnce(page, tab, id, agent, kind, order, Math.floor(order / 2) % 2 === 0 ? -1 : 1);
    record.trials.push(trial);
    console.log(trialLine(trial));
    write();
    await sleep(1_000);
  }
  loads.end = load1();
  await agent.release();

  const summary = summarize(record.trials);
  write({ summary });
  console.log(`[deck drag] the bound: the agent trials' best move → frame p95 ${summary.bound.value} ms against ${BOUND_MS} ms at load ${summary.bound.load}: ${summary.bound.verdict}${MEASURED ? '' : ' (class 1: logged, not asserted)'}`);
  console.log(`[deck drag] the ${TARGET_MS} ms target: the agent trials' best ${summary.target.agent.best} ms (${summary.target.agent.met ? 'met' : 'not met'})${summary.target.control ? `; the no-agent control's best ${summary.target.control.best} ms (${summary.target.control.met ? 'met' : 'not met'})` : ''}`);
  console.log(`PRESENTATIONS_DRAG_RESULT_BEGIN\n${JSON.stringify({ ...record, summary })}\nPRESENTATIONS_DRAG_RESULT_END`);
  expect(record.trials.flatMap((t) => t.problems.map((problem) => `${t.kind} trial ${t.order + 1}: ${problem}`)), 'every trial faithful').toEqual([]);
  if (MEASURED) expect(summary.bound.verdict, `the drag's p95 within ${BOUND_MS} ms (Decision Log 24; the figures are in ${RESULTS})`).not.toBe('failed');
  expect(launch!.consoleErrors(), 'the console stays free of errors').toEqual([]);
});
