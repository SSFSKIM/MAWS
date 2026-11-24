// The prestart measure's runs (ticket 851, M5; docs/doperpowers/plans/2026-11-24-prestart-engine.md, D14), shared by
// e2e/prestart-latency.spec.ts (the bound, on the latency stub) and e2e/prestart-engine.spec.ts (the acceptance, on the
// pinned engine). The numbers are test/support/prestart-latency.ts's.
//
// Paired flag-off and flag-on runs in alternating order (ABBA), each one New chat on a fresh launch of its own over a
// fresh profile, so neither arm inherits the other's engine host or warm caches. A run, in the page:
//   - the window in front first (the app's window key, the page visible and focused): a covered window draws no frame,
//     so a run that starts behind another, or leaves the front before its paint, fails its premise rather than reading
//     as a slow reply;
//   - the first `keydown` in the composer (a real key press, Playwright's keyboard through the page's input pipeline);
//   - 3 s of typing from it, then Enter, whose `keydown` is the Send press;
//   - the first assistant row painted: a MutationObserver sees the main region change, and a requestAnimationFrame
//     callback finds the transcript's assistant row carrying the reply's marker (the stub's `⟦t<turn>:<k>⟧`, the
//     stand-in's reply carries one too) shown and inside its scroller's visible box, then posts one message on a
//     MessageChannel; the message's arrival (after that frame's style, layout and paint steps) is the paint's time, as
//     e2e/local-latency.spec.ts reads a delta's frame. The row must still be there and in view at the next frame, or the
//     reading is dropped and the page looks again, so an overscan row the virtualiser mounts out of sight, or one
//     replaced at once, never counts.
// Those stamps are the page's own clock, so no clock is compared across processes. The run also reads the wall clock as it
// presses Enter, which splits the stub's start lines (their own wall-clock `at`) into the engines started before Send and
// after it. Then the turn is let end, the arm's staging checked (`verify`), and the run reads whether Send took the
// prestart (the journal). Each run is torn down before the next: a teardown that fails (a survivor of the profile, a
// keychain prompt) fails the run, and scratch processes that cannot be cleared stop the series, since they would skew
// every later sample. A failure's text is made public (`publicText`) before it is logged, asserted or written.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { MARKER_SOURCE } from '../../test/support/latency-engine';
import { machineLoad } from '../../test/support/latency-budget';
import { armsOfPair, judgePrestartRuns, PRESTART_BENCH, prestartLine, publicText, startsAroundSend, type PrestartArm, type PrestartJudgement, type PrestartRun } from '../../test/support/prestart-latency';
import { invoke, value } from './c7-replay';
import { REPO_ROOT, type MawsLaunch } from './launch';
import { killScratchProcesses } from './processes';
import { adoptedPrestart, composer, newChatTab, startedEngines } from './prestart';

// What a run types: plain words, no marker, long enough for 3 s at the pace below.
const PROMPT = 'Please read this folder and tell me in two lines what it holds and which file to open first';
const KEY_GAP_MS = 70; // between key presses, a quick typist's pace
const TYPE_UNTIL_MS = 2_600; // then the run waits for the 3 s mark in the page and presses Enter
const PAINT_MS = 60_000;
const TURN_MS = 60_000;

type Stamps = { firstKeyAt: number | null; sendAt: number | null; paintAt: number | null; leftFront: boolean };
type PaintWindow = Window & { __prestartStamps: Stamps };

