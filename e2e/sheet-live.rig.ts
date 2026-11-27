// The question sheet's live check (docs/doperpowers/plans/2026-11-23-question-sheet-c3-maws-app.md, M6, its Concrete
// Steps 1 to 8, S17): the composite's G2 seen with a real terminal session, a real model and the real `sminos`, in the
// app built from this checkout. A driver, not a test of any group: this file is not a *.spec.ts, so no e2e group, the
// bare `pnpm e2e` and default's derivation never collect it; its own config, e2e/sheet-live.config.ts, is the whole
// selection. It spends model calls (a handful of short turns), so it runs on demand only, on a Mac whose console session
// is logged in (it opens app windows), under the load rule, with tmux, python3 (3.10 or later) and the model gateway's
// variables in its environment:
//
//   pnpm install && scripts/e2e-build.sh plain
//   SHEET_LIVE_DOPERPOWERS=<a doperpowers checkout at C2's merge> SHEET_LIVE_OUT=<a directory outside the repository> \
//   [SHEET_LIVE_CLAUDE=<the terminal's claude, else the one on PATH>] [SHEET_LIVE_MODEL=haiku] [SHEET_LIVE_KEEP=1] \
//   ANTHROPIC_BASE_URL=… ANTHROPIC_AUTH_TOKEN=… \
//     pnpm exec playwright test --config e2e/sheet-live.config.ts
//
// The terminal is set up as C2's live check sets its sessions up (e2e/support/sheet-live.ts): scratch homes under /tmp,
// the checkout's plugin by --plugin-dir, function hooks and SMINOS_QUESTION_SHEET on, C2's stand-in surface running; the
// app shares the scratch config directory and sminos home, with MAWS_SMINOS_CLI naming the checkout's `sminos` (step 8:
// test/support/sminos-barrier.sh in front of it). Each step asserts what the record says (state.json, inbox.jsonl,
// `sheet show --json`) and what the window shows, and leaves under SHEET_LIVE_OUT one picture (`<n>-<what>.png`), the
// terminal's pane, the record as it stood, and a line of steps.jsonl; the session's transcript is kept under
// SHEET_LIVE_OUT/transcript. Everything the run started is stopped at its end, and its scratch removed.
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { SHEET_WORDS } from '../src/renderer/src/sheet/copy';
import { SHEET_ROW } from '../src/renderer/src/transcript/model/copy';
import { questionSentence } from '../src/shared/sheet/words';
import { launchMaws, REPO_ROOT, type MawsLaunch } from './support/launch';
import { asTheRigDraws, cardOf, closeNotices, needsYouRow, openLookSession, openSheetAt, rowHeads, rowLines, sheetRows, sheetTool } from './support/sheet-look';
import { sidebarRow } from './support/sidebar';
import {
  README, alive, envelopes, hasRecord, idle, inboxLines, keepRecord, keepTranscript, liveConfig, recordState, removeScratch, repliesAfter, sheetCalls, show, startSurface, stopSurface, Terminals,
  transcriptRows, until, writeScratch, type Scratch,
} from './support/sheet-live';

const TURN_MS = 240_000; // one model turn, a call of the tool and what follows it
const BARRIER = join(REPO_ROOT, 'test/support/sminos-barrier.sh');

// What the agent is asked (the plan's step 2, with C2's live check's preface so its reply to a delivery can be matched)
const REPEAT = 'When answers from the human’s question sheet reach you later, reply by repeating each one: its question id, the option picked, and the human’s text word for word. Do not read any file an answer points to. ';
const ASK_THREE = 'Put three questions to me on your sheet in one call: one with two options and a recommendation, one that references README.md, one with no options. Then keep working: list this directory.';
const ASK_TWO = 'Put two more questions to me on your sheet in one call, each with two options. Do nothing else.';
const WITHDRAW = (id: string) => `Withdraw ${id} from your sheet: you no longer need it. Do nothing else.`;
const ASK_ONE = 'Put one more question to me on your sheet: one with two options. Do nothing else.';
// What the person types
const TYPED = { picked: 'Only for the beta, please.', reference: 'Keep the README as it is.', open: 'Start with the North Quay route.', later: 'After the timetable import lands.' };

