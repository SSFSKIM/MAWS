// `side.comment.content` (UX wave U5a, docs/doperpowers/plans/2026-11-12-ux-wave-U5a-comment-card.md, decision 2 and
// Interfaces §B.2): the content a ticked comment, or a pass of several, sends the main conversation, which the window
// then hands to the session's own send. It is built here, in the app's main process, because a comment's screenshot is
// a file of this Mac whatever machine the session is on: the input names no session, the command is graded `client`
// (never on a machine link), and the one root a screenshot may lie under is `<userData>`, where its only producer, the
// in-app browser's crop, writes. A refused screenshot answers `invalid_input` at `comments.<i>.screenshot`.
import { HostCommandError } from '@shared/host/runtime';
import { ipcError } from '@shared/ipc/errors';
import type { CommandInput, CommandOutput } from '@shared/ipc/schema';
import { commentsContent } from '@shared/anchor/content';
import { InvalidSideInput } from '@shared/anchor/invalid';
import type { MainHandler } from '../ipc/router';

export async function commentContent({ comments }: CommandInput<'side.comment.content'>, userData: string): Promise<CommandOutput<'side.comment.content'>> {
  try {
    return { content: await commentsContent(comments, 'main', async () => [userData], (index) => ['comments', index]) };
  } catch (error) {
    if (!(error instanceof InvalidSideInput)) throw error;
    throw new HostCommandError(ipcError('invalid_input', error.message, [{ path: error.path, message: error.message }]));
  }
}

export function registerCommentContent(register: (name: 'side.comment.content', handler: MainHandler<'side.comment.content'>) => void, userData: string): void {
  register('side.comment.content', (input) => commentContent(input, userData));
}