// The page's stamps, installed once the New chat's composer is in front, before the first key press.
async function installStamps(page: Page): Promise<void> {
  await page.evaluate((source) => {
    const main = document.querySelector('[data-region="main"]');
    if (!main) throw new Error('no main region');
    const stamps: Stamps = { firstKeyAt: null, sendAt: null, paintAt: null, leftFront: false };
    (window as unknown as PaintWindow).__prestartStamps = stamps;
    const inFront = () => document.visibilityState === 'visible' && document.hasFocus();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') stamps.leftFront = true;
    });
    const inComposer = (target: EventTarget | null) => target instanceof Element && main.contains(target) && target.closest('[contenteditable="true"]') !== null;
    document.addEventListener('keydown', (event) => {
      if (!inComposer(event.target)) return;
      const at = performance.now();
      if (stamps.firstKeyAt === null) stamps.firstKeyAt = at;
      else if (stamps.sendAt === null && event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        stamps.sendAt = at;
        if (!inFront()) stamps.leftFront = true;
      }
    }, { capture: true });
    // The transcript's assistant rows carrying the reply's marker, and whether a row is shown inside its scroller's
    // visible box and the window's
    const pattern = new RegExp(source);
    const markedRows = () => Array.from(main.querySelectorAll<HTMLElement>('.transcript-row[data-kind="assistant_text"]')).filter((row) => pattern.test(row.textContent ?? ''));
    const inView = (row: HTMLElement) => {
      if (!row.isConnected || !row.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
      const box = row.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) return false;
      const port = row.closest('[data-transcript-scroller]')?.getBoundingClientRect() ?? { top: 0, bottom: innerHeight, left: 0, right: innerWidth };
      return box.bottom > Math.max(port.top, 0) && box.top < Math.min(port.bottom, innerHeight) && box.right > Math.max(port.left, 0) && box.left < Math.min(port.right, innerWidth);
    };
    // A candidate: the row found in a frame, its draw's time once that frame's message arrives
    let candidate: { row: HTMLElement; seq: number; drawnAt: number | null } | null = null;
    let seq = 0;
    let scheduled = false;
    const channel = new MessageChannel();
    channel.port1.onmessage = (event: MessageEvent<number>) => {
      if (candidate !== null && candidate.seq === event.data && candidate.drawnAt === null) candidate.drawnAt = performance.now();
    };
    const schedule = () => {
      if (scheduled || stamps.paintAt !== null) return;
      scheduled = true;
      requestAnimationFrame(check);
    };
    function check(): void {
      scheduled = false;
      if (stamps.paintAt !== null) return;
      if (candidate !== null) {
        if (!inView(candidate.row)) candidate = null; // replaced or out of sight by the next frame: look again
        else if (candidate.drawnAt === null) return schedule(); // its frame's message is still on its way
        else {
          stamps.paintAt = candidate.drawnAt; // drawn, and still there a frame later
          if (!inFront()) stamps.leftFront = true;
          return;
        }
      }
      const rows = markedRows();
      const row = rows.find(inView);
      if (row !== undefined) {
        seq += 1;
        candidate = { row, seq, drawnAt: null };
        channel.port2.postMessage(seq);
      }
      if (rows.length > 0) schedule(); // the candidate's confirmation, or a marked row not yet in view
    }
    new MutationObserver(() => {
      if (stamps.sendAt !== null) schedule();
    }).observe(main, { childList: true, characterData: true, subtree: true });
  }, MARKER_SOURCE);
}
const stampsOf = (page: Page): Promise<Stamps> => page.evaluate(() => (window as unknown as PaintWindow).__prestartStamps);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));

const FRONT_MS = 5_000; // how long a run waits for its window to be in front before it fails its premise
// The run's premise: the app's window is key and the page visible and focused, or the run fails, measuring nothing.
async function inFront(maws: MawsLaunch, arm: PrestartArm): Promise<void> {
  const front = async () =>
    (await maws.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((win) => win.isVisible() && win.isFocused())).catch(() => false)) &&
    (await maws.page.evaluate(() => document.visibilityState === 'visible' && document.hasFocus()));
  const until = Date.now() + FRONT_MS;
  while (!(await front())) {
    if (Date.now() > until) throw new Error(`flag-${arm}: the premise failed: the app's window is not in front (covered, or another app holds the focus), so no frame of its would be drawn`);
    await sleep(100);
  }
}

// 3 s of typing from the first key press, by the page's clock, then Enter; answers the wall clock read as Enter is pressed.
async function typeThenSend(page: Page): Promise<number> {
  await composer(page).click();
  const started = Date.now();
  for (const key of PROMPT) {
    await page.keyboard.type(key);
    if (Date.now() - started >= TYPE_UNTIL_MS) break;
    await sleep(KEY_GAP_MS);
  }
  const elapsed = await page.evaluate(() => {
    const at = (window as unknown as { __prestartStamps: Stamps }).__prestartStamps.firstKeyAt;
    return at === null ? null : performance.now() - at;
  });
  if (elapsed === null) throw new Error('the page saw no key press in the composer');
  await sleep(PRESTART_BENCH.typingMs - elapsed - 5); // the evaluate's way back and the press's way there take the rest
  const sendWallAt = Date.now(); // before the press: an engine Send starts begins after it, one started while typing before
  await page.keyboard.press('Enter');
  return sendWallAt;
}

export interface ArmLaunch {
  maws: MawsLaunch;
  directory: string; // the project's folder the New chat starts in
  startsFile: string | null; // the stub's, or null for an engine that counts none
  verify?: () => void; // what the run's staging shows once its turn ended (the acceptance's hooks); throws to fail the run
}

export interface MeasureOptions {
  group: 'prestart-latency' | 'prestart-engine';
  // a fresh launch for one run, its scratch under `root` (removed after the run)
  launch(arm: PrestartArm, root: string): Promise<ArmLaunch>;
  boundMs: number | null;
  counts: boolean; // the engine counts its starts (the stub): flag-off's one engine starts after its Send, flag-on's before it
  engine: Record<string, unknown>; // what the measure ran on, for its record
}

