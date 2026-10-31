// The step-up sheet (P5 O7 M2, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, Interfaces §P; P5 Decision Log
// 126): before Touch ID, a sheet on the window shows the action's full text, one field per line, with Continue and
// Cancel; Cancel resolves `cancelled` and never prompts; Continue prompts with the summary. The org state signer takes the
// same confirmation, so its words show in the same sheet. The harness's confirmation (MAWS_E2E_STEP_UP=accept) stands
// in for the person in an unpackaged e2e run only. Electron's dialog and Touch ID are fakes here: nothing raises a sheet
// or a system prompt.
import type { BrowserWindow, MessageBoxOptions, MessageBoxReturnValue } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { generateSigningKey, keyId, verifyStepUp, type OrgState } from '../../../apps/org-protocol/src/index.ts';

// step-up.ts reads Electron's systemPreferences at its top; no test here reaches it (every confirmation is injected).
vi.mock('electron', () => ({ systemPreferences: { promptTouchID: () => Promise.reject(new Error('the real Touch ID in a test')) } }));

import { harnessConfirmation, sheetConfirmation } from './step-up-sheet';
import { createStateSigner, createStepUp, renderAction, type Confirm, type StepUpPrompt } from './step-up';

const WINDOW = { id: 7 } as unknown as BrowserWindow;
const PROMPT: StepUpPrompt = { summary: 'sminos.spawn on machine mref-test-0000001', text: 'Action: sminos.spawn\nMachine: mref-test-0000001\nbrief: "fix the tests"' };

/** A sheet answered with `response` (0 Continue, 1 Cancel), and Touch ID answered `touchID`; every step in `seen`. */
function harness(response: number, options: { window?: BrowserWindow | null; touchID?: Awaited<ReturnType<Confirm>> } = {}) {
  const seen: Array<['sheet', BrowserWindow | null, MessageBoxOptions] | ['touch-id', StepUpPrompt]> = [];
  const showMessageBox = ((...args: [BrowserWindow, MessageBoxOptions] | [MessageBoxOptions]) => {
    const [window, box] = args.length === 2 ? args : [null, args[0]];
    seen.push(['sheet', window, box]);
    return Promise.resolve({ response, checkboxChecked: false } satisfies MessageBoxReturnValue);
  }) as Parameters<typeof sheetConfirmation>[0]['dialog']['showMessageBox'];
  const prompt: Confirm = async (shown) => {
    seen.push(['touch-id', shown]);
    return options.touchID ?? { ok: true };
  };
  const confirm = sheetConfirmation({ window: () => (options.window === undefined ? WINDOW : options.window), dialog: { showMessageBox }, prompt });
  return { confirm, seen };
}

