// UX wave U3, first landing (docs/doperpowers/plans/2026-11-12-ux-wave-U3a-arrivals.md, M2; Interfaces D and I): the
// notice line and the consent line, from rows the model made of hand-made events (every word invented).
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ArrivalEntry } from '@shared/engine/arrival-schema';
import { consentMessage } from '@shared/engine/arrival';
import type { AppSessionId } from '@shared/graph/ids';
import { at } from '../../../../../../test/support/machine';
import { rowsOf, withAllExpanded } from '../../model/derive';
import { applyEvents, createState } from '../../model/reduce';
import type { Row } from '../../model/rows';
import { builder, uuid } from '../../model/test-events';
import type { TaskOutput, TranscriptActions } from '../context';
import { renderRow, spyActions } from './test-support';

const A = at('A' as AppSessionId);
type Notice = Extract<Row, { kind: 'notice' }>;

const derived = (build: (b: ReturnType<typeof builder>) => void) => {
  const b = builder();
  build(b);
  return rowsOf(withAllExpanded(applyEvents(createState(null, null), b.events)));
};
const notice = (arrival: ArrivalEntry) =>
  derived((b) => {
    b.emit('turn.started', { userMessageUuid: null, origin: 'engine' });
    b.emit('user.message', { messageUuid: uuid('n1'), content: '<task-notification>…</task-notification>', isReplay: true, isSynthetic: true, origin: 'task-notification', bash: null, arrival: [arrival] });
  }).find((row): row is Notice => row.kind === 'notice')!;
const taskEnd = (over: Record<string, unknown> = {}) =>
  notice({ class: 'task', taskId: 'bt1', toolUseId: 'tu-bt1', runId: 'run-1', outcome: 'completed', summary: 'Background command "count files" completed (exit code 0)', durationMs: null, outputFile: null, detail: null, ...over });
const mark = (container: HTMLElement) => container.querySelector('.transcript-line-mark')!;

afterEach(cleanup);

