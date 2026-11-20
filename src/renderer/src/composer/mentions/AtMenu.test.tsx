// The `@` menu's files belong to the folder they were listed for (UX wave U8c-2, M4 decision 8): when the agent's folder
// changes, a list answered or in flight for the folder it left is never offered for the new one, whatever the query.
import { Editor, type JSONContent, type Range } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { PreloadBridge } from '@shared/ipc/schema';
import { fakeClient, type FakeClient } from '../../../../../test/support/fake-client';
import { at } from '../../../../../test/support/machine';
import { EMPTY_CATALOG } from '../../stores/catalog';
import { docOf, paragraph, textNode } from '../editor/doc';
import { schemaExtensions } from '../editor/schema';
import { AtMenu } from './AtMenu';
import type { PopupItem, PopupProps } from './popup';

const APP = at('app-1' as AppSessionId);
const KEY = new PluginKey('at-menu-test');

const props = (query: string, cwd: string): PopupProps => ({
  query,
  range: { from: 1, to: 1 + query.length } as Range,
  editor: {} as Editor,
  command: () => {},
  pluginKey: KEY,
  ctx: { appSessionId: APP, cwd, additionalDirectories: [], catalog: EMPTY_CATALOG, widgets: new Set(), openWidget: () => {}, searchesFiles: true },
});
const options = () => [...document.querySelectorAll('[role="option"]')].map((o) => [o.textContent, o.getAttribute('aria-disabled')]);
const files = (paths: string[]) => ({ paths, truncated: false, source: 'git' });

let fake: FakeClient;
beforeEach(() => {
  fake = fakeClient();
  window.maws = fake.client as unknown as PreloadBridge;
});
afterEach(() => {
  cleanup();
  delete (window as { maws?: PreloadBridge }).maws;
});

describe('the @ menu across a change of the agent’s folder', () => {
  it('offers a folder’s files only while that folder is the one asked about, for the same query', async () => {
    const view = render(<AtMenu {...props('sr', '/repo')} />);
    await waitFor(() => expect(fake.pending('git.lsFiles')).toBe(1));
    await act(() => fake.reply('git.lsFiles', files(['src/a.ts'])));
    expect(options()).toEqual([['src/a.ts', null]]);

    view.rerender(<AtMenu {...props('sr', '/repo/.claude/worktrees/w1')} />);
    expect(options()).toEqual([['Searching files…', 'true']]); // the launch folder's rows are gone at once
    await waitFor(() => expect(fake.pending('git.lsFiles')).toBe(1)); // the worktree's list, in flight

    view.rerender(<AtMenu {...props('sr', '/repo')} />); // back before it answers
    expect(options()).toEqual([['src/a.ts', null]]); // the launch folder's own list
    await waitFor(() => expect(fake.pending('git.lsFiles')).toBe(2));
    await act(() => fake.reply('git.lsFiles', files(['only-in-w1.ts']), 0)); // the worktree's answer, late
    expect(options()).toEqual([['src/a.ts', null]]);
    await act(() => fake.reply('git.lsFiles', files(['src/a.ts', 'src/b.ts']), 0));
    expect(options()).toEqual([['src/a.ts', null], ['src/b.ts', null]]);
    expect(fake.invoked('git.lsFiles').map((input) => (input as { directory: string }).directory)).toEqual(['/repo', '/repo/.claude/worktrees/w1', '/repo']);
  });
});

// board ticket 739: a name a model can write (a skill's) enters the draft as one line of literal text, never as markup the
// editor parses; a path that holds a control character, which no mention can name, is not offered
describe('what the @ menu puts in the draft', () => {
  const NAME = 'x<br>y<p>z</p>\nw';
  const lines = (editor: Editor) => (editor.getJSON().content ?? []).map((p: JSONContent) => (p.content ?? []).map((n: JSONContent) => (n.type === 'text' ? n.text : `[${n.type}]`)).join(''));

  it('a skill’s row puts /<name> at the start as one line of literal text', () => {
    const command = vi.fn<(item: PopupItem) => void>();
    render(<AtMenu {...props('', '')} command={command} ctx={{ ...props('', '').ctx, catalog: { ...EMPTY_CATALOG, skills: [NAME] } }} />);
    act(() => (document.querySelector('[role="option"]') as HTMLElement).click());
    const editor = new Editor({ extensions: schemaExtensions(), content: docOf([paragraph(textNode('see @'))]) });
    command.mock.calls[0]![0].apply(editor, { from: 5, to: 6 });
    expect(lines(editor)).toEqual(['/x<br>y<p>z</p>\ufffdw see ']);
    editor.destroy();
  });

  it('leaves out a path that holds a control character', async () => {
    render(<AtMenu {...props('sr', '/repo')} />);
    await waitFor(() => expect(fake.pending('git.lsFiles')).toBe(1));
    await act(() => fake.reply('git.lsFiles', files(['src/a.ts', 'src/b\nc.ts', 'src/d\u0085e.ts', 'src/f\u2028g.ts'])));
    expect(options()).toEqual([['src/a.ts', null]]);
  });
});
