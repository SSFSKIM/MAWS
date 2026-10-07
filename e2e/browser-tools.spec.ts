// E4c's `browser-tools` group (docs/doperpowers/plans/2026-10-06-e4c-browser-tools.md, Acceptance G1 and G2, Design
// §6 to §10, §13): the agent's browser tools on the real Electron, against E4c's server on the fixed loopback port
// (support/browser-tools-server.ts), in the product app over the replay.
//
// (generator) under MAWS_E4C_GENERATE=1 only: the live recording's call sequence through the e2e seam, its two
// snapshots written to test/fixtures/browser/{form,done}.snapshot.txt, which the recording's stand-in answers from;
// (1) the precondition of the replay: a fresh launch running the same sequence mints the same tab id and yields the
// fixtures byte for byte (Playwright numbers refs by traversal order in one document under one connection sequence),
// so a drift fails here rather than deep in the replay;
// (2) G1: the live recording (pass3/p1-maws-browser.jsonl) replayed against the real app: main's live answers, the page,
// the seven rows, the screenshot's record, the Browser tool following the agent, the agent's cursor in the page;
// (2b) the same replay with a sheet over the Email fill and the person holding the page at the Submit click: the rows'
// waiting lines, the chrome's "You have the page", Hand back on the engine's path (and the evidence shots);
// (3) to (6) G2 and the OOPIF item through the seam: the person's click during an act's readiness wait, Hand back, no
// takeover without an agent, a human click into a cross-site frame and the agent's own;
// (7) the cover through the seam, and a viewport screenshot under the palette;
// (8) unplaced tabs: never placed, released, a person's ⌘-click background tab (parking, Decision Log 43, 71) and the
// dialog answered while it was hidden (Decision Log 44 (a));
// (9) cancellation at the pause point;
// (10) pages that ask: alert and confirm under agent control, an adopted pop-up's alert and the cursor there (Decision
// Log 35, 60, 73), a download link (A-31).
// Runs under `pnpm e2e:browser-tools` (a harness build, MAWS_HARNESS=1 for playwright.config.ts's list); each launch
// passes MAWS_HARNESS=0, so the window is the product app. MAWS_E4C_SHOTS=1 writes the evidence shots of (2b).
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { BROWSER_HANDBACK_IDLE_MS } from '@shared/browser/tab';
import type { AppSessionId } from '@shared/graph/ids';
import { BROWSER_TOOL_ERRORS } from '@shared/maws/browser';
import { browserIn, chipOf, expectOnPane, noticesIn, pageAt, paneIn, paneRect, showPane, tabAt, tabsOf, tabState, viewOf, type BrowserScene } from './support/browser-scene';
import {
  agentCancel,
  agentOk,
  agentRun,
  allowByCommand,
  bluePixels,
  browserToolsScene,
  controlOf,
  cursorMessages,
  FIRST_TAB_ID,
  humanClick,
  inputsOf,
  nextPermission,
  ORDER,
  progressOf,
  readSnapshotFixture,
  recordedSequence,
  recordProgress,
  refIn,
  running,
  shootE4c,
  SNAPSHOT_FIXTURES,
  waitsOf,
} from './support/browser-tools-scene';
import { allowNext, idle, mcpCalls, mcpResultOf, ofKind, PASS3, replay, show } from './support/deliverables-scene';
import { menu } from './support/menu';

test.describe.configure({ timeout: 180_000 });

const FIXTURE = `${PASS3}/p1-maws-browser.jsonl`;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PARKED = { x: 0, y: 0, width: 1280, height: 800 }; // agent/visible.ts PARKED_BOUNDS
const HANDBACK_MS = BROWSER_HANDBACK_IDLE_MS;
const doneUrl = (s: BrowserScene) => s.server.url(`/done.html?${new URLSearchParams({ name: ORDER.name, email: ORDER.email }).toString()}`); // the form's GET
const coveredOf = async (s: BrowserScene, tabId: string) => (await tabState(s, tabId)).tab?.covered;
const controlNow = async (s: BrowserScene, tabId: string) => (await controlOf(s, tabId))?.control;
const hasCursor = () => document.querySelector('maws-agent-cursor') !== null;

// The agent cursor's layer opacity as its inline style sets it ('1' shown, '0' hidden or faded), read over a CDP session:
// the overlay lives in a closed shadow root, which DOM.getDocument's pierce reaches and the page's own world cannot.
async function cursorLayerOpacity(page: Page): Promise<string | null> {
  const cdp = await page.context().newCDPSession(page);
  try {
    type Node = { nodeName: string; attributes?: string[]; children?: Node[]; shadowRoots?: Node[] };
    const { root } = (await cdp.send('DOM.getDocument', { depth: -1, pierce: true })) as { root: Node };
    const find = (node: Node): Node | null => (node.nodeName === 'MAWS-AGENT-CURSOR' ? node : [...(node.children ?? []), ...(node.shadowRoots ?? [])].map(find).find(Boolean) ?? null);
    const layer = find(root)?.shadowRoots?.[0]?.children?.find((child) => child.nodeName === 'DIV');
    const style = layer?.attributes?.[layer.attributes.indexOf('style') + 1] ?? '';
    return /(?:^|;)\s*opacity:\s*([^;!\s]+)/.exec(style)?.[1] ?? null;
  } finally {
    await cdp.detach();
  }
}

