import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { closeWidgetDialog, useWidgetDialog } from '../WidgetDialog'; // W3 (C6)
import type { Transaction } from '@tiptap/pm/state';
import { EditorView } from '@tiptap/pm/view';
import { createRef, type RefObject } from 'react';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge, PreloadBridge } from '@shared/ipc/schema';
import type { Draft } from '@shared/ipc/schema/session';
import { SETTINGS_DEFAULTS_V21 } from '@shared/settings/defaults';
import { fakeClient } from '../../../../../test/support/fake-client';
import { at, TEST_MACHINE } from '../../../../../test/support/machine';
import { connectKeys } from '../../keymap/dispatcher';
import { resetCatalogStore } from '../../stores/catalog';
import { prefillComposer, resetComposerStore, useComposerStore } from '../../stores/composer';
import { useSettings } from '../../stores/settings';
import { useNotices } from '../../stores/notices'; // E3
import { registerSlashWidget } from '../mentions/widgets'; // C11
import { attachmentsOf, docOf, hardBreak, paragraph, pastedNode, textNode } from './doc';
import { DRAFT_DELAY_MS } from './drafts';
import { Editor, type DraftPort, type EditorHandle } from './Editor';
import { UNAVAILABLE_TITLE } from './nodes/Pasted';
import type { Serialized } from './serialize';

const APP = at('app-1' as AppSessionId); // P5 O6 M2: the page's id; `client` is the page's client

const client = {
  localMachine: TEST_MACHINE,
  invoke: vi.fn(async (name: string) => (name === 'session.history.list' ? { ok: true, value: { entries: [] } } : { ok: false, error: { code: 'internal', message: 'no session' } })),
  on: () => () => {},
  pathForFile: () => '',
} as unknown as MawsBridge;

