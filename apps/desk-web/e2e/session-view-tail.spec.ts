// M4 of the DC9 plan, in a real browser: the channel around the session view (the composite's §9.1), against DC3's
// fake machine replaying `session-view` with DC8's producer (`fake-machine.ts`), the recording's log events and their
// deliveries staged on DC5's DX3 double as the machine would publish them. A send not yet in the transcript is a bubble
// at its tail with its delivery state in its foot, until its own framed row replaces it; the session's pending requests
// are cards at the tail, answered in place and gone once settled, with an "N waiting ↓" pill for a reader scrolled
// away; the ask mod's async question row carries the log's question and answer, and a question its resumed session
// raises again after its withdrawal waits on its card again, after a reload too; an ended session ends with its marker
// and Resume, a send it never received ahead of it. Where the session view cannot draw — a machine offline, a machine
// that serves no transcript for the session — the channel is the one built from the log, its working record a label;
// an ended session there is not offered Resume, and two sessions under one name are told apart by their ids.
//
// With DESK_SHOTS set to a directory, the tail's surfaces are saved there at desktop width for the owner.
import type { Locator, Page } from '@playwright/test';
import type { Step } from 'desk-hub/fake-machine';
import { SESSION_VIEW } from 'desk-hub/fake-machine';
import type { JsonObject, LogEvent } from 'desk-hub/protocol';
import { DOUBLE_MEMBER, type HubDouble } from '../test/double/hub-double';
import { FakeMachineReplay } from './fake-machine';
import { expect, seedKey, test } from './fixtures';
import { PROJECT, S, stageProject } from './scene';

const MACHINE = 'fake';
const ALIAS = 'fakerec';
const ASK = 'mcp__doperpowers__AskUserQuestion';
const TITLE = 'Mockup server and its suites';
const SHOTS = process.env.DESK_SHOTS;
const shot = async (target: Page | Locator, name: string) => {
  if (SHOTS) await target.screenshot({ path: `${SHOTS}/${name}.png` });
};
const tailSends = (view: Locator) => view.getByTestId('tail-send');
/** Scrolls the virtualized list up from its end, a window at a time, until `row` is drawn; then centers it. */
async function scrollTo(view: Locator, row: Locator): Promise<void> {
  const scroller = view.locator('[data-transcript-scroller]');
  await scroller.evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
  for (let i = 0; i < 60 && (await row.count()) === 0; i++) {
    await scroller.evaluate((el) => { el.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -200 })); el.scrollBy({ top: -el.clientHeight * 0.8 }); });
    await view.page().waitForTimeout(60);
  }
  await row.evaluate((el) => el.scrollIntoView({ block: 'center' }));
}
const rowIndex = (view: Locator, selector: string) => view.locator(`[data-row-id]:has(${selector})`).first().getAttribute('data-index').then(Number);

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

/** The fake machine enrolled with the recorded session joined, and the browser on that session's channel. */
async function openSession(page: Page, hub: HubDouble): Promise<{ fm: FakeMachineReplay; view: Locator }> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await stageProject(hub);
  const replay = (fm = new FakeMachineReplay(hub, { project: PROJECT, machine: MACHINE }, { recording: SESSION_VIEW, producer: 'dc8' }));
  const policy = { read_only: false, ceiling: 'default' };
  hub.setMachines(PROJECT, [
    { machine: 'mini', online: true, policy, checkouts: [] },
    { machine: 'SK.local', online: true, policy, checkouts: [] },
    { machine: MACHINE, online: true, policy, checkouts: [{ path: replay.recording.cwd, branch: 'main' }] },
  ]);
  await hub.append(PROJECT, { writer: `${MACHINE}/${replay.session}`, kind: 'joined', session: replay.session, alias: ALIAS, name_source: 'user', machine: MACHINE, cwd: replay.recording.cwd, worktree: '', role: '', seat: '', by: '' });
  replay.sendPresence();
  await seedKey(page, hub);
  await page.goto(`${hub.url}/p/${PROJECT}/s/${replay.session}`);
  const view = page.getByTestId('session-view');
  await expect(view).toHaveAttribute('data-session', replay.session);
  await expect.poll(() => replay.subscriptions()).toBe(1);
  return { fm: replay, view };
}