// The row of the session's k-th browser tool call (0-based), found by its tool use: the transcript is virtualized, so a
// position among the rows rendered is not the call's.
async function browserRow(s: BrowserScene, id: AppSessionId, k: number): Promise<Locator> {
  let toolUseId: string | undefined;
  await expect.poll(async () => (toolUseId = ofKind(await s.events(id), 'tool.use').filter((use) => use.toolName.startsWith('mcp__maws__browser_'))[k]?.toolUseId)).toBeDefined();
  return s.pane.locator(`[id$="-browser:${toolUseId!}"] section.transcript-browser-action`);
}

// The rows' headings for the recording's seven calls (Design §10; transcript/model/copy.ts): pages by host, elements by
// role and quoted name, a snapshot's size from the recorded result.
function recordedHeadings(s: BrowserScene): string[] {
  const host = new URL(s.server.origin).host;
  const chars = (which: 'form' | 'done') => readSnapshotFixture(which).length.toLocaleString('en-US');
  return [
    `Opened ${host}`,
    `Snapshot of ${host} (${chars('form')} chars)`,
    'Filled textbox "Name"',
    'Filled textbox "Email"',
    'Clicked button "Submit"',
    `Snapshot of ${host} (${chars('done')} chars)`,
    `Screenshot of ${host}`,
  ];
}

test('generator: the recording’s sequence writes the snapshot fixtures', async () => {
  test.skip(process.env.MAWS_E4C_GENERATE !== '1', 'writes the fixtures only under MAWS_E4C_GENERATE=1');
  await browserToolsScene(['E4c: generate'], async (s) => {
    const [id] = s.ids as [AppSessionId];
    await show(s, id);
    const { tabId, form, done } = await recordedSequence(s, id);
    expect(tabId).toBe(FIRST_TAB_ID);
    expect(form).toContain('textbox "Name"');
    expect(done).toContain(ORDER.reference);
    writeFileSync(SNAPSHOT_FIXTURES.form, form);
    writeFileSync(SNAPSHOT_FIXTURES.done, done);
  });
});

test('(1) precondition: a fresh launch’s real snapshots of /form.html and /done.html equal the fixtures', async () => {
  await browserToolsScene(['E4c: precondition'], async (s) => {
    const [id] = s.ids as [AppSessionId];
    await show(s, id);
    const { tabId, form, done } = await recordedSequence(s, id);
    expect(tabId).toBe(FIRST_TAB_ID);
    expect(form).toBe(readSnapshotFixture('form'));
    expect(done).toBe(readSnapshotFixture('done'));
  });
});

test('(2) G1: the recording replayed against the real app: main’s live answers, the form filled and submitted, seven rows, the screenshot’s record, the Browser tool on the tab, the agent’s cursor in the page', async () => {
  await browserToolsScene(['E4c: the replay'], async (s) => {
    const [id] = s.ids as [AppSessionId];
    const DONE = doneUrl(s);
    await show(s, id);
    await replay(s, id, FIXTURE);
    await allowNext(s, id); // browser_tabs open
    await allowNext(s, id); // browser_snapshot
    await allowNext(s, id); // browser_act fill Name
    // the agent's cursor drew in the form's page where it filled (the click below loads a new document, which has no
    // cursor until the agent's next pointer event there)
    const formPage = await pageAt(s, s.server.url('/form.html'));
    await expect.poll(() => formPage.evaluate(hasCursor)).toBe(true);
    await allowNext(s, id); // browser_act fill Email
    const actionRows = s.pane.locator('section.transcript-browser-action');
    await expect.poll(async () => ofKind(await s.events(id), 'maws.browser.action').length).toBe(4);
    // the Submit click's readiness wait, held a moment by the page's own script (an `input` event every 400 ms keeps the
    // button disabled; no input reaches the page, so nobody takes it): the row runs, with no waiting line
    await formPage.evaluate(() => {
      const email = document.querySelector('input[name="email"]')!;
      (window as unknown as { hold: number }).hold = window.setInterval(() => email.dispatchEvent(new Event('input')), 400);
    });
    await allowNext(s, id); // browser_act click Submit
    await expect((await browserRow(s, id, 4))).toHaveAttribute('data-state', 'running');
    await expect((await browserRow(s, id, 4)).locator('p[role="status"]')).toHaveCount(0);
    await shootE4c(s, 'row-running', { pane: paneIn(browserIn(s, 'panel')), page: formPage });
    await formPage.evaluate(() => clearInterval((window as unknown as { hold: number }).hold));
    await allowNext(s, id); // browser_snapshot
    await allowNext(s, id); // browser_screenshot
    await idle(s, id);

    // the host's live answers (main's, through the bridge), call by call
    const rows = s.journal(id);
    const calls = mcpCalls(rows);
    expect(calls.map((c) => [c.name, c.args.action ?? null, c.args.target ?? null])).toEqual([
      ['browser_tabs', 'open', null],
      ['browser_snapshot', null, null],
      ['browser_act', 'fill', 'e7'],
      ['browser_act', 'fill', 'e10'],
      ['browser_act', 'click', 'e12'],
      ['browser_snapshot', null, null],
      ['browser_screenshot', null, null],
    ]);
    const answers = calls.map((c) => mcpResultOf(rows, c.requestId)!);
    for (const answer of answers) expect(answer.isError).toBeUndefined();
    const text = (k: number, block: number) => (answers[k]!.content[block] as { type: 'text'; text: string }).text;
    expect(JSON.parse(text(0, 0))).toMatchObject({ status: 'ok', action: 'open', tabId: FIRST_TAB_ID, title: 'E4c order form' });
    expect(text(1, 1)).toBe(readSnapshotFixture('form'));
    expect(JSON.parse(text(4, 0))).toMatchObject({ action: 'click', target: { ref: 'e12' }, navigated: true, url: DONE, title: 'E4c order received', waitedFor: null });
    expect(text(5, 1)).toBe(readSnapshotFixture('done'));
    // the screenshot: the page as the panel shows it, the PNG first, then the result
    const shot = answers[6]!;
    expect(shot.content.map((b) => b.type)).toEqual(['image', 'text']);
    const png = Buffer.from((shot.content[0] as { data: string }).data, 'base64');
    expect(png.subarray(0, 8)).toEqual(PNG_SIGNATURE);
    const bounds = (await viewOf(s, FIRST_TAB_ID))!.bounds!;
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([bounds.width, bounds.height]); // IHDR, CSS px
    const captured = JSON.parse(text(6, 1)) as { deliverableId: string };
    expect(captured).toMatchObject({ status: 'ok', url: DONE, width: bounds.width, height: bounds.height, bytes: png.length, mimeType: 'image/png', fullPage: false, target: null });

    // the page itself, as the person sees it
    const donePage = await pageAt(s, DONE);
    await expect(donePage.locator('#reference')).toHaveText(`Thanks, ${ORDER.name}. Your reference is ${ORDER.reference}.`);

    // the rows (persistent: in view with the turn folded), the screenshot's with Open
    await expect(actionRows.locator('[data-browser-heading]')).toHaveText(recordedHeadings(s));
    await expect(actionRows).toHaveCount(7);
    for (let k = 0; k < 7; k++) await expect(actionRows.nth(k)).toHaveAttribute('data-state', 'done');
    await expect(actionRows.last().getByRole('button', { name: 'Open', exact: true })).toBeVisible();

    // X1: one event per call with no error; the screenshot's record on disk, with the page it shows, and its file
    const events = ofKind(await s.events(id), 'maws.browser.action');
    expect(events.map((e) => [e.tool, e.action, e.tabId, e.error])).toEqual(calls.map((c, k) => [c.name, ['open', 'snapshot', 'fill', 'fill', 'click', 'snapshot', 'screenshot'][k], FIRST_TAB_ID, null]));
    expect(events.at(-1)!.deliverableId).toBe(captured.deliverableId);
    const record = JSON.parse(readFileSync(join(s.maws.userData, 'deliverables', id, `${captured.deliverableId}.json`), 'utf8')) as { kind: string; sourceUrl: string; path: string };
    expect(record).toMatchObject({ id: captured.deliverableId, appSessionId: id, kind: 'screenshot', sourceUrl: DONE });
    expect(readFileSync(record.path)).toEqual(png);

    // the Browser tool followed the agent: open in the panel on the tab, the view on its pane
    const panel = browserIn(s, 'panel');
    await expect(panel).toBeVisible();
    expect((await tabsOf(s, id)).selected).toBe(FIRST_TAB_ID);
    await expectOnPane(s, FIRST_TAB_ID, paneIn(panel), 'panel');
  });
});

