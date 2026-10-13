// The document's comment card (P3-B M4 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md, D9; X21's artifact
// target): a passage the editor commented opens P2's card through the composer seam on an `artifact-comment` anchor and
// the artifact target, drawn by the editor's host pinned where the editor locates the passage; Side thread and Send to
// main carry the anchor, whose tag round-trips; the card resolves and reopens its thread; a sent comment is recorded in
// the thread and an unsent one withdrawn.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { addThread, discardThread, getThread, reply, resolve as resolveThread, threadStatus } from '@artifacts/document/threads';
import type { CommentOverlayProps } from '@artifacts/document/editor/comments/surface';
import { newDoc, type Doc } from '@artifacts/yjs';
import { AnchorSchema } from '@shared/anchor/anchor';
import { anchoredMessage, parseAnchoredText } from '@shared/anchor/message';
import type { AppSessionId } from '@shared/graph/ids';
import { record, status } from '../../../../../test/support/builders';
import { fakeClient, type FakeClient } from '../../../../../test/support/fake-client';
import { sendComment } from '../../side/actions';
import { useCommentCard } from '../../side/card/store';
import { openComment } from '../../side/register';
import { useNotices } from '../../stores/notices';
import { useSessions } from '../../stores/sessions';
import { resetShellStores } from '../../test-support/shell-stores';
import { registerCommentComposer } from '../code/anchor/anchor';
import { artifactCommentAnchor, useDocumentComments } from './comments';

const PARENT = 'a1111111-1111-4111-8111-111111111111' as AppSessionId;
const ARTIFACT = 'art-0001';
const HOST_BOX = { width: 800, height: 900 };
const PASSAGE = { x: 120, y: 200, width: 140, height: 20 };

let fake: FakeClient;
let offComposer: () => void;
const clientSize = { width: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')!, height: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight')! };
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => HOST_BOX.width });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => HOST_BOX.height });
});
afterAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientSize.width);
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', clientSize.height);
});
beforeEach(() => {
  resetShellStores();
  useNotices.setState({ notices: [] });
  fake = fakeClient({ 'side.sendToMain': { messageUuid: null, disposition: 'sent' }, 'session.intent.get': null });
  window.maws = fake.client;
  offComposer = registerCommentComposer(openComment);
  const s = useSessions.getState();
  useSessions.setState({ records: new Map([[PARENT, record(PARENT)]]), engine: new Map([[PARENT, status(PARENT, { process: 'ready' } as never)]]), recordsVersion: s.recordsVersion + 1 });
});
afterEach(() => {
  cleanup();
  offComposer();
  useCommentCard.setState({ open: null });
  delete (window as { maws?: unknown }).maws;
});

const passage = { threadId: 'k2m9x0qa', tabId: 'tab1', tabTitle: 'Main', quote: 'ships quarterly\nwith design review' };

describe('the artifact-comment anchor', () => {
  it('names the document and tab, quotes the passage on one line, and carries the two ids', () => {
    const anchor = artifactCommentAnchor({ artifactId: ARTIFACT, title: 'Q3 plan', ...passage });
    expect(anchor).toEqual({ kind: 'artifact-comment', label: 'Q3 plan, Main', locator: 'ships quarterly with design review', artifactId: ARTIFACT, threadId: 'k2m9x0qa' });
    expect(AnchorSchema.parse(anchor)).toEqual(anchor);
    const long = artifactCommentAnchor({ artifactId: ARTIFACT, title: 'T'.repeat(300), ...passage, quote: 'q'.repeat(900) });
    expect(AnchorSchema.safeParse(long).success).toBe(true);
    expect(long.locator.endsWith('…')).toBe(true);
  });

  it('goes to the agent by both routes unchanged, its tag round-tripping', async () => {
    const anchor = artifactCommentAnchor({ artifactId: ARTIFACT, title: 'Q3 plan', ...passage });
    await expect(sendComment('main', { parent: PARENT, anchor, text: 'Should this be monthly?', screenshot: null })).resolves.toEqual({ ok: true, disposition: 'sent' });
    expect(fake.invoked('side.sendToMain')).toEqual([{ appSessionId: PARENT, anchor, text: 'Should this be monthly?', screenshot: null }]);
    const sent = sendComment('thread', { parent: PARENT, anchor, text: 'Should this be monthly?', screenshot: null }, { reveal: () => false });
    await act(() => fake.reply('side.thread.open', { status: 'starting', appSessionId: 'c3333333-3333-4333-8333-333333333333' }));
    await sent;
    expect(fake.invoked('side.thread.open')).toEqual([{ appSessionId: PARENT, from: { kind: 'comment', anchor, text: 'Should this be monthly?', screenshot: null } }]);
    for (const destination of ['thread', 'main'] as const) {
      expect(parseAnchoredText(anchoredMessage({ anchor, text: 'Should this be monthly?', destination, screenshot: false }))).toEqual({ anchor, text: 'Should this be monthly?', destination });
    }
  });
});

