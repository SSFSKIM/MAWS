// The document's comment card (P3-B M4 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md, D9; X21's artifact
// target): a passage the editor commented opens P2's card through the composer seam on an `artifact-comment` anchor and
// the artifact target, drawn by the editor's host pinned where the editor locates the passage; Side thread and Send to
// main carry the anchor, whose tag round-trips; the card resolves and reopens its thread; a sent comment is recorded in
// the thread and an unsent one withdrawn.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { addThread, discardThread, getThread, reply, resolve as resolveThread, threadStatus } from '@artifacts/document/threads';
import type { CommentOverlayProps, DocumentComments } from '@artifacts/document/editor/comments/surface'; // P4-B1: DocumentComments
import { newDoc, type Doc } from '@artifacts/yjs';
import { AnchorSchema } from '@shared/anchor/anchor';
import { anchoredMessage, parseAnchoredText } from '@shared/anchor/message';
import type { AppSessionId } from '@shared/graph/ids';
import { record, status } from '../../../../../test/support/builders';
import { fakeClient, type FakeClient } from '../../../../../test/support/fake-client';
import type { sendHumanPrompt } from '../../composer/submit/send-human-prompt'; // P3-F (L154)
import { sendComment } from '../../side/actions';
import { useCommentCard } from '../../side/card/store';
import { openComment } from '../../side/register';
import { useNotices } from '../../stores/notices';
import { useSessions } from '../../stores/sessions';
import { resetShellStores } from '../../test-support/shell-stores';
import { registerCommentComposer } from '../code/anchor/anchor';
import { commentDraftOf } from './comment-drafts'; // P4-B1
import { artifactCommentAnchor, forgetCardActivation, useDocumentComments } from './comments';

