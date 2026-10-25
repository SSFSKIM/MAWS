import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useTranscriptStore } from '../../../stores/transcript';
import { editCounts } from '../../model/cells';
import { loadJournal } from '../../../../../../test/support/fixtures';
import { journalToEvents } from '../../dev/journal';
import { api, builder, tool, uuid } from '../../model/test-events';
import { renderRow, rowOf, storeWith } from './test-support';

afterEach(cleanup);

it('renders a newline-terminated create as one addition even with an empty engine patch', () => {
  expect(editCounts('Write', { content: 'notes\n' }, { type: 'create', originalFile: null, structuredPatch: [] })).toMatchObject({
    added: 1, removed: 0, change: 'create', hunks: [{ oldLines: 0, newStart: 1, newLines: 1, lines: ['+notes'] }],
  });
});

it('keeps factual edit titles, counts and inline content when a batch summary arrives; no receipt', async () => {
  const b = builder(); b.turn('u');
  b.toolUse('edit', 'Edit', { file_path: '/p/index.txt', old_string: 'old', new_string: 'new' });
  b.result('edit', 'edited', { structured: { structuredPatch: [{ oldStart: 2, oldLines: 1, newStart: 2, newLines: 1, lines: ['-old', '+new'] }] } });
  b.toolUse('write', 'Write', { file_path: '/p/notes.txt', content: 'notes\n' });
  b.result('write', 'created', { structured: { type: 'create', originalFile: null, structuredPatch: [] } });
  b.emit('tool.summary', { toolUseIds: [tool('edit'), tool('write')], summary: 'Opaque batch summary' }); b.end(['u']);
  const store = await storeWith(b.events); useTranscriptStore.getState().expandAll(store.key);
  expect(store.rows().some((row) => row.kind === 'receipt')).toBe(false);
  const view = renderRow(rowOf(store.rows(), 'group'), { storeKey: store.key });
  expect(view.container.textContent).toContain('Edited 1 file, created 1 file');
  expect(view.container.textContent).not.toContain('Opaque batch summary');
  const create = screen.getByRole('button', { name: /^Created notes\.txt.*\+1$/ });
  expect(create.querySelector('.transcript-counts')?.textContent).toBe('+1');
  fireEvent.click(create); view.rerenderRow(rowOf(store.rows(), 'group'));
  expect(view.container.querySelector('[data-diff="add"]')?.textContent).toContain('notes');
});

