// E4d's `browser-comment` group (docs/doperpowers/plans/2026-10-06-e4d-comment-mode.md, Acceptance G1, G2 and "Also
// pinned"): comment mode on the real Electron, over E4a's scene (the product app over the replay, a local server on
// loopback; support/browser-scene.ts, support/browser-server.ts with E4d's `/comment.html`). The first run of the
// browser preload with a body: its shield, outline and pick, main's gate and crop, E3's sheet opened through E5's seam.
//
// (1) G1: the toggle, the hover outline, a click pick, the sheet with the crop, no click reaching the page; (2) G1: Send
// to main and a Side thread from a pick on a live parent (E3's replay journals): the written prompts, the transcript's
// chip and image, the thread header's page button reusing the parent's tab; (3) G2 without E4c: every target's anchor
// resolves with E4c's own expression in the view's page; (4) an area pick; (5) Esc in the page and in the chrome; (6)
// the context menu's pick (through the seam's `pickAt`); (7) a navigation disarms, a stale report is dropped; (7b) a
// tab whose preload never acknowledges the arm is refused; (7c) a tab adopted from window.open arms and shields; (8) a
// frame, a shadow host and a top-layer dialog; (9) disk-form replay parity and the chip opening the page; (10) the
// agent's control gate; (11) both-theme evidence under MAWS_E4D_SHOTS=1.
// Runs under `pnpm e2e:browser-comment` (a harness build, MAWS_HARNESS=1 for playwright.config.ts's list); each launch
// passes MAWS_HARNESS=0, so the window is the product app.
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import type { Anchor } from '@shared/anchor/anchor';
import type { AppSessionId } from '@shared/graph/ids';
import type { JournalRow } from '@shared/wire/journal';
import { anchoredMessage, parseAnchoredText } from '../src/shared/anchor/message';
import { COMMENT_COPY } from '../src/renderer/src/tools/browser/comment/copy';
import { startBrowserServer, type BrowserServer } from './support/browser-server';
import { address, browserIn, expectOnPane, launchBrowserScene, noticesIn, openBrowser, pageAt, paneIn, tabAt, tabState, tabsOf, viewOf, type BrowserScene } from './support/browser-scene';
import { invoke, launchReady, value } from './support/c7-replay';
import { otherThemeColours } from './support/code-product';
import { clearToasts, closeScene, scratchProject, show, type Scratch } from './support/maws-tools';
import { REPO_ROOT } from './support/launch';
import { seedTranscript, SideJournal, solidPng, transcript } from './support/side-replay';

test.describe.configure({ timeout: 180_000 });

const COMMENT_PAGE = '/comment.html';
const INCREMENT_LABEL = 'button “Increment”';
const INCREMENT_A11Y = 'main > region “A form” > button “Increment”';

// ---- the scene --------------------------------------------------------------------------------------------------------

interface CommentSceneOptions {
  titles: string[];
  // engine store records written before the launch (each a session the scene's `ids` then lists, after the titles')
  seed?(scratch: Scratch, server: BrowserServer): string[];
  // C10's replay seam (`MAWS_E2E_REPLAY_FIXTURES`): each launch the session service makes takes the next journal; handed
  // to the app through the runner's environment, as launchBrowserScene hands MAWS_E2E_SAVE_PATH (Surprises, M0)
  fixtures?(scratch: Scratch): string[];
}

// One launch over a fresh scratch project and a fresh server, closed (console clean, every replay followed) after the body.
async function commentScene(opts: CommentSceneOptions, body: (s: BrowserScene) => Promise<void>): Promise<void> {
  const scratch = scratchProject({ titles: opts.titles });
  const server = await startBrowserServer();
  const before = process.env.MAWS_E2E_REPLAY_FIXTURES;
  try {
    scratch.engineIds.push(...(opts.seed?.(scratch, server) ?? []));
    const fixtures = opts.fixtures?.(scratch) ?? [];
    if (fixtures.length > 0) process.env.MAWS_E2E_REPLAY_FIXTURES = fixtures.join(',');
    let s: BrowserScene;
    try {
      s = await launchBrowserScene(scratch, server);
    } finally {
      if (before === undefined) delete process.env.MAWS_E2E_REPLAY_FIXTURES;
      else process.env.MAWS_E2E_REPLAY_FIXTURES = before;
    }
    try {
      await listen(s);
      await body(s);
    } catch (error) {
      await s.maws.cleanup();
      throw error;
    }
    await closeScene(s);
  } finally {
    await server.close();
    rmSync(scratch.root, { recursive: true, force: true });
  }
}

// ---- main's seam (`__maws_browser_comment`, src/main/browser/comment/index.ts; the e2e does not import main's code) -----

interface CommentState {
  armed: boolean;
  arming: boolean; // main awaits the preload's acknowledgement (Decision Log 34)
  epoch: number;
  dropped: number;
  webContentsId: number | null;
}
interface CommentSeam {
  pickAt(tabId: string, x: number, y: number): boolean;
  state(tabId: string): CommentState | null;
  sendInput(tabId: string, event: { type: 'keyDown' | 'keyUp'; keyCode: string }): boolean;
  replayReport(tabId: string, report: unknown): Promise<boolean>;
  setControl(tabId: string, control: 'idle' | 'agent' | 'human'): void;
  ignoreAcks(tabId: string, on: boolean): void;
}
const stateOf = (s: BrowserScene, tabId: string): Promise<CommentState> =>
  s.maws.app.evaluate((_electron, id) => (globalThis as unknown as { __maws_browser_comment: CommentSeam }).__maws_browser_comment.state(id)!, tabId);
const seamPickAt = (s: BrowserScene, tabId: string, x: number, y: number): Promise<boolean> =>
  s.maws.app.evaluate((_electron, [id, px, py]) => (globalThis as unknown as { __maws_browser_comment: CommentSeam }).__maws_browser_comment.pickAt(id as string, px as number, py as number), [tabId, x, y] as const);
const seamEscape = (s: BrowserScene, tabId: string): Promise<boolean> =>
  s.maws.app.evaluate((_electron, id) => (globalThis as unknown as { __maws_browser_comment: CommentSeam }).__maws_browser_comment.sendInput(id, { type: 'keyDown', keyCode: 'Escape' }), tabId);
const replayReport = (s: BrowserScene, tabId: string, report: unknown): Promise<boolean> =>
  s.maws.app.evaluate((_electron, [id, r]) => (globalThis as unknown as { __maws_browser_comment: CommentSeam }).__maws_browser_comment.replayReport(id as string, r), [tabId, report] as const);

// A report shaped as the preload sends one (src/shared/browser/comment.ts `PickReportSchema`), for the gate's drop cases.
const reportFor = (epoch: number) => ({
  type: 'picked',
  epoch,
  requestId: null,
  mode: 'click',
  description: { css: '#increment', role: 'button', name: 'Increment', a11y: INCREMENT_A11Y, tag: 'button', confident: true },
  nameOverLong: false,
  rect: { x: 20, y: 20, width: 90, height: 30 },
  scroll: { x: 0, y: 0 },
  viewport: { width: 400, height: 600 },
});

// ---- the app window's record of comment mode's events ------------------------------------------------------------------

