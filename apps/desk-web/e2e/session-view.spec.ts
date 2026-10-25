// M3 of the DC9 plan, in a real browser: a direct channel's center on a desktop is the session view — MAWS's report
// over the session's own transcript (the composite's §9.1), against DC3's fake machine replaying its committed
// `two-subagents` recording through DC5's DX3 double (`fake-machine.ts`): its `<message>` spans and questions, one
// working record per marked turn, an unmarked turn whole; the Report · Transcript toggle and back; a reload drawing the
// same rows; a marked response folding its turn while it streams, and settling with no double. Older rows page in at
// the top of the view until the first row, on a live session and on one that ended while the view was open, against
// the recorded session's plane (`depth-player.ts`), whose snapshots can be cut short (the fake machine's recording fits
// one snapshot). The column and the center share one subscription.
import { revealEarlier } from './transcript-history';
import type { Locator, Page } from '@playwright/test';
import type { Step } from 'desk-hub/fake-machine';
import type { JsonObject } from 'desk-hub/protocol';
import { DepthPlayer } from './depth-player';
import { FakeMachineReplay } from './fake-machine';
import { expect, seedKey, test } from './fixtures';
import { PROJECT, S, stageProject } from './scene';
import type { HubDouble } from '../test/double/hub-double';
import { readRecording } from '../test/double/session-stream';

const MACHINE = 'fake';
const ANSWER = 'You chose blue';
const streamingRows = (scope: Locator) => scope.locator('[data-row-id^="desk-stream:"]');
const records = (scope: Locator) => scope.locator('[data-row-id^="owner-record:"]');
const rowIds = (scope: Locator) => scope.locator('[data-row-id]').evaluateAll((els) => els.map((el) => el.getAttribute('data-row-id')));
const occurrences = (scope: Locator, text: string) => scope.evaluate((el, t) => (el.textContent ?? '').split(t).length - 1, text);
const toggle = (page: Page, view: 'Report' | 'Transcript') => page.getByRole('group', { name: 'Session view' }).getByRole('button', { name: view });

/** Every row the view draws, in order, its virtualized list walked from the top to the end. */
async function allRowIds(scope: Locator): Promise<string[]> {
  const scroller = scope.locator('[data-transcript-scroller]').first();
  const ids: string[] = [];
  await scroller.evaluate((el) => { el.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -200 })); el.scrollTo({ top: 0 }); });
  for (let i = 0; i < 100; i++) {
    await scope.page().waitForTimeout(60);
    for (const id of await rowIds(scope)) if (id !== null && !ids.includes(id)) ids.push(id);
    const atEnd = await scroller.evaluate((el) => {
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 1) return true;
      el.scrollBy({ top: el.clientHeight * 0.8 });
      return false;
    });
    if (atEnd) return ids;
  }
  throw new Error(`the transcript's end was not reached in 100 windows (${ids.length} rows taken)`);
}

let pageErrors: string[] = [];
let fm: FakeMachineReplay | null = null;
let player: DepthPlayer | null = null;
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
  player?.stop();
  player = null;
  expect(pageErrors).toEqual([]);
});

/** The fake machine enrolled with its session joined, and the browser on that session's channel. */
async function openSession(page: Page, hub: HubDouble): Promise<{ fm: FakeMachineReplay; view: Locator }> {
  await stageProject(hub);
  const replay = (fm = new FakeMachineReplay(hub, { project: PROJECT, machine: MACHINE }));
  const policy = { read_only: false, ceiling: 'default' };
  hub.setMachines(PROJECT, [
    { machine: 'mini', online: true, policy, checkouts: [] },
    { machine: 'SK.local', online: true, policy, checkouts: [] },
    { machine: MACHINE, online: true, policy, checkouts: [{ path: replay.recording.cwd, branch: 'main' }] },
  ]);
  await hub.append(PROJECT, { writer: `${MACHINE}/${replay.session}`, kind: 'joined', session: replay.session, alias: 'fakerec', name_source: 'user', machine: MACHINE, cwd: replay.recording.cwd, worktree: '', role: '', seat: '', by: '' });
  replay.sendPresence();
  await seedKey(page, hub);
  await page.goto(`${hub.url}/p/${PROJECT}/s/${replay.session}`);
  const view = page.getByTestId('session-view');
  await expect(view).toHaveAttribute('data-session', replay.session);
  await expect(page.getByTestId('depth')).toHaveAttribute('data-session', replay.session);
  await expect.poll(() => replay.subscriptions()).toBe(1); // the center and the column, over one subscription
  return { fm: replay, view };
}

