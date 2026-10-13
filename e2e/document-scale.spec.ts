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
//   MAWS_DOCUMENT_PERF=1 pnpm e2e:document-scale
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { prng, seedDocument, type SeedStats } from './support/document-seed';
import { keystrokes } from './support/hangul';
import { launchMaws, REPO_ROOT, type MawsLaunch } from './support/launch';
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
  paintedInB,
  PerfSeam,
  processMemory,
  readAll,
  remoteSeen,
  replicaState,
  Rows,
  startMeasuring,
  stats,
  typingReport,
  watchRemote,
  type CallAnswer,
  type ReadResult,
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
  const agents = agentsFor();
  const firstReads: Array<CallAnswer<ReadResult>> = [];
  for (const agent of agents) firstReads.push(await readAll(seam, agent, id));
  for (const [k, read] of firstReads.entries()) rows.add(`read idle ${k + 1}`, `the 200-block read, ${agents[k]!.session}'s first (its replica made), host loop max over the call`, read.loop.max, 'ms', null, 'recorded (36–44 ms headless, Decision Log 34)', `wall ${read.wallMs.toFixed(1)} ms`);

  await test.step('1 to 5: typing in A, painted in B, two agents writing, the host loop', async () => {
    const { clientID } = await instrumentTyping(page, id);
    await watchRemote(pageB, id, clientID);
    await caretAtEnd(page, id, `s${TYPING_SECTION}p2`);
    await ok(page, 'artifacts.testLoopDelay', { reset: true });
    await startMeasuring(page);
    loads.steadyStart = load1();
    const reads: Array<{ session: string; answer: CallAnswer<ReadResult> }> = [];
    const typing = type(page, TYPED, 300);
    const [typed] = await Promise.all([typing, agentsRun(seam, agents, id, typing, 12_000, reads)]);
    await sleep(1_500); // the last keystrokes acknowledged, B's last frames
    const loop = await ok<{ p50: number; p99: number; max: number }>(page, 'artifacts.testLoopDelay', {});
    loads.steadyEnd = load1();
    const report = await typingReport(page);
    const keys = keystrokeMeasures(report);
    const painted = stats(paintedInB(report, await remoteSeen(pageB)));
    const note = `${keys.keystrokes} keystrokes (${keys.noTransaction} without a transaction); agents: ${agents.map((a) => `${a.session} ${a.applied.length} batches, ${a.refused.length} refused`).join('; ')}`;
    rows.add('1 p95', 'keystroke → frame in A, p95 (200 pages, 2 windows, 2 agents)', keys.frame.p95, 'ms', 16, 'p95 ≤ 16 ms', note);
    rows.add('1 max', 'keystroke → frame in A, max', keys.frame.max, 'ms', 50, 'max ≤ 50 ms', `p50 ${keys.frame.p50}`);
    rows.add('2 p95', 'keystroke → presented (Event Timing; a keystroke under its 16 ms threshold counted at 16)', keys.presented.p95, 'ms', 50, 'p95 ≤ 50 ms', `${keys.presentedReported} keydowns reported at ≥ 16 ms; max ${keys.presented.max}`);
    rows.add('3 p95', 'keystroke → durable ack, p95', keys.ack.p95, 'ms', 100, 'p95 ≤ 100 ms', `${keys.acked} acked; p50 ${keys.ack.p50}, max ${keys.ack.max}`);
    rows.add('4 p95', 'keystroke painted in window B, p95', painted.p95, 'ms', 100, 'p95 ≤ 100 ms', `n ${painted.n}; p50 ${painted.p50}, max ${painted.max}`);
    rows.add('5 p99', 'host event-loop delay over the run (A’s testLoopDelay), p99, documents live with the writer’s batches', loop.p99, 'ms', 50, 'p99 ≤ 50 ms');
    rows.add('5 max', 'host event-loop delay over the run, max', loop.max, 'ms', 100, 'max ≤ 100 ms');
    const all = agents.flatMap((a) => a.applied);
    const firsts = all.filter((b) => b.firstAfterRead);
    rows.add('5 batch max', 'an agent batch of five ops: the host loop’s max over the batch (every batch, warm replicas)', Math.max(...all.map((b) => b.loop.max)), 'ms', 50, '≤ 50 ms (Decision Log 37)', `${all.length} batches; loop max p95 ${stats(all.map((b) => b.loop.max)).p95}; call wall p95 ${stats(all.map((b) => b.wallMs)).p95} ms`);
    rows.add('5 first after read', 'the first batch after a read (measured: the batch each agent sent after its read, not a cold replica)', Math.max(...firsts.map((b) => b.loop.max)), 'ms', 50, '≤ 50 ms (Decision Log 20, 37)', `${firsts.length} batches: ${firsts.map((b) => b.loop.max.toFixed(1)).join(', ')} ms`);
    for (const [k, r] of reads.entries()) rows.add(`read load ${k + 1}`, `the 200-block read under load (${r.session}, typing and the other agent running), host loop max over the call`, r.answer.loop.max, 'ms', 100, 'held to row 5’s max ≤ 100 ms', `wall ${r.answer.wallMs.toFixed(1)} ms`);
    rows.write({ steady: { loads, typing: keys, painted, loop, agents: agents.map((a) => ({ session: a.session, applied: a.applied.length, refused: a.refused })) } });
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
    const header = page.locator('[data-region="main"] [data-editor-header]');
    await header.getByRole('button', { name: 'Version history' }).click();
    const rail = page.locator(`[data-artifact-tab="${id}"]`).getByRole('complementary', { name: 'Version history' });
    await expect(rail).toBeVisible();
    for (let k = 1; k <= 3; k++) {
      await armHistory(page, id, 'enter');
      await rail.getByRole('button', { name: /^Version Seeded/ }).click();
      const enter = await historyResult(page);
      await armHistory(page, id, 'leave');
      await page.getByRole('toolbar', { name: 'Version preview' }).getByRole('button', { name: 'Back to document' }).click();
      const leave = await historyResult(page);
      rows.add(`7 enter ${k}`, `history preview enter (press → the bar’s change count drawn, the extra render included → frame after), preview ${k}`, enter.toPostPaintMs, 'ms', 1000, '≤ 1,000 ms');
      rows.add(`7 leave ${k}`, `history preview leave, preview ${k}`, leave.toPostPaintMs, 'ms', 500, '≤ 500 ms');
    }
    const memory = await processMemory(app);
    for (const renderer of memory.renderers) rows.add(`8 renderer ${renderer.windowId}`, `renderer working set just after three previews (window ${renderer.windowId})`, renderer.workingSetMB, 'MB', 500, '≤ 500 MB');
    const heaps = { jsHeapA: await jsHeapMB(page), jsHeapB: await jsHeapMB(pageB) };
    await collectGarbage(page);
    await collectGarbage(pageB);
    const collected = await processMemory(app);
    rows.write({ memoryAfterPreviews: { ...memory, ...heaps, afterCollection: { ...collected, jsHeapA: await jsHeapMB(page), jsHeapB: await jsHeapMB(pageB) } } });
  });

  await test.step('8: the host’s heap loaded and, after close and unload, against idle; the renderers', async () => {
    const memory = await processMemory(app);
    const loaded = await seam.heap();
    rows.add('8 host loaded', 'host heap delta with the 200-page document open in two windows and two agent replicas (from the warm idle)', MB(loaded.heapUsed - idle1.heapUsed), 'MB', 100, '≤ +100 MB', `idle ${MB(idle1.heapUsed)} → ${MB(loaded.heapUsed)} MB; host working set ${memory.utility.map((u) => `${u.name} ${u.workingSetMB}`).join(', ')} MB`);
    for (const renderer of memory.renderers) rows.add(`8 renderer collected ${renderer.windowId}`, `renderer working set once the previews' garbage is collected (window ${renderer.windowId}; a forced collection)`, renderer.workingSetMB, 'MB', 500, '≤ 500 MB');
    await closeTab(page, 'Scale 200');
    await pageB.close();
    for (const agent of agents) await seam.release(agent.session);
    await sleep(UNLOAD_WAIT_MS);
    const after = await seam.heap();
    rows.add('8 host after close', 'host heap after close and unload, from the warm idle (its modules loaded by one read, the documents unloaded)', MB(after.heapUsed - idle1.heapUsed), 'MB', 5, 'within 5 MB of idle', `idle ${MB(idle1.heapUsed)} (at launch ${MB(idle0.heapUsed)}) → ${MB(after.heapUsed)} MB`);
  });

  rows.write({ loads });
  const failed = rows.rows.filter((r) => r.pass === false);
  expect(failed, `bounds missed (judge at load under 20; the loads are in ${RESULTS})`).toEqual([]);
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
  await instrumentTyping(page, id);
  await caretAtEnd(page, id, `s${TYPING_SECTION}p2`);
  const before = (await blockText(page, id, `s${TYPING_SECTION}p2`))!;
  // both windows' replica phases, sampled every 10 ms on the page's clock (Date.now, the runner's clock too)
  const watchPhase = (p: Page) =>
    p.evaluate((selector) => {
      const samples: Array<{ at: number; phase: string; synced: boolean }> = [];
      (window as unknown as { __phases: typeof samples }).__phases = samples;
      setInterval(() => {
        const dom = document.querySelector(selector) as (HTMLElement & { editor?: { extensionManager: { extensions: Array<{ name: string; options: { hold: { state(): { phase: string; synced: boolean } } } }> } } }) | null;
        const state = dom?.editor?.extensionManager.extensions.find((e) => e.name === 'collaboration')?.options.hold.state();
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
  const agentLoops = Promise.all(
    agents.map(async (agent) => {
      let rereadAfterRestart = false;
      while (!killedAt || !restarted || !rereadAfterRestart) {
        await sleep(800 + Math.random() * 800);
        if (restarted && !rereadAfterRestart) {
          await readAll(seam, agent, id);
          rereadAfterRestart = true;
          continue;
        }
        if (killedAt && !restarted) continue; // the host is down: the agent waits as a session's call would
        try {
          const sentAt = Date.now();
          const answer = await batch(seam, agent, id);
          if (!answer.isError && (!killedAt || sentAt < killedAt)) acked.push(...(answer.result!.results[2]?.newIds ?? []));
        } catch {
          // a command the killed host never answered: not acknowledged
        }
      }
    }),
  );
  await Promise.all([typing, killer]);
  await agentLoops;
  await expect.poll(async () => (await replicaState(page, id))?.unsaved, { timeout: 30_000 }).toBe(0);
  const phases = await Promise.all([page, pageB].map((p) => p.evaluate(() => (window as unknown as { __phases: Array<{ at: number; phase: string; synced: boolean }> }).__phases)));
  const liveAgain = phases.map((samples) => samples.find((s) => s.at > killedAt && s.phase === 'live' && s.synced)?.at ?? NaN);
  const allLive = Math.max(...liveAgain);
  const expected = `${before}${typed}`;
  await expect.poll(() => blockText(pageB, id, `s${TYPING_SECTION}p2`), { timeout: 15_000 }).toBe(expected);
  const check = new Agent('perf-check', [], prng(3));
  await readAll(seam, check, id);
  const deletedSince = new Set(agents.flatMap((agent) => [...agent.deleted])); // an agent's own later delete of its insert
  const missing = acked.filter((blockId) => !check.blocks.has(blockId) && !deletedSince.has(blockId));
  const hostText = check.blocks.get(`s${TYPING_SECTION}p2`) ?? '';
  const keysLost = hostText.includes(typedAtKill.trimEnd()) ? 0 : 1;
  rows.add('11 acked lost', 'host SIGKILL under load: acknowledged edits lost (keystrokes acked before the kill; agent batches acked before it)', missing.length + keysLost, 'edits', 0, '0', `${ackedKeysAtKill} keystrokes acked of ${typedAtKill.length} typed before the kill, ${typed.length} typed in all, all in the host after; ${acked.length} acked agent inserts before the kill (${acked.filter((b) => deletedSince.has(b)).length} deleted by the agent's own later batches), ${missing.length} missing`);
  rows.add('11 fork → live', 'host SIGKILL: re-fork → both windows’ replicas live and synced', allLive - forkedAt, 'ms', 1000, '≤ 1,000 ms', `kill → re-fork ${forkedAt - killedAt} ms (the supervisor’s restart delay); kill → all live ${allLive - killedAt} ms; per window ${liveAgain.map((t) => t - killedAt).join(', ')} ms from the kill`);
  rows.write({ sigkill: { load: load1() } });
  const failed = rows.rows.filter((r) => r.pass === false);
  expect(failed, 'bounds missed').toEqual([]);
});
