import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, expect, it, onTestFinished } from 'vitest';
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
  const more = screen.getByRole('button', { name: 'Show more' }); // the word cut (T19)
  expect(more.getAttribute('aria-expanded')).toBe('false');
  expect(view.container.querySelector('.transcript-shell-command')?.textContent).toBe(`$ ${command}`);
  fireEvent.click(more);
  expect(more.getAttribute('aria-expanded')).toBe('true');
});

// Board ticket 850, item 6: a standalone call's wrapper leaves no space of its own where what it holds draws nothing (a
// mod's answer that hides the call); the space above and below a call is the call's own line's, kept inside the wrapper.
// Board ticket 852: a lone finished call is its one line, read as its run of one, with a run's space.
it('a standalone call’s space is its line’s: the wrapper with nothing drawn in it takes no height of its own', async () => {
  const style = document.createElement('style');
  style.textContent = readFileSync(join(__dirname, '../transcript.css'), 'utf8');
  document.head.append(style);
  onTestFinished(() => style.remove());
  const b = builder(); b.turn('u'); b.toolUse('ls', 'Bash', { command: 'ls', description: 'List the files' }); b.result('ls', 'a.txt'); b.end(['u']);
  const store = await storeWith(b.events);
  useTranscriptStore.getState().expandAll(store.key);
  const view = renderRow(rowOf(store.rows(), 'cell'), { storeKey: store.key });
  const wrapper = view.container.querySelector<HTMLElement>('.transcript-standalone')!;
  const space = (element: Element) => { const s = getComputedStyle(element); return [s.paddingTop, s.paddingBottom, s.marginTop, s.marginBottom].map((value) => value || '0px'); }; // jsdom: '' where nothing is declared
  expect(space(wrapper)).toEqual(['0px', '0px', '0px', '0px']);
  expect(getComputedStyle(wrapper).display).toBe('flow-root'); // the line's margins stay inside the row the list measures
  expect(space(wrapper.querySelector('.transcript-cell')!)).toEqual(['0px', '0px', '1px', '6px']);
  wrapper.querySelector('.transcript-cell')!.remove(); // what a hiding answer leaves: nothing drawn
  expect(space(wrapper)).toEqual(['0px', '0px', '0px', '0px']);
});
