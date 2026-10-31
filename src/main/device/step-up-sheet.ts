// The step-up sheet (P5 O7 M2, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, Interfaces §P; P5 Decision Log
// 126): the confirmation main gives `createStepUp` and `createStateSigner`. A sheet on the window shows what is about to
// be signed, its summary as the message and every field one per line as the detail, with Continue and Cancel; Continue
// then asks Touch ID (U5's prompt, which shows the summary only); Cancel, or a sheet closed with Escape, resolves
// `cancelled` and never prompts. A native sheet shows with no page loaded and keeps main's words the only copy of them.
//
// Electron-free at runtime: the window, the dialog and Touch ID are injected (index.ts passes Electron's), so the sheet's
// order is tested under vitest's node project. The harness's confirmation (`harnessConfirmation`) stands in for the
// person in an unpackaged e2e run that asks for it; the action is signed and verified as in production.
import type { BrowserWindow, dialog } from 'electron';
import type { Confirm } from './step-up';

export function sheetConfirmation(deps: {
  /** The focused window, else any; null: a window-less box. */
  window(): BrowserWindow | null;
  dialog: Pick<typeof dialog, 'showMessageBox'>;
  /** `promptTouchIDConfirmation(systemPreferences)` in production. */
  prompt: Confirm;
}): Confirm {
  return async (prompt) => {
    const box = { type: 'question' as const, message: prompt.summary, detail: prompt.text, buttons: ['Continue', 'Cancel'], defaultId: 0, cancelId: 1 };
    const window = deps.window();
    const { response } = await (window === null ? deps.dialog.showMessageBox(box) : deps.dialog.showMessageBox(window, box));
    return response === 0 ? deps.prompt(prompt) : { ok: false, reason: 'cancelled' };
  };
}

/** `MAWS_E2E=1`, unpackaged, `MAWS_E2E_STEP_UP=accept`: a confirmation that accepts with no sheet and no Touch ID; else null. */
export function harnessConfirmation(env: NodeJS.ProcessEnv, packaged: boolean): Confirm | null {
  if (packaged || env.MAWS_E2E !== '1' || env.MAWS_E2E_STEP_UP !== 'accept') return null;
  return () => Promise.resolve({ ok: true });
}
