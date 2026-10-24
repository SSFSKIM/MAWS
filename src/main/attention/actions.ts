import type { AttentionItem } from '@shared/graph/attention';
import type { AppSessionId, AttentionId } from '@shared/graph/ids';
import type { SessionEvent } from '@shared/graph/events';
import type { AcquireOutcome } from '@shared/sessions/setup';
import { isReadOnlyRequest } from '@shared/attention/read-only-tools';
import type { HostDispatch } from '../ipc/router';

export function notificationActions(deps: {
  dispatch: HostDispatch;
  acquire(id: AppSessionId, reason: 'send'): Promise<AcquireOutcome>;
  pending(id: AppSessionId, attentionId: AttentionId): AttentionItem | undefined;
}) {
  const canAllow = async (item: AttentionItem): Promise<boolean> => {
    const current = deps.pending(item.appSessionId, item.id);
    if (current?.kind !== 'permission' || current.state !== 'pending' || current.request.requestId === null) return false;
    const result = await deps.dispatch('engine-host', 'session.pendingRequest', { appSessionId: item.appSessionId, requestId: current.request.requestId });
    return result.ok && isReadOnlyRequest((result.value as { event: SessionEvent | null }).event);
  };
  return {
    canAllow,
    async allow(item: AttentionItem): Promise<void> {
      if (!await canAllow(item)) throw new Error('This request is no longer available for Allow once. Open the session to review it.');
      const result = await deps.dispatch('engine-host', 'session.answer', { appSessionId: item.appSessionId, requestId: item.request.requestId, answer: { kind: 'permission', decision: 'allow', scope: 'once' } });
      if (!result.ok) throw new Error(result.error.message);
      if ((result.value as { outcome: string }).outcome !== 'delivered') throw new Error('The approval was not delivered. Open the session to review it.');
    },
    async reply(id: AppSessionId, text: string): Promise<void> {
      if (!text.trim()) return;
      const ready = await deps.acquire(id, 'send');
      if (ready.status !== 'ready') throw new Error('Open the session before sending this reply.');
      // Same command as the hover card: the engine host owns the queue. Never steer.
      const sent = await deps.dispatch('engine-host', 'session.send', { appSessionId: id, content: text });
      if (!sent.ok) throw new Error(sent.error.message);
    },
  };
}
export type NotificationActions = ReturnType<typeof notificationActions>;
