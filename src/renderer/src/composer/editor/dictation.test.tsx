// The composer's dictation seam (E9 execution document, Design §7): `beginDictation` opens an interim range at the caret
// that the editor alone owns. Partials replace it unrecorded and greyed, the final settles as one undoable step, cancel
// removes it, and the editor ends the sink itself (with `onEnded`) on an edit inside the words, a submission, a replaced
// document, a disabled editor and unmount.
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { undoDepth } from '@tiptap/pm/history';
import type { Editor as TiptapEditor } from '@tiptap/react';
import { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import type { Draft } from '@shared/ipc/schema/session';
import { resetCatalogStore } from '../../stores/catalog';
import { prefillComposer, resetComposerStore } from '../../stores/composer';
import { docOf, mentionNode, paragraph, textNode, type ComposerDoc } from './doc';
import { Editor, type DraftPort, type EditorHandle } from './Editor';
import type { Serialized } from './serialize';

const APP = 'app-1' as AppSessionId;
const client = {
  invoke: vi.fn(async (name: string) => (name === 'session.history.list' ? { ok: true, value: { entries: [] } } : { ok: false, error: { code: 'internal', message: 'no session' } })),
  on: () => () => {},
  pathForFile: () => '',
} as unknown as MawsBridge;

beforeEach(() => {
  resetComposerStore();
  resetCatalogStore();
});
afterEach(() => cleanup());

const draftOf = (doc: ComposerDoc): Draft => ({ doc, attachments: [], updatedAt: '2026-10-05T00:00:00.000Z' });

// An editor over `doc`, focused with the caret at `caret` (a selection when `to` is given).
async function mount(doc: ComposerDoc, caret: number, options: { to?: number; onSubmit?(s: Serialized): Promise<boolean>; disabled?: string | null } = {}) {
  const saved: (Draft | null)[] = [];
  const port: DraftPort = { load: async () => draftOf(doc), save: (d) => void saved.push(d) };
  const handle = createRef<EditorHandle>();
  const props = { appSessionId: APP, cwd: '/repo', sessionId: null, drafts: port, client, handle, onSubmit: options.onSubmit };
  const view = render(<Editor {...props} disabled={options.disabled ?? null} />);
  const content = view.container.querySelector('[contenteditable]') as HTMLElement & { editor: TiptapEditor };
  await waitFor(() => expect(content.textContent).not.toBe(''));
  const editor = content.editor;
  act(() => {
    editor.commands.setTextSelection({ from: caret, to: options.to ?? caret });
    editor.view.focus();
  });
  const rerender = (disabled: string | null) => view.rerender(<Editor {...props} disabled={disabled} />);
  return { handle, editor, content, saved, rerender, unmount: view.unmount };
}

const ALPHA_BETA = docOf([paragraph(textNode('alpha beta'))]);
const AFTER_ALPHA = 6; // positions count from the paragraph's opening (1): 'alpha' is 1..6
const text = (editor: TiptapEditor) => editor.state.doc.textContent;
const interim = (content: HTMLElement) => [...content.querySelectorAll('.text-fg-muted')].map((el) => el.textContent);

describe('editor dictation replaces interim text and settles the final', () => {
  it('draws partials greyed at the caret, each replacing the last, and settles the final as one undo step', async () => {
    const { handle, editor, content } = await mount(ALPHA_BETA, AFTER_ALPHA);
    const depth = undoDepth(editor.state);
    const sink = handle.current!.beginDictation(() => {})!;
    expect(sink).not.toBeNull();
    act(() => sink.partial('hello'));
    expect(text(editor)).toBe('alpha hello beta');
    expect(interim(content)).toEqual([' hello']);
    act(() => sink.partial('hello world'));
    expect(text(editor)).toBe('alpha hello world beta');
    expect(interim(content)).toEqual([' hello world']);
    expect(undoDepth(editor.state)).toBe(depth); // partials are never history
    act(() => sink.final('Hello world.'));
    expect(text(editor)).toBe('alpha Hello world. beta');
    expect(interim(content)).toEqual([]);
    expect(editor.state.selection.from).toBe(AFTER_ALPHA + ' Hello world.'.length);
    act(() => void editor.commands.undo());
    expect(text(editor)).toBe('alpha beta');
    act(() => void editor.commands.undo());
    expect(text(editor)).not.toContain('hello');
    expect(text(editor)).not.toContain('Hello');
  });

  it('keeps text typed at the range’s end outside the range', async () => {
    const { handle, editor } = await mount(ALPHA_BETA, AFTER_ALPHA);
    const sink = handle.current!.beginDictation(() => {})!;
    act(() => sink.partial('hello'));
    act(() => void editor.commands.insertContent('x')); // the caret sits at the range's end
    expect(text(editor)).toBe('alpha hellox beta');
    act(() => sink.partial('hello world'));
    expect(text(editor)).toBe('alpha hello worldx beta');
  });

  const edits: [string, (editor: TiptapEditor) => void, string][] = [
    ['typing strictly inside the words', (editor) => void editor.commands.insertContentAt(9, 'x'), 'alpha hexllo beta'],
    ['replacing a selection across the range’s edge', (editor) => void editor.chain().setTextSelection({ from: 4, to: 9 }).insertContent('Z').run(), 'alpZllo beta'],
    [
      'pasting inside the words',
      (editor) => {
        editor.commands.setTextSelection(9);
        editor.view.pasteText('xy');
      },
      'alpha hexyllo beta',
    ],
  ];
  for (const [name, edit, expected] of edits) {
    it(`${name} keeps the words and the edit, drops the grey, and ends the sink`, async () => {
      const onEnded = vi.fn();
      const { handle, editor, content } = await mount(ALPHA_BETA, AFTER_ALPHA);
      const sink = handle.current!.beginDictation(onEnded)!;
      act(() => sink.partial('hello'));
      act(() => edit(editor));
      expect(text(editor)).toBe(expected);
      expect(interim(content)).toEqual([]);
      expect(onEnded).toHaveBeenCalledOnce();
      act(() => sink.partial('hello world'));
      act(() => sink.final('Hello world.'));
      act(() => sink.cancel());
      expect(text(editor)).toBe(expected);
      expect(onEnded).toHaveBeenCalledOnce();
    });
  }

  it('deletes nothing of a selection: the words go after it, and cancel leaves it selected', async () => {
    const { handle, editor } = await mount(ALPHA_BETA, 1, { to: AFTER_ALPHA });
    const sink = handle.current!.beginDictation(() => {})!;
    expect(text(editor)).toBe('alpha beta');
    act(() => sink.cancel());
    expect(text(editor)).toBe('alpha beta');
    expect([editor.state.selection.from, editor.state.selection.to]).toEqual([1, AFTER_ALPHA]);

    const again = handle.current!.beginDictation(() => {})!;
    act(() => again.partial('hello'));
    act(() => again.final('Hello world.'));
    expect(text(editor)).toBe('alpha Hello world. beta');
  });

  it('puts a leading space after a mention chip, and none at the start of a line or after a space', async () => {
    const chip = docOf([paragraph(textNode('see '), mentionNode({ id: 'src/a.ts', label: 'a.ts', kind: 'file' }))]);
    const first = await mount(chip, 6); // 'see ' is 1..5, the chip 5..6
    const sink = first.handle.current!.beginDictation(() => {})!;
    act(() => sink.final('now'));
    expect(first.handle.current!.serialize().display).toBe('see @src/a.ts now');
    first.unmount();

    const start = await mount(ALPHA_BETA, 1);
    const atStart = start.handle.current!.beginDictation(() => {})!;
    act(() => atStart.final('Well'));
    expect(text(start.editor)).toBe('Wellalpha beta');
    start.unmount();

    const afterSpace = await mount(ALPHA_BETA, 7);
    const spaced = afterSpace.handle.current!.beginDictation(() => {})!;
    act(() => spaced.final('very'));
    expect(text(afterSpace.editor)).toBe('alpha verybeta');
  });

  it('cancel removes the interim text and leaves history untouched', async () => {
    const onEnded = vi.fn();
    const { handle, editor, content } = await mount(ALPHA_BETA, AFTER_ALPHA);
    const depth = undoDepth(editor.state);
    const sink = handle.current!.beginDictation(onEnded)!;
    act(() => sink.partial('hello'));
    act(() => sink.cancel());
    expect(text(editor)).toBe('alpha beta');
    expect(interim(content)).toEqual([]);
    expect(undoDepth(editor.state)).toBe(depth);
    expect(onEnded).not.toHaveBeenCalled(); // the owner cancelled; the editor did not end it
  });

  it('an empty final settles nothing', async () => {
    const { handle, editor } = await mount(ALPHA_BETA, AFTER_ALPHA);
    const depth = undoDepth(editor.state);
    const sink = handle.current!.beginDictation(() => {})!;
    act(() => sink.partial('hm'));
    act(() => sink.final(''));
    expect(text(editor)).toBe('alpha beta');
    expect(undoDepth(editor.state)).toBe(depth);
  });

  it('submit settles the interim words first, sends them, ends the sink, and a refused send keeps them in the draft', async () => {
    const onEnded = vi.fn();
    const onSubmit = vi.fn<(s: Serialized) => Promise<boolean>>(async () => false);
    const { handle, editor, content, saved, unmount } = await mount(ALPHA_BETA, AFTER_ALPHA, { onSubmit });
    const sink = handle.current!.beginDictation(onEnded)!;
    act(() => sink.partial('hello'));
    await act(async () => handle.current!.submit());
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ display: 'alpha hello beta' }));
    expect(onEnded).toHaveBeenCalledOnce();
    expect(interim(content)).toEqual([]);
    act(() => sink.final('Hello world.'));
    expect(text(editor)).toBe('alpha hello beta');
    unmount(); // flushes the pending draft write
    expect(JSON.stringify(saved.at(-1))).toContain('alpha hello beta');
  });

  it('refuses while a submission is in flight and while disabled', async () => {
    let answer!: (accepted: boolean) => void;
    const onSubmit = vi.fn(() => new Promise<boolean>((resolve) => (answer = resolve)));
    const busy = await mount(ALPHA_BETA, AFTER_ALPHA, { onSubmit });
    act(() => busy.handle.current!.submit());
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(busy.handle.current!.beginDictation(() => {})).toBeNull();
    await act(async () => answer(false));
    busy.unmount();

    const disabled = await mount(ALPHA_BETA, AFTER_ALPHA, { disabled: 'Starting…' });
    expect(disabled.handle.current!.beginDictation(() => {})).toBeNull();
  });

  it('ends the sink when a prefill replaces the document', async () => {
    const onEnded = vi.fn();
    const { handle, editor } = await mount(ALPHA_BETA, AFTER_ALPHA);
    const sink = handle.current!.beginDictation(onEnded)!;
    act(() => sink.partial('hello'));
    act(() => prefillComposer(APP, { text: 'replaced' }));
    await waitFor(() => expect(text(editor)).toBe('replaced'));
    expect(onEnded).toHaveBeenCalledOnce();
    act(() => sink.final('Hello world.'));
    expect(text(editor)).toBe('replaced');
  });

  it('ends the sink, keeping the words, when the editor becomes disabled', async () => {
    const onEnded = vi.fn();
    const { handle, editor, content, rerender } = await mount(ALPHA_BETA, AFTER_ALPHA);
    const sink = handle.current!.beginDictation(onEnded)!;
    act(() => sink.partial('hello'));
    rerender('Starting…');
    expect(onEnded).toHaveBeenCalledOnce();
    expect(text(editor)).toBe('alpha hello beta');
    expect(interim(content)).toEqual([]);
  });

  it('ends the sink, keeping the words, when the composer asks it to settle (a card covered the box)', async () => {
    const onEnded = vi.fn();
    const { handle, editor } = await mount(ALPHA_BETA, AFTER_ALPHA);
    const sink = handle.current!.beginDictation(onEnded)!;
    act(() => sink.partial('hello'));
    act(() => handle.current!.settleDictation());
    expect(onEnded).toHaveBeenCalledOnce();
    expect(text(editor)).toBe('alpha hello beta');
  });

  it('ends the sink on unmount, and the flushed draft holds no interim words', async () => {
    const onEnded = vi.fn();
    const { handle, saved, unmount } = await mount(ALPHA_BETA, AFTER_ALPHA);
    const sink = handle.current!.beginDictation(onEnded)!;
    act(() => sink.partial('hello'));
    unmount();
    expect(onEnded).toHaveBeenCalledOnce();
    expect(JSON.stringify(saved)).not.toContain('hello');
  });

  // Select All ends at the document's boundary, outside any paragraph: the range starts at the end of the last text
  // block instead, so its words never grow a wrapper paragraph the range would not cover (Task 3 review round 1).
  describe('after Select All', () => {
    const TWO = docOf([paragraph(textNode('one')), paragraph(textNode('two'))]);
    const selectAll = async (doc: ComposerDoc) => {
      const mounted = await mount(doc, 1);
      act(() => void mounted.editor.commands.selectAll());
      return { ...mounted, before: mounted.editor.getJSON() };
    };

    it('partials replace only their own words at the end of the last paragraph, and leave the selection until words arrive', async () => {
      const { handle, editor, content, before } = await selectAll(TWO);
      const sink = handle.current!.beginDictation(() => {})!;
      expect(editor.getJSON()).toEqual(before);
      expect([editor.state.selection.from, editor.state.selection.to]).toEqual([0, editor.state.doc.content.size]);
      act(() => sink.partial('hello'));
      act(() => sink.partial('hello world'));
      expect(editor.getJSON()).toEqual(docOf([paragraph(textNode('one')), paragraph(textNode('two hello world'))]));
      expect(interim(content)).toEqual([' hello world']);
    });

    it('cancel restores the document exactly', async () => {
      const { handle, editor, before } = await selectAll(ALPHA_BETA);
      const sink = handle.current!.beginDictation(() => {})!;
      act(() => sink.partial('hello'));
      act(() => sink.partial('hello there'));
      act(() => sink.cancel());
      expect(editor.getJSON()).toEqual(before);
    });

    it('the final settles in the paragraph and one undo restores the document', async () => {
      const { handle, editor, before } = await selectAll(TWO);
      const sink = handle.current!.beginDictation(() => {})!;
      act(() => sink.partial('hello'));
      act(() => sink.final('Hello world.'));
      expect(editor.getJSON()).toEqual(docOf([paragraph(textNode('one')), paragraph(textNode('two Hello world.'))]));
      act(() => void editor.commands.undo());
      expect(editor.getJSON()).toEqual(before);
    });
  });

  it('a selected chip ending its paragraph: the words go after it, and cancel restores the document', async () => {
    const chip = docOf([paragraph(textNode('see '), mentionNode({ id: 'src/a.ts', label: 'a.ts', kind: 'file' }))]);
    const { handle, editor } = await mount(chip, 5);
    act(() => void editor.commands.setNodeSelection(5)); // the chip itself, its end at the paragraph's boundary
    const before = editor.getJSON();
    const sink = handle.current!.beginDictation(() => {})!;
    act(() => sink.partial('hi'));
    expect(handle.current!.serialize().display).toBe('see @src/a.ts hi');
    act(() => sink.cancel());
    expect(editor.getJSON()).toEqual(before);
  });

  // The hold's keydown reaches the controller (C5's capture-phase dispatcher) before ProseMirror reads the DOM selection
  // the last arrow keys moved, so the state's caret can be stale; the words go where the human sees the caret (M5 gate).
  it('opens the range at the DOM caret when ProseMirror has not yet read it', async () => {
    const { handle, editor, content } = await mount(ALPHA_BETA, 11); // the state's caret at the end
    const unseen = (event: Event) => event.stopImmediatePropagation(); // ProseMirror's selectionchange listener never runs
    window.addEventListener('selectionchange', unseen, true);
    try {
      const words = content.querySelector('p')!.firstChild!; // the text node 'alpha beta'
      act(() => void window.getSelection()!.collapse(words, 'alpha'.length));
      expect(editor.state.selection.from).toBe(11);
      const sink = handle.current!.beginDictation(() => {})!;
      act(() => sink.partial('hello world'));
      expect(text(editor)).toBe('alpha hello world beta');
      expect(interim(content)).toEqual([' hello world']);
    } finally {
      window.removeEventListener('selectionchange', unseen, true);
    }
  });

  it('focuses an unfocused editor at the end before opening the range', async () => {
    const { handle, editor } = await mount(ALPHA_BETA, AFTER_ALPHA);
    act(() => editor.view.dom.blur());
    expect(editor.isFocused).toBe(false);
    const sink = handle.current!.beginDictation(() => {})!;
    act(() => sink.final('done'));
    expect(text(editor)).toBe('alpha beta done');
  });
});