/**
 * The recording's own log events about the session — its async question and answer, the human's send — appended as
 * its machine would publish them (under this suite's machine name), and each one's recorded delivery outcome. Each
 * step is staged once, as the replay reaches it.
 */
function logStager(hub: HubDouble, replay: FakeMachineReplay) {
  const stored = new Map<string, LogEvent>();
  const staged = new Set<Step>();
  const asMachine = (writer: string) => writer.replace(/^SK\.local\//, `${MACHINE}/`);
  return async (upTo: number) => {
    for (const step of replay.recording.steps.slice(0, upTo)) {
      if (staged.has(step)) continue;
      staged.add(step);
      if (step.k === 'log' && ['question', 'answered', 'human'].includes(String(step.event.kind))) {
        // Published anew: the hub's double numbers and times it as the machine's next event.
        const draft: JsonObject = { ...step.event, writer: asMachine(String(step.event.writer)) };
        delete draft.ts;
        delete draft.seq;
        const { event } = await hub.append(PROJECT, draft as never);
        stored.set(step.id, event);
      } else if (step.k === 'delivery' && stored.has(step.log)) {
        const event = stored.get(step.log)!;
        await hub.deliver(PROJECT, MACHINE, { event: { writer: event.writer, seq: event.seq }, session: step.session, outcome: step.outcome, reason: step.reason });
      }
    }
  };
}

test("an ended session: the send it never got stays tinted at the tail, ahead of its end marker and Resume; the ask mod's question carries the log's answer", async ({ page, hub }) => {
  const { fm, view } = await openSession(page, hub);
  // A titled session: named title first, alias muted, through SessionLabel, and nowhere in a foot's words.
  await hub.append(PROJECT, { writer: `${MACHINE}/${fm.session}`, kind: 'titled', session: fm.session, title: TITLE });
  const stage = logStager(hub, fm);
  fm.playThrough();
  await stage(fm.recording.steps.length);
  await expect(page.getByTestId('channel-header').getByRole('button', { name: 'Resume' })).toBeVisible(); // presence: no process

  const send = tailSends(view);
  await expect(send).toHaveCount(1);
  await expect(send).toHaveAttribute('data-state', 'recorded');
  await expect(send).toContainText('Re-run the suites when you are back, please.');
  await expect(send.getByTestId('delivery-foot')).toHaveText('◇Recorded, not delivered · Resume delivers it');
  await expect(send.getByTestId('delivery-foot')).toHaveAttribute('title', /not running here/);
  await expect(send).not.toContainText(TITLE);
  await expect(send).not.toContainText(ALIAS);
  const marker = view.getByTestId('end-marker');
  await expect(marker).toContainText('Ended');
  await expect(marker).toContainText(`Its process on ${MACHINE} is gone. Everything above stays here.`);
  await expect(marker.getByTestId('session-name')).toHaveText(TITLE);
  await expect(marker.getByTestId('alias')).toHaveText(ALIAS);
  await expect(marker.getByRole('button', { name: 'Resume' })).toBeEnabled();
  expect(await rowIndex(view, '[data-testid="tail-send"]')).toBeLessThan(await rowIndex(view, '[data-testid="end-marker"]'));
  await shot(view, 'tail-recorded-and-end-marker');

  // The marker's Resume is the header's: one sealed RPC.
  await marker.getByRole('button', { name: 'Resume' }).click();
  await expect.poll(() => hub.rpcs(PROJECT).map((r) => [r.rpc, r.args])).toEqual([['resume', { session: fm.session }]]);

  // The ask mod's async question, answered from the web: its receipt carries the log's answer.
  const question = view.locator('[data-row-id^="question:toolu_01ptPa1uE4qkTexQaiwjlnsO"]');
  await scrollTo(view, question);
  await expect(question.getByTestId('question-overlay')).toHaveText(/Mockups→Stop it/);
  await shot(view, 'ask-question-answered');
});

test('the pending requests are cards at the tail, answered in place and gone once settled; scrolled away, a pill brings the reader to them', async ({ page, hub }) => {
  const { fm, view } = await openSession(page, hub);
  const stage = logStager(hub, fm);
  // Up to the ask mod's async question: its call is in the transcript, its `question` in the log, its request raised.
  const raised = fm.playThrough((s) => s.k === 'raised' && s.draft.tool === ASK);
  if (raised?.k !== 'raised') throw new Error('the recording raises no async question');
  const asked = fm.recording.steps.findIndex((s) => s.k === 'log' && s.event.kind === 'question');
  await stage(Math.max(fm.played, asked + 1));
  await hub.raise(PROJECT, MACHINE, { ...raised.draft, session: fm.session });
  const bash = { request: 'toolu_web_bash', session: fm.session, tool: 'Bash', input: { command: 'pnpm e2e', description: 'Run the e2e suite' } };
  await hub.raise(PROJECT, MACHINE, bash);

  const ask = view.locator(`[data-tail-request="${raised.draft.request}"]`);
  const permission = view.locator('[data-tail-request="toolu_web_bash"]');
  await expect(ask).toContainText('it keeps working while it waits');
  await expect(permission).toContainText('Wants to run a command');
  expect(await rowIndex(view, `[data-tail-request="${raised.draft.request}"]`)).toBeLessThan(await rowIndex(view, '[data-tail-request="toolu_web_bash"]'));
  // Its transcript row says where it is answered.
  const question = view.locator('[data-row-id^="question:toolu_01ptPa1uE4qkTexQaiwjlnsO"]');
  await expect(question).toContainText('Waiting for your answer · below');
  await shot(view, 'requests-inline');

  // Scrolled away from them, the reader gets the pill; it brings them back.
  const pill = view.getByTestId('waiting-pill');
  await expect(pill).toHaveCount(0);
  await view.locator('[data-transcript-scroller]').evaluate((el) => { el.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -200 })); el.scrollTo({ top: 0 }); });
  await expect(pill).toHaveText('2 waiting ↓');
  await shot(view, 'requests-pill');
  await pill.click();
  await expect(ask).toBeInViewport();
  await expect(pill).toHaveCount(0);

  // Answered in place: the async question first.
  await ask.getByRole('radio', { name: 'Stop it' }).click();
  await ask.getByRole('button', { name: 'Submit' }).click();
  await expect.poll(() => hub.rpcs(PROJECT).length).toBe(1);
  const answer = hub.rpcs(PROJECT)[0];
  expect(answer).toMatchObject({ rpc: 'answer', machine: MACHINE, args: { session: fm.session, answers: { 'Keep the mockup server running once the suites finish?': 'Stop it' } } });
  hub.answerRpc(PROJECT, answer.nonce, { state: 'done', result: {} });
  await hub.settle(PROJECT, MACHINE, fm.session, { request: raised.draft.request, winner: 'web', outcome: 'answered', by: DOUBLE_MEMBER.id });
  await expect(ask).toHaveCount(0);
  await permission.getByRole('button', { name: 'Allow' }).click();
  await expect.poll(() => hub.rpcs(PROJECT).length).toBe(2);
  expect(hub.rpcs(PROJECT)[1]).toMatchObject({ rpc: 'decide', args: { decision: 'allow' } });
  await hub.settle(PROJECT, MACHINE, fm.session, { request: 'toolu_web_bash', winner: 'web', outcome: 'allow', by: DOUBLE_MEMBER.id });
  await expect(permission).toHaveCount(0);
  await expect(pill).toHaveCount(0);

  // The log's answer reaches the question row.
  const answered = fm.recording.steps.findIndex((s) => s.k === 'log' && s.event.kind === 'answered');
  await stage(answered + 1);
  await expect(question.getByTestId('question-overlay')).toHaveText(/Mockups→Stop it/);
  await expect(question).not.toContainText('Waiting for your answer');
});

