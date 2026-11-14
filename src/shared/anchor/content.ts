// What one or several anchored comments send the agent (E3 execution document, Design §2 and §9; UX wave U5a,
// docs/doperpowers/plans/2026-11-12-ux-wave-U5a-comment-card.md, Interfaces §B): `[images…, text]`, the screenshots
// first in the comments' order, as the composer orders blocks, then one text of them all (`commentsMessage`); for one
// comment, `[image?, text]` with X10's anchored message, as before, to the byte. The screenshot travels only as the
// comment's own `screenshot` (M1's review): an anchor's `screenshot` field, if a producer set one, is stripped before the
// anchor reaches the text, and its path is never opened. Read by the machine's side (`side.thread.open`,
// `side.sendToMain`, through src/services/side/content.ts) and by the app's main process (`side.comment.content`).
import type { ContentBlock } from '../graph/events';
import type { Anchor, AnchorScreenshot } from './anchor';
import { commentsMessage, type Destination } from './message';
import { readScreenshotBlock, ScreenshotRefused } from './screenshot';

export interface ContentComment {
  anchor: Anchor;
  text: string;
  screenshot: AnchorScreenshot | null;
}

export function withoutScreenshot(anchor: Anchor): Anchor {
  const rest = { ...anchor };
  delete rest.screenshot;
  return rest;
}

// `at(i)` is where the i-th comment sits in the command's input (`[]` for the one comment of `side.sendToMain` and for
// `side.thread.open`'s first, `['more', i - 1]` for its others, `['comments', i]` for `side.comment.content`), which a
// refused screenshot names. The roots are asked for once, and only when a comment has a screenshot.
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
