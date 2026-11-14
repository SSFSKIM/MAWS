// UX wave U5a (M2's review, fix 1): over the real editor and its margin (the geometry stubbed, margin-test-support.ts),
// a send to main from the margin's card leaves its line in the margin's entry of that thread (§C's table), not in the
// column's fallback slot: the note carries its thread, and the entry keeps hosting the card host until the note ends.
// The confirmed send's line goes after SENT_NOTE_MS and the thread's own card comes back; a terminal session's pending
// line stays in the entry while its send is held, and becomes the sent line there when the delivery enters.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Editor } from '@tiptap/core';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { resetScene, resized, scene, stubCoords, stubGeometry, unstubGeometry } from '@artifacts/document/editor/comments/margin-test-support';
import { select } from '@artifacts/document/editor/comments/test-support';
import { DocumentEditor } from '@artifacts/document/editor/DocumentEditor';
import type { DocumentHandle } from '@artifacts/document/editor/host-types';
import { memoryEditorHost, openMemoryHandle, whenSynced } from '@artifacts/document/editor/memory-host';
import { World, doc, para, ticks, until } from '@artifacts/document/editor/test-world';
import type { AppSessionId } from '@shared/graph/ids';
import type { PreloadBridge } from '@shared/ipc/schema';
import { record, status } from '../../../../../test/support/builders';
import { fakeClient } from '../../../../../test/support/fake-client';
import { at } from '../../../../../test/support/machine';
import { laneAState } from '../../lane-a/test-support/lane-a-state';
import { resetPlaceNotes, SENT_NOTE_MS, useCommentCard } from '../../side/card/store';
import { openComment } from '../../side/register';
import { applyLaneAState, resetLaneAStore } from '../../stores/lane-a';
import { useSessions } from '../../stores/sessions';
import { resetShellStores } from '../../test-support/shell-stores';
import { registerCommentComposer } from '../code/anchor/anchor';
import { useDocumentComments } from './comments';

const PARENT = at('a1111111-1111-4111-8111-111111111111' as AppSessionId);
const KEY = { writer: 'maws/m', seq: 2 };
const BUILT = [{ type: 'text', text: 'the built message' }];
const owner = memoryEditorHost({ actor: { kind: 'human' }, name: 'Owner', color: '--author-2' });

let world: World | null = null;
let handle: DocumentHandle | null = null;
let offComposer = () => {};
beforeEach(() => {
  resetShellStores();
  resetLaneAStore();
  resetPlaceNotes();
  resetScene();
  stubGeometry();
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
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  unstubGeometry();
  delete (window as { maws?: unknown }).maws;
});

function answering(answers: Record<string, unknown>) {
  window.maws = fakeClient({ 'session.intent.get': null, 'side.comment.content': { content: BUILT }, ...answers } as never).client as unknown as PreloadBridge;
}

// The editor with its margin, a comment begun on a passage from the toolbar: the card is drawn in its thread's entry.
async function mount() {
  world = new World(doc(para('p1', 'The plan ships quarterly.'), para('p2', 'Owners track the budget closely.')));
  const opened = openMemoryHandle(world.host, { log: () => {} });
  handle = opened;
  await whenSynced(opened);
  let current: Editor | null = null;
  function Surface() {
    const comments = useDocumentComments({ artifactId: 'art-1', appSessionId: PARENT, title: 'Plan' });
    return (
      <DocumentEditor
        artifactId="art-1"
        handle={opened}
        host={owner}
        comments={comments}
        onEditor={(e) => {
          current = e;
          if (e) stubCoords(e); // the margin anchors through coordsAtPos
        }}
      />
    );
  }
  render(<Surface />);
  await until(() => current !== null && current.getText().includes('quarterly'), 'the editor to bind');
  act(() => void select(current!, 'ships quarterly'));
  act(() => fireEvent.click(within(screen.getByRole('toolbar', { name: 'Formatting' })).getByRole('button', { name: 'Add comment' })));
  await act(() => ticks(4));
  const open = useCommentCard.getState().open!;
  const threadId = open.target?.kind === 'artifact' ? open.target.threadId : '';
  scene.lines.set(threadId, { top: 200, height: 20 });
  resized();
  await act(() => ticks(2));
  expect(entry(threadId)?.querySelector('[data-comment-card]'), 'the compose card is in its thread’s entry').not.toBeNull();
  return { threadId };
}
const entry = (threadId: string) => document.querySelector<HTMLElement>(`[data-margin-entry="${threadId}"]`);
const slot = () => document.querySelector<HTMLElement>('[data-margin-slot]');

async function sendToMain(threadId: string) {
  const card = within(entry(threadId)!.querySelector<HTMLElement>('[data-comment-card]')!);
  await userEvent.type(card.getByRole('textbox', { name: 'Comment' }), 'Monthly instead?');
  await userEvent.click(card.getByRole('checkbox', { name: 'Send to main' }));
  await userEvent.click(card.getByRole('button', { name: 'Send' }));
  await vi.waitFor(() => expect(useCommentCard.getState().open).toBeNull());
  await act(() => ticks(2));
}

it('a confirmed send: its line is in the thread’s entry until it ends, and the thread’s card then comes back there', async () => {
  useSessions.setState({ records: new Map([[PARENT, record(PARENT, { title: { text: 'Q3 plan', source: 'user' } })]]), engine: new Map([[PARENT, status(PARENT, { process: 'ready' } as never)]]) });
  answering({ 'session.queue.list': { entries: [], paused: false }, 'session.send': { messageUuid: null, disposition: 'sent', queueId: 'q0' } });
  const { threadId } = await mount();
  vi.useFakeTimers({ shouldAdvanceTime: true }); // before the line's own time is set
  await sendToMain(threadId);
  expect(entry(threadId)!.querySelector('[data-sent-note]')?.textContent).toBe('Sent to Q3 plan');
  expect(entry(threadId)!.hasAttribute('data-compose')).toBe(true);
  expect(slot()?.querySelector('[data-sent-note]') ?? null, 'not in the column’s fallback slot').toBeNull();
  await act(async () => vi.advanceTimersByTime(SENT_NOTE_MS + 100));
  expect(document.querySelector('[data-sent-note]')).toBeNull();
  expect(entry(threadId)!.hasAttribute('data-compose'), 'the entry draws its thread again').toBe(false);
});

it('a terminal session’s pending send: its line is in the thread’s entry while held, and becomes the sent line there when it enters', async () => {
  useSessions.setState({ records: new Map([[PARENT, record(PARENT, { title: { text: 'Q3 plan', source: 'user' }, holder: { kind: 'terminal', pid: 42 } })]]), engine: new Map() });
  applyLaneAState(PARENT, laneAState(PARENT));
  answering({ 'laneA.send': { key: KEY, state: 'submitted' } });
  const { threadId } = await mount();
  await sendToMain(threadId);
  expect(entry(threadId)!.querySelector('[data-pending-note]')?.textContent).toContain('Not confirmed yet in Q3 plan');
  expect(slot()?.querySelector('[data-pending-note]') ?? null, 'not in the column’s fallback slot').toBeNull();
  act(() => applyLaneAState(PARENT, laneAState(PARENT, { deliveries: [{ key: KEY, at: '2026-11-12T09:00:00.000Z', state: 'entered' }] })));
  expect(entry(threadId)!.querySelector('[data-pending-note]')).toBeNull();
  expect(entry(threadId)!.querySelector('[data-sent-note]')?.textContent).toBe('Sent to Q3 plan');
});