type Picked = { tabId: string; appSessionId: string; anchor: Anchor; crop: 'attached' | 'none' | 'tooLarge' | 'failed' };
type Changed = { at: number; payload: { tabId: string; on: boolean; reason: string } };
type Recorded = { picked: Picked[]; changed: Changed[] };

async function listen(s: BrowserScene): Promise<void> {
  await s.page.evaluate(() => {
    const w = window as unknown as { __e4d?: Recorded };
    if (w.__e4d) return;
    const log: Recorded = { picked: [], changed: [] };
    w.__e4d = log;
    window.maws.on('browser.comment.picked', (payload) => log.picked.push(payload as Picked));
    window.maws.on('browser.comment.changed', (payload) => log.changed.push({ at: Date.now(), payload: payload as Changed['payload'] }));
  });
}
const recorded = (s: BrowserScene): Promise<Recorded> => s.page.evaluate(() => (window as unknown as { __e4d: Recorded }).__e4d);
async function lastPicked(s: BrowserScene, count: number): Promise<Picked> {
  await expect.poll(async () => (await recorded(s)).picked.length, { message: `pick ${count} reached the window` }).toBe(count);
  return (await recorded(s)).picked.at(-1)!;
}

// ---- the chrome, the page, the sheet ------------------------------------------------------------------------------------

const toggleOf = (view: Locator): Locator => view.locator('[data-browser-comment]');
const sheetOf = (s: BrowserScene, label: string): Locator => s.page.getByRole('dialog', { name: `Comment on ${label}` });
const commentNodes = (page: Page) => page.locator('maws-comment-shield, maws-comment-overlay, maws-comment-badge');

type Rect = { x: number; y: number; width: number; height: number };
const rectOf = (target: Locator): Promise<Rect> =>
  target.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  });
const centre = (r: Rect) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
const near = (a: number, b: number, slack: number) => Math.abs(a - b) <= slack;
const scrollOf = (page: Page) => page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));

interface CommentTab {
  panel: Locator;
  tabId: string;
  url: string;
  page: Page;
}

// The session shown, the Browser tool added from "+", the comment page loaded and on the pane.
async function openCommentPage(s: BrowserScene, id: AppSessionId): Promise<CommentTab> {
  await show(s, id);
  const panel = await openBrowser(s);
  const url = s.server.url(COMMENT_PAGE);
  await address(panel, url);
  const tabId = await tabAt(s, id, url);
  const page = await pageAt(s, url);
  await expect(page.locator('#increment')).toBeVisible();
  await expectOnPane(s, tabId, paneIn(panel), 'panel');
  return { panel, tabId, url, page };
}

// The toggle pressed: main arms the tab and the page's preload puts its shield up.
async function arm(s: BrowserScene, t: CommentTab): Promise<void> {
  const toggle = toggleOf(t.panel);
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(t.page.locator('maws-comment-shield')).toBeAttached();
  expect((await stateOf(s, t.tabId)).armed).toBe(true);
}

// A plain click at a point of the view's page (Playwright's input reaches the page as trusted input through CDP).
async function clickAt(page: Page, at: { x: number; y: number }): Promise<void> {
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.up();
}

// The sheet cancelled; the view comes back on the pane.
async function cancel(s: BrowserScene, t: CommentTab, sheet: Locator): Promise<void> {
  await sheet.getByRole('button', { name: 'Cancel' }).click();
  await expect(sheet).toHaveCount(0);
  await expectOnPane(s, t.tabId, paneIn(t.panel), 'panel');
}

// What the page's own recorder heard (every pointer, mouse and wheel event type, in the capture phase on `window`), each
// with whether MAWS's shield was in the page then; emptied by `clearLog`.
type Heard = { type: string; shielded: boolean };
const heard = (page: Page): Promise<Heard[]> =>
  page.evaluate(() =>
    (document.getElementById('log')!.textContent ?? '')
      .split(',')
      .filter(Boolean)
      .map((entry) => ({ type: entry.replace(/^\*/, ''), shielded: entry.startsWith('*') })),
  );
