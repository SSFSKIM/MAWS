// The cards on the phone (P5 O13 M5; acceptance 2's drawing half, acceptance 4's phone side), in Chromium with the
// virtual authenticator against M4's harness (test/local/endpoint.ts): desk-hub's local runner rooted by `OrgAdmin`,
// MAWS's endpoint module enrolled on it in this process as the owner's machine `mini` (the fake engine host for lane B,
// a fake sminos on RL10 for lane A), and this browser paired as a `web-cards` device through the Device panel, the Mac's
// approval given as `deployment admin pair` gives it. The browser reaches the machine only through the hub's relay.
//
// The list shows the owner's lane A and lane B sessions waiting on the machine, each with its count (lane B's from the
// engine host's broker, O10's notifier feed), and lane B's cards open from their landing URL as a push's tap lands; a
// question's card is drawn with its choices and
// answered, a permission's with Allow and Deny and denied, on each lane, each through one passkey gesture, each card
// settling within 5 s and the machine recording one answer; a lane B card whose session has no engine session is not
// answerable, with its reason; an answer whose `ack` is withheld is uncertain, and Retry settles it; the channel dropped
// reads disconnected, then current again; at 390 and 320 px nothing overflows. (Its side-by-side case, a DX6 permission
// from desk-hub's fake machine answered beside a channel one, left with DX2 and DX6 in P5 O14 M5b.)
//
// The harness is MAWS's own TypeScript (the endpoint, its shared modules under `@shared`), which Playwright's loader does
// not run; it is loaded through Vite's module runner with the aliases desk-web's vitest gives it.
import { resolve } from 'node:path';
import { expect, test, type BrowserContext, type Page, type WebSocketRoute } from '@playwright/test';
import { runnerImport } from 'vite';
import type { World } from '../test/local/endpoint';

test.describe.configure({ mode: 'serial' });

const ROOT = resolve(import.meta.dirname, '../../..');
const PROJECT = 'proj-m8'; // the harness's sminos project (test/endpoint/sub-harness.ts)
const APP = 'app-cards';
/** From the gesture to the card settled (M5's Proves); the case that holds the prompt adds its pause. */
const SETTLE_MS = 5000;

let harness: typeof import('../test/local/endpoint');
let world: World;
let context: BrowserContext;
let page: Page;

/** The Machine sockets the page opened, through a relay this suite holds: frames to the page can be held, the socket cut. */
const relay = { routes: [] as WebSocketRoute[], holding: false, held: [] as Array<() => void> };

function release() {
  for (const send of relay.held.splice(0)) send();
  relay.holding = false;
}

const question = (request: string, session = 'la-1') => ({ request, session, tool: 'AskUserQuestion', input: { questions: [{ question: 'Which way?', options: [{ label: 'left' }, { label: 'right' }] }] } });
const permission = (request: string, command: string, session = 'la-1') => ({ request, session, tool: 'Bash', input: { command } });

/** sminos's member frame for a lane B session (`eng-<app>`): what lists it at the hub under its appSessionId. */
function listLaneB(app: string, title: string) {
  world.sminos.s.send({ t: 'member', session: `eng-${app}`, alias: app, project: PROJECT, lane: 'B', state: 'waiting', title, cwd: '/work/m8', owners: ['@machine'], ownersProof: [], origin: { kind: 'terminal' } });
}

const cardOf = (target: Page, id: string) => target.locator(`[data-card="${id}"]`);

/** Answered once the machine shows it: the card closed, or gone, within 5 s of the gesture. */
async function settles(target: Page, id: string, ms = SETTLE_MS) {
  const state = () => cardOf(target, id).evaluateAll((cards) => cards.map((c) => c.getAttribute('data-card-state')).join(' '));
  await expect.poll(state, { timeout: ms, intervals: [50] }).toMatch(/^(closed)?$/);
}

