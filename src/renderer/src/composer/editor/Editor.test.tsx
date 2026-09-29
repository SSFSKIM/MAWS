import { act, cleanup, render, waitFor } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import type { Draft } from '@shared/ipc/schema/session';
import { fakeClient } from '../../../../../test/support/fake-client';
import { connectKeys } from '../../keymap/dispatcher';
import { resetCatalogStore } from '../../stores/catalog';
import { prefillComposer, resetComposerStore } from '../../stores/composer';
import { docOf, hardBreak, paragraph, pastedNode, textNode } from './doc';
import { Editor, type DraftPort, type EditorHandle } from './Editor';
import type { Serialized } from './serialize';

const APP = 'app-1' as AppSessionId;

const client = {
  invoke: vi.fn(async (name: string) => (name === 'session.history.list' ? { ok: true, value: { entries: [] } } : { ok: false, error: { code: 'internal', message: 'no session' } })),
  on: () => () => {},
  pathForFile: () => '',
} as unknown as MawsBridge;

function drafts(initial: Draft | null) {
  const saved: (Draft | null)[] = [];
  const port: DraftPort = { load: async () => initial, save: (d) => void saved.push(d) };
  return { port, saved };
}

let disconnect: () => void;
beforeEach(() => {
  resetComposerStore();
  resetCatalogStore();
  disconnect = connectKeys();
});
afterEach(() => {
  disconnect();
  cleanup();
});

const contentOf = (container: HTMLElement) => container.querySelector('[contenteditable]') as HTMLElement;

