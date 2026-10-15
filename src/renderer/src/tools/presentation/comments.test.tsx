// P3-C M7 fix wave 1 (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D9; Decision Log 33, 35): a deck's
// comment opens P2's card through B's surface on an `artifact-comment` anchor that names the presentation kind, so the
// agent's lead names the element, its slide and the presentation; a document's anchor stays as B writes it.
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
const passage = { threadId: 't1', tabId: 's3', tabTitle: 'slide 3: Plan', quote: 'One path' };

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

describe('a deck comment’s anchor', () => {
  it('names the presentation kind, and the lead names the element, its slide and the presentation', () => {
    const anchor = artifactCommentAnchor({ artifactId: 'deck-1', title: 'Q3 review', ...passage, artifactKind: 'presentation' });
    expect(anchor).toEqual({ kind: 'artifact-comment', label: 'Q3 review, slide 3: Plan', locator: 'One path', artifactId: 'deck-1', threadId: 't1', artifactKind: 'presentation' });
    expect(anchoredMessage({ anchor, text: 'Shorter?', destination: 'main', screenshot: false }).split('\n')[0]).toBe('Comment on "Q3 review, slide 3: Plan" (element "One path" on slide 3 of presentation deck-1, thread t1):');
    expect(artifactCommentAnchor({ artifactId: 'doc-1', title: 'Plan', ...passage })).not.toHaveProperty('artifactKind'); // a document's, as B writes it
  });

  it('is what the surface opens the card on when the deck gives its kind', async () => {
    let opened: ((p: typeof passage) => void) | null = null;
    function Deck() {
      const comments = useDocumentComments({ artifactId: 'deck-1', appSessionId: PARENT, title: 'Q3 review', artifactKind: 'presentation' });
      opened = comments.opened;
      return null;
    }
    render(<Deck />);
    act(() => opened!(passage));
    await act(async () => {});
    expect(useCommentCard.getState().open?.anchor).toMatchObject({ kind: 'artifact-comment', artifactKind: 'presentation', threadId: 't1' });
  });
});
