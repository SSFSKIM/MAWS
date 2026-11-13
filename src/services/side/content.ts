// What an anchored comment sends the agent from the machine's side (E3 execution document, Design §2 and §9): the
// content is built by src/shared/anchor/content.ts (UX wave U5a: one or several comments; moved there so the app's main
// process builds a send's content with the same code), under the roots a session's screenshot may lie under here.
import type { Destination } from '@shared/anchor/message';
import { commentsContent, type ContentComment } from '@shared/anchor/content';
import type { ContentBlock } from '@shared/graph/events';
import type { SessionRecord } from '@shared/graph/session';
import { rootsOf } from '../files/allowlist';

// The roots a screenshot may lie under: `<userData>/` (E2's and E4's captures) and the session's own directories.
export async function screenshotRoots(userData: string, session: Pick<SessionRecord, 'directory' | 'additionalDirectories' | 'worktree'>): Promise<string[]> {
  return [userData, ...(await rootsOf(session))];
}

// One comment, `[image?, text]` (`side.sendToMain`'s content, and before U5a `side.thread.open`'s).
export function commentContent(comment: ContentComment & { destination: Destination }, roots: () => Promise<string[]>): Promise<ContentBlock[]> {
  return commentsContent([comment], comment.destination, roots, () => []);
}
