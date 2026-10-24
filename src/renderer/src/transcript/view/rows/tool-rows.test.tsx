import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { useTranscriptStore } from '../../../stores/transcript';
import { builder, tool } from '../../model/test-events';
import { cellId } from '../../model/keys';
import { renderRow, rowOf, storeWith } from './test-support';

afterEach(cleanup);

it('shows each call’s summary without exposing input or output until that call opens', async () => {
  const b = builder(); b.turn('u');
  b.toolUse('shell', 'Bash', { command: "python3 - <<'PY'\nprint('first')\nprint('second')\nPY", description: 'Check decimal parsing' });
  b.result('shell', 'first\nsecond');
  b.toolUse('skill', 'Skill', { skill: 'dataviz' }); b.result('skill', 'Loaded skill instructions');
  b.end(['u']);
  const store = await storeWith(b.events);
  useTranscriptStore.getState().expandAll(store.key);
  const view = renderRow(rowOf(store.rows(), 'group'), { storeKey: store.key });
  expect(screen.getByRole('button', { name: 'Checked decimal parsing' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Ran /dataviz' })).toBeTruthy();
  expect(view.container.textContent).not.toContain('python3');
  expect(view.container.textContent).not.toContain('Loaded skill instructions');
  fireEvent.click(screen.getByRole('button', { name: 'Checked decimal parsing' }));
  view.rerenderRow(rowOf(store.rows(), 'group'));
  expect(view.container.querySelector('.transcript-shell-command')?.textContent).toBe("$ python3 - <<'PY'\nprint('first')\nprint('second')\nPY");
  expect(view.container.textContent).toContain('first\nsecond');
  expect(view.container.textContent).not.toContain('Loaded skill instructions');
});

it('keeps consecutive reads individually inspectable', async () => {
  const b = builder(); b.turn('u');
  b.toolUse('a', 'Read', { file_path: '/p/one.ts' }); b.result('a', 'first file');
  b.toolUse('b', 'Read', { file_path: '/p/two.ts' }); b.result('b', 'second file'); b.end(['u']);
  const store = await storeWith(b.events); useTranscriptStore.getState().expandAll(store.key);
  expect(rowOf(store.rows(), 'group')?.cells.map((cell) => cell.toolUseId)).toEqual(['a', 'b']);
  const view = renderRow(rowOf(store.rows(), 'group'), { storeKey: store.key });
  expect(screen.getByRole('button', { name: 'Read one.ts' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Read two.ts' }));
  view.rerenderRow(rowOf(store.rows(), 'group'));
  expect(view.container.textContent).toContain('second file');
  expect(view.container.textContent).not.toContain('first file');
});

it('bounds a long multiline command behind Show more without losing the command', async () => {
  const command = ['python3 - <<\'PY\'', ...Array.from({ length: 12 }, (_, i) => `print(${i})`), 'PY'].join('\n');
  const b = builder(); b.turn('u'); b.toolUse('shell', 'Bash', { command, description: 'Print the sequence' }); b.result('shell', 'done'); b.end(['u']);
  const store = await storeWith(b.events);
  useTranscriptStore.getState().expandAll(store.key);
  useTranscriptStore.getState().toggleCell(store.key, cellId.tool(tool('shell')));
  const view = renderRow(rowOf(store.rows(), 'cell'), { storeKey: store.key });
  const more = screen.getByRole('button', { name: 'Show more command' });
  expect(more.getAttribute('aria-expanded')).toBe('false');
  expect(view.container.querySelector('.transcript-shell-command')?.textContent).toBe(`$ ${command}`);
  fireEvent.click(more);
  expect(more.getAttribute('aria-expanded')).toBe('true');
});
