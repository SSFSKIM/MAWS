// R2: the engine's requests to the surface, answered by this window (asks.ts): the clipboard with "Copied", and the
// composer of a session a pane shows (its prompt port), as pass3/mods-surface-copy and mods-surface-prompt-access asked.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import { fakeClient, type FakeClient } from '../../../../test/support/fake-client';
import { registerFocusTarget, resetComposerStore } from '../stores/composer';
import { useLayout } from '../stores/layout';
import { useNotices } from '../stores/notices';
import { fillStores, resetShellStores, scenarioFile } from '../test-support/shell-stores';
import { ASK_ACTIONABLE_MS, connectSurfaceAsks } from './asks';

const nine = scenarioFile('nine-sessions');
const [shown, other] = nine.sessions.map((r) => r.appId);
const ask = (seq: number, payload: Record<string, unknown>) =>
  ({ id: `${shown}:L:${seq}:0`, sessionId: 's', at: new Date().toISOString(), seq, agentId: null, parentToolUseId: null, kind: 'plugin.ask', plugin: null, text: null, mode: null, ...payload }) as SessionEvent;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

let fake: FakeClient;
let disconnect: () => void;
const writeText = vi.fn(async (text: string) => void text);
beforeEach(() => {
  resetShellStores();
  resetComposerStore();
  fillStores(nine);
  useNotices.setState({ notices: [] });
  useLayout.getState().openSession(shown!);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  writeText.mockClear();
  fake = fakeClient({ 'session.ui.answer': { outcome: 'delivered' } });
  disconnect = connectSurfaceAsks(fake.client);
});
afterEach(() => disconnect());

describe('the surface’s requests, answered by this window (R2)', () => {
  it('a copy writes the clipboard, says "Copied" and answers copied', async () => {
    fake.event('session.eventBatch', { appSessionId: other, events: [ask(19, { requestId: 'copy-1', ask: 'copy', plugin: 'mods-probe', text: 'MODS_PROBE_COPY' })] });
    await settle();
    expect(writeText).toHaveBeenCalledWith('MODS_PROBE_COPY');
    expect(useNotices.getState().notices.map((n) => n.text)).toEqual(['Copied']);
    expect(fake.invoked('session.ui.answer')).toEqual([{ appSessionId: other, requestId: 'copy-1', answer: { ask: 'copy', copied: true } }]);
  });

  it('a refused clipboard answers not copied, saying nothing', async () => {
    writeText.mockRejectedValueOnce(new Error('denied'));
    fake.event('session.eventBatch', { appSessionId: shown, events: [ask(19, { requestId: 'copy-2', ask: 'copy', text: 'x' })] });
    await settle();
    expect(useNotices.getState().notices).toEqual([]);
    expect(fake.invoked('session.ui.answer')).toEqual([{ appSessionId: shown, requestId: 'copy-2', answer: { ask: 'copy', copied: false } }]);
  });

  it('read, fill and suggest go through the shown session’s composer', async () => {
    const prompt = { read: vi.fn(() => ({ text: 'MAWS draft', cursor: 10 })), fill: vi.fn(() => true), suggest: vi.fn(() => false) };
    registerFocusTarget(shown!, { focusEditor: () => {}, focusFrame: () => {}, insertText: () => {}, prompt });
    fake.event('session.eventBatch', {
      appSessionId: shown,
      events: [
        ask(22, { requestId: 'read-1', ask: 'prompt_read' }),
        ask(27, { requestId: 'fill-1', ask: 'prompt_fill', text: 'MODS_PROBE_FILL', mode: 'replace' }),
        ask(36, { requestId: 'suggest-1', ask: 'prompt_suggest', text: 'MODS_PROBE_SUGGEST' }),
      ],
    });
    await settle();
    expect(prompt.fill).toHaveBeenCalledWith('MODS_PROBE_FILL', 'replace');
    expect(prompt.suggest).toHaveBeenCalledWith('MODS_PROBE_SUGGEST');
    expect(fake.invoked('session.ui.answer')).toEqual([
      { appSessionId: shown, requestId: 'read-1', answer: { ask: 'prompt_read', text: 'MAWS draft', cursor: 10 } },
      { appSessionId: shown, requestId: 'fill-1', answer: { ask: 'prompt_fill', filled: true } },
      { appSessionId: shown, requestId: 'suggest-1', answer: { ask: 'prompt_suggest', shown: false } },
    ]);
  });

  it('a request older than the host’s refusal is skipped: no fill, no clipboard, no answer', async () => {
    const prompt = { read: vi.fn(() => ({ text: '', cursor: 0 })), fill: vi.fn(() => true), suggest: vi.fn(() => true) };
    registerFocusTarget(shown!, { focusEditor: () => {}, focusFrame: () => {}, insertText: () => {}, prompt });
    const stale = new Date(Date.now() - ASK_ACTIONABLE_MS - 100).toISOString();
    fake.event('session.eventBatch', {
      appSessionId: shown,
      events: [ask(27, { requestId: 'fill-old', ask: 'prompt_fill', text: 'late', mode: 'replace', at: stale }), ask(19, { requestId: 'copy-old', ask: 'copy', text: 'late', at: stale })],
    });
    await settle();
    expect(prompt.fill).not.toHaveBeenCalled();
    expect(writeText).not.toHaveBeenCalled();
    expect(fake.invoked('session.ui.answer')).toEqual([]);
  });

  it('a shown session with no composer refuses at once; one no pane shows is left to the host', async () => {
    fake.event('session.eventBatch', { appSessionId: shown, events: [ask(22, { requestId: 'read-2', ask: 'prompt_read' }), ask(27, { requestId: 'fill-2', ask: 'prompt_fill', text: 't', mode: 'append' })] });
    fake.event('session.eventBatch', { appSessionId: other, events: [ask(31, { requestId: 'read-3', ask: 'prompt_read' })] });
    await settle();
    expect(fake.invoked('session.ui.answer')).toEqual([
      { appSessionId: shown, requestId: 'read-2', answer: { ask: 'prompt_read', text: '', cursor: 0 } },
      { appSessionId: shown, requestId: 'fill-2', answer: { ask: 'prompt_fill', filled: false } },
    ]);
  });
});
