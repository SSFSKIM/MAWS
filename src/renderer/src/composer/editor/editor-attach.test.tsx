// The editor's side of "Attach selection to chat" (UX wave U6b-5a, decisions 8 and 30; Interfaces §C, `EditorHandle.
// attachPasted`): after this mount's restore, a block whose id the document does not hold, at the caret (the keyboard
// with it) or at the end (the caret and the keyboard untouched); `present` for one it holds; `busy` while a submission
// is in flight, `closed` while the editor takes no typing, `gone` once it unmounted, nothing changed in those; with
// `save`, the draft saved at once through the port and the port's answer said. And the one maker: a paste over the
// threshold and a dropped text file still make today's node.
import { act, cleanup, render, waitFor } from '@testing-library/react';
import type { JSONContent } from '@tiptap/core';
import type { Editor as TiptapEditor } from '@tiptap/react';
import { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import type { Draft } from '@shared/ipc/schema/session';
import { at, TEST_MACHINE } from '../../../../../test/support/machine';
import { connectKeys } from '../../keymap/dispatcher';
import { resetCatalogStore } from '../../stores/catalog';
import { resetComposerStore } from '../../stores/composer';
import { docOf, paragraph, PASTED, textNode, type ComposerDoc } from './doc';
import { DRAFT_DELAY_MS } from './drafts';
import { Editor, type DraftPort, type EditorHandle } from './Editor';
import { pastedBlock } from './pasted-block';

const APP = at('app-attach' as AppSessionId);
const client = {
  localMachine: TEST_MACHINE,
  invoke: vi.fn(async (name: string) => (name === 'session.history.list' ? { ok: true, value: { entries: [] } } : { ok: false, error: { code: 'internal', message: 'no session' } })),
  on: () => () => {},
  pathForFile: () => '',
} as unknown as MawsBridge;

const STORED: Draft = { doc: docOf([paragraph(textNode('kept from before'))]), attachments: [], updatedAt: '2026-11-17T09:00:00.000Z' };

// A port whose load and saves the test can hold: `release` answers the load, `answer` the oldest save still out.
function heldPort(initial: Draft | null, options: { holdLoad?: boolean; saveAnswer?: boolean } = {}) {
  const saved: (Draft | null)[] = [];
  let release!: () => void;
  const loaded = options.holdLoad ? new Promise<void>((resolve) => (release = resolve)) : Promise.resolve();
  const port: DraftPort = {
    load: async () => {
      await loaded;
      return initial;
    },
    save: async (draft) => {
      saved.push(draft);
      return options.saveAnswer ?? true;
    },
  };
  return { port, saved, release: () => act(async () => release()) };
}

// The pasted nodes of a document, in order.
function blocksOf(doc: JSONContent | null | undefined): JSONContent[] {
  if (!doc) return [];
  return [...(doc.type === PASTED ? [doc] : []), ...(doc.content ?? []).flatMap((child) => blocksOf(child))];
}
const ofId = (doc: ComposerDoc | null | undefined, id: string) => blocksOf(doc).filter((node) => node.attrs?.id === id);

let disconnect: () => void;
beforeEach(() => {
  resetComposerStore();
  resetCatalogStore();
  disconnect = connectKeys();
});
afterEach(() => {
  disconnect();
  cleanup();
  vi.useRealTimers();
});

function mount(port: DraftPort, props: { disabled?: string | null; onSubmit?: () => Promise<boolean> } = {}) {
  const handle = createRef<EditorHandle>();
  const view = render(
    <>
      <Editor appSessionId={APP} cwd="/repo" sessionId={null} drafts={port} client={client} handle={handle} disabled={props.disabled ?? null} {...(props.onSubmit && { onSubmit: props.onSubmit })} />
      <button type="button">elsewhere</button>
    </>,
  );
  const content = view.container.querySelector('[contenteditable]') as HTMLElement;
  return { handle, view, content, elsewhere: view.container.querySelector('button')! };
}

describe('the editor takes an attached block', () => {
  it('waits for its restore, then appends the block once; the same id again is present and changes nothing', async () => {
    const { port, release } = heldPort(STORED, { holdLoad: true });
    const { handle } = mount(port);
    let answer: string | null = null;
    const asked = handle.current!.attachPasted({ id: 'attach-a', text: 'ls -la' }, { at: 'end', save: false }).then((a) => (answer = a));
    await act(async () => {});
    expect(answer).toBeNull(); // held: the restore has not come
    expect(ofId(handle.current!.doc(), 'attach-a')).toHaveLength(0);
    await release();
    await act(async () => void (await asked));
    expect(answer).toBe('taken');
    expect(handle.current!.serialize().display).toBe('kept from before\n[Pasted text #1 +1 lines]'); // the restore kept, the block after it
    expect(ofId(handle.current!.doc(), 'attach-a')).toEqual([pastedBlock('ls -la', 'attach-a')]);
    let again: string | null = null;
    await act(async () => void (again = await handle.current!.attachPasted({ id: 'attach-a', text: 'ls -la' }, { at: 'end', save: false })));
    expect(again).toBe('present');
    expect(ofId(handle.current!.doc(), 'attach-a')).toHaveLength(1);
  });

  it('at the end leaves the caret and the keyboard where they were; at the caret it takes the keyboard', async () => {
    const { port } = heldPort(null);
    const { handle, content, elsewhere } = mount(port);
    await act(async () => handle.current!.restored());
    elsewhere.focus();
    await act(async () => void (await handle.current!.attachPasted({ id: 'attach-b', text: 'one' }, { at: 'end', save: false })));
    expect(document.activeElement).toBe(elsewhere);
    await act(async () => void (await handle.current!.attachPasted({ id: 'attach-c', text: 'two' }, { at: 'caret', save: false })));
    expect(content.contains(document.activeElement)).toBe(true);
    expect(ofId(handle.current!.doc(), 'attach-b')).toHaveLength(1);
    expect(ofId(handle.current!.doc(), 'attach-c')).toHaveLength(1);
  });

  // Decision Log 14 (iv): the block goes in at a collapsed position, never over a selection, and an append at the end
  // leaves the person's caret and selection where they were.
  const tiptapOf = (content: HTMLElement) => (content as HTMLElement & { editor: TiptapEditor }).editor;
  const selectionOf = (content: HTMLElement) => {
    const { from, to } = tiptapOf(content).state.selection;
    return { from, to };
  };

  it('at the caret, over a selection made before the keyboard went elsewhere: the selected words stay, the block after them, the caret after it', async () => {
    const { port } = heldPort({ doc: docOf([paragraph(textNode('keep these words'))]), attachments: [], updatedAt: '2026-11-17T09:00:00.000Z' });
    const { handle, content, elsewhere } = mount(port);
    await act(async () => handle.current!.restored());
    act(() => {
      content.focus();
      tiptapOf(content).commands.setTextSelection({ from: 6, to: 11 }); // `these` (the paragraph opens at 1)
    });
    act(() => elsewhere.focus()); // the keyboard goes to the terminal
    await act(async () => void (await handle.current!.attachPasted({ id: 'attach-s', text: 'ls -la' }, { at: 'caret', save: false })));
    expect(handle.current!.serialize().display).toBe('keep these[Pasted text #1 +1 lines] words');
    expect(selectionOf(content)).toEqual({ from: 12, to: 12 }); // after the block
    expect(content.contains(document.activeElement)).toBe(true);
  });

  it('at the end, with the caret in an empty last paragraph: the block goes there and the caret stays where it was', async () => {
    const { port } = heldPort({ doc: docOf([paragraph(textNode('first line')), paragraph()]), attachments: [], updatedAt: '2026-11-17T09:00:00.000Z' });
    const { handle, content } = mount(port);
    await act(async () => handle.current!.restored());
    act(() => {
      content.focus();
      tiptapOf(content).commands.setTextSelection(13); // the empty last paragraph (it opens at 12)
    });
    await act(async () => void (await handle.current!.attachPasted({ id: 'attach-t', text: 'x' }, { at: 'end', save: false })));
    expect(ofId(handle.current!.doc(), 'attach-t')).toHaveLength(1);
    expect(tiptapOf(content).state.doc.lastChild!.firstChild!.type.name).toBe(PASTED); // into that paragraph
    expect(selectionOf(content)).toEqual({ from: 13, to: 13 });
    expect(content.contains(document.activeElement)).toBe(true);
  });

  it('at the end, with words selected: the selection stays as it was', async () => {
    const { port } = heldPort(STORED);
    const { handle, content } = mount(port);
    await act(async () => handle.current!.restored());
    act(() => {
      content.focus();
      tiptapOf(content).commands.setTextSelection({ from: 1, to: 5 }); // `kept`
    });
    await act(async () => void (await handle.current!.attachPasted({ id: 'attach-u', text: 'x' }, { at: 'end', save: false })));
    expect(handle.current!.serialize().display).toBe('kept from before\n[Pasted text #1 +1 lines]');
    expect(selectionOf(content)).toEqual({ from: 1, to: 5 });
  });

  it('with save, drops the pending write and saves at once, answering the port; without it, the writer’s pause saves', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { port, saved } = heldPort(null);
    const { handle } = mount(port);
    await act(async () => handle.current!.restored());
    let answer: string | null = null;
    await act(async () => void (answer = await handle.current!.attachPasted({ id: 'attach-d', text: 'x' }, { at: 'end', save: true })));
    expect(answer).toBe('taken');
    expect(saved).toHaveLength(1);
    expect(ofId(saved[0]!.doc as ComposerDoc, 'attach-d')).toHaveLength(1);
    await act(async () => void vi.advanceTimersByTime(DRAFT_DELAY_MS * 2));
    expect(saved).toHaveLength(1); // the writer's pending write was dropped: one save, not two
    await act(async () => void (answer = await handle.current!.attachPasted({ id: 'attach-e', text: 'y' }, { at: 'end', save: false })));
    expect(saved).toHaveLength(1); // nothing saved by the attach itself
    await act(async () => void vi.advanceTimersByTime(DRAFT_DELAY_MS));
    expect(saved).toHaveLength(2);
  });

  it('answers unsaved when the port refuses the save, the block kept in the box', async () => {
    const { port } = heldPort(null, { saveAnswer: false });
    const { handle } = mount(port);
    await act(async () => handle.current!.restored());
    let answer: string | null = null;
    await act(async () => void (answer = await handle.current!.attachPasted({ id: 'attach-f', text: 'x' }, { at: 'end', save: true })));
    expect(answer).toBe('unsaved');
    expect(ofId(handle.current!.doc(), 'attach-f')).toHaveLength(1);
  });

  it('answers busy while a submission is in flight and changes nothing; after it settles, the same call takes the block', async () => {
    let settle!: (accepted: boolean) => void;
    const onSubmit = vi.fn(() => new Promise<boolean>((resolve) => (settle = resolve)));
    const { port } = heldPort({ doc: docOf([paragraph(textNode('to send'))]), attachments: [], updatedAt: '2026-11-17T09:00:00.000Z' });
    const { handle } = mount(port, { onSubmit });
    await waitFor(() => expect(handle.current!.serialize().display).toBe('to send'));
    act(() => handle.current!.submit());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    let answer: string | null = null;
    await act(async () => void (answer = await handle.current!.attachPasted({ id: 'attach-g', text: 'x' }, { at: 'end', save: false })));
    expect(answer).toBe('busy');
    expect(ofId(handle.current!.doc(), 'attach-g')).toHaveLength(0);
    await act(async () => settle(true));
    await act(async () => void (answer = await handle.current!.attachPasted({ id: 'attach-g', text: 'x' }, { at: 'end', save: false })));
    expect(answer).toBe('taken'); // the control: the same read finds the block after the call that follows the send
    expect(ofId(handle.current!.doc(), 'attach-g')).toHaveLength(1);
    expect(handle.current!.serialize().display).toBe('[Pasted text #1 +1 lines]'); // into the box the send left
  });

  // Decision Log 17 (S1's at-most-once): a send of the session carrying the block, accepted while this mount waits on its
  // restore, took the block: the answer is `present` and nothing is put in. The control: with no send, it is put in.
  it.each(['a send carrying it is accepted', 'no send'] as const)('waiting on its restore while %s', async (meanwhile) => {
    const block = { id: 'attach-r', text: 'ls -la' };
    const sender = mount(heldPort({ doc: docOf([paragraph(textNode('with it '), pastedBlock(block.text, block.id))]), attachments: [], updatedAt: '2026-11-17T09:00:00.000Z' }).port, { onSubmit: async () => true });
    await act(async () => sender.handle.current!.restored());
    expect(ofId(sender.handle.current!.doc(), block.id)).toHaveLength(1);
    const { port, release, saved } = heldPort(null, { holdLoad: true });
    const asked = mount(port);
    let answer: string | null = null;
    const done = asked.handle.current!.attachPasted(block, { at: 'end', save: true }).then((a) => (answer = a));
    await act(async () => {});
    if (meanwhile === 'a send carrying it is accepted') {
      act(() => sender.handle.current!.submit());
      await waitFor(() => expect(ofId(sender.handle.current!.doc(), block.id)).toHaveLength(0)); // sent, the box cleared
    }
    expect(answer).toBeNull();
    await release();
    await act(async () => void (await done));
    if (meanwhile === 'no send') {
      expect(answer).toBe('taken');
      expect(ofId(asked.handle.current!.doc(), block.id)).toHaveLength(1);
      return;
    }
    expect(answer).toBe('present');
    expect(ofId(asked.handle.current!.doc(), block.id)).toHaveLength(0);
    expect(saved.filter((draft) => ofId(draft?.doc as ComposerDoc, block.id).length > 0)).toEqual([]);
  });

  it('answers closed while it takes no typing, and gone once it unmounted while waiting', async () => {
    const closed = mount(heldPort(null).port, { disabled: 'read only' });
    await act(async () => closed.handle.current!.restored());
    let answer: string | null = null;
    await act(async () => void (answer = await closed.handle.current!.attachPasted({ id: 'attach-h', text: 'x' }, { at: 'end', save: true })));
    expect(answer).toBe('closed');
    expect(ofId(closed.handle.current!.doc(), 'attach-h')).toHaveLength(0);
    closed.view.unmount();

    const { port, release, saved } = heldPort(null, { holdLoad: true });
    const { handle, view } = mount(port);
    const editor = handle.current!;
    const asked = editor.attachPasted({ id: 'attach-i', text: 'x' }, { at: 'end', save: true });
    view.unmount();
    await release();
    expect(await asked).toBe('gone');
    expect(saved.filter((draft) => ofId(draft?.doc as ComposerDoc, 'attach-i').length > 0)).toEqual([]);
  });
});

describe('the one maker of a text block', () => {
  it('makes a paste over the threshold and a dropped text file as pastedBlock does, attribute for attribute', async () => {
    const { port } = heldPort(null);
    const { handle, content } = mount(port);
    await act(async () => handle.current!.restored());
    const text = 'q'.repeat(20_001);
    await act(async () => {
      const event = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', { value: { getData: (type: string) => (type === 'text/plain' ? text : ''), files: [], items: [], types: ['text/plain'] } });
      content.dispatchEvent(event);
    });
    const [pasted] = blocksOf(handle.current!.doc());
    expect(pasted).toEqual(pastedBlock(text, String(pasted!.attrs!.id)));
    await act(async () => void (await handle.current!.attachFiles([new File(['dropped words'], 'notes.txt', { type: 'text/plain' })])));
    const dropped = blocksOf(handle.current!.doc())[1]!;
    expect(dropped).toEqual(pastedBlock('dropped words', String(dropped.attrs!.id), 'notes.txt'));
  });
});
