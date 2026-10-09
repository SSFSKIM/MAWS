// P2-0 (X22): delivery is the replayed user uuid, not acceptance of a send/steer or a lifecycle report. Listen
// before the existing events read so a caller arriving after delivery, or during that read, cannot miss the row.
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId, MessageUuid } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import { ipc } from '../../ipc/client';

type DeliveredMessage = Extract<SessionEvent, { kind: 'user.message' }>;

// No deadline is imposed on a prompt waiting in the engine: the caller owns its lifetime and can abort when its
// surface closes or the queued submission is cancelled. A queued send without a uuid cannot be observed yet.
export function waitForHumanPromptDelivery(appSessionId: AppSessionId, messageUuid: MessageUuid, options: { signal?: AbortSignal } = {}, client: MawsBridge = ipc): Promise<DeliveredMessage> {
  const { signal } = options;
  return new Promise((resolve, reject) => {
    let settled = false;
    let off = () => {};
    const cleanup = () => {
      off();
      signal?.removeEventListener('abort', abort);
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const abort = () => fail(signal?.reason ?? new Error('Delivery observation aborted'));
    const observe = (events: SessionEvent[]) => {
      if (settled) return;
      const delivered = events.find((event): event is DeliveredMessage => event.kind === 'user.message' && event.agentId === null && event.parentToolUseId === null && event.messageUuid === messageUuid);
      if (!delivered) return;
      settled = true;
      cleanup();
      resolve(delivered);
    };
    if (signal?.aborted) return abort();
    signal?.addEventListener('abort', abort, { once: true });
    off = client.on('session.eventBatch', (batch) => {
      if (batch.appSessionId === appSessionId) observe(batch.events);
    });
    // A stream adapter may replay synchronously on subscribe.
    if (settled) { cleanup(); return; }
    void client.invoke('session.events', { appSessionId, afterSeq: null, limit: null }).then((result) => {
      if (result.ok) observe(result.value.events);
      else fail(new Error(result.error.message));
    }, fail);
  });
}