test('(2b) the replay under a sheet and under the person: the Email fill waits out the palette, the Submit click waits for the person, the rows say so, Hand back resumes it', async () => {
  await browserToolsScene(['E4c: the replay waits'], async (s) => {
    const [id] = s.ids as [AppSessionId];
    const tab = FIRST_TAB_ID;
    await show(s, id);
    await recordProgress(s);
    await replay(s, id, FIXTURE);
    await allowNext(s, id); // browser_tabs open
    await allowNext(s, id); // browser_snapshot
    await allowNext(s, id); // browser_act fill Name
    const actionRows = s.pane.locator('section.transcript-browser-action');
    await expect.poll(async () => ofKind(await s.events(id), 'maws.browser.action').length).toBe(3);
    const panel = browserIn(s, 'panel');
    const pane = paneIn(panel);
    const formPage = await pageAt(s, s.server.url('/form.html'));
    // the chip of the tab the agent holds carries the acting dot
    await expect(chipOf(panel, tab).locator('[data-browser-acting]')).toBeVisible();
    await shootE4c(s, 'acting-dot', { pane, page: formPage, clip: panel });

    // the Email fill under a sheet: the palette is up before the call reaches main (the request card is under it, so the
    // permission is answered through the card's own command); the fill waits the sheet out and the row says so
    const fillEmail = await nextPermission(s, id);
    await menu(s.maws.app, 'palette.open');
    await expect.poll(() => coveredOf(s, tab)).toBe(true);
    await allowByCommand(s, id, fillEmail);
    await expect((await browserRow(s, id, 3)).locator('p[role="status"]')).toHaveText(/^Waiting · a sheet covers the page · /);
    await expect.poll(() => waitsOf(s, tab)).toEqual(['cover']);
    await s.page.waitForTimeout(1_000);
    await s.page.keyboard.press('Escape');
    await expect.poll(() => coveredOf(s, tab)).toBe(false);
    // answered (the row is read at the end: while a request docks the transcript may not have every row mounted)
    await expect.poll(async () => ofKind(await s.events(id), 'maws.browser.action').length).toBe(4);

    // the Submit click while the person has the page: their click on the heading takes it from the agent; the call then
    // waits at its pause point, the row and the chrome say so; further clicks keep it theirs while the shots are taken
    const clickSubmit = await nextPermission(s, id);
    const person = () => humanClick(s, tab, formPage, 'h1');
    await person();
    await expect.poll(() => controlNow(s, tab)).toBe('human');
    const slot = panel.locator('[data-browser-control="human"]');
    await expect(slot).toContainText('You have the page');
    await allowByCommand(s, id, clickSubmit);
    await person();
    await expect((await browserRow(s, id, 4)).locator('p[role="status"]')).toHaveText(/^Waiting · you have the page · /);
    await expect((await browserRow(s, id, 4))).toHaveAttribute('data-state', 'running');
    await shootE4c(s, 'row-waiting', { pane, page: formPage, before: async () => void (await person()) });
    await shootE4c(s, 'chrome-human', { pane, page: formPage, clip: panel, before: async () => void (await person()) });
    await person();
    await slot.getByRole('button', { name: 'Hand back' }).click();
    await expect.poll(async () => ofKind(await s.events(id), 'maws.browser.action').length).toBe(5);
    await allowNext(s, id); // browser_snapshot
    await allowNext(s, id); // browser_screenshot
    await idle(s, id);

    // the rows as they stand: the fill says it waited under a sheet, the click that it waited for the person, no
    // waiting line left on either
    await expect(actionRows.locator('[data-browser-heading]')).toHaveText(recordedHeadings(s));
    await expect((await browserRow(s, id, 3)).locator('[data-browser-took]')).toContainText('under a sheet');
    await expect((await browserRow(s, id, 4)).locator('[data-browser-took]')).toContainText('for you');
    await expect(actionRows.locator('p[role="status"]')).toHaveCount(0);
    const events = ofKind(await s.events(id), 'maws.browser.action');
    expect(events.map((e) => [e.action, e.waitedFor, e.error])).toEqual([
      ['open', null, null],
      ['snapshot', null, null],
      ['fill', null, null],
      ['fill', 'cover', null],
      ['click', 'human', null],
      ['snapshot', null, null],
      ['screenshot', null, null],
    ]);
    expect(events[3]!.waitedMs).toBeGreaterThanOrEqual(900);
    expect(await waitsOf(s, tab)).toEqual(['cover', null, 'human', null]);
    await expect((await pageAt(s, doneUrl(s))).locator('#reference')).toContainText(ORDER.reference);
  });
});

