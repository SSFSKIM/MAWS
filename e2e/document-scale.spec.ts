// The scale gate (M9 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md, Acceptance 6; parent Decision Log 37's
// bounds; S7b's table in spikes/p3-store/findings.txt, every document row): the product build (MAWS_HARNESS=0) with
// S7b's 200-page seed (e2e/support/document-seed.ts) written over a document's first tab through the host's scale seam,
// two windows on it, and two agent sessions driven by the host's own writer through that seam (the document tools'
// real `call` as each session: a read, then batches of S7b's five-op mix quoting what the session read, from the
// revision it last saw). Measured as S7b measured them and recorded row by row in `test-results/document-scale.json`
// with the load: keystroke → frame (p95, max), → presented (Event Timing), → durable ack, painted in window B; the
// host's event loop (A's `artifacts.testLoopDelay` over the run, p99 and max) and each batch's own loop delay (the
// first batch after a read named apart); the 200-block read idle and under load; first sync at 200 and at 20 pages,
// cold (the document unloaded by the host) and warm; the history preview's enter (its extra background render
// included: the bar's change count drawn) and leave; the host's heap (loaded, and after close and unload against
// idle) and the renderers' working set; Korean composed under load into a block the agent edits; a host SIGKILL under
// load. Run on purpose only, at low load (each bound is judged at load under 20):
//   pnpm e2e:document-scale        (the script sets MAWS_DOCUMENT_PERF=1)
// Decision Log 109 calibrates three rows to the Mac mini, the designated host, and the labels name the MacBook targets
// beside them: `1 p95` ≤ 20 ms (mini 16.8 and 17.2; MacBook target 16), `7 enter` ≤ 1,200 ms per preview (mini 890.8 to
// 1,126.8; MacBook target 1,000), `8 renderer collected` ≤ 600 MB (mini 480.5 and 519.7, about 8% run variance; MacBook 412
// to 469, target 500). The MacBook targets in B's section and S7b's table are unchanged; a rise over these bounds is the
// regression signal. P4 Decision Log 33 rescales rows 1 and 2 by the mini's own drift: from 10-20 the same tree reads
// slower there (de71da97a 17.0 on 10-19, 22.4 after a reboot on 10-20; the cause survived restarts, Chrome, System
// Settings and Docker quit, and renderer accessibility is off), so `1 p95` ≤ 28 ms (clean runs on 10-20 read 20.3 to
// 26.6) and `2 p95` ≤ 58 ms (Event Timing's 8 ms grain puts it at 48 or 56).
// Each test's first measured trial waits, after its launch and setup, for the measured specs' shared quiet admission
// (support/quiet.ts: the 1-minute load under 5 on two reads 30 s apart, at most three minutes; on its expiry the trials
// run and are judged as above), recorded in its results as `quiet` (`quietHidden` for the margin's control, `quietSigkill`
// for row 11).
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { prng, seedDocument, type SeedStats } from './support/document-seed';
import { keystrokes } from './support/hangul';
import { launchMaws, REPO_ROOT, type MawsLaunch } from './support/launch';
import { quietWait } from './support/quiet';
import {
  Agent,
  armHistory,
  armOpen,
  blockText,
  caretAtEnd,
  collectGarbage,
  EDITOR_SELECTOR,
  historyResult,
  imeStep,
  instrumentTyping,
  jsHeapMB,
  keystrokeMeasures,
  load1,
  openResult,
  PerfSeam,
  processMemory,
  readAll,
  readFirst,
  readRest,
  remoteSeen,
  replicaState,
  Rows,
  startMeasuring,
  stats,
  typingReport,
  watchRemote,
  type CallAnswer,
  type CallBackground, // P4-R6
  type ReadResult,
  type TypingReport,
} from './support/document-scale';

test.skip(process.env.MAWS_DOCUMENT_PERF !== '1', 'the scale gate runs only under MAWS_DOCUMENT_PERF=1');
test.describe.configure({ timeout: 900_000 });

const RESULTS = join(REPO_ROOT, 'test-results', 'document-scale.json');
const UNLOAD_WAIT_MS = 66_000; // the host's idle unload (A's IDLE_UNLOAD_MS, 60 s) and a margin
const TYPING_SECTION = 80; // S7b's caret: s80p2
const IME_SECTION = 40;
const KEPT_CLEAR = (s: number) => Math.abs(s - TYPING_SECTION) <= 2 || Math.abs(s - IME_SECTION) <= 2; // no agent edits here but the IME case's own
const SECTIONS = 160;

type Result<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } };
async function ok<T>(page: Page, name: string, input?: unknown): Promise<T> {
  const result = (await page.evaluate(([n, i]) => (window as unknown as { maws: { invoke(name: string, input: unknown): Promise<unknown> } }).maws.invoke(n as string, i), [name, input] as const)) as Result<T>;
  if (!result.ok) throw new Error(`${name} failed: ${result.error.code} ${result.error.message}`);
  return result.value;
}
const hostState = (page: Page) => ok<{ state: string; pid: number | null }>(page, 'engine.hostState');
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const MB = (bytes: number) => +(bytes / 1024 / 1024).toFixed(1);

let launch: MawsLaunch | null = null;
let userData: string | null = null;
test.afterEach(async () => {
  await launch?.cleanup();
  launch = null;
  if (userData) rmSync(userData, { recursive: true, force: true });
  userData = null;
});

// The seeds, built once: 160 sections (≈ 200 pages) and 16 (≈ 20 pages).
let seeds: { large: { state: Uint8Array; stats: SeedStats }; small: { state: Uint8Array; stats: SeedStats } } | null = null;
const seedsOnce = () => (seeds ??= { large: seedDocument(SECTIONS), small: seedDocument(16) });

async function start(): Promise<{ page: Page; app: ElectronApplication; seam: PerfSeam }> {
  userData = mkdtempSync('/tmp/maws-e2e-document-scale-');
  launch = await launchMaws({ userData, env: { MAWS_HARNESS: '0', MAWS_DOCUMENT_PERF: '1' } });
  const { page, app } = launch;
  await expect.poll(async () => (await hostState(page)).state, { timeout: 30_000, message: 'the engine host is ready' }).toBe('ready');
  const seam = new PerfSeam(join(userData, 'document-perf'));
  await expect.poll(() => existsSync(join(seam.dir, 'in')), { timeout: 10_000, message: 'the host started the scale seam' }).toBe(true);
  return { page, app, seam };
}

/** A document the owner creates (the host writes its first tab), then seeded over that tab through the seam. */
async function seeded(page: Page, seam: PerfSeam, title: string, state: Uint8Array): Promise<string> {
  const { artifact } = await ok<{ artifact: { id: string } }>(page, 'artifacts.create', { kind: 'document', title });
  await expect.poll(async () => (await ok<{ artifact: { revision: number } | null }>(page, 'artifacts.get', { artifactId: artifact.id })).artifact?.revision ?? 0, { message: 'the host wrote the first tab' }).toBeGreaterThan(0);
  await seam.seed(artifact.id, state);
  return artifact.id;
}

async function showLibrary(page: Page): Promise<void> {
  await page.locator('[data-region="sidebar"]').getByRole('button', { name: 'Artifacts', exact: true }).click();
  await expect(page.locator('[data-library]')).toBeVisible({ timeout: 15_000 });
}

/** Opens `title` from the library in a main tab, timed from the press to the frame after its blocks are drawn. */
async function openTimed(page: Page, id: string, title: string, minBlocks: number) {
  await showLibrary(page);
  await armOpen(page, id, minBlocks);
  await page.locator('[data-library]').getByRole('article', { name: title, exact: true }).click({ timeout: 15_000 });
  return openResult(page);
}

async function closeTab(page: Page, title: string): Promise<void> {
  await page.getByRole('button', { name: `Close ${title}`, exact: true }).click();
  await expect(page.getByRole('button', { name: `Close ${title}`, exact: true })).toHaveCount(0, { timeout: 15_000 });
}

/** The agents' sections: each its own, none near the typing or the composing block. */
function agentsFor(): [Agent, Agent] {
  const all = [...Array(SECTIONS).keys()].filter((s) => !KEPT_CLEAR(s));
  return [new Agent('perf-agent-1', all.filter((s) => s % 2 === 0), prng(101)), new Agent('perf-agent-2', all.filter((s) => s % 2 === 1), prng(202))];
}

