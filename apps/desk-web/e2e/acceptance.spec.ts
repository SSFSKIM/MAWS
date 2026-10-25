// DC9's acceptance (the composite's DC9.G1–G4, the plan's M6), in a real browser against DC3's fake machine replaying
// the `session-view` recording as a DC8 producer (`fake-machine.ts`, `producer: 'dc8'`): the clauses the milestones'
// suites proved on `two-subagents`, on DC6's recorded plane, or not yet at all. The report over the recording's marked
// and unmarked turns, its questions, the toggle and back, a reload; a marked answer streaming into its folded turn with
// its record's running dots, settling with no double, and the turn reading finished once its `turn_duration` is in;
// history paged to the first row across a compaction, live and after the session ended; the tail's send cases, each
// framed row drawn without its frame line and a peer's labelled with who sent it; a desk Interrupt's rows, in both of
// the bridge's shapes, drawing no bubble and ending the turn; a notification's landing on a `<message>`; the column's
// tabs. Where a milestone's suite already proves a clause, the M6 report cites it. Beside them, a message sent through
// a message tool: its landing, and its drawing while its input streams.
//
// With DESK_SHOTS set to a directory, the report and the transcript at one point are saved there at desktop width.
import { allTranscriptRowIds, revealEarlier } from './transcript-history';
import type { Locator, Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadRecording, SESSION_VIEW, type Recording, type Step } from 'desk-hub/fake-machine';
import type { JsonObject, LogEvent } from 'desk-hub/protocol';
import type { HubDouble } from '../test/double/hub-double';
import { FakeMachineReplay } from './fake-machine';
import { expect, seedKey, test } from './fixtures';
import { PROJECT, stageProject } from './scene';

const MACHINE = 'fake';
const ALIAS = 'fakerec';
const ANSWER = 'You chose blue';
const ASK_CALL = 'toolu_01ptPa1uE4qkTexQaiwjlnsO';
const SHOTS = process.env.DESK_SHOTS;
const BRIDGE = { kind: 'plugin', name: 'doperpowers', asUser: true };

const streamingRows = (scope: Locator) => scope.locator('[data-row-id^="desk-stream:"]');
const records = (scope: Locator) => scope.locator('[data-row-id^="owner-record:"]');
const occurrences = (scope: Locator, text: string) => scope.evaluate((el, t) => (el.textContent ?? '').split(t).length - 1, text);
const toggle = (page: Page, view: 'Report' | 'Transcript') => page.getByRole('group', { name: 'Session view' }).getByRole('button', { name: view });
const tailSends = (view: Locator) => view.getByTestId('tail-send');
const scroller = (view: Locator) => view.locator('[data-transcript-scroller]');
const workingDots = (scope: Locator) => scope.locator('.transcript-working-dots:visible');
/** The list's index of the first drawn row holding `text` (or matching `selector`), null while none is drawn. */
const indexOf = async (view: Locator, what: { text?: string; selector?: string }): Promise<number | null> => {
  const rows = what.selector ? view.locator(`[data-row-id]:has(${what.selector})`) : view.locator('[data-row-id]').filter({ hasText: what.text! });
  if ((await rows.count()) === 0) return null;
  return Number(await rows.first().getAttribute('data-index'));
};