// The editor's side, as DocumentEditor hands it to the overlay: a real threads map, the rest spies.
function editorReach(doc: Doc): CommentOverlayProps {
  return {
    doc,
    locate: vi.fn((threadId: string) => (threadId === passage.threadId ? PASSAGE : null)),
    layoutKey: 'k1',
    setActive: vi.fn(),
    resolve: vi.fn((threadId: string) => resolveThread(doc, threadId, { kind: 'human' }, 1)),
    reopen: vi.fn(),
    record: vi.fn(),
    discard: vi.fn(),
    focus: vi.fn(),
  };
}

function Editor({ reach, onOpen, holdReplica }: { reach: CommentOverlayProps; onOpen(open: (p: typeof passage) => void): void; holdReplica?: () => () => void }) {
  const comments = useDocumentComments({ artifactId: ARTIFACT, appSessionId: PARENT, title: 'Q3 plan', holdReplica });
  onOpen(comments.opened);
  return <div className="relative">{comments.overlay(reach)}</div>;
}

function mount() {
  const doc = newDoc();
  addThread(doc, { threadId: passage.threadId, tabId: 'tab1', blockId: 'p1', quote: passage.quote, anchor: { start: null, end: null, block: null }, by: { kind: 'human' }, at: 1 });
  const reach = editorReach(doc);
  let open: ((p: typeof passage) => void) | null = null;
  render(<Editor reach={reach} onOpen={(o) => (open = o)} />);
  return { doc, reach, comment: () => act(() => open!(passage)) };
}
const card = () => document.querySelector<HTMLElement>('[data-comment-card]');
const field = () => screen.getByRole('textbox', { name: 'Comment' }) as HTMLTextAreaElement;

describe('the card on a document', () => {
  it('opens on the artifact target in this editor’s host, pinned under the passage, its thread drawn active', async () => {
    const { reach, comment } = mount();
    comment();
    await act(async () => {});
    const open = useCommentCard.getState().open!;
    expect(open).toMatchObject({ host: 'artifact', target: { kind: 'artifact', artifactId: ARTIFACT, threadId: passage.threadId }, anchor: { kind: 'artifact-comment', threadId: passage.threadId } });
    expect(card()!.dataset.anchorKind).toBe('artifact-comment');
    expect(card()!.style).toMatchObject({ left: `${PASSAGE.x}px`, top: `${PASSAGE.y + PASSAGE.height + 4}px` });
    expect(reach.setActive).toHaveBeenLastCalledWith(passage.threadId);
  });

  it('Resolve closes the card and resolves the thread; a resolved thread’s card offers Reopen', async () => {
    const { doc, reach, comment } = mount();
    comment();
    await act(async () => {});
    await userEvent.click(screen.getByRole('button', { name: 'Resolve' }));
    expect(reach.resolve).toHaveBeenCalledWith(passage.threadId);
    expect(threadStatus(doc, passage.threadId)).toBe('resolved');
    expect(card()).toBeNull();
    expect(reach.discard).not.toHaveBeenCalled(); // resolved on purpose, it stays (listed under Resolved)

    comment();
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: 'Reopen' }));
    expect(reach.reopen).toHaveBeenCalledWith(passage.threadId);
  });

  it('records a sent comment in the thread and keeps it; withdraws one closed unsent', async () => {
    const { reach, comment } = mount();
    comment();
    await act(async () => {});
    await userEvent.click(screen.getByRole('radio', { name: 'Send to main' }));
    await userEvent.type(field(), 'Should this be monthly?{Enter}');
    expect(reach.record).toHaveBeenCalledWith(passage.threadId, 'Should this be monthly?');
    expect(card()).toBeNull();
    expect(reach.discard).not.toHaveBeenCalled();

    comment();
    await act(async () => {});
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(reach.discard).toHaveBeenCalledWith(passage.threadId);
    expect(reach.setActive).toHaveBeenLastCalledWith(null);
    expect(reach.focus).toHaveBeenCalled();
  });
});