test("an async question whose request was withdrawn unanswered reads as withdrawn, its card gone, not as waiting", async ({ page, hub }) => {
  const { fm, view } = await openSession(page, hub);
  const stage = logStager(hub, fm);
  const raised = fm.playThrough((s) => s.k === 'raised' && s.draft.tool === ASK);
  if (raised?.k !== 'raised') throw new Error('the recording raises no async question');
  const asked = fm.recording.steps.findIndex((s) => s.k === 'log' && s.event.kind === 'question');
  await stage(Math.max(fm.played, asked + 1));
  await hub.raise(PROJECT, MACHINE, { ...raised.draft, session: fm.session });
  const question = view.locator('[data-row-id^="question:toolu_01ptPa1uE4qkTexQaiwjlnsO"]');
  await expect(question).toContainText('Waiting for your answer · below');
  // The turn is aborted: the bridge settles the request with no answer used (DX4 `withdrawn`).
  await hub.settle(PROJECT, MACHINE, fm.session, { request: raised.draft.request, winner: 'other', outcome: 'withdrawn', by: 'bridge' });
  await expect(view.locator(`[data-tail-request="${raised.draft.request}"]`)).toHaveCount(0);
  await expect(question.getByTestId('question-withdrawn')).toHaveText('Withdrawn: the session moved on without an answer');
  await expect(question).not.toContainText('Waiting');
});