type EditAnswer = CallAnswer<{ revision: number; results: Array<{ newIds?: string[] }> }>;

/** One batch of `agent`'s, through the seam, folded into the agent. */
async function batch(seam: PerfSeam, agent: Agent, id: string, extra?: { block: string; old: string; new: string }): Promise<EditAnswer> {
  const { ops, run } = agent.nextBatch(extra);
  const answer = await seam.call<{ revision: number; results: Array<{ newIds?: string[] }> }>(agent.session, 'artifact_edit', { artifact: id, baseRevision: 'last', ops });
  agent.record(run, answer);
  return answer;
}

/** Each agent sends a batch every 0.8 to 1.6 s (S7b's pace) until `until` resolves; each may read once at `readAt` ms. */
async function agentsRun(seam: PerfSeam, agents: Agent[], id: string, until: Promise<unknown>, readAt: number | null, reads: Array<{ session: string; answer: CallAnswer<ReadResult> }>): Promise<void> {
  let done = false;
  void until.finally(() => (done = true));
  const started = Date.now();
  await Promise.all(
    agents.map(async (agent, k) => {
      let readDone = readAt === null;
      await sleep(400 * k);
      while (!done) {
        await sleep(800 + Math.random() * 800);
        if (done) break;
        if (!readDone && Date.now() - started > readAt! + 1_500 * k) {
          readDone = true;
          const answer = await seam.call<ReadResult>(agent.session, 'artifact_read', { artifact: id });
          agent.learn(answer.result!);
          reads.push({ session: agent.session, answer });
          continue;
        }
        await batch(seam, agent, id);
      }
    }),
  );
}

/** Types `count` characters at the caret, a keystroke every 60 to 180 ms (S7b's pace). */
async function type(page: Page, text: string, count: number, gap = () => 60 + Math.random() * 120): Promise<string> {
  let typed = '';
  for (let k = 0; k < count; k++) {
    const ch = text[k % text.length]!;
    await page.keyboard.type(ch);
    typed += ch;
    await sleep(gap());
  }
  return typed;
}

const TYPED = 'the owner keeps typing while agents edit elsewhere ';

// ---- rows 3 and 4 over every keystroke (P3-F, editor-proof scalpel-1#1) -------------------------------------------------
// After the typing, the acknowledgements and window B's frames are drained: until every keystroke has both, no later
// than 10 s, and no sooner than the fixed 1.5 s the run waited before, so the host-loop figures read over the run (rows
// 5) keep the window their readings were taken over. Rows 3 and 4 then count every keystroke: one still without its ack
// or its frame in B when the drain stopped is a miss, counted at the time it had waited by then (10 s or more, far past
// either bound) and named in the row's note, never dropped. Acks arrive in send order, so dropping the unacknowledged
// keys dropped the slowest ones.
const DRAIN_FLOOR_MS = 1_500;
const DRAIN_MS = 10_000;
type Seen = Array<{ clock: number; at: number; raf?: number }>;

/** Each typed keystroke's ack and frame in B, timed as keystrokeMeasures and paintedInB (support/document-scale.ts) time them; `end` is A's clock when the drain stopped. */
function everyKeystroke(report: Pick<TypingReport, 'origin' | 'keys' | 'acks'>, seen: Seen, end: number) {
  const typed = report.keys.filter((k) => !('ime' in k && (k as { ime?: boolean }).ime));
  const acks = typed.map((k) => (k.local === undefined ? undefined : report.acks[k.local - 1]));
  const frames = typed.map((k) => (k.clock === undefined ? undefined : seen.find((s) => s.clock >= k.clock! && s.raf !== undefined)?.raf));
  return {
    keystrokes: typed.length,
    acked: acks.filter((t) => t !== undefined).length,
    painted: frames.filter((t) => t !== undefined).length,
    ack: stats(typed.map((k, i) => (acks[i] ?? end) - k.tIn)),
    inB: stats(typed.map((k, i) => (frames[i] ?? report.origin + end) - (report.origin + k.tIn))),
  };
}

/** Waits for every typed keystroke's ack in A and frame in B, within DRAIN_FLOOR_MS and DRAIN_MS; answers A's clock when it stopped and how long it took. */
async function drain(page: Page, pageB: Page): Promise<{ end: number; waitedMs: number }> {
  const started = Date.now();
  for (;;) {
    const [a, seen] = await Promise.all([
      page.evaluate(() => {
        const S = (window as unknown as { __scale: Pick<TypingReport, 'keys' | 'acks'> }).__scale;
        return { origin: performance.timeOrigin, keys: S.keys, acks: S.acks, now: performance.now() };
      }),
      remoteSeen(pageB),
    ]);
    const counted = everyKeystroke(a, seen, a.now);
    const waitedMs = Date.now() - started;
    const whole = counted.acked === counted.keystrokes && counted.painted === counted.keystrokes;
    if ((whole && waitedMs >= DRAIN_FLOOR_MS) || waitedMs >= DRAIN_MS) return { end: a.now, waitedMs };
    await sleep(100);
  }
}
const missed = (n: number, of: number, what: string) => (n < of ? `; ${of - n} ${what} when the drain stopped, each a miss at the time it had waited` : '');

// P4-B1 (the P4 spec §5 B1's "the keystroke p95 on the 200-page two-agent workload with the margin open within the
// re-based bound (P3 Decision Log 108, 109) measured on the mini"; docs/doperpowers/plans/2026-10-20-p4-b1-margin-comments.md
// D13): step 1 again with the margin open. The window at 1920 × 1080 so the main tab reaches the cards tier: the app's
// default layout keeps the sidebar (300) and the panel (380) open, the page is 816 and LC-1's least card with its gutters
// needs 333 beside it, 1,829 in all; 1920 leaves 424 beside the page, a 357 px card (1600 and 1800 drew icons on the mini:
// runs 39382175044 and 39383570754); the seed's
// threads (one in every third section, about 53 open) are cards in the margin, one near the typing section activated;
// then the owner's 300 keystrokes with the two agents batching, and, through the seam's `stream` (P4-A2's provisional
// emitter, X35), a layer growing in a block of a section two away from the typing one for the typing's whole span, so
// the margin's re-layout on the layer's growth is in the measurement (`streamWhile`: started with the typing, stopped
// when it ends, its answer recorded in the row's note). Without `stream` (A2 not on this tree) the row is recorded
// without the layer and says so; the acceptance's tree carries A2 (the child's Decision Log 6). Rows:
// `1m p95` ≤ the control's `1h p95` in the same job + 6 ms (P4-B1's follow-up, below; it was ≤ 20 ms, the mini's
// calibration of row 1 before the margin existed), `1m max` ≤ 50 ms, `1m relayouts` (the margin's layout passes per frame
// callback the page ran, `data-relayouts` over the page's `data-frames`: the agents' edits and the layer's growth run
// frames of their own, so a ratio per keystroke would count them against the owner; the scripted scroll afterwards adds
// none, R4). P4-B1's follow-up wave (docs/doperpowers/plans/2026-10-20-p4-b1-margin-comments.md, "Follow-up"): an edit
// owes the margin a pass, run once the edits pause or at the 1 s ceiling (margin-settle.ts), so under the step's
// constant writes the row reads about one pass a second against every frame the edits ran, where B1 read one pass a
// frame; and `1m stale`, the longest any change waited for the pass that read it (the margin's `data-stale-max`, cleared
// before the step), the ceiling and the main thread's queue. The follow-up wave also adds the control, run first: the
// same workload (1920 × 1080, the two agents, the streaming layer) with the margin hidden (View › Hide, no thread
// activated), rows `1h p95`, `1h max` and `1h ack p95`, recorded, so the margin's own cost is `1m` minus `1h` in one job
// and `1m p95` is bounded by it (MARGIN_OVER_CONTROL_MS); `1m` against the base
// gate's row 1 also carries the window (row 1 runs at the default 1280 × 820) and the layer (row 1 has none), which the
// wave's diagnostic placed at about 2 and 2.5 to 3 ms of p95 on the mini (the execution document's follow-up section).
// Results in test-results/document-scale-margin.json.
const MARGIN_RESULTS = join(REPO_ROOT, 'test-results', 'document-scale-margin.json');
// P4-B1's follow-up: the pass falls due at MARGIN_SETTLE_MAX_MS (src/artifacts/document/editor/comments/margin-settle.ts,
// 1,000 ms) and starts once the main thread reaches its task; the limit is the ceiling and that queue under the step's
// load, set from the mini's reading (1,063 ms at 2a6170eb8, run 39393866900)
const STALE_LIMIT_MS = 1_200;
// P4-B1's follow-up: about one pass a second over the step's frame callbacks; set from the mini's reading (0.074: 40
// passes over 540 frame callbacks in 41.6 s, run 39393866900), with room for fewer frames under load
const RELAYOUTS_PER_FRAME = 0.1;
// P4-B1's follow-up (P4 Decision Logs 36 and 38: `1m p95`'s bound is the follow-up wave's): the margin open may cost at
// most this much p95 over the control (the same workload, the margin hidden) run just before it in the same job, in
// place of the absolute 20 ms calibrated before the margin existed. The over-control readings so far are +0.6 and +2.9
// (run 39398316541) and identical back-to-back runs of this workload spread 2.3 ms (25.5 and 27.8), so the margin is
// 6 ms: the higher reading clears it by 3.1, more than that spread, and a margin as it stands (about +1.75 on average)
// goes red by chance about one job in thirty. It still catches the margin's own cost rising by about 4 ms at p95 (one
// job in two) and by about 6.5 ms (five jobs in six); a smaller regression is for an A/B to read, B minus A
const MARGIN_OVER_CONTROL_MS = 6;
const STREAM_SECTION = TYPING_SECTION + 2; // kept clear of the agents, two sections under the caret: on screen with it
const STREAM_TICK_MS = 120; // P4-B1: the layer's pace, a piece every 120 ms and the seam's round trip (the typing is about 36 s)
const STREAM_ID = 'toolu_perf_stream_margin';

