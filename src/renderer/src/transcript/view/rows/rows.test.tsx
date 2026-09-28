import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
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
    const toggle = screen.getByRole('button', { name: 'Thinking' });
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

describe('local command row', () => {
  it('shows the command output under its header, never as a bubble', async () => {
    const b = builder();
    b.emit('user.message', { messageUuid: uuid('lc'), content: '<local-command-stdout>Set model to opus</local-command-stdout>', isReplay: true, isSynthetic: false, origin: 'local-command', bash: null });
    const store = await storeWith(b.events);
    const row = rowOf(store.rows(), 'local_command');
    const { container } = renderRow(row);
    expect(container.textContent).toContain('Command output');
    expect(container.textContent).toContain('Set model to opus');
    expect(container.querySelector('[data-bubble]')).toBeNull();
  });
});

describe('placeholder rows (M4 and M5 replace them)', () => {
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
