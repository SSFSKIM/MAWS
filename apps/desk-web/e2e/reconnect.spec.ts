// Desk ticket #57's acceptance, in a real browser against DC3's fake machine (`fake-machine.ts`): a reconnect in the
// middle of a response is invisible to the reader of the session view. The browser's socket drops, or the machine's
// stream to the hub is replaced while its lease holds (the hub ends its subscriptions `machine-offline`, the session
// staying reachable); either way, from the disruption until the stream has resumed, every DOM change is watched: the
// rows drawn never go to none, nothing says "Reconnecting" or "Unavailable" (neither the pane's lines nor the header's
// word), each row in view before is the same element after (no remount, no reload), and the older rows the reader paged
// in before stay drawn without being asked for again; then the answer streams to its end, drawn once, and a reload draws
// the same rows. A disruption that outlasts the quiet window is said (`depth.spec.ts`, under a fast-forwarded clock).
import { revealEarlier } from './transcript-history';
import type { Locator, Page } from '@playwright/test';
import type { Step } from 'desk-hub/fake-machine';
import { FakeMachineReplay } from './fake-machine';
import { expect, seedKey, test } from './fixtures';
import { PROJECT, stageProject } from './scene';
import type { HubDouble } from '../test/double/hub-double';

const MACHINE = 'fake';
const ANSWER = 'You chose blue';
const FIRST_PROMPT = 'Do these four steps';
/** About 6 KB of rows a snapshot: the recording's newest five rows before its answer, the rest paged in. */
const BUDGET = 6000;

const streamingRows = (scope: Locator) => scope.locator('[data-row-id^="desk-stream:"]');
const rowIds = (scope: Locator) => scope.locator('[data-row-id]').evaluateAll((els) => els.map((el) => el.getAttribute('data-row-id')));
const occurrences = (scope: Locator, text: string) => scope.evaluate((el, t) => (el.textContent ?? '').split(t).length - 1, text);
const rowsAsked = (hub: HubDouble) => hub.up.filter((u) => u.frame.t === 'rows').length;
const subscribes = (hub: HubDouble, session: string) => hub.up.filter((u) => u.frame.t === 'subscribe' && u.frame.session === session && u.frame.agentId === null).length;

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

/** The recorded `<message>` answer's row. */
const answerRow = (replay: FakeMachineReplay) => replay.recording.rows.main.find((row) => JSON.stringify(row.message ?? {}).includes('<message>You chose'))!.uuid;

/**
 * The fake machine enrolled with its session joined and run up to its `<message>` answer, every snapshot cut to the
 * budget, and the browser on that session's channel.
 */
async function openMidSession(page: Page, hub: HubDouble): Promise<{ fm: FakeMachineReplay; view: Locator }> {
  await stageProject(hub);
  const replay = (fm = new FakeMachineReplay(hub, { project: PROJECT, machine: MACHINE }, { budget: BUDGET }));
  const policy = { read_only: false, ceiling: 'default' };
  hub.setMachines(PROJECT, [
    { machine: 'mini', online: true, policy, checkouts: [] },
    { machine: 'SK.local', online: true, policy, checkouts: [] },
    { machine: MACHINE, online: true, policy, checkouts: [{ path: replay.recording.cwd, branch: 'main' }] },
  ]);
  await hub.append(PROJECT, { writer: `${MACHINE}/${replay.session}`, kind: 'joined', session: replay.session, alias: 'fakerec', name_source: 'user', machine: MACHINE, cwd: replay.recording.cwd, worktree: '', role: '', seat: '', by: '' });
  replay.sendPresence();
  replay.step(replay.firstChunkOf(answerRow(replay)) - replay.played); // the session has run up to its answer
  await seedKey(page, hub);
  await page.goto(`${hub.url}/p/${PROJECT}/s/${replay.session}`);
  const view = page.getByTestId('session-view');
  await expect(view).toHaveAttribute('data-session', replay.session);
  await expect.poll(() => replay.subscriptions()).toBe(1);
  return { fm: replay, view };
}

/** The reader scrolls to the top until the session's first prompt is drawn, paging older rows in; then back to the end. */
async function pageInAndReturn(hub: HubDouble, view: Locator): Promise<void> {
  const scroller = view.locator('[data-transcript-scroller]');
  const first = view.locator('[data-row-id^="user:"]').filter({ hasText: FIRST_PROMPT });
  await expect
    .poll(
      async () => {
        await scroller.evaluate(async (el) => {
          el.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -200 }));
          if (el.scrollTop !== 0) {
            // The list's capture listener reads this scroll before the helper can issue its inverse command.
            await new Promise<void>((resolve) => {
              el.addEventListener('scroll', () => resolve(), { once: true });
              el.scrollTo({ top: 0 });
            });
          } else el.scrollTo({ top: 0 });
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        });
        return first.count();
      },
      { timeout: 15_000 },
    )
    .toBeGreaterThan(0);
  expect(rowsAsked(hub)).toBeGreaterThanOrEqual(1); // the snapshot was cut short: the prompt came by a page
  const jump = view.getByRole('button', { name: 'Jump to latest' });
  await expect
    .poll(async () => {
      await scroller.evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
      return jump.isVisible();
    })
    .toBe(false);
}

/**
 * Plays into the `<message>` answer until some of it is drawn as streaming text. The session was run up to the answer's
 * first chunk, so no streaming row may be drawn yet: the last one's text is read without waiting for one.
 */