// P4-B1: the streaming layer, a long replace_block into `block` fed piece by piece while `running()` holds, then left for
// the caller to drop (never committed: the document is unchanged). The seam runs its commands one at a time in name
// order (A2's `serveCommandFiles`), so a single `stream` of every piece would hold the agents' calls behind it for its
// whole span: each piece is a `stream` command of its own, paced from here, and the agents' calls run between them.
// Answers the pieces fed and the streaming frames the call sent, or why the seam refused (A2 not on the tree).
type Streamed = { on: true; pieces: number; frames: number; spanned: boolean; why?: string } | { on: false; why: string };
async function streamWhile(seam: PerfSeam, id: string, block: string, running: () => boolean): Promise<Streamed> {
  const words = 'the agent keeps writing a long replacement for this block while the owner types elsewhere, and every piece grows the layer on the page '.repeat(20).trim();
  const prefix = JSON.stringify({ artifact: id, baseRevision: 1, ops: [{ op: 'replace_block', id: block, markdown: '' }] }).replace('"markdown":""}]}', '"markdown":"');
  const deltas = [prefix, ...words.split(' ').map((word) => `${word} `)];
  let pieces = 0;
  let frames = 0;
  for (const piece of deltas) {
    if (pieces > 0 && !running()) break;
    try {
      const answer = await seam.send<{ ok: boolean; frames?: number }>({ cmd: 'stream', session: 'perf-stream', toolUseId: STREAM_ID, name: 'artifact_edit', deltas: [piece], tickMs: 0 });
      frames = answer.frames ?? frames; // the call's frames so far
    } catch (error) {
      const why = error instanceof Error ? error.message : String(error);
      return pieces === 0 ? { on: false, why } : { on: true, pieces, frames, spanned: !running(), why };
    }
    pieces += 1;
    await sleep(STREAM_TICK_MS);
  }
  return { on: true, pieces, frames, spanned: !running() };
}

// P4-B1's follow-up: the control first, the same workload with the margin hidden (rows `1h`, recorded), then the margin
// open, whose `1m p95` is bounded by the control's p95 in this job plus MARGIN_OVER_CONTROL_MS
test('the typing workload with the margin hidden (the control for 1m): keystroke → frame p95, the same window, agents and layer', () => marginWorkload(true));
test('the typing workload with the margin open: keystroke → frame p95 with about 53 cards beside the page and a streaming layer', () => marginWorkload(false));

/** P4-B1's follow-up: the control's `1h p95` as this job's results file holds it, or null when the control has not run. */
function controlP95(): number | null {
  if (!existsSync(MARGIN_RESULTS)) return null;
  const results = JSON.parse(readFileSync(MARGIN_RESULTS, 'utf8')) as { rows?: Array<{ row: string; value: number }> };
  const row = results.rows?.find((r) => r.row === '1h p95');
  return row && Number.isFinite(row.value) ? row.value : null;
}