// The recording's form, filled through the seam: the tab, its page and the Submit button's ref (Submit is disabled until
// 1.2 s after the Email field's last input).
async function filledForm(s: BrowserScene, id: AppSessionId) {
  const tab = (await agentOk(s, id, 'browser_tabs', { action: 'open', url: s.server.url('/form.html') })).result.tabId as string;
  await expectOnPane(s, tab, paneIn(browserIn(s, 'panel')), 'panel');
  const form = (await agentOk(s, id, 'browser_snapshot', { tabId: tab })).text!;
  await agentOk(s, id, 'browser_act', { tabId: tab, action: 'fill', target: refIn(form, 'textbox', 'Name'), value: ORDER.name });
  await agentOk(s, id, 'browser_act', { tabId: tab, action: 'fill', target: refIn(form, 'textbox', 'Email'), value: ORDER.email });
  return { tab, page: await pageAt(s, s.server.url('/form.html')), submit: refIn(form, 'button', 'Submit') };
}

test('(3) G2: the person’s click during an act’s readiness wait takes the page; the act waits at its pause point and resumes 3 s after the click', async () => {
  await browserToolsScene(['E4c: takeover'], async (s) => {
    const [id] = s.ids as [AppSessionId];
    await show(s, id);
    await recordProgress(s);
    const { tab, page, submit } = await filledForm(s, id);
    const click = running(agentRun(s, id, 'browser_act', { tabId: tab, action: 'click', target: submit }));
    await s.page.waitForTimeout(200);
    const clickedAt = await humanClick(s, tab, page, 'h1');
    // the person's press and release, attributed theirs; a request is pending, so the page is theirs
    await expect.poll(async () => (await inputsOf(s, tab)).slice(-2)).toEqual(['mouse/human', 'mouse/human']);
    await expect.poll(() => controlNow(s, tab)).toBe('human');
    const slot = browserIn(s, 'panel').locator('[data-browser-control="human"]');
    await expect(slot).toContainText('You have the page');
    await expect(slot.getByRole('button', { name: 'Hand back' })).toBeVisible();
    // the readiness wait ends (Submit enabled), and the act waits for the person
    await expect.poll(() => waitsOf(s, tab)).toEqual(['human']);
    expect(click.settledAt()).toBeNull();
    const answer = await click.promise;
    expect(answer).toMatchObject({ ok: true, result: { action: 'click', navigated: true, url: doneUrl(s), waitedFor: 'human' } });
    if (!answer?.ok) throw new Error('the click failed');
    expect(answer.result.waitedMs as number).toBeGreaterThanOrEqual(1_500);
    expect(click.settledAt()! - clickedAt).toBeGreaterThanOrEqual(HANDBACK_MS - 100);
    expect(click.settledAt()! - clickedAt).toBeLessThan(HANDBACK_MS + 1_500);
    test.info().annotations.push({ type: 'resolved after the click (ms)', description: String(click.settledAt()! - clickedAt) });
    expect(await waitsOf(s, tab)).toEqual(['human', null]);
    expect(await controlNow(s, tab)).toBe('agent');
    await expect(slot).toHaveCount(0);
  });
});