function drafts(initial: Draft | null) {
  const saved: (Draft | null)[] = [];
  const port: DraftPort = { load: async () => initial, save: async (d) => (saved.push(d), true) };
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
    act(() => prefillComposer(APP, { text: 'fix [Pasted text #1 +2 lines]', pasted: [{ name: 'Pasted text #1', text: 'a\nb' }] }));
    await waitFor(() => expect(onPrefill).toHaveBeenCalledTimes(1));
    expect(contentOf(container).textContent).toContain('fix');
    expect(handle.current?.serialize().pastedContents['1']?.content).toBe('a\nb');
    expect(saved).toEqual([]); // the write waits for the pause
  });

  it('submits on ⌘Enter from the editor through C5’s dispatcher, then clears and drops the draft', async () => {
    const onSubmit = vi.fn<(s: Serialized, when?: 'after') => Promise<boolean>>(async () => true);
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
    expect(onSubmit.mock.calls[0][1]).toBe('after'); // UX wave U4a: ⌘Enter keeps it for after a running turn
    await waitFor(() => expect(content.textContent).toBe(''));
    expect(saved).toEqual([null]);
  });

  // The hosted Macs, 2026-10-26 (c7's W2): the host's answer to a send can come after the person moved on. The editor
  // held the focus at the send, took it back when the answer came, and Tiptap's own focus a frame later took it again,
  // from the transcript row's Copy the person had focused meanwhile.
  it('leaves a focus moved elsewhere while the send was in flight where it is', async () => {
    let answer!: (accepted: boolean) => void;
    const onSubmit = vi.fn(() => new Promise<boolean>((resolve) => (answer = resolve)));
    const { port } = drafts({ doc: docOf([paragraph(textNode('hello'))]), attachments: [], updatedAt: '2026-09-29T00:00:00.000Z' });
    const { container } = render(
      <>
        <Editor appSessionId={APP} cwd="/repo" sessionId={null} drafts={port} client={client} onSubmit={onSubmit} />
        <button type="button">Copy</button>
      </>,
    );
    const content = contentOf(container);
    await waitFor(() => expect(content.textContent).toBe('hello'));
    content.focus();
    await act(async () => {
      content.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true, cancelable: true }));
    });
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const copy = container.querySelector('button')!;
    copy.focus();
    await act(async () => answer(true));
    await waitFor(() => expect(content.textContent).toBe(''));
    await new Promise((resolve) => requestAnimationFrame(resolve)); // past Tiptap's deferred focus
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(document.activeElement).toBe(copy);
  });

  it('keeps the caret in an editor that held the focus through the send', async () => {
    let answer!: (accepted: boolean) => void;
    const onSubmit = vi.fn(() => new Promise<boolean>((resolve) => (answer = resolve)));
    const { port } = drafts({ doc: docOf([paragraph(textNode('hello'))]), attachments: [], updatedAt: '2026-09-29T00:00:00.000Z' });
    const { container } = render(<Editor appSessionId={APP} cwd="/repo" sessionId={null} drafts={port} client={client} onSubmit={onSubmit} />);
    const content = contentOf(container);
    await waitFor(() => expect(content.textContent).toBe('hello'));
    content.focus();
    await act(async () => {
      content.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true, cancelable: true }));
    });
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    await act(async () => answer(true));
    await waitFor(() => expect(content.textContent).toBe(''));
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(content.contains(document.activeElement)).toBe(true);
  });

  it('takes the focus back when going read-only for the send left it on the page', async () => {
    let answer!: (accepted: boolean) => void;
    const onSubmit = vi.fn(() => new Promise<boolean>((resolve) => (answer = resolve)));
    const { port } = drafts({ doc: docOf([paragraph(textNode('hello'))]), attachments: [], updatedAt: '2026-09-29T00:00:00.000Z' });
    const { container } = render(<Editor appSessionId={APP} cwd="/repo" sessionId={null} drafts={port} client={client} onSubmit={onSubmit} />);
    const content = contentOf(container);
    await waitFor(() => expect(content.textContent).toBe('hello'));
    content.focus();
    await act(async () => {
      content.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true, cancelable: true }));
    });
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    content.blur(); // Chromium moves the focus off a contenteditable that stops being editable
    expect(document.activeElement).toBe(document.body);
    await act(async () => answer(true));
    await waitFor(() => expect(content.textContent).toBe(''));
    expect(content.contains(document.activeElement)).toBe(true);
  });

  // P5 O7 M8: a refused send keeps its text, and the keyboard with it (a greyed `!` left the person typing into nothing)
  it('takes the focus back when a refused send left it on the page, its text kept', async () => {
    let answer!: (accepted: boolean) => void;
    const onSubmit = vi.fn(() => new Promise<boolean>((resolve) => (answer = resolve)));
    const { port } = drafts({ doc: docOf([paragraph(textNode('hello'))]), attachments: [], updatedAt: '2026-09-29T00:00:00.000Z' });
    const { container } = render(<Editor appSessionId={APP} cwd="/repo" sessionId={null} drafts={port} client={client} onSubmit={onSubmit} />);
    const content = contentOf(container);
    await waitFor(() => expect(content.textContent).toBe('hello'));
    content.focus();
    await act(async () => {
      content.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true, cancelable: true }));
    });
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    content.blur();
    await act(async () => answer(false));
    await waitFor(() => expect(content.contains(document.activeElement)).toBe(true));
    expect(content.textContent).toBe('hello');
  });

  // The hosted Macs' sequence: the caret came back at once, and Tiptap's deferred focus, a frame that came 223 ms later,
  // took the focus back from the Copy the person had focused in between.
  it('leaves a focus moved in the frame after the caret came back where it is', async () => {
    let answer!: (accepted: boolean) => void;
    const onSubmit = vi.fn(() => new Promise<boolean>((resolve) => (answer = resolve)));
    const { port } = drafts({ doc: docOf([paragraph(textNode('hello'))]), attachments: [], updatedAt: '2026-09-29T00:00:00.000Z' });
    const { container } = render(
      <>
        <Editor appSessionId={APP} cwd="/repo" sessionId={null} drafts={port} client={client} onSubmit={onSubmit} />
        <button type="button">Copy</button>
      </>,
    );
    const content = contentOf(container);
    await waitFor(() => expect(content.textContent).toBe('hello'));
    content.focus();
    await act(async () => {
      content.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true, cancelable: true }));
    });
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    content.blur();
    const frames: FrameRequestCallback[] = []; // the next frame waits until the test runs it
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => frames.push(cb));
    try {
      await act(async () => answer(true));
      await waitFor(() => expect(content.textContent).toBe(''));
      expect(content.contains(document.activeElement)).toBe(true); // the caret is back at once
      const copy = container.querySelector('button')!;
      copy.focus(); // before the next frame
      for (const frame of frames.splice(0)) frame(performance.now());
      expect(document.activeElement).toBe(copy);
    } finally {
      raf.mockRestore();
    }
  });

  // The review of the focus change: ProseMirror scrolls only to a selection inside the editor, so a caret placed while
  // another control held the focus (a transcript row's Edit) is scrolled to once the editor has the focus.
  it('scrolls to a prefill’s caret with the editor focused', async () => {
    const original = EditorView.prototype.dispatch;
    const scrolls: boolean[] = []; // for each transaction asking to scroll to the selection: whether the editor had the focus
    const dispatch = vi.spyOn(EditorView.prototype, 'dispatch').mockImplementation(function (this: EditorView, tr: Transaction) {
      if (tr.scrolledIntoView) scrolls.push(this.hasFocus());
      original.call(this, tr);
    });
    try {
      const onPrefill = vi.fn();
      const { port } = drafts(null);
      const { container } = render(
        <>
          <Editor appSessionId={APP} cwd="/repo" sessionId="s" drafts={port} client={client} onPrefill={onPrefill} />
          <button type="button">Edit</button>
        </>,
      );
      container.querySelector('button')!.focus();
      act(() => prefillComposer(APP, { text: Array.from({ length: 50 }, (_, i) => `line ${i + 1}`).join('\n'), pasted: [] }));
      await waitFor(() => expect(onPrefill).toHaveBeenCalledTimes(1));
      expect(contentOf(container).contains(document.activeElement)).toBe(true);
      expect(scrolls).toContain(true);
    } finally {
      dispatch.mockRestore();
    }
  });

  it('keeps the text when the submission is refused', async () => {
    const onSubmit = vi.fn(async () => false);
    const { port, saved } = drafts({ doc: docOf([paragraph(textNode('keep me'))]), attachments: [], updatedAt: '2026-09-29T00:00:00.000Z' });
    const { container } = render(<Editor appSessionId={APP} cwd="/repo" sessionId={null} drafts={port} client={client} onSubmit={onSubmit} />);
    const content = contentOf(container);
    await waitFor(() => expect(content.textContent).toBe('keep me'));
    content.focus();
    await act(async () => {
      content.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true, cancelable: true }));
    });
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ content: 'keep me' }), 'after'));
    expect(content.textContent).toBe('keep me');
    expect(saved).toEqual([]);
  });

  // UX wave U4a (l3-input-08): Enter sends whatever the line count; Shift+Enter and ⌥Enter break the line
  it('sends a three-line draft on a plain Enter; Shift+Enter and ⌥Enter each break the line and send nothing; a composing Enter sends nothing', async () => {
    const onSubmit = vi.fn<(s: Serialized, when?: 'after') => Promise<boolean>>(async () => false);
    const threeLines = docOf([paragraph(textNode('one'), hardBreak(), textNode('two'), hardBreak(), textNode('three'))]);
    const { port } = drafts({ doc: threeLines, attachments: [], updatedAt: '2026-09-29T00:00:00.000Z' });
    const handle = createRef<EditorHandle>();
    const { container } = render(<Editor appSessionId={APP} cwd="/repo" sessionId={null} drafts={port} client={client} onSubmit={onSubmit} handle={handle} />);
    const content = contentOf(container);
    await waitFor(() => expect(handle.current?.serialize().display).toBe('one\ntwo\nthree'));
    content.focus();
    const press = (init: KeyboardEventInit) => act(async () => void content.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...init })));
    await press({ shiftKey: true });
    await press({ altKey: true });
    const breaks = () => (handle.current?.doc().content?.[0]?.content ?? []).filter((node) => node.type === 'hardBreak').length;
    expect(breaks()).toBe(4); // two line breaks added, in the one paragraph
    expect(handle.current?.doc().content).toHaveLength(1);
    await press({ isComposing: true });
    await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 20))));
    expect(onSubmit).not.toHaveBeenCalled();
    await press({});
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]).toEqual([expect.objectContaining({ mode: 'send' })]); // Enter names no `when`
    expect(onSubmit.mock.calls[0]![0].display).toMatch(/one[\s\S]*two[\s\S]*three/);
  });

  // UX wave U4a (l3-input-03): ⌘Enter is `composer.queue`, which submits as Enter does with `when: 'after'`
  it('submits on ⌘Enter with when: after, and the handle’s submit as Enter does', async () => {
    const onSubmit = vi.fn<(s: Serialized, when?: 'after') => Promise<boolean>>(async () => false);
    const { port } = drafts({ doc: docOf([paragraph(textNode('later'))]), attachments: [], updatedAt: '2026-09-29T00:00:00.000Z' });
    const handle = createRef<EditorHandle>();
    const { container } = render(<Editor appSessionId={APP} cwd="/repo" sessionId={null} drafts={port} client={client} onSubmit={onSubmit} handle={handle} />);
    const content = contentOf(container);
    await waitFor(() => expect(content.textContent).toBe('later'));
    content.focus();
    await act(async () => void content.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true, cancelable: true })));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]).toEqual([expect.objectContaining({ content: 'later' }), 'after']);
    expect(content.textContent).toBe('later'); // refused: kept
    act(() => handle.current?.submit());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    expect(onSubmit.mock.calls[1]).toEqual([expect.objectContaining({ content: 'later' })]);
    act(() => handle.current?.submit('after'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(3));
    expect(onSubmit.mock.calls[2]![1]).toBe('after');
  });

  // UX wave U4a (review): a stored binding takes ⌘Enter from `composer.queue` and the holder has no key in this editor
  it('does nothing on a ⌘Enter the queue row yielded: no send, no line break', async () => {
    act(() => useSettings.setState({ state: { settings: { ...SETTINGS_DEFAULTS_V21, keymap: { 'composer.cycleMode': 'Cmd+Enter' } }, resolvedTheme: 'light' } }));
    try {
      const onSubmit = vi.fn<(s: Serialized, when?: 'after') => Promise<boolean>>(async () => true);
      const { port } = drafts({ doc: docOf([paragraph(textNode('kept'))]), attachments: [], updatedAt: '2026-09-29T00:00:00.000Z' });
      const handle = createRef<EditorHandle>();
      const { container } = render(<Editor appSessionId={APP} cwd="/repo" sessionId={null} drafts={port} client={client} onSubmit={onSubmit} handle={handle} />);
      const content = contentOf(container);
      await waitFor(() => expect(content.textContent).toBe('kept'));
      content.focus();
      // ProseMirror reads Mod as ⌘ only where navigator.platform names a Mac, which jsdom's does not: both chords are
      // pressed, so the case holds wherever it runs
      await act(async () => void content.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true, cancelable: true })));
      await act(async () => void content.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true })));
      await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 20))));
      expect(onSubmit).not.toHaveBeenCalled();
      expect(handle.current?.doc().content?.[0]?.content?.some((node) => node.type === 'hardBreak')).toBe(false);
      await act(async () => void content.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true })));
      expect(handle.current?.doc().content?.[0]?.content?.some((node) => node.type === 'hardBreak')).toBe(true); // Shift+Enter still breaks
    } finally {
      useSettings.setState({ state: null });
    }
  });

  it('treats an open @ popup with no rows as no popup: Enter sends', async () => {
    const onSubmit = vi.fn<(s: Serialized) => Promise<boolean>>(async () => false);
    const { port } = drafts(null);
    const handle = createRef<EditorHandle>();
    const { container } = render(<Editor appSessionId={APP} cwd="" sessionId={null} drafts={port} client={client} onSubmit={onSubmit} handle={handle} />);
    const content = contentOf(container);
    content.focus();
    act(() => handle.current?.insertText('see @zzz'));
    await waitFor(() => expect(document.querySelector('.react-renderer')).not.toBeNull()); // the @ popup is open, empty
    await act(async () => void content.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ content: 'see @zzz' })));
    expect(handle.current?.doc().content).toHaveLength(1);
  });

  it('the @ menu holds Enter while its file search lags the query: never the half-typed token, never a stale row', async () => {
    const fake = fakeClient();
    window.maws = fake.client as unknown as PreloadBridge; // main's side
    try {
      const onSubmit = vi.fn<(s: Serialized) => Promise<boolean>>(async () => false);
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
      delete (window as { maws?: PreloadBridge }).maws;
    }
  });

  it('a recalled bare slash command opens no palette: the arrows keep walking history and Enter sends', async () => {
    const entry = (display: string, at: string) => ({ display, at, source: 'maws', sessionId: null, pastedContents: {} });
    const history = [entry('/compact', '2026-09-29T09:01:00.000Z'), entry('hello', '2026-09-29T09:00:00.000Z')];
    const recalling = {
      ...client,
      invoke: vi.fn(async (name: string) => (name === 'session.history.list' ? { ok: true, value: { entries: history } } : { ok: false, error: { code: 'internal', message: 'no session' } })),
    } as unknown as MawsBridge;
    const onSubmit = vi.fn<(s: Serialized) => Promise<boolean>>(async () => false);
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
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ display: '/compact' })));
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