async function marginWorkload(hidden: boolean): Promise<void> {
  if (hidden) rmSync(MARGIN_RESULTS, { force: true });
  const R = hidden ? '1h' : '1m'; // P4-B1's follow-up: the rows' prefix
  const { large } = seedsOnce();
  const { page, app, seam } = await start();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((win) => !win.isDestroyed())!.setContentSize(1920, 1080));
  await page.waitForFunction(() => window.innerWidth === 1920);
  const rows = new Rows(MARGIN_RESULTS, hidden ? { hiddenRun: new Date().toISOString() } : { run: new Date().toISOString(), seed: { large: large.stats }, margin: true });
  const loads: Record<string, number> = { launched: load1() };
  const id = await seeded(page, seam, 'Scale 200 margin', large.state);
  await openTimed(page, id, 'Scale 200 margin', large.stats.topBlocks - 20);
  const main = page.locator(`[data-artifact-tab="${id}"]`);
  const margin = main.getByRole('region', { name: 'Comments' });
  await expect(margin).toHaveAttribute('data-margin-tier', 'cards', { timeout: 15_000 });
  const cards = await margin.locator('[data-margin-entry]').count();
  expect(cards, 'the seed’s threads as cards').toBeGreaterThan(40);
  const near = [...Array(SECTIONS).keys()].filter((section) => section % 3 === 0).sort((a, b) => Math.abs(a - TYPING_SECTION) - Math.abs(b - TYPING_SECTION))[0]!;
  await main.locator(`.ProseMirror[data-editor="live"] [data-thread="th${near}"]`).first().scrollIntoViewIfNeeded();
  if (hidden) {
    // the control: View › Hide (no thread activated: a click on a passage with the margin hidden opens the panel)
    const toolbar = main.getByRole('toolbar', { name: 'Formatting' });
    await toolbar.getByRole('button', { name: 'Comment view' }).click();
    await toolbar.getByRole('menuitemradio', { name: 'Hide' }).click();
    await expect(margin).toHaveCount(0);
  } else {
    // a thread near the caret activated by its passage: the margin's stack pinned around it, as a reader has it
    await main.locator(`.ProseMirror[data-editor="live"] [data-thread="th${near}"]`).first().click();
    await expect(margin.locator(`[data-margin-entry="th${near}"]`)).toHaveAttribute('data-active', '');
  }
  const marginAttr = async (name: string) => (hidden ? null : await margin.getAttribute(name)); // P4-B1's follow-up

  // window B, the agents' reads and first batches, as the gate's step 0 to 5 have them
  const [pageB] = await Promise.all([app.waitForEvent('window'), app.evaluate(() => (globalThis as unknown as { __maws_documents: { openWindow(): number } }).__maws_documents.openWindow())]);
  await pageB.waitForLoadState('domcontentloaded');
  await openTimed(pageB, id, 'Scale 200 margin', large.stats.topBlocks - 20);
  const agents = agentsFor();
  for (const agent of agents) {
    const read = await readFirst(seam, agent, id);
    const { ops, run } = agent.firstBatch();
    const answer = await seam.call<{ revision: number; results: Array<{ newIds?: string[] }> }>(agent.session, 'artifact_edit', { artifact: id, baseRevision: 'last', ops });
    agent.record(run, answer);
    expect(answer.isError, answer.text).toBe(false);
    await readRest(seam, agent, id, read.result!);
  }

  // the streaming layer in a block two sections under the caret (P4-B1: fed alongside the typing below, `streamWhile`)
  const streamBlock = `s${STREAM_SECTION}p3`;
  const layer: { streamed: Streamed | null } = { streamed: null }; // set by the typing step
  await admitted(rows, hidden ? 'quietHidden' : 'quiet');

  await test.step(`${R}: typing in A with the margin ${hidden ? 'hidden' : 'open'}, two agents writing, the layer growing`, async () => {
    const { clientID } = await instrumentTyping(page, id);
    await watchRemote(pageB, id, clientID);
    await caretAtEnd(page, id, `s${TYPING_SECTION}p2`);
    await ok(page, 'artifacts.testLoopDelay', { reset: true });
    await seam.send({ cmd: 'loop', reset: true });
    const relayoutsBefore = Number(await marginAttr('data-relayouts'));
    const framesBefore = Number(await main.locator('.ds-doc').getAttribute('data-frames')); // P4-B1: the page frame's callbacks
    if (!hidden) await margin.evaluate((el) => el.removeAttribute('data-stale-max')); // P4-B1's follow-up: the step's waits alone
    await startMeasuring(page);
    loads.steadyStart = load1();
    const reads: Array<{ session: string; answer: CallAnswer<ReadResult> }> = [];
    const typingStarted = Date.now();
    const typing = type(page, TYPED, 300);
    // P4-B1: the layer grows from the first keystroke to the last: its feed starts with the typing, not awaited, and
    // stops when the typing ends; its answer is awaited after the typing
    let typingEnded = false;
    void typing.then(
      () => (typingEnded = true),
      () => (typingEnded = true),
    );
    const streaming = streamWhile(seam, id, streamBlock, () => !typingEnded);
    const [typed] = await Promise.all([typing, agentsRun(seam, agents, id, typing, null, reads)]);
    const typingSeconds = (Date.now() - typingStarted) / 1000; // P4-B1's follow-up: the passes' rate over the typing
    const streamed = await streaming;
    layer.streamed = streamed;
    const drained = await drain(page, pageB);
    const loop = await ok<{ p50: number; p99: number; max: number }>(page, 'artifacts.testLoopDelay', {});
    loads.steadyEnd = load1();
    const report = await typingReport(page);
    const keys = keystrokeMeasures(report);
    const counted = everyKeystroke(report, await remoteSeen(pageB), drained.end);
    const relayoutsAfter = Number(await marginAttr('data-relayouts'));
    const passes = relayoutsAfter - relayoutsBefore;
    const frames = Number(await main.locator('.ds-doc').getAttribute('data-frames')) - framesBefore;
    const staleMax = await marginAttr('data-stale-max'); // P4-B1's follow-up: null when no pass settled an edit
    // R4: a scripted scroll of the page runs no layout pass
    await main.locator('.ds-doc').evaluate((el) => {
      el.scrollTop += 400;
      el.dispatchEvent(new Event('scroll'));
    });
    await page.waitForTimeout(100);
    const afterScroll = Number(await marginAttr('data-relayouts'));
    const layerNote = streamed.on
      ? `a streaming layer (${streamed.pieces} pieces, ${streamed.frames} frames, ${streamed.spanned ? 'over the whole typing' : 'its pieces ran out before the typing did'}${streamed.why ? `; stopped: ${streamed.why}` : ''})`
      : `NO streaming layer (${streamed.why}): not the acceptance's tree`;
    const note = `${keys.keystrokes} keystrokes; ${hidden ? `the margin hidden (${cards} threads)` : `${cards} cards, th${near} active`}; agents: ${agents.map((a) => `${a.session} ${a.applied.length} batches, ${a.refused.length} refused`).join('; ')}; ${layerNote}`;
    if (hidden) {
      // P4-B1's follow-up: the control's rows, against which `1m p95` reads the margin's own cost
      // (recorded, no bound of their own: the control is the margin workload's level on this Mac in this job)
      rows.add('1h p95', 'keystroke → frame in A, p95, the margin hidden (the 1m workload: 1920 × 1080, 2 windows, 2 agents, a streaming layer)', keys.frame.p95, 'ms', null, 'recorded: the control for 1m p95', note);
      rows.add('1h max', 'keystroke → frame in A, max, the margin hidden', keys.frame.max, 'ms', null, 'recorded', `p50 ${keys.frame.p50}`);
      rows.add('1h ack p95', 'keystroke → durable ack, p95, the margin hidden', counted.ack.p95, 'ms', null, 'recorded', `${counted.acked} of ${counted.keystrokes} acked`);
      rows.write({ hidden: { loads, threads: cards, layer: streamed, typing: { ...keys, ack: counted.ack }, frames, loop } });
      expect(agents.flatMap((a) => a.refused), 'every agent batch applied').toEqual([]);
      return;
    }
    // P4-B1's follow-up (P4 Decision Logs 36 and 38): the margin's own cost over the control run just before it
    const control = controlP95();
    const over = control === null ? null : +(keys.frame.p95 - control).toFixed(1);
    rows.add('1m p95', 'keystroke → frame in A, p95, the margin open (200 pages, 2 windows, 2 agents, a streaming layer), against the control 1h p95 of this job', keys.frame.p95, 'ms', control === null ? null : control + MARGIN_OVER_CONTROL_MS, control === null ? 'the control did not run: recorded' : `p95 ≤ 1h p95 (${control}) + ${MARGIN_OVER_CONTROL_MS} ms`, `${note}; 1m − 1h ${over === null ? 'not read' : `${over >= 0 ? '+' : ''}${over} ms`}`);
    rows.add('1m max', 'keystroke → frame in A, max, the margin open', keys.frame.max, 'ms', 50, 'max ≤ 50 ms', `p50 ${keys.frame.p50}`);
    // P4-B1's follow-up: the passes the edits owed, settled once they paused or at the ceiling, none in an edit's frame
    rows.add('1m relayouts', 'the margin’s layout passes per frame callback (edits owe a pass, settled when they pause or at the 1 s ceiling)', +(passes / Math.max(1, frames)).toFixed(3), 'passes', RELAYOUTS_PER_FRAME, `≤ ${RELAYOUTS_PER_FRAME} per frame (about one a second under constant writes)`, `${passes} passes over ${frames} frame callbacks (${keys.keystrokes} keys) in ${typingSeconds.toFixed(1)} s of typing, ${(passes / typingSeconds).toFixed(2)} a second; after a scripted scroll ${afterScroll - relayoutsAfter} more (R4: none)`);
    rows.add('1m stale', 'the longest a change waited for the margin’s pass that read it, the margin open', staleMax === null ? NaN : Number(staleMax), 'ms', STALE_LIMIT_MS, `≤ ${STALE_LIMIT_MS} ms (the settle’s 1 s ceiling and the main thread’s queue)`, staleMax === null ? 'no pass settled an edit in the step' : undefined);
    rows.add('1m ack p95', 'keystroke → durable ack, p95, the margin open', counted.ack.p95, 'ms', 100, 'p95 ≤ 100 ms', `${counted.acked} of ${counted.keystrokes} acked`);
    rows.add('5m p99', 'host event-loop delay over the run, p99, the margin open', loop.p99, 'ms', 50, 'p99 ≤ 50 ms');
    rows.write({ margin: { loads, cards, active: `th${near}`, layer: streamed, typing: { ...keys, ack: counted.ack }, relayouts: { passes, frames, keystrokes: keys.keystrokes, typingSeconds, staleMax: staleMax === null ? null : Number(staleMax), afterScroll: afterScroll - relayoutsAfter }, loop } });
    expect(control, 'the control (1h) ran before 1m in this job').not.toBeNull(); // P4-B1's follow-up
    expect(afterScroll - relayoutsAfter, 'a scroll runs no layout pass (R4)').toBe(0);
    expect(agents.flatMap((a) => a.refused), 'every agent batch applied').toEqual([]);
    const landed = (await blockText(page, id, `s${TYPING_SECTION}p2`)) ?? '';
    expect(landed.endsWith(typed), `the typed text landed whole: …${landed.slice(-80)}`).toBe(true);
  });
  if (layer.streamed?.on) await seam.send({ cmd: 'drop', session: 'perf-stream', toolUseId: STREAM_ID }).catch(() => {});
  judged(rows, hidden ? 'marginalHidden' : 'marginal');
}

/** A test's first measured trial's admission (support/quiet.ts), after its launch and setup: logged, and kept under `key`. */
async function admitted(rows: Rows, key: 'quiet' | 'quietHidden' | 'quietSigkill'): Promise<void> {
  const admission = await quietWait();
  console.log(`[document scale] the first trial's admission (${key}): ${admission.summary}`);
  rows.write({ [key]: admission });
}