test('(4) G2: Hand back during the wait resumes the act at once', async () => {
  await browserToolsScene(['E4c: hand back'], async (s) => {
    const [id] = s.ids as [AppSessionId];
    await show(s, id);
    await recordProgress(s);
    const { tab, page, submit } = await filledForm(s, id);
    const click = running(agentRun(s, id, 'browser_act', { tabId: tab, action: 'click', target: submit }));
    await s.page.waitForTimeout(200);
    const clickedAt = await humanClick(s, tab, page, 'h1');
    const slot = browserIn(s, 'panel').locator('[data-browser-control="human"]');
    await expect(slot).toContainText('You have the page');
    await expect.poll(() => waitsOf(s, tab)).toEqual(['human']);
    await s.page.waitForTimeout(Math.max(0, clickedAt + 1_500 - Date.now()));
    expect(click.settledAt()).toBeNull();
    const handedBackAt = Date.now();
    await slot.getByRole('button', { name: 'Hand back' }).click();
    const answer = await click.promise;
    if (!answer?.ok) throw new Error(`the click failed: ${JSON.stringify(answer)}`);
    expect(answer.result).toMatchObject({ action: 'click', navigated: true, waitedFor: 'human' });
    // main's release: the wait began at the human progress event's `since` and lasted `waitedMs` (the run itself settles
    // later, after the click's navigation loads); within 500 ms of the button's press, well before the 3 s timer
    const human = (await progressOf(s, tab)).find((p) => p.waiting === 'human')!;
    const releasedAt = Date.parse(human.since) + (answer.result.waitedMs as number);
    test.info().annotations.push({ type: 'released after Hand back was pressed (ms)', description: String(releasedAt - handedBackAt) });
    expect(releasedAt - handedBackAt).toBeLessThan(500);
    expect(releasedAt - clickedAt).toBeLessThan(HANDBACK_MS - 500);
    expect(await controlNow(s, tab)).toBe('agent');
  });
});

test('(5) no agent, no takeover: a click on a page no agent holds leaves it idle; an act 1 s later waits out the rest of the 3 s', async () => {
  await browserToolsScene(['E4c: no agent'], async (s) => {
    const [id] = s.ids as [AppSessionId];
    await show(s, id);
    await recordProgress(s);
    const BACKGROUND = s.server.url('/background.html');
    await showPane(s, { appSessionId: id, requestId: 'e4c-show-5', target: BACKGROUND });
    const panel = browserIn(s, 'panel');
    const tab = await tabAt(s, id, BACKGROUND);
    await expectOnPane(s, tab, paneIn(panel), 'panel');
    const page = await pageAt(s, BACKGROUND);
    await agentOk(s, id, 'browser_snapshot', { tabId: tab }); // a read: the driver connects, `control` is untouched
    expect(await controlNow(s, tab)).toBe('idle');
    const clickedAt = await humanClick(s, tab, page, 'h1');
    await expect.poll(async () => (await inputsOf(s, tab)).slice(-2)).toEqual(['mouse/human', 'mouse/human']);
    await s.page.waitForTimeout(300);
    expect(await controlNow(s, tab)).toBe('idle');
    await expect(panel.locator('[data-browser-control]')).toHaveCount(0);
    await s.page.waitForTimeout(Math.max(0, clickedAt + 1_000 - Date.now()));
    const act = running(agentRun(s, id, 'browser_act', { tabId: tab, action: 'click', target: { css: '#count-button' } }));
    await expect.poll(() => controlNow(s, tab)).toBe('human');
    await expect(panel.locator('[data-browser-control="human"]')).toContainText('You have the page');
    const answer = await act.promise;
    expect(answer).toMatchObject({ ok: true, result: { action: 'click', waitedFor: 'human' } });
    expect(act.settledAt()! - clickedAt).toBeGreaterThanOrEqual(HANDBACK_MS - 100);
    expect(act.settledAt()! - clickedAt).toBeLessThan(HANDBACK_MS + 1_500);
    test.info().annotations.push({ type: 'resolved after the click (ms)', description: String(act.settledAt()! - clickedAt) });
    await expect(page.locator('#count')).toHaveText('1');
    expect(await waitsOf(s, tab)).toEqual(['human', null]);
  });
});

test('(6) the OOPIF item: a human click into a cross-site frame takes the page from a pending act, which resumes 3 s later; the agent’s own click into the frame is the agent’s', async () => {
  await browserToolsScene(['E4c: oopif'], async (s) => {
    const [id] = s.ids as [AppSessionId];
    await show(s, id);
    const EMBED = s.server.url('/embed.html');
    const tab = (await agentOk(s, id, 'browser_tabs', { action: 'open', url: EMBED })).result.tabId as string;
    await expectOnPane(s, tab, paneIn(browserIn(s, 'panel')), 'panel');
    const snapshot = (await agentOk(s, id, 'browser_snapshot', { tabId: tab })).text!;
    const frameButton = refIn(snapshot, 'button', 'Frame button');
    const frame = (await pageAt(s, EMBED)).frameLocator('iframe');
    await expect(frame.locator('#count')).toHaveText('0');
    // an eval holds the tab's queue for 1.5 s, so the act behind it is pending when the person clicks
    const evaluated = running(agentRun(s, id, 'browser_eval', { tabId: tab, expression: 'new Promise((resolve) => setTimeout(() => resolve(1), 1500))' }));
    const act = running(agentRun(s, id, 'browser_act', { tabId: tab, action: 'click', target: frameButton }));
    await expect.poll(() => controlNow(s, tab)).toBe('agent');
    // the e2e's own CDP input into the frame, outside the TabDebugger's table: the mouse rule reads it as the person's
    const clickedAt = Date.now();
    await frame.getByRole('button', { name: 'Frame button' }).click();
    await expect(frame.locator('#count')).toHaveText('1');
    await expect.poll(async () => (await inputsOf(s, tab)).slice(-2)).toEqual(['mouse/human', 'mouse/human']);
    await expect.poll(() => controlNow(s, tab)).toBe('human');
    const value = await evaluated.promise;
    expect(value, JSON.stringify(value)).toMatchObject({ ok: true, result: { value: 1 } });
    const answer = await act.promise;
    expect(answer).toMatchObject({ ok: true, result: { action: 'click', target: { ref: frameButton }, waitedFor: 'human' } });
    expect(act.settledAt()! - clickedAt).toBeGreaterThanOrEqual(HANDBACK_MS - 100);
    expect(act.settledAt()! - clickedAt).toBeLessThan(HANDBACK_MS + 1_500);
    // the agent's click into the frame: consumed from the in-flight table, the agent's
    await expect(frame.locator('#count')).toHaveText('2');
    expect((await inputsOf(s, tab)).slice(-2)).toEqual(['mouse/agent', 'mouse/agent']);
    expect(await controlNow(s, tab)).toBe('agent');
  });
});