/** The recorded `<message>` answer's row. */
const answerRow = (replay: FakeMachineReplay) => replay.recording.rows.main.find((row) => JSON.stringify(row.message ?? {}).includes('<message>You chose'))!.uuid;
const isAnswerChunk = (uuid: string, replay: FakeMachineReplay) => {
  const named = replay.recording.steps.find((s) => s.k === 'block-row' && s.body.uuid === uuid);
  return (s: Step) => named?.k === 'block-row' && s.k === 'chunk' && s.turnId === named.body.turnId && s.step === named.body.step && s.chunk.index === named.body.index;
};

test("the report: the marks and questions, one working record per marked turn, an unmarked turn whole; the toggle shows the transcript and back; a reload draws the same rows", async ({ page, hub }) => {
  const { fm, view } = await openSession(page, hub);
  fm.playThrough();
  await revealEarlier(view, view.locator('.owner-message-ink').filter({ hasText: ANSWER }));
  await expect(view.locator('.owner-message-ink')).toContainText(ANSWER);
  await expect(page.getByTestId('session-status')).toHaveText('');
  await expect(toggle(page, 'Report')).toHaveAttribute('aria-pressed', 'true');
  // The unmarked last turn draws whole: its prompt and its answer, at the end.
  await expect(view).toContainText('Count from one to three hundred');
  await expect(view).toContainText('three hundred');
  const report = await allRowIds(view);
  const marked = report.filter((id) => id.startsWith('owner-record:'));
  expect(marked).toHaveLength(1); // the turn that answered with a <message>, its work folded
  await view.locator('[data-transcript-scroller]').evaluate((el) => { el.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -200 })); el.scrollTo({ top: 0 }); });
  await expect(records(view)).toContainText(/Working record · \d+ tool calls?/);
  await expect(view).toContainText('Color→blue'); // its question (the ask mod's, answered) stays in view

  await toggle(page, 'Transcript').click();
  await expect(toggle(page, 'Transcript')).toHaveAttribute('aria-pressed', 'true');
  const transcript = await allRowIds(view);
  expect(transcript.filter((id) => id.startsWith('owner-record:'))).toEqual([]);
  expect(transcript.filter((id) => id.startsWith('divider:')).length).toBeGreaterThan(report.filter((id) => id.startsWith('divider:')).length);

  await toggle(page, 'Report').click();
  await expect.poll(() => allRowIds(view)).toEqual(report);

  await page.reload();
  await revealEarlier(view, view.locator('.owner-message-ink').filter({ hasText: ANSWER }));
  await expect(view.locator('.owner-message-ink')).toContainText(ANSWER);
  await expect(toggle(page, 'Report')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => allRowIds(view), { timeout: 15_000 }).toEqual(report);
});

test('a session view whose chunk fails to load says so, with a Retry and a reload; the reload draws it', async ({ page, hub }) => {
  const chunk = /\/assets\/SessionView-[^/]*\.js$/;
  await page.route(chunk, (route) => route.abort());
  const failed = page.getByTestId('session-view-failed');
  await stageProject(hub);
  await seedKey(page, hub);
  await page.goto(`${hub.url}/p/${PROJECT}/s/${S.asks}`);
  await expect(failed).toContainText('The session view could not be loaded');
  await expect(page.getByTestId('composer')).toBeVisible(); // the channel around it stands
  await page.unroute(chunk);
  await expect(failed.getByRole('button', { name: 'Retry' })).toBeVisible(); // asks again in place (Chrome refuses it: its module map keeps the failure)
  await failed.getByRole('button', { name: 'Reload the page' }).click();
  await expect(page.getByTestId('session-view')).toHaveAttribute('data-session', S.asks);
  await expect(failed).toHaveCount(0);
});