async function openSession(target: Page, session: string) {
  await target.goto(`${world.url}/cards/${encodeURIComponent(world.ref)}/${encodeURIComponent(session)}`);
  await expect(target.getByTestId('channel-cards-list')).toHaveAttribute('data-connected', 'true', { timeout: 20_000 });
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);
  ({ module: harness } = await runnerImport<typeof import('../test/local/endpoint')>(resolve(import.meta.dirname, '../test/local/endpoint.ts'), {
    configFile: false,
    logLevel: 'error',
    resolve: { alias: { '@shared': resolve(ROOT, 'src/shared'), '@artifacts': resolve(ROOT, 'src/artifacts') } },
  }));
  world = await harness.startWorld({ localhost: true });
  // sminos opens the project on the hub's log plane, so the endpoint lists its sessions there and notifies their counts.
  world.sminos.s.send({ t: 'hello', project: PROJECT, name: 'cards', have: {} });
  world.laneB(APP);
  listLaneB(APP, 'lane B work');
  world.host.request(APP, 'question', 'rq-q');
  world.host.request(APP, 'permission', 'rq-p');
  // sminos's pending set holds what bridges raise, lane A's alone; a lane B session's count reaches the hub's presence
  // from the engine host's broker items (O10's lane B notifier feed, src/endpoint/lane-b-pending.ts).
  world.sminos.restate([question('toolu_q'), permission('toolu_p', 'pnpm test'), permission('toolu_b', 'rm -rf /', 'la-b')]);

  context = await browser.newContext();
  page = await context.newPage();
  await page.routeWebSocket(/\/api\/machines\/[^/]+\/socket$/, (ws) => {
    relay.routes.push(ws);
    const server = ws.connectToServer();
    ws.onMessage((message) => server.send(message));
    server.onMessage((message) => {
      if (relay.holding && typeof message !== 'string') relay.held.push(() => ws.send(message));
      else ws.send(message);
    });
    ws.onClose(() => server.close());
    server.onClose(() => ws.close());
  });
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', ctap2Version: 'ctap2_1', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
  await page.goto(world.url);
  await expect(page.getByTestId('grid-status')).toContainText('Live', { timeout: 30_000 });

  // The phone pairs as M3 pairs it: the code pasted in the Device panel, approved on the Mac.
  const pairing = await world.pairing();
  await page.getByRole('button', { name: 'Device', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Device' });
  await panel.getByLabel('Pairing code').fill(pairing.code);
  await panel.getByRole('button', { name: 'Pair this device' }).click();
  await expect(panel.getByTestId('device-state')).toContainText(/waiting for approval/i, { timeout: 10_000 });
  await pairing.approve();
  await expect(panel.getByTestId('device-state')).toHaveText(/Listed, version \d+/, { timeout: 10_000 });
  await page.keyboard.press('Escape');
});

test.afterAll(async () => {
  release();
  await context?.close();
  await world?.stop();
});

test("the list: the owner's lane A and lane B sessions waiting on the machine, each with its count, reached from the top bar with its dot", async () => {
  const entry = page.getByRole('button', { name: /^Cards/ });
  await expect(entry.getByTestId('cards-dot')).toBeVisible({ timeout: 15_000 });
  await entry.click();
  await expect(page).toHaveURL(`${world.url}/cards`);
  const mini = page.locator(`[data-cards-machine="${world.ref}"]`);
  await expect(mini.getByRole('heading')).toContainText('mini');
  await expect(mini.getByTestId('cards-machine-state')).toHaveText('online');
  await expect(mini.locator('[data-cards-session="la-1"]')).toHaveAttribute('data-pending', '2');
  await expect(mini.locator('[data-cards-session="la-1"]')).toContainText('main');
  // The lane B session's two requests, counted from the engine host's broker items, under its appSessionId.
  await expect(mini.locator(`[data-cards-session="${APP}"]`)).toHaveAttribute('data-pending', '2');
  await expect(mini.locator(`[data-cards-session="${APP}"]`)).toContainText('lane B work');
  await expect(mini.locator('[data-cards-session]')).toHaveCount(2);
  // B's session waits on the same machine, and is not the owner's to see here.
  await expect(mini.locator('[data-cards-session="la-b"]')).toHaveCount(0);
});

