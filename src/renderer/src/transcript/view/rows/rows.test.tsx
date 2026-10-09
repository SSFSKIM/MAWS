import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTranscriptStore } from '../../../stores/transcript';
import { registerAction } from '../../../keymap/actions-runtime'; // W13
import { ENGINE_COMPAT_NOTICE_KEY } from '@shared/engine/compat-notice'; // W13
import { loadEventFixture } from '../../../../../../test/support/fixtures';
import { api, BASH_RESULT, builder, uuid } from '../../model/test-events';
import type { Row } from '../../model/rows';
import { renderRow, rowOf, storeWith } from './test-support';

afterEach(cleanup);

describe('time separator', () => {
  it('is a separator carrying its label', () => {
    const row: Row = { id: 'time:x' as never, turnId: null, at: '2026-09-28T10:00:00.000Z', kind: 'time', label: 'Today 1:12 AM' };
    renderRow(row);
    const separator = screen.getByRole('separator');
    expect(separator.getAttribute('aria-label')).toBe('Today 1:12 AM');
    expect(separator.textContent).toBe('Today 1:12 AM');
  });
});

// W13: the engine host's notice that a Claude Code newer than tested sent what MAWS did not understand
describe('engine compatibility notice row (W13)', () => {
  it('reads as a notice and opens Settings › Engine; any other notice offers nothing', async () => {
    const text = 'Claude Code 2.1.287 is newer than the version MAWS was verified against (2.1.283); some events were not understood';
    const b = builder();
    b.turn('u1', 'hello');
    b.emit('notice.posted', { level: 'warning', text, key: ENGINE_COMPAT_NOTICE_KEY });
    b.emit('notice.posted', { level: 'warning', text: 'Something else', key: 'gateway:mismatch' });
    const store = await storeWith(b.events);
    const [compat, other] = store.rows().filter((row): row is Extract<Row, { kind: 'error' }> => row.kind === 'error' && row.scope === 'notice');
    expect(compat).toMatchObject({ severity: 'notice', text, action: 'engine_settings' });
    expect(other!.action).toBeUndefined();
    const opened = vi.fn();
    const off = registerAction('settings.open', opened);
    try {
      renderRow(compat!, { storeKey: store.key });
      fireEvent.click(screen.getByRole('button', { name: 'Settings › Engine' }));
      expect(opened).toHaveBeenCalledExactlyOnceWith(0); // the Engine section's place in the Settings index
    } finally {
      off();
    }
  });
});

describe('hook notice row (W1)', () => {
  it('a blocked prompt’s notice offers Edit prompt, which hands the turn’s own prompt to the composer', async () => {
    const b = builder();
    b.turn('u1', 'BLOCKME please');
    b.emit('hook.started', { hookId: 'h1', hookName: 'UserPromptSubmit', hookEvent: 'UserPromptSubmit' });
    b.emit('hook.finished', { hookId: 'h1', hookName: 'UserPromptSubmit', hookEvent: 'UserPromptSubmit', outcome: 'error', exitCode: 2, stdout: '', stderr: 'No.' });
    const store = await storeWith(b.events);
    const notice = store.rows().find((row): row is Extract<Row, { kind: 'error' }> => row.kind === 'error' && row.scope === 'hook')!;
    const { actions, container } = renderRow(notice, { storeKey: store.key });
    expect(container.textContent).toContain('A hook blocked your prompt · No.');
    fireEvent.click(screen.getByRole('button', { name: 'Edit prompt' }));
    expect(actions.editPrompt).toHaveBeenCalledWith(expect.objectContaining({ kind: 'user', messageUuid: uuid('u1'), text: 'BLOCKME please' }));
  });

  // After a reload the notice comes from disk (C4's backfill: the blocked prompt's `informational` record as its own
  // turn, the prompt from "Original prompt:"), and Edit prompt still hands that prompt back.
  it('reloaded from disk, a blocked prompt’s notice still offers Edit prompt with the prompt the hook blocked', async () => {
    const store = await storeWith(loadEventFixture('hooks-blocking-disk'));
    const notice = store.rows().find((row): row is Extract<Row, { kind: 'error' }> => row.kind === 'error' && row.action === 'edit_prompt')!;
    const { actions, container } = renderRow(notice, { storeKey: store.key });
    expect(container.textContent).toContain('A hook blocked your prompt · BLOCKED_BY_TEST_HOOK');
    fireEvent.click(screen.getByRole('button', { name: 'Edit prompt' }));
    expect(actions.editPrompt).toHaveBeenCalledWith(expect.objectContaining({ kind: 'user', messageUuid: 'f2dd3a2b-d9d4-488b-b222-3498876dab20', text: 'BLOCKME please reply TWO' }));
  });

  it('an empty thinking block still streaming is a plain label with nothing to open', async () => {
    const b = builder();
    b.turn('u1');
    b.emit('assistant.block.delta', { apiMessageId: api('m1'), blockIndex: 0, blockType: 'thinking', textDelta: null, thinkingDelta: '', inputJsonDelta: null, userMessageUuid: null });
    const store = await storeWith(b.events);
    renderRow(rowOf(store.rows(), 'thinking'), { storeKey: store.key });
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText(/^Thinking · \d+s$/)).toBeTruthy();
  });
});