const clearLog = (page: Page) => page.evaluate(() => void (document.getElementById('log')!.textContent = ''));
const CLICK_TYPES = new Set(['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'auxclick', 'dblclick', 'contextmenu']);
// The press-and-release types heard (moves and boundary events apart: a pointer moving over an unarmed page is the page's).
const clicksHeard = async (page: Page) =>
  (await heard(page))
    .filter((e) => CLICK_TYPES.has(e.type))
    .map((e) => e.type)
    .join(',');
// Nothing reached the page while the shield was up (any type, moves and the wheel included), and no press or click at all.
// "While the shield was up" stands for "while armed" because the preload adds the shield and starts blocking in one
// synchronous task (its `arm`), and removes it and stops blocking in another (its `teardown`): no event can fall between
// the two, so an unmarked entry was heard while the page was unarmed. A preload that split them would make this check
// unsound.
async function expectPageHeardNothing(page: Page, what = 'no pointer, mouse or wheel event reached the page while armed'): Promise<void> {
  expect((await heard(page)).filter((e) => e.shielded).map((e) => e.type), what).toEqual([]);
  expect(await clicksHeard(page), 'no press or click reached the page').toBe('');
}

// The crops main wrote, and a PNG's size from its IHDR.
const cropsOf = (s: BrowserScene): string[] => {
  try {
    return readdirSync(join(s.maws.userData, 'browser', 'crops')).map((name) => join(s.maws.userData, 'browser', 'crops', name));
  } catch {
    return [];
  }
};
const pngSize = (bytes: Buffer) => ({ width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) });
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// ---- (1) G1: the toggle, the outline, the pick, the sheet --------------------------------------------------------------


// E11 F2b (Q4, owner-decided): the sheet shows the crop as a thumbnail named "Screenshot · W × H" (main reads the file
// for it through the send's own checks); its size, from that name.
async function thumbnailSize(sheet: Locator): Promise<[string, string]> {
  const thumbnail = sheet.locator('[data-comment-screenshot]').getByRole('img', { name: /^Screenshot · \d+ × \d+$/ });
  await expect(thumbnail, 'the screenshot shows as a thumbnail').toBeVisible();
  const [, w, h] = /Screenshot · (\d+) × (\d+)/.exec((await thumbnail.getAttribute('alt'))!)!;
  return [w!, h!];
}

test('1. the Comment toggle arms the page: the hover outline names the button, a click opens E3’s sheet with the label, the locator and the crop, and no event reaches the page', async () => {
  await commentScene({ titles: ['E4d: pick'] }, async (s) => {
    const [id] = s.ids as [AppSessionId];
    const t = await openCommentPage(s, id);
    const { page } = t;

    // unarmed, the preload has put nothing in the page, and the page's recorder hears a click (so its silence later counts)
    await expect(commentNodes(page)).toHaveCount(0);
    await clickAt(page, centre(await rectOf(page.locator('header h1'))));
    await expect.poll(() => clicksHeard(page)).toBe('pointerdown,mousedown,pointerup,mouseup,click');
    expect((await heard(page)).map((e) => e.type), 'the recorder hears moves and boundary events too').toEqual(expect.arrayContaining(['pointermove', 'pointerover', 'mousemove', 'mouseover']));
    await clearLog(page);

    await arm(s, t);
    const shield = await rectOf(page.locator('maws-comment-shield'));
    // the viewport without classic scrollbars, which a `position: fixed; inset: 0` box does not cover
    const viewport = await page.evaluate(() => ({ width: document.documentElement.clientWidth, height: document.documentElement.clientHeight }));
    expect(shield, 'the shield covers the viewport').toEqual({ x: 0, y: 0, ...viewport });

    // hover: the outline lies on the button within 1 px; the badge names it, the arm's first hover with the hint
    const button = await rectOf(page.locator('#increment'));
    await page.mouse.move(centre(button).x, centre(button).y);
    const overlay = page.locator('maws-comment-overlay');
    await expect(overlay).toBeVisible();
    const outline = await rectOf(overlay);
    expect(near(outline.x, button.x, 1) && near(outline.y, button.y, 1) && near(outline.width, button.width, 1) && near(outline.height, button.height, 1), JSON.stringify({ outline, button })).toBe(true);
    await expect(page.locator('maws-comment-badge')).toHaveText(`${INCREMENT_LABEL}\nClick to comment · drag for an area · Esc leaves`);

    // the click: E3's sheet in the app window, titled by the label, the locator shown, the crop attached
    await page.mouse.down();
    await page.mouse.up();
    const sheet = sheetOf(s, INCREMENT_LABEL);
    await expect(sheet).toBeVisible();
    await expect(sheet).toHaveAttribute('data-anchor-kind', 'browser-element');
    await expect(sheet).toHaveAttribute('data-anchor-locator', '#increment');
    await expect(sheet.getByText('#increment', { exact: true }), 'the locator shown').toBeVisible();
    const chip = sheet.locator('[data-comment-screenshot]');
    const [w, h] = await thumbnailSize(sheet);
    expect(Number(w)).toBeGreaterThan(0);
    expect(Number(h)).toBeGreaterThan(0);
    const crops = cropsOf(s);
    expect(crops, 'one crop file').toHaveLength(1);
    const bytes = readFileSync(crops[0]!);
    expect(bytes.subarray(0, 8).equals(PNG_SIGNATURE), 'a PNG').toBe(true);
    expect(pngSize(bytes), 'the thumbnail is named with the file’s own size').toEqual({ width: Number(w), height: Number(h) });
    expect(await chip.locator('img').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth), 'the thumbnail draws the crop itself (Q4)').toBe(Number(w));
    const dpr = await page.evaluate(() => window.devicePixelRatio);
    expect(near(Number(w), button.width * dpr, 2 * dpr + 1) && near(Number(h), button.height * dpr, 2 * dpr + 1), `the crop is the button: ${w}×${h} at DPR ${dpr} for ${JSON.stringify(button)}`).toBe(true);
    const picked = await lastPicked(s, 1);
    expect(picked).toMatchObject({ tabId: t.tabId, appSessionId: id, crop: 'attached' });

    // one pick per arm: the toggle is off, the page holds none of MAWS's nodes, and the page heard nothing of the pick
    await expect(toggleOf(t.panel)).toHaveAttribute('aria-pressed', 'false');
    await expect(commentNodes(page)).toHaveCount(0);
    await expectPageHeardNothing(page, 'the hover and the pick: no pointer, mouse or wheel event reached the page while armed');
    // the sheet covers the page: E4a's cover hides the view while it is open
    await expect.poll(async () => (await tabState(s, t.tabId)).tab?.covered).toBe(true);
    expect((await viewOf(s, t.tabId))?.visible).toBe(false);

    // the crop is removable with one click (A-31)
    await chip.getByRole('button', { name: 'Remove screenshot' }).click();
    await expect(chip).toHaveCount(0);
    await cancel(s, t, sheet);
    await expectPageHeardNothing(page);
    expect(await page.evaluate(() => document.getElementById('count')!.textContent)).toBe('0');
  });
});

// ---- (2) G1: Send to main and a Side thread from a pick, on a live parent ------------------------------------------------

const PARENT = 'e4d40000-0000-4000-8000-000000000001';
const CHILD = 'e4d40000-0000-4000-8000-000000000002';
const MAIN_COMMENT = 'Make this the primary button.';
const MAIN_REPLY = 'Noted: the Increment button becomes the primary one.';
const THREAD_COMMENT = 'Click this once and tell me what the count says.';
const THREAD_REPLY = 'The count reads 1 after one click.';

const writtenUsers = (s: BrowserScene, id: string) => s.journal(id).filter((r) => r.direction === 'out' && (r.frame as { type?: string }).type === 'user');
const contentOf = (row: JournalRow) => (row.frame as { message: { content: unknown } }).message.content as ({ type: 'image'; source: { data: string } } | { type: 'text'; text: string })[];

// The anchor of a pick of `#increment` as the e2e computes it from the page itself (`box` checked apart, within 2 px).
async function incrementAnchor(t: CommentTab): Promise<{ expected: Omit<Anchor, 'box' | 'screenshot'>; box: Rect }> {
  const rect = await rectOf(t.page.locator('#increment'));
  const scroll = await scrollOf(t.page);
  return {
    expected: { kind: 'browser-element', locator: '#increment', label: INCREMENT_LABEL, pageUrl: t.url, css: '#increment', role: 'button', name: 'Increment', a11y: INCREMENT_A11Y },
    box: { x: rect.x + scroll.x, y: rect.y + scroll.y, width: rect.width, height: rect.height },
  };
}
function expectBox(box: Anchor['box'], want: Rect, slack = 2): void {
  expect(box, 'the anchor carries a box').toBeDefined();
  expect(near(box!.x, want.x, slack) && near(box!.y, want.y, slack) && near(box!.width, want.width, slack) && near(box!.height, want.height, slack), `box ${JSON.stringify(box)} against ${JSON.stringify(want)}`).toBe(true);
}

