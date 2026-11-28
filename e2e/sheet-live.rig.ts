// The question sheet's live check (docs/doperpowers/plans/2026-11-23-question-sheet-c3-maws-app.md, M6, its Concrete
// Steps 1 to 8, S17): the composite's G2 seen with a real terminal session, a real model and the real `sminos`, in the
// app built from this checkout. A driver, not a test of any group: this file is not a *.spec.ts, so no e2e group, the
// bare `pnpm e2e` and default's derivation never collect it; its own config, e2e/sheet-live.config.ts, is the whole
// selection. It spends model calls (a handful of short turns), so it runs on demand only, on a Mac whose console session
// is logged in (it opens app windows), under the load rule, with tmux, python3 (3.10 or later) and the model gateway's
// variables in its environment:
//
//   pnpm install && scripts/e2e-build.sh plain
//   SHEET_LIVE_DOPERPOWERS=<a doperpowers checkout at C2's merge> SHEET_LIVE_OUT=<a new directory outside the repository> \
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
// SHEET_LIVE_OUT/transcript, scrubbed for the repository (test/support/transcript-scrub.ts; a name left in it fails the
// run). SHEET_LIVE_OUT must not exist yet and must lie outside the checkout. Everything the run started is stopped at
// its end and its scratch removed, whatever happened; a release that fails fails the run.
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { loadavg } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { SHEET_WORDS } from '../src/renderer/src/sheet/copy';
import { SHEET_ROW } from '../src/renderer/src/transcript/model/copy';
import { questionSentence } from '../src/shared/sheet/words';
import { launchMaws, REPO_ROOT, type MawsLaunch } from './support/launch';
import { asTheRigDraws, cardOf, closeNotices, needsYouRow, openLookSession, openSheetAt, rowHeads, rowLines, sheetRows, sheetTool } from './support/sheet-look';
import { sidebarRow } from './support/sidebar';
import {
  README, envelopes, hasRecord, idle, inboxLines, keepRecord, liveConfig, messagesAfter, recordState, recordTranscript, removeScratch, scratchRoot, processIdentity, sheetCalls, show, spawnSurface, stopSurface,
  surfaceRegistered, Terminals, transcriptRows, until, writeScratch, type LiveConfig, type Scratch, type TranscriptRow,
} from './support/sheet-live';

const TURN_MS = 240_000; // one model turn, a call of the tool and what follows it
const BARRIER = join(REPO_ROOT, 'test/support/sminos-barrier.sh');
const WAITING = 'Question waiting'; // the attention heading of a sheet question (ATTENTION_HEADINGS.async_input)

// What the agent is asked (the plan's step 2, with C2's live check's preface so its reply to a delivery can be matched)
const REPEAT = 'When answers from the human’s question sheet reach you later, reply by repeating each one: its question id, the option picked, and the human’s text word for word. Do not read any file an answer points to. ';
// the plan's words, with the reference named as the tool's field: a small model otherwise picks another file of the folder
const ASK_THREE = 'Put three questions to me on your sheet in one call: one with two options and a recommendation, one that references README.md (README.md in its references), one with no options. Then keep working: list this directory.';
const ASK_TWO = 'Put two more questions to me on your sheet in one call, each with two options. Do nothing else.';
const WITHDRAW = (id: string) => `Withdraw ${id} from your sheet: you no longer need it. Do nothing else.`;
const ASK_ONE = 'Put one more question to me on your sheet: one with two options. Do nothing else.';
// What the person types
// What the person types: a text of its own on every answer (a pick too), so a reply that leaves one out is seen
const TYPED = { picked: 'Only for the beta, please.', reference: 'Keep the README as it is.', open: 'Start with the North Quay route.', another: 'Keep both routes for now.', later: 'After the timetable import lands.' };

type Call = ReturnType<typeof sheetCalls>[number];
type Entry = { question: string; header?: string; options?: { label: string }[]; references?: { path: string }[] };
/** What a line names its question by: its header, or with none its sentence (the row's own rule, SheetRow.tsx). */
const named = (entry: Entry) => entry.header ?? questionSentence(entry.question);

test.use({ trace: 'off', screenshot: 'off', video: 'off' });

