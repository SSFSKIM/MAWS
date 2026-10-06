// `side.sendToMain` (E3 execution document, Design §8): an anchored comment sent to the parent session itself. Main
// builds the content (the one place that validates and opens the screenshot also builds its block) and mirrors the
// composer's own rule: a turn running → a `next` steer the engine folds in at its next tool boundary; otherwise a
// send through the app queue, which a paused or held queue keeps queued as a typed message would be. A parent with no
// ready process is refused by the host, whose message goes back verbatim (`internal`).
import type { AppSessionId } from '@shared/graph/ids';
import type { CommandInput, CommandOutput } from '@shared/ipc/schema';
import { hostCall } from '../sessions/context';
import type { Setup } from '../sessions/setup-steps';
import { commentContent, screenshotRoots } from './content';

export type SendToMainInput = CommandInput<'side.sendToMain'>;
export type SendToMainOutput = CommandOutput<'side.sendToMain'>;

export async function sendToMain(s: Pick<Setup, 'dispatch' | 'sessions'>, userData: string, input: SendToMainInput): Promise<SendToMainOutput> {
  const appSessionId = input.appSessionId as AppSessionId;
  const parent = s.sessions.get(appSessionId);
  if (parent === null) throw new Error(`no session ${appSessionId}`);
  const content = await commentContent({ anchor: input.anchor, text: input.text, screenshot: input.screenshot, destination: 'main' }, () => screenshotRoots(userData, parent));
  const status = await hostCall(s.dispatch, 'session.status', { appSessionId });
  if (status.turn !== null) {
    const { messageUuid } = await hostCall(s.dispatch, 'session.steer', { appSessionId, content, priority: 'next' });
    return { messageUuid, disposition: 'steered' };
  }
  const sent = await hostCall(s.dispatch, 'session.send', { appSessionId, content });
  return { messageUuid: sent.messageUuid, disposition: sent.disposition };
}
