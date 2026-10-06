// What an anchored comment sends the agent (E3 execution document, Design §2 and §9): `[image?, text]`, the image first
// as the composer orders blocks, the text X10's anchored message. The screenshot travels only as the comment's own
// `screenshot` (M1's review): an anchor's `screenshot` field, if a producer set one, is stripped before the anchor
// reaches the text, the lineage, the index or an event, and its path is never opened.
import type { Anchor, AnchorScreenshot } from '@shared/anchor/anchor';
import { anchoredMessage, type Destination } from '@shared/anchor/message';
import type { ContentBlock } from '@shared/graph/events';
import type { SessionRecord } from '@shared/graph/session';
import { rootsOf } from '../files/allowlist';
import { readScreenshotBlock } from './screenshot';

export function withoutScreenshot(anchor: Anchor): Anchor {
  const { screenshot: _ignored, ...rest } = anchor;
  return rest;
}

// The roots a screenshot may lie under: `<userData>/` (E2's and E4's captures) and the session's own directories.
export async function screenshotRoots(userData: string, session: Pick<SessionRecord, 'directory' | 'additionalDirectories' | 'worktree'>): Promise<string[]> {
  return [userData, ...(await rootsOf(session))];
}

export async function commentContent(
  comment: { anchor: Anchor; text: string; screenshot: AnchorScreenshot | null; destination: Destination },
  roots: () => Promise<string[]>,
): Promise<ContentBlock[]> {
  const anchor = withoutScreenshot(comment.anchor);
  const image = comment.screenshot === null ? null : await readScreenshotBlock(comment.screenshot.path, await roots());
  const text = anchoredMessage({ anchor, text: comment.text, destination: comment.destination, screenshot: image !== null });
  return [...(image === null ? [] : [image]), { type: 'text', text }];
}