test('the question sheet live: a terminal session asks on its sheet and is answered in MAWS (G2.a to G2.g)', async () => {
  test.setTimeout(35 * 60_000);
  // Teardown: each resource's release registered as it is acquired, run in reverse whatever happened; a release that
  // fails fails the run, after the others have run.
  const releases: { what: string; run: () => unknown }[] = [];
  const own = (what: string, run: () => unknown) => releases.push({ what, run });
  let failure: unknown = null;
  let cfg: LiveConfig | null = null;
  let s: Scratch | null = null;
  let maws: MawsLaunch | null = null;
  let sid = '';
  const log = (step: string, evidence: Record<string, unknown>) => cfg && appendFileSync(join(cfg.out, 'steps.jsonl'), `${JSON.stringify({ at: new Date().toISOString(), step, ...evidence })}\n`);
  const admissionLoad = loadavg().map((n) => n.toFixed(2)); // sampled before anything of the run starts
  try {
    cfg = liveConfig();
    mkdirSync(cfg.out, { recursive: true });
    const config = cfg;
    const root = scratchRoot();
    own('the scratch root', () => removeScratch(root, config.keep));
    const scratch = (s = writeScratch(config, root));
    const terminals = new Terminals(config, scratch);
    own('the terminals', () => terminals.closeAll());
    const surface = spawnSurface(config, scratch);
    own('the stand-in surface', () => stopSurface(surface));
    await surfaceRegistered(scratch);
    const launch = async (env: Record<string, string>): Promise<MawsLaunch> => {
      const launched = await launchMaws({ env: { CLAUDE_CONFIG_DIR: scratch.config, SMINOS_HOME: scratch.sminosHome, ...env } });
      let closed: Promise<void> | null = null;
      const close = () => (closed ??= launched.cleanup());
      own('the app', close);
      await asTheRigDraws(launched);
      return { ...launched, cleanup: close };
    };

    let pane = 'main';
    // Evidence: never in the way of the step's own verdict or of the teardown
    const picture = (page: Page, name: string) => page.screenshot({ path: join(config.out, `${name}.png`), animations: 'disabled', caret: 'hide' }).then(() => undefined, (error: unknown) => console.error(`[sheet-live] picture ${name}`, error));
    const keep = (name: string) => {
      try {
        writeFileSync(join(config.out, `${name}-pane.txt`), terminals.pane(pane));
        if (sid !== '' && hasRecord(scratch, sid)) keepRecord(scratch, sid, join(config.out, `${name}-record`));
      } catch (error) {
        console.error(`[sheet-live] keeping ${name}`, error);
      }
    };
    const step = async (name: string, body: () => Promise<Record<string, unknown>>) => {
      try {
        log(name, { ok: true, ...(await test.step(name, body)) });
      } catch (error) {
        log(name, { ok: false, error: String(error).slice(0, 4_000) });
        const windows = maws?.app.windows() ?? [];
        for (const [n, page] of windows.entries()) await picture(page, `${name}-FAILED-${n}`);
        keep(`${name}-FAILED`);
        throw error;
      }
    };
    const rows = () => transcriptRows(scratch, sid);
    const state = () => recordState(scratch, sid);
    const callAfter = (count: number, what: string, match: (call: Call) => boolean) => until(what, TURN_MS, () => sheetCalls(rows()).slice(count).find((c) => c.result !== null && match(c)), () => terminals.pane(pane));
    /** The ids a call added, from its result's first line ("Added q1, q2, q3."), checked against the record's own. */
    const addedBy = (call: Call, n: number): string[] => {
      const ids = /^Added ((?:q\d+, )*q\d+)\./.exec(call.result ?? '')?.[1]?.split(', ') ?? [];
      expect(ids, `the call added exactly ${n} (its result: ${call.result})`).toHaveLength(n);
      expect(state().questions.filter((q) => q.callId === call.id).map((q) => q.id), 'the record’s questions of that call').toEqual(ids);
      return ids;
    };
    const page = () => maws!.page;
    /** A call's row: the transcript's sheet calls and the drawn sheet rows are in the same order. */
    const rowOf = async (call: Call) => {
      const calls = sheetCalls(rows());
      await expect(sheetRows(page()), 'a row for each call').toHaveCount(calls.length, { timeout: 15_000 });
      return sheetRows(page()).nth(calls.findIndex((c) => c.id === call.id));
    };

    // ---- 1. the setup: the app first, then the terminal --------------------------------------------------------------
    let mainPid = 0;
    let mainIdentity: string | null = null;
    await step('1-setup', async () => {
      maws = await launch({ MAWS_SMINOS_CLI: scratch.sminos });
      ({ sid, pid: mainPid } = await terminals.open(pane));
      mainIdentity = processIdentity(mainPid);
      await picture(page(), '1-setup');
      keep('1-setup');
      return { session: sid, admissionLoad, loadAfterLaunch: loadavg().map((n) => n.toFixed(2)), terminalClaude: versionOf(config.claude), appEngine: appEngine() };
    });
    const sideBefore = await sideStrip(page());

    // ---- 2. three questions in one call; the record exists before anything of the app is read -----------------------
    let three: Call | null = null;
    let ids: string[] = [];
    await step('2-three-asked', async () => {
      await terminals.say(pane, REPEAT + ASK_THREE);
      three = await callAfter(0, 'the call of three', (c) => (c.input.ask?.length ?? 0) === 3);
      expect(hasRecord(scratch, sid), 'the session’s record: without it the session ran today’s tool').toBe(true);
      ids = addedBy(three, 3);
      await until('the band’s line', 30_000, () => terminals.pane(pane).includes('3 open questions'), () => terminals.pane(pane));
      await idle(scratch, sid);
      keep('2-three-asked');
      return { result: three.result, ids };
    });
    const asked = new Map(ids.map((id, n) => [id, three!.input.ask![n] as Entry]));

    // ---- 3. nothing opens; the session reads Question waiting; its row has three lines --------------------------------
    let appId = '';
    await step('3-row-lines', async () => {
      appId = await appIdOf(page(), sid);
      expect(await sideStrip(page()), 'the side column’s tabs and its active tab as they were').toEqual(sideBefore);
      await expect(sheetTool(page()), 'nothing opened by itself').toHaveCount(0);
      expect(await holderOf(page(), appId), 'held by its terminal, not stopped').toBe('terminal');
      await expect((await sidebarRow(page(), { appSessionId: appId })).getByRole('img', { name: WAITING }), 'the sidebar row reads Question waiting').toBeVisible({ timeout: 15_000 });
      await openLookSession(page(), appId);
      await expect(page().locator('[data-chrome-tabs]').getByRole('img', { name: WAITING }).first(), 'the session’s tab reads Question waiting').toBeVisible({ timeout: 15_000 });
      expect((await sideStrip(page())).active.some((tab) => tab.startsWith(SHEET_WORDS.tab)), 'opening the session added or activated no Sheet tab').toBe(false);
      await expect(sheetTool(page()), 'opening the session opened no sheet').toHaveCount(0);
      const row = await rowOf(three!);
      await expect(row.locator('.transcript-run-label'), 'the call’s head line').toHaveText('Asked 3 questions');
      const expected = ids.map((id) => [id, asked.get(id)!.header ?? '', questionSentence(asked.get(id)!.question), SHEET_ROW.open].filter((cell) => cell !== '').join(' | '));
      await expect.poll(() => rowLines(row), { timeout: 15_000, message: 'one line per question of the call, each with Open' }).toEqual(expected);
      await picture(page(), '3-row-lines');
      keep('3-row-lines');
      return { heads: await rowHeads(page()), lines: await rowLines(row), tab: WAITING };
    });

    // ---- 4. Open on the question that references README.md: the sheet at its card, the file as captured -------------
    const referencing = ids.find((id) => (state().questions.find((q) => q.id === id)!.references ?? []).some((r) => r.path.endsWith('README.md')));
    await step('4-open-at', async () => {
      expect(referencing, 'a question references README.md').toBeDefined();
      await (await rowOf(three!)).getByRole('button', { name: SHEET_ROW.openName(referencing!), exact: true }).click();
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
      const typed = new Map<string, string>();
      const picked = new Map<string, { label: string; pick: number }>();
      for (const id of ids) {
        const options = asked.get(id)!.options ?? [];
        if (options.length > 0) {
          picked.set(id, { label: options[0]!.label, pick: 1 }); // a pick is the option's number, from 1
          await cardOf(page(), id).getByRole('radio', { name: options[0]!.label, exact: true }).click();
        }
        const text = id === referencing ? TYPED.reference : options.length === 0 ? TYPED.open : [...typed.values()].includes(TYPED.picked) ? TYPED.another : TYPED.picked;
        typed.set(id, text);
        await sheetTool(page()).getByRole('textbox', { name: SHEET_WORDS.answerName(id), exact: true }).fill(text);
      }
      expect([...picked.keys()].length, 'one answer at least is a pick with typed text').toBeGreaterThan(0);
      expect(new Set(typed.values()).size, 'every answer’s text its own').toBe(ids.length);
      const inboxBefore = inboxLines(scratch, sid).length;
      await sheetTool(page()).getByRole('button', { name: SHEET_WORDS.send(ids.length), exact: true }).click();
      const lines = await until('the Send’s inbox lines', 30_000, () => {
        const added = inboxLines(scratch, sid).slice(inboxBefore);
        return added.length >= ids.length ? added : null;
      });
      expect(lines.map((l) => [l.kind, l.id]), 'one answer line per question, nothing else').toEqual(ids.map((id) => ['answer', id]));
      const batch = lines[0]!.batch;
      expect(typeof batch === 'string' && batch !== '', 'the lines carry a batch').toBe(true);
      expect(lines.map((l) => l.batch), 'one batch: one call of the door').toEqual(ids.map(() => batch));
      const keys = lines.map((l) => String(l.key));
      await until('the three delivered', TURN_MS, () => ids.every((id) => state().closed[id]?.deliveredAt !== undefined));
      await idle(scratch, sid);
      const carrying = envelopes(rows()).flatMap((e) => e.blocks.filter((b) => b.keys.some((k) => keys.includes(k))).map((block) => ({ ...e, block })));
      expect(carrying, 'one delivery block carries the Send’s keys').toHaveLength(1);
      // the block pairs its keys and its answers by position (X3): each key with the answer its own line sent
      const { block } = carrying[0]!;
      expect(block.keys.map((key, n) => [key, block.answered[n]]), 'each key paired with its question, its pick and its text').toEqual(
        lines.map((line) => [String(line.key), { id: String(line.id), picks: picked.has(String(line.id)) ? [picked.get(String(line.id))!.pick] : [], text: typed.get(String(line.id))! }]),
      );
      const quoting = messagesAfter(rows(), carrying[0]!.index).filter((message) => [...typed.values()].every((text) => message.includes(text)));
      expect(quoting.length, 'one assistant message quotes all three answers').toBeGreaterThanOrEqual(1);
      for (const id of ids) {
        const answer = picked.has(id) ? picked.get(id)!.label : typed.get(id)!;
        await expect.poll(() => lineFor(page(), id), { timeout: 15_000, message: `${id}’s line is its receipt` }).toBe(`${id} | ${named(asked.get(id)!)} | ${SHEET_ROW.arrow} ${answer}`);
      }
      for (const id of ids) await expect(cardOf(page(), id), `${id}’s card is gone`).toHaveCount(0, { timeout: 15_000 });
      await picture(page(), '5-one-send');
      keep('5-one-send');
      return { keys, batch, envelope: carrying[0]!.kind, delivered: carrying[0]!.block, reply: quoting[0]!.slice(0, 1_200), receipts: await Promise.all(ids.map((id) => lineFor(page(), id))) };
    });

    // ---- 6. two more, then the first withdrawn: its card goes and its line reads Withdrawn ------------------------
    let later = '';
    await step('6-withdrawn', async () => {
      const count = sheetCalls(rows()).length;
      await terminals.say(pane, ASK_TWO);
      const two = await callAfter(count, 'the call of two', (c) => (c.input.ask?.length ?? 0) === 2);
      await idle(scratch, sid);
      const [gone, kept] = addedBy(two, 2);
      later = kept!;
      await expect(cardOf(page(), gone!), `${gone}’s card, before`).toBeVisible({ timeout: 15_000 });
      await terminals.say(pane, WITHDRAW(gone!));
      const withdrawal = await callAfter(count + 1, 'the withdrawal', (c) => (c.input.withdraw ?? []).includes(gone!));
      expect(withdrawal.result, 'the call withdrew it').toMatch(new RegExp(`^Withdrew ${gone}\\.`));
      expect(state().closed[gone!]?.how, 'the record: withdrawn').toBe('withdrawn');
      await expect(cardOf(page(), gone!), 'its card disappears').toHaveCount(0, { timeout: 15_000 });
      await expect.poll(() => lineFor(page(), gone!), { timeout: 15_000, message: 'its line reads Withdrawn' }).toBe(`${gone} | ${named(two.input.ask![0] as Entry)} | ${SHEET_ROW.arrow} ${SHEET_ROW.withdrawn}`);
      await idle(scratch, sid);
      await picture(page(), '6-withdrawn');
      keep('6-withdrawn');
      return { asked: two.result, withdrew: withdrawal.result, heads: await rowHeads(page()), lines: [await lineFor(page(), gone!), await lineFor(page(), kept!)] };
    });

    // ---- 7. the terminal closed: the stopped session's question, answered queued, taken back, sent again, resumed ---
    await step('7-stopped', async () => {
      const question = state().questions.find((q) => q.id === later)!;
      const label = question.options![0]!.label;
      terminals.close(pane);
      await until('the terminal’s process gone', 30_000, () => processIdentity(mainPid) !== mainIdentity);
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
      const inboxBefore = inboxLines(scratch, sid).length;
      await send();
      await card.getByRole('button', { name: SHEET_WORDS.takeBack, exact: true }).scrollIntoViewIfNeeded();
      await picture(page(), '7a-queued-stopped');
      keep('7a-queued-stopped');
      await card.getByRole('button', { name: SHEET_WORDS.takeBack, exact: true }).click();
      await expect(card.getByText(SHEET_WORDS.queuedStopped, { exact: true }), 'taken back').toHaveCount(0, { timeout: 15_000 });
      expect(show(scratch, sid).open.map((q) => q.id), 'open again').toContain(later);
      await send();
      const lines = inboxLines(scratch, sid).slice(inboxBefore);
      expect(lines.map((l) => l.kind), 'answer, retract, answer').toEqual(['answer', 'retract', 'answer']);
      const [takenBack, , sent] = lines.map((l) => String(l.key));
      expect(lines[1]!.target, 'the retract names the first answer').toBe(takenBack);
      const rowsBeforeResume = rows().length;
      pane = 'resumed';
      const resumed = await terminals.open(pane, ['--resume', sid]);
      expect(resumed.sid, 'the same session resumed').toBe(sid);
      await terminals.say(pane, 'Reply with only: ok.');
      await until(`${later}'s answer delivered`, TURN_MS, () => state().closed[later]?.deliveredAt !== undefined, () => terminals.pane(pane));
      await idle(scratch, sid);
      const prompt = rows().slice(rowsBeforeResume).find((row) => row.type === 'user' && row.promptSource === 'typed');
      expect(prompt, 'the first typed prompt after the resume').toBeDefined();
      const withPrompt = envelopes(rows()).flatMap((e) => e.blocks.filter((b) => b.keys.includes(sent!)).map(() => e));
      expect(withPrompt, 'one delivery block carries the answer').toHaveLength(1);
      expect(withPrompt[0]!.kind, 'carried in a prompt’s added context').toBe('prompt.submit');
      expect(promptOf(rows(), withPrompt[0]!.parent), 'that prompt the first typed after the resume').toBe(prompt!.uuid);
      expect(JSON.stringify(rows()).includes(takenBack!), 'the answer taken back appears nowhere in the transcript').toBe(false);
      await expect.poll(() => lineFor(page(), later), { timeout: 15_000, message: 'the line is its receipt' }).toBe(`${later} | ${named(question)} | ${SHEET_ROW.arrow} ${label}`);
      await picture(page(), '7b-resumed-receipt');
      keep('7b-resumed-receipt');
      return { question: later, sent, takenBack, envelope: withPrompt[0]!.kind, line: await lineFor(page(), later) };
    });

    // ---- 8. the app restarted behind the barrier; two windows answer one question; released, one is taken ----------
    await step('8-two-windows', async () => {
      await maws!.cleanup();
      const barrier = join(scratch.root, 'barrier');
      maws = await launch({ MAWS_SMINOS_CLI: BARRIER, SMINOS_REAL: scratch.sminos, SMINOS_BARRIER: barrier });
      const app = maws;
      appId = await appIdOf(page(), sid); // a new profile: the app's own id for the session is new
      const count = sheetCalls(rows()).length;
      await terminals.say(pane, ASK_ONE);
      const one = await callAfter(count, 'the call of one', (c) => (c.input.ask?.length ?? 0) === 1);
      await idle(scratch, sid);
      const [id] = addedBy(one, 1);
      const entry = one.input.ask![0] as Entry;
      const labels = entry.options!.slice(0, 2).map((option) => option.label); // window n picks option n
      expect(labels, 'two options to tell the windows apart').toHaveLength(2);
      const [second] = await Promise.all([app.app.waitForEvent('window'), app.app.evaluate(() => (globalThis as unknown as { __maws_documents: { openWindow(): number } }).__maws_documents.openWindow())]);
      await second.waitForLoadState('domcontentloaded');
      const windows = [page(), second];
      const sheets: Locator[] = [];
      for (const [n, window] of windows.entries()) {
        await (await needsYouRow(window, appId)).click({ timeout: 30_000 });
        await expect(cardOf(window, id!)).toBeVisible({ timeout: 15_000 });
        await cardOf(window, id!).getByRole('radio', { name: labels[n]!, exact: true }).click();
        sheets.push(sheetTool(window));
      }
      const inboxBefore = inboxLines(scratch, sid).length;
      for (const sheet of sheets) await sheet.getByRole('button', { name: SHEET_WORDS.send(1), exact: true }).click();
      const held = await until('both Sends held at this run’s barrier', 15_000, () => {
        const puts = heldPuts(app.userData, sid);
        return puts.length === 2 ? puts : null;
      });
      expect(inboxLines(scratch, sid).length, 'neither appended while held').toBe(inboxBefore);
      await picture(page(), '8a-held-first');
      await picture(second, '8a-held-second');
      writeFileSync(barrier, '');
      const appended = await until('both lines appended', 30_000, () => {
        const lines = inboxLines(scratch, sid).slice(inboxBefore);
        return lines.length >= 2 ? lines : null;
      });
      expect(appended.map((l) => [l.kind, l.id]), 'the two Sends’ lines, both answering the question').toEqual([['answer', id], ['answer', id]]);
      // each line's key to the window that sent it, by the pick it carries
      const keyOf = labels.map((label) => appended.find((l) => (l.picks as string[] | undefined)?.[0] === label)?.key);
      expect(keyOf.every((key) => typeof key === 'string') && keyOf[0] !== keyOf[1], 'one line from each window, under distinct keys').toBe(true);
      await until('both lines’ verdicts', 30_000, () => keyOf.every((key) => state().verdicts[String(key)] !== undefined));
      const verdicts = keyOf.map((key) => state().verdicts[String(key)]!);
      const winner = verdicts.findIndex((v) => v.verdict === 'applied');
      const loser = 1 - winner;
      expect(winner, 'one window’s answer applied').toBeGreaterThanOrEqual(0);
      expect(verdicts[winner], 'applied').toMatchObject({ verdict: 'applied', kind: 'answer', id });
      expect(verdicts[loser], 'the other closed: already answered').toMatchObject({ verdict: 'closed', kind: 'answer', id, how: 'answered' });
      const [taken, late] = [String(keyOf[winner]), String(keyOf[loser])];
      expect(state().closed[id!]?.key, 'the question closed by the winner').toBe(taken);
      // the losing window, known from its key, reads the refusal; the winning one reads none
      const refusal = sheetTool(windows[loser]!).locator(`[data-sheet-note="${late}"]`);
      await expect(refusal, 'the losing window reads that it was already answered').toBeVisible({ timeout: 15_000 });
      await expect(refusal).toContainText(SHEET_WORDS.notes.answered(id!));
      await expect(sheetTool(windows[winner]!).locator('[data-sheet-note]'), 'the winning window reads no refusal').toHaveCount(0);
      await until(`${id}'s answer delivered`, TURN_MS, () => state().closed[id!]?.deliveredAt !== undefined);
      await idle(scratch, sid);
      const winning = envelopes(rows()).flatMap((e) => e.blocks).filter((b) => b.keys.includes(taken));
      expect(winning.map((b) => b.answered.map((a) => [a.id, a.picks])), 'the winning answer delivered in the transcript, its own pick').toEqual([[[id, [winner + 1]]]]);
      expect(JSON.stringify(rows()).includes(late), 'the refused line never delivered').toBe(false);
      for (const sheet of sheets) await expect(sheet.locator(`article[data-sheet-question="${id}"]`), 'its card gone in both').toHaveCount(0, { timeout: 15_000 });
      await openLookSession(page(), appId);
      await expect.poll(() => lineFor(page(), id!), { timeout: 15_000, message: 'the winner’s receipt drawn' }).toBe(`${id} | ${named(entry)} | ${SHEET_ROW.arrow} ${labels[winner]}`);
      await picture(page(), '8b-released-first');
      await picture(second, '8b-released-second');
      keep('8-two-windows');
      return { question: id, asked: one.result, held: held.length, picks: labels, taken, late, winningWindow: winner + 1, verdicts: { [taken]: state().verdicts[taken], [late]: state().verdicts[late] } };
    });
    expect(maws!.consoleErrors(), 'no console errors in the first window').toEqual([]);
  } catch (error) {
    failure = error;
  } finally {
    // the recording first, while the scratch stands; a leak in it fails the run, after the teardown
    let recording: unknown = null;
    if (cfg && s && sid !== '') {
      try {
        recordTranscript(s, sid, join(cfg.out, 'transcript'));
      } catch (error) {
        recording = error;
      }
    }
    const failed: string[] = [];
    for (const { what, run } of releases.reverse()) {
      try {
        await run();
      } catch (error) {
        failed.push(`${what}: ${String(error)}`);
      }
    }
    log('teardown', { ok: failed.length === 0 && recording === null, failed, recording: recording === null ? null : String(recording) });
    if (failure === null && failed.length > 0) failure = new Error(`the teardown failed: ${failed.join('; ')}`);
    if (failure === null && recording !== null) failure = recording;
  }
  if (failure !== null) throw failure;
});

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

