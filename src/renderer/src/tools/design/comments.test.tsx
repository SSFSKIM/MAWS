// P3-E1 M4 (docs/doperpowers/plans/2026-10-16-p3-e1-design-workbench.md, M4; the P3-E spec's Decision Log 12): a design's
// comment opens P2's card through B's surface on an `artifact-comment` anchor naming the design kind and its target, a
// board or an element, so the agent's lead says which; a deck's and a document's anchors stay as they were written.
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CommentedPassage } from '@artifacts/document/editor/comments/surface';
import { anchoredMessage } from '@shared/anchor/message';
import type { AppSessionId } from '@shared/graph/ids';
import { record, status } from '../../../../../test/support/builders';
import { useCommentCard } from '../../side/card/store';
import { openComment } from '../../side/register';
import { useSessions } from '../../stores/sessions';
import { resetShellStores } from '../../test-support/shell-stores';
import { registerCommentComposer } from '../code/anchor/anchor';
import { artifactCommentAnchor, useDocumentComments } from '../document/comments';

const PARENT = 'a1111111-1111-4111-8111-111111111111' as AppSessionId;
const onBoard: CommentedPassage = { threadId: 't1', tabId: 'phone', tabTitle: 'Phone', quote: 'Phone', artifactTarget: 'board' };
const onElement: CommentedPassage = { threadId: 't2', tabId: 'phone', tabTitle: 'Phone', quote: 'Ship the first week.', artifactTarget: 'element' };

let offComposer: () => void;
beforeEach(() => {
  resetShellStores();
  offComposer = registerCommentComposer(openComment);
  const s = useSessions.getState();
  useSessions.setState({ records: new Map([[PARENT, record(PARENT)]]), engine: new Map([[PARENT, status(PARENT, { process: 'ready' } as never)]]), recordsVersion: s.recordsVersion + 1 });
});
afterEach(() => {
  cleanup();
  offComposer();
  useCommentCard.setState({ open: null });
});

describe('a design comment’s anchor', () => {
  it('names the design kind and its target, and the lead names the board or the element and the design', () => {
    const board = artifactCommentAnchor({ artifactId: 'design-1', title: 'Launch screens', ...onBoard, artifactKind: 'design' });
    expect(board).toEqual({ kind: 'artifact-comment', label: 'Launch screens, Phone', locator: 'Phone', artifactId: 'design-1', threadId: 't1', artifactKind: 'design', artifactTarget: 'board' });
    expect(anchoredMessage({ anchor: board, text: 'Taller?', destination: 'main', screenshot: false }).split('\n')[0]).toBe('Comment on "Launch screens, Phone" (board "Phone" in design design-1, thread t1):');
    const element = artifactCommentAnchor({ artifactId: 'design-1', title: 'Launch screens', ...onElement, artifactKind: 'design' });
    expect(anchoredMessage({ anchor: element, text: 'Shorter?', destination: 'main', screenshot: false }).split('\n')[0]).toBe('Comment on "Launch screens, Phone" (element "Ship the first week." in design design-1, thread t2):');
    const { artifactTarget: _, ...deckPassage } = onElement;
    expect(artifactCommentAnchor({ artifactId: 'deck-1', title: 'Q3 review', ...deckPassage, artifactKind: 'presentation' })).not.toHaveProperty('artifactTarget'); // a deck's, as C writes it
  });

  it('is what the surface opens the card on', async () => {
    let opened: ((p: CommentedPassage) => void) | null = null;
    function Design() {
      const comments = useDocumentComments({ artifactId: 'design-1', appSessionId: PARENT, title: 'Launch screens', artifactKind: 'design' });
      opened = comments.opened;
      return null;
    }
    render(<Design />);
    act(() => opened!(onBoard));
    await act(async () => {});
    expect(useCommentCard.getState().open?.anchor).toMatchObject({ kind: 'artifact-comment', artifactKind: 'design', artifactTarget: 'board', threadId: 't1', locator: 'Phone' });
  });
});