test('(7) the cover: an act under the palette waits, uncounted, and resumes when it lifts; a viewport screenshot under the palette is the hidden view’s picture at the pane’s size, without the agent’s cursor', async () => {
  await browserToolsScene(['E4c: the cover'], async (s) => {
    const [id] = s.ids as [AppSessionId];
    await show(s, id);
    await recordProgress(s);
    const SLOW = s.server.url('/slow-button.html');
    const tab = (await agentOk(s, id, 'browser_tabs', { action: 'open', url: SLOW })).result.tabId as string;
    const pane = paneIn(browserIn(s, 'panel'));
    await expectOnPane(s, tab, pane, 'panel');
    const page = await pageAt(s, SLOW);
    const startedAt = Date.now();
    const act = running(agentRun(s, id, 'browser_act', { tabId: tab, action: 'click', target: { css: '#slow' } }));
    await s.page.waitForTimeout(300);
    await menu(s.maws.app, 'palette.open');
    await expect.poll(() => coveredOf(s, tab)).toBe(true);
    await expect.poll(() => waitsOf(s, tab)).toEqual(['cover']);
    // the button enabled at 3 s, under the sheet; the act still waits
    await s.page.waitForTimeout(Math.max(0, startedAt + 4_000 - Date.now()));
    expect(act.settledAt()).toBeNull();
    const liftedAt = Date.now();
    await s.page.keyboard.press('Escape');
    await expect.poll(() => coveredOf(s, tab)).toBe(false);
    const answer = await act.promise;
    expect(answer).toMatchObject({ ok: true, result: { action: 'click', waitedFor: 'cover' } });
    expect(act.settledAt()! - liftedAt).toBeLessThan(2_000);
    test.info().annotations.push({ type: 'resolved after the lift (ms)', description: String(act.settledAt()! - liftedAt) });
    await expect(page.locator('#count')).toHaveText('1');
    expect(await waitsOf(s, tab)).toEqual(['cover', null]);

    // Decision Log 77 (b): the cursor drew where the agent clicked (the page's own picture shows its blue: the detector
    // sees it when it is there)
    const seen = await bluePixels(s, { base64: (await page.screenshot()).toString('base64') });
    expect(seen.blue, 'the cursor is drawn before the cover').toBeGreaterThan(0);
    const bounds = (await viewOf(s, tab))!.bounds!;
    const rect = await paneRect(pane);
    // a fresh act draws it again; at once the palette covers the pane, and the overlay is still shown under the cover
    // (its idle fade has not begun), so the frame painted before the cover has the cursor in it: a capture without
    // cursor blue that still shows the page is a fresh frame, neither that stale one nor a blank one
    await agentOk(s, id, 'browser_act', { tabId: tab, action: 'click', target: { css: '#slow' } });
    await menu(s.maws.app, 'palette.open');
    await expect.poll(() => coveredOf(s, tab)).toBe(true);
    const overlay = await cursorLayerOpacity(page);
    expect(overlay, 'the cursor overlay is shown when the cover comes').toBe('1');
    const shot = await agentOk(s, id, 'browser_screenshot', { tabId: tab });
    const picture = await bluePixels(s, { path: shot.image!.path });
    expect([picture.width, picture.height]).toEqual([bounds.width, bounds.height]);
    expect(Math.abs(picture.width - rect.width) <= 1 && Math.abs(picture.height - rect.height) <= 1, JSON.stringify({ picture, rect })).toBe(true);
    expect(shot.result).toMatchObject({ width: bounds.width, height: bounds.height, mimeType: 'image/png', fullPage: false, target: null });
    expect(picture.blue, 'no cursor blue in the covered capture').toBe(0);
    expect(picture.dark, 'the covered capture shows the page (its text)').toBeGreaterThan(100);
    const raw = await s.maws.app.evaluate(async ({ screen, webContents }, url) => {
      const contents = webContents.getAllWebContents().find((w) => w.getURL() === url)!;
      const image = await contents.capturePage();
      return { capturePage: image.getSize(), scaleFactor: screen.getPrimaryDisplay().scaleFactor };
    }, SLOW);
    test.info().annotations.push({ type: 'covered capture', description: JSON.stringify({ answer: [picture.width, picture.height], seenBefore: [seen.width, seen.height, seen.blue], overlay, dark: picture.dark, ...raw }) });
    await s.page.keyboard.press('Escape');
    await expect.poll(() => coveredOf(s, tab)).toBe(false);
  });
});

