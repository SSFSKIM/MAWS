// UX wave U5a (docs/doperpowers/plans/2026-11-12-ux-wave-U5a-comment-card.md, M7; decision 20, A17): the agent's answer
// to a document comment arrives at the first of two signals, a message by a session in the comment's thread or the end
// of the turn of the card's side thread. The host asks the editor once per answer to tint the passage, only while the
// document is on screen, and in a body under 720 px closes the floating card on that thread unless the keyboard is in it.
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommentOverlayProps } from '@artifacts/document/editor/comments/surface';
import { addThread, reply } from '@artifacts/document/threads';
import { newDoc, type Doc } from '@artifacts/yjs';
import type { Actor } from '@shared/artifacts/actor';
import type { AppSessionId } from '@shared/graph/ids';
import type { PreloadBridge } from '@shared/ipc/schema';
import { digest } from '../../../../../test/support/builders';
import { fakeClient } from '../../../../../test/support/fake-client';
import { at } from '../../../../../test/support/machine';
import { openCard, resetPlaceNotes, useCommentCard } from '../../side/card/store';
import { useSessions } from '../../stores/sessions';
import { resetShellStores } from '../../test-support/shell-stores';
import { artifactCommentAnchor, useDocumentComments } from './comments';

const PARENT = at('a1111111-1111-4111-8111-111111111111' as AppSessionId);
const CHILD_BARE = 'b2222222-2222-4222-8222-222222222222';
const CHILD = at(CHILD_BARE as AppSessionId);
const AGENT: Actor = { kind: 'session', appSessionId: CHILD_BARE as AppSessionId };
const ARTIFACT = 'art-0001';
const HOST = 'document:answers';
const T = 'k2m9x0qa';
const passage = { threadId: T, tabId: 'tab1', tabTitle: 'Main', quote: 'ships quarterly' };
const S = Date.parse('2026-11-12T10:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();

// the card's layout reads the host's box; the fold reads the document body's width
let bodyWidth = 600;
const clientSize = { width: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')!, height: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight')! };
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get(this: HTMLElement) { return this.classList.contains('doc-editor-body') ? bodyWidth : 800; } });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 900 });
});
afterAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientSize.width);
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', clientSize.height);
});
beforeEach(() => {
  resetShellStores();
  bodyWidth = 600;
  window.maws = fakeClient({ 'session.intent.get': null }).client as unknown as PreloadBridge;
});
afterEach(() => {
  cleanup();
  useCommentCard.setState({ open: null });
  resetPlaceNotes();
  delete (window as { maws?: unknown }).maws;
});

function reachOf(doc: Doc, placement?: 'margin'): CommentOverlayProps {
  return {
    doc,
    locate: vi.fn(() => ({ x: 120, y: 200, width: 140, height: 20 })),
    layoutKey: 'k1',
    setActive: vi.fn(),
    resolve: vi.fn(),
    reopen: vi.fn(),
    record: vi.fn(),
    discard: vi.fn(),
    focus: vi.fn(),
    flash: vi.fn(),
    ...(placement && { placement }),
  };
}

function Surface({ reach, visible = true, slot = 'a' }: { reach: CommentOverlayProps; visible?: boolean; slot?: string }) {
  const comments = useDocumentComments({ artifactId: ARTIFACT, appSessionId: PARENT, title: 'Q3 plan', hostId: HOST, visible });
  return (
    <div className="doc-editor-body">
      <div key={slot} className="relative">
        {comments.overlay(reach)}
      </div>
      <button type="button">Elsewhere</button>
    </div>
  );
}

// A sent comment's thread (its first message the person's), the editor's reach over it, and the host drawn.
function mount({ placement }: { placement?: 'margin' } = {}) {
  const doc = newDoc();
  addThread(doc, { threadId: T, tabId: 'tab1', blockId: 'p1', quote: passage.quote, anchor: { start: null, end: null, block: null }, by: { kind: 'human' }, at: S - 1_000, body: 'Should this be monthly?' });
  const reach = reachOf(doc, placement);
  const view = render(<Surface reach={reach} />);
  return {
    doc,
    reach,
    flashed: () => vi.mocked(reach.flash!).mock.calls.map(([threadId]) => threadId),
    rerender: (props: { visible?: boolean; slot?: string }) => view.rerender(<Surface reach={reach} {...props} />),
  };
}
const agentSays = (doc: Doc, id: string, when: number, threadId = T) => act(() => reply(doc, threadId, { id, by: AGENT, at: when, body: 'Edited this passage.' }));
// the card on the thread, become its side thread
const threadCard = () =>
  act(() => openCard(artifactCommentAnchor({ artifactId: ARTIFACT, title: 'Q3 plan', ...passage }), { appSessionId: PARENT, placement: { kind: 'card', host: 'artifact', hostId: HOST }, phase: { kind: 'thread', child: CHILD, echo: null } }));
const sideThread = (over: Parameters<typeof digest>[1]) => act(() => useSessions.setState({ digests: new Map([[CHILD, digest(CHILD, over)]]) }));
const turnRuns = (start: number) => sideThread({ phase: 'working', turnStartedAt: iso(start), lastTurnEndedAt: null });
const turnEnds = (start: number, end: number) => sideThread({ phase: 'idle', turnStartedAt: iso(start), lastTurnEndedAt: iso(end) });
const card = () => document.querySelector<HTMLElement>('[data-comment-card]');
// the thread card takes the keyboard as it becomes the thread; the person puts it back in the page
const keyboardElsewhere = () => act(() => screen.getByRole('button', { name: 'Elsewhere' }).focus());