// C11 start: the widget seam C11 added to the editor (C11 execution document, the Arguments rule; Decision (M2) item 11):
// a typed `/<name> <args>` for a registered widget opens it with its argument, and the handle opens one with an argument.
describe('a registered widget named at Enter opens with its argument', () => {
  // W3 (C6): a widget opens as the app's floating dialog, never in the box: what the dialog host was asked to show
  const opened = (container: HTMLElement) => {
    expect(container.querySelector('[data-test-widget]'), 'nothing in the box').toBeNull();
    const open = useWidgetDialog.getState().open;
    return open ? `${open.name}:${open.args}` : null;
  };
  let off: () => void;
  beforeEach(() => {
    closeWidgetDialog();
    const offs = (['model', 'compact'] as const).map((name) =>
      registerSlashWidget(name, { title: name, component: ({ args }: { args: string }) => <p data-test-widget>{`${name}:${args}`}</p> }),
    );
    off = () => offs.forEach((o) => o());
  });
  afterEach(() => off());

  const enter = (content: HTMLElement) => act(async () => void content.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));

  it('opens the widget with the typed argument in place of sending, and clears the document and its draft', async () => {
    const onSubmit = vi.fn(async () => true);
    const { port, saved } = drafts({ doc: docOf([paragraph(textNode('/model haiku'))]), attachments: [], updatedAt: '2026-09-29T00:00:00.000Z' });
    const handle = createRef<EditorHandle>();
    const { container } = render(<Editor appSessionId={APP} cwd="/repo" sessionId={null} drafts={port} client={client} onSubmit={onSubmit} handle={handle} />);
    const content = contentOf(container);
    await waitFor(() => expect(content.textContent).toBe('/model haiku'));
    content.focus();
    await enter(content);
    await waitFor(() => expect(opened(container)).toBe('model:haiku'));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(handle.current?.serialize().empty).toBe(true);
    expect(saved).toEqual([null]);
  });

  it('keeps the whole rest of the line as the argument, and none when only the name is typed', async () => {
    const { port } = drafts({ doc: docOf([paragraph(textNode('/compact focus on tests'))]), attachments: [], updatedAt: '2026-09-29T00:00:00.000Z' });
    const handle = createRef<EditorHandle>();
    const { container } = render(<Editor appSessionId={APP} cwd="/repo" sessionId={null} drafts={port} client={client} onSubmit={vi.fn(async () => true)} handle={handle} />);
    const content = contentOf(container);
    await waitFor(() => expect(content.textContent).toBe('/compact focus on tests'));
    content.focus();
    await enter(content);
    await waitFor(() => expect(opened(container)).toBe('compact:focus on tests'));
    act(() => handle.current?.insertText('/model'));
    await enter(content);
    await waitFor(() => expect(opened(container)).toBe('model:'));
  });

  it('sends a command no widget is registered for, as before', async () => {
    const onSubmit = vi.fn(async () => true);
    const { port } = drafts({ doc: docOf([paragraph(textNode('/review the diff'))]), attachments: [], updatedAt: '2026-09-29T00:00:00.000Z' });
    const { container } = render(<Editor appSessionId={APP} cwd="/repo" sessionId={null} drafts={port} client={client} onSubmit={onSubmit} />);
    const content = contentOf(container);
    await waitFor(() => expect(content.textContent).toBe('/review the diff'));
    content.focus();
    await enter(content);
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ display: '/review the diff' })));
    expect(opened(container)).toBeNull();
  });

  it('sends a multi-line draft that starts with a widget name as text: nothing after the first line is lost', async () => {
    const onSubmit = vi.fn(async () => true);
    const { port } = drafts({ doc: docOf([paragraph(textNode('/model haiku'), hardBreak(), textNode('and the rest of the note'))]), attachments: [], updatedAt: '2026-09-29T00:00:00.000Z' });
    const handle = createRef<EditorHandle>();
    const { container } = render(<Editor appSessionId={APP} cwd="/repo" sessionId={null} drafts={port} client={client} onSubmit={onSubmit} handle={handle} />);
    await waitFor(() => expect(handle.current?.serialize().display).toBe('/model haiku\nand the rest of the note'));
    act(() => handle.current?.submit()); // ⌘Enter's path: a multi-line document never sends on a plain Enter
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ display: '/model haiku\nand the rest of the note' })));
    expect(opened(container)).toBeNull();
  });

  // The architect's correction (2026-09-29): an argument the widget resolves applies with no widget shown.
  it('hands a typed argument to the widget’s apply first: applied, nothing opens; not applied, the widget opens with it', async () => {
    const apply = vi.fn(async (_id: string, args: string) => args === 'opus');
    const offApply = registerSlashWidget('effort', { title: 'effort', component: ({ args }: { args: string }) => <p data-test-widget>{`effort:${args}`}</p>, apply });
    const onSubmit = vi.fn(async () => true);
    const { port } = drafts({ doc: docOf([paragraph(textNode('/effort opus'))]), attachments: [], updatedAt: '2026-09-29T00:00:00.000Z' });
    const handle = createRef<EditorHandle>();
    const { container } = render(<Editor appSessionId={APP} cwd="/repo" sessionId={null} drafts={port} client={client} onSubmit={onSubmit} handle={handle} />);
    const content = contentOf(container);
    await waitFor(() => expect(content.textContent).toBe('/effort opus'));
    content.focus();
    await enter(content);
    await waitFor(() => expect(apply).toHaveBeenCalledWith(APP, 'opus', expect.any(AbortSignal)));
    expect(opened(container), 'applied: no widget').toBeNull();
    expect(handle.current?.serialize().empty).toBe(true);
    expect(onSubmit).not.toHaveBeenCalled();

    act(() => handle.current?.insertText('/effort extreme'));
    await enter(content);
    await waitFor(() => expect(opened(container)).toBe('effort:extreme'));
    expect(apply).toHaveBeenLastCalledWith(APP, 'extreme', expect.any(AbortSignal));

    act(() => handle.current?.insertText('/effort'));
    apply.mockClear();
    await enter(content);
    await waitFor(() => expect(opened(container)).toBe('effort:'));
    expect(apply, 'no argument: the widget opens as built').not.toHaveBeenCalled();
    offApply();
  });

  // C11 start (M4 fix wave re-review, carried Minor): the draft is gone at Enter, so a decision that takes long (a catalogue
  // read, up to its 8 s bound) must not leave nothing on screen and then open the widget late over new typing: the editor
  // opens it after a short bound and tells `apply` it is too late to apply.
  it("opens the widget when apply has not decided within the bound, and signals apply that it is too late", async () => {
    let signal: AbortSignal | null = null;
    let decide: (applied: boolean) => void = () => {};
    const apply = vi.fn((_id: string, _args: string, given?: AbortSignal) => {
      signal = given ?? null;
      return new Promise<boolean>((resolve) => (decide = resolve));
    });
    const offApply = registerSlashWidget('effort', { title: 'effort', component: ({ args }: { args: string }) => <p data-test-widget>{`effort:${args}`}</p>, apply });
    const { port } = drafts({ doc: docOf([paragraph(textNode('/effort high'))]), attachments: [], updatedAt: '2026-09-29T00:00:00.000Z' });
    const { container } = render(<Editor appSessionId={APP} cwd="/repo" sessionId={null} drafts={port} client={client} onSubmit={vi.fn(async () => true)} />);
    const content = contentOf(container);
    await waitFor(() => expect(content.textContent).toBe('/effort high'));
    content.focus();
    await enter(content);
    expect(opened(container), 'undecided: nothing yet').toBeNull();
    await waitFor(() => expect(opened(container)).toBe('effort:high'), { timeout: 1_000 });
    expect(signal!.aborted, 'apply is told the editor stopped waiting').toBe(true);
    await act(async () => decide(false)); // a late answer opens nothing a second time
    expect(opened(container)).toBe('effort:high');
    offApply();
  });
  // C11 end

  it('opens a widget through the handle with an argument', async () => {
    const handle = createRef<EditorHandle>();
    const { container } = render(<Editor appSessionId={APP} cwd="/repo" sessionId={null} drafts={drafts(null).port} client={client} handle={handle} />);
    act(() => void handle.current?.openWidget('compact', 'keep the plan'));
    await waitFor(() => expect(opened(container)).toBe('compact:keep the plan'));
    expect(handle.current?.openWidget('status', '')).toBe(false); // none registered for it
  });
});
// C11 end


describe('draft and submission races', () => {
  it.each(['clear', 'send'])('does not restore an old draft after the user chose to %s while loading', async (action) => {
    let loaded!: (draft: Draft | null) => void;
    const port: DraftPort = { load: () => new Promise((resolve) => { loaded = resolve; }), save: vi.fn(async () => true) };
    const handle = createRef<EditorHandle>();
    render(<Editor appSessionId={APP} cwd="/repo" sessionId="s" drafts={port} client={client} handle={handle} onSubmit={async () => true} />);
    act(() => handle.current!.insertText('new thought'));
    await act(async () => { if (action === 'clear') handle.current!.clear(); else handle.current!.submit(); });
    expect(handle.current!.serialize().empty).toBe(true);
    await act(async () => loaded({ doc: docOf([paragraph(textNode('old thought'))]), attachments: [], updatedAt: '2026-10-02T00:00:00.000Z' }));
    expect(handle.current!.serialize().empty).toBe(true);
  });

  it('refuses picked attachments while a submission is pending', async () => {
    let answer!: (accepted: boolean) => void;
    const onSubmit = vi.fn(() => new Promise<boolean>((resolve) => { answer = resolve; }));
    const { port } = drafts(null);
    const handle = createRef<EditorHandle>();
    render(<Editor appSessionId={APP} cwd="/repo" sessionId="s" drafts={port} client={client} handle={handle} onSubmit={onSubmit} />);
    await act(async () => handle.current!.insertText('send me'));
    await act(async () => handle.current!.submit());
    await act(async () => handle.current!.attachPicked([{ path: '/repo/late.pdf', name: 'late.pdf', mediaType: 'application/pdf', bytes: 3, data: 'YWJj' }]));
    expect(handle.current!.doc().attrs?.attachments).toEqual([]);
    await act(async () => answer(true));
    expect(handle.current!.serialize().empty).toBe(true);
  });

  it.each([true, false])('owns a pending submission across tab remounts (accepted=%s)', async (accepted) => {
    let answer!: (accepted: boolean) => void;
    const onSubmit = vi.fn(() => new Promise<boolean>((resolve) => { answer = resolve; }));
    let stored: Draft | null = { doc: docOf([paragraph(textNode('send once'))]), attachments: [], updatedAt: '2026-10-02T00:00:00.000Z' };
    const port: DraftPort = { load: async () => stored, save: async (draft) => { stored = draft; return true; } };
    const handle = createRef<EditorHandle>();
    const view = () => <Editor appSessionId={APP} cwd="/repo" sessionId="s" drafts={port} client={client} handle={handle} onSubmit={onSubmit} />;
    const first = render(view());
    await waitFor(() => expect(handle.current!.serialize().display).toBe('send once'));
    await act(async () => handle.current!.submit());
    first.unmount();
    const second = render(view());
    await waitFor(() => expect(handle.current!.serialize().display).toBe('send once'));
    await act(async () => handle.current!.submit());
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(contentOf(second.container).getAttribute('contenteditable')).toBe('false');
    await act(async () => answer(accepted));
    expect(handle.current!.serialize().display).toBe(accepted ? '' : 'send once');
    expect(contentOf(second.container).getAttribute('contenteditable')).toBe('true');
    if (accepted) expect(stored).toBeNull();
  });
});