test('an async question raised again when its session resumes waits on its card again, after a reload too, and its answer settles it', async ({ page, hub }) => {
  const { fm, view } = await openSession(page, hub);
  const stage = logStager(hub, fm);
  const raised = fm.playThrough((s) => s.k === 'raised' && s.draft.tool === ASK);
  if (raised?.k !== 'raised') throw new Error('the recording raises no async question');
  const asked = fm.recording.steps.findIndex((s) => s.k === 'log' && s.event.kind === 'question');
  await stage(Math.max(fm.played, asked + 1));
  const draft = { ...raised.draft, session: fm.session };
  const card = view.locator(`[data-tail-request="${draft.request}"]`);
  const question = view.locator('[data-row-id^="question:toolu_01ptPa1uE4qkTexQaiwjlnsO"]');
  await hub.raise(PROJECT, MACHINE, draft);
  await expect(card.getByRole('button', { name: 'Submit' })).toBeVisible();
  // Its process ends: the bridge withdraws it.
  await hub.settle(PROJECT, MACHINE, fm.session, { request: draft.request, winner: 'other', outcome: 'withdrawn', by: 'bridge' });
  await expect(card).toHaveCount(0);
  await expect(question.getByTestId('question-withdrawn')).toBeVisible();
  // Resumed: its bridge raises the still-open ask again under its call's id.
  await hub.raise(PROJECT, MACHINE, draft);
  await expect(card.getByRole('button', { name: 'Submit' })).toBeVisible();
  await expect(question).toContainText('Waiting for your answer · below');
  // A reload takes the withdrawal again from the audit record's replay: the raise again still outranks it.
  await page.reload();
  await expect(view).toHaveAttribute('data-session', fm.session);
  await expect(card.getByRole('button', { name: 'Submit' })).toBeVisible();
  await expect(question).toContainText('Waiting for your answer · below');

  await card.getByRole('radio', { name: 'Stop it' }).click();
  await card.getByRole('button', { name: 'Submit' }).click();
  await expect.poll(() => hub.rpcs(PROJECT).length).toBe(1);
  const answer = hub.rpcs(PROJECT)[0];
  expect(answer).toMatchObject({ rpc: 'answer', machine: MACHINE, args: { session: fm.session, answers: { 'Keep the mockup server running once the suites finish?': 'Stop it' } } });
  hub.answerRpc(PROJECT, answer.nonce, { state: 'done', result: {} });
  await hub.settle(PROJECT, MACHINE, fm.session, { request: draft.request, winner: 'web', outcome: 'answered', by: DOUBLE_MEMBER.id });
  await expect(card).toHaveCount(0);
  await expect(question).not.toContainText('Waiting for your answer · below');
});