// Rows ahead of the recorded ones holding what breaks out of the reading column (MAWS's W2): a wide table and a code
// block with one long line, each as wide as MAWS lets it be.
const WIDE_COLUMNS = Array.from({ length: 14 }, (_, i) => `column ${i + 1} heading`);
const WIDE = [
  'A table and a code block wider than the text:',
  '',
  `| ${WIDE_COLUMNS.join(' | ')} |`,
  `| ${WIDE_COLUMNS.map(() => '---').join(' | ')} |`,
  `| ${WIDE_COLUMNS.map((_, i) => `value ${i + 1} of a row`).join(' | ')} |`,
  '',
  '```ts',
  `const line = '${'a long line of code that does not wrap '.repeat(8)}';`,
  '```',
].join('\n');
const wideRows: JsonObject[] = [
  { type: 'user', uuid: 'wide-prompt', parentUuid: null, isSidechain: false, timestamp: '2026-10-15T11:39:00.000Z', sessionId: S.asks, message: { role: 'user', content: 'Show me something wide.' } },
  {
    type: 'assistant',
    uuid: 'wide-answer',
    parentUuid: 'wide-prompt',
    isSidechain: false,
    timestamp: '2026-10-15T11:39:01.000Z',
    sessionId: S.asks,
    apiBlockIndex: 0,
    message: { id: 'msg_wide', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', content: [{ type: 'text', text: WIDE }], stop_reason: 'end_turn' },
  },
];

/** The right edge of everything the rows draw: each row's reading column (less its padding) and each breakout block. */
const drawnEnds = (view: Locator) =>
  view.evaluate((el) => [
    ...[...el.querySelectorAll<HTMLElement>('.transcript-row')].map((row) => ({ what: row.closest('[data-row-id]')?.getAttribute('data-row-id') ?? 'row', end: row.getBoundingClientRect().right - parseFloat(getComputedStyle(row).paddingRight) })),
    ...[...el.querySelectorAll<HTMLElement>('[data-streamdown="table-wrapper"], [data-streamdown="code-block"]')].map((block) => ({ what: block.getAttribute('data-streamdown')!, end: block.getBoundingClientRect().right })),
  ]);
const presence = (hub: HubDouble, record: JsonObject | null) =>
  hub.sendSession(PROJECT, { project: PROJECT, machine: 'mini', session: S.asks, kind: 'presence', sub: null, n: null, body: { record, bridge: record !== null } });

for (const width of [1280, 1440, 1920]) {
  test(`at ${width} px the jump to the latest row sits in a gutter clear of every row, wide tables and code included; an idle session's draws its arrow, not working dots`, async ({ page, hub }) => {
    await page.setViewportSize({ width, height: 800 });
    await stageProject(hub);
    const played = (player = new DepthPlayer(hub, { project: PROJECT, machine: 'mini', session: S.asks, extraRows: wideRows }));
    played.skip(played.script.length); // the recording's last turn has no end on disk: MAWS reads it as working
    await seedKey(page, hub);
    await page.goto(`${hub.url}/p/${PROJECT}/s/${S.asks}`);
    const view = page.getByTestId('session-view');
    await expect(view).toContainText('Both subagents reported back.');
    const jump = view.getByRole('button', { name: 'Jump to latest' });
    await view.locator('[data-transcript-scroller]').evaluate((el) => { el.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -200 })); el.scrollTo({ top: 0 }); });
    await expect(view.locator('[data-streamdown="table-wrapper"]')).toBeVisible();
    await expect(view.locator('[data-streamdown="code-block"]')).toBeVisible();
    await expect(jump).toBeVisible();

    // Busy, the control draws MAWS's working dots.
    presence(hub, { status: 'busy' });
    await expect(view).not.toHaveAttribute('data-at-rest');
    await expect(jump.locator('.transcript-working-dots')).toBeVisible();

    // Every drawn row, and each wide block, ends 12 px or more before the control.
    const box = (await jump.boundingBox())!;
    const ends = await drawnEnds(view);
    expect(ends.filter((e) => e.what === 'table-wrapper' || e.what === 'code-block')).toHaveLength(2);
    for (const { what, end } of ends) expect(end, what).toBeLessThanOrEqual(box.x - 12);
    // The wide blocks still break out to their width (the gutter bounds them; it does not cancel them).
    const text = await view.locator('.transcript-row:has([data-streamdown="table-wrapper"])').evaluate((row) => row.getBoundingClientRect().width - parseFloat(getComputedStyle(row).paddingLeft) - parseFloat(getComputedStyle(row).paddingRight));
    expect((await view.locator('[data-streamdown="table-wrapper"]').boundingBox())!.width).toBeGreaterThanOrEqual(text);

    // At rest (idle), the control draws MAWS's arrow, not its dots; with no process at all, the same.
    for (const record of [{ status: 'idle' }, null]) {
      presence(hub, record);
      await expect(view).toHaveAttribute('data-at-rest', '');
      await expect(jump.locator('.transcript-working-dots')).toHaveCount(0);
      await expect(jump.locator('svg')).toBeVisible();
    }
  });
}