async function shot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}.png`) });
}

/** Scrolls the virtualized list a window at a time (`direction` -1 up, 1 down) until `target` is drawn. */
async function scrollUntil(view: Locator, target: Locator, direction: 1 | -1, steps = 120): Promise<void> {
  await scroller(view).dispatchEvent('wheel', { deltaY: -200 }); // the reader owns this history walk
  for (let i = 0; i < steps; i++) {
    // Resolve and act in one browser turn: the virtualizer can recycle a node between count() and a later
    // Playwright scroll action. A missing/recycled match stays in this bounded search instead of using a stale handle.
    const reached = await target.evaluateAll((matches) => {
      const node = matches.find((match) => match.isConnected);
      if (!node) return false;
      node.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      return node.isConnected;
    });
    if (reached) return;
    await scroller(view).evaluate((el, d) => el.scrollBy({ top: d * el.clientHeight * 0.6 }), direction);
    await view.page().waitForTimeout(60);
  }
  throw new Error(`not drawn within ${steps} windows of the list`);
}

let pageErrors: string[] = [];
let fm: FakeMachineReplay | null = null;
test.beforeEach(({ page }) => {
  pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) pageErrors.push(message.text());
  });
});
test.afterEach(() => {
  fm?.stop();
  fm = null;
  expect(pageErrors).toEqual([]);
});

/** The fake machine replaying `recording` as DC8's producer, its session joined, and the browser on its channel. */
async function openSession(page: Page, hub: HubDouble, options: { recording?: Recording; before?: (replay: FakeMachineReplay) => Promise<string | void> } = {}): Promise<{ fm: FakeMachineReplay; view: Locator }> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await stageProject(hub);
  const replay = (fm = new FakeMachineReplay(hub, { project: PROJECT, machine: MACHINE }, { recording: options.recording ?? SESSION_VIEW, producer: 'dc8' }));
  const policy = { read_only: false, ceiling: 'default' };
  hub.setMachines(PROJECT, [
    { machine: 'mini', online: true, policy, checkouts: [] },
    { machine: 'SK.local', online: true, policy, checkouts: [] },
    { machine: MACHINE, online: true, policy, checkouts: [{ path: replay.recording.cwd, branch: 'main' }] },
  ]);
  await hub.append(PROJECT, { writer: `${MACHINE}/${replay.session}`, kind: 'joined', session: replay.session, alias: ALIAS, name_source: 'user', machine: MACHINE, cwd: replay.recording.cwd, worktree: '', role: '', seat: '', by: '' });
  replay.sendPresence();
  const search = (await options.before?.(replay)) ?? '';
  await seedKey(page, hub);
  await page.goto(`${hub.url}/p/${PROJECT}/s/${replay.session}${search}`);
  const view = page.getByTestId('session-view');
  await expect(view).toHaveAttribute('data-session', replay.session);
  await expect.poll(() => replay.subscriptions()).toBe(1);
  return { fm: replay, view };
}

const presence = (hub: HubDouble, session: string, record: JsonObject | null) =>
  hub.sendSession(PROJECT, { project: PROJECT, machine: MACHINE, session, kind: 'presence', sub: null, n: null, body: { record, bridge: record !== null } });
/** The timeline's index of the session's end: its presence going to no process. */
const endOf = (recording: Recording) => recording.steps.findIndex((s) => s.k === 'presence' && s.record === null);
/** The recorded `<message>` answer's row, and whether a step is one of its block's chunks. */
const answerRow = (recording: Recording) => recording.rows.main.find((row) => JSON.stringify(row.message ?? {}).includes('<message>You chose'))!.uuid;
const isAnswerChunk = (uuid: string, recording: Recording) => {
  const named = recording.steps.find((s) => s.k === 'block-row' && s.body.uuid === uuid);
  return (s: Step) => named?.k === 'block-row' && s.k === 'chunk' && s.turnId === named.body.turnId && s.step === named.body.step && s.chunk.index === named.body.index;
};
const isRow = (uuid: string) => (s: Step) => s.k === 'row' && s.row.uuid === uuid;

test("G1: the report over the session's rows — marked turns folded to one record each, unmarked ones whole, its questions — the toggle to the transcript and back, a reload; the column's tabs", async ({ page, hub }) => {
  const { fm, view } = await openSession(page, hub);
  fm.step(endOf(fm.recording)); // every row in, the session idle and still running
  await revealEarlier(view, view.locator('.owner-message-ink').filter({ hasText: ANSWER }));
  await expect(view.locator('.owner-message-ink').filter({ hasText: ANSWER })).toBeVisible();
  await expect(page.getByTestId('session-status')).toHaveText('');
  await expect(toggle(page, 'Report')).toHaveAttribute('aria-pressed', 'true');
  // The unmarked last turn draws whole: its prompt and its answer, at the end.
  await expect(view).toContainText('Count from one to three hundred');
  await expect(view).toContainText('three hundred');
  // The marked answer's turn: one record, its work folded (its Bash call), its questions in view.
  const record = records(view).filter({ hasText: /Working record · \d+ tool calls?/ });
  await scrollUntil(view, view.getByText('Color→blue'), -1);
  await expect(record.last()).toBeVisible();
  await expect(view).not.toContainText("Wrote 'blue' to recorded.txt in the current directory");
  await scrollUntil(view, view.locator(`[data-row-id^="question:${ASK_CALL}"]`), -1); // the ask mod's async question, a question row
  // Older turns: a marked one (part 23) is its message ink over a closed record, an unmarked one (part 24) whole.
  await scrollUntil(view, view.getByText('Read notes part 23 and tell me what it says.'), -1);
  const part23 = view.locator('.owner-message-ink').filter({ hasText: 'Part 23 is forty numbered lines' });
  await expect(part23).toBeVisible();
  const between = async (from: string, to: string) => {
    const [a, b] = [await indexOf(view, { text: from }), await indexOf(view, { text: to })];
    const ids = await view.locator('[data-row-id]').evaluateAll((els, [lo, hi]) => els.filter((el) => Number(el.getAttribute('data-index')) > lo! && Number(el.getAttribute('data-index')) < hi!).map((el) => el.getAttribute('data-row-id')!), [a, b]);
    return ids;
  };
  const turn23 = await between('Read notes part 23 and tell me what it says.', 'Read notes part 24 and tell me what it says.');
  expect(turn23.filter((id) => id.startsWith('owner-record:'))).toHaveLength(1);
  await scrollUntil(view, view.getByText('Part 24 is forty numbered lines'), 1);
  const turn24 = await between('Read notes part 24 and tell me what it says.', 'Part 24 is forty numbered lines');
  expect(turn24.some((id) => id.startsWith('owner-record:'))).toBe(false); // unmarked: no record, its Read call drawn
  expect(turn24.length).toBeGreaterThan(0);

  // The column: Subagents, Jobs, Diff, Info; no Transcript tab.
  const depth = page.getByTestId('depth');
  await expect(depth.getByRole('tab')).toHaveCount(4);
  await expect(depth.getByRole('tab').nth(0)).toHaveText(/^Subagents/);
  await expect(depth.getByRole('tab').nth(1)).toHaveText(/^Jobs/);
  await expect(depth.getByRole('tab').nth(2)).toHaveText('Diff');
  await expect(depth.getByRole('tab').nth(3)).toHaveText('Info');

  // At one point, the marked answer's turn as each side of the toggle draws it, for the owner.
  if (SHOTS) {
    await scroller(view).evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
    await scrollUntil(view, view.locator('.owner-message-ink').filter({ hasText: ANSWER }), -1);
    await view.locator('.owner-message-ink').filter({ hasText: ANSWER }).evaluate((el) => el.scrollIntoView({ block: 'end' }));
    await page.waitForTimeout(300);
    await shot(page, 'session-view-report');
    await toggle(page, 'Transcript').click();
    await scrollUntil(view, view.getByText(ANSWER), -1);
    await view.getByText(ANSWER).first().evaluate((el) => el.scrollIntoView({ block: 'end' }));
    await page.waitForTimeout(300);
    await shot(page, 'session-view-transcript');
    await toggle(page, 'Report').click();
  }

  // The toggle: the transcript has no records and more dividers, and back to the same rows.
  const firstRow = view.getByText(FIRST_ROW, { exact: true });
  const report = await allTranscriptRowIds(view, firstRow);
  await toggle(page, 'Transcript').click();
  await expect(toggle(page, 'Transcript')).toHaveAttribute('aria-pressed', 'true');
  const transcript = await allTranscriptRowIds(view, firstRow);
  expect(transcript.filter((id) => id.startsWith('owner-record:'))).toEqual([]);
  expect(transcript.filter((id) => id.startsWith('divider:')).length).toBeGreaterThan(report.filter((id) => id.startsWith('divider:')).length);
  await expect(records(view)).toHaveCount(0);
  await expect(view.locator('[data-row-id^="divider:"]').first()).toBeVisible();
  await toggle(page, 'Report').click();
  expect(await allTranscriptRowIds(view, firstRow)).toEqual(report);

  // A reload draws the same rows.
  await page.reload();
  await revealEarlier(view, view.locator('.owner-message-ink').filter({ hasText: ANSWER }));
  await expect(view.locator('.owner-message-ink').filter({ hasText: ANSWER })).toBeVisible();
  await expect(toggle(page, 'Report')).toHaveAttribute('aria-pressed', 'true');
  expect(await allTranscriptRowIds(view, firstRow, 15_000)).toEqual(report);
});

test('G1: a marked answer streams per block into its folded turn, its record working; it settles with no double; its turn_duration reads the turn finished', async ({ page, hub }) => {
  const { fm, view } = await openSession(page, hub);
  const recording = fm.recording;
  const uuid = answerRow(recording);
  fm.step(recording.steps.findIndex(isAnswerChunk(uuid, recording)) - fm.played); // up to the answer's first chunk
  await expect(view).toContainText('Color→blue');
  await expect(view).toContainText("Wrote 'blue' to recorded.txt in the current directory"); // nothing marked yet: the turn draws whole, its Bash call too

  for (let i = 0; i < 40 && !(await streamingRows(view).allTextContents()).join('').includes(ANSWER); i++) {
    fm.step(1);
    await page.waitForTimeout(20);
  }
  // Native MAWS already folds an open mark, but UX1-C leaves its unfinished text literal and without ink.
  await expect(streamingRows(view).last()).toContainText(`<message>${ANSWER}`);
  await expect(streamingRows(view).last().locator('.owner-message-ink')).toHaveCount(0);
  await expect(view).not.toContainText("Wrote 'blue' to recorded.txt in the current directory");
  await expect(workingDots(records(view))).toHaveCount(1);
  const answerBlock = recording.steps.find((s) => s.k === 'block-row' && s.body.uuid === uuid)!;
  if (answerBlock.k !== 'block-row') throw new Error('no block-row');
  const lastText = recording.steps.findLastIndex((s) => s.k === 'chunk' && s.turnId === answerBlock.body.turnId && s.step === answerBlock.body.step && s.chunk.index === answerBlock.body.index && s.chunk.kind === 'text');
  fm.step(lastText + 1 - fm.played);
  const live = streamingRows(view).last();
  await expect(live.locator('.owner-message-ink')).toContainText(ANSWER);
  await expect(live).not.toContainText('<message>');
  await expect(view).not.toContainText("Wrote 'blue' to recorded.txt in the current directory"); // folded into its record while the mark streams
  await expect(workingDots(records(view))).toHaveCount(1); // the record says it works
  expect(fm.depth.rows.get('main')!.some((row) => row.uuid === uuid)).toBe(false); // and its row is not written yet

  // Unmarked text streaming later in the marked turn (a block after the answer, in the same response) stays inside the
  // closed record; opened, the record shows it. The response's step-end drops it, as no row was written for it.
  const named = recording.steps.find((s) => s.k === 'block-row' && s.body.uuid === uuid)!;
  if (named.k !== 'block-row') throw new Error('no block-row');
  // The answer's last text chunk (the response's `stop` chunk comes after its block-row, and is then behind the aside's).
  const lastChunk = recording.steps.findLastIndex((s) => s.k === 'chunk' && s.turnId === named.body.turnId && s.agentId === null && s.step === named.body.step && s.chunk.kind === 'text');
  fm.step(lastChunk + 1 - fm.played);
  const chunk = recording.steps[lastChunk];
  if (chunk.k !== 'chunk') throw new Error('no chunk');
  const ASIDE = 'An unmarked aside, still streaming.';
  fm.depth.apply({ ...chunk, chunkIndex: chunk.chunkIndex + 1, chunk: { kind: 'text', index: Number(chunk.chunk.index) + 1, text: ASIDE } });
  await page.waitForTimeout(300);
  await expect(view).not.toContainText(ASIDE); // folded: the record below proves it arrived
  const working = records(view).filter({ has: page.locator('.transcript-working-dots') });
  const workingId = await working.getAttribute('data-row-id');
  expect(workingId).not.toBeNull();
  const disclosure = view.locator(`[data-row-id="${workingId}"] .transcript-disclosure`);
  await disclosure.click();
  await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
  await expect(view).toContainText(ASIDE);
  await disclosure.click();
  await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
  await expect(view).not.toContainText(ASIDE);

  // Settled: the row replaces the live text, drawn once. Then the engine's turn_duration closes the turn.
  const at = recording.rows.main.findIndex((row) => row.uuid === uuid);
  const duration = recording.rows.main.slice(at).find((row) => row.type === 'system' && row.subtype === 'turn_duration')!;
  fm.playThrough(isRow(duration.uuid));
  presence(hub, fm.session, { status: 'idle' });
  await expect(streamingRows(view)).toHaveCount(0);
  await expect.poll(() => occurrences(view, ANSWER)).toBe(1);
  await expect(view).not.toContainText(ASIDE);
  // Finished: no working dots anywhere (the record's, the jump control's), and the transcript's divider is not "Working".
  await expect(workingDots(view)).toHaveCount(0);
  await toggle(page, 'Transcript').click();
  await scroller(view).evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
  const last = view.locator('[data-row-id^="divider:"]').last();
  await expect(last).toBeVisible();
  await expect(last).not.toContainText('Working');
  await expect(workingDots(view)).toHaveCount(0);
});

const FIRST_ROW = 'Read notes part 01 and tell me what it says.';
/**
 * Scrolls to the top, as a reader does (the wheel: a page that lands holds the reader's place against the list's own
 * scrolling, never against the reader's), until the session's first row is drawn there.
 */
async function toTheTop(view: Locator): Promise<void> {
  await scroller(view).hover();
  await expect
    .poll(
      async () => {
        await view.page().mouse.wheel(0, -100_000);
        await view.page().waitForTimeout(100);
        return view.getByText(FIRST_ROW).count();
      },
      { timeout: 20_000 },
    )
    .toBeGreaterThan(0);
}

/** Scrolls to the top until the session's first row is drawn; then checks no page is asked past it. */
async function pageToFirstRow(hub: HubDouble, view: Locator): Promise<number> {
  await toTheTop(view);
  const pages = hub.up.filter((u) => u.frame.t === 'rows').length;
  await view.page().waitForTimeout(500);
  expect(hub.up.filter((u) => u.frame.t === 'rows').length).toBe(pages); // none asked past the first row
  return pages;
}

/** The rows before the compaction draw above its divider, the rows after it below, in the view as it stands. */
async function acrossTheCompaction(view: Locator): Promise<void> {
  await toTheTop(view);
  const firstRow = await indexOf(view, { text: FIRST_ROW });
  expect(firstRow).not.toBeNull();
  const divider = view.locator('[data-row-id]').filter({ hasText: 'Compacted earlier' });
  await scrollUntil(view, divider, 1);
  const boundary = await indexOf(view, { text: 'Compacted earlier' });
  const before = await indexOf(view, { text: 'Read notes part 06 and tell me what it says.' });
  await scrollUntil(view, view.getByText('Read notes part 07 and tell me what it says.'), 1);
  const after = await indexOf(view, { text: 'Read notes part 07 and tell me what it says.' });
  expect(firstRow!).toBeLessThan(boundary!);
  expect(before!).toBeLessThan(boundary!);
  expect(after!).toBeGreaterThan(boundary!);
}

for (const ended of [false, true]) {
  test(`G2: older rows page in at the top to the first row, across a compaction, ${ended ? 'on a session that ended while its view was open' : 'on a live session'}; the view never stalls`, async ({ page, hub }) => {
    // Opened once every row is in: more than one snapshot of them, so the oldest come as pages.
    const { fm, view } = await openSession(page, hub, { before: async (replay) => void replay.step(endOf(replay.recording)) });
    await page.setViewportSize({ width: 1280, height: 600 });
    await expect(view).toContainText('three hundred');
    if (ended) {
      fm.step(1); // the session's process goes; its subscription stays open
      await expect(page.getByTestId('channel-header').getByRole('button', { name: 'Resume' })).toBeVisible();
      await page.waitForTimeout(300);
      expect(hub.up.some((u) => u.frame.t === 'unsubscribe')).toBe(false);
    }
    await expect(view).not.toContainText(FIRST_ROW);
    expect(await pageToFirstRow(hub, view)).toBeGreaterThanOrEqual(1);
    await expect(page.getByTestId('session-status')).toHaveText(''); // nothing pending, nothing ended
    await expect(view.getByTestId('no-transcript')).toHaveCount(0);
    expect(fm.subscriptions()).toBe(1);
    await acrossTheCompaction(view);

    // The full transcript holds the same history across the same boundary.
    await toggle(page, 'Transcript').click();
    await acrossTheCompaction(view);
  });
}

test("G1: a send stays at the tail until its own framed row: delivered before its row, two identical sends each taking their own, an earlier typed prompt never taken, one refused after a delay, one whose row never comes before the session ends; a framed row draws without its frame line, a peer's with who sent it", async ({ page, hub }) => {
  const { fm, view } = await openSession(page, hub);
  const idle = fm.recording.steps.findIndex((s, i) => i > 0 && s.k === 'presence' && s.at > 18_000 && (s.record as { status?: string } | null)?.status === 'idle');
  fm.step(idle + 1);
  const last = fm.recording.rows.main.at(-1)!;
  let n = 0;
  const userRow = (content: string, origin: JsonObject) => ({ type: 'user', uuid: `5e55a11d-0000-4000-8000-${String(++n).padStart(12, '0')}`, parentUuid: last.uuid, isSidechain: false, timestamp: new Date().toISOString(), sessionId: fm.session, origin, message: { role: 'user', content } });
  const land = (row: JsonObject) => fm.depth.apply({ at: 0, k: 'row', agentId: null, row: row as never });
  const composer = page.getByRole('textbox', { name: `Message ${ALIAS}` });
  const send = async (text: string): Promise<LogEvent> => {
    const before = hub.logOf(PROJECT).filter((e) => e.event.text === text).length;
    await composer.fill(text);
    await page.getByTestId('composer').getByRole('button', { name: 'Send' }).click();
    await expect.poll(() => hub.logOf(PROJECT).filter((e) => e.event.text === text).length).toBe(before + 1);
    return hub.logOf(PROJECT).filter((e) => e.event.text === text).at(-1)!.event;
  };
  const deliver = (event: LogEvent, outcome: string, reason = 'submitted to the session') => hub.deliver(PROJECT, MACHINE, { event: { writer: event.writer, seq: event.seq }, session: fm.session, outcome: outcome as never, reason });
  const frame = (event: LogEvent) => `[sminos chat MAWS ${event.writer}:${event.seq} from human → @you]`;
  const sendOf = (text: string) => tailSends(view).filter({ hasText: text });
  const bubbles = (text: string) => view.locator('[data-kind="user"]').filter({ hasText: text });

  // An earlier prompt typed at the terminal; then the session is busy, and two identical sends are acknowledged.
  land(userRow('continue', { kind: 'human' }));
  await expect(bubbles('continue')).toHaveCount(1);
  presence(hub, fm.session, { status: 'busy' });
  const first = await send('continue');
  const second = await send('continue');
  await expect(sendOf('continue')).toHaveCount(2);
  await deliver(first, 'delivered');
  await deliver(second, 'delivered');
  await expect(sendOf('continue').and(view.locator('[data-state="delivered"]'))).toHaveCount(2); // delivered, their rows not in yet
  await expect(sendOf('continue').first().getByTestId('delivery-foot')).toContainText('Delivered · waiting in the session’s queue');
  // The second's own row lands first: it takes the second, never the first, nor is the typed row ever taken.
  land(userRow(`${frame(second)}\ncontinue`, BRIDGE));
  await expect(sendOf('continue')).toHaveCount(1);
  const tailRowIds = () => view.locator('[data-row-id]:has([data-testid="tail-send"])').evaluateAll((els) => els.map((el) => el.getAttribute('data-row-id')!));
  await expect.poll(tailRowIds).toEqual([expect.stringMatching(new RegExp(`:${first.seq}$`))]);
  land(userRow(`${frame(first)}\ncontinue`, BRIDGE));
  await expect(sendOf('continue')).toHaveCount(0);
  // Three bubbles: the typed prompt and the two sends' own rows, each drawn without its frame line, with no label.
  await expect(bubbles('continue')).toHaveCount(3);
  await expect(view).not.toContainText('[sminos chat');
  await expect(bubbles('continue').filter({ hasText: 'From ' })).toHaveCount(0);

  // A peer's send, delivered as its frame: drawn without the frame line, labelled with who sent it.
  land(userRow('[sminos chat MAWS 5e0c1f2a:2 from fakepeer → @you]\nI read recorded.txt: blue, as you chose.', BRIDGE));
  const peer = bubbles('I read recorded.txt: blue, as you chose.');
  await expect(peer).toHaveCount(1);
  await expect(peer).not.toContainText('[sminos');
  await expect(peer.locator('em').first()).toHaveText('From fakepeer');

  // A peer's send through sminos's inbox, queued into the running turn (the engine's `queued_command`, its prompt the
  // bare envelope, under its own `source_uuid`): a message between agents, as MAWS draws one, naming its sender, its
  // body without sminos's frame line or reply line.
  const call = { type: 'assistant', uuid: '5e55a11d-0000-4000-8000-0000000000c1', parentUuid: last.uuid, isSidechain: false, timestamp: new Date().toISOString(), sessionId: fm.session, message: { id: 'msg_queued1', role: 'assistant', model: 'claude-haiku-5-5', type: 'message', content: [{ type: 'tool_use', id: 'toolu_queued1', name: 'Bash', input: { command: 'ls', description: 'List files' } }], stop_reason: 'tool_use', usage: { input_tokens: 1, output_tokens: 1 } } };
  const result = { type: 'user', uuid: '5e55a11d-0000-4000-8000-0000000000c2', parentUuid: call.uuid, isSidechain: false, timestamp: new Date().toISOString(), sessionId: fm.session, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_queued1', content: 'notes.md', is_error: false }] }, toolUseResult: { stdout: 'notes.md', stderr: '', interrupted: false, isImage: false } };
  const INBOX = { kind: 'peer', from: 'unknown', verifiedPeerPid: 4242, name: 'fakepeer' };
  const envelope = (body: string) => `<cross-session-message from-name="fakepeer">\n${body}\n</cross-session-message>`;
  const reply = '[To reply, run in Bash: /Users/new/.claude/plugins/cache/doperpowers/doperpowers/7.175.0/skills/sminos/scripts/sminos say "@MAWS/5e0c1f2a <your reply>"]';
  const queuedDelivery = { type: 'attachment', uuid: '5e55a11d-0000-4000-8000-0000000000c3', parentUuid: result.uuid, isSidechain: false, timestamp: new Date().toISOString(), sessionId: fm.session, attachment: { type: 'queued_command', prompt: envelope(`[sminos chat MAWS 5e0c1f2a:3 from fakepeer → @you]\nPing me when the count is done.\n${reply}`), source_uuid: '5e55a11d-0000-4000-8000-0000000000c4', commandMode: 'prompt', origin: INBOX, isMeta: true } };
  for (const row of [call, result, queuedDelivery]) land(row);
  const peerMessage = view.locator('[data-kind="agent_message"]').filter({ hasText: 'Ping me when the count is done.' });
  await expect(peerMessage).toHaveCount(1);
  await expect(peerMessage).toContainText('fakepeer');
  await expect(peerMessage).not.toContainText('[sminos');
  await expect(peerMessage).not.toContainText('To reply');
  await expect(bubbles('Ping me when the count is done.')).toHaveCount(0);

  // A send to the busy session, which the bridge appends into the running turn (doperpowers #233: `$.session.append`,
  // kept meta with the plugin's origin and no `asUser`): it waits at the tail until that row, then is a bubble in the
  // turn, as MAWS draws a prompt queued there, without its frame line, under the appended row's own uuid.
  const midTurn = await send('Count the markdown files too.');
  await deliver(midTurn, 'delivered');
  await expect(sendOf('Count the markdown files too.')).toHaveAttribute('data-state', 'delivered');
  const appendedUuid = '5e55a11d-0000-4000-8000-0000000000c5';
  land({ type: 'user', uuid: appendedUuid, parentUuid: queuedDelivery.uuid, isSidechain: false, timestamp: new Date().toISOString(), sessionId: fm.session, isMeta: true, origin: { kind: 'plugin', name: 'doperpowers' }, message: { role: 'user', content: [{ type: 'text', text: `${frame(midTurn)}\nCount the markdown files too.` }] } });
  await expect(sendOf('Count the markdown files too.')).toHaveCount(0);
  const appendedBubble = view.locator(`[data-row-id="user:${appendedUuid}"]`);
  await expect(appendedBubble).toHaveCount(1);
  await expect(appendedBubble).toContainText('Count the markdown files too.');
  await expect(appendedBubble).toContainText('Sent during this turn');
  await expect(appendedBubble).not.toContainText('[sminos');
  await expect(appendedBubble.locator('em')).toHaveCount(0); // the owner's own: no label

  // A send that went through sminos's inbox (doperpowers #233's way after an Esc, or a session without the bridge), which
  // the engine keeps as a peer message: it leaves the tail at its row, drawn as the owner's own prompt, without its frame.
  const inboxed = await send('Check the docs build.');
  await deliver(inboxed, 'delivered');
  const inboxedUuid = '5e55a11d-0000-4000-8000-0000000000c6';
  const trailer = "This came from another Claude session — not typed by your user, but very likely working on their behalf.";
  land({ type: 'user', uuid: inboxedUuid, parentUuid: appendedUuid, isSidechain: false, timestamp: new Date().toISOString(), sessionId: fm.session, isMeta: true, origin: { ...INBOX, name: 'human' }, promptSource: 'system', turnOrigin: 'peer', message: { role: 'user', content: `Another Claude session sent a message:\n${envelope(`${frame(inboxed)}\nCheck the docs build.`)}\n\n${trailer}` } });
  await expect(sendOf('Check the docs build.')).toHaveCount(0);
  const inboxedBubble = view.locator(`[data-row-id="user:${inboxedUuid}"]`);
  await expect(inboxedBubble).toHaveCount(1);
  await expect(inboxedBubble).toContainText('Check the docs build.');
  await expect(inboxedBubble).not.toContainText('[sminos');
  await expect(view.locator('[data-kind="agent_message"]').filter({ hasText: 'Check the docs build.' })).toHaveCount(0);
  await shot(page, 'tail-framed-rows');

  // A submission delayed, then refused: it stays, saying so.
  const refused = await send('Refuse this one.');
  await page.waitForTimeout(500);
  await expect(sendOf('Refuse this one.')).toHaveAttribute('data-state', 'queued');
  await deliver(refused, 'failed', 'the session refused the prompt: it is not accepting input');
  await expect(sendOf('Refuse this one.')).toHaveAttribute('data-state', 'failed');
  await expect(sendOf('Refuse this one.').getByTestId('delivery-foot')).toContainText('Not delivered · “the session refused the prompt: it is not accepting input”');

  // Delivered, and the session ends before its row comes: it stays, delivered, ahead of the end marker.
  const unseen = await send('Write the summary before you stop.');
  await deliver(unseen, 'delivered');
  await expect(sendOf('Write the summary before you stop.')).toHaveAttribute('data-state', 'delivered');
  presence(hub, fm.session, null);
  await expect(view.getByTestId('end-marker')).toBeVisible();
  const kept = sendOf('Write the summary before you stop.');
  await expect(kept).toHaveAttribute('data-state', 'delivered');
  await expect(kept.getByTestId('delivery-foot')).toContainText('Delivered · not seen in the transcript before the session ended');
  const index = (selector: string) => view.locator(`[data-row-id]:has(${selector})`).last().getAttribute('data-index').then(Number);
  expect(await index('[data-testid="tail-send"]')).toBeLessThan(await index('[data-testid="end-marker"]'));
  await expect(sendOf('Refuse this one.')).toHaveAttribute('data-state', 'failed'); // still there too
});

test("a desk Steer waits at the tail until the row its result names, then is the owner's words in the running turn, sent during it", async ({ page, hub }) => {
  const { fm, view } = await openSession(page, hub);
  const idle = fm.recording.steps.findIndex((s, i) => i > 0 && s.k === 'presence' && s.at > 18_000 && (s.record as { status?: string } | null)?.status === 'idle');
  fm.step(idle + 1);
  const envelope = (uuid: string, parentUuid: string) => ({ uuid, parentUuid, isSidechain: false, timestamp: new Date().toISOString(), sessionId: fm.session });
  const land = (row: JsonObject) => fm.depth.apply({ at: 0, k: 'row', agentId: null, row: row as never });
  // A turn at work: a prompt typed at the terminal, a Bash call and its result.
  const prompt = { ...envelope('5e55a11d-0000-4000-8000-0000000000d1', fm.recording.rows.main.at(-1)!.uuid), type: 'user', origin: { kind: 'human' }, promptId: 'p-steer', message: { role: 'user', content: 'Count the files.' } };
  const call = { ...envelope('5e55a11d-0000-4000-8000-0000000000d2', prompt.uuid), type: 'assistant', message: { id: 'msg_steer1', role: 'assistant', model: 'claude-haiku-5-5', type: 'message', content: [{ type: 'tool_use', id: 'toolu_steer1', name: 'Bash', input: { command: 'ls', description: 'List files' } }], stop_reason: 'tool_use', usage: { input_tokens: 1, output_tokens: 1 } } };
  const result = { ...envelope('5e55a11d-0000-4000-8000-0000000000d3', call.uuid), type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_steer1', content: 'notes.md', is_error: false }] }, toolUseResult: { stdout: 'notes.md', stderr: '', interrupted: false, isImage: false } };
  for (const row of [prompt, call, result]) land(row);
  presence(hub, fm.session, { status: 'busy' });

  const box = page.getByRole('textbox', { name: `Message ${ALIAS}` });
  await box.fill('Use the split store.');
  await box.press('Enter'); // while it works, Enter steers
  await expect.poll(() => hub.rpcs(PROJECT).filter((r) => r.rpc === 'steer').length).toBe(1);
  const steer = hub.rpcs(PROJECT).find((r) => r.rpc === 'steer')!;
  const waiting = tailSends(view).filter({ hasText: 'Use the split store.' });
  await expect(waiting).toHaveCount(1);
  // The bridge's row for it (`$.session.append`, kept meta with the plugin's origin), named by the steer's result.
  const steered = '5e55a11d-0000-4000-8000-0000000000d4';
  hub.answerRpc(PROJECT, steer.nonce, { state: 'done', result: { row: steered } });
  await expect(waiting.getByTestId('delivery-foot')).toHaveText('✓Steer · read at the next model request');
  land({ ...envelope(steered, result.uuid), type: 'user', isMeta: true, origin: { kind: 'plugin', name: 'doperpowers' }, message: { role: 'user', content: [{ type: 'text', text: 'Use the split store.' }] } });
  await expect(waiting).toHaveCount(0);
  const bubble = view.locator(`[data-row-id="user:${steered}"]`);
  await expect(bubble).toHaveCount(1);
  await expect(bubble).toContainText('Use the split store.');
  await expect(bubble).toContainText('Sent during this turn');
  await expect(view.locator('[data-kind="user"]').filter({ hasText: 'Use the split store.' })).toHaveCount(1);
});

/**
 * The recording with one more turn before the session's end: a prompt, a Bash call and its result, then `interrupt`;
 * its machine reports the session busy from the prompt on, as it does for a turn it runs.
 */
function withInterruptedTurn(recording: Recording, interrupt: (task: string) => string[]): Recording {
  const main = recording.rows.main;
  const lastRow = main.at(-1)!;
  const end = endOf(recording);
  const at = recording.steps[end].at - 1;
  const base = Date.parse(String(lastRow.timestamp)) + 60_000;
  let parent = lastRow.uuid;
  const envelope = (i: number) => {
    const uuid = `5e551e55-0000-4000-8000-00000000000${i}`;
    const row = { uuid, parentUuid: parent, timestamp: new Date(base + i * 1000).toISOString(), sessionId: recording.session, isSidechain: false, userType: 'external', cwd: lastRow.cwd, version: lastRow.version, entrypoint: 'cli' };
    parent = uuid;
    return row;
  };
  // The bridge's appended rows (`$.session.append`) as the engine stores them: meta user rows of text, its origin.
  const appended = (i: number, text: string) => ({ ...envelope(i), type: 'user', isMeta: true, origin: { kind: 'plugin', name: 'doperpowers' }, message: { role: 'user', content: [{ type: 'text', text }] } });
  const rows: JsonObject[] = [
    { ...envelope(1), type: 'user', origin: { kind: 'human' }, promptId: 'p-interrupt', message: { role: 'user', content: 'Run the long suite and tell me what fails.' } },
    { ...envelope(2), type: 'assistant', message: { id: 'msg_interrupt1', role: 'assistant', model: 'claude-haiku-5-5', type: 'message', content: [{ type: 'tool_use', id: 'toolu_interrupt1', name: 'Bash', input: { command: 'sleep 600', description: 'Run the long suite' } }], stop_reason: 'tool_use', usage: { input_tokens: 1, output_tokens: 1 } } },
    ...interrupt('bk3x9a1').map((text, i) => appended(3 + i, text)),
    { ...envelope(6), type: 'user', promptId: 'p-interrupt', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_interrupt1', content: 'Command was manually backgrounded by user with ID: bk3x9a1.', is_error: false }] }, toolUseResult: { stdout: '', stderr: '', interrupted: false, isImage: false, backgroundTaskId: 'bk3x9a1' } },
  ];
  const steps: Step[] = [{ at, k: 'presence', record: { status: 'busy', waitingFor: null, needs: null } }, ...rows.map((row): Step => ({ at, k: 'row', agentId: null, row: row as never }))];
  return { ...recording, rows: { ...recording.rows, main: [...main, ...(rows as never[])] }, steps: [...recording.steps.slice(0, end), ...steps, ...recording.steps.slice(end)] };
}

const STOPPED = (task: string) => `Task ${task}, the Bash command the interrupt moved to the background, was then stopped: it is not running, and no notification will come for it.`;
const INTERRUPTS: Array<[string, (task: string) => string[]]> = [
  ["the bridge's one row from before doperpowers #225 (its marker line and its Task lines)", (task) => [`[Request interrupted by user from the desk]\n${STOPPED(task)}`]],
  ["doperpowers #225's two rows (the engine's marker, then the note with its Task lines)", (task) => ['[Request interrupted by user]', `The interrupt came from the desk.\n${STOPPED(task)}`]],
];

for (const [shape, interrupt] of INTERRUPTS) {
  test(`a desk Interrupt, as ${shape}: no bubble for its rows, and the turn reads stopped, finished`, async ({ page, hub }) => {
    const recording = withInterruptedTurn(loadRecording(SESSION_VIEW), interrupt);
    const { fm, view } = await openSession(page, hub, { recording });
    const prompt = recording.rows.main.find((row) => row.promptId === 'p-interrupt')!;
    fm.playThrough(isRow(recording.rows.main[recording.rows.main.indexOf(prompt) + 1].uuid)); // the turn's call, not its interrupt
    await toggle(page, 'Transcript').click();
    await scroller(view).evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
    const last = view.locator('[data-row-id^="divider:"]').last();
    await expect(last).toContainText('Working');
    fm.playThrough(isRow(recording.rows.main.at(-1)!.uuid)); // the interrupt's rows and the backgrounded call's result
    presence(hub, fm.session, { status: 'idle' });
    await expect(last).toContainText('You stopped after');
    await expect(workingDots(view)).toHaveCount(0);
    for (const toggleTo of ['Transcript', 'Report'] as const) {
      await toggle(page, toggleTo).click();
      await scroller(view).evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
      await page.waitForTimeout(200);
      // No bubble, tail row or text for the interrupt's rows: only the turn's own prompt.
      await expect(view.locator('[data-kind="user"]').last()).toContainText('Run the long suite and tell me what fails.');
      await expect(view).not.toContainText('Request interrupted');
      await expect(view).not.toContainText('The interrupt came from');
      await expect(view).not.toContainText('was then stopped');
      await expect(tailSends(view)).toHaveCount(0);
    }
  });
}

test("G3: with the fake machine disconnected, the channel is the log's, its working record a label", async ({ page, hub }) => {
  const { fm, view } = await openSession(page, hub);
  fm.step(endOf(fm.recording));
  const [message] = fm.recordedMessages();
  const draft: JsonObject = { ...message, writer: `${MACHINE}/${fm.session}` };
  delete draft.ts;
  delete draft.seq;
  await hub.append(PROJECT, draft as never);
  await revealEarlier(view, view.locator('.owner-message-ink').filter({ hasText: ANSWER }));
  await expect(view.locator('.owner-message-ink').filter({ hasText: ANSWER })).toBeVisible();
  hub.dropMachine(PROJECT, MACHINE);
  const center = page.getByRole('region', { name: 'Channel' });
  await expect(page.getByTestId('machine-offline')).toBeVisible();
  await expect(center.getByTestId('session-view')).toHaveCount(0);
  await expect(center).toContainText(ANSWER); // the log's `message`
  await expect(center.getByTestId('working-record').first()).toHaveText(`Working record · ${MACHINE} is offline`);
  await expect(center.getByRole('button', { name: /working record/i })).toHaveCount(0);
});

test("a notification's landing on a <message> opens the session view at its row, marked", async ({ page, hub }) => {
  // Opened as a tapped notification opens it, cold: the channel's URL naming the log's `message` event.
  const { view } = await openSession(page, hub, {
    before: async (replay) => {
      replay.step(endOf(replay.recording)); // the session has answered; its row is held
      const [message] = replay.recordedMessages();
      const draft: JsonObject = { ...message, writer: `${MACHINE}/${replay.session}` };
      delete draft.ts;
      delete draft.seq;
      const { event } = await hub.append(PROJECT, draft as never);
      return `?writer=${encodeURIComponent(event.writer)}&seq=${event.seq}`;
    },
  });
  const row = view.locator('[data-row-id][data-landed]');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText(ANSWER);
  await expect(row).toBeInViewport();
  await expect(page.getByTestId('landing')).toHaveCount(0); // found: nothing to say
  await shot(page, 'landing-on-message');
});

/** Opens the session cold on a landing naming a `message` event whose `src` is `src`, once every row is in (so the
 * snapshot holds only the newest rows and the oldest come as pages). */
async function landCold(page: Page, hub: HubDouble, src: (recording: Recording) => string, text: string): Promise<{ fm: FakeMachineReplay; view: Locator }> {
  return openSession(page, hub, {
    before: async (replay) => {
      replay.step(endOf(replay.recording));
      replay.holdRows = true; // each page waits for the suite
      const { event } = await hub.append(PROJECT, { writer: `${MACHINE}/${replay.session}`, kind: 'message', from: ALIAS, to: 'host', text, src: src(replay.recording) } as never);
      return `?writer=${encodeURIComponent(event.writer)}&seq=${event.seq}`;
    },
  });
}
/** The older history's reply to notes part `k` (a `<message>` for every part not divisible by 3). */
const partReply = (recording: Recording, k: number) => recording.rows.main.find((row) => JSON.stringify(row.message ?? {}).includes(`<message>Part ${String(k).padStart(2, '0')} is forty`))!.uuid;

test("a landing on a <message> older than the snapshot pages toward its row, saying so, and lands on it", async ({ page, hub }) => {
  const { fm, view } = await landCold(page, hub, (recording) => `${partReply(recording, 2)}#0`, 'Part 02 is forty numbered lines about replaying a session and paging its history.');
  expect(fm.recording.rows.main.findIndex((row) => row.uuid === partReply(fm.recording, 2))).toBeLessThan(10); // far older than the snapshot reaches
  // While the page is out, the view says it is looking for the message.
  const notice = page.getByTestId('landing');
  await expect(notice).toHaveAttribute('data-landing', 'checking');
  await expect(notice).toHaveText('Finding the message in the session’s history…');
  await expect.poll(() => fm.releaseRows()).toBe(1);
  fm.holdRows = false;
  const row = view.locator('[data-row-id][data-landed]');
  await expect(row).toHaveCount(1, { timeout: 15_000 });
  await expect(row).toContainText('Part 02 is forty numbered lines');
  await expect(row).toBeInViewport();
  await expect(notice).toHaveCount(0); // found: nothing left to say
});

