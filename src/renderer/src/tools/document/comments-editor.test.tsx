// The document's comment card over the real editor (P3-B M4 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md,
// fix wave 2): DocumentEditor remounts its page, and with it the card's overlay, whenever the active tab changes, while
// the card host's id is the document's; the composing card survives that remount (P2's host keeps it), so its draft
// must too, or the card would send an anchor naming a deleted thread. The draft goes when its card closes unsent or
// the editor as a whole goes (P2's host closes the card then).
import '../../../../../test/support/artifacts-dom-setup'; // first: the editor loads KaTeX, which warns under happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { Editor } from '@tiptap/core';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { select } from '@artifacts/document/editor/comments/test-support';
import { DocumentEditor } from '@artifacts/document/editor/DocumentEditor';
import type { DocumentHandleWithHold } from '@artifacts/document/editor/host-types';
import { memoryEditorHost, openMemoryHandle, whenSynced } from '@artifacts/document/editor/memory-host';
import { World, doc, para, ticks, until } from '@artifacts/document/editor/test-world';
import { schemaFor } from '@artifacts/document/schema';
import { addTab } from '@artifacts/document/tabs';
import { getThread } from '@artifacts/document/threads';
import type { AppSessionId } from '@shared/graph/ids';
import { fakeClient } from '../../../../../test/support/fake-client';
import { useCommentCard } from '../../side/card/store';
import { openComment } from '../../side/register';
import { resetShellStores } from '../../test-support/shell-stores';
import { registerCommentComposer } from '../code/anchor/anchor';
import { useDocumentComments } from './comments';

const PARENT = 'a1111111-1111-4111-8111-111111111111' as AppSessionId;
const owner = memoryEditorHost({ actor: { kind: 'human' }, name: 'Owner', color: '--author-2' });

let world: World | null = null;
let handle: DocumentHandleWithHold | null = null;
let offComposer = () => {};
beforeEach(() => {
  resetShellStores();
  window.maws = fakeClient({ 'session.intent.get': null }).client;
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
  delete (window as { maws?: unknown }).maws;
});

async function mount() {
  world = new World(doc(para('p1', 'The plan ships quarterly.')));
  world.host.write((d) => addTab(d, { title: 'Appendix', id: 'tab2', body: schemaFor().nodeFromJSON(doc(para('p2', 'Appendix text.'))) }));
  const opened = openMemoryHandle(world.host, { log: () => {} });
  handle = opened;
  await whenSynced(opened);
  let current: Editor | null = null;
  function Surface() {
    const comments = useDocumentComments({ artifactId: 'art-1', appSessionId: PARENT, title: 'Plan' });
    return <DocumentEditor artifactId="art-1" handle={opened} host={owner} comments={comments} onEditor={(e) => (current = e)} />;
  }
  const view = render(<Surface />);
  await until(() => current !== null && current.getText().includes('quarterly'), 'the editor to bind');
  act(() => void select(current!, 'ships quarterly'));
  act(() => fireEvent.click(within(screen.getByRole('toolbar', { name: 'Formatting' })).getByRole('button', { name: 'Comment', exact: true })));
  await act(() => ticks(4));
  const open = useCommentCard.getState().open!;
  const threadId = open.target?.kind === 'artifact' ? open.target.threadId : '';
  expect(getThread(opened.doc, threadId)).not.toBeNull();
  const showTab = async (name: string, text: string) => {
    act(() => fireEvent.click(screen.getByRole('tab', { name })));
    await act(() => ticks(8));
    await until(() => current !== null && current.getText().includes(text), `the ${name} tab to bind`);
  };
  return { doc: opened.doc, threadId, view, showTab };
}
const card = () => document.querySelector<HTMLElement>('[data-comment-card]');

it('keeps a composing card’s thread through a tab switch; the card’s Close then withdraws it', async () => {
  const { doc: ydoc, threadId, showTab } = await mount();
  await showTab('Appendix', 'Appendix');
  const open = useCommentCard.getState().open;
  expect(open === null || (open.target?.kind === 'artifact' && getThread(ydoc, open.target.threadId) !== null), 'an open card names a live thread').toBe(true);
  expect(open, 'the composing card survives the switch').not.toBeNull();
  expect(getThread(ydoc, threadId)).not.toBeNull();

  await showTab('Main', 'quarterly');
  expect(card()).not.toBeNull();
  act(() => fireEvent.click(within(card()!).getByRole('button', { name: 'Close' })));
  expect(getThread(ydoc, threadId)).toBeNull();
});

it('withdraws the draft when the editor as a whole goes, its card closed with it', async () => {
  const { doc: ydoc, threadId, view } = await mount();
  view.unmount();
  await act(() => ticks(2));
  expect(useCommentCard.getState().open).toBeNull();
  expect(getThread(ydoc, threadId)).toBeNull();
});
