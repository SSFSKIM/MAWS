// E4c's scene for `e2e/browser-tools.spec.ts` (E4c execution document, Design §13, Interfaces "e2e and tests"): E4a's
// browser scene (E2's scratch project and product app over the replay, downloads saved under the scratch root; imported
// from support/browser-scene.ts, not copied) over E4c's server on its fixed port, plus:
//
// - the seam's `agent` members (`globalThis.__maws_browser.agent` under MAWS_E2E=1, src/main/browser/agent/index.ts),
//   one wrapper each, so a case drives main's browser-tool handlers without an engine;
// - the recording's call sequence (`recordedSequence`): `browser_tabs open` on `/form.html`, `browser_snapshot`, the two
//   fills and the Submit click by the snapshot's refs, `browser_snapshot` of `/done.html`; never a navigation first,
//   since a ref's frame prefix counts the documents the connection has seen. The generator writes its two snapshots as
//   the fixtures the live recording's stand-in answers from; case 1 compares a fresh run with them.
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Locator, type Page } from '@playwright/test';
import type { KeyboardInputEvent, MouseInputEvent, MouseWheelInputEvent } from 'electron';
import { refElementsOf } from '@shared/browser/snapshot';
import type { BrowserControl } from '@shared/browser/tab';
import type { AppSessionId, RequestId } from '@shared/graph/ids';
import type { MawsBrowserAnswerResult, MawsBrowserProgress } from '@shared/ipc/schema/maws';
import type { BrowserToolName } from '@shared/maws/browser';
import { launchBrowserScene, type BrowserScene } from './browser-scene';
import { invoke, value } from './c7-replay';
import { clearToasts, closeScene, ofKind, scratchProject, type Scene } from './deliverables-scene';
import { REPO_ROOT } from './launch';
import { ORDER_REFERENCE, startBrowserToolsServer, type BrowserToolsServer } from './browser-tools-server';

export interface BrowserToolsScene extends BrowserScene {
  server: BrowserToolsServer;
}

