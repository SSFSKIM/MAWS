// UX wave U5a (docs/doperpowers/plans/2026-11-12-ux-wave-U5a-comment-card.md, M7; A3) over the real editor: the
// document's count of open comments does not move when a comment card opens and is closed unsent, though the editor
// writes the card's thread and its mark at the opening, and rises by one when the comment is sent.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Editor } from '@tiptap/core';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { documentCommentCounts } from '@artifacts/document/comment-counts';
import { select } from '@artifacts/document/editor/comments/test-support';
import { DocumentEditor } from '@artifacts/document/editor/DocumentEditor';
import type { DocumentHandle } from '@artifacts/document/editor/host-types';
import { memoryEditorHost, openMemoryHandle, whenSynced } from '@artifacts/document/editor/memory-host';
import { TAB, World, doc, para, ticks, until } from '@artifacts/document/editor/test-world';
import { addThread, getThread } from '@artifacts/document/threads';
import type { AppSessionId } from '@shared/graph/ids';
import type { PreloadBridge } from '@shared/ipc/schema';
import { fakeClient, type FakeClient } from '../../../../../test/support/fake-client';
import { at } from '../../../../../test/support/machine';
import { resetPlaceNotes, useCommentCard } from '../../side/card/store';
import { openComment } from '../../side/register';
import { resetShellStores } from '../../test-support/shell-stores';
import { registerCommentComposer } from '../code/anchor/anchor';
import { useDocumentComments } from './comments';

const PARENT = at('a1111111-1111-4111-8111-111111111111' as AppSessionId);
const owner = memoryEditorHost({ actor: { kind: 'human' }, name: 'Owner', color: '--author-2' });

let world: World | null = null;
let handle: DocumentHandle | null = null;
let fake: FakeClient;
let offComposer = () => {};
beforeEach(() => {
  resetShellStores();
  fake = fakeClient({ 'session.intent.get': null });
  window.maws = fake.client as unknown as PreloadBridge;
  offComposer = registerCommentComposer(openComment);
});
afterEach(() => {
  cleanup();
  offComposer();
  handle?.close();
  world?.destroy();
  handle = null;
  world = null;
  useCommentCard.setState({ open: null });
  resetPlaceNotes();
  delete (window as { maws?: unknown }).maws;
});

it('stays at the count of sent comments through a card opened and closed unsent, and rises by one at the send', async () => {
  world = new World(doc(para('p1', 'The plan ships quarterly.'), para('p2', 'Owners track the budget.')));
  // a comment sent earlier, on the second paragraph as a whole
  world.host.write((d) => addThread(d, { threadId: 'earlier', tabId: TAB, blockId: 'p2', quote: 'Owners track the budget.', anchor: { kind: 'block' }, by: { kind: 'human' }, at: 1, body: 'Which budget?' }));
  const opened = openMemoryHandle(world.host, { log: () => {} });
  handle = opened;
  await whenSynced(opened);
  let current: Editor | null = null;
  function Surface() {
    const comments = useDocumentComments({ artifactId: 'art-1', appSessionId: PARENT, title: 'Plan' });
    return <DocumentEditor artifactId="art-1" handle={opened} host={owner} comments={comments} onEditor={(e) => (current = e)} />;
  }
  render(<Surface />);
  await until(() => current !== null && current.getText().includes('quarterly'), 'the editor to bind');
  const counts = documentCommentCounts(opened.doc);
  const off = counts.subscribe(() => {});
  const total = () => counts.getSnapshot().total;
  // the count follows a mark after the document has been quiet a moment
  const quiet = () => act(() => ticks(80));
  const comment = async () => {
    act(() => void select(current!, 'ships quarterly'));
    act(() => fireEvent.click(within(screen.getByRole('toolbar', { name: 'Formatting' })).getByRole('button', { name: 'Add comment' })));
    await until(() => useCommentCard.getState().open !== null, 'the card');
    const open = useCommentCard.getState().open!;
    return open.target?.kind === 'artifact' ? open.target.threadId : '';
  };
  try {
    await quiet();
    expect(total(), 'before').toBe(1);

    const drafted = await comment();
    await quiet();
    expect(getThread(opened.doc, drafted), 'the editor wrote the card’s thread').not.toBeNull();
    expect(total(), 'with an unsent card').toBe(1);
    const card = () => document.querySelector<HTMLElement>('[data-comment-card]')!;
    act(() => fireEvent.click(within(card()).getByRole('button', { name: 'Close' })));
    await quiet();
    expect(getThread(opened.doc, drafted)).toBeNull();
    expect(total(), 'after Close').toBe(1);

    const posted = await comment();
    await userEvent.type(within(card()).getByRole('textbox', { name: 'Comment' }), 'Should this be monthly?{Enter}');
    expect(fake.invoked('side.thread.open')).toHaveLength(1);
    await act(() => fake.reply('side.thread.open', { status: 'starting', appSessionId: 'b2222222-2222-4222-8222-222222222222' }));
    await until(() => (getThread(opened.doc, posted)?.messages.length ?? 0) > 0, 'the comment recorded in its thread');
    await quiet();
    expect(total(), 'after the send').toBe(2);
  } finally {
    off();
  }
});