/** The prompt a row hangs from: up its parent chain, past the rows the engine writes between, to the nearest typed prompt. */
function promptOf(rows: TranscriptRow[], parent: string | null): string | null {
  const byUuid = new Map(rows.flatMap((row) => (row.uuid ? [[row.uuid, row] as const] : [])));
  for (let at = parent === null ? undefined : byUuid.get(parent); at; at = at.parentUuid ? byUuid.get(at.parentUuid) : undefined) {
    if (at.type === 'user' && at.promptSource === 'typed') return at.uuid ?? null;
    if (at.type === 'assistant') return null; // a turn of the model's stands between: not this prompt's context
  }
  return null;
}

/** The row line of question `id`, whichever call's row holds it (its cells joined as rowLines joins them), or ''. */
async function lineFor(page: Page, id: string): Promise<string> {
  for (const row of await sheetRows(page).all()) {
    const line = (await rowLines(row)).find((text) => text.startsWith(`${id} | `));
    if (line !== undefined) return line;
  }
  return '';
}

/** The side column's strip: its tabs' words and which is active. */
async function sideStrip(page: Page): Promise<{ tabs: string[]; active: string[] }> {
  const strip = page.locator('[data-region="panel"] [data-side-strip]');
  const tabs = await strip.locator('[role="tab"]').allTextContents();
  expect(tabs.some((tab) => tab.startsWith(SHEET_WORDS.tab)), 'no Sheet tab').toBe(false);
  return { tabs, active: await strip.locator('[role="tab"][aria-selected="true"]').allTextContents() };
}