it.each([false, true])('ignores a PDF read started before submission that finishes after acceptance=%s', async (finishSendFirst) => {
  let answer!: (accepted: boolean) => void;
  let read!: (bytes: ArrayBuffer) => void;
  const file = new File(['abc'], 'late.pdf', { type: 'application/pdf' });
  vi.spyOn(file, 'arrayBuffer').mockImplementation(() => new Promise((resolve) => { read = resolve; }));
  const onSubmit = vi.fn(() => new Promise<boolean>((resolve) => { answer = resolve; }));
  const { port } = drafts(null);
  const handle = createRef<EditorHandle>();
  const { container } = render(<Editor appSessionId={APP} cwd="/repo" sessionId="s" drafts={port} client={client} handle={handle} onSubmit={onSubmit} />);
  await act(async () => handle.current!.insertText('send me'));
  fireEvent.drop(container.querySelector('[data-key-sink]')!, { dataTransfer: { files: [file] } });
  expect(file.arrayBuffer).toHaveBeenCalledOnce();
  await act(async () => handle.current!.submit());
  if (finishSendFirst) await act(async () => answer(true));
  await act(async () => read(new Uint8Array([97, 98, 99]).buffer));
  expect(handle.current!.doc().attrs?.attachments).toEqual([]);
  if (!finishSendFirst) await act(async () => answer(true));
  expect(handle.current!.serialize().empty).toBe(true);
});

// P3-G (the M4 review's concern 2): Mark-up's label is inserted `separated`: after a word it gets one space first, never
// joining it; at the start, after whitespace or after a line break it is inserted as it is.
describe('insertText separated', () => {
  const label = 'Mark-up of "Page A" — http://127.0.0.1/a.html ';
  it.each([
    ['draft text ending without a space', [paragraph(textNode('keep this thought'))], `keep this thought ${label}`],
    ['draft text ending with a space', [paragraph(textNode('keep this thought '))], `keep this thought ${label}`],
    ['an empty draft', [paragraph()], label],
    ['a line break', [paragraph(textNode('first'), hardBreak())], `first\n${label}`],
  ])('after %s', async (_, content, expected) => {
    const handle = createRef<EditorHandle>();
    render(<Editor appSessionId={APP} cwd="/repo" sessionId="s" drafts={drafts({ doc: docOf(content), attachments: [], updatedAt: '2026-10-13T00:00:00.000Z' }).port} client={client} handle={handle} />);
    await act(async () => {});
    act(() => handle.current!.insertText(label, { separated: true }));
    expect(handle.current!.serialize().display).toBe(expected.trimEnd()); // the display drops the label's trailing space
  });

  it('leaves text inserted without the option as it was (C11’s insertComposerText)', async () => {
    const handle = createRef<EditorHandle>();
    render(<Editor appSessionId={APP} cwd="/repo" sessionId="s" drafts={drafts({ doc: docOf([paragraph(textNode('one'))]), attachments: [], updatedAt: '2026-10-13T00:00:00.000Z' }).port} client={client} handle={handle} />);
    await act(async () => {});
    act(() => handle.current!.insertText('two'));
    expect(handle.current!.serialize().display).toBe('onetwo');
  });
});

describe('no-op Enter retains pending draft work', () => {
  it('restores a stored draft after empty Enter during loading', async () => {
    let loaded!: (draft: Draft | null) => void;
    const port: DraftPort = { load: () => new Promise((resolve) => { loaded = resolve; }), save: vi.fn(async () => true) };
    const handle = createRef<EditorHandle>();
    const onSubmit = vi.fn(async () => true);
    const { container } = render(<Editor appSessionId={APP} cwd="/repo" sessionId="s" drafts={port} client={client} handle={handle} onSubmit={onSubmit} />);
    fireEvent.keyDown(contentOf(container), { key: 'Enter' });
    expect(onSubmit).not.toHaveBeenCalled();
    await act(async () => loaded({ doc: docOf([paragraph(textNode('stored thought'))]), attachments: [], updatedAt: '2026-10-02T00:00:00.000Z' }));
    expect(handle.current!.serialize().display).toBe('stored thought');
  });

  it('keeps a PDF read that finishes after empty Enter', async () => {
    let read!: (bytes: ArrayBuffer) => void;
    const file = new File(['abc'], 'pending.pdf', { type: 'application/pdf' });
    vi.spyOn(file, 'arrayBuffer').mockImplementation(() => new Promise((resolve) => { read = resolve; }));
    const handle = createRef<EditorHandle>();
    const onSubmit = vi.fn(async () => true);
    const { container } = render(<Editor appSessionId={APP} cwd="/repo" sessionId="s" drafts={drafts(null).port} client={client} handle={handle} onSubmit={onSubmit} />);
    fireEvent.drop(container.querySelector('[data-key-sink]')!, { dataTransfer: { files: [file] } });
    expect(file.arrayBuffer).toHaveBeenCalledOnce();
    fireEvent.keyDown(contentOf(container), { key: 'Enter' });
    await act(async () => read(new Uint8Array([97, 98, 99]).buffer));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(handle.current!.doc().attrs?.attachments).toEqual([expect.objectContaining({ name: 'pending.pdf', data: 'YWJj' })]);
  });
});

it.each([
  [true, 'mounted'], [false, 'mounted'],
  [true, 'remounted'], [false, 'remounted'],
  [true, 'unmounted'], [false, 'unmounted'],
] as const)('defers a prefill through submission acceptance=%s while %s and persists it', async (accepted, lifecycle) => {
  let answer!: (accepted: boolean) => void;
  const onSubmit = vi.fn(() => new Promise<boolean>((resolve) => { answer = resolve; }));
  const onPrefill = vi.fn();
  let stored: Draft | null = null;
  const port: DraftPort = { load: async () => stored, save: async (draft) => { stored = draft; return true; } };
  const handle = createRef<EditorHandle>();
  const view = () => <Editor appSessionId={APP} cwd="/repo" sessionId="s" drafts={port} client={client} handle={handle} onSubmit={onSubmit} onPrefill={onPrefill} />;
  let mounted = render(view());
  await act(async () => handle.current!.insertText('original submission'));
  act(() => {
    handle.current!.submit();
    expect(onSubmit).toHaveBeenCalledOnce(); // C10 must acquire its start gate synchronously.
  });
  const prefill = { text: 'incoming edit' };
  act(() => prefillComposer(APP, prefill));
  const whilePending = handle.current!.serialize().display;
  const queued = useComposerStore.getState().prefills.get(APP);
  if (lifecycle !== 'mounted') mounted.unmount();
  if (lifecycle === 'remounted') mounted = render(view());
  const takenBeforeCompletion = onPrefill.mock.calls.length;
  await act(async () => answer(accepted));
  if (lifecycle === 'unmounted') mounted = render(view());
  await act(async () => {});
  const afterCompletion = handle.current!.serialize().display;
  mounted.unmount(); // Flush the replacement draft, then prove persistence on another mount.
  render(view());
  await act(async () => {});
  expect(whilePending).toBe('original submission');
  expect(queued).toEqual(prefill);
  expect(takenBeforeCompletion).toBe(0);
  expect(afterCompletion).toBe('incoming edit');
  expect(handle.current!.serialize().display).toBe('incoming edit');
  expect(onPrefill).toHaveBeenCalledExactlyOnceWith(prefill);
  expect(useComposerStore.getState().prefills.has(APP)).toBe(false);
});
// R2: the engine's prompt requests on a plugin's behalf read and fill the box through the handle, and a plugin's
// suggestion is the empty box's placeholder until Tab takes it
// R2/F11 seam: prompt access obeys the session-owned lock and edit revisions.
it.each(['replace', 'append', 'insert'] as const)('refuses a plugin %s during submission, including after remount', async (mode) => {
  let answer!: (accepted: boolean) => void;
  const onSubmit = vi.fn(() => new Promise<boolean>((resolve) => { answer = resolve; }));
  const handle = createRef<EditorHandle>();
  const { port } = drafts(null);
  const view = () => <Editor appSessionId={APP} cwd="/repo" sessionId="s" drafts={port} client={client} handle={handle} onSubmit={onSubmit} />;
  const first = render(view());
  await act(async () => handle.current!.insertText('locked submission'));
  act(() => handle.current!.submit());
  let filled: unknown;
  act(() => { filled = handle.current!.fill('plugin edit', mode); });
  const pendingText = handle.current!.promptBox().text;
  first.unmount();
  render(view());
  let remountedFill: unknown;
  act(() => { remountedFill = handle.current!.fill('plugin edit', mode); });
  const remountedText = handle.current!.promptBox().text;
  await act(async () => answer(false));
  expect(pendingText).toBe('locked submission');
  expect(remountedText).toBe('locked submission');
  expect(filled).toBe(false);
  expect(remountedFill).toBe(false);
  expect(handle.current!.promptBox().text).toBe('locked submission');
  act(() => { filled = handle.current!.fill('allowed edit', mode); });
  expect(filled).toBe(true);
  expect(handle.current!.promptBox().text).toContain('allowed edit');
});

