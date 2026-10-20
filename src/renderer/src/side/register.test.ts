// P4-B1 (M4 of docs/doperpowers/plans/2026-10-20-p4-b1-margin-comments.md; the X21 amendment): the seam's opener sends a
// document's margin placement to the card store as its card host's card, as a card placement goes, not to the sheet.
import { afterEach, describe, expect, it } from 'vitest';
import type { Anchor } from '@shared/anchor/anchor';
import type { AppSessionId } from '@shared/graph/ids';
import { useCommentCard } from './card/store';
import { useCommentComposer } from './CommentComposer';
import { openComment } from './register';

const PARENT = 'a1111111-1111-4111-8111-111111111111' as AppSessionId;
const ANCHOR: Anchor = { kind: 'artifact-comment', label: 'Q3 plan', locator: 'ships quarterly', artifactId: 'art-0001', threadId: 'k2m9x0qa' };

afterEach(() => {
  useCommentCard.setState({ open: null, shownThread: null });
  useCommentComposer.setState({ open: null });
});

describe('openComment', () => {
  it('opens a margin placement as the document host’s card, claimed by that host, with no rect', () => {
    openComment(ANCHOR, { appSessionId: PARENT, placement: { kind: 'margin', host: 'document', hostId: 'document:r1', anchorY: 140 } });
    expect(useCommentCard.getState().open).toMatchObject({ host: 'artifact', hostId: 'document:r1', rect: null, target: { kind: 'artifact', artifactId: 'art-0001', threadId: 'k2m9x0qa' }, phase: { kind: 'composing' } });
    expect(useCommentComposer.getState().open).toBeNull(); // not the sheet
  });

  it('opens a card placement as before', () => {
    openComment(ANCHOR, { appSessionId: PARENT, placement: { kind: 'card', host: 'artifact', hostId: 'document:r2' } });
    expect(useCommentCard.getState().open).toMatchObject({ host: 'artifact', hostId: 'document:r2' });
  });
});