test('2. a pick sent to main writes [image, anchored text] whose tag round-trips to the page’s anchor; a pick sent as a Side thread forks with it, and the thread header opens the page in the parent’s tab', async () => {
  test.setTimeout(240_000);
  let parentJournal = '';
  await commentScene(
    {
      titles: ['E4d: parent'],
      fixtures: (scratch) => {
        // C10's e2e settings over the scene's config home: the project trusted, the recordings' default mode the user's,
        // so the side thread's fork launches without a trust bootstrap or a mode correction (E3's scratch writes these)
        writeFileSync(join(scratch.config, '.claude.json'), `${JSON.stringify({ projects: { [scratch.repo]: { hasTrustDialogAccepted: true } } }, null, 2)}\n`);
        writeFileSync(join(scratch.config, 'settings.json'), `${JSON.stringify({ permissions: { defaultMode: 'default' } })}\n`);
        const dir = join(scratch.root, 'journals');
        mkdirSync(dir, { recursive: true });
        const parent = new SideJournal(PARENT, scratch.repo);
        parent.turn(MAIN_REPLY);
        parentJournal = parent.write(dir, 'parent');
        const thread = new SideJournal(CHILD, scratch.repo);
        const first = thread.prompt();
        thread.rename(INCREMENT_LABEL); // `finishBinding` names a comment's thread by its anchor's label
        thread.reply(first, THREAD_REPLY);
        thread.completed(first);
        return [thread.write(dir, 'thread')]; // the parent is launched directly (below); the fork takes the seam's one journal
      },
    },
    async (s) => {
      const [parent] = s.ids as [AppSessionId];
      // the parent live and idle over its journal, on the direct route (the replay verifies it direct, so its fork is too
      // and no relay is ever asked)
      await launchReady(s.page, parent, parentJournal, { cwd: s.repo, gateway: 'direct' });
      const t = await openCommentPage(s, parent);

      // ---- Send to main, the parent idle
      await arm(s, t);
      const { expected, box } = await incrementAnchor(t);
      await clickAt(t.page, centre(await rectOf(t.page.locator('#increment'))));
      let sheet = sheetOf(s, INCREMENT_LABEL);
      await expect(sheet).toBeVisible();
      await expect(sheet.locator('[data-comment-screenshot]')).toBeVisible();
      await sheet.locator('[data-destination="main"]').click();
      await expect(sheet.getByRole('radio', { name: /Send to main/ })).toBeChecked();
      await sheet.getByRole('textbox', { name: 'Comment' }).fill(MAIN_COMMENT);
      await sheet.getByRole('button', { name: 'Send' }).click();
      await expect(sheet).toHaveCount(0);
      await expect.poll(() => writtenUsers(s, parent).length, { timeout: 20_000 }).toBe(1);
      const [image, text] = contentOf(writtenUsers(s, parent)[0]!);
      expect(image?.type, 'the image block first').toBe('image');
      expect(Buffer.from((image as { source: { data: string } }).source.data, 'base64').subarray(0, 8).equals(PNG_SIGNATURE), 'the crop’s PNG').toBe(true);
      expect(text?.type).toBe('text');
      const sent = (text as { text: string }).text;
      const parsed = parseAnchoredText(sent);
      expect(parsed, 'the tag parses').not.toBeNull();
      expect(parsed!.destination).toBe('main');
      expect(parsed!.text).toBe(MAIN_COMMENT);
      const { box: sentBox, ...rest } = parsed!.anchor;
      expect(rest).toEqual(expected);
      expectBox(sentBox, box);
      expect(sent, 'E3’s lead, with the screenshot sentence').toBe(anchoredMessage({ anchor: parsed!.anchor, text: MAIN_COMMENT, destination: 'main', screenshot: true }));
      expect(sent).toContain('a11y="main &gt; region “A form” &gt; button “Increment”"');
      // the transcript draws the prompt with its chip and its picture
      const main = s.page.locator('[data-region="main"]');
      await expect(main.getByText(MAIN_REPLY)).toBeVisible({ timeout: 20_000 });
      const bubble = main.locator('[data-bubble]').filter({ hasText: MAIN_COMMENT });
      const chip = bubble.locator('[data-chip="anchor"][data-anchor-kind="browser-element"]');
      await expect(chip).toHaveText(INCREMENT_LABEL);
      await expect(bubble.locator('img.transcript-attachment-image')).toBeVisible();
      await expect(main.getByText('Comment on "button', { exact: false }), 'the lead line is not drawn').toHaveCount(0);

      // ---- a Side thread (the sheet's default): the fork's first prompt carries the anchor and the picture
      await expectOnPane(s, t.tabId, paneIn(t.panel), 'panel');
      await arm(s, t);
      await clickAt(t.page, centre(await rectOf(t.page.locator('#increment'))));
      sheet = sheetOf(s, INCREMENT_LABEL);
      await expect(sheet).toBeVisible();
      await expect(sheet.getByRole('radio', { name: /Side thread/ })).toBeChecked();
      await sheet.getByRole('textbox', { name: 'Comment' }).fill(THREAD_COMMENT);
      await sheet.getByRole('button', { name: 'Send' }).click();
      await expect(sheet).toHaveCount(0);
      let child = '';
      await expect
        .poll(async () => {
          const records = value(await invoke(s.page, 'session.list', {})).sessions;
          child = records.find((r) => r.lineage?.kind === 'side-thread' && r.lineage.parentAppSessionId === parent)?.appId ?? '';
          return child;
        }, { timeout: 20_000 })
        .not.toBe('');
      const pane = s.panel.locator(`[data-side-thread-view="${child}"]`);
      await expect(pane, 'the Side pane opens on the thread').toBeVisible();
      await expect(pane.getByText(THREAD_REPLY)).toBeVisible({ timeout: 20_000 });
      const [threadImage, threadText] = contentOf(writtenUsers(s, child)[0]!);
      expect(threadImage?.type).toBe('image');
      const threadParsed = parseAnchoredText((threadText as { text: string }).text);
      expect(threadParsed?.destination).toBe('thread');
      expect(threadParsed?.anchor).toMatchObject(expected);
      await expect(pane.locator('[data-chip="anchor"][data-anchor-kind="browser-element"]')).toHaveText(INCREMENT_LABEL);

      // the thread header's URL opens the page in the parent's browser: the commented tab, reused; the thread has none
      expect((await tabsOf(s, parent)).tabs).toHaveLength(1);
      await pane.locator('header').getByRole('button', { name: t.url }).click();
      await expect(browserIn(s, 'panel')).toBeVisible();
      await expectOnPane(s, t.tabId, paneIn(browserIn(s, 'panel')), 'panel');
      expect((await tabsOf(s, parent)).tabs.map((tab) => tab.tabId), 'the same tab, no second one').toEqual([t.tabId]);
      expect((await tabsOf(s, child as AppSessionId)).tabs, 'the thread’s own session opened no tab').toEqual([]);
    },
  );
});

// ---- (3) G2 without E4c: every anchor resolves with E4c's expression ------------------------------------------------------

type RoleName = Parameters<Page['getByRole']>[0];
interface Target {
  target: string; // the fixture's data-target
  css?: string; // the css expected exactly, where it is pinned
  role?: string | null; // the role expected (null: omitted)
  name?: string | null; // the name expected (null: omitted)
}
const TARGETS: Target[] = [
  { target: 'increment', css: '#increment', role: 'button', name: 'Increment' },
  { target: 'act', css: 'body > main > section:nth-of-type(2) > ul > li:nth-of-type(2) > button', role: 'button', name: 'Act' },
  { target: 'name', css: '#name', role: 'textbox', name: 'Name' },
  { target: 'local-link', css: '#\\37  > a', role: 'link', name: 'local link' },
  { target: 'hangul-id', css: '#한글-id', role: 'button', name: '한글' },
  { target: 'cafe-id', css: '#café', role: null, name: null },
  { target: 'plain-div', role: null, name: null },
  { target: 'hidden-button', role: null, name: null }, // under aria-hidden: not confident, so neither is sent
  { target: 'no-href', role: null, name: null },
  { target: 'decorative-img', role: null, name: null },
  { target: 'icon-button' },
  { target: 'placeholder-input' },
  { target: 'article-header', role: null, name: null },
  // Decision Log 35: an input inside its own label is named by the label alone (as Playwright names it), and a button in
  // a row whose password input holds a value; no anchor field may carry either value
  { target: 'label-wrapped', role: 'textbox', name: 'Email' },
  { target: 'pin-show', role: 'button', name: 'Show' },
];