// The run passes when no row failed (Decision Log 44's reading of the parent's Decision Log 54): a marginal row is listed
// for P3-F's re-measure, in the output and in the results' `marginal`, and does not fail the run.
function judged(rows: Rows, key: 'marginal' | 'marginalSigkill' | 'marginalHidden' /* P4-B1's follow-up */): void {
  const marginal = rows.rows.filter((r) => r.verdict === 'marginal');
  rows.write({ [key]: marginal.map((r) => ({ row: r.row, value: r.value, limit: r.limit, unit: r.unit, load: r.load })) });
  if (marginal.length > 0) console.log(`marginal rows (P3-F re-measures):\n${marginal.map((r) => `  ${r.row}: ${r.value} ${r.unit} against ${r.limit} at load ${r.load}`).join('\n')}`);
  const failed = rows.rows.filter((r) => r.verdict === 'failed');
  expect(failed, `bounds failed (a miss of 20 percent or more, or a miss at load under 10; the loads are in ${RESULTS})`).toEqual([]);
}

test('the scale gate at 200 pages: typing, two agents, first sync, history, memory, Korean under load', async () => {
  rmSync(RESULTS, { force: true }); // this run's rows only
  const { large, small } = seedsOnce();
  const { page, app, seam } = await start();
  const rows = new Rows(RESULTS, { run: new Date().toISOString(), seed: { large: large.stats, small: small.stats } });
  const loads: Record<string, number> = { launched: load1() };
  const idle0 = await seam.heap();

  // ---- the documents, then a wait for the host to unload them, so the first opens are cold ----------------------------
  const id = await seeded(page, seam, 'Scale 200', large.state);
  const smallId = await seeded(page, seam, 'Scale 20', small.state);
  await ok(page, 'artifacts.saveVersion', { artifactId: id, label: 'Seeded', note: 'S7b seed' });
  // the host's modules warmed (the schema, the markdown dialect, the tools a read builds) by one read of the small
  // document, then released: the idle heap the close is judged against holds what any first read loads for good
  await seam.call('perf-warm', 'artifact_read', { artifact: smallId });
  await seam.release('perf-warm');
  await sleep(UNLOAD_WAIT_MS);
  const idle1 = await seam.heap();
  rows.write({ heap: { idle0: MB(idle0.heapUsed), idleWarmAfterUnload: MB(idle1.heapUsed) } });
  await admitted(rows, 'quiet');

  await test.step('6: first sync to interactive, cold and warm, at 20 and at 200 pages', async () => {
    const small20 = small.stats.topBlocks - 5;
    const cold20 = await openTimed(page, smallId, 'Scale 20', small20);
    await closeTab(page, 'Scale 20');
    const warm20 = await openTimed(page, smallId, 'Scale 20', small20);
    await closeTab(page, 'Scale 20');
    const big = large.stats.topBlocks - 20;
    const cold200 = await openTimed(page, id, 'Scale 200', big);
    await closeTab(page, 'Scale 200');
    const warm200 = await openTimed(page, id, 'Scale 200', big);
    rows.add('6 20p cold', 'first sync to interactive, 20 pages, cold (press → frame after the blocks are drawn)', cold20.toPostPaintMs, 'ms', 200, '≤ 200 ms', `${cold20.blocks} blocks; to the frame ${cold20.toPaintMs.toFixed(1)} ms`);
    rows.add('6 20p warm', 'first sync to interactive, 20 pages, warm', warm20.toPostPaintMs, 'ms', 200, '≤ 200 ms', `to the frame ${warm20.toPaintMs.toFixed(1)} ms`);
    rows.add('6 200p cold', 'first sync to interactive, 200 pages, cold', cold200.toPostPaintMs, 'ms', 1000, '≤ 1,000 ms', `${cold200.blocks} blocks; to the frame ${cold200.toPaintMs.toFixed(1)} ms`);
    rows.add('6 200p warm', 'first sync to interactive, 200 pages, warm', warm200.toPostPaintMs, 'ms', 1000, '≤ 1,000 ms', `to the frame ${warm200.toPaintMs.toFixed(1)} ms`);
  });

  // ---- window B on the same document ---------------------------------------------------------------------------------
  const [pageB] = await Promise.all([app.waitForEvent('window'), app.evaluate(() => (globalThis as unknown as { __maws_documents: { openWindow(): number } }).__maws_documents.openWindow())]);
  await pageB.waitForLoadState('domcontentloaded');
  const openB = await openTimed(pageB, id, 'Scale 200', large.stats.topBlocks - 20);
  rows.add('6 200p window B', 'first sync to interactive, 200 pages, a second window (host warm)', openB.toPostPaintMs, 'ms', 1000, '≤ 1,000 ms');
  const visibility = await Promise.all([page, pageB].map((p) => p.evaluate(() => new Promise<{ state: string; fps: number }>((resolve) => {
    let frames = 0;
    const until = performance.now() + 1_000;
    const tick = () => (performance.now() < until ? (frames++, requestAnimationFrame(tick)) : resolve({ state: document.visibilityState, fps: frames }));
    requestAnimationFrame(tick);
  }))));
  rows.write({ windows: { A: visibility[0], B: visibility[1] } });

  // ---- the agents read (the 200-block read on a cold replica), the host's heap with everything open ----------------
  // each agent's first read (its replica made by it), at once its first batch — five ops, every target among what that read
  // showed — on that replica (Decision Log 20's "first batch after a read"), then the rest of the tab for the steady state
  const agents = agentsFor();
  for (const [k, agent] of agents.entries()) {
    const read = await readFirst(seam, agent, id);
    rows.add(`read idle ${k + 1}`, `the 200-block read, ${agent.session}'s first (its replica made), host loop max over the call`, read.loop.max, 'ms', null, 'recorded (36–44 ms headless, Decision Log 34)', `wall ${read.wallMs.toFixed(1)} ms`, read.background);
    const shown = Math.max(...[...agent.blocks.keys()].map((blockId) => /^s(\d+)p5$/.exec(blockId)).filter((m) => m !== null).map((m) => Number(m![1]))) + 1;
    const { ops, run } = agent.firstBatch();
    const answer = await seam.call<{ revision: number; results: Array<{ newIds?: string[] }> }>(agent.session, 'artifact_edit', { artifact: id, baseRevision: 'last', ops });
    agent.record(run, answer);
    expect(answer.isError, answer.text).toBe(false);
    expect(ops, 'a five-op batch').toHaveLength(5);
    rows.add(`5 first after read ${k + 1}`, `the first batch after a read: ${agent.session}'s five ops right after its 200-block read, on the replica that read made (sections 0 to ${shown - 1}), host loop max over the call`, answer.loop.max, 'ms', 50, '≤ 50 ms (Decision Log 20, 37)', `wall ${answer.wallMs.toFixed(1)} ms; ops ${ops.map((op) => op.op).join(', ')}`, answer.background);
    await readRest(seam, agent, id, read.result!);
  }
  const steadyFrom = agents.map((agent) => agent.applied.length); // the steady state's batches follow

  await test.step('1 to 5: typing in A, painted in B, two agents writing, the host loop', async () => {
    const { clientID } = await instrumentTyping(page, id);
    await watchRemote(pageB, id, clientID);
    await caretAtEnd(page, id, `s${TYPING_SECTION}p2`);
    await ok(page, 'artifacts.testLoopDelay', { reset: true });
    await seam.send({ cmd: 'loop', reset: true });
    await startMeasuring(page);
    loads.steadyStart = load1();
    const reads: Array<{ session: string; answer: CallAnswer<ReadResult> }> = [];
    const typing = type(page, TYPED, 300);
    const [typed] = await Promise.all([typing, agentsRun(seam, agents, id, typing, 12_000, reads)]);
    const drained = await drain(page, pageB); // the last keystrokes acknowledged, B's last frames (P3-F)
    const loop = await ok<{ p50: number; p99: number; max: number }>(page, 'artifacts.testLoopDelay', {});
    loads.steadyEnd = load1();
    const report = await typingReport(page);
    const keys = keystrokeMeasures(report);
    const counted = everyKeystroke(report, await remoteSeen(pageB), drained.end);
    const painted = counted.inB;
    const note = `${keys.keystrokes} keystrokes (${keys.noTransaction} without a transaction); agents: ${agents.map((a) => `${a.session} ${a.applied.length} batches, ${a.refused.length} refused`).join('; ')}`;
    rows.add('1 p95', 'keystroke → frame in A, p95 (200 pages, 2 windows, 2 agents)', keys.frame.p95, 'ms', 28, 'p95 ≤ 28 ms (mini 20.3 to 26.6, P4 Decision Log 33; MacBook target 16)', note);
    rows.add('1 max', 'keystroke → frame in A, max', keys.frame.max, 'ms', 50, 'max ≤ 50 ms', `p50 ${keys.frame.p50}`);
    rows.add('2 p95', 'keystroke → presented (Event Timing; a keystroke under its 16 ms threshold counted at 16)', keys.presented.p95, 'ms', 58, 'p95 ≤ 58 ms (mini 56 and 56, P4 Decision Log 33)', `${keys.presentedReported} keydowns reported at ≥ 16 ms; max ${keys.presented.max}`);
    rows.add('3 p95', 'keystroke → durable ack, p95 (every keystroke counted)', counted.ack.p95, 'ms', 100, 'p95 ≤ 100 ms', `${counted.acked} of ${counted.keystrokes} acked${missed(counted.acked, counted.keystrokes, 'unacknowledged')}; drained ${drained.waitedMs} ms; p50 ${counted.ack.p50}, max ${counted.ack.max}`);
    rows.add('4 p95', 'keystroke painted in window B, p95 (every keystroke counted)', painted.p95, 'ms', 100, 'p95 ≤ 100 ms', `${counted.painted} of ${counted.keystrokes} painted${missed(counted.painted, counted.keystrokes, 'not painted in B')}; p50 ${painted.p50}, max ${painted.max}`);
    rows.add('5 p99', 'host event-loop delay over the run (A’s testLoopDelay: the whole gaps of its own 10 ms timer), p99, documents live with the writer’s batches', loop.p99, 'ms', 50, 'p99 ≤ 50 ms');
    rows.add('5 max', 'host event-loop delay over the run, max', loop.max, 'ms', 100, 'max ≤ 100 ms');
    const all = agents.flatMap((a, k) => a.applied.slice(steadyFrom[k]));
    const slowest = all.reduce<(typeof all)[number] | undefined>((a, b) => (a === undefined || b.loop.max > a.loop.max ? b : a), undefined); // P4-R6: its record names what shared its loop
    rows.add('5 batch max', 'an agent batch of five ops in the steady state (replicas fully read, typing and the other agent running): the host loop’s max over each batch', Math.max(...all.map((b) => b.loop.max)), 'ms', 50, '≤ 50 ms (Decision Log 37)', `${all.length} batches; loop max p95 ${stats(all.map((b) => b.loop.max)).p95}; call wall p95 ${stats(all.map((b) => b.wallMs)).p95} ms`, slowest?.background);
    const seamLoop = await seam.send<{ loop: { max: number; p99: number } }>({ cmd: 'loop' });
    rows.add('5 max (gaps)', 'host loop over the run measured by the seam’s 1 ms tick gaps (beside A’s 10 ms testLoopDelay), max', seamLoop.loop.max, 'ms', 100, 'max ≤ 100 ms', `p99 ${seamLoop.loop.p99.toFixed(1)} ms`);
    for (const [k, r] of reads.entries()) rows.add(`read load ${k + 1}`, `the 200-block read under load (${r.session}, typing and the other agent running), host loop max over the call`, r.answer.loop.max, 'ms', 100, 'held to row 5’s max ≤ 100 ms', `wall ${r.answer.wallMs.toFixed(1)} ms`, r.answer.background);
    rows.write({ steady: { loads, typing: { ...keys, ack: counted.ack, acked: counted.acked }, painted, paintedKeys: counted.painted, drain: drained, loop, agents: agents.map((a) => ({ session: a.session, applied: a.applied.length, refused: a.refused })) } });
    expect(agents.flatMap((a) => a.refused), 'every agent batch applied').toEqual([]);
    const landed = (await blockText(page, id, `s${TYPING_SECTION}p2`)) ?? '';
    expect(landed.endsWith(typed), `the typed text landed whole: …${landed.slice(-80)}`).toBe(true);
    await expect.poll(() => blockText(pageB, id, `s${TYPING_SECTION}p2`)).toBe(await blockText(page, id, `s${TYPING_SECTION}p2`));
  });

  await test.step('10: Korean composed under load into a block an agent edits; the hold, its merged flush, no cap', async () => {
    const [a1] = agents;
    const block = `s${IME_SECTION}p3`;
    // the agent's anchor in the block, so each of its batches edits a word of the block the owner composes in
    const anchor = await seam.call(a1.session, 'artifact_edit', { artifact: id, baseRevision: 'last', ops: [{ op: 'replace_block', id: block, markdown: 'Anchor alpha0 here.' }] });
    expect(anchor.isError, anchor.text).toBe(false);
    await expect.poll(() => blockText(page, id, block)).toBe('Anchor alpha0 here.');
    const KOREAN = ' 안녕하세요 한글 입력 테스트입니다';
    await instrumentTyping(page, id);
    await caretAtEnd(page, id, block);
    await startMeasuring(page);
    let alpha = 0;
    const exact: boolean[] = [];
    for (let rep = 1; rep <= 3; rep++) {
      let composing = true;
      const stress = (async () => {
        while (composing) {
          await sleep(150 + Math.random() * 250);
          if (!composing) break;
          const answer = await batch(seam, a1, id, { block, old: `alpha${alpha}`, new: `alpha${alpha + 1}` });
          if (!answer.isError) alpha += 1;
        }
      })();
      const other = (async () => {
        while (composing) {
          await sleep(150 + Math.random() * 250);
          if (composing) await batch(seam, agents[1], id);
        }
      })();
      const cdp = await page.context().newCDPSession(page);
      try {
        const steps = keystrokes(KOREAN);
        for (const step of steps) await imeStep(cdp, step, steps);
      } finally {
        composing = false;
        await cdp.detach();
      }
      await Promise.all([stress, other]);
      const expected = `Anchor alpha${alpha} here.${KOREAN.repeat(rep)}`;
      await expect.poll(() => blockText(page, id, block), { timeout: 10_000 }).toBe(expected);
      await expect.poll(() => blockText(pageB, id, block), { timeout: 10_000 }).toBe(expected);
      exact.push(true);
    }
    const report = await typingReport(page);
    const inputs = stats(report.imeInputs.filter((i) => i.tRaf !== undefined).map((i) => i.tRaf! - i.tIn));
    const holds = report.holds.filter((h) => h.off !== undefined);
    const flushed = holds.filter((h) => h.buffered > 0);
    const capFired = holds.filter((h) => h.byCap).length + report.providerLog.filter((line) => line.includes('cap')).length;
    rows.add('10 exact', 'IME under load: the composed Korean exact in the block the agent edits (reps exact of 3)', exact.filter(Boolean).length, 'of 3', null, 'exact 3 of 3', `agent edits into the block ${alpha}; agents: ${agents.map((a) => `${a.session} ${a.applied.length} batches, ${a.refused.length} refused`).join('; ')}`);
    rows.add('10 input p95', 'IME under load: composition input → frame, p95', inputs.p95, 'ms', 16, 'p95 ≤ 16 ms', `n ${inputs.n}, max ${inputs.max}`);
    rows.add('10 flush', 'IME under load: the hold’s flush, longest (merged into one update per run)', Math.max(0, ...flushed.map((h) => h.flushMs!)), 'ms', 50, '≤ 50 ms (no long task)', `${holds.length} holds, ${flushed.length} flushed a buffer (frames ${flushed.map((h) => h.buffered).join(', ')}; doc updates applied per flush ${flushed.map((h) => h.updatesInFlush).join(', ')})`);
    rows.add('10 cap', 'IME under load: the 5 s cap fired', capFired, 'holds', 0, 'never (0)', report.providerLog.join(' | ') || 'no provider log line');
    expect(flushed.length, 'the agent’s edits into the composing block were held and flushed').toBeGreaterThan(0);
  });

  await test.step('7: the history preview’s enter and leave, three times; the renderers after', async () => {
    await page.locator(`[data-artifact-tab="${id}"]`).getByRole('toolbar', { name: 'Formatting', exact: true }).getByRole('button', { name: 'Version history', exact: true }).click();
    const rail = page.locator(`[data-artifact-tab="${id}"]`).getByRole('complementary', { name: 'Version history' });
    await expect(rail).toBeVisible();
    for (let k = 1; k <= 3; k++) {
      await armHistory(page, id, 'enter', large.stats.topBlocks - 20);
      await rail.getByRole('button', { name: /^Version Seeded/ }).click();
      const enter = await historyResult(page);
      await armHistory(page, id, 'leave');
      await page.getByRole('toolbar', { name: 'Version preview' }).getByRole('button', { name: 'Back to document' }).click();
      const leave = await historyResult(page);
      rows.add(`7 enter ${k}`, `history preview enter (press → the preview editor bound and drawn and the bar’s change count drawn, the extra render included → frame after), preview ${k}`, enter.toPostPaintMs, 'ms', 1200, '≤ 1,200 ms per preview (mini 890.8 to 1,126.8; MacBook target 1,000)');
      rows.add(`7 leave ${k}`, `history preview leave, preview ${k}`, leave.toPostPaintMs, 'ms', 500, '≤ 500 ms');
    }
    const memory = await processMemory(app);
    const heaps = { jsHeapA: await jsHeapMB(page), jsHeapB: await jsHeapMB(pageB) };
    await collectGarbage(page);
    await collectGarbage(pageB);
    const collected = await processMemory(app);
    // Decision Log 44: the 600 MB bound (Decision Log 109's calibration of the 500 MB target to the mini) reads on the
    // retained set after a forced collection (row "8 renderer collected"); the figure right after the previews, before
    // it, is recorded beside it
    for (const renderer of memory.renderers) {
      const after = collected.renderers.find((r) => r.windowId === renderer.windowId)?.workingSetMB;
      rows.add(`8 renderer ${renderer.windowId}`, `renderer working set just after three previews, before a forced collection (window ${renderer.windowId})`, renderer.workingSetMB, 'MB', null, 'recorded; the ≤ 600 MB bound (Decision Log 109) reads after a forced collection (Decision Log 44)', after === undefined ? undefined : `${after} MB right after the forced collection`);
    }
    rows.write({ memoryAfterPreviews: { ...memory, ...heaps, afterCollection: { ...collected, jsHeapA: await jsHeapMB(page), jsHeapB: await jsHeapMB(pageB) } } });
  });

  await test.step('8: the host’s heap loaded and, after close and unload, against idle; the renderers', async () => {
    const memory = await processMemory(app);
    const loaded = await seam.heap();
    rows.add('8 host loaded', 'host heap delta with the 200-page document open in two windows and two agent replicas (from the warm idle)', MB(loaded.heapUsed - idle1.heapUsed), 'MB', 100, '≤ +100 MB', `idle ${MB(idle1.heapUsed)} → ${MB(loaded.heapUsed)} MB; host working set ${memory.utility.map((u) => `${u.name} ${u.workingSetMB}`).join(', ')} MB`);
    for (const renderer of memory.renderers) rows.add(`8 renderer collected ${renderer.windowId}`, `renderer working set once the previews' garbage is collected (window ${renderer.windowId}; a forced collection)`, renderer.workingSetMB, 'MB', 600, '≤ 600 MB (mini 480.5 and 519.7, about 8% run variance; MacBook 412 to 469, target 500)');
    await closeTab(page, 'Scale 200');
    await pageB.close();
    for (const agent of agents) await seam.release(agent.session);
    await sleep(UNLOAD_WAIT_MS);
    const after = await seam.heap();
    rows.add('8 host after close', 'host heap after close and unload, from the warm idle (its modules loaded by one read, the documents unloaded)', MB(after.heapUsed - idle1.heapUsed), 'MB', 5, 'within 5 MB of idle', `idle ${MB(idle1.heapUsed)} (at launch ${MB(idle0.heapUsed)}) → ${MB(after.heapUsed)} MB`);
  });

  rows.write({ loads });
  judged(rows, 'marginal');
  expect(launch!.consoleErrors(), 'the console stays free of errors').toEqual([]);
});