test.use({ trace: 'off', screenshot: 'off', video: 'off' });

test('the question sheet live: a terminal session asks on its sheet and is answered in MAWS (G2.a to G2.g)', async () => {
  test.setTimeout(35 * 60_000);
  const cfg = liveConfig();
  mkdirSync(cfg.out, { recursive: true });
  const log = (step: string, evidence: Record<string, unknown>) => appendFileSync(join(cfg.out, 'steps.jsonl'), `${JSON.stringify({ at: new Date().toISOString(), step, ...evidence })}\n`);
  const s = writeScratch(cfg);
  const terminals = new Terminals(cfg, s);
  const surface = await startSurface(cfg, s);
  let maws: MawsLaunch | null = null;
  let sid = '';
  let mainPid = 0;
  const picture = async (page: Page, name: string) => page.screenshot({ path: join(cfg.out, `${name}.png`), animations: 'disabled', caret: 'hide' });
  const keep = (name: string, pane: string) => {
    writeFileSync(join(cfg.out, `${name}-pane.txt`), terminals.pane(pane));
    if (sid !== '' && hasRecord(s, sid)) keepRecord(s, sid, join(cfg.out, `${name}-record`));
  };
  const step = async (name: string, body: () => Promise<Record<string, unknown>>) => {
    try {
      const evidence = await test.step(name, body);
      log(name, { ok: true, ...evidence });
    } catch (error) {
      log(name, { ok: false, error: String(error).slice(0, 4_000) });
      for (const page of maws?.app.windows() ?? []) await picture(page, `${name}-FAILED-${maws!.app.windows().indexOf(page)}`).catch(() => undefined);
      keep(`${name}-FAILED`, pane);
      throw error;
    }
  };
  let pane = 'main';
  try {
    // ---- 1. the setup: the app first, then the terminal --------------------------------------------------------------
    await step('1-setup', async () => {
      maws = await launchApp(s, { MAWS_SMINOS_CLI: s.sminos });
      ({ sid, pid: mainPid } = await terminals.open('main'));
      await picture(maws.page, '1-setup');
      keep('1-setup', pane);
      return { session: sid, terminalClaude: versionOf(cfg.claude), appEngine: appEngine() };
    });
    const app = () => maws!;
    const page = () => app().page;
    const sideBefore = await sideTabs(page());

    // ---- 2. three questions in one call; the record exists before anything of the app is read -----------------------
    let three: ReturnType<typeof sheetCalls>[number] | undefined;
    await step('2-three-asked', async () => {
      await terminals.say(pane, REPEAT + ASK_THREE);
      three = await until('the call of three', TURN_MS, () => sheetCalls(transcriptRows(s, sid)).find((c) => (c.input.ask?.length ?? 0) === 3 && c.result !== null), () => terminals.pane(pane));
      expect(hasRecord(s, sid), 'the session’s record: without it the session ran today’s tool').toBe(true);
      await until('the band’s line', 30_000, () => terminals.pane(pane).includes('3 open questions'), () => terminals.pane(pane));
      await idle(s, sid);
      keep('2-three-asked', pane);
      return { result: three!.result, open: show(s, sid).open.map((q) => q.id) };
    });
    const ids = recordState(s, sid).questions.map((q) => q.id);
    const byId = new Map(recordState(s, sid).questions.map((q) => [q.id, q]));

    // ---- 3. nothing opens; the session reads Question waiting; its row has three lines --------------------------------
    let appId = '';
    await step('3-row-lines', async () => {
      appId = await appIdOf(page(), sid);
      expect(await sideTabs(page()), 'the side column as it was').toEqual(sideBefore);
      await expect(sheetTool(page()), 'nothing opened by itself').toHaveCount(0);
      expect(await holderOf(page(), appId), 'held by its terminal, not stopped').toBe('terminal');
      await expect((await sidebarRow(page(), { appSessionId: appId })).getByRole('img', { name: 'Question waiting' }), 'the row reads Question waiting').toBeVisible({ timeout: 15_000 });
      await openLookSession(page(), appId);
      await expect(sheetTool(page()), 'opening the session opened no sheet').toHaveCount(0);
      const row = sheetRows(page()).first();
      await expect.poll(() => rowLines(row), { timeout: 15_000, message: 'one line per question, each with Open' }).toEqual(ids.map((id) => [id, byId.get(id)!.header ?? '', questionSentence(byId.get(id)!.question), SHEET_ROW.open].filter((cell) => cell !== '').join(' | ')));
      await picture(page(), '3-row-lines');
      keep('3-row-lines', pane);
      return { heads: await rowHeads(page()), lines: await rowLines(row) };
    });

    // ---- 4. Open on the question that references README.md: the sheet at its card, the file as captured -------------
    const referencing = ids.find((id) => (byId.get(id)!.references ?? []).some((r) => r.path.endsWith('README.md')));
    await step('4-open-at', async () => {
      expect(referencing, 'a question references README.md').toBeDefined();
      await sheetRows(page()).first().getByRole('button', { name: SHEET_ROW.openName(referencing!), exact: true }).click();
      await expect(cardOf(page(), referencing!), `the keyboard on ${referencing}’s card`).toBeFocused({ timeout: 10_000 });
      await expect(cardOf(page(), referencing!)).toHaveAttribute('data-focus-ring', '');
      const reference = cardOf(page(), referencing!).locator('[data-sheet-reference] button[aria-expanded]').first();
      if ((await reference.getAttribute('aria-expanded')) !== 'true') await reference.click();
      const body = cardOf(page(), referencing!).locator('[data-reference-body="text"]');
      await expect(body, 'README.md as captured').toContainText(README.split('\n')[2]!, { timeout: 10_000 });
      await picture(page(), '4-open-at');
      return { card: referencing, captured: (await body.innerText()).slice(0, 400) };
    });

    // ---- 5. all three answered, one with a pick and typed text, one Send; the agent has them together -------------
    await step('5-one-send', async () => {
      const typed: Record<string, string> = {};
      const picked: Record<string, string> = {};
      for (const id of ids) {
        const q = byId.get(id)!;
        const card = cardOf(page(), id);
        if ((q.options ?? []).length > 0) {
          picked[id] = q.options![0]!.label;
          await card.getByRole('radio', { name: picked[id], exact: true }).click();
        }
        const text = id === referencing ? TYPED.reference : (q.options ?? []).length > 0 ? (Object.keys(typed).length === 0 ? TYPED.picked : null) : TYPED.open;
        if (text !== null) {
          typed[id] = text;
          await sheetTool(page()).getByRole('textbox', { name: SHEET_WORDS.answerName(id), exact: true }).fill(text);
        }
      }
      expect(Object.keys(picked).some((id) => typed[id] !== undefined), 'one answer is a pick with typed text').toBe(true);
      const before = transcriptRows(s, sid).length;
      await sheetTool(page()).getByRole('button', { name: SHEET_WORDS.send(ids.length), exact: true }).click();
      const answers = await until('three answer lines, one call of the door', 30_000, () => {
        const lines = inboxLines(s, sid).filter((l) => l.kind === 'answer');
        return lines.length === ids.length ? lines : null;
      });
      expect(new Set(answers.map((l) => l.batch)).size, 'one batch').toBe(1);
      const keys = answers.map((l) => String(l.key));
      await until('the three delivered', TURN_MS, () => ids.every((id) => recordState(s, sid).closed[id]?.deliveredAt !== undefined));
      const carrying = await until('one envelope carrying all three', TURN_MS, () => envelopes(transcriptRows(s, sid)).find((e) => e.blocks.some((b) => keys.every((k) => b.keys.includes(k)))));
      await idle(s, sid);
      const reply = repliesAfter(transcriptRows(s, sid), carrying.index);
      for (const text of Object.values(typed)) expect(reply, 'the agent quotes the typed text').toContain(text);
      const first = ids[0]!;
      const receiptOf = (id: string) => `${id} | ${byId.get(id)!.header} | ${SHEET_ROW.arrow} `;
      await expect.poll(() => rowLines(sheetRows(page()).first()), { timeout: 15_000, message: 'each line is its receipt' }).toEqual(ids.map((id) => expect.stringContaining(receiptOf(id)) as unknown as string));
      if (picked[first] !== undefined) expect((await rowLines(sheetRows(page()).first()))[0]).toContain(`${receiptOf(first)}${picked[first]}`);
      await expect(sheetTool(page()).locator('article[data-sheet-question]'), 'the cards are gone').toHaveCount(0, { timeout: 15_000 });
      await picture(page(), '5-one-send');
      keep('5-one-send', pane);
      return { keys, batch: answers[0]!.batch, envelope: carrying.kind, deliveredWith: carrying.blocks, transcriptRowsBefore: before, reply: reply.slice(0, 1_200), receipts: await rowLines(sheetRows(page()).first()) };
    });

    // ---- 6. two more, then the first withdrawn: its card goes and its line reads Withdrawn ------------------------
    let later = '';
    await step('6-withdrawn', async () => {
      const calls = sheetCalls(transcriptRows(s, sid)).length;
      await terminals.say(pane, ASK_TWO);
      const two = await until('the call of two', TURN_MS, () => sheetCalls(transcriptRows(s, sid)).slice(calls).find((c) => (c.input.ask?.length ?? 0) === 2 && c.result !== null), () => terminals.pane(pane));
      await idle(s, sid);
      const [gone, kept] = recordState(s, sid).questions.map((q) => q.id).filter((id) => !ids.includes(id));
      later = kept!;
      await expect(cardOf(page(), gone!), `${gone}’s card, before`).toBeVisible({ timeout: 15_000 });
      await terminals.say(pane, WITHDRAW(gone!));
      const withdrawal = await until('the withdrawal', TURN_MS, () => sheetCalls(transcriptRows(s, sid)).slice(calls + 1).find((c) => (c.input.withdraw ?? []).includes(gone!) && c.result !== null), () => terminals.pane(pane));
      expect(recordState(s, sid).closed[gone!]?.how, 'the record: withdrawn').toBe('withdrawn');
      await expect(cardOf(page(), gone!), 'its card disappears').toHaveCount(0, { timeout: 15_000 });
      await expect.poll(async () => (await rowLines(sheetRows(page()).nth(1)))[0], { timeout: 15_000, message: 'its line reads Withdrawn' }).toContain(`${gone} | `);
      expect((await rowLines(sheetRows(page()).nth(1)))[0]).toMatch(new RegExp(`${SHEET_ROW.arrow} ${SHEET_ROW.withdrawn}$`));
      await idle(s, sid);
      await picture(page(), '6-withdrawn');
      keep('6-withdrawn', pane);
      return { asked: two.result, withdrew: withdrawal.result, heads: await rowHeads(page()), lines: await rowLines(sheetRows(page()).nth(1)) };
    });

    // ---- 7. the terminal closed: the stopped session's question, answered queued, taken back, sent again, resumed ---
    await step('7-stopped', async () => {
      const asked = recordState(s, sid).questions.find((q) => q.id === later)!;
      const label = asked.options![0]!.label;
      terminals.close(pane);
      await until('the terminal’s process gone', 30_000, () => !alive(mainPid));
      await expect.poll(() => holderOf(page(), appId), { timeout: 20_000, message: 'stopped' }).not.toBe('terminal');
      await closeNotices(page());
      await openSheetAt(page(), later);
      const card = cardOf(page(), later);
      await expect(card, `the sheet at ${later}`).toBeFocused({ timeout: 10_000 });
      const send = async () => {
        await card.getByRole('radio', { name: label, exact: true }).click();
        await sheetTool(page()).getByRole('textbox', { name: SHEET_WORDS.answerName(later), exact: true }).fill(TYPED.later);
        await sheetTool(page()).getByRole('button', { name: SHEET_WORDS.send(1), exact: true }).click();
        await expect(card.getByText(SHEET_WORDS.queuedStopped, { exact: true }), 'queued while stopped').toBeVisible({ timeout: 15_000 });
        await expect(card.getByRole('button', { name: SHEET_WORDS.takeBack, exact: true })).toBeEnabled();
      };
      await send();
      await card.getByRole('button', { name: SHEET_WORDS.takeBack, exact: true }).scrollIntoViewIfNeeded();
      await picture(page(), '7a-queued-stopped');
      keep('7a-queued-stopped', pane);
      await card.getByRole('button', { name: SHEET_WORDS.takeBack, exact: true }).click();
      await expect(card.getByText(SHEET_WORDS.queuedStopped, { exact: true }), 'taken back').toHaveCount(0, { timeout: 15_000 });
      expect(show(s, sid).open.map((q) => q.id), 'open again').toContain(later);
      await send();
      const kinds = inboxLines(s, sid).slice(-3).map((l) => l.kind);
      expect(kinds, 'answer, retract, answer').toEqual(['answer', 'retract', 'answer']);
      const sentKey = String(inboxLines(s, sid).at(-1)!.key);
      const takenKey = String(inboxLines(s, sid).at(-3)!.key);
      pane = 'resumed';
      const resumed = await terminals.open(pane, ['--resume', sid]);
      expect(resumed.sid, 'the same session resumed').toBe(sid);
      await terminals.say(pane, 'Reply with only: ok.');
      await until(`${later}'s answer delivered`, TURN_MS, () => recordState(s, sid).closed[later]?.deliveredAt !== undefined, () => terminals.pane(pane));
      const carried = envelopes(transcriptRows(s, sid)).filter((e) => e.blocks.some((b) => b.keys.includes(sentKey)));
      expect(carried.length, 'the answer goes with the next prompt').toBeGreaterThan(0);
      expect(envelopes(transcriptRows(s, sid)).some((e) => e.blocks.some((b) => b.keys.includes(takenKey))), 'the one taken back never goes').toBe(false);
      await idle(s, sid);
      await expect.poll(async () => (await rowLines(sheetRows(page()).nth(1)))[1], { timeout: 15_000, message: 'the line is its receipt' }).toContain(`${later} | ${asked.header ?? ''}`);
      expect((await rowLines(sheetRows(page()).nth(1)))[1]).toContain(`${SHEET_ROW.arrow} ${label}`);
      await picture(page(), '7b-resumed-receipt');
      keep('7b-resumed-receipt', pane);
      return { question: later, sentKey, takenKey, envelope: carried[0]!.kind, lines: await rowLines(sheetRows(page()).nth(1)) };
    });

    // ---- 8. the app restarted behind the barrier; two windows answer one question; released, one is taken ----------
    await step('8-two-windows', async () => {
      await app().cleanup();
      const barrier = join(s.root, 'barrier');
      maws = await launchApp(s, { MAWS_SMINOS_CLI: BARRIER, SMINOS_REAL: s.sminos, SMINOS_BARRIER: barrier });
      const calls = sheetCalls(transcriptRows(s, sid)).length;
      await terminals.say(pane, ASK_ONE);
      const one = await until('the call of one', TURN_MS, () => sheetCalls(transcriptRows(s, sid)).slice(calls).find((c) => (c.input.ask?.length ?? 0) === 1 && c.result !== null), () => terminals.pane(pane));
      await idle(s, sid);
      const id = show(s, sid).open.map((q) => q.id).at(-1)!;
      const label = recordState(s, sid).questions.find((q) => q.id === id)!.options![0]!.label;
      const [second] = await Promise.all([app().app.waitForEvent('window'), app().app.evaluate(() => (globalThis as unknown as { __maws_documents: { openWindow(): number } }).__maws_documents.openWindow())]);
      await second.waitForLoadState('domcontentloaded');
      const sheets: Locator[] = [];
      for (const window of [page(), second]) {
        await (await needsYouRow(window, appId)).click({ timeout: 30_000 });
        await expect(cardOf(window, id)).toBeVisible({ timeout: 15_000 });
        await cardOf(window, id).getByRole('radio', { name: label, exact: true }).click();
        sheets.push(sheetTool(window));
      }
      const inboxBefore = inboxLines(s, sid).length;
      for (const sheet of sheets) await sheet.getByRole('button', { name: SHEET_WORDS.send(1), exact: true }).click();
      await until('both Sends at the barrier', 15_000, () => heldAtBarrier() === 2);
      expect(inboxLines(s, sid).length, 'neither appended while held').toBe(inboxBefore);
      await picture(page(), '8a-held-first');
      await picture(second, '8a-held-second');
      writeFileSync(barrier, '');
      const appended = await until('both lines appended', 30_000, () => {
        const lines = inboxLines(s, sid).slice(inboxBefore);
        return lines.length === 2 ? lines : null;
      });
      const [taken, late] = appended.map((l) => String(l.key));
      await until('the second refused as closed', 30_000, () => recordState(s, sid).verdicts[late!]?.verdict === 'closed');
      expect(recordState(s, sid).verdicts[late!]?.how, 'refused: already answered').toBe('answered');
      expect(recordState(s, sid).closed[id]?.key, 'the first appended is the answer').toBe(taken);
      const notes = async () => (await Promise.all(sheets.map((sheet) => sheet.locator('[data-sheet-note]').allTextContents()))).map((texts) => texts.join(' '));
      await expect.poll(async () => (await notes()).filter((text) => text.includes(SHEET_WORDS.notes.answered(id))).length, { timeout: 15_000, message: 'one window reads it was already answered' }).toBe(1);
      await until(`${id}'s answer delivered`, TURN_MS, () => recordState(s, sid).closed[id]?.deliveredAt !== undefined);
      await idle(s, sid);
      for (const sheet of sheets) await expect(sheet.locator(`article[data-sheet-question="${id}"]`), 'its card gone in both').toHaveCount(0, { timeout: 15_000 });
      await openLookSession(page(), appId);
      await picture(page(), '8b-released-first');
      await picture(second, '8b-released-second');
      keep('8-two-windows', pane);
      return { question: id, asked: one.result, taken, late, notes: await notes(), verdicts: { [taken!]: recordState(s, sid).verdicts[taken!], [late!]: recordState(s, sid).verdicts[late!] } };
    });
    expect(maws!.consoleErrors(), 'no console errors in the first window').toEqual([]);
  } finally {
    if (sid !== '') keepTranscript(s, sid, join(cfg.out, 'transcript'));
    terminals.closeAll();
    await stopSurface(surface);
    await (maws as MawsLaunch | null)?.cleanup().catch((error: unknown) => console.error('[sheet-live] the app’s cleanup', error));
    removeScratch(s, cfg.keep);
  }
});

