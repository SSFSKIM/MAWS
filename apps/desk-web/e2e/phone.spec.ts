// M4 of the DC5 plan (DC5.G4), in a phone's viewport against the DX3 double: the grid, the group chat, a direct
// channel, and request cards in the phone's layouts (one column, the channel list a tap away, no depth); and a push's
// path to its card — the service worker draws the notification from the payload alone, with no Allow or Deny, and the
// URL a tap opens lands on the card once it verified, from which the answer reaches the machine authenticated.
//
// The layout cases (tagged @layout) also run in WebKit on the Linux lane (playwright.config.ts); the service worker's
// cases need Chromium's DevTools protocol to deliver a push, so they run there alone. Installing to an iPhone's home
// screen, Access, the passkey, and a real push service are the owner's walk (the plan's M4).
import { revealEarlier } from './transcript-history';
import { loadRecording, SESSION_VIEW, type Recording } from 'desk-hub/fake-machine';
import { inputSha256, seal, verifyRpc, importOrgKey, type JsonObject, type PushNotice, type Raised } from 'desk-hub/protocol';
import type { BrowserContext, Locator, Page } from '@playwright/test';
import { DOUBLE_MEMBER, type HubDouble } from '../test/double/hub-double';
import { VECTOR_KEY } from '../test/vectors';
import { FakeMachineReplay } from './fake-machine';
import { expect, seedKey, test } from './fixtures';
import { LONG_ANSWER, LONG_COMMAND, withLongInputs } from './long-inputs';
import { PROJECT, S, stageProject, summary } from './scene';

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });

const center = (page: Page) => page.getByRole('region', { name: 'Channel' });
const QUESTIONS = [{ question: 'Which column do we keep?', header: 'Column', options: [{ label: 'user_id', description: 'what the API reads' }, { label: 'owner_id', description: 'the new name' }], multiSelect: false }];
const raiseQuestion = (hub: HubDouble, request = 'toolu_q1') => hub.raise(PROJECT, 'mini', { request, session: S.asks, tool: 'AskUserQuestion', input: { questions: QUESTIONS } });
const notice = (request: string, waiting = 1): PushNotice => ({ v: 1, project: PROJECT, name: 'MAWS', session: S.asks, alias: 'maws-45', kind: 'question', request, waiting });

/** The machines of `stageProject`, `mini` offline: its sessions' channels are the log's. */
const miniOffline = (hub: HubDouble) =>
  hub.setMachines(PROJECT, [
    { machine: 'mini', online: false, policy: { read_only: false, ceiling: 'default' }, checkouts: [] },
    { machine: 'SK.local', online: true, policy: { read_only: false, ceiling: 'default' }, checkouts: [] },
  ]);
/** A session's subscription answered with an empty transcript, as a machine whose session has written nothing yet. */
async function emptyTranscript(hub: HubDouble, session: string, status: string | null) {
  await expect.poll(() => hub.subscriptions(PROJECT).some((s) => s.session === session)).toBe(true);
  const { sub } = hub.subscriptions(PROJECT).find((s) => s.session === session)!;
  hub.sendSub(PROJECT, sub, 'snapshot', { rows: [], more: false, subagents: [], presence: { record: status === null ? null : { status }, bridge: true }, streaming: [] });
}

/** What may scroll sideways inside its own box: code and command output, whose lines are not wrapped. */
const SIDEWAYS = 'pre, code, .transcript-output, .transcript-diff, table';
/**
 * Nothing on the page is wider than the phone: nothing drawn past its edge, and nothing inside it scrolling sideways.
 * Only truncated text may run past the edge: an element whose nearest clipping ancestor is a truncating box (clipped,
 * `text-overflow: ellipsis`) that ends inside the screen. Any other clipping box (a bordered panel, a header row)
 * would hide a control that ran off the screen, so it excuses nothing. A scroller holds what is past its own edge, and
 * only code and output blocks (`SIDEWAYS`) may scroll sideways, as they do on a desktop.
 */
async function fitsTheWidth(page: Page) {
  const overflow = await page.evaluate((sideways) => {
    const width = document.documentElement.clientWidth;
    const root = document.getElementById('root');
    const style = (el: Element) => getComputedStyle(el).overflowX;
    const truncates = (el: Element) => ['hidden', 'clip'].includes(style(el)) && getComputedStyle(el).textOverflow === 'ellipsis';
    // The nearest ancestor below the app's root that clips or scrolls `el`, if any (the root itself clips everything).
    const container = (el: HTMLElement) => {
      for (let up = el.parentElement; up && up !== root && up !== document.body; up = up.parentElement) if (style(up) !== 'visible') return up;
      return null;
    };
    const wide = [...document.querySelectorAll<HTMLElement>('body *')].filter((el) => {
      if (el.getBoundingClientRect().right <= width + 1 || getComputedStyle(el).position === 'fixed') return false;
      const box = container(el);
      if (box === null) return true;
      if (['auto', 'scroll'].includes(style(box))) return false; // a scroller holds what is past its edge; `scrolling` checks it
      return !truncates(box) || box.getBoundingClientRect().right > width + 1;
    });
    const scrolling = [...document.querySelectorAll<HTMLElement>('body *')].filter((el) => ['auto', 'scroll'].includes(style(el)) && el.scrollWidth > el.clientWidth + 1 && !el.closest(sideways));
    return { wide: wide.map((el) => `${el.tagName}.${el.className}`.slice(0, 80)), scrolling: scrolling.map((el) => `${el.tagName}.${el.className}`.slice(0, 80)) };
  }, SIDEWAYS);
  expect(overflow).toEqual({ wide: [], scrolling: [] });
}