test('11: a host SIGKILL under load loses no acknowledged edit, and every replica is live again within a second of the re-fork', async () => {
  const { large } = seedsOnce();
  const { page, app, seam } = await start();
  const rows = new Rows(RESULTS, {});
  const id = await seeded(page, seam, 'Scale 200', large.state);
  await openTimed(page, id, 'Scale 200', large.stats.topBlocks - 20);
  const [pageB] = await Promise.all([app.waitForEvent('window'), app.evaluate(() => (globalThis as unknown as { __maws_documents: { openWindow(): number } }).__maws_documents.openWindow())]);
  await pageB.waitForLoadState('domcontentloaded');
  await openTimed(pageB, id, 'Scale 200', large.stats.topBlocks - 20);
  const agents = agentsFor();
  for (const agent of agents) await readAll(seam, agent, id);
  await admitted(rows, 'quietSigkill');
  await instrumentTyping(page, id);
  await caretAtEnd(page, id, `s${TYPING_SECTION}p2`);
  const before = (await blockText(page, id, `s${TYPING_SECTION}p2`))!;
  // both windows' replica phases, sampled every 10 ms on the page's clock (Date.now, the runner's clock too)
  const watchPhase = (p: Page) =>
    p.evaluate((selector) => {
      const samples: Array<{ at: number; phase: string; synced: boolean }> = [];
      (window as unknown as { __phases: typeof samples }).__phases = samples;
      setInterval(() => {
        const dom = document.querySelector(selector) as (HTMLElement & { editor?: { extensionManager: { extensions: Array<{ name: string; options: { hold: { base: { state(): { phase: string; synced: boolean } } } } }> } } }) | null;
        const state = dom?.editor?.extensionManager.extensions.find((e) => e.name === 'collaboration')?.options.hold.base.state();
        if (state && (samples.at(-1)?.phase !== state.phase || samples.at(-1)?.synced !== state.synced)) samples.push({ at: Date.now(), phase: state.phase, synced: state.synced });
      }, 10);
    }, EDITOR_SELECTOR(id));
  await watchPhase(page);
  await watchPhase(pageB);
  await startMeasuring(page);

  const { pid } = await hostState(page);
  let killedAt = 0;
  let forkedAt = 0;
  let restarted = false;
  const acked: string[] = []; // the paragraphs batches acknowledged before the kill inserted
  let ackedKeysAtKill = 0;
  let typedAtKill = '';
  let typed = '';
  const typing = (async () => {
    const end = Date.now() + 12_000;
    let k = 0;
    while (Date.now() < end) {
      const ch = TYPED[k++ % TYPED.length]!;
      await page.keyboard.type(ch);
      typed += ch;
      await sleep(80 + Math.random() * 40);
    }
  })();
  const killer = (async () => {
    await sleep(5_000);
    ackedKeysAtKill = await page.evaluate(() => {
      const S = (window as unknown as { __scale: { acks: number[]; keys: Array<{ local?: number }> } }).__scale;
      return S.keys.filter((key) => key.local !== undefined && S.acks[key.local - 1] !== undefined).length;
    });
    typedAtKill = typed;
    killedAt = Date.now();
    process.kill(pid!, 'SIGKILL');
    await expect.poll(async () => (await hostState(page).catch(() => ({ pid: null, state: 'gone' }))).pid, { timeout: 30_000, intervals: [50] }).not.toBe(pid);
    forkedAt = Date.now();
    await expect.poll(async () => (await hostState(page)).state, { timeout: 30_000, intervals: [50] }).toBe('ready');
    restarted = true;
  })();
  // the agents: a batch every 0.8 to 1.6 s until the kill (a batch in flight then is abandoned, unacknowledged); while the
  // host is down each waits; at the re-fork each reads again at once (its replica made anew), the moment it is answered
  // being its replica live again, then reads the rest
  const agentLive: number[] = agents.map(() => NaN);
  const killed = new Promise<void>((resolve) => {
    const check = setInterval(() => {
      if (!killedAt) return;
      clearInterval(check);
      resolve();
    }, 5);
  });
  const agentLoops = Promise.all(
    agents.map(async (agent, k) => {
      for (;;) {
        if (restarted) {
          const read = await readFirst(seam, agent, id);
          agentLive[k] = Date.now();
          await readRest(seam, agent, id, read.result!);
          return;
        }
        if (killedAt) {
          await sleep(5);
          continue;
        }
        await Promise.race([sleep(800 + Math.random() * 800), killed]);
        if (killedAt) continue;
        const sentAt = Date.now();
        await Promise.race([
          batch(seam, agent, id).then(
            (answer) => {
              if (!answer.isError && sentAt < (killedAt || Infinity)) acked.push(...(answer.result!.results[2]?.newIds ?? []));
            },
            () => {}, // a command the killed host never answered: not acknowledged
          ),
          killed,
        ]);
      }
    }),
  );
  await Promise.all([typing, killer]);
  await agentLoops;
  await expect.poll(async () => (await replicaState(page, id))?.unsaved, { timeout: 30_000 }).toBe(0);
  const phases = await Promise.all([page, pageB].map((p) => p.evaluate(() => (window as unknown as { __phases: Array<{ at: number; phase: string; synced: boolean }> }).__phases)));
  const liveAgain = phases.map((samples) => samples.find((s) => s.at > killedAt && s.phase === 'live' && s.synced)?.at ?? NaN);
  const windowsLive = Math.max(...liveAgain);
  const allLive = Math.max(windowsLive, ...agentLive);
  const expected = `${before}${typed}`;
  await expect.poll(() => blockText(pageB, id, `s${TYPING_SECTION}p2`), { timeout: 15_000 }).toBe(expected);
  const check = new Agent('perf-check', [], prng(3));
  await readAll(seam, check, id);
  const deletedSince = new Set(agents.flatMap((agent) => [...agent.deleted])); // an agent's own later delete of its insert
  const missing = acked.filter((blockId) => !check.blocks.has(blockId) && !deletedSince.has(blockId));
  const hostText = check.blocks.get(`s${TYPING_SECTION}p2`) ?? '';
  const keysLost = hostText.includes(typedAtKill.trimEnd()) ? 0 : 1;
  rows.add('11 acked lost', 'host SIGKILL under load: acknowledged edits lost (keystrokes acked before the kill; agent batches acked before it)', missing.length + keysLost, 'edits', 0, '0', `${ackedKeysAtKill} keystrokes acked of ${typedAtKill.length} typed before the kill, ${typed.length} typed in all, all in the host after; ${acked.length} acked agent inserts before the kill (${acked.filter((b) => deletedSince.has(b)).length} deleted by the agent's own later batches), ${missing.length} missing`);
  rows.add('11 fork → live', 'host SIGKILL: re-fork → every replica live: both windows’ (live and synced) and both agents’ (their first read after the re-fork answered)', allLive - forkedAt, 'ms', 1000, '≤ 1,000 ms', `kill → re-fork ${forkedAt - killedAt} ms (the supervisor’s restart delay); kill → all live ${allLive - killedAt} ms; from the re-fork: windows ${liveAgain.map((t) => t - forkedAt).join(', ')} ms, agents ${agentLive.map((t) => t - forkedAt).join(', ')} ms`);
  rows.write({ sigkill: { load: load1() } });
  judged(rows, 'marginalSigkill');
});