describe('thinking row', () => {
  it('reads Thinking while live from its buffer, then Thought for {t}, and discloses its text', async () => {
    const b = builder();
    b.turn('u1');
    const delta = (text: string) =>
      b.emit('assistant.block.delta', { apiMessageId: api('m1'), blockIndex: 0, blockType: 'thinking', textDelta: null, thinkingDelta: text, inputJsonDelta: null, userMessageUuid: null });
    delta('Checking');
    const store = await storeWith(b.events);
    const live = rowOf(store.rows(), 'thinking');
    const view = renderRow(live, { storeKey: store.key });
    const toggle = screen.getByRole('button', { name: /^Thinking · \d+s$/ });
    fireEvent.click(toggle);
    act(() => store.push([delta(' the path')]));
    expect(view.container.textContent).toContain('Checking the path');
    b.tick(8000);
    b.thinking('m1', 0, 'Checking the path.');
    act(() => store.push([b.events.at(-1)!]));
    view.rerenderRow(rowOf(store.rows(), 'thinking'));
    expect(screen.getByRole('button', { name: 'Thought for 8s' }).getAttribute('aria-expanded')).toBe('true'); // the disclosure survived
    expect(view.container.textContent).toContain('Checking the path.');
  });
});

// W8 (T1): the CLI's words and colour while the block streams, under Codex's shimmer.
describe('live thinking label', () => {
  beforeEach(() => vi.useFakeTimers({ now: Date.parse('2026-09-28T10:00:05.000Z'), toFake: ['Date', 'setInterval', 'clearInterval'] }));
  afterEach(() => vi.useRealTimers());

  const streaming = () => {
    const b = builder();
    b.turn('u1');
    const delta = (text: string) =>
      b.emit('assistant.block.delta', { apiMessageId: api('m1'), blockIndex: 0, blockType: 'thinking', textDelta: null, thinkingDelta: text, inputJsonDelta: null, userMessageUuid: null });
    delta('Checking');
    return { b, delta };
  };
  const shimmer = () => document.querySelector<HTMLElement>('[data-shimmer]')!;

  it('reads the tier, the session’s effort and the time the block has run, ticking once a second, and warms from 10 s', async () => {
    const store = await storeWith(streaming().b.events);
    renderRow(rowOf(store.rows(), 'thinking'), { storeKey: store.key, effort: 'xhigh' });
    expect(screen.getByRole('button').textContent).toBe('Thinking with xhigh effort · 0s');
    expect(shimmer().dataset.warmth).toBe('0');
    act(() => vi.advanceTimersByTime(12_000));
    expect(shimmer().textContent).toBe('Still thinking with xhigh effort · 12s');
    expect(shimmer().dataset.warmth).toBe('0.25');
    expect(shimmer().style.getPropertyValue('--thinking-warmth')).toBe('25%');
    act(() => vi.advanceTimersByTime(36_000));
    expect(shimmer().textContent).toBe('Deep in thought with xhigh effort · 48s');
    expect(shimmer().dataset.warmth).toBe('1');
  });

  it('names no effort when the session’s is unknown, and without a live process follows the events, not the clock', async () => {
    const { b, delta } = streaming();
    const store = await storeWith(b.events);
    useTranscriptStore.getState().setLive(store.key, false);
    renderRow(rowOf(store.rows(), 'thinking'), { storeKey: store.key });
    act(() => vi.advanceTimersByTime(30_000));
    expect(shimmer().textContent).toBe('Thinking · 0s');
    b.tick(21_000);
    act(() => store.push([delta(' the path')]));
    expect(shimmer().textContent).toBe('Thinking more · 21s');
  });

  it('a completed block reads Thought for {t}, without the shimmer', async () => {
    const { b } = streaming();
    b.tick(8000);
    b.thinking('m1', 0, 'Checking the path.');
    const store = await storeWith(b.events);
    renderRow(rowOf(store.rows(), 'thinking'), { storeKey: store.key, effort: 'high' });
    expect(screen.getByRole('button').textContent).toBe('Thought for 8s');
    expect(shimmer()).toBeNull();
  });

  it('an active group with nothing running reads Thinking under the shimmer', async () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('t1', 'Bash', { command: 'ls' });
    b.result('t1', 'a.txt', { structured: BASH_RESULT('a.txt') });
    const store = await storeWith(b.events);
    const group = rowOf(store.rows(), 'group');
    expect(group.state).toBe('active');
    renderRow(group, { storeKey: store.key, effort: 'high' });
    expect(shimmer().textContent).toBe('Thinking');
  });
});

describe('local command row', () => {
  it('shows the command output under its header, never as a bubble', async () => {
    const b = builder();
    b.emit('user.message', { messageUuid: uuid('lc'), content: '<local-command-stdout>Total cost: $0.0123</local-command-stdout>', isReplay: true, isSynthetic: false, origin: 'local-command', bash: null });
    const store = await storeWith(b.events);
    const row = rowOf(store.rows(), 'local_command');
    const { container } = renderRow(row);
    expect(container.textContent).toContain('Command output');
    expect(container.textContent).toContain('Total cost: $0.0123');
    expect(container.querySelector('[data-bubble]')).toBeNull();
  });
});

describe('group and cell disclosure', () => {
  it('a group discloses its cells and a cell its detail, through the store', async () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('t1', 'Bash', { command: 'ls' }, 'm1', 0);
    b.result('t1', 'a.txt', { structured: BASH_RESULT('a.txt') });
    b.toolUse('t2', 'Bash', { command: 'pwd' }, 'm1', 1);
    b.result('t2', '/x', { structured: BASH_RESULT('/x') });
    const store = await storeWith(b.events);
    const group = rowOf(store.rows(), 'group');
    const view = renderRow(group, { storeKey: store.key });
    expect(view.container.querySelector('[data-cell-count]')?.getAttribute('data-cell-count')).toBe('2');
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    view.rerenderRow(rowOf(store.rows(), 'group'));
    const cells = view.container.querySelectorAll('[data-cell-id]');
    expect(cells).toHaveLength(2);
    fireEvent.click(cells[0].querySelector('button')!);
    view.rerenderRow(rowOf(store.rows(), 'group'));
    expect(view.container.querySelector('[data-cell-id][data-expanded]')?.textContent).toContain('a.txt');
  });
});