describe('the step-up sheet', () => {
  it('shows the full text on the window, with Continue and Cancel, before any Touch ID', async () => {
    const h = harness(0);
    expect(await h.confirm(PROMPT)).toEqual({ ok: true });
    expect(h.seen).toEqual([
      ['sheet', WINDOW, { type: 'question', message: PROMPT.summary, detail: PROMPT.text, buttons: ['Continue', 'Cancel'], defaultId: 0, cancelId: 1 }],
      ['touch-id', PROMPT],
    ]);
  });

  it('never prompts Touch ID when the person cancels at the sheet', async () => {
    const h = harness(1);
    expect(await h.confirm(PROMPT)).toEqual({ ok: false, reason: 'cancelled' });
    expect(h.seen.map(([step]) => step)).toEqual(['sheet']);
  });

  it('takes Touch ID’s refusal after Continue as the answer', async () => {
    const h = harness(0, { touchID: { ok: false, reason: 'cancelled' } });
    expect(await h.confirm(PROMPT)).toEqual({ ok: false, reason: 'cancelled' });
    expect(h.seen.map(([step]) => step)).toEqual(['sheet', 'touch-id']);
  });

  it('is a window-less box when no window is open', async () => {
    const h = harness(0, { window: null });
    expect(await h.confirm(PROMPT)).toEqual({ ok: true });
    expect(h.seen[0]).toEqual(['sheet', null, expect.objectContaining({ message: PROMPT.summary, detail: PROMPT.text })]);
  });

  it('is what a step-up shows: the action’s own rendering, then the signature only after Continue', async () => {
    const key = await generateSigningKey();
    const h = harness(0);
    const stepUp = createStepUp({ device: { org: 'org-sheet', device: 'dev-mac' }, key, confirm: h.confirm });
    const signed = await stepUp.sign({ machine: 'mref-test-0000001', action: 'sminos.spawn', args: { checkout: '/w', permission_mode: 'default' } });
    if (!signed.ok) throw new Error(`refused: ${signed.reason}`);
    const shown = renderAction(signed.action);
    expect(h.seen).toEqual([['sheet', WINDOW, expect.objectContaining({ message: shown.summary, detail: shown.text })], ['touch-id', shown]]);
    expect(await verifyStepUp(signed.action, key.pub)).toEqual({ ok: true });
    const cancelled = harness(1);
    expect(await createStepUp({ device: { org: 'org-sheet', device: 'dev-mac' }, key, confirm: cancelled.confirm }).sign({ machine: 'mref-test-0000001', action: 'sminos.spawn', args: {} })).toEqual({ ok: false, reason: 'cancelled' });
  });

  it('is what the org state signer shows: its own words, the state signed only after Continue', async () => {
    const key = await generateSigningKey();
    const recovery = await generateSigningKey();
    const state: OrgState = {
      org: 'org-sheet',
      version: 1,
      prev: null,
      issued: '2026-10-31T12:00:00.000Z',
      root: { keys: [await keyId(key.pub)], recoveryPub: recovery.pub },
      members: [{ id: '0123456789abcdef0123456789abcdef', email: 'owner@example.com', role: 'admin', devices: [{ id: 'dev-mac', class: 'native-mac', keyStorage: 'software', channelPub: (await generateSigningKey()).pub, stepUpPub: key.pub }] }],
      machines: [],
      machineNames: [],
      retired: [],
      revoked: [],
      delegations: [],
      projects: [],
    };
    const words: StepUpPrompt = { summary: 'Re-sign the org state (no change)', text: 'Version: 1\nNo change' };
    const h = harness(0);
    const signed = await (await createStateSigner({ key, confirm: h.confirm })).sign(state, words);
    expect(signed.ok).toBe(true);
    expect(h.seen).toEqual([['sheet', WINDOW, expect.objectContaining({ message: words.summary, detail: words.text })], ['touch-id', words]]);
    const cancelled = harness(1);
    expect(await (await createStateSigner({ key, confirm: cancelled.confirm })).sign(state, words)).toEqual({ ok: false, reason: 'cancelled' });
    expect(cancelled.seen.map(([step]) => step)).toEqual(['sheet']);
  });
});

describe('the harness’s confirmation', () => {
  const E2E = { MAWS_E2E: '1', MAWS_E2E_STEP_UP: 'accept' };

  it('accepts without a sheet or Touch ID in an unpackaged e2e run that asks for it', async () => {
    const confirm = harnessConfirmation(E2E, false);
    expect(confirm).not.toBeNull();
    expect(await confirm!(PROMPT)).toEqual({ ok: true });
  });

  it('is refused outside MAWS_E2E, in a packaged build, and without MAWS_E2E_STEP_UP=accept', () => {
    expect(harnessConfirmation({ MAWS_E2E_STEP_UP: 'accept' }, false)).toBeNull();
    expect(harnessConfirmation({ ...E2E, MAWS_E2E: 'true' }, false)).toBeNull();
    expect(harnessConfirmation(E2E, true)).toBeNull();
    expect(harnessConfirmation({ MAWS_E2E: '1' }, false)).toBeNull();
    expect(harnessConfirmation({ ...E2E, MAWS_E2E_STEP_UP: 'cancel' }, false)).toBeNull();
  });
});