test('a turn no row ended draws at rest while its machine reports the session idle or with no process, as MAWS draws one its disk follower closed; waiting or busy, it works', async ({ page, hub }) => {
  await stageProject(hub); // the session's presence: waiting on its owner
  const played = (player = new DepthPlayer(hub, { project: PROJECT, machine: 'mini', session: S.asks }));
  // Up to the marked answer's turn and no further: the recording ends no turn on disk, and the next is not yet written.
  played.skip(played.script.findLastIndex((item) => item.kind === 'row' && JSON.stringify(item.body.row).includes('<task-notification>')));
  await seedKey(page, hub);
  await page.goto(`${hub.url}/p/${PROJECT}/s/${S.asks}`);
  const view = page.getByTestId('session-view');
  await expect(view).toContainText('Both subagents reported back.');
  const record = records(view).last().locator('.owner-record');
  const divider = view.locator('[data-row-id^="divider:"]').last().locator('.transcript-disclosure');
  /** The turn draws working (true) or at rest: its record's running mark in the report, its divider in the transcript. */
  const draws = async (working: boolean) => {
    await expect(toggle(page, 'Report')).toHaveAttribute('aria-pressed', 'true');
    if (working) {
      await expect(record).toHaveAttribute('data-working', '');
      await expect(record.locator('.owner-record-running')).toBeVisible();
    } else {
      await expect(record).not.toHaveAttribute('data-working');
      await expect(record.locator('.owner-record-running')).toHaveCount(0);
    }
    await toggle(page, 'Transcript').click();
    await expect(divider).toHaveText(working ? /^Working( for \d+s)?$/ : 'Continued for 2s'); // MAWS's words for the engine's turn, closed at its last row
    await toggle(page, 'Report').click();
  };

  await draws(true); // waiting
  for (const status of ['idle', null]) {
    presence(hub, status === null ? null : { status });
    await expect(view).toHaveAttribute('data-at-rest', '');
    await draws(false);
  }
  presence(hub, { status: 'busy' }); // the store kept the turn open: busy again, it works again
  await expect(view).not.toHaveAttribute('data-at-rest');
  await draws(true);
});

test('a marked response folds its turn and shows its mark while it streams, before its row is written; settling leaves no double', async ({ page, hub }) => {
  const { fm, view } = await openSession(page, hub);
  const uuid = answerRow(fm);
  fm.step(fm.recording.steps.findIndex(isAnswerChunk(uuid, fm)) - fm.played); // up to the answer's first chunk
  await expect(view).toContainText('Color→blue');
  await expect(view).toContainText("Wrote 'blue' to recorded.txt in the current directory"); // nothing marked yet: the turn draws whole, its Bash call too
  await expect(records(view)).toHaveCount(0);

  for (let i = 0; i < 40 && !(await streamingRows(view).allTextContents()).join('').includes(ANSWER); i++) {
    fm.step(1);
    await page.waitForTimeout(20);
  }
  await expect(streamingRows(view).last()).toContainText(`<message>${ANSWER}`);
  await expect(streamingRows(view).last().locator('.owner-message-ink')).toHaveCount(0);
  await expect(records(view)).toHaveCount(1); // an open mark folds independently of its closed-only ink
  await expect(records(view).locator('.transcript-working-dots')).toHaveCount(1);
  await expect(view).not.toContainText("Wrote 'blue' to recorded.txt in the current directory");
  const named = fm.recording.steps.find((s) => s.k === 'block-row' && s.body.uuid === uuid)!;
  if (named.k !== 'block-row') throw new Error('no block-row');
  const lastText = fm.recording.steps.findLastIndex((s) => s.k === 'chunk' && s.turnId === named.body.turnId && s.step === named.body.step && s.chunk.index === named.body.index && s.chunk.kind === 'text');
  fm.step(lastText + 1 - fm.played);
  const live = streamingRows(view).last();
  await expect(live.locator('.owner-message-ink')).toContainText(ANSWER);
  await expect(live).not.toContainText('<message>');
  await expect(records(view)).toHaveCount(1); // the turn folded into its record while the mark streams
  await expect(view).not.toContainText("Wrote 'blue' to recorded.txt in the current directory");
  expect(fm.depth.rows.get('main')!.some((row) => row.uuid === uuid)).toBe(false); // and its row is not written yet

  fm.playThrough();
  await expect(streamingRows(view)).toHaveCount(0);
  await expect.poll(() => occurrences(view, ANSWER)).toBe(1);
  await expect(records(view)).toHaveCount(1);
});