it('treats a plugin fill to empty as an edit that invalidates pending restoration', async () => {
  let loaded!: (draft: Draft | null) => void;
  const port: DraftPort = { load: () => new Promise((resolve) => { loaded = resolve; }), save: vi.fn(async () => true) };
  const handle = createRef<EditorHandle>();
  render(<Editor appSessionId={APP} cwd="/repo" sessionId="s" drafts={port} client={client} handle={handle} />);
  act(() => handle.current!.fill('', 'replace'));
  await act(async () => loaded({ doc: docOf([paragraph(textNode('old draft'))]), attachments: [], updatedAt: '2026-10-02T00:00:00.000Z' }));
  expect(handle.current!.serialize().empty).toBe(true);
});

it('clears a plugin suggestion when a send is accepted', async () => {
  const handle = createRef<EditorHandle>();
  const taken = vi.fn();
  render(<Editor appSessionId={APP} cwd="/repo" sessionId="s" drafts={drafts(null).port} client={client} handle={handle} suggestion="try this next" onSuggestionTaken={taken} onSubmit={async () => true} />);
  await act(async () => handle.current!.insertText('actual message'));
  await act(async () => handle.current!.submit());
  expect(handle.current!.serialize().empty).toBe(true);
  expect(taken).toHaveBeenCalledOnce();
});

describe('the editor answers a plugin’s prompt read, fill and suggestion (R2)', () => {
  it('reads the box as sent, the caret at its end; replace, append and insert place the text', async () => {
    const { port } = drafts(null);
    const handle = createRef<EditorHandle>();
    const { container } = render(<Editor appSessionId={APP} cwd="/repo" sessionId={null} drafts={port} client={client} handle={handle} />);
    await waitFor(() => expect(handle.current).not.toBeNull());
    expect(handle.current!.promptBox()).toEqual({ text: '', cursor: 0 });
    act(() => handle.current!.fill('MODS_PROBE_FILL', 'replace'));
    expect(contentOf(container).textContent).toBe('MODS_PROBE_FILL');
    expect(handle.current!.promptBox()).toEqual({ text: 'MODS_PROBE_FILL', cursor: 15 });
    act(() => handle.current!.fill(' and more', 'append'));
    expect(handle.current!.promptBox().text).toBe('MODS_PROBE_FILL and more');
    act(() => handle.current!.fill('two\nlines', 'replace'));
    expect(handle.current!.serialize().display).toBe('two\nlines');
  });

  it('shows a suggestion as the empty box’s placeholder and Tab takes it', async () => {
    const { port } = drafts(null);
    const handle = createRef<EditorHandle>();
    const taken = vi.fn();
    const view = render(<Editor appSessionId={APP} cwd="/repo" sessionId={null} drafts={port} client={client} handle={handle} />);
    await waitFor(() => expect(handle.current).not.toBeNull());
    view.rerender(<Editor appSessionId={APP} cwd="/repo" sessionId={null} drafts={port} client={client} handle={handle} suggestion="MODS_PROBE_SUGGEST" onSuggestionTaken={taken} />);
    act(() => handle.current!.refreshPlaceholder());
    const content = contentOf(view.container);
    await waitFor(() => expect(content.querySelector('[data-placeholder]')?.getAttribute('data-placeholder')).toBe('MODS_PROBE_SUGGEST'));
    await act(async () => void content.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })));
    expect(content.textContent).toBe('MODS_PROBE_SUGGEST');
    expect(taken).toHaveBeenCalledTimes(1);
  });

  // UX wave U4a (Interfaces F): the composer's words for the empty box while a turn runs; a plugin's suggestion still wins
  it('shows the placeholder it is given in place of its own, and a suggestion over it', async () => {
    const { port } = drafts(null);
    const handle = createRef<EditorHandle>();
    const view = render(<Editor appSessionId={APP} cwd="/repo" sessionId={null} drafts={port} client={client} handle={handle} />);
    await waitFor(() => expect(handle.current).not.toBeNull());
    const shown = () => contentOf(view.container).querySelector('[data-placeholder]')?.getAttribute('data-placeholder');
    await waitFor(() => expect(shown()).toBe('Do anything'));
    view.rerender(<Editor appSessionId={APP} cwd="/repo" sessionId={null} drafts={port} client={client} handle={handle} placeholder="Enter to send" />);
    act(() => handle.current!.refreshPlaceholder());
    await waitFor(() => expect(shown()).toBe('Enter to send'));
    view.rerender(<Editor appSessionId={APP} cwd="/repo" sessionId={null} drafts={port} client={client} handle={handle} placeholder="Enter to send" suggestion="MODS_PROBE_SUGGEST" />);
    act(() => handle.current!.refreshPlaceholder());
    await waitFor(() => expect(shown()).toBe('MODS_PROBE_SUGGEST'));
    view.rerender(<Editor appSessionId={APP} cwd="/repo" sessionId={null} drafts={port} client={client} handle={handle} placeholder={null} />);
    act(() => handle.current!.refreshPlaceholder());
    await waitFor(() => expect(shown()).toBe('Do anything'));
  });
});

// E3 start: `/btw` is a side question, never a prompt (E3 execution document, Design §7, M4's proofs): a draft the typed
// seam would not take (several lines, pasted text) is asked through the registered `btw` widget with its whole text,
// pasted text unframed; one with an attachment, or with no `btw` widget registered, is refused with a toast and kept.
// Nothing of any of them reaches the session's submit (`session.send` or `session.steer`).
describe('a `/btw` draft never reaches the conversation', () => {
  const opened = () => useWidgetDialog.getState().open;
  const offs: (() => void)[] = [];
  const registerBtw = (apply: (id: AppSessionId, args: string, tooLate: AbortSignal) => Promise<boolean>) =>
    offs.push(registerSlashWidget('btw', { title: 'Side question', component: () => <p data-test-widget>btw</p>, apply }));
  const notices = () => useNotices.getState().notices.map((n) => n.text);
  beforeEach(() => {
    closeWidgetDialog();
    useNotices.setState({ notices: [] });
  });
  afterEach(() => offs.splice(0).forEach((off) => off()));

  async function mounted(doc: ReturnType<typeof docOf>) {
    const onSubmit = vi.fn(async () => true);
    const { port, saved } = drafts({ doc, attachments: [], updatedAt: '2026-10-06T00:00:00.000Z' });
    const handle = createRef<EditorHandle>();
    render(<Editor appSessionId={APP} cwd="/repo" sessionId={null} drafts={port} client={client} onSubmit={onSubmit} handle={handle} />);
    await waitFor(() => expect(handle.current?.serialize().empty).toBe(false));
    return { onSubmit, handle, saved };
  }

  it('asks a two-line question through the widget’s apply, and sends nothing', async () => {
    const apply = vi.fn(async () => true);
    registerBtw(apply);
    const { onSubmit, handle, saved } = await mounted(docOf([paragraph(textNode('/btw why is this')), paragraph(textNode('null-checked twice?'))]));
    await act(async () => handle.current!.submit());
    await waitFor(() => expect(apply).toHaveBeenCalledWith(APP, 'why is this\nnull-checked twice?', expect.any(AbortSignal)));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(opened()).toBeNull();
    expect(handle.current?.serialize().empty).toBe(true);
    expect(saved).toEqual([null]);
  });

  it('asks a question holding pasted text with the text itself, not its placeholder or framing', async () => {
    const apply = vi.fn(async () => true);
    registerBtw(apply);
    const pasted = pastedNode({ id: 'p1', kind: 'text', name: 'Pasted text', lines: 2, text: 'const a = 1;\nconst b = 2;' });
    const { onSubmit, handle } = await mounted(docOf([paragraph(textNode('/btw what does '), pasted, textNode(' do?'))]));
    await act(async () => handle.current!.submit());
    await waitFor(() => expect(apply).toHaveBeenCalledWith(APP, 'what does const a = 1;\nconst b = 2; do?', expect.any(AbortSignal)));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('refuses a question with an attachment: a toast, the draft kept, nothing asked or sent', async () => {
    const apply = vi.fn(async () => true);
    registerBtw(apply);
    const shot = { id: 'a1', kind: 'image' as const, name: 'shot.png', mediaType: 'image/png', bytes: 4, data: 'iVBO', persisted: true };
    const { onSubmit, handle, saved } = await mounted(docOf([paragraph(textNode('/btw what is this?'))], [shot]));
    await act(async () => handle.current!.submit());
    expect(notices()).toEqual(['Side questions take text only; remove the attachment']);
    expect(apply).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(handle.current?.serialize().display).toBe('/btw what is this? [Image #1]');
    expect(saved).toEqual([]);
  });

  it('refuses even a one-line `/btw` when no `btw` widget is registered, rather than sending it as text', async () => {
    const { onSubmit, handle } = await mounted(docOf([paragraph(textNode('/btw anything'))]));
    await act(async () => handle.current!.submit());
    expect(notices()).toEqual(['Side questions are not available here']);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(handle.current?.serialize().display).toBe('/btw anything');
  });

  it('a message that merely starts with "/btwx" is not a side question', async () => {
    registerBtw(vi.fn(async () => true));
    const { onSubmit, handle } = await mounted(docOf([paragraph(textNode('/btwx run it'))]));
    await act(async () => handle.current!.submit());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ display: '/btwx run it' })));
  });
});
// E3 end