test('a send from the composer stays at the tail, queued then delivered, until its own framed row arrives; a terminal prompt with its words never takes its place', async ({ page, hub }) => {
  const { fm, view } = await openSession(page, hub);
  // Up to the session at rest after the answer's turn, so Send delivers it as a turn of its own.
  const idle = fm.recording.steps.findIndex((s, i) => i > 0 && s.k === 'presence' && s.at > 18_000 && (s.record as { status?: string } | null)?.status === 'idle');
  fm.step(idle + 1);
  await expect(view).toHaveAttribute('data-at-rest', '');
  const text = 'Run the suites once more.';
  await page.getByRole('textbox', { name: `Message ${ALIAS}` }).fill(text);
  await page.getByTestId('composer').getByRole('button', { name: 'Send' }).click();
  const send = tailSends(view);
  await expect(send).toHaveCount(1);
  await expect.poll(() => hub.logOf(PROJECT).some((e) => e.event.text === text)).toBe(true);
  const event = hub.logOf(PROJECT).find((e) => e.event.text === text)!.event;
  await expect(send).toHaveAttribute('data-state', 'queued');
  await expect(send.getByTestId('delivery-foot')).toHaveText('◷Queued · delivers when the session is idle');

  await hub.deliver(PROJECT, MACHINE, { event: { writer: event.writer, seq: event.seq }, session: fm.session, outcome: 'delivered', reason: 'submitted to the session' });
  await expect(send).toHaveAttribute('data-state', 'delivered');
  await expect(send.getByTestId('delivery-foot')).toHaveText('✓Delivered · waiting in the session’s queue');
  await shot(view, 'tail-delivered');

  // A prompt typed at the terminal with the same words is not the send's row.
  const last = fm.recording.rows.main.at(-1)!;
  // The engine marks each prompt's provenance: typed at the terminal, or submitted by the bridge as the user's.
  const userRow = (uuid: string, content: string, origin: JsonObject) => ({ type: 'user', uuid, parentUuid: last.uuid, isSidechain: false, timestamp: new Date().toISOString(), sessionId: fm.session, origin, message: { role: 'user', content } });
  fm.depth.apply({ at: 0, k: 'row', agentId: null, row: userRow('typed-row', text, { kind: 'human' }) as never });
  const prompts = view.locator('[data-kind="user"]').filter({ hasText: text });
  await expect(prompts).toHaveCount(1);
  await expect(send).toHaveCount(1);

  // Typed with the frame's own first line, it is still not the send's.
  const frame = `[sminos chat MAWS ${event.writer}:${event.seq} from human → @you]\n${text}`;
  fm.depth.apply({ at: 0, k: 'row', agentId: null, row: userRow('typed-frame', frame, { kind: 'human' }) as never });
  await expect(prompts).toHaveCount(2);
  await expect(send).toHaveCount(1);

  // Its own row, the frame sminos pushed as the bridge submitted it, replaces it: drawn once.
  fm.depth.apply({ at: 0, k: 'row', agentId: null, row: userRow('framed-row', frame, { kind: 'plugin', name: 'doperpowers', asUser: true }) as never });
  await expect(send).toHaveCount(0);
  await expect(prompts).toHaveCount(3); // the two typed ones and the send's own
});

test('a long send at the tail folds as MAWS folds a bubble, and offers Show more once the center narrows', async ({ page, hub }) => {
  const { view } = await openSession(page, hub);
  const sentence = 'The suites ran green on the mini; the jobs view draws the shell and its output under its row. ';
  const text = Array.from({ length: 6 }, (_, i) => `Part ${i + 1}: ${sentence}`).join('\n\n');
  await page.getByRole('textbox', { name: `Message ${ALIAS}` }).fill(text);
  await page.getByTestId('composer').getByRole('button', { name: 'Send' }).click();
  const send = tailSends(view);
  await expect(send).toHaveCount(1);
  const more = send.getByRole('button', { name: 'Show more' });
  await expect(send).toContainText('Part 6: The suites ran green');
  await expect(more).toHaveCount(0); // it fits at this width
  await view.evaluate((el) => {
    (el as HTMLElement).style.maxWidth = '380px'; // the center narrows (the column widens, the window shrinks)
  });
  await expect(more).toBeVisible();
  await more.click();
  await expect(send.getByRole('button', { name: 'Show less' })).toBeVisible();
});

