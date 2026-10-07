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
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from '@playwright/test';
import type { KeyboardInputEvent, MouseInputEvent, MouseWheelInputEvent } from 'electron';
import { refElementsOf } from '@shared/browser/snapshot';
import type { BrowserControl } from '@shared/browser/tab';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBrowserAnswerResult } from '@shared/ipc/schema/maws';
import type { BrowserToolName } from '@shared/maws/browser';
import { launchBrowserScene, type BrowserScene } from './browser-scene';
import { closeScene, scratchProject } from './deliverables-scene';
import { REPO_ROOT } from './launch';
import { startBrowserToolsServer, type BrowserToolsServer } from './browser-tools-server';

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
export async function agentOk(s: BrowserScene, appSessionId: AppSessionId, tool: BrowserToolName, args: unknown): Promise<{ result: Record<string, unknown>; text?: string }> {
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
export const ORDER = { name: 'Ada Lovelace', email: 'ada@example.test', reference: 'MAWS-7731' } as const;
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