// P4-R6 (the P4 composite spec's Decision Log 44): row 5's first batch after a read, repeated in one launch, so a stray
// that one run meets about one time in six is met often enough to count and to name. Run only on purpose:
//   pnpm e2e:document-scale-repeat     (the script sets MAWS_DOCUMENT_REPEAT; the scale gate's own run skips this test)
// Each round is a fresh session's 200-block read (its replica made, as perf-agent-1's first read makes it) and at once
// its five-op first batch, on the 200-page document open in two windows, then the session's end and a pause of 1.5 to
// 3 s. Every round's loop max, wall and background (what shared the call's loop: CallBackground in
// support/document-scale.ts) is kept in test-results/document-scale-repeat.json, written after each round so a run
// that stops keeps what it measured; the rows are recorded, with no bound. A round whose batch is refused (a long run's
// edits can leave the fifth op's unscoped quote matching several blocks) is kept with its refusal and left out of the
// rows; more than a tenth of the rounds refused means the fixture is broken, and fails the test.
const REPEAT = Number(process.env.MAWS_DOCUMENT_REPEAT ?? 0);
const REPEAT_RESULTS = join(REPO_ROOT, 'test-results', 'document-scale-repeat.json');

test('5r: the first batch after a read, repeated in one launch (MAWS_DOCUMENT_REPEAT rounds)', async () => {
  test.skip(!(REPEAT > 0), 'runs only under MAWS_DOCUMENT_REPEAT (pnpm e2e:document-scale-repeat)');
  rmSync(REPEAT_RESULTS, { force: true });
  const { large } = seedsOnce();
  const { page, app, seam } = await start();
  const rows = new Rows(REPEAT_RESULTS, { run: new Date().toISOString(), rounds: REPEAT });
  const id = await seeded(page, seam, 'Scale 200', large.state);
  await openTimed(page, id, 'Scale 200', large.stats.topBlocks - 20);
  const [pageB] = await Promise.all([app.waitForEvent('window'), app.evaluate(() => (globalThis as unknown as { __maws_documents: { openWindow(): number } }).__maws_documents.openWindow())]);
  await pageB.waitForLoadState('domcontentloaded');
  await openTimed(pageB, id, 'Scale 200', large.stats.topBlocks - 20);
  const sections = [...Array(SECTIONS).keys()].filter((s) => !KEPT_CLEAR(s) && s % 2 === 0); // perf-agent-1's (agentsFor)
  type Round = { round: number; max: number; wallMs: number; readMax: number; load: number; background?: CallBackground; refused?: string };
  const rounds: Round[] = [];
  await admitted(rows, 'quiet');
  for (let round = 1; round <= REPEAT; round++) {
    await sleep(1_500 + Math.random() * 1_500);
    const agent = new Agent(`perf-repeat-${round}`, sections, prng(100 + round));
    const read = await readFirst(seam, agent, id);
    const { ops } = agent.firstBatch();
    const answer = await seam.call<{ revision: number; results: Array<{ newIds?: string[] }> }>(agent.session, 'artifact_edit', { artifact: id, baseRevision: 'last', ops });
    rounds.push({ round, max: +answer.loop.max.toFixed(2), wallMs: +answer.wallMs.toFixed(1), readMax: +read.loop.max.toFixed(2), load: load1(), background: answer.background, ...(answer.isError ? { refused: answer.text } : {}) });
    rows.write({ repeat: rounds });
    await seam.release(agent.session);
  }
  const applied = rounds.filter((r) => r.refused === undefined);
  const refused = rounds.filter((r) => r.refused !== undefined);
  const maxes = stats(applied.map((r) => r.max));
  const slowest = applied.reduce<Round | null>((a, b) => (a === null || b.max > a.max ? b : a), null);
  const over = applied.filter((r) => r.max > 50);
  rows.add('5r p50', `the first batch after a read, ${applied.length} applied of ${REPEAT} rounds in one launch: host loop max over the call, p50`, maxes.p50, 'ms', null, 'recorded');
  rows.add('5r p95', 'the first batch after a read, repeated: p95', maxes.p95, 'ms', null, 'recorded');
  rows.add('5r max', 'the first batch after a read, repeated: max (its record beside it)', maxes.max, 'ms', null, 'recorded', slowest ? `round ${slowest.round}, wall ${slowest.wallMs} ms` : undefined, slowest?.background);
  rows.add('5r over 50', 'the first batch after a read, repeated: rounds over row 5’s 50 ms', over.length, 'rounds', null, 'recorded', over.map((r) => `round ${r.round} ${r.max} ms`).join('; ') || undefined);
  rows.add('5r refused', 'the first batch after a read, repeated: rounds whose batch was refused, left out of the rows above (the test fails past a tenth)', refused.length, 'rounds', null, 'recorded', refused.length > 0 ? `rounds ${refused.map((r) => r.round).join(', ')} (each refusal in repeat)` : undefined);
  rows.write({ repeat: rounds });
  expect(refused.length, `${refused.length} of ${REPEAT} rounds refused, the first: ${refused[0]?.refused}`).toBeLessThanOrEqual(REPEAT / 10);
});