test("where the session view cannot draw, the channel is the log's, its working record a label: a machine offline, a machine that serves no transcript for the session", async ({ page, hub }) => {
  await stageProject(hub);
  await hub.append(PROJECT, { writer: `mini/${S.asks}`, kind: 'message', from: 'maws-45', to: 'host', text: 'the store is split', src: 'r5#0' });
  await seedKey(page, hub);
  await page.goto(`${hub.url}/p/${PROJECT}/s/${S.asks}`);
  const center = page.getByRole('region', { name: 'Channel' });
  await expect(page.getByTestId('session-view')).toBeVisible();

  // mini answers the subscription at n 0 with `session-ended`: it holds no transcript for the session.
  await expect.poll(() => hub.subscriptions(PROJECT).filter((s) => s.session === S.asks).length).toBe(1);
  const { sub } = hub.subscriptions(PROJECT).find((s) => s.session === S.asks)!;
  hub.sendSub(PROJECT, sub, 'end', { reason: 'session-ended' });
  await expect(center.getByTestId('no-transcript')).toContainText('mini serves no transcript for this session');
  await expect(center.getByTestId('session-view')).toHaveCount(0);
  await expect(center).toContainText('the store is split');
  await expect(center.getByTestId('working-record').first()).toHaveText('Working record · no transcript on mini');
  await expect(center.getByRole('button', { name: /working record/i })).toHaveCount(0);

  // The machine goes offline: the log's channel, the record "on" the machine that is away.
  hub.dropMachine(PROJECT, 'mini');
  await expect(page.getByTestId('machine-offline')).toBeVisible();
  await expect(center.getByTestId('working-record').first()).toHaveText('Working record · mini is offline');
  await expect(center).toContainText('the store is split');
});