/**
 * The `sheet put`s of this session waiting at the barrier in front of this launch's door: the barrier script's
 * processes for the session, descended from a process of this launch's profile (its mawsd).
 */
function heldPuts(userData: string, sid: string): number[] {
  const table = spawnSync('/bin/ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8' }).stdout.split('\n').flatMap((line) => {
    const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    return m ? [{ pid: Number(m[1]), ppid: Number(m[2]), command: m[3]! }] : [];
  });
  const byPid = new Map(table.map((p) => [p.pid, p]));
  const underProfile = (pid: number) => {
    for (let at = byPid.get(pid); at && at.pid > 1; at = byPid.get(at.ppid)) if (at.command.includes(userData)) return true;
    return false;
  };
  return table.filter((p) => p.command.includes(BARRIER) && p.command.includes(' sheet put ') && p.command.includes(`--session ${sid}`) && underProfile(p.pid)).map((p) => p.pid);
}

function versionOf(bin: string): string {
  return spawnSync(bin, ['--version'], { encoding: 'utf8' }).stdout.trim();
}

/** The engine the app pins (the version its compatibility table is tested at). */
function appEngine(): string {
  return spawnSync(process.execPath, ['-e', "process.stdout.write(require('fs').readFileSync(process.argv[1], 'utf8').match(/TESTED_ENGINE_VERSION = '([^']+)'/)[1])", join(REPO_ROOT, 'src/engine-host/engine-compat.ts')], { encoding: 'utf8' }).stdout;
}