describe('the answer’s arrival (decision 20)', () => {
  it('asks the editor to tint the passage when a session’s message reaches the thread, once per message', () => {
    const m = mount();
    agentSays(m.doc, 'agent-1', S);
    expect(m.flashed()).toEqual([T]);
    act(() => reply(m.doc, T, { id: 'human-2', by: { kind: 'human' }, at: S + 1, body: 'Thanks.' }));
    m.rerender({ slot: 'b' }); // the overlay remounts: the message it already answered for is not asked again
    expect(m.flashed()).toEqual([T]);
    agentSays(m.doc, 'agent-2', S + 2);
    expect(m.flashed(), 'a later answer is asked again').toEqual([T, T]);
  });

  it('is not asked for a thread an agent opened itself, nor while the document is hidden', () => {
    const m = mount();
    act(() => addThread(m.doc, { threadId: 'agent-own', tabId: 'tab1', blockId: 'p1', quote: 'q', anchor: { start: null, end: null, block: null }, by: AGENT, at: S, body: 'A note of mine.' }));
    expect(m.flashed()).toEqual([]);
    m.rerender({ visible: false });
    agentSays(m.doc, 'agent-1', S);
    m.rerender({ visible: true });
    expect(m.flashed(), 'not later either').toEqual([]);
  });

  it('asks once for an answer that both edits the thread and ends the side thread’s turn, in either order', () => {
    const m = mount();
    threadCard();
    turnRuns(S);
    agentSays(m.doc, 'agent-1', S + 1_000);
    turnEnds(S, S + 5_000);
    expect(m.flashed(), 'the message first').toEqual([T]);

    turnRuns(S + 10_000);
    turnEnds(S + 10_000, S + 15_000);
    agentSays(m.doc, 'agent-2', S + 12_000); // written in that turn, read after its end
    expect(m.flashed(), 'the turn’s end first').toEqual([T, T]);

    turnRuns(S + 20_000);
    turnEnds(S + 20_000, S + 25_000);
    expect(m.flashed(), 'a turn that answered without an edit').toEqual([T, T, T]);
  });

  it('does not ask again for the same answer when the overlay remounts during the turn', () => {
    const m = mount();
    threadCard();
    turnRuns(S);
    agentSays(m.doc, 'agent-1', S + 1_000);
    m.rerender({ slot: 'b' });
    turnEnds(S, S + 5_000);
    expect(m.flashed()).toEqual([T]);
  });
});

describe('the floating card at the answer (A17)', () => {
  it('closes in a body under 720 px, the thread kept', () => {
    const m = mount();
    threadCard();
    expect(card()).not.toBeNull();
    keyboardElsewhere();
    agentSays(m.doc, 'agent-1', S);
    expect(m.flashed()).toEqual([T]);
    expect(useCommentCard.getState().open).toBeNull();
    expect(m.reach.discard).not.toHaveBeenCalled();
  });

  // M7's review: the turn's end folds the card, and that turn's edit reaching the document afterwards is the same answer
  it('closes at the turn’s end, and the same turn’s edit arriving after it asks nothing more', () => {
    const m = mount();
    threadCard();
    keyboardElsewhere();
    turnRuns(S);
    turnEnds(S, S + 5_000);
    expect(m.flashed()).toEqual([T]);
    expect(useCommentCard.getState().open, 'folded at the turn’s end').toBeNull();
    agentSays(m.doc, 'agent-1', S + 1_000); // written in that turn, read after the card went
    expect(m.flashed()).toEqual([T]);
    m.rerender({ slot: 'b' });
    agentSays(m.doc, 'agent-2', S + 2_000); // and after the overlay remounted
    expect(m.flashed()).toEqual([T]);
    agentSays(m.doc, 'agent-3', S + 9_000); // after that turn: a later answer
    expect(m.flashed()).toEqual([T, T]);
  });

  it('stays with the keyboard in it, in a wider body, and in the margin', () => {
    const narrow = mount();
    threadCard();
    expect(card()!.contains(document.activeElement), 'as it became the thread').toBe(true);
    agentSays(narrow.doc, 'agent-1', S);
    expect(narrow.flashed()).toEqual([T]);
    expect(useCommentCard.getState().open, 'the keyboard is in it').not.toBeNull();
    cleanup();
    useCommentCard.setState({ open: null });

    bodyWidth = 800;
    const wide = mount();
    threadCard();
    keyboardElsewhere();
    agentSays(wide.doc, 'agent-2', S);
    expect(useCommentCard.getState().open, 'a wider body').not.toBeNull();
    cleanup();
    useCommentCard.setState({ open: null });

    bodyWidth = 600;
    const margin = mount({ placement: 'margin' });
    threadCard();
    keyboardElsewhere();
    agentSays(margin.doc, 'agent-3', S);
    expect(margin.flashed()).toEqual([T]);
    expect(useCommentCard.getState().open, 'in the margin').not.toBeNull();
  });
});
