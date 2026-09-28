import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { humanTurn, record, status } from '../../../test/support/builders';

// Electron's `app` as the guard sees it: `before-quit` listeners, and `quit()` firing `before-quit` again, as it does.
const electron = vi.hoisted(() => {
  const listeners: ((event: { preventDefault(): void; defaultPrevented: boolean }) => void)[] = [];
  const app = {
    quits: 0,
    on(name: string, listener: (typeof listeners)[number]) {
      if (name === 'before-quit') listeners.push(listener);
      return app;
    },
    // What a quit attempt does: `before-quit` goes to every listener; the quit proceeds unless one prevented it.
    attempt(): boolean {
      const event = { defaultPrevented: false, preventDefault: () => (event.defaultPrevented = true) };
      for (const listener of listeners) listener(event);
      return !event.defaultPrevented;
    },
    quit() {
      if (app.attempt()) app.quits += 1;
    },
    reset() {
      listeners.length = 0;
      app.quits = 0;
    },
  };
  return { app };
});
vi.mock('electron', () => ({ app: electron.app }));

const { SessionReadModel } = await import('../sessions/read-model');
const { askToQuit, installQuitGuard, quitDecision, quitQuestion } = await import('./quit-guard');

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function modelWithMidTurn(count: number) {
  const model = new SessionReadModel('index');
  model.register({
    start(w) {
      for (let i = 0; i < count; i += 1) {
        const id = `s${i}` as AppSessionId;
        w.observeRecord(record(id));
        w.applyEngineStatus(status(id, { process: 'ready', engineState: 'running', turn: humanTurn }));
      }
      return () => {};
    },
  });
  return model;
}

beforeEach(() => electron.app.reset());

describe('quit decision', () => {
  it('quits at once when nothing is mid-turn, and otherwise follows the answer', () => {
    expect(quitDecision(0, 'cancel')).toBe('quit');
    expect(quitDecision(2, 'cancel')).toBe('cancel');
    expect(quitDecision(2, 'quit')).toBe('quit');
  });

  it('asks nothing when no session is mid-turn', () => {
    const ask = vi.fn();
    installQuitGuard(modelWithMidTurn(0), { ask, shutdownEngine: vi.fn() });
    expect(electron.app.attempt()).toBe(true);
    expect(ask).not.toHaveBeenCalled();
  });

  it('holds the quit and asks with the mid-turn count; Cancel keeps the app, and the next quit asks again', async () => {
    const ask = vi.fn(() => Promise.resolve('cancel' as const));
    const shutdownEngine = vi.fn(() => Promise.resolve());
    installQuitGuard(modelWithMidTurn(2), { ask, shutdownEngine });
    expect(electron.app.attempt()).toBe(false);
    await settle();
    expect(ask).toHaveBeenCalledExactlyOnceWith(2);
    expect(shutdownEngine).not.toHaveBeenCalled();
    expect(electron.app.quits).toBe(0);
    expect(electron.app.attempt()).toBe(false);
    expect(ask).toHaveBeenCalledTimes(2);
  });

  it('Quit stops the engine, then quits without asking again', async () => {
    const order: string[] = [];
    const ask = vi.fn(() => Promise.resolve('quit' as const));
    const shutdownEngine = vi.fn(async () => void order.push('shutdown'));
    installQuitGuard(modelWithMidTurn(3), { ask, shutdownEngine });
    electron.app.attempt();
    await settle();
    expect(shutdownEngine).toHaveBeenCalledOnce();
    expect(electron.app.quits).toBe(1);
    expect(ask).toHaveBeenCalledOnce();
  });

  it('quits even when stopping the engine fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    installQuitGuard(modelWithMidTurn(1), { ask: () => Promise.resolve('quit'), shutdownEngine: () => Promise.reject(new Error('host gone')) });
    electron.app.attempt();
    await settle();
    expect(electron.app.quits).toBe(1);
  });

  it('a second quit while the question is open is held without a second question', async () => {
    let answer!: (a: 'quit' | 'cancel') => void;
    const ask = vi.fn(() => new Promise<'quit' | 'cancel'>((resolve) => (answer = resolve)));
    installQuitGuard(modelWithMidTurn(1), { ask, shutdownEngine: () => Promise.resolve() });
    expect(electron.app.attempt()).toBe(false);
    expect(electron.app.attempt()).toBe(false);
    expect(ask).toHaveBeenCalledOnce();
    answer('cancel');
    await settle();
    expect(electron.app.attempt()).toBe(false);
    expect(ask).toHaveBeenCalledTimes(2);
  });

  it('words the question for one and for many', () => {
    expect(quitQuestion(1)).toMatchObject({ type: 'warning', message: '1 session mid-turn', buttons: ['Quit', 'Cancel'], defaultId: 1, cancelId: 1 });
    expect(quitQuestion(4)).toMatchObject({ message: '4 sessions mid-turn', detail: 'Quitting stops them. Transcripts stay on disk and can be resumed.' });
  });

  it('under MAWS_E2E answers from MAWS_E2E_QUIT_ANSWER (quit by default) and logs instead of showing the dialog', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const show = vi.fn();
    expect(await askToQuit(4, { env: { MAWS_E2E: '1' }, show })).toBe('quit');
    expect(await askToQuit(5, { env: { MAWS_E2E: '1', MAWS_E2E_QUIT_ANSWER: 'cancel' }, show })).toBe('cancel');
    expect(show).not.toHaveBeenCalled();
    expect(log.mock.calls.map(([line]) => line)).toEqual(['quit-guard: 4 mid-turn, auto-answered quit', 'quit-guard: 5 mid-turn, auto-answered cancel']);
  });

  it('otherwise shows the question and maps its buttons', async () => {
    const show = vi.fn().mockResolvedValueOnce({ response: 0 }).mockResolvedValueOnce({ response: 1 });
    expect(await askToQuit(2, { env: {}, show })).toBe('quit');
    expect(await askToQuit(2, { env: {}, show })).toBe('cancel');
    expect(show).toHaveBeenCalledWith(quitQuestion(2));
  });
});
