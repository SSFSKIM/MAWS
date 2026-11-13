// What an anchored comment sends the agent (E3 execution document, Design §2 and §9): `[image?, text]`, the image first
// as the composer orders blocks, the text X10's anchored message. UX wave U5a (docs/doperpowers/plans/
// 2026-11-12-ux-wave-U5a-comment-card.md, Interfaces §B): several comments send `[images…, text]`, the screenshots in the
// comments' order and one text of them all (`commentsMessage`); one comment is the same content as before, to the byte. The screenshot travels only as the comment's own
// `screenshot` (M1's review): an anchor's `screenshot` field, if a producer set one, is stripped before the anchor
// reaches the text, the lineage, the index or an event, and its path is never opened.
import type { Anchor, AnchorScreenshot } from '@shared/anchor/anchor';
import { commentsMessage, type Destination } from '@shared/anchor/message';
import type { ContentBlock } from '@shared/graph/events';
import type { SessionRecord } from '@shared/graph/session';
import { rootsOf } from '../files/allowlist';
import { readScreenshotBlock, ScreenshotRefused } from './screenshot';

export function withoutScreenshot(anchor: Anchor): Anchor {
  const rest = { ...anchor };
  delete rest.screenshot;
  return rest;
}

// The roots a screenshot may lie under: `<userData>/` (E2's and E4's captures) and the session's own directories.
export async function screenshotRoots(userData: string, session: Pick<SessionRecord, 'directory' | 'additionalDirectories' | 'worktree'>): Promise<string[]> {
  return [userData, ...(await rootsOf(session))];
}

export interface ContentComment {
  anchor: Anchor;
  text: string;
  screenshot: AnchorScreenshot | null;
}

export function commentContent(comment: ContentComment & { destination: Destination }, roots: () => Promise<string[]>): Promise<ContentBlock[]> {
  return commentsContent([comment], comment.destination, roots, () => []);
}

// `at(i)` is where the i-th comment sits in the command's input (`[]` for `side.thread.open`'s first, `['more', i - 1]`
// for the others; `['comments', i]` for `side.comment.content`), which a refused screenshot names. The roots are read
// once, and only when a comment has a screenshot.
export async function commentsContent(comments: readonly ContentComment[], destination: Destination, roots: () => Promise<string[]>, at: (index: number) => (string | number)[]): Promise<ContentBlock[]> {
  let allowed: Promise<string[]> | null = null;
  const images: ContentBlock[] = [];
  for (const [index, { screenshot }] of comments.entries()) {
    if (screenshot === null) continue;
    allowed ??= roots();
    try {
      images.push(await readScreenshotBlock(screenshot.path, await allowed));
    } catch (error) {
      throw error instanceof ScreenshotRefused ? new ScreenshotRefused(error.reason, at(index)) : error;
    }
  }
  const text = commentsMessage(
    comments.map((comment) => ({ anchor: withoutScreenshot(comment.anchor), text: comment.text, screenshot: comment.screenshot !== null })),
    destination,
  );
  return [...images, { type: 'text', text }];
}