// A tab no pane places, worked by the agent through the seam: a snapshot, a click on the element named, a viewport
// screenshot at the parked size, its file written and no record (the seam has no host, Decision Log 77 (c)); the view
// reads parked. `using` is the person's click on the shown tab right before the act, so the act leaves the selection
// where it is (Decision Log 6) and the tab stays unplaced.
async function actsWhileUnplaced(s: BrowserScene, id: AppSessionId, tabId: string, target: { role: string; name: string }, using: () => Promise<unknown>): Promise<void> {
  const snapshot = (await agentOk(s, id, 'browser_snapshot', { tabId })).text!;
  await using();
  const clicked = await agentOk(s, id, 'browser_act', { tabId, action: 'click', target: refIn(snapshot, target.role, target.name) });
  expect(clicked.result).toMatchObject({ action: 'click', target: { role: target.role, name: target.name } });
  expect(await viewOf(s, tabId)).toMatchObject({ bounds: PARKED, attached: false, owner: null });
  const shot = await agentOk(s, id, 'browser_screenshot', { tabId });
  expect(shot.result).toMatchObject({ width: PARKED.width, height: PARKED.height, mimeType: 'image/png', fullPage: false, target: null });
  expect(shot.image).toMatchObject({ width: PARKED.width, height: PARKED.height, mimeType: 'image/png' });
  const decoded = await bluePixels(s, { path: shot.image!.path });
  expect([decoded.width, decoded.height]).toEqual([PARKED.width, PARKED.height]); // the file itself, decoded
  expect(decoded.dark).toBeGreaterThan(0); // the page, not a blank picture
  expect(typeof shot.result.deliverableId).toBe('string');
  const records = join(s.maws.userData, 'deliverables', id);
  expect(existsSync(records) ? readdirSync(records).filter((name) => name.endsWith('.json')) : []).toEqual([]); // no record
  expect(await viewOf(s, tabId)).toMatchObject({ bounds: PARKED, attached: false, owner: null });
}

test('(8) unplaced tabs: one the agent opens while the person uses the shown tab, a released tab, a person’s ⌘-click background tab, each parked and worked; a pane’s claim unparks; a dialog answered while hidden is told when shown', async () => {
  await browserToolsScene(['E4c: unplaced'], async (s) => {
    const [id] = s.ids as [AppSessionId];
    await show(s, id);
    const panel = browserIn(s, 'panel');
    const pane = paneIn(panel);
    const FORM = s.server.url('/form.html');
    const SLOW = s.server.url('/slow-button.html');
    const LINKS = s.server.url('/links.html');
    const BACKGROUND = s.server.url('/background.html');

    // A, opened by the agent and shown in the panel; the person clicks it, and the agent's B is not selected
    const a = (await agentOk(s, id, 'browser_tabs', { action: 'open', url: FORM })).result.tabId as string;
    await expectOnPane(s, a, pane, 'panel');
    const formPage = await pageAt(s, FORM);
    const usingA = () => humanClick(s, a, formPage, 'h1');
    await usingA();
    const b = (await agentOk(s, id, 'browser_tabs', { action: 'open', url: SLOW })).result.tabId as string;
    expect((await tabsOf(s, id)).selected).toBe(a);
    await actsWhileUnplaced(s, id, b, { role: 'button', name: 'Slow button' }, usingA);
    await expect((await pageAt(s, SLOW)).locator('#count')).toHaveText('1');
    expect((await tabsOf(s, id)).selected).toBe(a);

    // B selected in the panel: the pane's claim supersedes the parking
    await chipOf(panel, b).getByRole('tab').click();
    await expectOnPane(s, b, pane, 'panel');
    // A, placed and painted until that selection released it (Decision Log 43): parked and worked as well
    await expect.poll(async () => (await viewOf(s, a))?.owner ?? null).toBeNull();
    const slowPage = await pageAt(s, SLOW);
    await actsWhileUnplaced(s, id, a, { role: 'textbox', name: 'Name' }, () => humanClick(s, b, slowPage, 'h1'));
    await expect.poll(() => formPage.evaluate(() => document.activeElement?.getAttribute('name') ?? null)).toBe('name');
    expect((await tabsOf(s, id)).selected).toBe(b);

    // C, opened as the engine's show_pane would (no agent), and the person's ⌘-click on its link: D in the background
    await showPane(s, { appSessionId: id, requestId: 'e4c-show-8', target: LINKS });
    const c = await tabAt(s, id, LINKS);
    await expectOnPane(s, c, pane, 'panel');
    const linksPage = await pageAt(s, LINKS);
    await linksPage.locator('#background').click({ modifiers: ['Meta'] });
    const d = await tabAt(s, id, BACKGROUND);
    expect((await tabsOf(s, id)).selected).toBe(c);
    const backgroundPage = await pageAt(s, BACKGROUND);
    await expect(backgroundPage.locator('#count')).toHaveText('0');
    expect(await viewOf(s, d)).toMatchObject({ bounds: { width: 0, height: 0 }, attached: false, owner: null }); // loaded, never placed
    // its page raises an alert while hidden and no agent holds it: answered with its default, the page's call returns
    await backgroundPage.evaluate(() => {
      setTimeout(() => {
        alert('Hello from the background');
        (window as unknown as { alertReturned: boolean }).alertReturned = true;
      });
    });
    await expect.poll(() => backgroundPage.evaluate(() => (window as unknown as { alertReturned?: boolean }).alertReturned === true)).toBe(true);
    await actsWhileUnplaced(s, id, d, { role: 'button', name: 'Count' }, () => humanClick(s, c, linksPage, 'h1'));
    await expect(backgroundPage.locator('#count')).toHaveText('1');
    expect((await tabsOf(s, id)).selected).toBe(c);

    // D selected: placed on the pane, and the chrome tells the person what the page asked while hidden
    await chipOf(panel, d).getByRole('tab').click();
    await expectOnPane(s, d, pane, 'panel');
    await expect(noticesIn(panel).filter({ hasText: 'While this tab was hidden the page showed an alert, which MAWS closed: “Hello from the background”' })).toBeVisible();
  });
});