test("a landing on a <message> whose row is in no page of the transcript says so once the history runs out", async ({ page, hub }) => {
  const { fm, view } = await landCold(page, hub, () => '0d0d0d0d-0000-4000-8000-000000000000#0', 'A message from a row this transcript does not hold.');
  const notice = page.getByTestId('landing');
  await expect(notice).toHaveAttribute('data-landing', 'checking');
  fm.holdRows = false;
  await expect.poll(() => fm.releaseRows()).toBe(1); // the one page there is, to the first row
  await expect(notice).toHaveAttribute('data-landing', 'missing');
  await expect(notice).toHaveText(/This message’s row is not in the session’s transcript\./);
  await page.waitForTimeout(300);
  expect(hub.up.filter((u) => u.frame.t === 'rows').length).toBe(1); // nothing asked once the history ran out
  await expect(view.locator('[data-row-id][data-landed]')).toHaveCount(0);
  await notice.getByRole('button', { name: 'Dismiss' }).click();
  await expect(notice).toHaveCount(0);
});

// A message sent through the to-human plugin's message tool (doperpowers' to-human message tool spec; MAWS's P4-R7): the
// call is the message, MAWS's `to_human` row once its row lands, drawn as the message while its input streams, and the
// log's `message` for it names the call (`src`, its tool-use id), so a push lands on that row.
const MESSAGE_TOOL = 'mcp__to-human__message';
const STAGE = 'Stage 2 of 4 is done: 34 of the 37 missing labels are restored.';
/** Rows written after `parent`, each on the chain after the one before, in the recording's envelope. */
function chainAfter(replay: FakeMachineReplay, parent: string): (row: JsonObject) => JsonObject {
  const last = replay.recording.rows.main.at(-1)!;
  let n = 0;
  return (row) => {
    const uuid = `5e55a9e0-0000-4000-8000-${String(++n).padStart(12, '0')}`;
    const written = { uuid, parentUuid: parent, timestamp: new Date().toISOString(), sessionId: replay.session, isSidechain: false, userType: 'external', cwd: last.cwd, version: last.version, entrypoint: 'cli', ...row };
    parent = uuid;
    return written;
  };
}
const ownerPrompt = (text: string): JsonObject => ({ type: 'user', origin: { kind: 'human' }, promptId: 'p-message-tool', message: { role: 'user', content: text } });
const messageCall = (id: string, text: string): JsonObject => ({
  type: 'assistant',
  message: { id: `msg_${id}`, role: 'assistant', model: 'claude-haiku-5-5', type: 'message', content: [{ type: 'tool_use', id, name: MESSAGE_TOOL, input: { text } }], stop_reason: 'tool_use', usage: { input_tokens: 1, output_tokens: 1 } },
});
const messageSent = (id: string): JsonObject => ({ type: 'user', promptId: 'p-message-tool', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: [{ type: 'text', text: 'sent' }] }] }, toolUseResult: [{ type: 'text', text: 'sent' }] });