async function midAnswer(replay: FakeMachineReplay, view: Locator): Promise<void> {
  const lastStreamed = () => streamingRows(view).evaluateAll((els) => els.at(-1)?.textContent ?? '');
  for (let i = 0; i < 40 && !(await lastStreamed()).includes('You chose'); i++) {
    replay.step(1);
    await view.page().waitForTimeout(20);
  }
  await expect(streamingRows(view).last()).toContainText('You chose');
}

type Watched = { looks: number; fewestRows: number; said: string[]; remounted: string[]; kept: number };

/**
 * From now until `stop`, every DOM change the session view goes through: the fewest rows it drew, and whatever said a
 * disruption — the pane's reconnecting or unavailable line, or a word in the header's status. The rows in view now are
 * remembered by element, so `stop` can say which of them, still in view, are not the same element.
 */
async function watch(page: Page): Promise<() => Promise<Watched>> {
  await page.evaluate(() => {
    const view = () => document.querySelector('[data-testid="session-view"]');
    const inView = (el: Element) => {
      const box = view()?.querySelector('[data-transcript-scroller]')?.getBoundingClientRect();
      const rect = el.getBoundingClientRect();
      return box !== undefined && rect.bottom > box.top && rect.top < box.bottom && rect.height > 0;
    };
    const kept = new Map<string, Element>();
    for (const el of view()?.querySelectorAll('[data-row-id]') ?? []) if (inView(el)) kept.set(el.getAttribute('data-row-id')!, el);
    const record = { looks: 0, fewestRows: Number.POSITIVE_INFINITY, said: new Set<string>() };
    const look = () => {
      record.looks += 1;
      record.fewestRows = Math.min(record.fewestRows, view()?.querySelectorAll('[data-row-id]').length ?? 0);
      for (const id of ['depth-reconnecting', 'depth-unavailable']) if (document.querySelector(`[data-testid="${id}"]`)) record.said.add(id);
      const status = document.querySelector('[data-testid="session-status"]')?.textContent ?? '';
      if (status !== '') record.said.add(`status: ${status}`);
    };
    const observer = new MutationObserver(look);
    observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
    look();
    (window as unknown as { __unwatch: () => Watched }).__unwatch = () => {
      observer.disconnect();
      look();
      const remounted: string[] = [];
      let compared = 0;
      for (const [id, el] of kept) {
        const now = view()?.querySelector(`[data-row-id="${CSS.escape(id)}"]`);
        if (!now || !inView(now)) continue;
        compared += 1;
        if (now !== el) remounted.push(id);
      }
      return { looks: record.looks, fewestRows: record.fewestRows, said: [...record.said], remounted, kept: compared };
    };
  });
  return () => page.evaluate(() => (window as unknown as { __unwatch: () => Watched }).__unwatch());
}

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

const nextTextChunk = (s: Step) => s.k === 'chunk' && s.agentId === null && s.chunk.kind === 'text';

for (const [disruption, disrupt] of [
  ["the browser's socket drops", (replay: FakeMachineReplay) => replay.drop()],
  ["the machine's stream to the hub is replaced while its lease holds", (replay: FakeMachineReplay) => replay.replaceStream()],
] as const) {
  test(`when ${disruption} mid-response, the session view keeps its rows in place, says nothing, and the stream resumes`, async ({ page, hub }) => {
    const { fm, view } = await openMidSession(page, hub);
    await pageInAndReturn(hub, view);
    await midAnswer(fm, view);
    const asked = rowsAsked(hub);
    const subscribed = subscribes(hub, fm.session);
    const drawn = (await streamingRows(view).last().textContent()) ?? '';

    const stop = await watch(page);
    disrupt(fm);
    await expect.poll(() => subscribes(hub, fm.session)).toBe(subscribed + 1); // taken up again, at once
    await expect.poll(() => fm.subscriptions()).toBe(1);
    // The stream resumes: the next chunks are drawn on from where the answer was.
    fm.playThrough(nextTextChunk);
    fm.playThrough(nextTextChunk);
    await expect.poll(async () => ((await streamingRows(view).last().textContent()) ?? '').length).toBeGreaterThan(drawn.length);
    await page.waitForTimeout(300); // the transcript rebuilt from the fresh snapshot is installed within a frame or two
    const watched = await stop();

    expect(watched.looks).toBeGreaterThan(1);
    expect(watched.fewestRows).toBeGreaterThan(0);
    expect(watched.said).toEqual([]);
    expect(watched.kept).toBeGreaterThan(0);
    expect(watched.remounted).toEqual([]);
    expect(await occurrences(view, 'You chose')).toBe(1);

    // The older rows the reader paged in are still drawn, and were not asked for again.
    const scroller = view.locator('[data-transcript-scroller]');
    await scroller.evaluate((el) => { el.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -200 })); el.scrollTo({ top: 0 }); });
    await expect(view.locator('[data-row-id^="user:"]').filter({ hasText: FIRST_PROMPT })).toHaveCount(1);
    await page.waitForTimeout(300);
    expect(rowsAsked(hub)).toBe(asked);
    await scroller.evaluate((el) => el.scrollTo({ top: el.scrollHeight }));

    fm.playThrough();
    await expect(streamingRows(view)).toHaveCount(0);
    await expect.poll(() => occurrences(view, ANSWER)).toBe(1);
    const settled = await allRowIds(view);
    await page.reload();
    await revealEarlier(view, view.locator('.owner-message-ink').filter({ hasText: ANSWER }));
    await expect(view).toContainText(ANSWER);
    expect(await occurrences(view, ANSWER)).toBe(1);
    await expect.poll(() => allRowIds(view), { timeout: 15_000 }).toEqual(settled);
  });
}