test('lane A: the question drawn with its choices and answered, the permission offering Allow and Deny and denied, each with one gesture', async () => {
  await page.locator('[data-cards-session="la-1"]').click();
  await expect(page.getByTestId('channel-cards-title')).toHaveText('main');
  await expect(page.getByTestId('channel-cards-machine')).toHaveText('on mini');
  await expect(page.getByTestId('channel-cards-list')).toHaveAttribute('data-connected', 'true', { timeout: 20_000 });

  const asked = cardOf(page, 'toolu_q');
  await expect(asked).toContainText('Which way?');
  await expect(asked.getByRole('radio', { name: 'left' })).toBeVisible();
  await expect(asked.getByRole('radio', { name: 'right' })).toBeVisible();
  await asked.getByRole('radio', { name: 'left' }).click();
  await asked.getByRole('button', { name: 'Submit' }).click();
  await settles(page, 'toolu_q');
  expect(world.sminos.effects.filter((e) => e === 'answer la-1 toolu_q')).toHaveLength(1);

  const bash = cardOf(page, 'toolu_p');
  await expect(bash).toContainText('wants to run a command');
  await expect(bash).toContainText('pnpm test');
  await expect(bash.getByRole('button', { name: 'Allow' })).toBeVisible();
  await expect(bash.getByRole('button', { name: /reason/i })).toHaveCount(0); // no reason: a `message` is refused
  // The passkey prompt names nothing of the request, so the card says what the gesture approves while it is asked for
  // (the virtual authenticator answers at once: its prompt is held a moment here, to be seen).
  await page.evaluate(() => {
    const get = navigator.credentials.get.bind(navigator.credentials);
    navigator.credentials.get = async (options) => (await new Promise((resolve) => setTimeout(resolve, 1500)), get(options));
  });
  await bash.getByRole('button', { name: 'Deny' }).click();
  await expect(bash.getByTestId('gesture')).toHaveText('Face ID approves: Deny pnpm test in main');
  await expect(bash.getByTestId('gesture').locator('code')).toHaveText('pnpm test');
  await settles(page, 'toolu_p', SETTLE_MS + 1500);
  expect(world.sminos.effects.filter((e) => e === 'decide la-1 toolu_p')).toHaveLength(1);
  const decided = world.sminos.s.received.filter((f) => f.t === 'rpc' && (f.rpc as { args: { digest?: { request: string } } }).args.digest?.request === 'toolu_p');
  expect(decided.map((f) => (f.rpc as { args: { decision: string } }).args.decision)).toEqual(['deny']);
});

test('lane B, opened from its landing URL: the question answered and the permission allowed, each answer delivered once', async () => {
  await openSession(page, APP); // a cold load of `/cards/<ref>/<appSessionId>`, as a push's tap lands
  await expect(page.getByTestId('channel-cards-title')).toHaveText('lane B work');
  const asked = cardOf(page, 'rq-q');
  await asked.getByRole('radio', { name: 'right' }).click();
  await asked.getByRole('button', { name: 'Submit' }).click();
  await settles(page, 'rq-q');
  const allowed = cardOf(page, 'rq-p');
  await expect(allowed).toContainText('git log --oneline');
  await allowed.getByRole('button', { name: 'Allow' }).click();
  await settles(page, 'rq-p');
  expect(world.host.answered.filter((a) => a === `${APP} rq-q`)).toHaveLength(1);
  expect(world.host.answered.filter((a) => a === `${APP} rq-p`)).toHaveLength(1);
  const sent = world.host.calls.filter((c) => c.name === 'host.op').map((c) => (c.input as { input: { requestId: string; answer: unknown } }).input);
  expect(sent.find((i) => i.requestId === 'rq-q')?.answer).toEqual({ kind: 'question', answers: { 'Which way?': 'right' } });
  expect(sent.find((i) => i.requestId === 'rq-p')?.answer).toEqual({ kind: 'permission', decision: 'allow', scope: 'once' });
});

test("a lane B card whose session has no engine session is drawn not answerable, with its reason, and answerable once it has one", async () => {
  const app = 'app-relaunch';
  const s = world.laneB(app);
  listLaneB(app, 'relaunched');
  world.host.request(app, 'permission', 'rq-relaunch');
  await openSession(page, app);
  const card = cardOf(page, 'rq-relaunch');
  await expect(card).toHaveAttribute('data-card-state', 'open');
  s.engineSessionId = null;
  world.host.emit('session.status', { appSessionId: app, status: world.host.status(s) });
  await expect(card).toHaveAttribute('data-card-state', 'not-actionable', { timeout: 10_000 });
  await expect(card.getByTestId('card-state-line')).toHaveText("Not yet actionable: this session hasn't been prompted locally yet");
  await expect(card.getByRole('button', { name: 'Allow' })).toHaveCount(0);
  s.engineSessionId = `eng-${app}-2`;
  world.records.set({ lane: 'B', session: `eng-${app}-2`, owners: ['@machine'] }, app);
  world.host.emit('session.status', { appSessionId: app, status: world.host.status(s) });
  await expect(card).toHaveAttribute('data-card-state', 'open', { timeout: 10_000 });
  await card.getByRole('button', { name: 'Allow' }).click();
  await settles(page, 'rq-relaunch');
  expect(world.host.answered.filter((a) => a === `${app} rq-relaunch`)).toHaveLength(1);
});