describe('a notice', () => {
  // The architect's ruling of 2026-11-13: a line in the one-line ellipsis style is the control even when nothing more
  // came with it, and opened shows its whole sentence
  it('is one line led by a dot in its outcome’s colour, the engine’s sentence verbatim, and the control that shows the whole sentence', () => {
    const { container } = renderRow(taskEnd({ durationMs: 65_000 }), { storeKey: A });
    expect(mark(container).textContent).toBe('●');
    expect(container.querySelector('.transcript-notice')?.getAttribute('data-outcome')).toBe('completed');
    expect(container.querySelector('.transcript-line-text')?.textContent).toBe('Background command "count files" completed (exit code 0) · 1m 05s');
    fireEvent.click(screen.getByRole('button', { name: /^Background command/ }));
    expect(container.querySelector('.transcript-notice-detail')?.textContent).toBe('Background command "count files" completed (exit code 0) · 1m 05s');
    for (const outcome of ['failed', 'stopped'] as const) {
      cleanup();
      const { container: next } = renderRow(taskEnd({ outcome }), { storeKey: A });
      expect(next.querySelector('.transcript-notice')?.getAttribute('data-outcome')).toBe(outcome);
    }
    cleanup();
    const { container: muted } = renderRow(taskEnd({ outcome: null, summary: 'Monitor "watch logs" event: a line arrived' }), { storeKey: A });
    expect(muted.querySelector('.transcript-notice')?.hasAttribute('data-outcome')).toBe(false); // the muted dot
  });

  it('shows the engine’s duration dim after the sentence, where it gave one', () => {
    const { container } = renderRow(taskEnd({ summary: 'Agent "Survey notes" finished', durationMs: 65_000 }), { storeKey: A });
    expect(container.querySelector('.transcript-line-text')?.textContent).toBe('Agent "Survey notes" finished · 1m 05s');
    expect(container.querySelector('.transcript-notice-duration')?.textContent).toBe(' · 1m 05s');
  });

  it('opens what the engine delivered with it under the line, on a click, and hides it again', () => {
    const { container } = renderRow(taskEnd({ detail: 'counted 42 files' }), { storeKey: A });
    const line = screen.getByRole('button', { name: /^Background command/ });
    expect(container.querySelector('.transcript-notice-detail')).toBeNull();
    fireEvent.click(line);
    expect(screen.getByText('counted 42 files')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Open output' })).toBeNull(); // it names no output file
    fireEvent.click(line);
    expect(container.querySelector('.transcript-notice-detail')).toBeNull();
  });

  it('draws no “Open output” where the mount gives no act, and calls the act the mount gave with the path, the task and the line’s words', () => {
    const named = taskEnd({ outputFile: '/tmp/work/bt1.output' });
    renderRow(named, { storeKey: A }); // the row tests' actions give no outputAction
    fireEvent.click(screen.getByRole('button', { name: /^Background command/ }));
    expect(screen.queryByRole('button', { name: 'Open output' })).toBeNull();
    cleanup();
    const none = vi.fn(() => null);
    renderRow(named, { storeKey: A, actions: { ...spyActions(), outputAction: none } });
    expect(none).toHaveBeenCalledWith(A);
    fireEvent.click(screen.getByRole('button', { name: /^Background command/ }));
    expect(screen.queryByRole('button', { name: 'Open output' })).toBeNull();
    cleanup();
    const open = vi.fn<(output: TaskOutput) => void>();
    const actions: TranscriptActions = { ...spyActions(), outputAction: vi.fn(() => open) };
    renderRow(named, { storeKey: A, actions });
    fireEvent.click(screen.getByRole('button', { name: /^Background command/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Open output' }));
    expect(actions.outputAction).toHaveBeenCalledWith(A);
    expect(open).toHaveBeenCalledExactlyOnceWith({ taskId: 'bt1', path: '/tmp/work/bt1.output', title: 'Background command "count files" completed (exit code 0)' });
  });

  it('draws a scheduled fire, an answer and the wake with the muted dot', () => {
    for (const arrival of [{ class: 'schedule', prompt: 'tidy the notes folder' }, { class: 'answer', tool: 'sminos', call: 'tu-x', summary: 'The user did not answer the questions.', answers: null, dismissed: false }, { class: 'wake' }] as ArrivalEntry[]) {
      const { container } = renderRow(notice(arrival), { storeKey: A });
      expect(container.querySelector('.transcript-notice')?.hasAttribute('data-outcome')).toBe(false);
      expect(mark(container).textContent).toBe('●');
      cleanup();
    }
  });
});

describe('the consent line', () => {
  it('reads You approved and the subject as inline code: one line, never a bubble, with no Copy and no Edit', () => {
    const subject = 'git push origin notes';
    const row = derived((b) => {
      b.emit('turn.started', { userMessageUuid: uuid('c1'), origin: 'human' });
      b.emit('user.message', { messageUuid: uuid('c1'), content: consentMessage('command', subject), isReplay: false, isSynthetic: false, origin: 'human', bash: null, arrival: [{ class: 'consent', kind: 'command', subject }] });
    }).find((r): r is Extract<Row, { kind: 'user' }> => r.kind === 'user')!;
    const { container } = renderRow(row, { storeKey: A });
    expect(container.querySelector('.transcript-consent')?.textContent).toBe(`You approved ${subject}`);
    expect(container.querySelector('.transcript-consent code')?.textContent).toBe(subject);
    expect(container.querySelector('[data-bubble]')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Copy' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
  });

  // UX wave U1c, M1 (the U1c document, Design 2): a grant the engine joined with the person's other words
  it('beside the person’s other words: their bubble without the grant’s sentence, then the line', () => {
    const subject = 'make build';
    const rows = derived((b) => {
      b.emit('turn.started', { userMessageUuid: uuid('j1'), origin: 'human' });
      b.emit('user.message', { messageUuid: uuid('j1'), content: `Also say the word EXTRA when done.\n${consentMessage('command', subject)}`, isReplay: true, isSynthetic: false, origin: 'human', bash: null, arrival: [{ class: 'consent', kind: 'command', subject }] });
    }).filter((r): r is Extract<Row, { kind: 'user' }> => r.kind === 'user');
    expect(rows).toHaveLength(2);
    const bubble = renderRow(rows[0]!, { storeKey: A }).container;
    expect(bubble.querySelector('[data-bubble]')?.textContent).toContain('Also say the word EXTRA when done.');
    expect(bubble.textContent).not.toContain('Permission granted');
    expect(bubble.querySelector('.transcript-consent')).toBeNull();
    cleanup();
    const line = renderRow(rows[1]!, { storeKey: A }).container;
    expect(line.querySelector('.transcript-consent')?.textContent).toBe(`You approved ${subject}`);
    expect(line.querySelector('[data-bubble]')).toBeNull();
  });

  // M1's review (findings 1 and 2)
  it('an image beside two grants in text blocks stays drawn in the bubble, and each grant is its line', () => {
    const image = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' } };
    const rows = derived((b) => {
      b.emit('turn.started', { userMessageUuid: uuid('j1'), origin: 'human' });
      b.emit('user.message', {
        messageUuid: uuid('j1'), content: [{ type: 'text', text: consentMessage('command', 'make build') }, { type: 'text', text: consentMessage('command', 'make check') }, image], isReplay: false, isSynthetic: false, origin: 'human', bash: null,
        arrival: [{ class: 'consent', kind: 'command', subject: 'make build' }, { class: 'consent', kind: 'command', subject: 'make check' }],
      });
    }).filter((r): r is Extract<Row, { kind: 'user' }> => r.kind === 'user');
    expect(rows).toHaveLength(3);
    expect(renderRow(rows[0]!, { storeKey: A }).container.querySelectorAll('.transcript-attachment-image')).toHaveLength(1);
    cleanup();
    expect(rows.slice(1).map((row) => {
      const text = renderRow(row, { storeKey: A }).container.querySelector('.transcript-consent')?.textContent;
      cleanup();
      return text;
    })).toEqual(['You approved make build', 'You approved make check']);
  });

  it('a grant the engine never ran keeps its line with the dropped row’s mark, Not sent, as a dropped bubble does', () => {
    const subject = 'make build';
    const rows = derived((b) => {
      b.turn('u1', 'count slowly');
      b.emit('user.message', { messageUuid: uuid('s1'), content: `Also say the word EXTRA when done.\n${consentMessage('command', subject)}`, isReplay: false, isSynthetic: false, origin: 'human', bash: null, arrival: [{ class: 'consent', kind: 'command', subject }] });
      b.emit('command.lifecycle', { commandUuid: uuid('s1'), state: 'cancelled' });
    }).filter((r): r is Extract<Row, { kind: 'user' }> => r.kind === 'user' && r.dropped);
    expect(rows).toHaveLength(2);
    const bubble = renderRow(rows[0]!, { storeKey: A }).container;
    expect(bubble.querySelector('.transcript-not-sent')?.textContent).toBe('Not sent');
    cleanup();
    const line = renderRow(rows[1]!, { storeKey: A }).container;
    expect(line.querySelector('.transcript-consent')?.hasAttribute('data-dropped')).toBe(true);
    expect(line.querySelector('.transcript-consent .transcript-not-sent')?.textContent).toBe('Not sent');
  });
});