// Fix wave 1 (the task review's finding 1): P2's send completes after its card went, by design (a Side thread the card
// no longer shows is revealed; a late refusal is a toast), so a comment whose send set out is no draft: the thread stays
// whatever becomes of its card or its host, and the comment is recorded in it when the send went. Only a draft nothing
// was sent in, or whose send was refused, is withdrawn.
describe('a comment on its way outlives its card', () => {
  const CHILD = 'b2222222-2222-4222-8222-222222222222';
  const second = { threadId: 'p7q1w3ze', tabId: 'tab1', tabTitle: 'Main', quote: 'with design review' };

  // The editor's reach over a real threads map, as DocumentEditor's records and discards.
  function liveReach(doc: Doc): CommentOverlayProps {
    return {
      ...editorReach(doc),
      record: vi.fn((threadId: string, body: string) => {
        if (getThread(doc, threadId)) reply(doc, threadId, { id: `${threadId}:m1`, by: { kind: 'human' }, at: 2, body });
      }),
      discard: vi.fn((threadId: string) => void discardThread(doc, threadId)),
    };
  }
  function mountLive(holdReplica?: () => () => void) {
    const doc = newDoc();
    for (const p of [passage, second]) addThread(doc, { threadId: p.threadId, tabId: 'tab1', blockId: 'p1', quote: p.quote, anchor: { start: null, end: null, block: null }, by: { kind: 'human' }, at: 1 });
    const reach = liveReach(doc);
    let open: ((p: typeof passage) => void) | null = null;
    const view = render(<Editor reach={reach} onOpen={(o) => (open = o)} holdReplica={holdReplica} />);
    return { doc, reach, view, comment: (p: typeof passage = passage) => act(() => open!(p)) };
  }
  const bodies = (doc: Doc, threadId: string) => getThread(doc, threadId)?.messages.map((message) => message.body) ?? null;
  async function sendSideThread(text: string) {
    await userEvent.type(field(), `${text}{Enter}`);
    expect(fake.invoked('side.thread.open')).toHaveLength(1);
  }

  it('Send then Close: the thread stays and the comment is recorded once the request answers', async () => {
    const { doc, comment } = mountLive();
    comment();
    await act(async () => {});
    await sendSideThread('Please explain');
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(getThread(doc, passage.threadId), 'withdrawn under the send').not.toBeNull();
    await act(() => fake.reply('side.thread.open', { status: 'starting', appSessionId: CHILD }));
    expect(bodies(doc, passage.threadId)).toEqual(['Please explain']);
  });

  it('Send then another comment replacing the card: the first thread stays with its comment', async () => {
    const { doc, comment } = mountLive();
    comment();
    await act(async () => {});
    await sendSideThread('Please explain');
    comment(second);
    await act(async () => {});
    expect(useCommentCard.getState().open?.target).toMatchObject({ threadId: second.threadId });
    expect(getThread(doc, passage.threadId), 'withdrawn under the send').not.toBeNull();
    await act(() => fake.reply('side.thread.open', { status: 'starting', appSessionId: CHILD }));
    expect(bodies(doc, passage.threadId)).toEqual(['Please explain']);
  });

  it('Send then the editor unmounting: the thread stays with its comment', async () => {
    const { doc, view, comment } = mountLive();
    comment();
    await act(async () => {});
    await sendSideThread('Please explain');
    view.unmount();
    expect(getThread(doc, passage.threadId), 'withdrawn under the send').not.toBeNull();
    await act(() => fake.reply('side.thread.open', { status: 'starting', appSessionId: CHILD }));
    expect(bodies(doc, passage.threadId)).toEqual(['Please explain']);
  });

  // Decision Log 27, M8's: a send may land after the editor and its tab went; the tab keeps the replica the message is
  // recorded in until the send settles, held from the moment it sets out.
  // The overlay holds the replica while mounted and through its withdrawal a microtask after it went (fix wave 2); a send
  // holds it from its setting out until it settled, whatever went meanwhile (Decision Log 27).
  it('holds the replica while the overlay is mounted and from a send’s setting out until it settles', async () => {
    let active = 0;
    const holdReplica = vi.fn(() => {
      active += 1;
      let released = false;
      return () => {
        if (!released) active -= 1;
        released = true;
      };
    });
    const { doc, view, comment } = mountLive(holdReplica);
    expect(active).toBe(1); // the overlay
    comment();
    await act(async () => {});
    await sendSideThread('Please explain');
    expect(active).toBe(2); // and the send
    view.unmount();
    expect(active).toBe(2); // the overlay's release waits for its queued withdrawal
    await act(async () => {});
    expect(active).toBe(1); // the send's stays
    await act(() => fake.reply('side.thread.open', { status: 'starting', appSessionId: CHILD }));
    expect(bodies(doc, passage.threadId)).toEqual(['Please explain']);
    expect(active).toBe(0);
  });

  it('a send refused after its card went withdraws the draft (P2 toasts the refusal)', async () => {
    const { doc, comment } = mountLive();
    comment();
    await act(async () => {});
    await sendSideThread('Please explain');
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    await act(() => fake.reply('side.thread.open', { status: 'refused', appSessionId: CHILD, reason: 'no_engine_session', message: 'Not yet' }));
    expect(getThread(doc, passage.threadId)).toBeNull();
    expect(useNotices.getState().notices).toHaveLength(1);
  });

  it('a send refused while its card shows leaves a draft: Close then withdraws it', async () => {
    const { doc, comment } = mountLive();
    comment();
    await act(async () => {});
    await sendSideThread('Please explain');
    await act(() => fake.reply('side.thread.open', { status: 'refused', appSessionId: CHILD, reason: 'no_engine_session', message: 'Not yet' }));
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(bodies(doc, passage.threadId)).toEqual([]);
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(getThread(doc, passage.threadId)).toBeNull();
  });
});