/** The recorded session's plane with its snapshots cut to the newest `limit` rows, the browser on its channel. */
async function openPaged(page: Page, hub: HubDouble, limit: number): Promise<{ player: DepthPlayer; view: Locator }> {
  await page.setViewportSize({ width: 1280, height: 480 });
  await stageProject(hub);
  const played = (player = new DepthPlayer(hub, { project: PROJECT, machine: 'mini', session: S.asks, limit }));
  played.skip(played.script.length); // the session has run: the snapshot holds its newest rows
  await seedKey(page, hub);
  await page.goto(`${hub.url}/p/${PROJECT}/s/${S.asks}`);
  const view = page.getByTestId('session-view');
  await expect(view).toContainText('Both subagents reported back.');
  await expect.poll(() => played.subscriptions()).toBe(1);
  return { player: played, view };
}

/** Scrolls the view to its top until its first row (the session's first prompt) is drawn; how many pages it took. */
async function pageToFirstRow(hub: HubDouble, view: Locator): Promise<number> {
  const scroller = view.locator('[data-transcript-scroller]');
  await expect
    .poll(
      async () => {
        await scroller.evaluate((el) => { el.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -200 })); el.scrollTo({ top: 0 }); });
        return view.getByText('Think briefly first', { exact: false }).count();
      },
      { timeout: 15_000 },
    )
    .toBeGreaterThan(0);
  const pages = hub.up.filter((u) => u.frame.t === 'rows').length;
  await view.page().waitForTimeout(500);
  expect(hub.up.filter((u) => u.frame.t === 'rows').length).toBe(pages); // none asked past the first row
  return pages;
}

test('older rows page in at the top of the session view until the first row, on a live session', async ({ page, hub }) => {
  const { player, view } = await openPaged(page, hub, 6);
  await expect(view).not.toContainText('Think briefly first');
  expect(await pageToFirstRow(hub, view)).toBeGreaterThanOrEqual(1);
  await expect(page.getByTestId('session-status')).toHaveText('');
  expect(player.subscriptions()).toBe(1);
});

test('a session that ended while its view was open keeps its subscription and pages to its first row', async ({ page, hub }) => {
  const { player, view } = await openPaged(page, hub, 6);
  // The session's process goes (DX8: presence says so); its subscription stays open and idle.
  hub.sendSession(PROJECT, { project: PROJECT, machine: 'mini', session: S.asks, kind: 'presence', sub: null, n: null, body: { record: null, bridge: false } });
  await expect(page.getByTestId('channel-header').getByRole('button', { name: 'Resume' })).toBeVisible();
  await page.waitForTimeout(300);
  expect(player.subscriptions()).toBe(1);
  expect(hub.up.some((u) => u.frame.t === 'unsubscribe')).toBe(false);
  expect(await pageToFirstRow(hub, view)).toBeGreaterThanOrEqual(1);
  await expect(view.getByTestId('depth-unavailable')).toHaveCount(0);
});

// A long history ahead of the recorded rows, paged in 100 rows at a time: the recorded session's own rows (prompts,
// thinking, Agent calls and their results, hand-backs, notifications, answers) copied a dozen times under ids of their
// own, a day apart. A page's edge then falls inside a turn (whose top rows the page renames, which MAWS's list cannot
// anchor on) and the rows a page brings are drawn at the list's guesses before they are measured.
const recorded = readRecording().session;
const ids = new Set(recorded.flatMap((row) => [String(row.uuid), ...JSON.stringify(row).match(/(toolu|msg)_[A-Za-z0-9]+/g) ?? []]));
const longHistory: JsonObject[] = Array.from({ length: 12 }, (_, copy) =>
  recorded.map((row) => {
    let text = JSON.stringify(row);
    for (const id of ids) text = text.split(id).join(`${id}-h${copy}`);
    const copied = JSON.parse(text) as JsonObject;
    if (typeof copied.timestamp === 'string') copied.timestamp = new Date(Date.parse(copied.timestamp) - (12 - copy) * 86_400_000).toISOString();
    return copied;
  }),
).flat();

