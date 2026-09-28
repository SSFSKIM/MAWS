// Quitting with turns in flight asks first (D-16; C5 execution document, "Quit guard"; residue *Quit coordination*).
// Mid-turn is counted from C3's engine statuses in the read model (`midTurnCount`), never from the folded digest. With
// nothing mid-turn the quit goes ahead untouched; otherwise it is held and the owner is asked: Quit stops the engine
// host's sessions (`engine.shutdown`) and quits, Cancel keeps the app. The end-to-end smoke answers without a dialog.
import { app, type MessageBoxOptions } from 'electron';
import type { SessionReadModel } from '../sessions/read-model';

export type QuitAnswer = 'quit' | 'cancel';

export function quitDecision(midTurn: number, answer: QuitAnswer): QuitAnswer {
  return midTurn === 0 ? 'quit' : answer;
}

export function quitQuestion(count: number): MessageBoxOptions {
  return {
    type: 'warning',
    buttons: ['Quit', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    message: count === 1 ? '1 session mid-turn' : `${count} sessions mid-turn`,
    detail: 'Quitting stops them. Transcripts stay on disk and can be resumed.',
  };
}

// The question as the app asks it: the native dialog, or under `MAWS_E2E=1` the answer `MAWS_E2E_QUIT_ANSWER` gives
// (quit by default), logged to stderr for the smoke to read.
export async function askToQuit(
  count: number,
  deps: { env: Record<string, string | undefined>; show(options: MessageBoxOptions): Promise<{ response: number }> },
): Promise<QuitAnswer> {
  if (deps.env.MAWS_E2E === '1') {
    const answer: QuitAnswer = deps.env.MAWS_E2E_QUIT_ANSWER === 'cancel' ? 'cancel' : 'quit';
    console.error(`quit-guard: ${count} mid-turn, auto-answered ${answer}`);
    return answer;
  }
  const { response } = await deps.show(quitQuestion(count));
  return response === 0 ? 'quit' : 'cancel';
}

export function installQuitGuard(
  model: Pick<SessionReadModel, 'midTurnCount'>,
  deps: { ask(count: number): Promise<QuitAnswer>; shutdownEngine(): Promise<void> },
): void {
  let asking = false;
  let disarmed = false;
  app.on('before-quit', (event) => {
    if (disarmed) return;
    const count = model.midTurnCount();
    if (count === 0) return;
    event.preventDefault();
    if (asking) return; // the question is already open
    asking = true;
    void deps
      .ask(count)
      .then(async (answer) => {
        if (quitDecision(count, answer) !== 'quit') return;
        disarmed = true;
        try {
          await deps.shutdownEngine();
        } catch (error) {
          console.error('[quit-guard] stopping the engine failed; quitting anyway', error);
        }
        app.quit();
      })
      .finally(() => {
        asking = false;
      });
  });
}