test('(9) cancellation: an act waiting at its pause point under the person ends with no answer when its request is cancelled; the page is unchanged and the person keeps the page until the timer', async () => {
  await browserToolsScene(['E4c: cancel'], async (s) => {
    const [id] = s.ids as [AppSessionId];
    await show(s, id);
    await recordProgress(s);
    const BACKGROUND = s.server.url('/background.html');
    const tab = (await agentOk(s, id, 'browser_tabs', { action: 'open', url: BACKGROUND })).result.tabId as string;
    await expectOnPane(s, tab, paneIn(browserIn(s, 'panel')), 'panel');
    const page = await pageAt(s, BACKGROUND);
    const clickedAt = await humanClick(s, tab, page, 'h1');
    await expect.poll(() => controlNow(s, tab)).toBe('human');
    const act = running(agentRun(s, id, 'browser_act', { tabId: tab, action: 'click', target: { css: '#count-button' } }, { requestId: 'e4c-cancel-9' }));
    await expect.poll(() => waitsOf(s, tab)).toEqual(['human']);
    expect(await agentCancel(s, id, 'e4c-cancel-9')).toBe(true);
    expect(await act.promise).toBeNull();
    expect(act.settledAt()! - clickedAt).toBeLessThan(HANDBACK_MS);
    expect(await waitsOf(s, tab)).toEqual(['human', null]);
    await expect(page.locator('#count')).toHaveText('0');
    expect(await controlNow(s, tab)).toBe('human');
    await expect.poll(() => controlNow(s, tab), { timeout: 5_000 }).toBe('idle');
    await expect(page.locator('#count')).toHaveText('0');
  });
});

test('(10) pages that ask: alert and confirm under agent control answered and reported, an adopted pop-up’s alert likewise with the agent’s cursor drawn there, a download link refused', async () => {
  await browserToolsScene(['E4c: pages that ask'], async (s) => {
    const [id] = s.ids as [AppSessionId];
    await show(s, id);
    const DIALOGS = s.server.url('/dialogs.html');
    const tab = (await agentOk(s, id, 'browser_tabs', { action: 'open', url: DIALOGS })).result.tabId as string;
    await expectOnPane(s, tab, paneIn(browserIn(s, 'panel')), 'panel');
    const page = await pageAt(s, DIALOGS);
    const snapshot = (await agentOk(s, id, 'browser_snapshot', { tabId: tab })).text!;
    // the dialogs' type and message in the action's result; the page's calls returned (alert dismissed, confirm false)
    const alerted = await agentOk(s, id, 'browser_act', { tabId: tab, action: 'click', target: refIn(snapshot, 'button', 'Alert') });
    expect(alerted.result.dialogs).toEqual([{ type: 'alert', message: 'Hello from E4c' }]);
    await expect(page.locator('#alert-result')).toHaveText('alert returned');
    const confirmed = await agentOk(s, id, 'browser_act', { tabId: tab, action: 'click', target: refIn(snapshot, 'button', 'Confirm') });
    expect(confirmed.result.dialogs).toEqual([{ type: 'confirm', message: 'Proceed with E4c?' }]);
    await expect(page.locator('#confirm-result')).toHaveText('confirm: false');

    // the agent's click opens the pop-up, which E4a adopts as a tab (Electron reports no safeDialogs for it, the wrap's
    // test for adoption); the agent's act there draws its cursor and its alert is answered as on any tab it holds
    await agentOk(s, id, 'browser_act', { tabId: tab, action: 'click', target: refIn(snapshot, 'link', 'Open the pop-up') });
    const POPUP = s.server.url('/popup.html');
    const popup = await tabAt(s, id, POPUP);
    expect(popup).not.toBe(tab);
    const adopted = await s.maws.app.evaluate(
      ({ webContents }, url) => (webContents.getAllWebContents().find((w) => w.getURL() === url) as unknown as { getLastWebPreferences(): { safeDialogs?: boolean } }).getLastWebPreferences().safeDialogs !== true,
      POPUP,
    );
    expect(adopted, 'the pop-up is an adopted child').toBe(true);
    const popupPage = await pageAt(s, POPUP);
    const popupSnapshot = (await agentOk(s, id, 'browser_snapshot', { tabId: popup })).text!;
    const popupAlerted = await agentOk(s, id, 'browser_act', { tabId: popup, action: 'click', target: refIn(popupSnapshot, 'button', 'Alert from the pop-up') });
    expect(popupAlerted.result.dialogs).toEqual([{ type: 'alert', message: 'Hello from the pop-up' }]);
    await expect(popupPage.locator('#alerts')).toHaveText('1');
    expect(await cursorMessages(s, popup)).toBeGreaterThan(0);
    await expect.poll(() => popupPage.evaluate(hasCursor)).toBe(true);

    // a link to an attachment: the click becomes a download, refused for the agent (A-31), and nothing is saved
    const LINKS = s.server.url('/links.html');
    const links = (await agentOk(s, id, 'browser_tabs', { action: 'open', url: LINKS })).result.tabId as string;
    const linksSnapshot = (await agentOk(s, id, 'browser_snapshot', { tabId: links })).text!;
    const refused = await agentRun(s, id, 'browser_act', { tabId: links, action: 'click', target: refIn(linksSnapshot, 'link', 'Download the report') });
    expect(refused).toEqual({ ok: false, error: BROWSER_TOOL_ERRORS.downloadRefused('browser_act', s.server.url('/report.csv'), 'report.csv') });
    expect(readdirSync(s.saveDir)).toEqual([]);
  });
});