test('an answer whose ack is withheld is uncertain, offering only Retry; Retry reseals it and it settles, answered once', async () => {
  test.setTimeout(60_000);
  world.host.request(APP, 'permission', 'rq-held');
  await openSession(page, APP);
  const card = cardOf(page, 'rq-held');
  await expect(card).toHaveAttribute('data-card-state', 'open');
  relay.holding = true; // what the machine says to the page from now on is held: the act's ack and done among it
  await card.getByRole('button', { name: 'Allow' }).click();
  await expect(card).toHaveAttribute('data-card-state', 'uncertain', { timeout: 15_000 });
  await expect(card.getByRole('button', { name: 'Allow' })).toHaveCount(0);
  await expect(card.getByRole('button', { name: 'Retry' })).toBeEnabled();
  await card.getByRole('button', { name: 'Retry' }).click();
  release();
  await settles(page, 'rq-held');
  expect(world.host.answered.filter((a) => a === `${APP} rq-held`)).toHaveLength(1);
  const ops = world.host.calls.filter((c) => c.name === 'host.op' && (c.input as { input: { requestId: string } }).input.requestId === 'rq-held').map((c) => (c.input as { opId: string }).opId);
  expect(new Set(ops).size).toBe(1); // the reseal is the first copy's operation
});

test('the channel dropped: the view reads disconnected, then current again on a new channel', async () => {
  world.host.request(APP, 'permission', 'rq-drop');
  await openSession(page, APP);
  const card = cardOf(page, 'rq-drop');
  await expect(card).toHaveAttribute('data-card-state', 'open');
  await relay.routes.at(-1)!.close();
  await expect(page.getByTestId('channel-cards-disconnected')).toBeVisible({ timeout: 5000 });
  await expect(card).toHaveAttribute('data-card-state', 'disconnected');
  await expect(page.getByTestId('channel-cards-list')).toHaveAttribute('data-connected', 'true', { timeout: 20_000 });
  await expect(card).toHaveAttribute('data-card-state', 'open');
  await card.getByRole('button', { name: 'Deny' }).click();
  await settles(page, 'rq-drop');
});

/** SIDEWAYS and fitsTheWidth as e2e/phone.spec.ts checks a phone's layout. */
const SIDEWAYS = 'pre, code, .transcript-output, .transcript-diff, table';
async function fitsTheWidth(target: Page) {
  const overflow = await target.evaluate((sideways) => {
    const width = document.documentElement.clientWidth;
    const root = document.getElementById('root');
    const style = (el: Element) => getComputedStyle(el).overflowX;
    const truncates = (el: Element) => ['hidden', 'clip'].includes(style(el)) && getComputedStyle(el).textOverflow === 'ellipsis';
    const container = (el: HTMLElement) => {
      for (let up = el.parentElement; up && up !== root && up !== document.body; up = up.parentElement) if (style(up) !== 'visible') return up;
      return null;
    };
    const wide = [...document.querySelectorAll<HTMLElement>('body *')].filter((el) => {
      if (el.getBoundingClientRect().right <= width + 1 || getComputedStyle(el).position === 'fixed') return false;
      const box = container(el);
      if (box === null) return true;
      if (['auto', 'scroll'].includes(style(box))) return false;
      return !truncates(box) || box.getBoundingClientRect().right > width + 1;
    });
    const scrolling = [...document.querySelectorAll<HTMLElement>('body *')].filter((el) => ['auto', 'scroll'].includes(style(el)) && el.scrollWidth > el.clientWidth + 1 && !el.closest(sideways));
    return { wide: wide.map((el) => `${el.tagName}.${el.className}`.slice(0, 80)), scrolling: scrolling.map((el) => `${el.tagName}.${el.className}`.slice(0, 80)) };
  }, SIDEWAYS);
  expect(overflow).toEqual({ wide: [], scrolling: [] });
}

test('at 390 and 320 px wide nothing overflows, and the phone menu reaches the cards', async () => {
  world.host.request(APP, 'permission', 'rq-narrow');
  world.sminos.raise(question('toolu_narrow'));
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(world.url);
    await page.getByTestId('menu').click();
    await page.getByRole('dialog', { name: 'Menu' }).getByRole('button', { name: /^Cards/ }).click();
    await expect(page.getByTestId('cards-list')).toBeVisible();
    await expect(page.locator(`[data-cards-machine="${world.ref}"]`)).toBeVisible({ timeout: 15_000 });
    await fitsTheWidth(page);
    await openSession(page, APP);
    await expect(cardOf(page, 'rq-narrow')).toHaveAttribute('data-card-state', 'open');
    await fitsTheWidth(page);
    await openSession(page, 'la-1');
    await expect(cardOf(page, 'toolu_narrow')).toHaveAttribute('data-card-state', 'open');
    await fitsTheWidth(page);
  }
  await page.setViewportSize({ width: 1280, height: 800 });
});