/** The app, launched over the run's scratch config directory and sminos home, at the rig's size in its light theme. */
async function launchApp(s: Scratch, env: Record<string, string>): Promise<MawsLaunch> {
  const maws = await launchMaws({ env: { CLAUDE_CONFIG_DIR: s.config, SMINOS_HOME: s.sminosHome, ...env } });
  await asTheRigDraws(maws);
  return maws;
}

const invoke = (page: Page, name: string, input: unknown) => page.evaluate(([n, i]) => window.maws.invoke(n as never, i as never), [name, input] as const) as Promise<{ ok: boolean; value?: unknown; error?: { message: string } }>;

async function appIdOf(page: Page, sid: string): Promise<string> {
  let appId = '';
  await expect.poll(async () => {
    const list = await invoke(page, 'session.list', {});
    appId = (list.value as { sessions: { engineSessionId: string; appId: string }[] } | undefined)?.sessions.find((r) => r.engineSessionId === sid)?.appId ?? '';
    return appId;
  }, { timeout: 30_000, message: 'the session listed' }).not.toBe('');
  return appId;
}

async function holderOf(page: Page, appId: string): Promise<string | undefined> {
  const got = await invoke(page, 'session.get', { appSessionId: appId });
  return (got.value as { holder?: { kind: string } } | undefined)?.holder?.kind;
}

const sideTabs = (page: Page) => page.locator('[data-region="panel"] [data-side-strip] [role="tab"]').allTextContents();

/** The `sheet put`s waiting at the barrier: the barrier script's processes. */
function heldAtBarrier(): number {
  const ps = spawnSync('/bin/ps', ['-axo', 'command='], { encoding: 'utf8' }).stdout;
  return ps.split('\n').filter((line) => line.includes(BARRIER) && line.includes(' sheet put ')).length;
}

function versionOf(bin: string): string {
  return spawnSync(bin, ['--version'], { encoding: 'utf8' }).stdout.trim();
}

/** The engine the app pins (the version its compatibility table is tested at). */
function appEngine(): string {
  return spawnSync(process.execPath, ['-e', "process.stdout.write(require('fs').readFileSync(process.argv[1], 'utf8').match(/TESTED_ENGINE_VERSION = '([^']+)'/)[1])", join(REPO_ROOT, 'src/engine-host/engine-compat.ts')], { encoding: 'utf8' }).stdout;
}