test("a notification's landing on a message sent through a message tool opens the session view at its call's message row, marked", async ({ page, hub }) => {
  const id = 'toolu_01LandedMessageToolCall';
  const { view } = await openSession(page, hub, {
    before: async (replay) => {
      replay.step(endOf(replay.recording));
      const next = chainAfter(replay, replay.rowsSoFar().at(-1)!);
      for (const row of [ownerPrompt('How far along is the relabelling?'), messageCall(id, STAGE), messageSent(id)]) replay.depth.appendRow(null, next(row) as never);
      const { event } = await hub.append(PROJECT, { writer: `${MACHINE}/${replay.session}`, kind: 'message', from: ALIAS, to: 'host', text: STAGE, src: id } as never);
      return `?writer=${encodeURIComponent(event.writer)}&seq=${event.seq}`;
    },
  });
  const row = view.locator(`[data-row-id="to-human:${id}"]`);
  await expect(row).toHaveAttribute('data-landed', '');
  await expect(row.locator('.owner-message-ink')).toContainText(STAGE);
  await expect(row).toBeInViewport();
  await expect(page.getByTestId('landing')).toHaveCount(0); // found: nothing to say
});

test('a message sent through a message tool draws as the message while its input streams, then as its row, never twice', async ({ page, hub }) => {
  const { fm, view } = await openSession(page, hub);
  fm.step(endOf(fm.recording));
  const id = 'toolu_01StreamedMessageToolCall';
  const turnId = 'turn-message-tool';
  const next = chainAfter(fm, fm.rowsSoFar().at(-1)!);
  const land = (row: JsonObject) => fm.depth.apply({ at: 0, k: 'row', agentId: null, row: row as never });
  const chunk = (chunkIndex: number, body: JsonObject) => fm.depth.apply({ at: 0, k: 'chunk', turnId, agentId: null, step: 0, chunkIndex, chunk: body });
  land(next(ownerPrompt('How far along is the relabelling?')));
  presence(hub, fm.session, { status: 'busy' }); // the prompt's turn runs, as its machine reports
  await expect(view).toContainText('How far along is the relabelling?');

  chunk(0, { kind: 'tool', index: 0, id, name: MESSAGE_TOOL });
  chunk(1, { kind: 'input', index: 0, json: '' });
  chunk(2, { kind: 'input', index: 0, json: '{"text": "Stage 2 of 4 is done:' });
  const live = streamingRows(view).locator(`[data-to-human-call="${id}"] .owner-message-ink`);
  await expect(live).toContainText('Stage 2 of 4 is done:');
  await expect(live).not.toContainText('{"text"');
  chunk(3, { kind: 'input', index: 0, json: ' 34 of the 37 missing labels are restored."}' });
  await expect(live).toContainText(STAGE);

  // Its row is written: the live drawing stays until that row lands, then the row is the message, drawn once.
  const call = next(messageCall(id, STAGE));
  fm.depth.apply({ at: 0, k: 'block-row', body: { uuid: String(call.uuid), turnId, agentId: null, step: 0, index: 0 } });
  await expect(live).toContainText(STAGE);
  land(call);
  await expect(streamingRows(view)).toHaveCount(0);
  const row = view.locator(`[data-row-id="to-human:${id}"]`);
  await expect(row.locator('.owner-message-ink')).toContainText(STAGE);
  await expect.poll(() => occurrences(view, STAGE)).toBe(1);
  land(next(messageSent(id)));
  await expect(row.locator('.owner-message-ink')).toContainText(STAGE);
  await expect.poll(() => occurrences(view, STAGE)).toBe(1);
});