test('3. G2’s proof without E4c: for each target picked, css alone matches exactly the picked element, and E4c’s css-and-role expression counts one', async () => {
  await commentScene({ titles: ['E4d: targets'] }, async (s) => {
    const [id] = s.ids as [AppSessionId];
    const t = await openCommentPage(s, id);
    const { page } = t;
    const found: string[] = [];
    for (const [k, want] of TARGETS.entries()) {
      const element = page.locator(`[data-target="${want.target}"]`);
      await element.scrollIntoViewIfNeeded();
      await arm(s, t);
      await clickAt(page, centre(await rectOf(element)));
      const { anchor } = await lastPicked(s, k + 1);
      const sheet = sheetOf(s, anchor.label);
      await expect(sheet, `${want.target}: the sheet`).toBeVisible();
      await expect(sheet).toHaveAttribute('data-anchor-locator', anchor.css!);
      expect(anchor.locator, `${want.target}: locator is the css`).toBe(anchor.css);
      if (want.css !== undefined) expect(anchor.css, want.target).toBe(want.css);
      if (want.role !== undefined) expect(anchor.role ?? null, `${want.target}: role`).toBe(want.role);
      if (want.name !== undefined) expect(anchor.name ?? null, `${want.target}: name`).toBe(want.name);
      expect(JSON.stringify(anchor), `${want.target}: no control’s value`).not.toMatch(/hunter2|a@b\.c/u);
      // css alone: one match, the element the person clicked
      const byCss = page.locator(`css=${anchor.css}`);
      await expect(byCss, `${want.target}: css=${anchor.css}`).toHaveCount(1);
      expect(await byCss.getAttribute('data-target'), want.target).toBe(want.target);
      // E4c's full expression (its Design §6), where the anchor carries a role
      if (anchor.role !== undefined) {
        const full = byCss.and(page.getByRole(anchor.role as RoleName, anchor.name !== undefined ? { name: anchor.name, exact: true } : {}));
        await expect(full, `${want.target}: css and getByRole(${anchor.role}, ${anchor.name})`).toHaveCount(1);
      }
      found.push(`${want.target}: ${anchor.label} | ${anchor.css} | ${anchor.role ?? '-'} | ${anchor.name ?? '-'}`);
      await cancel(s, t, sheet);
    }
    test.info().annotations.push({ type: 'anchors', description: found.join('\n') });
  });
});

// ---- (4) an area pick ------------------------------------------------------------------------------------------------------

test('4. a drag picks an area: the smallest element holding the marquee is named, the crop is the marquee, the box is the marquee in document coordinates', async () => {
  await commentScene({ titles: ['E4d: area'] }, async (s) => {
    const [id] = s.ids as [AppSessionId];
    const t = await openCommentPage(s, id);
    const { page } = t;
    const list = page.locator('[data-target="list"]');
    await list.evaluate((el) => el.scrollIntoView({ block: 'start' })); // scrolled, so the box differs from the rect
    await arm(s, t);
    const r = await rectOf(list);
    // whole CSS px inside the list, so the marquee's crop is its size times the DPR exactly (a fractional edge would be
    // rounded outward, Design §5)
    const from = { x: Math.ceil(r.x) + 1, y: Math.ceil(r.y) + 1 };
    const to = { x: Math.floor(r.x + r.width) - 1, y: Math.floor(r.y + r.height) - 1 };
    const marquee = { x: from.x, y: from.y, width: to.x - from.x, height: to.y - from.y };
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 8 });
    // the outline is the marquee while dragging, named by the containing element
    const outline = await rectOf(page.locator('maws-comment-overlay'));
    expect(near(outline.x, marquee.x, 1) && near(outline.y, marquee.y, 1) && near(outline.width, marquee.width, 1) && near(outline.height, marquee.height, 1), JSON.stringify({ outline, marquee })).toBe(true);
    await expect(page.locator('maws-comment-badge')).toHaveText(/^list/);
    const scroll = await scrollOf(page);
    await page.mouse.up();

    const sheet = sheetOf(s, 'list');
    await expect(sheet).toBeVisible();
    await expect(sheet).toHaveAttribute('data-anchor-locator', 'body > main > section:nth-of-type(2) > ul');
    const { anchor } = await lastPicked(s, 1);
    expect(anchor).toMatchObject({ kind: 'browser-element', label: 'list', css: 'body > main > section:nth-of-type(2) > ul', role: 'list' });
    expect(anchor.name, 'a list has no name: omitted').toBeUndefined();
    expect(scroll.y, 'the page is scrolled, so the box is in document coordinates').toBeGreaterThan(0);
    expectBox(anchor.box, { ...marquee, x: marquee.x + scroll.x, y: marquee.y + scroll.y });
    const dpr = await page.evaluate(() => window.devicePixelRatio);
    const [w, h] = await thumbnailSize(sheet);
    expect(near(Number(w), marquee.width * dpr, 2) && near(Number(h), marquee.height * dpr, 2), `crop ${w}×${h} for the marquee ${marquee.width}×${marquee.height} at DPR ${dpr}`).toBe(true);
    // G2's expression on the one anchor with a role and no name (`getByRole(role, {})`): css alone, then css and role
    const byCss = page.locator(`css=${anchor.css}`);
    await expect(byCss).toHaveCount(1);
    expect(await byCss.getAttribute('data-target')).toBe('list');
    await expect(byCss.and(page.getByRole('list'))).toHaveCount(1);
    await cancel(s, t, sheet);
    await expectPageHeardNothing(page);
  });
});

// ---- (5) Esc ----------------------------------------------------------------------------------------------------------------

test('5. Esc leaves comment mode: a native Esc in the page (before-input-event) and an Esc in the chrome’s address field; nothing opens', async () => {
  await commentScene({ titles: ['E4d: escape'] }, async (s) => {
    const [id] = s.ids as [AppSessionId];
    const t = await openCommentPage(s, id);
    const toggle = toggleOf(t.panel);

    // in the page, the native path (Playwright's keys are CDP's and never raise before-input-event)
    await arm(s, t);
    await t.page.mouse.move(40, 40);
    await expect(t.page.locator('maws-comment-overlay')).toBeVisible();
    expect(await seamEscape(s, t.tabId)).toBe(true);
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(commentNodes(t.page)).toHaveCount(0);
    expect((await stateOf(s, t.tabId)).armed).toBe(false);
    expect((await recorded(s)).changed.at(-1)?.payload).toEqual({ tabId: t.tabId, on: false, reason: 'escape' });

    // in the chrome: the address field focused, Escape
    await arm(s, t);
    const field = t.panel.getByRole('combobox', { name: 'Address' });
    await field.click();
    await expect(field).toBeFocused();
    await field.press('Escape');
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(commentNodes(t.page)).toHaveCount(0);
    expect((await recorded(s)).changed.at(-1)?.payload).toEqual({ tabId: t.tabId, on: false, reason: 'toggle' });

    await expect(s.page.getByRole('dialog')).toHaveCount(0);
    expect((await recorded(s)).picked).toEqual([]);
  });
});

// ---- (6) the context menu's pick ------------------------------------------------------------------------------------------

test('6. the context menu’s Comment picks the element at the point without arming (the seam’s pickAt in CSS px)', async () => {
  await commentScene({ titles: ['E4d: menu'] }, async (s) => {
    const [id] = s.ids as [AppSessionId];
    const t = await openCommentPage(s, id);
    const at = centre(await rectOf(t.page.locator('#name')));
    expect(await seamPickAt(s, t.tabId, at.x, at.y)).toBe(true);
    const sheet = sheetOf(s, 'textbox “Name”');
    await expect(sheet).toBeVisible();
    await expect(sheet).toHaveAttribute('data-anchor-locator', '#name');
    await thumbnailSize(sheet);
    const { anchor } = await lastPicked(s, 1);
    expect(anchor).toMatchObject({ css: '#name', role: 'textbox', name: 'Name', label: 'textbox “Name”' });
    expect((await recorded(s)).changed, 'no arm, no disarm').toEqual([]);
    await expect(toggleOf(t.panel)).toHaveAttribute('aria-pressed', 'false');
    await expect(commentNodes(t.page)).toHaveCount(0);
    await cancel(s, t, sheet);
  });
});