it('shows file basenames through the surface wrapper without shortening tooltips, detail chips or model paths', async () => {
  const b = builder(); b.turn('u');
  b.toolUse('read', 'Read', { file_path: '/p/docs/readme.md' }); b.result('read', 'Read me');
  b.toolUse('edit', 'Edit', { file_path: '/p/src/widget.ts', old_string: 'old', new_string: 'new' }); b.result('edit', 'edited');
  b.toolUse('write', 'Write', { file_path: '/p/docs/notes.txt', content: 'notes\n' });
  b.result('write', 'created', { structured: { type: 'create', originalFile: null, structuredPatch: [] } });
  b.toolUse('update', 'Write', { file_path: '/p/docs/existing.txt', content: 'updated\n' });
  b.result('update', 'written', { structured: { type: 'update', originalFile: 'old\n', structuredPatch: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-old', '+updated'] }] } });
  b.end(['u']);
  const store = await storeWith(b.events); useTranscriptStore.getState().expandAll(store.key);
  const group = rowOf(store.rows(), 'group');
  const original = structuredClone(group.cells);
  const view = renderRow(group, { storeKey: store.key });
  const buttons = [...view.container.querySelectorAll<HTMLButtonElement>('.transcript-cell-line')];
  expect(buttons.map((button) => button.querySelector('.transcript-cell-label')?.textContent)).toEqual([
    'Read readme.md', 'Edited widget.ts', 'Created notes.txt', 'Edited existing.txt',
  ]);
  expect(buttons.map((button) => button.title)).toEqual(['/p/docs/readme.md', '/p/src/widget.ts', '/p/docs/notes.txt', '/p/docs/existing.txt']);
  expect(group.cells).toEqual(original);
  expect(group.cells[1]).toMatchObject({ paths: ['/p/src/widget.ts'], label: 'Edited /p/src/widget.ts +1 −1', detail: { filePath: '/p/src/widget.ts' } });
  fireEvent.click(buttons[1]); view.rerenderRow(rowOf(store.rows(), 'group'));
  const file = screen.getByRole('button', { name: '/p/src/widget.ts' });
  expect(file.textContent).toBe('/p/src/widget.ts');
  expect(file.title).toBe('/p/src/widget.ts');
  fireEvent.click(file);
  expect(view.actions.openFile).toHaveBeenCalledWith('/p/src/widget.ts', undefined);
});

it('uses each same-basename file’s shortest distinguishing suffix through wrapped group cells', async () => {
  const b = builder(); b.turn('u');
  b.toolUse('read', 'Read', { file_path: '/p/a/x/index.ts' }); b.result('read', 'first');
  b.toolUse('edit', 'Edit', { file_path: '/p/b/x/index.ts', old_string: 'old', new_string: 'new' }); b.result('edit', 'edited');
  b.toolUse('create', 'Write', { file_path: '/p/c/index.ts', content: 'new\n' });
  b.result('create', 'created', { structured: { type: 'create', originalFile: null, structuredPatch: [] } });
  b.toolUse('repeat', 'Read', { file_path: '/p/a/x/index.ts' }); b.result('repeat', 'first again');
  b.end(['u']);
  const store = await storeWith(b.events); useTranscriptStore.getState().expandAll(store.key);
  const view = renderRow(rowOf(store.rows(), 'group'), { storeKey: store.key });
  const buttons = [...view.container.querySelectorAll<HTMLButtonElement>('.transcript-cell-line')];
  expect(buttons.map((button) => button.querySelector('.transcript-cell-label')?.textContent)).toEqual([
    'Read a/x/index.ts', 'Edited b/x/index.ts', 'Created c/index.ts', 'Read a/x/index.ts',
  ]);
  expect(buttons.map((button) => button.title)).toEqual(['/p/a/x/index.ts', '/p/b/x/index.ts', '/p/c/index.ts', '/p/a/x/index.ts']);
});

it('keeps the basename when repeated file references all name the same full path', async () => {
  const b = builder(); b.turn('u');
  b.toolUse('read', 'Read', { file_path: '/p/src/index.ts' }); b.result('read', 'old');
  b.toolUse('edit', 'Edit', { file_path: '/p/src/index.ts', old_string: 'old', new_string: 'new' }); b.result('edit', 'edited');
  b.toolUse('repeat', 'Read', { file_path: '/p/src/index.ts' }); b.result('repeat', 'new');
  b.end(['u']);
  const store = await storeWith(b.events); useTranscriptStore.getState().expandAll(store.key);
  const view = renderRow(rowOf(store.rows(), 'group'), { storeKey: store.key });
  expect([...view.container.querySelectorAll('.transcript-cell-label')].map((label) => label.textContent)).toEqual([
    'Read index.ts', 'Edited index.ts', 'Read index.ts',
  ]);
});

it.each([
  { name: 'additions only', old: '', next: 'new', cellCounts: '+1', groupCounts: '+2' },
  { name: 'removals only', old: 'old', next: '', cellCounts: '−1', groupCounts: '−2' },
  { name: 'both sides', old: 'old', next: 'new', cellCounts: '+1 −1', groupCounts: '+2 −2' },
  { name: 'no changed lines', old: '', next: '', cellCounts: null, groupCounts: null },
])('shows only nonzero cell and group line counts for $name', async ({ old, next, cellCounts, groupCounts }) => {
  const b = builder(); b.turn('u');
  b.toolUse('a', 'Edit', { file_path: '/p/a.ts', old_string: old, new_string: next }); b.result('a', 'done');
  b.toolUse('b', 'Edit', { file_path: '/p/b.ts', old_string: old, new_string: next }); b.result('b', 'done');
  b.end(['u']);
  const store = await storeWith(b.events); useTranscriptStore.getState().expandAll(store.key);
  const view = renderRow(rowOf(store.rows(), 'group'), { storeKey: store.key });
  expect([...view.container.querySelectorAll('.transcript-cell-line')].map((line) => line.querySelector('.transcript-counts')?.textContent ?? null)).toEqual([cellCounts, cellCounts]);
  expect(view.container.querySelector('.transcript-group-summary .transcript-counts')?.textContent ?? null).toBe(groupCounts);
});

it('shows the latest readable thinking line while retaining the full disclosure', async () => {
  const b = builder(); b.turn('u'); b.thinking('a', 0, 'First consideration\nLatest consideration');
  const store = await storeWith(b.events);
  const row = { ...rowOf(store.rows(), 'thinking'), live: true };
  const view = renderRow(row, { storeKey: store.key });
  const button = screen.getByRole('button', { name: /Latest consideration/ });
  expect(button.textContent).not.toContain('First consideration');
  fireEvent.click(button);
  expect(view.container.querySelector('.transcript-thinking-text')?.textContent).toBe('First consideration\nLatest consideration');
});

it('restores only after a dry run and a confirmation naming the engine’s files', async () => {
  const b = builder(); b.turn('u'); b.toolUse('edit', 'Edit', { file_path: '/p/a', old_string: 'a', new_string: 'b' }); b.result('edit', 'done'); b.end(['u']);
  const store = await storeWith(b.events);
  const rewind = { canUndo: vi.fn(async () => ({ ok: true, reason: null, files: ['/p/a', '/p/later-turn'] })), undo: vi.fn(async () => {}) };
  renderRow(rowOf(store.rows(), 'divider'), { storeKey: store.key, rewind });
  fireEvent.click(screen.getByRole('button', { name: 'Turn summary' }));
  fireEvent.click(screen.getByRole('button', { name: 'Restore files to before this turn' }));
  await screen.findByRole('dialog');
  expect(screen.getByRole('dialog').textContent).toContain('/p/later-turn');
  expect(rewind.undo).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Restore files' }));
  await vi.waitFor(() => expect(rewind.undo).toHaveBeenCalledOnce());
});

it('replays the recorded Edit and empty-patch Write without losing counts or content', async () => {
  const events = journalToEvents(loadJournal('pass1', 'p4/p4-tool-summaries-thinking-edits'));
  const store = await storeWith(events); useTranscriptStore.getState().expandAll(store.key);
  const cells = store.rows().flatMap((row) => row.kind === 'group' ? row.cells : row.kind === 'cell' ? [row] : []);
  expect(cells.filter((cell) => cell.detail.kind === 'edit').map((cell) => cell.detail)).toMatchObject([
    { kind: 'edit', added: 1, removed: 1, hunks: [{ lines: expect.arrayContaining(['-Status: pending', '+Status: ready']) }] },
    { kind: 'edit', added: 1, removed: 0, hunks: [{ lines: ['+Ready for review.'] }] },
  ]);
  expect(store.rows().some((row) => row.kind === 'receipt')).toBe(false);
});

it('replays empty signed thinking without inventing readable reasoning', async () => {
  const events = journalToEvents(loadJournal('pass1', 'p4/p4-tool-summaries-live'));
  const store = await storeWith(events); useTranscriptStore.getState().expandAll(store.key);
  expect(store.rows().filter((row) => row.kind === 'thinking')).toEqual([]);
});

it('updates a grouped thinking line from deltas without waiting for a structural row update', async () => {
  const b = builder(); b.turn('u');
  b.toolUse('read', 'Read', { file_path: '/p/memo' }); b.result('read', 'memo');
  // A pending tool keeps the thinking block inside its group, rather than the standalone after-work line.
  const delta = (text: string) => b.emit('assistant.block.delta', { apiMessageId: api('thinking'), blockIndex: 0, blockType: 'thinking', textDelta: null, thinkingDelta: text, inputJsonDelta: null, userMessageUuid: uuid('u') });
  delta('First thought');
  b.toolUse('pending', 'Read', { file_path: '/p/next' }); b.result('pending', 'next');
  const store = await storeWith([...b.events]);
  renderRow(rowOf(store.rows(), 'group'), { storeKey: store.key });
  expect(screen.getByRole('button', { name: 'First thought' })).toBeTruthy();
  const next = delta('\nNew consideration');
  store.push([next]);
  await screen.findByRole('button', { name: 'New consideration' });
});

it('does not restore when the dry run refuses, or when confirmation is cancelled', async () => {
  const b = builder(); b.turn('u'); b.toolUse('edit', 'Edit', { file_path: '/p/a', old_string: 'a', new_string: 'b' }); b.result('edit', 'done'); b.end(['u']);
  const store = await storeWith(b.events);
  const rewind = { canUndo: vi.fn(async () => ({ ok: false, reason: 'No checkpoint', files: ['/p/a'] })), undo: vi.fn(async () => {}) };
  renderRow(rowOf(store.rows(), 'divider'), { storeKey: store.key, rewind });
  fireEvent.click(screen.getByRole('button', { name: 'Turn summary' }));
  fireEvent.click(screen.getByRole('button', { name: 'Restore files to before this turn' }));
  expect((await screen.findByRole('alert')).textContent).toContain('No checkpoint');
  expect(rewind.undo).not.toHaveBeenCalled();
  rewind.canUndo.mockResolvedValue({ ok: true, reason: '', files: ['/p/a'] });
  fireEvent.click(screen.getByRole('button', { name: 'Restore files to before this turn' }));
  await screen.findByRole('dialog');
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(rewind.undo).not.toHaveBeenCalled();
});
