// M3 of the DC6 plan: DX8's `transcript` slot, mounted by DC5's direct channel where a fold of the working record is
// unfolded, against DC5's DX3 double and the recorded session's plane (`depth-player.ts`). Each fold draws only what
// lies strictly between its two exchange items: a row's unmarked text beside its bounding `<message>` span is drawn and
// the span is not; a fold bounded by a question leaves its call and its answer out; a live session's last fold draws
// the rows that arrive after its last item.
import type { Locator, Page } from '@playwright/test';
import type { JsonObject } from 'desk-hub/protocol';
import { DepthPlayer } from './depth-player';
import { expect, seedKey, test } from './fixtures';
import { PROJECT, S, stageProject } from './scene';
import type { HubDouble } from '../test/double/hub-double';
import { readRecording } from '../test/double/session-stream';

const recording = readRecording();
const ANSWER_ROW = recording.session.find((row) => JSON.stringify(row.message ?? {}).includes('<message>'))!;
const WRITER = `mini/${S.asks}`;
const at = (n: number) => `2026-10-15T11:3${n}:00.000Z`;
const base = { parentUuid: null, isSidechain: false, sessionId: S.asks };

// Rows ahead of the recorded ones: a prompt; a row with working-record text on each side of a `<message>` span; a
// question (its call and its answer); and working record after it.
const MARKED = 'fold-marked';
const ASK = 'toolu_fold_question';
const extraRows: JsonObject[] = [
  { ...base, type: 'user', uuid: 'fold-prompt', timestamp: at(0), message: { role: 'user', content: 'Pick a colour, then report.' } },
  {
    ...base,
    type: 'assistant',
    uuid: MARKED,
    timestamp: at(1),
    apiBlockIndex: 0,
    message: { id: 'msg_fold_1', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', content: [{ type: 'text', text: 'Unmarked before the note. <message>Marked for you.</message> Unmarked after the note.' }], stop_reason: null },
  },
  {
    ...base,
    type: 'assistant',
    uuid: 'fold-ask',
    timestamp: at(2),
    apiBlockIndex: 1,
    message: { id: 'msg_fold_1', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', content: [{ type: 'tool_use', id: ASK, name: 'AskUserQuestion', input: { questions: [{ question: 'Which colour?', header: 'Colour', options: [{ label: 'red' }, { label: 'blue' }], multiSelect: false }] } }], stop_reason: 'tool_use' },
  },
  { ...base, type: 'user', uuid: 'fold-answer', timestamp: at(3), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: ASK, content: 'The answer row: red' }] } },
  {
    ...base,
    type: 'assistant',
    uuid: 'fold-after',
    timestamp: at(4),
    apiBlockIndex: 0,
    message: { id: 'msg_fold_2', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', content: [{ type: 'text', text: 'Working after the question.' }], stop_reason: 'end_turn' },
  },
];

async function openChannel(page: Page, hub: HubDouble): Promise<{ player: DepthPlayer; folds: Locator }> {
  await stageProject(hub); // its own `message` for this session bounds the first folds (src `r1:0`, not in this transcript)
  await hub.append(PROJECT, { writer: WRITER, kind: 'message', from: 'maws-45', to: 'host', text: 'Marked for you.', src: `${MARKED}#0` });
  await hub.append(PROJECT, { writer: WRITER, kind: 'question', from: 'maws-45', to: 'host', text: ['Which colour?'], choices: ['red', 'blue'], src: ASK });
  await hub.append(PROJECT, { writer: WRITER, kind: 'message', from: 'maws-45', to: 'host', text: 'Both subagents reported back.', src: `${String(ANSWER_ROW.uuid)}#0` });
  const player = new DepthPlayer(hub, { project: PROJECT, machine: 'mini', session: S.asks, extraRows });
  // The snapshot holds every row through the recorded answer; what follows it arrives live.
  player.skip(player.script.findIndex((item) => item.kind === 'row' && item.body.row.uuid === ANSWER_ROW.uuid) + 1);
  await seedKey(page, hub);
  await page.goto(`${hub.url}/p/${PROJECT}/s/${S.asks}`);
  await expect(page.getByTestId('depth')).toHaveAttribute('data-session', S.asks);
  return { player, folds: page.getByTestId('working-record') };
}

/** Unfolds the n-th fold of the channel; its slot. */
async function unfold(page: Page, folds: Locator, n: number): Promise<Locator> {
  await folds.nth(n).click();
  const slot = page.getByTestId('fold-transcript').last();
  await expect(slot).toBeVisible();
  return slot;
}

let pageErrors: string[] = [];
test.beforeEach(({ page }) => {
  pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) pageErrors.push(message.text());
  });
});
test.afterEach(() => expect(pageErrors).toEqual([]));

// The channel's folds, in order: before `r1:0` (the scene's message), `r1:0` → the marked span, the span → the
// question, the question → the recorded answer, and the live one after it.
test("a row's unmarked text beside its bounding span is drawn, the span is not; a question's call and answer are left out", async ({ page, hub }) => {
  const { folds } = await openChannel(page, hub);
  await expect(folds).toHaveCount(5);

  const toSpan = await unfold(page, folds, 1);
  await expect(toSpan).toContainText('Unmarked before the note.');
  await expect(toSpan).toContainText('Pick a colour, then report.');
  await expect(toSpan).not.toContainText('Marked for you.');
  await expect(toSpan).not.toContainText('Unmarked after the note.');
  // Its start (`r1:0`) names no row of this transcript: drawn from the transcript's start, and said so.
  await expect(toSpan.getByTestId('fold-unresolved')).toHaveText('The start of this stretch is not in the transcript; it is drawn from the transcript’s start.');
  await folds.nth(1).click();

  const toQuestion = await unfold(page, folds, 2);
  await expect(toQuestion).toContainText('Unmarked after the note.');
  await expect(toQuestion).not.toContainText('Marked for you.');
  await expect(toQuestion).not.toContainText('Unmarked before the note.');
  await expect(toQuestion).not.toContainText('Which colour?');
  await expect(toQuestion.getByTestId('fold-unresolved')).toHaveCount(0);
  await folds.nth(2).click();

  const fromQuestion = await unfold(page, folds, 3);
  await expect(fromQuestion).toContainText('Working after the question.');
  await expect(fromQuestion).toContainText('Think briefly first'); // the recorded session's first prompt
  await expect(fromQuestion).not.toContainText('The answer row: red');
  await expect(fromQuestion).not.toContainText('Which colour?');
  await expect(fromQuestion).not.toContainText('Both subagents reported back.');
});

test("a live session's last fold draws the rows that arrive after its last item", async ({ page, hub }) => {
  const { player, folds } = await openChannel(page, hub);
  await expect(folds).toHaveCount(5);
  const last = await unfold(page, folds, 4);
  await expect.poll(() => player.subscriptions()).toBe(2); // the depth column's and the fold's own
  await expect(last).not.toContainText('Both subagents reported back.');
  await expect(last).not.toContainText('Working');
  player.advance(player.script.length); // the second subagent's notification opens a turn of the session's own
  await expect(last).toContainText('Working');
  await expect(last).not.toContainText('Both subagents reported back.');
});
