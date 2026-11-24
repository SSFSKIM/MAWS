// The prestart measure's runs (ticket 851, M5; docs/doperpowers/plans/2026-11-24-prestart-engine.md, D14), shared by
// e2e/prestart-latency.spec.ts (the bound, on the latency stub) and e2e/prestart-engine.spec.ts (the acceptance, on the
// pinned engine). The numbers are test/support/prestart-latency.ts's.
//
// Paired flag-off and flag-on runs in alternating order (ABBA), each one New chat on a fresh launch of its own over a
// fresh profile, so neither arm inherits the other's engine host or warm caches. A run, in the page:
//   - the first `keydown` in the composer (a real key press, Playwright's keyboard through the page's input pipeline);
//   - 3 s of typing from it, then Enter, whose `keydown` is the Send press;
//   - the first assistant row painted: a MutationObserver finds the first marker of the reply in the main region (the
//     stub's `⟦t<turn>:<k>⟧`, the stand-in's reply carries one too), schedules a requestAnimationFrame callback that
//     posts one message on a MessageChannel, and the message's arrival (after that frame's style, layout and paint
//     steps) is the paint's time, as e2e/local-latency.spec.ts reads a delta's frame.
// Every stamp is the page's own clock, so no clock is compared across processes. Then the turn is let end, and the run
// reads how many engine processes started (the stub's starts file, where there is one) and whether Send took the
// prestart (the journal). A run that fails is recorded with its error and the measure goes on; the judgement then says
// the run painted nothing.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { MARKER_SOURCE } from '../../test/support/latency-engine';
import { machineLoad } from '../../test/support/latency-budget';
import { armsOfPair, judgePrestartRuns, PRESTART_BENCH, prestartLine, type PrestartArm, type PrestartJudgement, type PrestartRun } from '../../test/support/prestart-latency';
import { invoke, value } from './c7-replay';
import type { MawsLaunch } from './launch';
import { killScratchProcesses } from './processes';
import { adoptedPrestart, composer, newChatTab, startedEngines } from './prestart';

// What a run types: plain words, no marker, long enough for 3 s at the pace below.
const PROMPT = 'Please read this folder and tell me in two lines what it holds and which file to open first';
const KEY_GAP_MS = 70; // between key presses, a quick typist's pace
const TYPE_UNTIL_MS = 2_600; // then the run waits for the 3 s mark in the page and presses Enter
const PAINT_MS = 60_000;
const TURN_MS = 60_000;

type Stamps = { firstKeyAt: number | null; sendAt: number | null; paintAt: number | null };

// The page's stamps, installed once the New chat's composer is in front, before the first key press.
async function installStamps(page: Page): Promise<void> {
  await page.evaluate((source) => {
    const main = document.querySelector('[data-region="main"]');
    if (!main) throw new Error('no main region');
    const stamps: Stamps = { firstKeyAt: null, sendAt: null, paintAt: null };
    (window as unknown as { __prestartStamps: Stamps }).__prestartStamps = stamps;
    const inComposer = (target: EventTarget | null) => target instanceof Element && main.contains(target) && target.closest('[contenteditable="true"]') !== null;
    document.addEventListener('keydown', (event) => {
      if (!inComposer(event.target)) return;
      const at = performance.now();
      if (stamps.firstKeyAt === null) stamps.firstKeyAt = at;
      else if (stamps.sendAt === null && event.key === 'Enter' && !event.shiftKey && !event.isComposing) stamps.sendAt = at;
    }, { capture: true });
    const pattern = new RegExp(source);
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      if (stamps.paintAt === null) stamps.paintAt = performance.now();
    };
    let seen = false;
    new MutationObserver((records) => {
      if (seen || stamps.sendAt === null) return;
      for (const record of records) {
        const node = record.type === 'characterData' ? record.target.parentNode : record.target;
        if (!node || !main.contains(node) || !pattern.test(node.textContent ?? '')) continue;
        seen = true;
        requestAnimationFrame(() => channel.port2.postMessage('painted'));
        return;
      }
    }).observe(main, { childList: true, characterData: true, subtree: true });
  }, MARKER_SOURCE);
}
const stampsOf = (page: Page): Promise<Stamps> => page.evaluate(() => (window as unknown as { __prestartStamps: Stamps }).__prestartStamps);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));

// 3 s of typing from the first key press, by the page's clock, then Enter.
async function typeThenSend(page: Page): Promise<void> {
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
  await page.keyboard.press('Enter');
}

export interface ArmLaunch {
  maws: MawsLaunch;
  directory: string; // the project's folder the New chat starts in
  startsFile: string | null; // the stub's, or null for an engine that counts none
}