// ---- (7) navigation, a stale report, an adopted child ------------------------------------------------------------------

test('7. a navigation disarms; a report from the earlier arm is dropped and counted, nothing opening', async () => {
  await commentScene({ titles: ['E4d: navigate'] }, async (s) => {
    const [id] = s.ids as [AppSessionId];
    const t = await openCommentPage(s, id);
    await arm(s, t);
    const armed = await stateOf(s, t.tabId);

    const A = s.server.url('/a.html');
    await address(t.panel, A);
    await expect.poll(async () => (await tabState(s, t.tabId)).tab?.url).toBe(A);
    await expect(toggleOf(t.panel)).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(async () => (await recorded(s)).changed.at(-1)?.payload).toEqual({ tabId: t.tabId, on: false, reason: 'navigated' });
    const after = await stateOf(s, t.tabId);
    expect(after.armed).toBe(false);
    expect(after.epoch, 'the navigation moved the epoch').toBeGreaterThan(armed.epoch);

    // armed again on the new page, the old arm's report fed through the gate: the epoch alone drops it (the tab is
    // armed and awaiting its one report), counted, the arm untouched, nothing opened or emitted
    await toggleOf(t.panel).click();
    await expect(toggleOf(t.panel)).toHaveAttribute('aria-pressed', 'true');
    const rearmed = await stateOf(s, t.tabId);
    expect(rearmed.armed).toBe(true);
    expect(rearmed.epoch).toBeGreaterThan(after.epoch);
    const changes = (await recorded(s)).changed.length;
    expect(await replayReport(s, t.tabId, reportFor(armed.epoch))).toBe(true);
    const stale = await stateOf(s, t.tabId);
    expect(stale.dropped - rearmed.dropped).toBe(1);
    expect(stale.armed, 'still armed: a stale report ends nothing').toBe(true);
    expect((await recorded(s)).picked).toEqual([]);
    expect((await recorded(s)).changed).toHaveLength(changes);
    await expect(s.page.getByRole('dialog')).toHaveCount(0);
    await toggleOf(t.panel).click();
    await expect(toggleOf(t.panel)).toHaveAttribute('aria-pressed', 'false');
  });
});

// ---- (7b, 7c) armed means acknowledged (Decision Log 34) ----------------------------------------------------------------

// A tab whose preload never acknowledges the arm is refused: the toggle is never pressed, main ends the arming after
// ARM_ACK_MS with `unavailable` and the tab's chrome says so, no shield stays in the page, and main holds the tab neither
// armed nor arming (so the page hearing a click then is the mode being off, not a hole in it).
async function expectRefusedArm(s: BrowserScene, view: Locator, tabId: string, page: Page): Promise<void> {
  const toggle = toggleOf(view);
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.click();
  await expect.poll(async () => (await stateOf(s, tabId)).arming, { message: 'arming, awaiting the acknowledgement' }).toBe(true);
  await expect(toggle, 'not pressed while main waits').toHaveAttribute('aria-pressed', 'false');
  await expect
    .poll(async () => (await recorded(s)).changed.filter((c) => c.payload.tabId === tabId).at(-1)?.payload, { timeout: 5_000, message: 'the arming ends unavailable' })
    .toEqual({ tabId, on: false, reason: 'unavailable' });
  expect((await recorded(s)).changed.filter((c) => c.payload.tabId === tabId && c.payload.on), 'never told on').toEqual([]);
  // said in the tab's chrome, never in a toast, whose viewport would cover the panel's page and freeze it (Decision Log 35)
  await expect(noticesIn(view).filter({ hasText: COMMENT_COPY.unavailable }), 'the chrome line').toHaveAttribute('data-browser-notice', 'commentUnavailable');
  await expect(s.page.locator('[data-toast-viewport]').getByText(COMMENT_COPY.unavailable), 'no toast').toHaveCount(0);
  expect((await tabState(s, tabId)).tab?.covered, 'the page is not covered while the line shows').toBe(false);
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(commentNodes(page), 'no shield left in the page').toHaveCount(0);
  const state = await stateOf(s, tabId);
  expect({ armed: state.armed, arming: state.arming }).toEqual({ armed: false, arming: false });
}

test('7b. armed means acknowledged: a tab whose preload never confirms the arm is refused as unavailable (the seam’s ignoreAcks on an ordinary tab)', async () => {
  await commentScene({ titles: ['E4d: no ack'] }, async (s) => {
    const [id] = s.ids as [AppSessionId];
    const t = await openCommentPage(s, id);
    await s.maws.app.evaluate((_electron, id) => (globalThis as unknown as { __maws_browser_comment: CommentSeam }).__maws_browser_comment.ignoreAcks(id, true), t.tabId);
    await expectRefusedArm(s, t.panel, t.tabId, t.page);
    // the mode is off, so the page is the person's again: a click reaches its recorder
    await clickAt(t.page, centre(await rectOf(t.page.locator('header h1'))));
    await expect.poll(() => clicksHeard(t.page)).toBe('pointerdown,mousedown,pointerup,mouseup,click');
    expect((await heard(t.page)).filter((e) => e.shielded), 'no shield was up when the page heard it').toEqual([]);
    await clearLog(t.page);
    // the same tab, its acknowledgements heard again: it arms and shields, and a pick reaches nothing in the page
    await s.maws.app.evaluate((_electron, id) => (globalThis as unknown as { __maws_browser_comment: CommentSeam }).__maws_browser_comment.ignoreAcks(id, false), t.tabId);
    await arm(s, t);
    await clickAt(t.page, centre(await rectOf(t.page.locator('#increment'))));
    const sheet = sheetOf(s, INCREMENT_LABEL);
    await expect(sheet).toBeVisible();
    await expectPageHeardNothing(t.page);
    await cancel(s, t, sheet);
  });
});

// A tab adopted from a page's window.open (E4a's `adoptChild`): the browser preload reaches it only because E4a registers
// it on the partition's session (E4a's Decision Log 56; under a per-view `webPreferences.preload` it never ran there,
// E4d's Decision Log 33), so it acknowledges the arm like any tab; 7b covers the defence for a page that does not.
async function adoptedTab(s: BrowserScene): Promise<{ view: Locator; tabId: string; page: Page }> {
  const [id] = s.ids as [AppSessionId];
  await show(s, id);
  const view = await openBrowser(s);
  const A = s.server.url('/a.html');
  await address(view, A);
  await tabAt(s, id, A);
  await (await pageAt(s, A)).locator('#open-c').click();
  const C = s.server.url('/c.html');
  const tabId = await tabAt(s, id, C);
  const page = await pageAt(s, C);
  await expectOnPane(s, tabId, paneIn(view), 'panel');
  return { view, tabId, page };
}

