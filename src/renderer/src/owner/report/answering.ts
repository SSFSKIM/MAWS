// Marking the owner channel's legacy items read (the P2-C document, Design §8; UX wave U2b, ruling R9). A request
// card's Mark read (`request-card/RequestCard.tsx`) and the palette's command "Mark all read" (the action
// `transcript.markAllRead`, on the focused pane's session) are main's command `ownerChannel.markRead`. No failure
// escapes or goes unsaid: a failed command (main's failure envelope, or a rejected invoke when the bridge is gone) is
// said where it was asked, the card under its button and Mark all read, which has no card, in a toast with Retry.
// UX wave U2b: the report's cards and their answering are gone with the bar (M2), so this is all that is left here.
// Ticket 627: a session on another machine over RL2 takes no `ownerChannel.markRead`: its marking answers the window's
// helper's sentence and sends nothing (the card draws its button disabled with it).
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import type { MarkId } from '@shared/owner/marks';
import type { OwnerChannelState } from '@shared/owner/state';
import { focusedSession } from '../../composer/ComposerAppKeys';
import { ipc } from '../../ipc/client';
import { toast } from '../../stores/notices';
import { useOwnerChannelStore } from '../../stores/owner-channel';
import { remoteUnavailableOf } from '../../lane-b/remote-unavailable';
import { REPORT } from './copy';

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

// A command's failure in its words, null when it succeeded: main's failure envelope, or the invoke rejected.
async function failureOf(invoke: () => Promise<{ ok: true } | { ok: false; error: { message: string } }>): Promise<string | null> {
  try {
    const result = await invoke();
    return result.ok ? null : result.error.message;
  } catch (error) {
    return messageOf(error);
  }
}

// Null when main read them, else the failure's words, for the caller to say where it was asked.
export function markRead(appSessionId: AppSessionId, markIds: MarkId[] | 'all', client: MawsBridge = ipc): Promise<string | null> {
  const unavailable = remoteUnavailableOf(appSessionId, 'ownerChannel.markRead');
  if (unavailable !== null) return Promise.resolve(unavailable);
  return failureOf(() => client.invoke('ownerChannel.markRead', { appSessionId, markIds }));
}

// How many legacy items the session's channel holds unread: an essential not read, a question not answered.
export const unreadOf = (owner: Pick<OwnerChannelState, 'marks'> | null): number =>
  owner?.marks.filter((mark) => mark.item && (mark.essential?.state === 'unread' || mark.question?.state === 'unanswered')).length ?? 0;

// Every item of the session marked read, its failure said in a toast whose Retry asks again.
export async function markAllReadOrSay(appSessionId: AppSessionId): Promise<void> {
  const failed = await markRead(appSessionId, 'all');
  if (failed !== null) toast({ level: 'danger', text: REPORT.notMarkedAll(failed), actions: [{ label: REPORT.retry, run: () => void markAllReadOrSay(appSessionId) }], dismissible: true });
}

/** `transcript.markAllRead`: the focused pane's session's legacy items marked read; nothing while none is unread. */
export function markAllRead(): void {
  const appSessionId = focusedSession();
  if (appSessionId === null) return;
  if (unreadOf(useOwnerChannelStore.getState().bySession.get(appSessionId) ?? null) === 0) return;
  void markAllReadOrSay(appSessionId);
}