// P5 O7 M4 ("What a drop sends"): for a lane B session on another machine (`uploadsTo`: that machine's name), a file the
// API doesn't read as bytes goes to the machine with the message: it is held as a file to upload, never mentioned by its
// local path (which names nothing there); a file past the upload bound, and one the + menu answered by path alone, are
// refused in words; images and PDFs attach as locally.
describe('a drop on a session on another machine', () => {
  const remoteClient = { ...client, pathForFile: () => '/Users/me/notes.txt' } as MawsBridge;
  const mountRemote = async () => {
    useNotices.setState({ notices: [] });
    const handle = createRef<EditorHandle>();
    render(<Editor appSessionId={APP} cwd="/w" sessionId="s" drafts={drafts(null).port} client={remoteClient} handle={handle} onSubmit={async () => true} uploadsTo="mini" />);
    await act(async () => {});
    return handle;
  };
  const notices = () => useNotices.getState().notices.map((n) => n.text);

  it('holds any other file as one to upload, whatever its local path, and mentions nothing', async () => {
    const handle = await mountRemote();
    await act(async () => void (await handle.current!.attachFiles([new File(['hi'], 'notes.txt', { type: 'text/plain' })])));
    expect(handle.current!.doc().attrs?.attachments).toEqual([{ id: expect.any(String), kind: 'file', name: 'notes.txt', mediaType: 'text/plain', bytes: 2, data: 'aGk=', persisted: true }]);
    expect(handle.current!.serialize()).toMatchObject({ text: '', empty: false });
  });

  it('refuses a file past the upload bound and a picked file answered by its path alone, saying why', async () => {
    const handle = await mountRemote();
    const huge = new File(['x'], 'huge.zip', { type: 'application/zip' });
    Object.defineProperty(huge, 'size', { value: 33 * 1024 * 1024 });
    await act(async () => void (await handle.current!.attachFiles([huge])));
    await act(async () => handle.current!.attachPicked([{ path: '/Users/me/build.log', name: 'build.log', mediaType: null, bytes: 10, data: null }]));
    expect(handle.current!.doc().attrs?.attachments).toEqual([]);
    expect(handle.current!.serialize().empty).toBe(true);
    expect(notices()).toEqual(['huge.zip is over 32 MB, the most a file to mini can be', 'build.log can’t be sent to mini from here; drag it into the message instead']);
  });

  it('attaches a PDF as locally, to go up at the send', async () => {
    const handle = await mountRemote();
    await act(async () => void (await handle.current!.attachFiles([new File(['%PDF'], 'spec.pdf', { type: 'application/pdf' })])));
    expect(handle.current!.doc().attrs?.attachments).toMatchObject([{ kind: 'document', name: 'spec.pdf' }]);
  });

  // M4c fix wave 1 (review finding 1): an image still past the inline bound once resized goes up as the file it is
  it('holds an image still over 5 MB after resizing as a file to upload, its own bytes, rather than refusing it', async () => {
    const MiB = 1024 * 1024;
    vi.stubGlobal('createImageBitmap', async () => ({ width: 4000, height: 3000, close: () => {} }));
    vi.stubGlobal(
      'OffscreenCanvas',
      class {
        getContext() {
          return { drawImage: () => {} };
        }
        async convertToBlob() {
          return new Blob([new Uint8Array(6 * MiB)], { type: 'image/png' }); // high entropy: still past 5 MB
        }
      },
    );
    onTestFinished(() => void vi.unstubAllGlobals());
    const handle = await mountRemote();
    const photo = new File([new Uint8Array(7 * MiB).fill(7)], 'photo.png', { type: 'image/png' });
    await act(async () => void (await handle.current!.attachFiles([photo])));
    expect(notices()).toEqual([]);
    const [held] = attachmentsOf(handle.current!.doc());
    expect(held).toMatchObject({ kind: 'file', name: 'photo.png', mediaType: 'image/png', bytes: 7 * MiB });
    expect(held!.data.slice(0, 8)).toBe('BwcHBwcH'); // the dropped bytes, not the re-encoding
  });

  // M4c fix wave 1 (review finding 2): a file dropped while the chat was this Mac's is mentioned by its local path; once
  // the chat is to run on another machine, the mention becomes an upload of the bytes the drop held
  it('turns a local drop’s mention into an upload once the chat is to run on another machine', async () => {
    useNotices.setState({ notices: [] });
    const handle = createRef<EditorHandle>();
    const local = { ...client, pathForFile: () => '/w/notes.txt' } as MawsBridge;
    const view = (uploadsTo: string | null) => <Editor appSessionId={APP} cwd="/w" sessionId={null} drafts={drafts(null).port} client={local} handle={handle} onSubmit={async () => true} uploadsTo={uploadsTo} />;
    const { rerender } = render(view(null));
    await act(async () => {});
    await act(async () => void (await handle.current!.attachFiles([new File(['hi'], 'notes.txt', { type: 'text/plain' })])));
    expect(handle.current!.serialize().text).toBe('@notes.txt');
    rerender(view('mini'));
    await waitFor(() => expect(attachmentsOf(handle.current!.doc())).toMatchObject([{ kind: 'file', name: 'notes.txt', data: 'aGk=' }]));
    expect(handle.current!.serialize().text.trim()).toBe('');
    expect(notices()).toEqual([]);
  });

  // M4c fix wave 2: the conversion is transactional, and a submission waits for it
  const localThenRemote = async (file: File, onSubmit: (s: Serialized, handle: EditorHandle) => Promise<boolean> = async () => true) => {
    useNotices.setState({ notices: [] });
    const handle = createRef<EditorHandle>();
    const local = { ...client, pathForFile: (f: File) => `/w/${f.name}` } as MawsBridge;
    const view = (uploadsTo: string | null) => <Editor appSessionId={APP} cwd="/w" sessionId={null} drafts={drafts(null).port} client={local} handle={handle} onSubmit={(s) => onSubmit(s, handle.current!)} uploadsTo={uploadsTo} />;
    const { rerender } = render(view(null));
    await act(async () => {});
    await act(async () => void (await handle.current!.attachFiles([file])));
    return { handle, remote: () => rerender(view('mini')) };
  };

  it('keeps a local drop’s mention that can’t go to the machine, saying why, when the chat turns to it', async () => {
    const huge = new File(['x'], 'huge.zip', { type: 'application/zip' });
    Object.defineProperty(huge, 'size', { value: 33 * 1024 * 1024 });
    const { handle, remote } = await localThenRemote(huge);
    remote();
    await waitFor(() => expect(notices()).toEqual(['huge.zip is over 32 MB, the most a file to mini can be']));
    expect(handle.current!.serialize().text).toBe('@huge.zip'); // in place, not lost
    expect(attachmentsOf(handle.current!.doc())).toEqual([]);
  });

  it('holds a Send made while a dropped file is still being read until it is attached, then sends it once', async () => {
    let release!: () => void;
    const notes = new File(['hi'], 'notes.txt', { type: 'text/plain' });
    const read = notes.arrayBuffer.bind(notes);
    notes.arrayBuffer = () => new Promise<ArrayBuffer>((resolve) => (release = () => void read().then(resolve)));
    const sent: { text: string; files: string[] }[] = [];
    const { handle, remote } = await localThenRemote(notes, async (s, editor) => (sent.push({ text: s.text, files: attachmentsOf(editor.doc()).map((a) => a.name) }), true));
    remote();
    act(() => handle.current!.submit());
    act(() => handle.current!.submit()); // a second Enter meanwhile
    await act(async () => {});
    expect(sent).toEqual([]); // waits for the read
    await act(async () => release());
    await waitFor(() => expect(sent).toEqual([{ text: '', files: ['notes.txt'] }]));
  });
});

