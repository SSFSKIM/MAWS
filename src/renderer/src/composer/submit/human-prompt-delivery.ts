// P2-0 (X22): a replayed or disk user row proves delivery. The live normalizer suppresses replays of our outgoing
// prompts, so its optimistic row also needs the matching engine `started` lifecycle; neither alone proves delivery.
// Listen before the events read so a caller arriving after delivery, or during that read, cannot miss either signal.
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
    let userMessage: DeliveredMessage | undefined;
    let started = false;
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
      for (const event of events) {
        if (event.agentId !== null || event.parentToolUseId !== null) continue;
        if (event.kind === 'user.message' && event.messageUuid === messageUuid) {
          userMessage = event;
          if (event.isReplay || event.seq === null) break;
        } else if (event.kind === 'command.lifecycle' && event.commandUuid === messageUuid && event.state === 'started') {
          started = true;
        }
      }
      if (!userMessage || (!userMessage.isReplay && userMessage.seq !== null && !started)) return;
      settled = true;
      cleanup();
      resolve(userMessage);
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