// One launch over a fresh scratch project and E4c's server (the fixed port: one scene at a time), closed (console clean,
// replays followed) and removed after the body. A fresh launch is a fresh tab-id sequence, so its first open mints
// FIRST_TAB_ID as the recording's stand-in did.
export async function browserToolsScene(titles: string[], body: (s: BrowserToolsScene) => Promise<void>): Promise<void> {
  const scratch = scratchProject({ titles });
  const server = await startBrowserToolsServer();
  try {
    const s = (await launchBrowserScene(scratch, server)) as BrowserToolsScene;
    try {
      await quiet(s);
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

// What the e2e's own harness would otherwise add to the app (both found by this group's first runs):
// - the attention fallback toasts: an e2e window is never focused and its build is unsigned, so every permission the
//   replay asks raises C5's `attention.notified { delivery: 'fallback' }` toast, which stays until dismissed; stacked at
//   the window's bottom right they meet the panel's pane, which E4a counts as a cover, so the agent's next act would
//   wait under them. Notifications are switched off, as an owner may (the interplay is reported, not tested here);
// - the e2e's own Playwright connection to every page: with no `dialog` listener its server answers each JavaScript
//   dialog over CDP itself, after the app's wrap already has, and that answer's "No dialog is showing" rejection is
//   unhandled; a listener that does nothing leaves dialogs to the app, as in the owner's app.
async function quiet(s: BrowserScene): Promise<void> {
  value(await invoke(s.page, 'settings.set', { notifications: { enabled: false } }));
  s.maws.app.context().on('dialog', () => undefined);
}

// ---- the seam's `agent` (the e2e does not import main's code; these mirror `BrowserAgentSeam`) -----------------------

export type DriverState = 'none' | 'connected' | 'idle-closed';
export interface SeamInput {
  kind: 'key' | 'mouse' | 'wheel';
  source: 'human' | 'agent';
  at: number;
}
export type SeamInputEvent = MouseInputEvent | MouseWheelInputEvent | KeyboardInputEvent;
interface AgentSeam {
  run(appSessionId: AppSessionId, tool: BrowserToolName, args: unknown, options?: { requestId?: string; toolUseId?: string }): Promise<MawsBrowserAnswerResult | null>;
  cancel(appSessionId: AppSessionId, requestId: string): boolean;
  driverState(tabId: string): DriverState;
  control(tabId: string): { control: BrowserControl; controlSince: string } | null;
  lastInputs(tabId: string): SeamInput[];
  sendInput(tabId: string, event: SeamInputEvent): boolean;
  cursorMessages(tabId: string): number;
}
type WithAgent = { __maws_browser: { agent: AgentSeam } };

// A browser tool's call as the host would ask it, answered by main's handlers: null when the request was cancelled (a
// cancelled request answers nothing). `requestId` names it for `agentCancel`.
export async function agentRun(s: BrowserScene, appSessionId: AppSessionId, tool: BrowserToolName, args: unknown, options: { requestId?: string; toolUseId?: string } = {}): Promise<MawsBrowserAnswerResult | null> {
  return s.maws.app.evaluate(
    (_electron, { appSessionId, tool, args, options }) => (globalThis as unknown as WithAgent).__maws_browser.agent.run(appSessionId, tool, args, options),
    { appSessionId, tool, args, options },
  );
}

// The answer of a call that must succeed: its result and text, or the failure printed.
export async function agentOk(s: BrowserScene, appSessionId: AppSessionId, tool: BrowserToolName, args: unknown): Promise<Extract<MawsBrowserAnswerResult, { ok: true }>> {
  const answer = await agentRun(s, appSessionId, tool, args);
  expect(answer, `${tool} ${JSON.stringify(args)} answered`).not.toBeNull();
  if (!answer!.ok) throw new Error(`${tool} ${JSON.stringify(args)} failed: ${answer!.error}`);
  return answer!;
}

export const agentCancel = (s: BrowserScene, appSessionId: AppSessionId, requestId: string): Promise<boolean> =>
  s.maws.app.evaluate((_electron, [id, request]) => (globalThis as unknown as WithAgent).__maws_browser.agent.cancel(id as AppSessionId, request!), [appSessionId, requestId]);
export const driverState = (s: BrowserScene, tabId: string): Promise<DriverState> =>
  s.maws.app.evaluate((_electron, id) => (globalThis as unknown as WithAgent).__maws_browser.agent.driverState(id), tabId);
export const controlOf = (s: BrowserScene, tabId: string): Promise<{ control: BrowserControl; controlSince: string } | null> =>
  s.maws.app.evaluate((_electron, id) => (globalThis as unknown as WithAgent).__maws_browser.agent.control(id), tabId);
export const lastInputs = (s: BrowserScene, tabId: string): Promise<SeamInput[]> =>
  s.maws.app.evaluate((_electron, id) => (globalThis as unknown as WithAgent).__maws_browser.agent.lastInputs(id), tabId);
export const sendInput = (s: BrowserScene, tabId: string, event: SeamInputEvent): Promise<boolean> =>
  s.maws.app.evaluate((_electron, { id, event }) => (globalThis as unknown as WithAgent).__maws_browser.agent.sendInput(id, event), { id: tabId, event });
export const cursorMessages = (s: BrowserScene, tabId: string): Promise<number> =>
  s.maws.app.evaluate((_electron, id) => (globalThis as unknown as WithAgent).__maws_browser.agent.cursorMessages(id), tabId);

// ---- the recording's sequence and its fixtures ------------------------------------------------------------------------

export const FIRST_TAB_ID = 'b_000000000001'; // the first id a launch mints under MAWS_E2E=1 (Decision Log 36)
export const ORDER = { name: 'Ada Lovelace', email: 'ada@example.test', reference: ORDER_REFERENCE } as const;
export const SNAPSHOT_FIXTURES = {
  form: join(REPO_ROOT, 'test/fixtures/browser/form.snapshot.txt'),
  done: join(REPO_ROOT, 'test/fixtures/browser/done.snapshot.txt'),
} as const;
export const readSnapshotFixture = (which: keyof typeof SNAPSHOT_FIXTURES): string => readFileSync(SNAPSHOT_FIXTURES[which], 'utf8');

// The ref of the snapshot's one element with this role and name (what the model reads off the snapshot).
export function refIn(snapshot: string, role: string, name: string): string {
  const refs = [...refElementsOf(snapshot)].filter(([, element]) => element.role === role && element.name === name).map(([ref]) => ref);
  expect(refs, `one ${role} "${name}" in the snapshot:\n${snapshot}`).toHaveLength(1);
  return refs[0]!;
}

// The live recording's calls (Design §13's prompt), in its order, through the seam: the tab's id and the two snapshots'
// text exactly as main answered them.
export async function recordedSequence(s: BrowserToolsScene, appSessionId: AppSessionId): Promise<{ tabId: string; form: string; done: string }> {
  const opened = await agentOk(s, appSessionId, 'browser_tabs', { action: 'open', url: s.server.url('/form.html') });
  const tabId = opened.result.tabId as string;
  const form = (await agentOk(s, appSessionId, 'browser_snapshot', { tabId })).text!;
  await agentOk(s, appSessionId, 'browser_act', { tabId, action: 'fill', target: refIn(form, 'textbox', 'Name'), value: ORDER.name });
  await agentOk(s, appSessionId, 'browser_act', { tabId, action: 'fill', target: refIn(form, 'textbox', 'Email'), value: ORDER.email });
  const clicked = await agentOk(s, appSessionId, 'browser_act', { tabId, action: 'click', target: refIn(form, 'button', 'Submit') });
  expect(clicked.result).toMatchObject({ navigated: true, title: 'E4c order received' });
  const done = (await agentOk(s, appSessionId, 'browser_snapshot', { tabId })).text!;
  return { tabId, form, done };
}

// ---- waits, the person, the cover -----------------------------------------------------------------------------------

// A call left running while the case acts around it: its promise, and when it settled (null while it runs). A rejection
// (the app closed under a failing case) is left to whoever awaits `promise`.
export interface Running<T> {
  promise: Promise<T>;
  settledAt(): number | null;
}
export function running<T>(promise: Promise<T>): Running<T> {
  let at: number | null = null;
  const settled = promise.finally(() => (at = Date.now()));
  settled.catch(() => undefined);
  return { promise: settled, settledAt: () => at };
}

// Every `maws.browser.progress` the window receives from now on, kept in the window: a seam run has no transcript row,
// so a case reads the waits main reported here (Acceptance, case 3).
export async function recordProgress(s: Scene): Promise<void> {
  await s.page.evaluate(() => {
    const w = window as unknown as { __e4cProgress?: MawsBrowserProgress[] };
    if (w.__e4cProgress) return;
    const log: MawsBrowserProgress[] = [];
    w.__e4cProgress = log;
    window.maws.on('maws.browser.progress', (payload) => log.push(payload));
  });
}
export const progressOf = (s: Scene, tabId: string): Promise<MawsBrowserProgress[]> =>
  s.page.evaluate((id) => ((window as unknown as { __e4cProgress?: MawsBrowserProgress[] }).__e4cProgress ?? []).filter((p) => p.tabId === id), tabId);
// The waits main reported for the tab, in order (null: a wait ended).
export const waitsOf = async (s: Scene, tabId: string): Promise<(string | null)[]> => (await progressOf(s, tabId)).map((p) => p.waiting);

// The person's click (E4-0's stand-in: a native press and release sent to the tab's page through the seam, as the OS
// would deliver them) at the centre of `selector` in `page`: when it was sent.
export async function humanClick(s: BrowserScene, tabId: string, page: Page, selector: string): Promise<number> {
  const box = await page.locator(selector).boundingBox();
  expect(box, `${selector} has a box`).not.toBeNull();
  const x = Math.round(box!.x + box!.width / 2);
  const y = Math.round(box!.y + box!.height / 2);
  const at = Date.now();
  expect(await sendInput(s, tabId, { type: 'mouseDown', x, y, button: 'left', clickCount: 1 })).toBe(true);
  expect(await sendInput(s, tabId, { type: 'mouseUp', x, y, button: 'left', clickCount: 1 })).toBe(true);
  return at;
}

// The tab's attributed inputs as kind/source pairs (the order E4a's classifier emitted them).
export const inputsOf = async (s: BrowserScene, tabId: string): Promise<string[]> => (await lastInputs(s, tabId)).map((input) => `${input.kind}/${input.source}`);

// The id of the next permission the session asks (beyond those answered), once it is asked.
export async function nextPermission(s: Scene, id: AppSessionId): Promise<RequestId> {
  const answered = ofKind(await s.events(id), 'permission.resolved').length;
  await expect.poll(async () => ofKind(await s.events(id), 'permission.requested').length, { timeout: 30_000 }).toBeGreaterThan(answered);
  return ofKind(await s.events(id), 'permission.requested').at(-1)!.requestId;
}

// A permission allowed once through `session.answer`, the request card's own command (for when a sheet covers the card).
export async function allowByCommand(s: Scene, id: AppSessionId, requestId: RequestId): Promise<void> {
  const answered = ofKind(await s.events(id), 'permission.resolved').length;
  expect(value(await invoke(s.page, 'session.answer', { appSessionId: id, requestId, answer: { kind: 'permission', decision: 'allow', scope: 'once' } }))).toEqual({ outcome: 'delivered' });
  await expect.poll(async () => ofKind(await s.events(id), 'permission.resolved').length, { timeout: 30_000 }).toBe(answered + 1);
}

// How many pixels of a PNG are the agent cursor's accent blue (#2f6feb), its glow over a light page included, and how many
// are dark (a light page's text), counted in main through nativeImage (a BGRA bitmap), with the picture's size in pixels.
export async function bluePixels(s: Scene, png: { path: string } | { base64: string }): Promise<{ width: number; height: number; blue: number; dark: number }> {
  return s.maws.app.evaluate(({ nativeImage }, png) => {
    const image = 'path' in png ? nativeImage.createFromPath(png.path) : nativeImage.createFromBuffer(Buffer.from(png.base64, 'base64'));
    const { width, height } = image.getSize();
    const bitmap = image.toBitmap();
    let blue = 0;
    let dark = 0;
    for (let k = 0; k < bitmap.length; k += 4) {
      const [b, g, r] = [bitmap[k]!, bitmap[k + 1]!, bitmap[k + 2]!];
      if (b > 180 && b - r > 60 && b - g > 30) blue++;
      if (r < 80 && g < 80 && b < 80) dark++;
    }
    return { width, height, blue, dark };
  }, png);
}

// ---- evidence -------------------------------------------------------------------------------------------------------

export const SHOTS = process.env.MAWS_E4C_SHOTS === '1' ? join(REPO_ROOT, 'docs/doperpowers/evidence/p1-e4c') : null;
const THEMES = ['light', 'dark'] as const;

// `e4c-<surface>-<theme>.png` under docs/doperpowers/evidence/p1-e4c/ when MAWS_E4C_SHOTS=1, in each theme, then back to
// light. The view draws over the renderer and is not in its screenshot, so the shown page's own picture is laid into
// `pane` for the shot (E4a's method) and taken out after; `clip` narrows the shot to an element; `before` runs at the
// start of each theme's shot (a wait the shot is of is kept alive there).
export async function shootE4c(s: Scene, surface: string, opts: { pane: Locator; page: Page; clip?: Locator; before?: () => Promise<void> }): Promise<void> {
  if (SHOTS === null) return;
  mkdirSync(SHOTS, { recursive: true });
  await clearToasts(s.page);
  await s.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur()); // no focus ring left from the last click
  for (const theme of THEMES) {
    await opts.before?.();
    value(await invoke(s.page, 'settings.set', { theme }));
    await expect(s.page.locator('html')).toHaveAttribute('data-theme', theme);
    const picture = `data:image/png;base64,${(await opts.page.screenshot()).toString('base64')}`;
    await opts.pane.evaluate(
      (el, src) =>
        new Promise<void>((resolve) => {
          const img = document.createElement('img');
          img.dataset.e4cShot = '';
          img.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;z-index:5;pointer-events:none';
          img.onload = () => resolve();
          img.src = src;
          el.appendChild(img);
        }),
      picture,
    );
    await s.page.waitForTimeout(250);
    const clip = opts.clip ? await opts.clip.boundingBox() : null;
    await s.page.screenshot({ path: join(SHOTS, `e4c-${surface}-${theme}.png`), ...(clip && { clip }) });
    await opts.pane.evaluate((el) => el.querySelector('img[data-e4c-shot]')?.remove());
  }
  value(await invoke(s.page, 'settings.set', { theme: 'light' }));
  await expect(s.page.locator('html')).toHaveAttribute('data-theme', 'light');
}