// UX wave U4a M3 (Interfaces F; decision 14): ↑ asks the composer to take a waiting message back before history walks,
// Esc acts on a fresh press only, and `load` fills an empty box
describe('the editor’s take-back, Esc and load', () => {
  const history = [{ display: 'older prompt', at: '2026-09-29T09:00:00.000Z', source: 'maws', sessionId: null, pastedContents: {} }];
  const recalling = {
    ...client,
    invoke: vi.fn(async (name: string) => (name === 'session.history.list' ? { ok: true, value: { entries: history } } : { ok: false, error: { code: 'internal', message: 'no session' } })),
  } as unknown as MawsBridge;
  const pressOn = (content: HTMLElement) => (key: string, init: KeyboardEventInit = {}) => act(async () => void content.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })));

  it('asks onTakeBack on ↑ in an empty box, walks history when it answers false, and never asks with text or while recalling', async () => {
    let takes = true;
    const onTakeBack = vi.fn(() => takes);
    const { port } = drafts(null);
    const handle = createRef<EditorHandle>();
    const { container } = render(<Editor appSessionId={APP} cwd="/repo" sessionId="s" drafts={port} client={recalling} handle={handle} onTakeBack={onTakeBack} />);
    const content = contentOf(container);
    await waitFor(() => expect(recalling.invoke).toHaveBeenCalledWith('session.history.list', expect.anything()));
    content.focus();
    const press = pressOn(content);
    await press('ArrowUp');
    expect(onTakeBack).toHaveBeenCalledTimes(1);
    expect(handle.current?.serialize().display).toBe(''); // the composer took the key
    takes = false;
    await press('ArrowUp');
    expect(onTakeBack).toHaveBeenCalledTimes(2);
    expect(handle.current?.serialize().display).toBe('older prompt'); // none waits: history
    await press('ArrowUp'); // recalling: history's
    expect(onTakeBack).toHaveBeenCalledTimes(2);
    await press('ArrowDown');
    act(() => handle.current?.insertText('typed'));
    await press('ArrowUp');
    expect(onTakeBack).toHaveBeenCalledTimes(2);
  });

  it('hands a fresh Esc to onEscape and answers its repeats as that press was answered, without asking again', async () => {
    let answer = true;
    const onEscape = vi.fn(() => answer);
    const { port } = drafts(null);
    const { container } = render(<Editor appSessionId={APP} cwd="/repo" sessionId="s" drafts={port} client={client} onEscape={onEscape} />);
    const content = contentOf(container);
    content.focus();
    const event = (repeat: boolean) => new KeyboardEvent('keydown', { key: 'Escape', repeat, bubbles: true, cancelable: true });
    const first = event(false);
    await act(async () => void content.dispatchEvent(first));
    expect(first.defaultPrevented).toBe(true);
    answer = false;
    const repeat = event(true);
    await act(async () => void content.dispatchEvent(repeat));
    expect(onEscape).toHaveBeenCalledTimes(1);
    expect(repeat.defaultPrevented).toBe(true); // consumed: the press was the composer's
    const fresh = event(false);
    await act(async () => void content.dispatchEvent(fresh));
    expect(onEscape).toHaveBeenCalledTimes(2);
    const unclaimed = event(true);
    await act(async () => void content.dispatchEvent(unclaimed));
    expect(onEscape).toHaveBeenCalledTimes(2);
    expect(unclaimed.defaultPrevented).toBe(false); // left alone: that press was not the composer's
  });

  it('loads a document into an empty box with the caret at its end, and refuses one while the box holds text or a submission is in flight', async () => {
    const { port } = drafts(null);
    const handle = createRef<EditorHandle>();
    let answer!: (accepted: boolean) => void;
    const onSubmit = vi.fn(() => new Promise<boolean>((resolve) => (answer = resolve)));
    render(<Editor appSessionId={APP} cwd="/repo" sessionId="s" drafts={port} client={client} handle={handle} onSubmit={onSubmit} />);
    await act(async () => handle.current?.restored());
    let loaded = false;
    act(() => void (loaded = handle.current!.load(docOf([paragraph(textNode('taken back'))]))));
    expect(loaded).toBe(true);
    expect(handle.current?.serialize().display).toBe('taken back');
    act(() => void (loaded = handle.current!.load(docOf([paragraph(textNode('another'))]))));
    expect(loaded).toBe(false);
    expect(handle.current?.serialize().display).toBe('taken back');
    act(() => handle.current?.submit());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    act(() => handle.current?.clear());
    act(() => void (loaded = handle.current!.load(docOf([paragraph(textNode('while sending'))]))));
    expect(loaded).toBe(false);
    await act(async () => answer(true));
  });
});

// UX wave U4a, the branch panel's findings 1 and 5: a take-back's load supersedes what this mount had pending, and the
// focus it asked for while the box was held reaches the box when the hold ends
describe('a take-back’s load and what this mount had pending', () => {
  const taken = () => docOf([paragraph(textNode('taken back'))]);
  async function emptiedPending() {
    const { port, saved } = drafts(null);
    const handle = createRef<EditorHandle>();
    const view = render(<Editor appSessionId={APP} cwd="/repo" sessionId="s" drafts={port} client={client} handle={handle} />);
    await act(async () => handle.current?.restored());
    act(() => handle.current?.insertText('x'));
    act(() => void handle.current?.fill('', 'replace')); // typed and deleted: an empty box's write is pending
    return { saved, handle, view };
  }

  it('the pending write’s timer saves nothing over the loaded message', async () => {
    const { saved, handle } = await emptiedPending();
    act(() => void handle.current!.load(taken()));
    await act(() => new Promise((resolve) => setTimeout(resolve, DRAFT_DELAY_MS + 250)));
    expect(saved).toEqual([]);
    expect(handle.current?.serialize().display).toBe('taken back');
  });

  it('the unmount flush saves nothing over the loaded message', async () => {
    const { saved, handle, view } = await emptiedPending();
    act(() => void handle.current!.load(taken()));
    view.unmount();
    expect(saved).toEqual([]);
  });

  it('a load made while the box was held gets its focus when the hold ends, unless the focus has gone elsewhere since', async () => {
    const { port } = drafts(null);
    const handle = createRef<EditorHandle>();
    const outside = document.createElement('button');
    const field = document.createElement('input');
    document.body.append(outside, field);
    onTestFinished(() => {
      outside.remove();
      field.remove();
    });
    const held = (disabled: string | null) => <Editor appSessionId={APP} cwd="/repo" sessionId="s" drafts={port} client={client} handle={handle} disabled={disabled} />;
    const { container, rerender } = render(held('Taking the message back…'));
    await act(async () => handle.current?.restored());
    const content = contentOf(container);
    outside.focus(); // Edit was pressed on the row: the focus is on its control
    act(() => void handle.current!.load(taken()));
    await act(() => new Promise((resolve) => setTimeout(resolve, 50))); // the hold outlasts the frame Tiptap's focus waits
    expect(document.activeElement).toBe(outside); // a held box takes no focus
    rerender(held(null));
    await waitFor(() => expect(document.activeElement).toBe(content));
    act(() => handle.current?.insertText('!'));
    expect(handle.current?.serialize().display).toBe('taken back!'); // typing reaches the message, at its end
    // once more, the focus moving to another field before the hold ends
    act(() => handle.current?.clear());
    rerender(held('Taking the message back…'));
    outside.focus();
    act(() => void handle.current!.load(taken()));
    field.focus();
    rerender(held(null));
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(document.activeElement).toBe(field);
  });
});