test('7c. a tab adopted from window.open arms and shields (E4a’s per-session preload)', async () => {
  await commentScene({ titles: ['E4d: adopted'] }, async (s) => {
    const { view, tabId, page } = await adoptedTab(s);
    await toggleOf(view).click();
    try {
      await expect(toggleOf(view), 'the adopted tab acknowledges the arm').toHaveAttribute('aria-pressed', 'true', { timeout: 3_000 });
      await expect(page.locator('maws-comment-shield'), 'the adopted tab loads the browser preload').toBeAttached();
    } finally {
      value(await invoke(s.page, 'browser.comment.set', { tabId, on: false }));
    }
  });
});

// ---- (8) a frame, a shadow host, a top-layer dialog ------------------------------------------------------------------------

test('8. a frame is picked as its element and its page hears nothing; a shadow tree’s button anchors at its host; a modal dialog’s button is picked and the page hears nothing', async () => {
  await commentScene({ titles: ['E4d: frames'] }, async (s) => {
    const [id] = s.ids as [AppSessionId];
    const t = await openCommentPage(s, id);
    const { page } = t;

    // the frame: its own recorder, heard unarmed first
    const frameElement = page.locator('[data-target="frame"]');
    await frameElement.scrollIntoViewIfNeeded();
    let frame: ReturnType<Page['frames']>[number] | undefined;
    await expect.poll(() => (frame = page.frames().find((f) => f.url().endsWith('/b.html'))) !== undefined).toBe(true);
    await frame!.evaluate(() => {
      const w = window as unknown as { __heard: string[] };
      w.__heard = [];
      for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'pointermove', 'mousemove']) window.addEventListener(type, () => w.__heard.push(type), true);
    });
    const heard = () => frame!.evaluate(() => (window as unknown as { __heard: string[] }).__heard.filter((type) => !type.endsWith('move')));
    const frameRect = await rectOf(frameElement);
    await clickAt(page, centre(frameRect));
    await expect.poll(heard).toEqual(['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']);
    await frame!.evaluate(() => void ((window as unknown as { __heard: string[] }).__heard = []));
    await clearLog(page);

    await arm(s, t);
    await page.mouse.move(centre(frameRect).x, centre(frameRect).y);
    const outline = await rectOf(page.locator('maws-comment-overlay'));
    expect(near(outline.x, frameRect.x, 1) && near(outline.y, frameRect.y, 1) && near(outline.width, frameRect.width, 1) && near(outline.height, frameRect.height, 1), JSON.stringify({ outline, frameRect })).toBe(true);
    await page.mouse.down();
    await page.mouse.up();
    let picked = await lastPicked(s, 1);
    expect(picked.anchor.label, 'a frame is named by its title (Design §8)').toBe('iframe “Frame B”');
    expect(picked.anchor.role, 'a frame has no role').toBeUndefined();
    let sheet = sheetOf(s, picked.anchor.label);
    await expect(sheet).toBeVisible();
    await expect(page.locator(`css=${picked.anchor.css}`)).toHaveAttribute('data-target', 'frame');
    expect(await frame!.evaluate(() => (window as unknown as { __heard: string[] }).__heard), 'the frame’s page heard no pointer event at all').toEqual([]);
    await expectPageHeardNothing(page);
    await cancel(s, t, sheet);

    // the shadow host: a click over its inner button names the host
    const host = page.locator('[data-target="shadow-host"]');
    await host.scrollIntoViewIfNeeded();
    await arm(s, t);
    await clickAt(page, centre(await rectOf(page.locator('[data-target="shadow-host"] button'))));
    picked = await lastPicked(s, 2);
    expect(picked.anchor.css).toBe('#shadow-host');
    sheet = sheetOf(s, picked.anchor.label);
    await expect(sheet).toHaveAttribute('data-anchor-locator', '#shadow-host');
    await expectPageHeardNothing(page);
    await cancel(s, t, sheet);

    // the top layer: a modal dialog paints above the shield; its button is still picked, and the page hears nothing
    await page.evaluate(() => (document.getElementById('modal') as HTMLDialogElement).showModal());
    const confirm = page.locator('#modal-confirm');
    await expect(confirm).toBeVisible();
    await arm(s, t);
    await clickAt(page, centre(await rectOf(confirm)));
    picked = await lastPicked(s, 3);
    expect(picked.anchor).toMatchObject({ css: '#modal-confirm', role: 'button', name: 'Confirm', label: 'button “Confirm”' });
    sheet = sheetOf(s, 'button “Confirm”');
    await expect(sheet).toBeVisible();
    await expectPageHeardNothing(page, 'no event reached the page through the top layer');
    expect(await page.evaluate(() => (document.getElementById('modal') as HTMLDialogElement).open), 'the dialog is still open: its button (which closes it) was not pressed').toBe(true);
    await cancel(s, t, sheet);
  });
});

// ---- (9) disk-form replay parity; the chip opens the page --------------------------------------------------------------------

const DISK_SESSION = 'e4d4d000-0000-4000-8000-000000000001';
const DISK_COMMENT = 'Is this the right button to make primary?';

// A full browser-element anchor (every X10 field) at the server's comment page.
const diskAnchor = (server: BrowserServer): Anchor => ({
  kind: 'browser-element',
  locator: '#increment',
  label: INCREMENT_LABEL,
  pageUrl: server.url(COMMENT_PAGE),
  css: '#increment',
  role: 'button',
  name: 'Increment',
  a11y: INCREMENT_A11Y,
  box: { x: 24, y: 300, width: 96, height: 30 },
});

// The engine's store for a session whose comment was sent to main: a first exchange, then the anchored prompt as the
// engine records a user message, `[image, text]`.
function seedDiskComment(scratch: Scratch, server: BrowserServer): string[] {
  const png = solidPng(96, 30, [47, 111, 235]);
  const t = transcript({ sessionId: DISK_SESSION, cwd: scratch.repo, start: Date.UTC(2026, 9, 7, 9, 0, 0) });
  t.user('e4d4d000-0000-4000-8000-000000000011', 'Open the comment page.');
  t.text('e4d4d000-0000-4000-8000-000000000012', 'Opened.');
  t.turnEnd('e4d4d000-0000-4000-8000-000000000013');
  t.user('e4d4d000-0000-4000-8000-000000000014', [
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: png.toString('base64') } },
    { type: 'text', text: anchoredMessage({ anchor: diskAnchor(server), text: DISK_COMMENT, destination: 'main', screenshot: true }) },
  ]);
  t.text('e4d4d000-0000-4000-8000-000000000015', 'Yes, that one.');
  t.turnEnd('e4d4d000-0000-4000-8000-000000000016');
  seedTranscript(scratch.config, scratch.repo, DISK_SESSION, t.records);
  return [DISK_SESSION];
}