test('two ended sessions under one name: each row carries its id and the seat says so; Resume is offered only where the machine serves the transcript', async ({ page, hub }) => {
  // The owner's desk, 2026-10-19: the seat, titled, and a transcript-less `--bg` copy the daemon renamed after it,
  // its end recorded as `ended`. The copy joined later, so it is listed first under Ended.
  const SEAT = 'a6dee14b-4df3-47aa-93ff-4565c2f76077';
  const COPY = 'a5b99a8b-0ebe-4f5f-b6c0-b8bc32c64e0b';
  await stageProject(hub);
  const joined = { kind: 'joined', name_source: 'user', machine: 'mini', cwd: '/tmp/scratch', worktree: '', role: '', by: '' };
  await hub.append(PROJECT, { ...joined, writer: `mini/${SEAT}`, session: SEAT, alias: 'acc-ask71', name_source: 'seat', seat: SEAT });
  await hub.append(PROJECT, { writer: `mini/${SEAT}`, kind: 'titled', session: SEAT, title: 'acc-ask71' });
  await hub.append(PROJECT, { ...joined, writer: `mini/${COPY}`, session: COPY, alias: 'a5b99a8b', name_source: 'derived', seat: '' });
  await hub.append(PROJECT, { writer: `mini/${COPY}`, kind: 'renamed', session: COPY, alias: 'acc-ask71', name_source: 'user' });
  await hub.append(PROJECT, { writer: `mini/${COPY}`, kind: 'retired', session: COPY, by: '', reason: 'ended' });
  for (const session of [SEAT, COPY]) hub.sendSession(PROJECT, { project: PROJECT, machine: 'mini', session, kind: 'presence', sub: null, n: null, body: { record: null, bridge: false } });
  await seedKey(page, hub);
  await page.goto(`${hub.url}/p/${PROJECT}/s/${COPY}`);

  const ended = page.getByRole('navigation', { name: 'Channels' }).locator('[data-group="ended"]');
  await expect(ended.locator('[data-session]')).toHaveCount(3); // the two, and the retired doperpowers-1e
  await expect(ended.locator(`[data-session="${COPY}"]`)).toHaveText('acc-ask71#a5b99a8b@mini');
  await expect(ended.locator(`[data-session="${SEAT}"] [data-testid="session-short"]`)).toHaveText('#a6dee14b');
  await expect(ended.locator(`[data-session="${SEAT}"] [data-testid="seat-mark"]`)).toHaveText('seat');
  await expect(ended.locator(`[data-session="${COPY}"] [data-testid="seat-mark"]`)).toHaveCount(0);
  await expect(ended.locator(`[data-session="${S.gone}"] [data-testid="session-short"]`)).toHaveCount(0); // a name no other shares

  // The copy: mini answers its subscription at n 0 with `session-ended`, holding no transcript of it.
  const header = page.getByTestId('channel-header');
  await expect(header.getByTestId('session-short')).toHaveText('#a5b99a8b');
  await expect(header.getByRole('button', { name: 'Resume' })).toBeDisabled(); // not known yet
  await expect.poll(() => hub.subscriptions(PROJECT).filter((s) => s.session === COPY).length).toBe(1);
  hub.sendSub(PROJECT, hub.subscriptions(PROJECT).find((s) => s.session === COPY)!.sub, 'end', { reason: 'session-ended' });
  await expect(page.getByTestId('no-transcript')).toContainText('mini serves no transcript for this session');
  await expect(page.getByTestId('no-transcript')).toContainText('Resume is not offered: it needs that transcript.');
  await expect(header.getByRole('button', { name: 'Resume' })).toBeDisabled();
  await expect(header.getByRole('button', { name: 'Resume' })).toHaveAttribute('title', 'mini serves no transcript of acc-ask71 to resume');
  await expect(page.getByTestId('composer-note')).toHaveText('recorded, not delivered: mini serves no transcript of it to resume');

  // The seat. An empty snapshot says nothing yet (the machine sends one for a session whose transcript it has not
  // found); its first row says its transcript is served, and its Resume sends the seat's own id.
  await ended.locator(`[data-session="${SEAT}"]`).click();
  await expect.poll(() => hub.subscriptions(PROJECT).filter((s) => s.session === SEAT).length).toBe(1);
  const seatSub = hub.subscriptions(PROJECT).find((s) => s.session === SEAT)!.sub;
  hub.sendSub(PROJECT, seatSub, 'snapshot', { rows: [], more: false, subagents: [], presence: { record: null, bridge: false }, streaming: [] });
  await expect(header.getByTestId('seat-mark')).toHaveText('seat');
  await expect(page.getByTestId('session-view')).toBeVisible();
  await expect(header.getByRole('button', { name: 'Resume' })).toBeDisabled();
  await expect(header.getByRole('button', { name: 'Resume' })).toHaveAttribute('title', "offered once mini serves acc-ask71's transcript");
  const prompt = { type: 'user', uuid: 'row-seat-1', parentUuid: null, isSidechain: false, timestamp: '2026-10-19T12:47:00.000Z', sessionId: SEAT, message: { role: 'user', content: 'Ask me one question and wait.' } };
  hub.sendSub(PROJECT, seatSub, 'row', { row: prompt, agentId: null });
  await expect(header.getByRole('button', { name: 'Resume' })).toBeEnabled();
  await header.getByRole('button', { name: 'Resume' }).click();
  await expect.poll(() => hub.rpcs(PROJECT).map((r) => [r.rpc, r.args])).toEqual([['resume', { session: SEAT }]]);
});

test("a notification's landing on a request opens the session view at its card, marked", async ({ page, hub }) => {
  await stageProject(hub);
  await hub.raise(PROJECT, 'mini', { request: 'toolu_landed', session: S.asks, tool: 'Bash', input: { command: 'pnpm e2e' } });
  await seedKey(page, hub);
  await page.goto(`${hub.url}/p/${PROJECT}/s/${S.asks}?request=toolu_landed`);
  const card = page.getByTestId('session-view').locator('[data-tail-request="toolu_landed"]');
  await expect(card).toHaveAttribute('data-landed', '');
  await expect(card).toBeInViewport();
  await expect(page.getByTestId('landing')).toHaveCount(0); // found: nothing to say
});