export interface MeasureOptions {
  group: 'prestart-latency' | 'prestart-engine';
  // a fresh launch for one run, its scratch under `root` (removed after the run)
  launch(arm: PrestartArm, root: string): Promise<ArmLaunch>;
  boundMs: number | null;
  counts: boolean; // the engine counts its starts (the stub): a flag-on run must have started one engine for its Send
  engine: Record<string, unknown>; // what the measure ran on, for its record
}

type RecordedRun = PrestartRun & { error: string | null };

async function oneRun(arm: PrestartArm, pair: number, launched: ArmLaunch): Promise<RecordedRun> {
  const { maws, directory, startsFile } = launched;
  const { page } = maws;
  const { id } = await newChatTab(page, directory);
  await page.mouse.move(700, 20); // no hover card over the transcript
  await installStamps(page);
  await typeThenSend(page);
  await expect.poll(async () => (await stampsOf(page)).paintAt, { timeout: PAINT_MS, message: `flag-${arm}: the first assistant row painted` }).not.toBeNull();
  await expect.poll(async () => {
    const status = await invoke(page, 'session.status', { appSessionId: id as never });
    return status.ok ? `${status.value.process}/${status.value.turn === null ? 'idle' : 'turn'}` : status.error.code;
  }, { timeout: TURN_MS, message: `flag-${arm}: the turn ended` }).toBe('ready/idle');
  const stamps = await stampsOf(page);
  const run: RecordedRun = {
    arm, pair,
    keyToSendMs: stamps.sendAt! - stamps.firstKeyAt!,
    sendToPaintMs: stamps.paintAt! - stamps.sendAt!,
    starts: startsFile === null ? null : startedEngines(startsFile).length,
    adopted: adoptedPrestart(maws.userData, id),
    error: null,
  };
  value(await invoke(page, 'session.stop', { appSessionId: id as never, reason: 'stop' }));
  return run;
}

// The measure: every pair's two runs, then the record (test-results/<group>.json), the one line in the log and as an
// annotation; answers the judgement and the runs' failures for the spec's assertions.
export async function measurePrestart(opts: MeasureOptions): Promise<{ judged: PrestartJudgement; failures: string[] }> {
  const load = machineLoad().load;
  const runs: RecordedRun[] = [];
  for (let pair = 0; pair < PRESTART_BENCH.pairs; pair += 1) {
    for (const arm of armsOfPair(pair)) {
      const root = realpathSync(mkdtempSync(join(tmpdir(), 'maws-pre-')));
      let launched: ArmLaunch | null = null;
      try {
        launched = await opts.launch(arm, root);
        runs.push(await oneRun(arm, pair, launched));
      } catch (error) {
        runs.push({ arm, pair, keyToSendMs: Number.NaN, sendToPaintMs: null, starts: null, adopted: false, error: error instanceof Error ? error.message : String(error) });
      } finally {
        await launched?.maws.cleanup().catch((error: unknown) => console.error(error));
        await killScratchProcesses(root, []).catch((error: unknown) => console.error(error));
        rmSync(root, { recursive: true, force: true });
      }
      const last = runs.at(-1)!;
      console.log(`[${opts.group}] pair ${pair} flag-${arm}: key to Send ${Math.round(last.keyToSendMs)} ms, Send to first row ${last.sendToPaintMs === null ? 'none' : `${Math.round(last.sendToPaintMs)} ms`}, starts ${last.starts ?? 'not counted'}, adopted ${last.adopted}${last.error === null ? '' : `; failed: ${last.error.split('\n')[0]}`}`);
    }
  }
  const judged = judgePrestartRuns(runs, { boundMs: opts.boundMs, counts: opts.counts });
  const line = prestartLine(opts.group, judged, { boundMs: opts.boundMs, load });
  const info = test.info();
  mkdirSync(info.project.outputDir, { recursive: true });
  writeFileSync(join(info.project.outputDir, `${opts.group}.json`), `${JSON.stringify({
    line, valid: judged.reasons.length === 0, reasons: judged.reasons, sha: process.env.GITHUB_SHA ?? null, runId: process.env.GITHUB_RUN_ID ?? null, load,
    engine: opts.engine, bench: PRESTART_BENCH,
    medians: judged.medians, gainMs: judged.gainMs, met: judged.met,
    notCounted: judged.excluded.map((e) => ({ arm: e.run.arm, pair: e.run.pair, reason: e.reason })),
    runs,
  }, null, 2)}\n`);
  console.log(line);
  info.annotations.push({ type: opts.group, description: line });
  return { judged, failures: runs.flatMap((run) => (run.error === null ? [] : [`pair ${run.pair} flag-${run.arm}: ${run.error}`])) };
}