test('9. disk-form parity: a browser comment read from the engine’s JSONL draws its chip and its picture, and the chip opens the page in the session’s browser, reusing the tab', async () => {
  await commentScene({ titles: [], seed: seedDiskComment }, async (s) => {
    const [id] = s.ids as [AppSessionId];
    await show(s, id);
    const main = s.page.locator('[data-region="main"]');
    const bubble = main.locator('[data-bubble]').filter({ hasText: DISK_COMMENT });
    await expect(bubble).toBeVisible({ timeout: 20_000 });
    const chip = bubble.locator('[data-chip="anchor"][data-anchor-kind="browser-element"]');
    await expect(chip).toHaveText(INCREMENT_LABEL);
    await expect(chip).toHaveAttribute('title', '#increment');
    await expect(bubble.locator('img.transcript-attachment-image')).toBeVisible();
    await expect(main.getByText('Comment on "button', { exact: false }), 'the lead line is not drawn').toHaveCount(0);

    // the chip: the Browser tool on a tab at the page; a second click selects that tab again
    const url = s.server.url(COMMENT_PAGE);
    expect((await tabsOf(s, id)).tabs).toEqual([]);
    await chip.click();
    const panel = browserIn(s, 'panel');
    await expect(panel).toBeVisible();
    const tabId = await tabAt(s, id, url);
    await expectOnPane(s, tabId, paneIn(panel), 'panel');
    await expect((await pageAt(s, url)).locator('#increment')).toBeVisible();
    await chip.click();
    await expectOnPane(s, tabId, paneIn(panel), 'panel');
    expect((await tabsOf(s, id)).tabs.map((tab) => tab.tabId), 'reuse: no second tab').toEqual([tabId]);
  });
});

// ---- (10) the agent's control ------------------------------------------------------------------------------------------------

test('10. the control gate: under the agent the toggle is disabled and an arm is refused; an armed tab disarms at once when the agent takes the page; a report then is dropped', async () => {
  await commentScene({ titles: ['E4d: control'] }, async (s) => {
    const [id] = s.ids as [AppSessionId];
    const t = await openCommentPage(s, id);
    await arm(s, t);
    await t.page.mouse.move(40, 40);
    const { epoch, dropped } = await stateOf(s, t.tabId);

    // the agent takes the page: main's mode is off before setControl returns; the window hears `agent`
    const { at, armedAfter } = await s.maws.app.evaluate((_electron, id) => {
      const seam = (globalThis as unknown as { __maws_browser_comment: CommentSeam }).__maws_browser_comment;
      const at = Date.now();
      seam.setControl(id, 'agent');
      return { at, armedAfter: seam.state(id)!.armed };
    }, t.tabId);
    expect(armedAfter, 'disarmed synchronously inside setControl').toBe(false);
    await expect.poll(async () => (await recorded(s)).changed.at(-1)?.payload).toEqual({ tabId: t.tabId, on: false, reason: 'agent' });
    const heardAt = (await recorded(s)).changed.at(-1)!.at;
    expect(heardAt - at, 'the window heard the disarm within 200 ms').toBeLessThan(200);
    await expect(commentNodes(t.page)).toHaveCount(0);

    // the toggle: disabled, its label the reason; main refuses an arm
    const agentToggle = t.panel.getByRole('button', { name: 'Comment is unavailable while the agent is browsing' });
    await expect(agentToggle).toBeDisabled();
    expect(value(await invoke(s.page, 'browser.comment.set', { tabId: t.tabId, on: true }))).toEqual({ on: false, reason: 'agent' });

    // a report for the arm the agent ended: dropped and counted, nothing opens
    expect(await replayReport(s, t.tabId, reportFor(epoch))).toBe(true);
    expect((await stateOf(s, t.tabId)).dropped - dropped).toBe(1);
    expect((await recorded(s)).picked).toEqual([]);
    await expect(s.page.getByRole('dialog')).toHaveCount(0);

    // the page back with no one acting: the toggle is the person's again
    await s.maws.app.evaluate((_electron, id) => (globalThis as unknown as { __maws_browser_comment: CommentSeam }).__maws_browser_comment.setControl(id, 'idle'), t.tabId);
    await expect(toggleOf(t.panel)).toBeEnabled();
    await expect(toggleOf(t.panel)).toHaveAccessibleName('Comment');
    await arm(s, t);
  });
});

// ---- (11) evidence in both themes ----------------------------------------------------------------------------------------------

const SHOTS = process.env.MAWS_E4D_SHOTS === '1' ? join(REPO_ROOT, 'docs/doperpowers/evidence/p1-e4d') : null;
const THEMES = ['light', 'dark'] as const;

// `e4d-<surface>-<theme>.png` in each theme, then back to light (E4a's `shootBrowser` technique, which writes under
// p1-e4a alone): with `page`, the view's own screenshot is laid into `pane` for the shot (a view is not in the renderer's
// screenshot), and removed after. Each theme's window is checked for colours of the other theme (tokens only). The
// flow runs without MAWS_E4D_SHOTS too; only the files are skipped.
async function shoot(s: BrowserScene, surface: string, opts: { pane?: Locator; page?: Page } = {}): Promise<void> {
  if (SHOTS !== null) mkdirSync(SHOTS, { recursive: true });
  await clearToasts(s.page);
  for (const theme of THEMES) {
    value(await invoke(s.page, 'settings.set', { theme }));
    await expect(s.page.locator('html')).toHaveAttribute('data-theme', theme);
    expect(await otherThemeColours(s.page), `${theme}: ${surface}`).toEqual([]);
    if (SHOTS === null) continue;
    if (opts.page && opts.pane) {
      const picture = `data:image/png;base64,${(await opts.page.screenshot()).toString('base64')}`;
      await opts.pane.evaluate(
        (el, src) =>
          new Promise<void>((resolve) => {
            const img = document.createElement('img');
            img.dataset.e4dShot = '';
            img.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;z-index:5;pointer-events:none';
            img.onload = () => resolve();
            img.src = src;
            el.appendChild(img);
          }),
        picture,
      );
    }
    await s.page.waitForTimeout(250);
    await s.page.screenshot({ path: join(SHOTS, `e4d-${surface}-${theme}.png`) });
    if (opts.pane) await opts.pane.evaluate((el) => el.querySelector('img[data-e4d-shot]')?.remove());
  }
  value(await invoke(s.page, 'settings.set', { theme: 'light' }));
  await expect(s.page.locator('html')).toHaveAttribute('data-theme', 'light');
}

test('11. both themes: the chrome with the toggle pressed over the outlined page, the sheet with the crop chip, the transcript’s chip (MAWS_E4D_SHOTS=1 writes them)', async () => {
  await commentScene({ titles: ['E4d: shots'], seed: seedDiskComment }, async (s) => {
    const [id, disk] = s.ids as [AppSessionId, AppSessionId];
    const t = await openCommentPage(s, id);
    await arm(s, t);
    const button = await rectOf(t.page.locator('#increment'));
    await t.page.mouse.move(centre(button).x, centre(button).y);
    await expect(t.page.locator('maws-comment-badge')).toBeVisible();
    await s.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur()); // no focus ring from the toggle's click
    await shoot(s, 'chrome-armed', { pane: paneIn(t.panel), page: t.page });
    await expect(toggleOf(t.panel)).toHaveAttribute('aria-pressed', 'true');

    await t.page.mouse.down();
    await t.page.mouse.up();
    const sheet = sheetOf(s, INCREMENT_LABEL);
    await expect(sheet.locator('[data-comment-screenshot]')).toBeVisible();
    await sheet.getByRole('textbox', { name: 'Comment' }).fill(MAIN_COMMENT);
    await shoot(s, 'sheet');
    await cancel(s, t, sheet);

    await show(s, disk);
    const chip = s.page.locator('[data-region="main"] [data-chip="anchor"][data-anchor-kind="browser-element"]');
    await expect(chip).toHaveText(INCREMENT_LABEL);
    await s.page.mouse.move(700, 20);
    await shoot(s, 'transcript-chip');
  });
});