async function oneRun(arm: PrestartArm, pair: number, launched: ArmLaunch): Promise<PrestartRun> {
  const { maws, directory, startsFile } = launched;
  const { page } = maws;
  const { id } = await newChatTab(page, directory);
  await page.mouse.move(700, 20); // no hover card over the transcript
  await inFront(maws, arm);
  await installStamps(page);
  const sendWallAt = await typeThenSend(page);
  const leftFront = new Error(`flag-${arm}: the premise failed: the window left the front during the run, so its frames are not the reply's`);
  try {
    await expect.poll(async () => (await stampsOf(page)).paintAt, { timeout: PAINT_MS, message: `flag-${arm}: the first assistant row painted` }).not.toBeNull();
  } catch (error) {
    throw (await stampsOf(page)).leftFront ? leftFront : error;
  }
  if ((await stampsOf(page)).leftFront) throw leftFront;
  await expect.poll(async () => {
    const status = await invoke(page, 'session.status', { appSessionId: id as never });
    return status.ok ? `${status.value.process}/${status.value.turn === null ? 'idle' : 'turn'}` : status.error.code;
  }, { timeout: TURN_MS, message: `flag-${arm}: the turn ended` }).toBe('ready/idle');
  launched.verify?.();
  const stamps = await stampsOf(page);
  const run: PrestartRun = {
    arm, pair,
    keyToSendMs: stamps.sendAt! - stamps.firstKeyAt!,
    sendToPaintMs: stamps.paintAt! - stamps.sendAt!,
    starts: startsFile === null ? null : startsAroundSend(startedEngines(startsFile), sendWallAt),
    adopted: adoptedPrestart(maws.userData, id),
    error: null,
  };
  value(await invoke(page, 'session.stop', { appSessionId: id as never, reason: 'stop' }));
  return run;
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

// The measure: every pair's two runs, then the record (test-results/<group>.json), the one line in the log and as an
// annotation; answers the judgement and the runs' failures for the spec's assertions.
export async function measurePrestart(opts: MeasureOptions): Promise<{ judged: PrestartJudgement; failures: string[] }> {
  const load = machineLoad().load;
  const runs: PrestartRun[] = [];
  const roots: string[] = [];
  const open = (text: string) => publicText(text, { scratch: roots, checkout: REPO_ROOT, home: homedir() });
  let stopped: string | null = null;
  series: for (let pair = 0; pair < PRESTART_BENCH.pairs; pair += 1) {
    for (const arm of armsOfPair(pair)) {
      const root = realpathSync(mkdtempSync(join(tmpdir(), 'maws-pre-')));
      roots.push(root);
      let launched: ArmLaunch | null = null;
      let run: PrestartRun;
      try {
        launched = await opts.launch(arm, root);
        run = await oneRun(arm, pair, launched);
      } catch (error) {
        run = { arm, pair, keyToSendMs: Number.NaN, sendToPaintMs: null, starts: null, adopted: false, error: message(error) };
      }
      // the teardown is the run's: a survivor of the profile or a keychain prompt at its cleanup fails it
      try {
        await launched?.maws.cleanup();
      } catch (error) {
        run = { ...run, error: `${run.error === null ? '' : `${run.error}; then `}its teardown failed: ${message(error)}` };
      }
      try {
        await killScratchProcesses(root, []);
      } catch (error) {
        stopped = `the scratch processes of pair ${pair}'s flag-${arm} run could not be cleared, and would skew every later sample: ${message(error)}`;
      }
      rmSync(root, { recursive: true, force: true });
      if (run.error !== null) run = { ...run, error: open(run.error) };
      runs.push(run);
      console.log(`[${opts.group}] pair ${pair} flag-${arm}: key to Send ${Math.round(run.keyToSendMs)} ms, Send to first row ${run.sendToPaintMs === null ? 'none' : `${Math.round(run.sendToPaintMs)} ms`}, starts ${run.starts === null ? 'not counted' : `${run.starts.beforeSend} before Send and ${run.starts.afterSend} after`}, adopted ${run.adopted}${run.error === null ? '' : `; failed: ${run.error.split('\n')[0]}`}`);
      if (stopped !== null) {
        stopped = open(stopped);
        console.log(`[${opts.group}] the series stopped: ${stopped}`);
        break series;
      }
    }
  }
  const judged = judgePrestartRuns(runs, { boundMs: opts.boundMs, counts: opts.counts, stopped });
  const line = prestartLine(opts.group, judged, { boundMs: opts.boundMs, load });
  const info = test.info();
  mkdirSync(info.project.outputDir, { recursive: true });
  writeFileSync(join(info.project.outputDir, `${opts.group}.json`), `${JSON.stringify({
    line, valid: judged.reasons.length === 0, reasons: judged.reasons, stopped, sha: process.env.GITHUB_SHA ?? null, runId: process.env.GITHUB_RUN_ID ?? null, load,
    engine: opts.engine, bench: PRESTART_BENCH,
    medians: judged.medians, gainMs: judged.gainMs, met: judged.met,
    notCounted: judged.excluded.map((e) => ({ arm: e.run.arm, pair: e.run.pair, reason: e.reason })),
    runs,
  }, null, 2)}\n`);
  console.log(line);
  info.annotations.push({ type: opts.group, description: line });
  const failures = [...(stopped === null ? [] : [`the series stopped: ${stopped}`]), ...runs.flatMap((run) => (run.error === null ? [] : [`pair ${run.pair} flag-${run.arm}: ${run.error}`]))];
  return { judged, failures };
}