test('@layout the grid in two columns; a project opens on its channel list, a channel is pushed over it, and back returns', async ({ page, hub }) => {
  await stageProject(hub);
  await seedKey(page, hub);
  await page.goto(hub.url);
  const tiles = page.getByTestId('grid').locator('li');
  await expect(tiles).toHaveCount(2);
  const [first, second] = [await tiles.nth(0).boundingBox(), await tiles.nth(1).boundingBox()];
  expect(Math.abs(second!.y - first!.y)).toBeLessThan(1); // side by side: two columns
  expect(second!.x).toBeGreaterThan(first!.x + first!.width - 1);
  await expect(page.getByTestId('menu')).toBeVisible();
  await fitsTheWidth(page);

  // The project opens on its channel list: the group chat first, then the sessions by group; no "+ Session" here.
  await page.locator(`[data-project="${PROJECT}"]`).click();
  await expect(page.getByTestId('project-view')).toHaveAttribute('data-layout', 'phone');
  const list = page.getByRole('navigation', { name: 'Channels' });
  await expect(list.locator('[data-group="waiting"]')).toContainText('maws-45');
  await expect(list).toContainText('group chat');
  await expect(list.getByRole('button', { name: '+ Session' })).toHaveCount(0);
  await expect(center(page)).toHaveCount(0);
  await expect(page.getByRole('complementary', { name: 'Session depth' })).toHaveCount(0); // depth stays desktop-only
  await fitsTheWidth(page);

  // The group chat, from the list, and back.
  await list.getByRole('button', { name: /MAWS/ }).click();
  await expect(center(page)).toContainText('the migration is merged');
  await expect(page.getByRole('textbox', { name: 'Message #MAWS' })).toBeVisible();
  await expect(list).toHaveCount(0);
  await fitsTheWidth(page);
  await page.getByRole('button', { name: 'Back to MAWS' }).click();
  await expect(list.locator(`[data-session="${S.asks}"]`)).toBeVisible();

  // A session's channel, pushed over the list: its session view, as a desktop draws it (the owner, 2026-10-18), its
  // status word in the header beside ⋯, and still no depth column.
  await list.locator(`[data-session="${S.asks}"]`).click();
  await expect(page).toHaveURL(new RegExp(`/p/${PROJECT}/s/${S.asks}$`));
  await expect(page.getByTestId('channel-header')).toContainText('maws-45');
  await expect(center(page).getByTestId('session-view')).toHaveAttribute('data-session', S.asks);
  await expect(page.getByTestId('channel-header').getByTestId('session-status')).toHaveText('Loading…');
  await expect(page.getByRole('complementary', { name: 'Session depth' })).toHaveCount(0);
  // Retire sits behind ⋯, with where depth opens.
  await expect(page.getByRole('button', { name: 'Retire…' })).toHaveCount(0);
  await page.getByRole('button', { name: 'maws-45: Retire, and what opens on a computer' }).click();
  await expect(page.getByTestId('channel-header')).toContainText("maws-45's subagents, jobs and diff open on a computer.");
  await expect(page.getByRole('button', { name: 'Retire…' })).toBeVisible();
  // The verbs that move a turn keep the row; model and compact sit behind More.
  await expect(page.locator('[data-verb="send"]')).toBeVisible();
  await expect(page.locator('[data-verb="model"]')).toHaveCount(0);
  await page.locator('[data-verb="more"]').click();
  await expect(page.locator('[data-verb="model"]')).toBeVisible();
  await expect(page.locator('[data-verb="compact"]')).toBeVisible();
  await fitsTheWidth(page);

  // Back goes to the list, then to the projects.
  await page.getByRole('button', { name: 'Back to MAWS' }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${PROJECT}$`));
  await expect(list.locator(`[data-session="${S.asks}"]`)).toBeVisible();
  await page.getByRole('button', { name: 'Projects' }).click();
  await expect(page.getByTestId('grid')).toBeVisible();
});

test("@layout the top bar keeps a long project name readable beside its controls, and never widens the desk past the phone", async ({ page, hub }) => {
  // A bar laid out at its content's width once set the desk's column, and with it the whole app, past the phone's edge.
  const name = 'doperpowers-desk-residue-phone-walk';
  await stageProject(hub);
  hub.updateSummary(summary({ name }));
  await seedKey(page, hub);
  const label = page.getByTestId('top-bar-label');
  /** At the phone's width and at the narrowest (320): the name holds its share, the controls are whole beside it. */
  const readable = async (fits: boolean) => {
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await expect(label).toBeVisible();
      const [bar, held, controls] = [await page.getByTestId('top-bar').boundingBox(), await label.boundingBox(), await page.getByTestId('top-bar-controls').boundingBox()];
      expect(bar!.x + bar!.width).toBeLessThanOrEqual(width);
      expect(held!.width).toBeGreaterThanOrEqual(80); // its floor: about a dozen characters
      expect(held!.x + held!.width).toBeLessThanOrEqual(controls!.x);
      for (const control of ['grid-status', 'key-state', 'menu']) await expect(page.getByTestId(control)).toBeInViewport({ ratio: 1 });
      if (fits && width === 390) await fitsTheWidth(page);
    }
  };
  const list = page.getByRole('navigation', { name: 'Channels' });
  await page.goto(`${hub.url}/p/${PROJECT}`);
  await expect(list).toBeVisible();
  await expect(label).toHaveText(name);
  await readable(true);
  await list.getByRole('button', { name: new RegExp(name) }).click();
  await expect(page.getByRole('button', { name: `Back to ${name}` })).toBeVisible();
  await readable(true);
  await page.goto(`${hub.url}/p/${PROJECT}/s/${S.asks}`);
  await expect(page.getByTestId('channel-header')).toContainText('maws-45');
  await readable(true);

  // The key's state at its longest: a Lock this device could not forget. The name keeps its floor and the key's state
  // truncates on one line.
  await page.getByRole('button', { name: `Back to ${name}` }).click();
  await page.evaluate(() => {
    IDBObjectStore.prototype.delete = () => {
      throw new DOMException('refused', 'UnknownError');
    };
  });
  await page.getByTestId('key-state').click();
  await page.getByRole('dialog', { name: 'Org key' }).getByRole('button', { name: 'Lock', exact: true }).click();
  await expect(page.getByTestId('forget-failed')).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByTestId('key-state')).toHaveText('Locked · key still stored');
  await readable(false);
  expect((await page.getByTestId('key-state').boundingBox())!.height).toBeLessThan(24); // one line
});

test('@layout the top bar is a bare dot while the hub is live, and says Reconnecting or Signed out beside it, whole at 390 and 320', async ({ page, hub }) => {
  // The dot alone left an owner unable to tell what a red one meant: the state is spelled out only when it needs them.
  const name = 'doperpowers-desk-residue-phone-walk';
  await stageProject(hub);
  hub.updateSummary(summary({ name }));
  await seedKey(page, hub);
  await page.goto(`${hub.url}/p/${PROJECT}`);
  await expect(page.getByTestId('project-view')).toHaveAttribute('data-connection', 'open');
  const status = page.getByTestId('grid-status');
  const word = page.getByTestId('grid-status-word');
  /** The word beside the dot is drawn (or not), and at the phone's width and the narrowest nothing is pushed off. */
  const bar = async (state: string, shown: boolean) => {
    await expect(status).toHaveAttribute('title', state, { timeout: 15_000 });
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      if (shown) await expect(word).toBeVisible();
      else expect((await word.boundingBox())!.width).toBeLessThanOrEqual(1); // there for a screen reader, not drawn
      await expect(word).toHaveText(state);
      const [held, controls] = [await page.getByTestId('top-bar-label').boundingBox(), await page.getByTestId('top-bar-controls').boundingBox()];
      expect((await page.getByTestId('top-bar').boundingBox())!.width).toBeLessThanOrEqual(width);
      expect(held!.width).toBeGreaterThanOrEqual(state === 'Live' ? 80 : 56); // the name's floor gives the word its room
      expect(held!.x + held!.width).toBeLessThanOrEqual(controls!.x);
      for (const control of ['grid-status', 'key-state', 'menu']) await expect(page.getByTestId(control)).toBeInViewport({ ratio: 1 });
      await fitsTheWidth(page);
    }
  };
  await bar('Live', false);
  expect((await status.boundingBox())!.width).toBeLessThan(16); // the dot, and nothing beside it

  hub.admit = 'unreachable';
  hub.dropConnections();
  await bar('Reconnecting', true);

  hub.admit = 'signed-out';
  await bar('Signed out', true);
});

test('@layout an ended session shows Resume in place of the composer, and a retired one who retired it', async ({ page, hub }) => {
  await stageProject(hub);
  hub.sendSession(PROJECT, { project: PROJECT, machine: 'mini', session: S.rests, kind: 'presence', sub: null, n: null, body: { record: null, bridge: true } });
  await seedKey(page, hub);
  await page.goto(`${hub.url}/p/${PROJECT}/s/${S.rests}`);
  await expect(page.getByTestId('resume-bar').getByRole('button', { name: 'Resume cua_repl' })).toBeVisible();
  await expect(page.getByTestId('composer')).toHaveCount(0);
  await emptyTranscript(hub, S.rests, null);
  await expect(center(page).getByTestId('session-view').getByTestId('end-marker')).toBeVisible(); // its history stays readable above
  await fitsTheWidth(page);
  await page.goto(`${hub.url}/p/${PROJECT}/s/${S.gone}`);
  await expect(page.getByTestId('retired-by')).toHaveText('Retired by human');
  await expect(page.getByTestId('resume-bar')).toHaveCount(0);
  await expect(page.getByTestId('composer')).toHaveCount(0);
});

test('@layout request cards fit the phone at the session view’s tail and are answered there: a question, a permission prompt with Allow and Deny', async ({ page, hub }) => {
  await stageProject(hub);
  await seedKey(page, hub);
  await page.goto(`${hub.url}/p/${PROJECT}/s/${S.asks}`);
  await expect(page.getByTestId('composer')).toBeVisible();
  await emptyTranscript(hub, S.asks, 'waiting');
  await raiseQuestion(hub);
  const BASH = { command: 'pnpm --filter desk-web e2e -- --grep "a very long argument that wraps on a phone"', description: 'Run the browser suites' };
  await hub.raise(PROJECT, 'mini', { request: 'toolu_b1', session: S.asks, tool: 'Bash', input: BASH });
  const view = center(page).getByTestId('session-view');
  const question = view.locator('[data-tail-request="toolu_q1"] [data-request="toolu_q1"]');
  await expect(question).toContainText('Which column do we keep?');
  await expect(question.getByRole('radio', { name: 'user_id' })).toBeVisible();
  const permission = view.locator('[data-tail-request="toolu_b1"] [data-request="toolu_b1"]');
  await expect(permission.getByRole('button', { name: 'Allow' })).toBeVisible();
  await expect(permission.getByRole('button', { name: 'Deny', exact: true })).toBeVisible();
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await permission.scrollIntoViewIfNeeded();
    await fitsTheWidth(page);
  }

  // Answered from the phone, each with the digest of what its card drew.
  const key = await importOrgKey(VECTOR_KEY);
  await question.scrollIntoViewIfNeeded();
  await question.getByRole('radio', { name: 'user_id' }).click();
  await question.getByRole('button', { name: 'Submit' }).click();
  await expect.poll(() => hub.rpcs(PROJECT).length).toBe(1);
  const answer = hub.rpcs(PROJECT)[0];
  expect(await verifyRpc(key, answer, PROJECT)).toBe(true);
  expect(answer.args).toEqual({ session: S.asks, answers: { 'Which column do we keep?': 'user_id' }, digest: { session: S.asks, request: 'toolu_q1', tool: 'AskUserQuestion', input_sha256: await inputSha256({ questions: QUESTIONS }) } });
  await permission.scrollIntoViewIfNeeded();
  await permission.getByRole('button', { name: 'Deny', exact: true }).click();
  await expect.poll(() => hub.rpcs(PROJECT).length).toBe(2);
  const decision = hub.rpcs(PROJECT)[1];
  expect(await verifyRpc(key, decision, PROJECT)).toBe(true);
  expect(decision.args).toMatchObject({ session: S.asks, decision: 'deny', digest: { session: S.asks, request: 'toolu_b1', tool: 'Bash', input_sha256: await inputSha256(BASH) } });
  hub.answerRpc(PROJECT, answer.nonce, { state: 'done', result: {} });
  hub.answerRpc(PROJECT, decision.nonce, { state: 'done', result: {} });
  await hub.settle(PROJECT, 'mini', S.asks, { request: 'toolu_q1', winner: 'web', outcome: 'answered', by: DOUBLE_MEMBER.id });
  await hub.settle(PROJECT, 'mini', S.asks, { request: 'toolu_b1', winner: 'web', outcome: 'deny', by: DOUBLE_MEMBER.id });
  await expect(question).toHaveCount(0);
  await expect(permission).toHaveCount(0);
});

// The session view on the phone (the owner, 2026-10-18): the same view a desktop draws, against DC3's fake machine
// replaying the `session-view` recording as a DC8 producer, with a turn added whose tool calls carry inputs far wider
// than the phone (`long-inputs.ts`).
const MACHINE = 'fake';
let fm: FakeMachineReplay | null = null;
test.afterEach(() => {
  fm?.stop();
  fm = null;
});

/** The fake machine replaying `recording`, its session joined, and the phone on its channel. */
async function openReplay(page: Page, hub: HubDouble, recording: Recording): Promise<{ fm: FakeMachineReplay; view: Locator }> {
  await stageProject(hub);
  const replay = (fm = new FakeMachineReplay(hub, { project: PROJECT, machine: MACHINE }, { recording, producer: 'dc8' }));
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
  const view = center(page).getByTestId('session-view');
  await expect(view).toHaveAttribute('data-session', replay.session);
  await expect.poll(() => replay.subscriptions()).toBe(1);
  return { fm: replay, view };
}
/** The session's end on the recording's timeline: its presence going to no process. */
const endOf = (recording: Recording) => recording.steps.findIndex((s) => s.k === 'presence' && s.record === null);
const scroller = (view: Locator) => view.locator('[data-transcript-scroller]');
const toBottom = (view: Locator) => scroller(view).evaluate((el) => el.scrollTo({ top: el.scrollHeight }));

test("@layout a session's channel on the phone is its session view: its working record unfolds in place, each tool call one line that opens on a tap, long inputs truncated, and at 390 and 320 nothing wider than the screen", async ({ page, hub }) => {
  const { fm, view } = await openReplay(page, hub, withLongInputs(loadRecording(SESSION_VIEW)));
  fm.step(endOf(fm.recording)); // every row in, the session idle and still running
  const answer = view.locator('.owner-message-ink').filter({ hasText: LONG_ANSWER });
  await expect(answer).toBeVisible();
  await expect(page.getByRole('group', { name: 'Session view' })).toBeVisible(); // Report · Transcript, as on a desktop
  await expect(page.getByRole('complementary', { name: 'Session depth' })).toHaveCount(0);

  // The recorded subagents' row, in the turn that launched them, is a plain row here: their tree is the depth column's,
  // which stays on a computer, so nothing in it opens one.
  const launched = view.locator('[data-row-id^="user:"]').filter({ hasText: 'Do these four steps' });
  for (let i = 0; i < 80 && (await launched.count()) === 0; i++) {
    await scroller(view).evaluate((el) => { el.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -200 })); el.scrollBy({ top: -el.clientHeight * 0.6 }); });
    await page.waitForTimeout(60);
  }
  const launchTurn = await launched.locator('[data-turn-id]').first().getAttribute('data-turn-id');
  const launchDivider = view.locator(`[data-row-id="divider:${launchTurn}"] button.transcript-disclosure`);
  for (let i = 0; i < 40 && (await launchDivider.count()) === 0; i++) {
    await scroller(view).evaluate((el) => el.scrollBy({ top: el.clientHeight * 0.4 }));
    await page.waitForTimeout(60);
  }
  await launchDivider.click();
  const subagents = view.locator(`[data-turn-id="${launchTurn}"] .transcript-subagent`);
  await expect(subagents).toHaveCount(1);
  await expect(subagents.locator('button')).toHaveCount(0);
  await revealEarlier(view, launchDivider); // expansion can recycle the divider outside the mounted window
  await launchDivider.click();

  // The added turn: its prompt, one closed record, its message.
  await toBottom(view);
  const turn = 'turn:10a91e55-0000-4000-8000-000000000001';
  const record = view.locator(`[data-row-id="owner-record:${turn}"]`);
  await expect(record).toContainText('Working record · 3 tool calls');
  await expect(view).not.toContainText('Ran the phone layout cases in WebKit');
  await fitsTheWidth(page);

  // One record disclosure unfolds directly to the tool summaries; each call's detail stays one tap away.
  const disclosure = record.locator('button.transcript-disclosure');
  await disclosure.click();
  await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
  await expect(disclosure).toContainText('Worked for');
  await expect(disclosure).toContainText('3 tool calls');
  await expect(view.locator(`[data-row-id="divider:${turn}"]`)).toHaveCount(0);
  // UX1-C exposes tool summaries directly; there is no second group disclosure.
  await expect(view.locator(`[data-turn-id="${turn}"] .transcript-tool-block`)).toBeVisible();
  await expect(view.locator(`[data-turn-id="${turn}"] .transcript-group-header`)).toHaveCount(0);
  const lines = view.locator(`[data-turn-id="${turn}"] .transcript-cell-line`);
  await expect(lines).toHaveCount(3);
  const bash = lines.filter({ hasText: 'Ran the phone layout cases in WebKit' });
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await bash.scrollIntoViewIfNeeded();
    await expect(bash).toBeVisible();
    // Each summary is one line inside the screen; the long description, path and pattern end in an ellipsis
    // rather than widening it.
    for (const line of await lines.all()) {
      const box = (await line.boundingBox())!;
      expect(box.height).toBeLessThan(40);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      const label = line.locator('.transcript-cell-label');
      expect(await label.evaluate((el) => el.scrollWidth > el.clientWidth && getComputedStyle(el).textOverflow === 'ellipsis')).toBe(true);
    }
    await fitsTheWidth(page);
  }

  // A tap opens a call's input and output in place; their long lines wrap or scroll inside it.
  await bash.click();
  await expect(bash).toHaveAttribute('aria-expanded', 'true');
  const detail = view.locator(`[data-turn-id="${turn}"] .transcript-cell[data-expanded]`);
  await expect(detail).toContainText(LONG_COMMAND);
  await expect(detail).toContainText('2 passed');
  await fitsTheWidth(page);
  const copy = await detail.getByRole('button', { name: 'Copy command' }).boundingBox(); // the heading wraps the command, not the button
  expect(copy!.x + copy!.width).toBeLessThanOrEqual(320);
  await bash.click();
  await expect(bash).toHaveAttribute('aria-expanded', 'false');

  // Folded again to the report.
  await disclosure.click();
  await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
  await expect(record).toContainText('Working record · 3 tool calls');
  await expect(view).not.toContainText('Ran the phone layout cases in WebKit');
});

test('@layout the running turn streams on the phone: the answer draws as it is written, its folded record working', async ({ page, hub }) => {
  const { fm, view } = await openReplay(page, hub, loadRecording(SESSION_VIEW));
  const recording = fm.recording;
  const uuid = recording.rows.main.find((row) => JSON.stringify(row.message ?? {}).includes('<message>You chose'))!.uuid;
  const named = recording.steps.find((s) => s.k === 'block-row' && s.body.uuid === uuid);
  if (named?.k !== 'block-row') throw new Error('no block-row');
  const first = recording.steps.findIndex((s) => s.k === 'chunk' && s.turnId === named.body.turnId && s.agentId === null && s.step === named.body.step && s.chunk.index === named.body.index);
  fm.step(first - fm.played); // up to the answer's first chunk
  const streaming = view.locator('[data-row-id^="desk-stream:"]');
  for (let i = 0; i < 40 && !(await streaming.allTextContents()).join('').includes('You chose blue'); i++) {
    fm.step(1);
    await page.waitForTimeout(20);
  }
  // An open mark already folds the working turn, but its unfinished text remains literal and without ink.
  await expect(streaming.last()).toContainText('<message>You chose blue');
  await expect(streaming.last().locator('.owner-message-ink')).toHaveCount(0);
  await expect(view.locator('[data-row-id^="owner-record:"] .transcript-working-dots')).toHaveCount(1);
  await expect(view).not.toContainText("Wrote 'blue' to recorded.txt in the current directory");
  const answerBlock = recording.steps.find((s) => s.k === 'block-row' && s.body.uuid === uuid)!;
  if (answerBlock.k !== 'block-row') throw new Error('no block-row');
  const lastText = recording.steps.findLastIndex((s) => s.k === 'chunk' && s.turnId === answerBlock.body.turnId && s.step === answerBlock.body.step && s.chunk.index === answerBlock.body.index && s.chunk.kind === 'text');
  fm.step(lastText + 1 - fm.played);
  await toBottom(view);
  await expect(streaming.last().locator('.owner-message-ink')).toContainText('You chose blue');
  expect(fm.depth.rows.get('main')!.some((row) => row.uuid === uuid)).toBe(false); // its row is not written yet
  await expect(view.locator('[data-row-id^="owner-record:"] .transcript-working-dots')).toHaveCount(1);
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await fitsTheWidth(page);
  }
  await expect(page.getByTestId('composer').locator('[data-verb="steer"]')).toBeVisible(); // while it works, Steer
});

test('@layout the phone steers the running turn and sends to an idle session from the session view', async ({ page, hub }) => {
  const { fm, view } = await openReplay(page, hub, loadRecording(SESSION_VIEW));
  fm.step(1);
  hub.sendSession(PROJECT, { project: PROJECT, machine: MACHINE, session: fm.session, kind: 'presence', sub: null, n: null, body: { record: { status: 'busy' }, bridge: true } });
  const box = page.getByRole('textbox', { name: 'Message fakerec' });
  const composer = page.getByTestId('composer');
  await box.fill('the failing case first');
  await composer.locator('[data-verb="steer"]').click();
  await expect.poll(() => hub.rpcs(PROJECT).length).toBe(1);
  const steer = hub.rpcs(PROJECT)[0];
  expect(await verifyRpc(await importOrgKey(VECTOR_KEY), steer, PROJECT)).toBe(true);
  expect(steer).toMatchObject({ rpc: 'steer', machine: MACHINE, args: { session: fm.session, text: 'the failing case first' } });
  await expect(view.getByTestId('tail-send')).toContainText('the failing case first'); // at the tail until its row is in
  hub.answerRpc(PROJECT, steer.nonce, { state: 'done', result: { row: 'u1' } });
  await expect(composer).toContainText('Steered: read at the next model request');

  hub.sendSession(PROJECT, { project: PROJECT, machine: MACHINE, session: fm.session, kind: 'presence', sub: null, n: null, body: { record: { status: 'idle' }, bridge: true } });
  await expect(composer.locator('[data-verb="steer"]')).toHaveCount(0);
  await box.fill('and then the rest');
  await composer.locator('[data-verb="send"]').click();
  const humans = () => hub.up.filter((u) => u.frame.t === 'human').map((u) => (u.frame as { event: { to: unknown; text: string } }).event);
  await expect.poll(() => humans().map((h) => h.text)).toEqual(['and then the rest']);
  await expect(view.getByTestId('tail-send').filter({ hasText: 'and then the rest' })).toBeVisible();
  await fitsTheWidth(page);
});

test("@layout with the session's machine offline the phone draws the log's channel, saying why, its working record a label", async ({ page, hub }) => {
  const { fm, view } = await openReplay(page, hub, loadRecording(SESSION_VIEW));
  fm.step(endOf(fm.recording));
  const [message] = fm.recordedMessages();
  const draft: JsonObject = { ...message, writer: `${MACHINE}/${fm.session}` };
  delete draft.ts;
  delete draft.seq;
  await hub.append(PROJECT, draft as never);
  await revealEarlier(view, view.locator('.owner-message-ink').filter({ hasText: 'You chose blue' }));
  await expect(view.locator('.owner-message-ink').filter({ hasText: 'You chose blue' })).toBeVisible();
  hub.dropMachine(PROJECT, MACHINE);
  await expect(page.getByTestId('machine-offline')).toContainText('fake is offline');
  await expect(center(page).getByTestId('session-view')).toHaveCount(0);
  await expect(center(page)).toContainText('You chose blue'); // the log's `message`
  await expect(center(page).getByTestId('working-record').first()).toHaveText(`Working record · ${MACHINE} is offline`);
  await expect(center(page).getByRole('button', { name: /working record/i })).toHaveCount(0);
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await fitsTheWidth(page);
  }
});

test('@layout a channel opens at its tail and follows it; a reader scrolled back keeps their row as a message arrives below', async ({ browserName, page, hub }) => {
  // Holding a reader in place against a row arriving below them is the engine's scroll anchoring, where it has any; an
  // engine with none (Safari before 27) takes the channel's fallback, which the next case proves. The session's machine
  // is offline, where a direct channel is the log's.
  await stageProject(hub);
  miniOffline(hub);
  const message = (n: number) => hub.append(PROJECT, { writer: `mini/${S.asks}`, kind: 'message', from: 'maws-45', to: 'host', text: `line ${n}`, src: `rw${n}#0` });
  for (let n = 1; n <= 30; n++) await message(n);
  await seedKey(page, hub);
  await page.goto(`${hub.url}/p/${PROJECT}/s/${S.asks}`);
  const line = (n: number) => center(page).getByText(`line ${n}`, { exact: true });
  await expect(line(30)).toBeInViewport();
  await message(31);
  await expect(line(31)).toBeInViewport();
  const events = center(page).getByTestId('channel-events');
  expect(await events.evaluate((el) => getComputedStyle(el).flexDirection)).toBe('column-reverse');
  expect(await events.evaluate((el) => el.scrollTop)).toBeCloseTo(0, 0); // the bottom is the scroll origin
  await events.evaluate((el) => (el.scrollTop = -150));
  await page.waitForTimeout(300);
  expect(await events.evaluate((el) => el.scrollTop)).toBeCloseTo(-150, 0); // 0 at the bottom, negative upward
  const reading = await line(28).boundingBox();
  await message(32);
  await expect(line(32)).toBeAttached();
  await page.waitForTimeout(300);
  const moved = (await line(28).boundingBox())!.y - reading!.y;
  test.info().annotations.push({ type: `row moved (px), ${browserName}`, description: moved.toFixed(2) });
  expect(Math.abs(moved)).toBeLessThanOrEqual(1);
});

/**
 * The engine's own scroll anchoring turned off in the channel and `overflow-anchor` reported unsupported, so the channel
 * takes its fallback and nothing else holds the reader: the owner's phone on iOS 26 or older. Whether the engine has
 * anchoring of its own is kept as `nativeAnchoring` on the window.
 */
const withoutAnchoring = (page: Page) =>
  page.addInitScript(() => {
    const supports = CSS.supports.bind(CSS) as (...args: string[]) => boolean;
    (window as { nativeAnchoring?: boolean }).nativeAnchoring = supports('overflow-anchor', 'auto');
    Object.defineProperty(CSS, 'supports', { value: (...args: string[]) => !args.join(' ').includes('overflow-anchor') && supports(...args) });
    const off = document.createElement('style');
    off.textContent = '[data-testid="channel-events"], [data-testid="channel-events"] * { overflow-anchor: none !important; }';
    document.addEventListener('DOMContentLoaded', () => document.head?.append(off));
  });

for (const anchoring of ['the engine’s', 'none'] as const)
  test(`@layout a reader scrolled back keeps their row when the channel itself resizes: the composer growing and shrinking, the window shorter and taller, a rotation, nearer the oldest edge than it grows too; at the tail the tail stays in view (scroll anchoring: ${anchoring})`, async ({ browserName, page, hub }) => {
    // The column-reverse scroller keeps a reader at their distance from the bottom, so a change of its own height moves
    // every row they can see by as much (the composer growing, a keyboard that resizes the page, a rotation) unless the
    // engine's anchoring holds them, which none can where the change clamps them at the oldest edge, and which Safari
    // before 27 does not have.
    if (anchoring === 'none') await withoutAnchoring(page);
    await stageProject(hub);
    // Long enough to wrap on a phone held upright and not on one turned on its side.
    const message = (n: number) => hub.append(PROJECT, { writer: `mini/${S.asks}`, kind: 'message', from: 'maws-45', to: 'host', text: `line ${n}: a line that wraps on a phone held upright, not on its side`, src: `rz${n}#0` });
    for (let n = 1; n <= 40; n++) await message(n);
    await seedKey(page, hub);
    await page.goto(`${hub.url}/p/${PROJECT}`);
    await page.getByRole('navigation', { name: 'Channels' }).getByRole('button', { name: /MAWS/ }).click();
    const events = center(page).getByTestId('channel-events');
    const textbox = page.getByRole('textbox', { name: 'Message #MAWS' });
    const last = center(page).getByText(/^line 40:/);
    await expect(last).toBeInViewport();
    if (anchoring === 'none') expect(await events.evaluate((el) => getComputedStyle(el).overflowAnchor)).toBe('none');
    /** The reader's row: the first item whose top is inside the view. */
    const topItem = async () =>
      events.locator('[data-item]').nth(
        await events.evaluate((el) => {
          const top = el.getBoundingClientRect().top;
          return [...el.querySelectorAll('[data-item]')].findIndex((item) => item.getBoundingClientRect().top >= top);
        }),
      );
    const moves: string[] = [];
    /** How far the reader's row moved through `change`, which resizes the channel; under 1 px is whole-pixel rounding. */
    const holds = async (what: string, change: () => Promise<unknown>, held = true) => {
      const row = await topItem();
      const [before, height] = [(await row.boundingBox())!.y, await events.evaluate((el) => el.clientHeight)];
      await change();
      await page.waitForTimeout(300);
      expect(Math.abs((await events.evaluate((el) => el.clientHeight)) - height), `${what} resizes the channel`).toBeGreaterThan(50);
      const moved = (await row.boundingBox())!.y - before;
      moves.push(`${what}: ${moved.toFixed(2)}`);
      if (held) expect.soft(Math.abs(moved), `${what}, moved ${moved.toFixed(2)} px`).toBeLessThanOrEqual(1);
    };
    await events.evaluate((el) => (el.scrollTop = -300));
    await page.waitForTimeout(300);
    await holds('the composer growing', () => textbox.evaluate((el) => (el.style.height = '200px')));
    await holds('the composer shrinking', () => textbox.evaluate((el) => (el.style.height = '')));
    await holds('the window shorter', () => page.setViewportSize({ width: 390, height: 560 }));
    await holds('the window taller', () => page.setViewportSize({ width: 390, height: 844 }));
    // A rotation that keeps the phone's layout (an iPhone SE's landscape) rewraps every row as the channel shrinks:
    // without the engine's anchoring the channel holds the row through both, its hold and then the fallback's
    // anchoring of the rewrap; with it, the rewrap is the engine's to hold.
    await holds('a rotation to landscape', () => page.setViewportSize({ width: 667, height: 375 }), anchoring === 'none');
    await holds('a rotation back', () => page.setViewportSize({ width: 390, height: 844 }), anchoring === 'none');
    // Nearer the oldest edge than the channel grows: the browser clamps the reader to the edge before the channel sees
    // the change, so where they were is the place they last scrolled to.
    await page.setViewportSize({ width: 390, height: 560 });
    await events.evaluate((el) => el.scrollBy(0, -1e7));
    await page.waitForTimeout(300);
    await events.evaluate((el) => el.scrollBy(0, 100));
    await page.waitForTimeout(300);
    await holds('the window taller, the reader nearer the oldest edge than it grows', () => page.setViewportSize({ width: 390, height: 844 }));
    test.info().annotations.push({ type: `row moved on a resize (px), ${browserName}, anchoring: ${anchoring}`, description: moves.join('; ') });

    // At the tail the tail stays in view.
    await events.evaluate((el) => (el.scrollTop = 0));
    await page.waitForTimeout(300);
    await textbox.evaluate((el) => (el.style.height = '200px'));
    await page.waitForTimeout(300);
    expect(await events.evaluate((el) => el.scrollTop)).toBeCloseTo(0, 0);
    await expect(last).toBeInViewport();

    // A scroll of the reader's own in the same moment as a resize, before either is reported, stands: from the tail
    // back into the history, and from there to the tail.
    const together = (top: number, composer: string) =>
      textbox.evaluate(
        (el, [top, composer]) => {
          document.querySelector<HTMLElement>('[data-testid="channel-events"]')!.scrollTop = Number(top);
          el.style.height = String(composer);
        },
        [top, composer],
      );
    await together(-200, '');
    await page.waitForTimeout(300);
    expect(await events.evaluate((el) => el.scrollTop), 'scrolled back as the composer shrank').toBeLessThan(-1);
    await together(0, '200px');
    await page.waitForTimeout(300);
    expect(await events.evaluate((el) => el.scrollTop), 'scrolled to the tail as the composer grew').toBeCloseTo(0, 0);
  });

test('@layout on an engine without scroll anchoring (Safari before 27), a reader scrolled back keeps their row as a message arrives below and as a row below or above them grows or shrinks, nearer the oldest edge than a shrink too, and their line in an opened run of agent traffic as a say arrives in it; at the tail the channel follows', async ({ browserName, page, hub }) => {
  await withoutAnchoring(page);
  await stageProject(hub);
  const say = (n: number) => hub.append(PROJECT, { writer: `mini/${S.asks}`, kind: 'say', from: 'maws-45', to: [{ session: S.works, alias: 'maws-fe' }], text: `say ${n}` });
  const message = (n: number) => hub.append(PROJECT, { writer: `mini/${S.asks}`, kind: 'message', from: 'maws-45', to: 'host', text: `line ${n}`, src: `rf${n}#0` });
  for (let n = 1; n <= 8; n++) await say(n); // a run of agent traffic far above the reader
  for (let n = 1; n <= 30; n++) await message(n);
  for (let n = 9; n <= 16; n++) await say(n); // and one just below them
  await message(31);
  await seedKey(page, hub);
  await page.goto(`${hub.url}/p/${PROJECT}`);
  await page.getByRole('navigation', { name: 'Channels' }).getByRole('button', { name: /MAWS/ }).click();
  const line = (n: number) => center(page).getByText(`line ${n}`, { exact: true });
  const events = center(page).getByTestId('channel-events');
  await expect(line(31)).toBeInViewport();
  const native = await page.evaluate(() => (window as { nativeAnchoring?: boolean }).nativeAnchoring);
  expect(await page.evaluate(() => CSS.supports('overflow-anchor', 'auto'))).toBe(false);
  if (native) expect(await events.evaluate((el) => getComputedStyle(el).overflowAnchor)).toBe('none');

  // At the tail the scroll origin follows, with nothing to hold.
  await message(32);
  await expect(line(32)).toBeInViewport();
  expect(await events.evaluate((el) => el.scrollTop)).toBeCloseTo(0, 0);

  await events.evaluate((el) => (el.scrollTop = -150));
  await page.waitForTimeout(300);
  await expect(line(28)).toBeInViewport();
  const runs = center(page).getByTestId('agent-run');
  /** Unfolds or folds a run without scrolling to it, as a row changing on its own. */
  const toggle = async (run: Locator, open: boolean) => {
    await run.getByRole('button').evaluate((b) => (b as HTMLButtonElement).click());
    await expect(run.getByTestId('agent-run-messages')).toHaveCount(open ? 1 : 0);
  };
  const moves: string[] = [];
  /** How far the reader's row moved through `change`; under 1 px is whole-pixel rounding. */
  const holds = async (what: string, row: Locator, change: () => Promise<unknown>) => {
    const before = (await row.boundingBox())!.y;
    await change();
    await page.waitForTimeout(300);
    const moved = (await row.boundingBox())!.y - before;
    moves.push(`${what}: ${moved.toFixed(2)}`);
    expect.soft(Math.abs(moved), `${what}, moved ${moved.toFixed(2)} px`).toBeLessThanOrEqual(1);
  };
  await holds('a message arriving below', line(28), async () => {
    await message(33);
    await expect(line(33)).toBeAttached();
  });
  await holds('a row below growing', line(28), () => toggle(runs.nth(1), true));
  await holds('a row above growing', line(28), () => toggle(runs.first(), true));
  await holds('a row below shrinking', line(28), () => toggle(runs.nth(1), false));
  // At the oldest edge a list that shrinks has the browser clamp the reader, and the edge is their place.
  await toggle(runs.nth(1), true);
  await events.evaluate((el) => el.scrollBy(0, -1e7));
  await page.waitForTimeout(300);
  const oldest = center(page).getByText('the migration is merged', { exact: true });
  await expect(oldest).toBeInViewport();
  await holds('a row below shrinking, at the oldest edge', oldest, () => toggle(runs.nth(1), false));
  // Nearer the oldest edge than a row below them shrinks, but not at it: the browser clamps the reader to the edge
  // before the fallback sees the change, so where they were is the place they last scrolled to.
  await toggle(runs.nth(1), true);
  const shrink = await runs.nth(1).getByTestId('agent-run-messages').evaluate((el) => el.getBoundingClientRect().height);
  expect(shrink).toBeGreaterThan(60);
  await events.evaluate((el) => el.scrollBy(0, -1e7));
  await page.waitForTimeout(300);
  await events.evaluate((el, by) => el.scrollBy(0, by), Math.round(shrink / 2));
  await page.waitForTimeout(300);
  await holds('a row below shrinking, the reader nearer the oldest edge than it shrinks', line(1), () => toggle(runs.nth(1), false));
  // A sender's run is one block, so a message arriving in the run the reader is in changes that block from inside it:
  // the run below the traffic grows past a screen at the tail, and the reader, scrolled back within it, keeps their row.
  await events.evaluate((el) => (el.scrollTop = 0));
  for (let n = 34; n <= 80; n++) await message(n);
  await expect(line(80)).toBeInViewport();
  await events.evaluate((el) => (el.scrollTop = -150));
  await page.waitForTimeout(300);
  const reader = line(76);
  await expect(reader).toBeInViewport();
  await expect(line(31)).not.toBeInViewport();
  await expect(center(page).getByTestId('run').filter({ has: page.getByText('line 31', { exact: true }) })).toContainText('line 80'); // the view's top is inside the run
  await holds('a message arriving in the run the reader is in', reader, async () => {
    await message(81);
    await expect(center(page).getByTestId('run').filter({ has: page.getByText('line 31', { exact: true }) })).toContainText('line 81');
  });
  // An opened run of agent traffic is one item with its lines inside it: at the tail, the run taller than the view, the
  // reader scrolled back into it keeps their line as a say arrives in the run.
  await events.evaluate((el) => (el.scrollTop = 0));
  for (let n = 17; n <= 76; n++) await say(n);
  const tail = runs.last();
  await expect(tail).toContainText('60 messages between agents');
  await toggle(tail, true);
  await events.evaluate((el) => (el.scrollTop = -150));
  await page.waitForTimeout(300);
  await expect(tail.getByText('say 17', { exact: true })).not.toBeInViewport(); // the view's top is inside the run
  const first = await events.evaluate((el) => {
    const top = el.getBoundingClientRect().top;
    const lines = [...el.querySelectorAll('[data-testid="agent-run-messages"] > li')];
    return lines.find((li) => li.getBoundingClientRect().top >= top)?.querySelector('.desk-chat-said')?.textContent?.trim() ?? '';
  });
  expect(first).toMatch(/^say \d+$/);
  await holds('a say arriving in the opened run the reader is in', tail.getByText(first, { exact: true }), async () => {
    await say(77);
    await expect(tail.getByText('say 77', { exact: true })).toBeAttached();
  });
  test.info().annotations.push({ type: `row moved (px), ${browserName}, no anchoring (native: ${native})`, description: moves.join('; ') });
});

type Shown ={ title: string; options: { body?: string; tag?: string; data?: { url?: string }; actions?: unknown[] } };

/**
 * The running service worker, with each notification it asks the platform for recorded as it asks (headless Chromium
 * may display none, and what the worker asked for is what is proved), and a push delivered to it through Chromium's
 * DevTools protocol, as a push service's would arrive.
 */
async function serviceWorker(context: BrowserContext, page: Page) {
  const cdp = await context.newCDPSession(page);
  const registrations = new Map<string, string>();
  cdp.on('ServiceWorker.workerRegistrationUpdated', ({ registrations: updated }) => {
    for (const r of updated as Array<{ registrationId: string; scopeURL: string; isDeleted: boolean }>) if (!r.isDeleted) registrations.set(r.scopeURL, r.registrationId);
  });
  await cdp.send('ServiceWorker.enable');
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await expect.poll(() => registrations.size).toBeGreaterThan(0);
  const [scope, registrationId] = [...registrations][0];
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  await worker.evaluate(() => {
    const scope = self as unknown as {
      registration: { showNotification(title: string, options?: object): Promise<void> };
      navigator: { setAppBadge?(count: number): Promise<void> };
      __shown: unknown[];
      __badges: number[];
    };
    const show = scope.registration.showNotification.bind(scope.registration);
    scope.__shown = [];
    scope.__badges = [];
    // The badge the worker asks for, whether or not this platform draws one.
    Object.defineProperty(scope.navigator, 'setAppBadge', { configurable: true, value: async (count: number) => void scope.__badges.push(count) });
    scope.registration.showNotification = (title, options) => {
      scope.__shown.push({ title, options });
      return show(title, options).catch(() => {});
    };
  });
  return {
    deliver: async (data: string) => void (await cdp.send('ServiceWorker.deliverPushMessage', { origin: new URL(scope).origin, registrationId, data })),
    shown: () => worker.evaluate(() => (self as unknown as { __shown: Shown[] }).__shown),
    badges: () => worker.evaluate(() => (self as unknown as { __badges: number[] }).__badges),
  };
}

test('a pushed question draws from its payload alone, with no Allow or Deny, and its tap lands on the verified card', async ({ browserName, context, page, hub }) => {
  test.skip(browserName !== 'chromium', "a push is delivered through Chromium's DevTools protocol");
  await stageProject(hub);
  await seedKey(page, hub);
  await context.grantPermissions(['notifications'], { origin: hub.url });
  await page.goto(hub.url);
  await expect(page.getByTestId('grid')).toBeVisible();
  const worker = await serviceWorker(context, page);

  await raiseQuestion(hub);
  await worker.deliver(JSON.stringify(notice('toolu_q1', 3)));
  await expect.poll(worker.shown).toHaveLength(1);
  const [notification] = await worker.shown();
  expect(notification.title).toBe('maws-45 has a question for you');
  expect(notification.options.body).toBe('MAWS · Opens at the question');
  expect(await worker.badges()).toEqual([3]); // the org's waiting count, on the app icon
  expect(notification.options.actions).toBeUndefined(); // no Allow, no Deny: the worker holds no key to answer with
  const url = notification.options.data!.url!;
  expect(url).toBe(`/p/${PROJECT}/s/${S.asks}?request=toolu_q1`);

  // A payload it cannot read still draws a notification (a silent push costs the subscription on iOS), opening the grid.
  await worker.deliver('not json');
  await expect.poll(async () => (await worker.shown()).map((n) => n.title)).toEqual(['maws-45 has a question for you', 'The desk']);
  expect(await worker.badges()).toEqual([3]); // a push without a count leaves the badge as it was

  // A tap with no window open opens one at the card's URL (what `clients.openWindow` is handed): the card lands once
  // it verified, and the answer from the phone reaches the machine sealed, with the digest of what was drawn.
  const phone = await context.newPage();
  await phone.goto(`${hub.url}${url}`);
  const landed = center(phone).locator('[data-landed]');
  await expect(landed).toContainText('Which column do we keep?');
  await expect(landed.locator('[data-request="toolu_q1"]')).toBeVisible();
  await expect(phone).toHaveURL(new RegExp(`/p/${PROJECT}/s/${S.asks}$`)); // the landing is read once, then dropped
  await landed.getByRole('radio', { name: 'user_id' }).click();
  await landed.getByRole('button', { name: 'Submit' }).click();
  await expect.poll(() => hub.rpcs(PROJECT).length).toBe(1);
  const [answer] = hub.rpcs(PROJECT);
  expect(await verifyRpc(await importOrgKey(VECTOR_KEY), answer, PROJECT)).toBe(true);
  expect(answer.member).toBe(DOUBLE_MEMBER.id);
  expect(answer.args).toEqual({ session: S.asks, answers: { 'Which column do we keep?': 'user_id' }, digest: { session: S.asks, request: 'toolu_q1', tool: 'AskUserQuestion', input_sha256: await inputSha256({ questions: QUESTIONS }) } });
});

test('a tap with the app already open sends that window to the card, in place', async ({ page, hub }) => {
  await stageProject(hub);
  await seedKey(page, hub);
  await page.goto(hub.url);
  await expect(page.getByTestId('grid')).toBeVisible();
  await raiseQuestion(hub, 'toolu_q2');
  // What the worker posts to the window it brings forward (`OPEN_MESSAGE`; handlers.test.ts proves the worker's side).
  await page.evaluate((url) => navigator.serviceWorker.dispatchEvent(new MessageEvent('message', { data: { type: 'desk-open', url } })), `/p/${PROJECT}/s/${S.asks}?request=toolu_q2`);
  await expect(center(page).locator('[data-landed]')).toContainText('Which column do we keep?');
  await expect(page).toHaveURL(new RegExp(`/p/${PROJECT}/s/${S.asks}$`));
});

test('a tap reaches a window still waiting on its sign-in, and lands on the card once the desk is drawn', async ({ page, hub }) => {
  await stageProject(hub);
  await seedKey(page, hub);
  let signIn!: () => void;
  const signedIn = new Promise<void>((resolve) => (signIn = resolve));
  await page.route('**/api/me', async (route) => (await signedIn, route.continue()));
  await page.goto(hub.url); // the document is loaded: a message no listener takes is dropped from here on
  await raiseQuestion(hub, 'toolu_q3');
  await page.evaluate((url) => navigator.serviceWorker.dispatchEvent(new MessageEvent('message', { data: { type: 'desk-open', url } })), `/p/${PROJECT}/s/${S.asks}?request=toolu_q3`);
  signIn();
  await expect(center(page).locator('[data-landed]')).toContainText('Which column do we keep?');
  await expect(page).toHaveURL(new RegExp(`/p/${PROJECT}/s/${S.asks}$`));
});

test('a card the push named says why it is not drawn: settled before the tap, or failing verification', async ({ page, hub }) => {
  await stageProject(hub);
  await seedKey(page, hub);
  await page.goto(`${hub.url}/p/${PROJECT}/s/${S.asks}?request=toolu_settled_hours_ago`);
  await expect(page.getByTestId('landing')).toHaveText(/This request is no longer waiting: it was answered or withdrawn before you opened it\./);

  // A request settled before the tap is in the conversation's store (the audit record's `decided`, replayed after
  // caught-up, carries its `raised`), yet the session view draws only pending cards at its tail: the tap says why.
  // The group chat draws it settled once the store holds it, and the tap then lands in place, so the store keeps it.
  await hub.raise(PROJECT, 'mini', { request: 'toolu_settled_before', session: S.asks, tool: 'Bash', input: { command: 'pnpm e2e', description: 'Run the e2e suite' } });
  await hub.settle(PROJECT, 'mini', S.asks, { request: 'toolu_settled_before', winner: 'web', outcome: 'allow', by: DOUBLE_MEMBER.id });
  await page.goto(`${hub.url}/p/${PROJECT}`);
  await page.getByRole('navigation', { name: 'Channels' }).getByRole('button', { name: /MAWS/ }).click();
  await expect(center(page).locator('[data-request="toolu_settled_before"]').getByTestId('settled')).toHaveText('Allowed from the web by you');
  await page.evaluate((url) => navigator.serviceWorker.dispatchEvent(new MessageEvent('message', { data: { type: 'desk-open', url } })), `/p/${PROJECT}/s/${S.asks}?request=toolu_settled_before`);
  await expect(center(page).getByTestId('session-view')).toHaveAttribute('data-session', S.asks);
  await expect(page.getByTestId('landing')).toHaveText(/This request is no longer waiting: it was answered or withdrawn before you opened it\./);
  await expect(center(page).locator('[data-request="toolu_settled_before"]')).toHaveCount(0);

  const forged: Raised = { ...(await seal(await importOrgKey(VECTOR_KEY), 'raised', PROJECT, { request: 'toolu_forged', session: S.asks, tool: 'AskUserQuestion', input: { questions: QUESTIONS } })) };
  hub.raiseRaw(PROJECT, 'mini', { ...forged, input: { questions: [{ ...QUESTIONS[0], question: 'Delete the database?' }] } });
  await page.goto(`${hub.url}/p/${PROJECT}/s/${S.asks}?request=toolu_forged`);
  await expect(page.getByTestId('landing')).toContainText('This request failed verification, so it is not shown.');
  await expect(center(page)).not.toContainText('Delete the database?');
});

test("a project holds back its member's pushes only while the owner can read it: not locked, not hidden", async ({ page, hub }) => {
  await stageProject(hub);
  const visibility = () => hub.up.filter((u) => u.frame.t === 'visibility').map((u) => (u.frame as { visible: boolean }).visible);
  await page.goto(`${hub.url}/p/${PROJECT}`);
  await expect(page.getByTestId('locked')).toBeVisible();
  await expect.poll(visibility).toContain(false);
  expect(visibility()).not.toContain(true); // locked, the owner reads nothing there

  await seedKey(page, hub);
  await page.goto(`${hub.url}/p/${PROJECT}/s/${S.asks}`);
  await expect(center(page).getByTestId('session-view')).toHaveAttribute('data-session', S.asks);
  await expect.poll(() => visibility().at(-1)).toBe(true);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(() => visibility().at(-1)).toBe(false); // the phone locked, or the app sent to the background
});

test('the app sets the icon badge from the grid while it is open, and clears it at 0', async ({ page, hub }) => {
  await stageProject(hub); // MAWS waits on the owner once
  await page.addInitScript(() => {
    const calls: Array<number | 'clear'> = ((window as unknown as { __badges: Array<number | 'clear'> }).__badges = []);
    Object.defineProperty(navigator, 'setAppBadge', { configurable: true, value: async (count: number) => void calls.push(count) });
    Object.defineProperty(navigator, 'clearAppBadge', { configurable: true, value: async () => void calls.push('clear') });
  });
  await page.goto(hub.url);
  const badges = () => page.evaluate(() => (window as unknown as { __badges: Array<number | 'clear'> }).__badges);
  await expect.poll(badges).toEqual([1]);
  hub.updateSummary(summary({ waiting: 0 })); // answered, anywhere
  await expect.poll(badges).toEqual([1, 'clear']);
});

test('the installed app offers notifications once on the grid, and Not now keeps it gone', async ({ browserName, page, hub }) => {
  // Playwright's WebKit has no Push API, where the banner rightly never shows. The Linux lane's headless Chromium reads
  // Notification.permission as denied whatever the context grants (run 38791001300), so the case sets the phone's
  // first state, undecided, as the unit suites do.
  test.skip(browserName !== 'chromium', 'the Push API');
  await stageProject(hub);
  await seedKey(page, hub);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'standalone', { configurable: true, value: true }); // iOS's home-screen app
    Object.defineProperty(Notification, 'permission', { configurable: true, get: () => 'default' });
  });
  await page.goto(hub.url);
  const banner = page.getByTestId('push-banner');
  const browserPush = () =>
    page.evaluate(async () => ({
      pushManager: typeof PushManager,
      permission: typeof Notification === 'undefined' ? 'none' : Notification.permission,
      worker: 'serviceWorker' in navigator ? Boolean(await navigator.serviceWorker.getRegistration()) : 'none',
    }));
  await expect(banner, JSON.stringify(await browserPush().catch(String))).toContainText(
    'Get a notification when a session asks you something',
  );
  await banner.getByRole('button', { name: 'Not now' }).click();
  await expect(banner).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('grid')).toBeVisible();
  await expect(page.getByTestId('push-banner')).toHaveCount(0);
});