// UX wave U4a M6 (l3-input-12, l3-input-09; decisions 22 and 23): the line under the text while recalling or searching,
// Ctrl+R's search of the prompt history, and the paste that stays text with a chip that opens.
describe('the box’s helpers: the history line, its search and the paste', () => {
  const listing = (displays: string[]) => {
    const entries = displays.map((display, i) => ({ display, at: new Date(Date.UTC(2026, 8, 29, 9, i)).toISOString(), source: 'maws', sessionId: null, pastedContents: {} }));
    return {
      ...client,
      invoke: vi.fn(async (name: string) => (name === 'session.history.list' ? { ok: true, value: { entries } } : { ok: false, error: { code: 'internal', message: 'no session' } })),
    } as unknown as MawsBridge;
  };
  const line = () => document.querySelector('[role="status"][aria-label="Prompt history"]')?.textContent ?? null;
  const shown = (handle: RefObject<EditorHandle | null>) => handle.current?.serialize().display;
  async function mounted(displays: string[], props: { onSubmit?(s: Serialized): Promise<boolean>; onEscape?(): boolean } = {}) {
    const bridge = listing(displays);
    const handle = createRef<EditorHandle>();
    const { container } = render(<Editor appSessionId={APP} cwd="/repo" sessionId="s" drafts={drafts(null).port} client={bridge} handle={handle} {...props} />);
    const content = contentOf(container);
    await waitFor(() => expect(bridge.invoke).toHaveBeenCalledWith('session.history.list', expect.anything()));
    await act(async () => handle.current?.restored());
    content.focus();
    const press = async (key: string, init: KeyboardEventInit = {}) => {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
      await act(async () => void content.dispatchEvent(event));
      return event;
    };
    const type = async (text: string) => {
      for (const key of text) await press(key);
    };
    const search = () => press('r', { code: 'KeyR', ctrlKey: true });
    return { handle, content, press, type, search };
  }
  // oldest first: newest first the search reads "notes on deploy", "read the build log", "deploy the docs", "fix the build"
  const PROMPTS = ['fix the build', 'deploy the docs', 'read the build log', 'notes on deploy'];

  it('says the recalled entry’s place under the text at the newest, a middle and the oldest entry, and nothing once the draft is back or an edit ends it', async () => {
    const { handle, press } = await mounted(Array.from({ length: 12 }, (_, i) => `prompt ${i + 1}`));
    expect(line()).toBeNull();
    await press('ArrowUp');
    expect(shown(handle)).toBe('prompt 12');
    expect(line()).toBe('History 1/12 · ↓ to restore your draft');
    await press('ArrowUp');
    await press('ArrowUp');
    expect(line()).toBe('History 3/12 · ↓ to restore your draft');
    for (let i = 0; i < 9; i++) await press('ArrowUp');
    expect(shown(handle)).toBe('prompt 1');
    expect(line()).toBe('History 12/12 · ↓ to restore your draft');
    for (let i = 0; i < 12; i++) await press('ArrowDown');
    expect(shown(handle)).toBe('');
    expect(line()).toBeNull();
    await press('ArrowUp');
    act(() => handle.current?.insertText('!'));
    expect(line()).toBeNull(); // the edit ended the recall
  });

  it('searches with Ctrl+R: typing narrows, Ctrl+R and ↑ go older, ↓ newer, the line counts the matches, and Esc puts the draft back without a stop', async () => {
    const onEscape = vi.fn(() => true);
    const { handle, search, type, press } = await mounted(PROMPTS, { onEscape });
    act(() => handle.current?.insertText('my draft'));
    await search();
    expect(line()).toBe('Search history:');
    expect(shown(handle)).toBe('my draft');
    await type('build');
    expect(shown(handle)).toBe('read the build log');
    expect(line()).toBe('Search history: build — match 1 of 2');
    await search();
    expect(shown(handle)).toBe('fix the build');
    expect(line()).toBe('Search history: build — match 2 of 2');
    await press('ArrowUp'); // nothing older holds it: the match stays
    expect(line()).toBe('Search history: build — match 2 of 2');
    await press('ArrowDown');
    expect(shown(handle)).toBe('read the build log');
    await type('z');
    expect(line()).toBe('Search history: buildz — no match');
    expect(shown(handle)).toBe('read the build log');
    await press('Backspace');
    expect(line()).toBe('Search history: build — match 1 of 2');
    const esc = await press('Escape');
    expect(esc.defaultPrevented).toBe(true);
    expect(shown(handle)).toBe('my draft');
    expect(line()).toBeNull();
    await press('Escape', { repeat: true }); // the press's repeat is the search's too
    expect(onEscape).not.toHaveBeenCalled();
  });

  // the branch panel's finding 6: a held Enter's repeats never send
  it('a held Enter that took the match sends nothing at its repeats; a fresh Enter sends', async () => {
    const onSubmit = vi.fn<(s: Serialized) => Promise<boolean>>(async () => true);
    const { handle, search, type, press } = await mounted(PROMPTS, { onSubmit });
    await search();
    await type('docs');
    await press('Enter');
    const repeat = await press('Enter', { repeat: true });
    await press('Enter', { repeat: true });
    expect(repeat.defaultPrevented).toBe(true); // the repeat is consumed, not typed as a line break
    expect(onSubmit).not.toHaveBeenCalled();
    expect(shown(handle)).toBe('deploy the docs');
    await press('Enter');
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  });

  it('takes the match into the box with Enter, without sending; the next Enter sends it', async () => {
    const onSubmit = vi.fn<(s: Serialized) => Promise<boolean>>(async () => true);
    const { handle, search, type, press } = await mounted(PROMPTS, { onSubmit });
    await search();
    await type('docs');
    await press('Enter');
    expect(shown(handle)).toBe('deploy the docs');
    expect(line()).toBeNull();
    expect(onSubmit).not.toHaveBeenCalled();
    await press('Enter');
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ display: 'deploy the docs' })));
  });

  it('leaves the draft when nothing matches, and Backspace on an empty search puts it back', async () => {
    const { handle, search, type, press } = await mounted(PROMPTS);
    act(() => handle.current?.insertText('kept'));
    await search();
    await type('q');
    expect(line()).toBe('Search history: q — no match');
    expect(shown(handle)).toBe('kept');
    await press('Backspace');
    expect(line()).toBe('Search history:');
    expect(shown(handle)).toBe('kept');
    await press('Backspace');
    expect(line()).toBeNull();
    expect(shown(handle)).toBe('kept');
  });

  it('ends the search at a composing key with the match in the box, and leaves the key to the editor', async () => {
    const { handle, search, type, press } = await mounted(PROMPTS);
    await search();
    await type('notes');
    expect(shown(handle)).toBe('notes on deploy');
    const composing = await press('ㄱ', { isComposing: true });
    expect(composing.defaultPrevented).toBe(false);
    expect(line()).toBeNull();
    expect(shown(handle)).toBe('notes on deploy');
  });

  it('ends a search the keyboard leaves, the match kept', async () => {
    const { handle, content, search, type } = await mounted(PROMPTS);
    await search();
    await type('fix');
    expect(shown(handle)).toBe('fix the build');
    act(() => content.blur());
    expect(line()).toBeNull();
    expect(shown(handle)).toBe('fix the build');
  });

  it('starts a search from the recalled entry’s place, and its Esc puts back the draft the recall began from', async () => {
    const { handle, search, type, press } = await mounted(PROMPTS);
    await press('ArrowUp');
    await press('ArrowUp');
    expect(line()).toBe('History 2/4 · ↓ to restore your draft');
    await search();
    expect(line()).toBe('Search history:');
    expect(shown(handle)).toBe('read the build log');
    await type('deploy');
    expect(shown(handle)).toBe('deploy the docs'); // older than the place it started from
    expect(line()).toBe('Search history: deploy — match 2 of 2');
    await press('Escape');
    expect(shown(handle)).toBe('');
    expect(line()).toBeNull();
  });

  // A paste as the system delivers it, carrying text only.
  const paste = (content: HTMLElement, text: string) =>
    act(async () => {
      const event = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', { value: { getData: (type: string) => (type === 'text/plain' ? text : ''), files: [], items: [], types: ['text/plain'] } });
      content.dispatchEvent(event);
    });

  it('lands a 5,000-character paste over 200 lines as text, and makes a chip of 20,001 characters', async () => {
    const { handle, content } = await mounted([]);
    const text = `${Array.from({ length: 200 }, (_, i) => `pasted line ${String(i).padStart(3, '0')} `.padEnd(24, 'x')).join('\n')}x`;
    expect(text.length).toBe(5000);
    await paste(content, text);
    expect(content.querySelector('[data-pasted]')).toBeNull();
    expect(shown(handle)).toBe(text);
    act(() => handle.current?.clear());
    await paste(content, 'y'.repeat(20_001));
    expect(content.querySelectorAll('[data-pasted="text"]')).toHaveLength(1);
    expect(shown(handle)).toBe('[Pasted text #1 +1 lines]');
  });

  it('opens a chip to its text, and "Show in text field" turns it into text as one undoable step', async () => {
    const { handle, content } = await mounted([]);
    const body = 'z'.repeat(20_001);
    await paste(content, body);
    fireEvent.click(within(content.querySelector('[data-pasted]') as HTMLElement).getByRole('button'));
    const popover = await screen.findByRole('dialog', { name: 'Pasted text #1' });
    expect(popover.textContent).toContain(body);
    fireEvent.click(within(popover).getByRole('button', { name: 'Show in text field' }));
    expect(content.querySelector('[data-pasted]')).toBeNull();
    expect(shown(handle)).toBe(body);
    expect(screen.queryByRole('dialog', { name: 'Pasted text #1' })).toBeNull();
    await act(async () => void content.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true })));
    expect(shown(handle)).toBe('[Pasted text #1 +1 lines]'); // one undo brings the chip back whole
  });

  it('loads a stored draft’s old chip as that chip, which opens; a chip whose text was not kept says so and offers nothing', async () => {
    const chip = pastedNode({ id: 'p-1', kind: 'text', name: 'Pasted text #1', lines: 3, text: 'one\ntwo\nthree' });
    const lost = pastedNode({ id: 'p-2', kind: 'text', name: 'Pasted text #2', lines: 40, text: null });
    const { port } = drafts({ doc: docOf([paragraph(chip, textNode(' and '), lost)]), attachments: [], updatedAt: '2026-09-29T00:00:00.000Z' });
    const handle = createRef<EditorHandle>();
    const { container } = render(<Editor appSessionId={APP} cwd="/repo" sessionId={null} drafts={port} client={client} handle={handle} />);
    await waitFor(() => expect(container.querySelectorAll('[data-pasted]')).toHaveLength(2));
    const [kept, unkept] = [...container.querySelectorAll<HTMLElement>('[data-pasted]')];
    fireEvent.click(within(unkept).getByRole('button'));
    const sorry = await screen.findByRole('dialog', { name: 'Pasted text #2' });
    expect(sorry.textContent).toContain(UNAVAILABLE_TITLE);
    expect(within(sorry).queryByRole('button', { name: 'Show in text field' })).toBeNull();
    fireEvent.keyDown(sorry, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Pasted text #2' })).toBeNull());
    fireEvent.click(within(kept).getByRole('button'));
    const open = await screen.findByRole('dialog', { name: 'Pasted text #1' });
    expect(open.textContent).toContain('one\ntwo\nthree');
    fireEvent.click(within(open).getByRole('button', { name: 'Show in text field' }));
    expect(handle.current?.serialize().display).toBe('one\ntwo\nthree and [Pasted text #1 +40 lines]');
  });
});