/** The first row in the scroller's viewport whose id outlives a rebuild, and its offset from the viewport's top. */
const readerRow = (view: Locator) =>
  view.locator('[data-transcript-scroller]').evaluate((el) => {
    const top = el.getBoundingClientRect().top;
    const rows = [...el.querySelectorAll('[data-row-id]')]
      .map((row) => ({ id: row.getAttribute('data-row-id')!, y: row.getBoundingClientRect().top - top, bottom: row.getBoundingClientRect().bottom - top }))
      .filter((row) => row.bottom > 0 && !/^(time|divider|owner-record|desk-stream):/.test(row.id))
      .sort((a, b) => a.y - b.y);
    return rows[0] ?? null;
  });
const rowY = (view: Locator, id: string) =>
  view.locator('[data-transcript-scroller]').evaluate((el, id) => {
    const row = el.querySelector(`[data-row-id="${CSS.escape(id)}"]`);
    return row ? row.getBoundingClientRect().top - el.getBoundingClientRect().top : null;
  }, id);

for (const delay of [0, 300, 1500]) {
  test(`a page of older rows answered ${delay === 0 ? 'at once' : `${delay} ms late`} leaves the reader's row where it was, page after page`, async ({ page, hub }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await stageProject(hub);
    const played = (player = new DepthPlayer(hub, { project: PROJECT, machine: 'mini', session: S.asks, extraRows: longHistory, limit: 40 }));
    played.skip(played.script.length);
    played.holdRows = true;
    await seedKey(page, hub);
    await page.goto(`${hub.url}/p/${PROJECT}/s/${S.asks}`);
    const view = page.getByTestId('session-view');
    await expect(view).toContainText('Both subagents reported back.');
    const scroller = view.locator('[data-transcript-scroller]');
    const asked = () => hub.up.filter((u) => u.frame.t === 'rows').length;
    for (let pageNo = 1; pageNo <= 3; pageNo++) {
      // The reader scrolls to the top, which asks for the page; what they look at then is their place.
      const before = asked();
      await expect
        .poll(async () => {
          await scroller.evaluate((el) => { el.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -200 })); el.scrollTo({ top: 0 }); });
          return asked();
        })
        .toBeGreaterThan(before);
      await page.waitForTimeout(150); // the list has drawn the top
      const reader = (await readerRow(view))!;
      expect(reader, `page ${pageNo}: a row in view`).not.toBeNull();
      await page.waitForTimeout(delay);
      expect(played.releaseRows(), `page ${pageNo}`).toBe(1);
      await expect(page.getByTestId('session-status')).toHaveText(''); // the page is in
      await page.waitForTimeout(600); // the page drawn and measured
      const y = await rowY(view, reader.id);
      expect(y, `page ${pageNo}: ${reader.id} drawn`).not.toBeNull();
      expect(Math.abs(y! - reader.y), `page ${pageNo}: ${reader.id} from ${reader.y} to ${y}`).toBeLessThan(4);
    }
  });
}

test("a notification's landing on a request reaches its card from far up in the history: the list brings it in, focused and marked", async ({ page, hub }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await stageProject(hub);
  const played = (player = new DepthPlayer(hub, { project: PROJECT, machine: 'mini', session: S.asks, extraRows: longHistory, limit: 40 }));
  played.skip(played.script.length);
  played.holdRows = true; // the reader stays where they went: no older page lands under them
  await hub.raise(PROJECT, 'mini', { request: 'toolu_far', session: S.asks, tool: 'Bash', input: { command: 'pnpm e2e' } });
  await seedKey(page, hub);
  await page.goto(`${hub.url}/p/${PROJECT}/s/${S.asks}`);
  const view = page.getByTestId('session-view');
  const card = view.locator('[data-tail-request="toolu_far"]');
  await expect(view).toContainText('Both subagents reported back.');
  await expect(card).toContainText('Wants to run a command');
  // The reader goes far up the history: the list no longer mounts the card.
  await view.locator('[data-transcript-scroller]').evaluate((el) => { el.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -200 })); el.scrollTo({ top: 0 }); });
  await expect(card).toHaveCount(0);
  // A tap on the request's notification, with the app open on this channel.
  await page.evaluate((url) => navigator.serviceWorker.dispatchEvent(new MessageEvent('message', { data: { type: 'desk-open', url } })), `/p/${PROJECT}/s/${S.asks}?request=toolu_far`);
  await expect(card).toHaveAttribute('data-landed', '');
  await expect(card).toBeInViewport();
  await expect(card).toBeFocused();
});