// P3-F (L154): the card thread's Reply goes through the human send seam (one spy for every run of the factory, as
// CardThread.test.tsx explains)
const seam = vi.hoisted(() => vi.fn<typeof sendHumanPrompt>());
vi.mock('../../composer/submit/send-human-prompt', async (original) => ({ ...(await original<typeof import('../../composer/submit/send-human-prompt')>()), sendHumanPrompt: seam }));

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

  // P4 W1-B (tracker L275): a default tab carries the document's title, and "P3 sitting note, P3 sitting note" said it twice
  it('names the tab only when it adds something to the title', () => {
    const label = (title: string, tabTitle: string) => artifactCommentAnchor({ artifactId: ARTIFACT, title, ...passage, tabTitle }).label;
    expect(label('P3 sitting note', 'P3 sitting note')).toBe('P3 sitting note');
    expect(label('P3 sitting note', ' p3  Sitting note ')).toBe('P3 sitting note');
    expect(label('P3 sitting note', '')).toBe('P3 sitting note');
    expect(label('P3 sitting note', 'Appendix')).toBe('P3 sitting note, Appendix');
    expect(label('T'.repeat(300), 'T'.repeat(300))).toHaveLength(200); // LABEL_MAX still caps
    expect(label('T'.repeat(300), 'Appendix')).toHaveLength(200);
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

// P4-B1 (D7, D8 of docs/doperpowers/plans/2026-10-20-p4-b1-margin-comments.md; the prior art's C3 to C7; X36's draft
// rule): in the margin the card host is a block in the hosting thread's entry, told which thread that is; the document's
// card keeps a typed draft on Escape and through a remount, discards an empty one on Escape or a blur, posts on ⌘Enter,
// and its draft is the artifact's one draft, which the editor's next Comment refocuses.
describe('the compose card in the margin and the draft rule', () => {
  // `slot`: where the overlay is drawn; a new slot remounts it under the same surface (the margin moving it, a tab switch)
  // `draftRule`: the document's opt-in (DocumentPanel); a deck or a design leaves it out
  function MarginEditor({ reach, onSurface, slot = 'a', draftRule = true }: { reach: CommentOverlayProps; onSurface(surface: DocumentComments): void; slot?: string; draftRule?: boolean }) {
    const comments = useDocumentComments({ artifactId: ARTIFACT, appSessionId: PARENT, title: 'Q3 plan', ...(draftRule && { draftRule }) });
    onSurface(comments);
    return (
      <div className="ds-doc">
        <div key={slot} data-margin-entry={passage.threadId}>
          {comments.overlay(reach)}
        </div>
        <button type="button">Elsewhere</button>
      </div>
    );
  }
  function mountMargin({ placement = 'margin', draftRule = true }: { placement?: 'margin' | null; draftRule?: boolean } = {}) {
    const doc = newDoc();
    addThread(doc, { threadId: passage.threadId, tabId: 'tab1', blockId: 'p1', quote: passage.quote, anchor: { start: null, end: null, block: null }, by: { kind: 'human' }, at: 1 });
    const reach: CommentOverlayProps = { ...editorReach(doc), hosting: vi.fn(), ...(placement && { placement }) };
    let surface: DocumentComments | null = null;
    const view = render(<MarginEditor reach={reach} onSurface={(s) => (surface = s)} draftRule={draftRule} />);
    return {
      reach,
      view,
      surface: () => surface!,
      comment: () => act(() => surface!.opened(passage)),
      // the overlay drawn again elsewhere (a tab switch; the margin's cards giving way to the panel): a new host, the same card
      remount: (slot = 'b') => view.rerender(<MarginEditor reach={reach} onSurface={(s) => (surface = s)} slot={slot} draftRule={draftRule} />),
    };
  }
  const opened = async (m: ReturnType<typeof mountMargin>) => {
    m.comment();
    await act(async () => {});
  };

  it('opens with a margin placement, drawn in flow in the entry, and tells the margin the thread it is on', async () => {
    const seen = vi.fn(openComment);
    offComposer();
    offComposer = registerCommentComposer(seen);
    const m = mountMargin();
    await opened(m);
    expect(seen.mock.calls[0]![1].placement).toEqual({ kind: 'margin', host: 'document', hostId: expect.stringMatching(/^document:/), anchorY: PASSAGE.y });
    expect(useCommentCard.getState().open).toMatchObject({ host: 'artifact', hostId: (seen.mock.calls[0]![1].placement as { hostId: string }).hostId });
    const host = document.querySelector<HTMLElement>('[data-card-host]')!;
    expect(host.hasAttribute('data-card-margin')).toBe(true);
    expect(card()!.dataset.placement).toBe('margin');
    expect(card()!.className).toContain('relative');
    expect(m.reach.hosting).toHaveBeenLastCalledWith(passage.threadId);
    expect(m.reach.setActive).toHaveBeenLastCalledWith(passage.threadId);
  });

  it('over the frame (no margin), it opens as a card placement and is drawn anchored', async () => {
    const seen = vi.fn(openComment);
    offComposer();
    offComposer = registerCommentComposer(seen);
    const m = mountMargin({ placement: null });
    await opened(m);
    expect(seen.mock.calls[0]![1].placement).toMatchObject({ kind: 'card', host: 'artifact' });
    expect(card()!.dataset.placement).toBe('below');
    expect(m.reach.hosting).toHaveBeenLastCalledWith(passage.threadId);
  });

  it('reports no thread at once when the overlay goes, and the thread again from its remount, the card kept', async () => {
    const m = mountMargin();
    await opened(m);
    const hosting = vi.mocked(m.reach.hosting!);
    hosting.mockClear();
    m.remount();
    expect(hosting.mock.calls).toEqual([[null], [passage.threadId]]);
    await act(async () => {});
    expect(card()).not.toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(hosting).toHaveBeenLastCalledWith(null);
  });

  // P4-B1 (review finding 5): only the human activates; the host activates its card's thread when the card opens, and a
  // remount of the host (the margin moving it, the panel's round trip) draws the same card without activating again
  it('a remount with the same composing card does not activate its thread again', async () => {
    const m = mountMargin();
    await opened(m);
    const setActive = vi.mocked(m.reach.setActive);
    expect(setActive).toHaveBeenLastCalledWith(passage.threadId);
    setActive.mockClear();
    m.remount();
    m.remount('c');
    await act(async () => {});
    expect(card()).not.toBeNull();
    expect(setActive).not.toHaveBeenCalled();
    expect(m.reach.hosting).toHaveBeenLastCalledWith(passage.threadId); // the margin still told the thread it is on
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(setActive).toHaveBeenLastCalledWith(null); // the card closing still clears what it drew
  });

  // P4-B3 M6 (the transfer e2e): a document moved between the panel and a main tab is a new body over the tab state that
  // travels; with a host id of its own each body was a new host, so the old one going withdrew the draft's thread and
  // dropped its text. The tab state's host id makes the new body the same host, as a remount is.
  it('a host id the caller keeps (the tab state’s) carries the composing card and its draft to another body', async () => {
    const doc = newDoc();
    addThread(doc, { threadId: passage.threadId, tabId: 'tab1', blockId: 'p1', quote: passage.quote, anchor: { start: null, end: null, block: null }, by: { kind: 'human' }, at: 1 });
    const reach: CommentOverlayProps = { ...editorReach(doc), hosting: vi.fn(), placement: 'margin' };
    let surface: DocumentComments | null = null;
    function Body({ hostId, onSurface }: { hostId?: string; onSurface(surface: DocumentComments): void }) {
      const comments = useDocumentComments({ artifactId: ARTIFACT, appSessionId: PARENT, title: 'Q3 plan', draftRule: true, ...(hostId !== undefined && { hostId }) });
      onSurface(comments);
      return (
        <div className="ds-doc">
          <div data-margin-entry={passage.threadId}>{comments.overlay(reach)}</div>
        </div>
      );
    }
    const onSurface = (next: DocumentComments) => (surface = next);
    const view = render(<Body key="panel" hostId="document:tab-state-1" onSurface={onSurface} />);
    act(() => surface!.opened(passage));
    await act(async () => {});
    await userEvent.type(field(), 'Monthly?');
    vi.mocked(reach.setActive).mockClear();
    forgetCardActivation('document:tab-state-1'); // the move's capture (Decision Log 37): a new editor, active at none
    view.rerender(<Body key="main" hostId="document:tab-state-1" onSurface={onSurface} />); // the move: another body, one commit
    await act(async () => {});
    expect(reach.setActive, 'the card activates its thread in the editor it moved to').toHaveBeenLastCalledWith(passage.threadId);
    expect(field().value).toBe('Monthly?');
    expect(commentDraftOf(ARTIFACT)).toEqual({ threadId: passage.threadId, text: 'Monthly?' });
    expect(reach.discard).not.toHaveBeenCalled();
    expect(surface!.draft!()).toBe(passage.threadId);
  });

  it('records the typed draft as the artifact’s, which draft() names; an emptied field or the card closing clears it', async () => {
    const m = mountMargin();
    await opened(m);
    expect(commentDraftOf(ARTIFACT)).toBeNull();
    expect(m.surface().draft!()).toBeNull();
    await userEvent.type(field(), 'Monthly?');
    expect(commentDraftOf(ARTIFACT)).toEqual({ threadId: passage.threadId, text: 'Monthly?' });
    expect(m.surface().draft!()).toBe(passage.threadId);
    await userEvent.clear(field());
    expect(commentDraftOf(ARTIFACT)).toBeNull();
    expect(m.surface().draft!()).toBeNull();
    await userEvent.type(field(), 'Again');
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(commentDraftOf(ARTIFACT)).toBeNull();
    expect(m.surface().draft!()).toBeNull();
  });

  it('focusDraft() puts the keyboard at the end of the draft’s field', async () => {
    const m = mountMargin();
    await opened(m);
    await userEvent.type(field(), 'Monthly?');
    screen.getByRole('button', { name: 'Elsewhere' }).focus();
    act(() => m.surface().focusDraft!());
    expect(document.activeElement).toBe(field());
    expect(field().selectionStart).toBe('Monthly?'.length);
    expect(field().selectionEnd).toBe('Monthly?'.length);
  });

  it('Escape on a typed draft keeps the card and its draft and gives the text the keyboard; on an empty one it discards (C6)', async () => {
    const m = mountMargin();
    await opened(m);
    await userEvent.type(field(), 'Monthly?');
    fireEvent.keyDown(field(), { key: 'Escape' });
    expect(card()).not.toBeNull();
    expect(field().value).toBe('Monthly?');
    expect(m.reach.focus).toHaveBeenCalledTimes(1);
    expect(m.reach.discard).not.toHaveBeenCalled();
    expect(commentDraftOf(ARTIFACT)?.text).toBe('Monthly?');

    await userEvent.clear(field());
    fireEvent.keyDown(field(), { key: 'Escape' });
    expect(card()).toBeNull();
    expect(m.reach.discard).toHaveBeenCalledWith(passage.threadId);
    expect(m.reach.focus).toHaveBeenCalledTimes(2);
  });

  it('a blur to elsewhere with an empty field discards the card; with text it stays (C4, C5)', async () => {
    const m = mountMargin();
    await opened(m);
    const elsewhere = screen.getByRole('button', { name: 'Elsewhere' });
    await userEvent.type(field(), 'Monthly?');
    act(() => elsewhere.focus());
    expect(card()).not.toBeNull();
    await userEvent.clear(field());
    act(() => field().focus());
    act(() => elsewhere.focus());
    expect(card()).toBeNull();
    expect(m.reach.discard).toHaveBeenCalledWith(passage.threadId);
    expect(m.reach.focus).not.toHaveBeenCalled(); // the focus stays where the person put it
  });

  // Review finding 2: in Chromium a click on something unfocusable (the margin, the page's ground) blurs to null, as the
  // window losing focus does; the document still having focus on the next task tells them apart
  it('a blur to nowhere with an empty field: a click on the background discards; the window losing focus keeps it (C4)', async () => {
    const m = mountMargin();
    await opened(m);
    const hasFocus = vi.spyOn(document, 'hasFocus');
    hasFocus.mockReturnValue(false);
    act(() => field().blur());
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(card()).not.toBeNull(); // the window went: no choice to leave the card
    hasFocus.mockReturnValue(true);
    await userEvent.type(field(), 'Monthly?');
    act(() => field().blur());
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(card()).not.toBeNull(); // a typed draft stays
    await userEvent.clear(field());
    act(() => field().blur());
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(card()).toBeNull(); // a click on the background, the field empty
    expect(m.reach.discard).toHaveBeenCalledWith(passage.threadId);
    hasFocus.mockRestore();
  });

  it('a click on the card’s body puts the caret at the end of its field (C5)', async () => {
    const m = mountMargin();
    await opened(m);
    await userEvent.type(field(), 'Monthly?');
    fireEvent.keyDown(field(), { key: 'Escape' });
    await userEvent.click(card()!.querySelector('h3')!);
    expect(document.activeElement).toBe(field());
    expect(field().selectionStart).toBe('Monthly?'.length);
  });

  it('⌘Enter posts beside Enter (C3)', async () => {
    const m = mountMargin();
    await opened(m);
    await userEvent.click(screen.getByRole('radio', { name: 'Send to main' }));
    await userEvent.type(field(), 'Should this be monthly?');
    await userEvent.keyboard('{Meta>}{Shift>}{Enter}{/Shift}{/Meta}');
    expect(m.reach.record).toHaveBeenCalledWith(passage.threadId, 'Should this be monthly?');
    expect(card()).toBeNull();
  });

  it('a remounted card gets its typed draft back (a hidden card keeps its draft)', async () => {
    const m = mountMargin();
    await opened(m);
    await userEvent.type(field(), 'Monthly?');
    m.remount();
    await act(async () => {});
    expect(field().value).toBe('Monthly?');
    expect(m.surface().draft!()).toBe(passage.threadId);
  });

  // Review finding 3: the field takes the keyboard on the card's first showing and on a remount that had it, never on
  // one whose owner had left it (C6: Escape gave the text the keyboard)
  it('a kept draft drawn again does not take the keyboard; a card that had it keeps it; focusDraft() still takes it', async () => {
    const m = mountMargin();
    await opened(m);
    expect(document.activeElement).toBe(field());
    m.remount(); // the overlay moving into the thread's entry right after the card opened
    await act(async () => {});
    expect(document.activeElement).toBe(field());
    await userEvent.type(field(), 'Monthly?');
    const elsewhere = screen.getByRole('button', { name: 'Elsewhere' });
    act(() => elsewhere.focus()); // the owner left the draft (Escape gives the text the keyboard)
    m.remount('c'); // the panel opening, a tab switch, a tier swap
    await act(async () => {});
    expect(field().value).toBe('Monthly?');
    expect(document.activeElement).toBe(elsewhere);
    act(() => m.surface().focusDraft!());
    expect(document.activeElement).toBe(field());
  });

  // Review finding 1: the draft rule is the document's opt-in; a deck's or a design's card (no draft() asked, no close
  // guard reading it) keeps today's Escape and blur, and records nothing
  it('without the opt-in (a deck, a design): Escape discards a typed comment, a blur keeps an empty one, nothing is recorded', async () => {
    const m = mountMargin({ draftRule: false });
    expect(m.surface().draft).toBeUndefined();
    expect(m.surface().focusDraft).toBeUndefined();
    await opened(m);
    act(() => screen.getByRole('button', { name: 'Elsewhere' }).focus());
    expect(card()).not.toBeNull(); // no blur rule
    act(() => field().focus());
    await userEvent.type(field(), 'Monthly?');
    expect(commentDraftOf(ARTIFACT)).toBeNull();
    fireEvent.keyDown(field(), { key: 'Escape' });
    expect(card()).toBeNull();
    expect(m.reach.discard).toHaveBeenCalledWith(passage.threadId);
  });

  it('the editor going drops its draft', async () => {
    const m = mountMargin();
    await opened(m);
    await userEvent.type(field(), 'Monthly?');
    m.view.unmount();
    await act(async () => {});
    expect(commentDraftOf(ARTIFACT)).toBeNull();
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

  // P3-F (L154; B's Decision Log 26 residue): a message typed later in the Side thread's own reply box, the card's
  // Reply, reaches the document's thread as the comment did, once it went
  it('records a later reply typed in the card’s thread as the thread’s next message; a refused one is not recorded', async () => {
    const { doc, reach, comment } = mountLive();
    let n = 0;
    vi.mocked(reach.record).mockImplementation((threadId: string, body: string) => {
      if (getThread(doc, threadId)) reply(doc, threadId, { id: `${threadId}:r${++n}`, by: { kind: 'human' }, at: 2 + n, body });
    });
    comment();
    await act(async () => {});
    await sendSideThread('Please explain');
    act(() => useSessions.setState({ records: new Map(useSessions.getState().records).set(CHILD as AppSessionId, record(CHILD as AppSessionId)) }));
    await act(() => fake.reply('side.thread.open', { status: 'starting', appSessionId: CHILD }));
    expect(card()!.dataset.cardPhase).toBe('thread');
    const replyField = () => screen.getByRole('textbox', { name: 'Reply' }) as HTMLTextAreaElement;
    expect(replyField().disabled).toBe(false);

    seam.mockResolvedValueOnce({ disposition: 'sent', started: false });
    await userEvent.type(replyField(), 'Also the subtitle{Enter}');
    await waitFor(() => expect(bodies(doc, passage.threadId)).toEqual(['Please explain', 'Also the subtitle']));
    expect(seam.mock.calls.map(([id, content]) => [id, content])).toEqual([[CHILD, 'Also the subtitle']]);

    seam.mockResolvedValueOnce({ disposition: 'refused', started: false, reason: 'The session is starting' });
    await userEvent.type(replyField(), 'Not this one{Enter}');
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('The session is starting'));
    expect(bodies(doc, passage.threadId)).toEqual(['Please explain', 'Also the subtitle']);
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