describe('the editor mounts over its draft, takes prefills and submits through the dispatcher', () => {
  it('marks only its root as the composer key sink and restores the stored draft', async () => {
    const { port } = drafts({ doc: docOf([paragraph(textNode('left over'))]), attachments: [], updatedAt: '2026-09-29T00:00:00.000Z' });
    const handle = createRef<EditorHandle>();
    const { container } = render(<Editor appSessionId={APP} cwd="/repo" sessionId={null} drafts={port} client={client} handle={handle} />);
    await waitFor(() => expect(contentOf(container).textContent).toBe('left over'));
    const sinks = container.querySelectorAll('[data-key-sink]');
    expect(sinks).toHaveLength(1);
    expect(sinks[0].getAttribute('data-key-sink')).toBe('composer');
    expect(sinks[0].contains(contentOf(container))).toBe(true);
    expect(handle.current?.serialize().display).toBe('left over');
  });

  it('replaces the document with a prefill and hands it to the caller', async () => {
    const onPrefill = vi.fn();
    const { port, saved } = drafts(null);
    const handle = createRef<EditorHandle>();
    const { container } = render(<Editor appSessionId={APP} cwd="/repo" sessionId="s" drafts={port} client={client} handle={handle} onPrefill={onPrefill} />);
    act(() => prefillComposer(APP, { text: 'fix [Pasted text #1 +2 lines]', pasted: [{ name: 'Pasted text #1', text: 'a\nb' }], editing: null }));
    await waitFor(() => expect(onPrefill).toHaveBeenCalledTimes(1));
    expect(contentOf(container).textContent).toContain('fix');
    expect(handle.current?.serialize().pastedContents['1']?.content).toBe('a\nb');
    expect(saved).toEqual([]); // the write waits for the pause
  });

  it('sends on ⌘Enter from the editor through C5’s dispatcher, then clears and drops the draft', async () => {
    const onSubmit = vi.fn<(s: Serialized, how: 'send' | 'steer') => Promise<boolean>>(async () => true);
    const { port, saved } = drafts({ doc: docOf([paragraph(textNode('hello'))]), attachments: [], updatedAt: '2026-09-29T00:00:00.000Z' });
    const { container } = render(<Editor appSessionId={APP} cwd="/repo" sessionId={null} drafts={port} client={client} onSubmit={onSubmit} />);
    const content = contentOf(container);
    await waitFor(() => expect(content.textContent).toBe('hello'));
    content.focus();
    await act(async () => {
      content.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true, cancelable: true }));
    });
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ mode: 'send', content: 'hello', display: 'hello' });
    expect(onSubmit.mock.calls[0][1]).toBe('send');
    await waitFor(() => expect(content.textContent).toBe(''));
    expect(saved).toEqual([null]);
  });

  it('keeps the text when the submission is refused', async () => {
    const onSubmit = vi.fn(async () => false);
    const { port, saved } = drafts({ doc: docOf([paragraph(textNode('keep me'))]), attachments: [], updatedAt: '2026-09-29T00:00:00.000Z' });
    const { container } = render(<Editor appSessionId={APP} cwd="/repo" sessionId={null} drafts={port} client={client} onSubmit={onSubmit} />);
    const content = contentOf(container);
    await waitFor(() => expect(content.textContent).toBe('keep me'));
    content.focus();
    await act(async () => {
      content.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', altKey: true, bubbles: true, cancelable: true }));
    });
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ content: 'keep me' }), 'steer'));
    expect(content.textContent).toBe('keep me');
    expect(saved).toEqual([]);
  });

  it('sends on a plain Enter in a one-line document, and breaks the line with it once the document has more lines', async () => {
    const onSubmit = vi.fn<(s: Serialized, how: 'send' | 'steer') => Promise<boolean>>(async () => false);
    const multiline = docOf([paragraph(textNode('one'), hardBreak(), textNode('two'))]);
    const { port } = drafts({ doc: multiline, attachments: [], updatedAt: '2026-09-29T00:00:00.000Z' });
    const handle = createRef<EditorHandle>();
    const { container } = render(<Editor appSessionId={APP} cwd="/repo" sessionId={null} drafts={port} client={client} onSubmit={onSubmit} handle={handle} />);
    const content = contentOf(container);
    await waitFor(() => expect(handle.current?.serialize().display).toBe('one\ntwo'));
    content.focus();
    const enter = () => act(async () => void content.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
    await enter();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(handle.current?.doc().content).toHaveLength(2); // a new line, not a send
    act(() => handle.current?.clear());
    act(() => handle.current?.insertText('single'));
    await enter();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ content: 'single' }), 'send'));
  });

  it('treats an open @ popup with no rows as no popup: Enter sends', async () => {
    const onSubmit = vi.fn<(s: Serialized, how: 'send' | 'steer') => Promise<boolean>>(async () => false);
    const { port } = drafts(null);
    const handle = createRef<EditorHandle>();
    const { container } = render(<Editor appSessionId={APP} cwd="" sessionId={null} drafts={port} client={client} onSubmit={onSubmit} handle={handle} />);
    const content = contentOf(container);
    content.focus();
    act(() => handle.current?.insertText('see @zzz'));
    await waitFor(() => expect(document.querySelector('.react-renderer')).not.toBeNull()); // the @ popup is open, empty
    await act(async () => void content.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ content: 'see @zzz' }), 'send'));
    expect(handle.current?.doc().content).toHaveLength(1);
  });

  it('the @ menu holds Enter while its file search lags the query: never the half-typed token, never a stale row', async () => {
    const fake = fakeClient();
    window.maws = fake.client;
    try {
      const onSubmit = vi.fn<(s: Serialized, how: 'send' | 'steer') => Promise<boolean>>(async () => false);
      const { port } = drafts(null);
      const handle = createRef<EditorHandle>();
      const { container } = render(<Editor appSessionId={APP} cwd="/repo" sessionId={null} drafts={port} client={client} onSubmit={onSubmit} handle={handle} />);
      const content = contentOf(container);
      content.focus();
      const enter = () => act(async () => void content.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
      const options = () => [...document.querySelectorAll('[role="option"]')].map((o) => [o.textContent, o.getAttribute('aria-disabled')]);
      const answer = (paths: string[]) => act(() => fake.reply('git.lsFiles', { paths, truncated: false, source: 'git' }));

      act(() => handle.current?.insertText('see @sr'));
      await waitFor(() => expect(document.querySelector('.react-renderer')).not.toBeNull()); // the @ popup is open
      await enter(); // before the first answer
      expect(onSubmit).not.toHaveBeenCalled();
      expect(handle.current?.serialize().display).toBe('see @sr');
      expect(options()).toEqual([['Searching files…', 'true']]);
      await waitFor(() => expect(fake.pending('git.lsFiles')).toBe(1));
      await answer(['src/a.ts']);
      expect(options()).toEqual([['src/a.ts', null]]);

      act(() => handle.current?.insertText('c/b'));
      await enter(); // at once, before the menu has even rendered the new query
      expect(handle.current?.serialize().display).toBe('see @src/b'); // no stale row picked
      await waitFor(() => expect(options()).toEqual([['Searching files…', 'true']])); // the previous query's rows are gone
      await enter();
      expect(handle.current?.serialize().display).toBe('see @src/b');
      await waitFor(() => expect(fake.pending('git.lsFiles')).toBe(1));
      await answer(['src/b.ts']);
      await enter();
      expect(handle.current?.serialize().display).toBe('see @src/b.ts');
      expect(JSON.stringify(handle.current?.doc())).toContain('"id":"src/b.ts"'); // the chip, from the current query's row
      expect(onSubmit).not.toHaveBeenCalled();
      expect(fake.invoked('git.lsFiles')).toEqual([
        { directory: '/repo', query: 'sr', limit: 30 },
        { directory: '/repo', query: 'src/b', limit: 30 },
      ]);
    } finally {
      delete (window as { maws?: MawsBridge }).maws;
    }
  });

  it('a recalled bare slash command opens no palette: the arrows keep walking history and Enter sends', async () => {
    const entry = (display: string, at: string) => ({ display, at, source: 'maws', sessionId: null, pastedContents: {} });
    const history = [entry('/compact', '2026-09-29T09:01:00.000Z'), entry('hello', '2026-09-29T09:00:00.000Z')];
    const recalling = {
      ...client,
      invoke: vi.fn(async (name: string) => (name === 'session.history.list' ? { ok: true, value: { entries: history } } : { ok: false, error: { code: 'internal', message: 'no session' } })),
    } as unknown as MawsBridge;
    const onSubmit = vi.fn<(s: Serialized, how: 'send' | 'steer') => Promise<boolean>>(async () => false);
    const { port } = drafts(null);
    const handle = createRef<EditorHandle>();
    const { container } = render(<Editor appSessionId={APP} cwd="/repo" sessionId="s" drafts={port} client={recalling} onSubmit={onSubmit} handle={handle} />);
    const content = contentOf(container);
    await waitFor(() => expect(recalling.invoke).toHaveBeenCalledWith('session.history.list', expect.anything()));
    content.focus();
    const press = (key: string) => act(async () => void content.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })));
    await press('ArrowUp');
    expect(handle.current?.serialize().display).toBe('/compact');
    await new Promise((resolve) => requestAnimationFrame(resolve)); // past Tiptap's deferred focus
    expect(document.querySelector('[role="listbox"]')).toBeNull(); // no palette over the recalled entry
    await press('ArrowUp');
    expect(handle.current?.serialize().display).toBe('hello');
    await press('ArrowDown');
    expect(handle.current?.serialize().display).toBe('/compact');
    await press('Enter');
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ display: '/compact' }), 'send'));
  });

  it('numbers pasted chips in document order, as display and pastedContents do', async () => {
    const atom = (name: string, text: string) => pastedNode({ id: name, kind: 'text', name, lines: 1, text });
    const { port } = drafts({ doc: docOf([paragraph(atom('Pasted text #2', 'first'), textNode(' and '), atom('notes.txt', 'second'), atom('Pasted text #1', 'third'))]), attachments: [], updatedAt: '2026-09-29T00:00:00.000Z' });
    const handle = createRef<EditorHandle>();
    const { container } = render(<Editor appSessionId={APP} cwd="/repo" sessionId={null} drafts={port} client={client} handle={handle} />);
    await waitFor(() => expect(container.querySelectorAll('[data-pasted]')).toHaveLength(3));
    await waitFor(() => expect([...container.querySelectorAll('[data-pasted]')].map((el) => el.textContent)).toEqual(['Pasted text #1 +1 lines', 'notes.txt +1 lines', 'Pasted text #3 +1 lines']));
    expect(handle.current?.serialize().display).toBe('[Pasted text #1 +1 lines] and [Pasted text #2 +1 lines][Pasted text #3 +1 lines]');
  });

  it('carries the attachments with the document it restores, and drops them with the document it clears', async () => {
    const shot = { id: 'a1', kind: 'image' as const, name: 'shot.png', mediaType: 'image/png', bytes: 4, data: 'iVBO', persisted: true };
    const { port } = drafts({ doc: docOf([paragraph(textNode('look'))], [shot]), attachments: [], updatedAt: '2026-09-29T00:00:00.000Z' });
    const handle = createRef<EditorHandle>();
    render(<Editor appSessionId={APP} cwd="/repo" sessionId={null} drafts={port} client={client} handle={handle} />);
    await waitFor(() => expect(handle.current?.serialize().display).toBe('look [Image #1]'));
    act(() => handle.current?.clear());
    expect(handle.current?.serialize()).toMatchObject({ display: '', empty: true });
  });
});
