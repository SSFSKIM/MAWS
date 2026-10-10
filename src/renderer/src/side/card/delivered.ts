// The card's replies the engine took (P2-F L121; X22's delivered rule): Desktop's "Sent to Claude" on a reply's row. A
// sent or steered reply is watched under the uuid the seam answered; a queued one under each uuid the host released it
// under (`queue.transition` with its queue id, in the session's events), so a release before the card tracked the reply
// is read from the events, not lost. Each is delivered when `waitForHumanPromptDelivery` says so, never at the host's own
// write; the watch ends with the card. The card knows only what it sent: a reopened card, or a prompt sent elsewhere,
// carries no mark. A failed events read is not the card closing: it is read again after each of DELIVERY_RETRY_MS, and
// then the reply is left unmarked (no mark is claimed without the engine's `started`).
import { useEffect, useState } from 'react';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId, MessageUuid } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import { waitForHumanPromptDelivery } from '../../composer/submit/human-prompt-delivery';
import type { HumanPromptResult } from '../../composer/submit/send-human-prompt';
import { ipc } from '../../ipc/client';

export const DELIVERY_RETRY_MS = [1_000, 5_000] as const;

type Reply = { key: string; failures: number } & ({ messageUuid: MessageUuid } | { queueId: string });

const NONE: ReadonlySet<MessageUuid> = new Set();

// The uuid a queued reply was delivered under: every uuid the host released its queue entry under (a reverted entry is
// released again under a new one) is watched by X22's rule, listening before the events read as that rule's watch does.
function queuedDelivery(child: AppSessionId, queueId: string, signal: AbortSignal, client: MawsBridge): Promise<MessageUuid> {
  return new Promise((resolve, reject) => {
    const inner = new AbortController();
    const released = new Set<MessageUuid>();
    let off = () => {};
    const end = () => {
      off();
      inner.abort();
      signal.removeEventListener('abort', abort);
    };
    const fail = (error: unknown) => {
      if (inner.signal.aborted) return;
      end();
      reject(error);
    };
    const abort = () => fail(signal.reason ?? new Error('Delivery observation aborted'));
    const observe = (events: readonly SessionEvent[]) => {
      for (const event of events) {
        if (event.kind !== 'queue.transition' || event.queueId !== queueId || event.messageUuid === null || released.has(event.messageUuid)) continue;
        const uuid = event.messageUuid;
        released.add(uuid);
        waitForHumanPromptDelivery(child, uuid, { signal: inner.signal }, client).then(() => {
          if (inner.signal.aborted) return;
          end();
          resolve(uuid);
        }, fail);
      }
    };
    if (signal.aborted) return abort();
    signal.addEventListener('abort', abort, { once: true });
    off = client.on('session.eventBatch', (batch) => {
      if (batch.appSessionId === child) observe(batch.events);
    });
    void client.invoke('session.events', { appSessionId: child, afterSeq: null, limit: null }).then((result) => {
      if (inner.signal.aborted) return;
      if (result.ok) observe(result.value.events);
      else fail(new Error(result.error.message));
    }, fail);
  });
}

function delivery(child: AppSessionId, reply: Reply, signal: AbortSignal, client: MawsBridge): Promise<MessageUuid> {
  if ('queueId' in reply) return queuedDelivery(child, reply.queueId, signal, client);
  return waitForHumanPromptDelivery(child, reply.messageUuid, { signal }, client).then(() => reply.messageUuid);
}

export function useDeliveredReplies(child: AppSessionId, client: MawsBridge = ipc): { delivered: ReadonlySet<MessageUuid>; track(result: HumanPromptResult): void } {
  const [watching, setWatching] = useState<readonly Reply[]>([]);
  const [delivered, setDelivered] = useState<ReadonlySet<MessageUuid>>(NONE);

  useEffect(() => {
    if (watching.length === 0) return;
    const watch = new AbortController();
    const timers: ReturnType<typeof setTimeout>[] = [];
    const settle = (key: string, next: (reply: Reply) => Reply | null) =>
      setWatching((replies) => replies.flatMap((r) => (r.key !== key ? [r] : (next(r) ?? []))));
    const observe = (reply: Reply) =>
      delivery(child, reply, watch.signal, client).then(
        (uuid) => {
          settle(reply.key, () => null);
          setDelivered((set) => new Set(set).add(uuid));
        },
        () => {
          if (watch.signal.aborted) return; // the card closed, or the watched set changed and this run is replaced
          // the events read failed: read again after the next delay, or give the reply up (no mark)
          settle(reply.key, (r) => (r.failures < DELIVERY_RETRY_MS.length ? { ...r, failures: r.failures + 1 } : null));
        },
      );
    for (const reply of watching) {
      if (reply.failures === 0) void observe(reply);
      else timers.push(setTimeout(() => void observe(reply), DELIVERY_RETRY_MS[reply.failures - 1]));
    }
    return () => {
      watch.abort();
      timers.forEach(clearTimeout);
    };
  }, [child, client, watching]);

  const track = (result: HumanPromptResult) => {
    if (result.messageUuid !== undefined) setWatching((replies) => [...replies, { key: `m:${result.messageUuid}`, failures: 0, messageUuid: result.messageUuid! }]);
    else if (result.disposition === 'queued' && result.queueId !== undefined) setWatching((replies) => [...replies, { key: `q:${result.queueId}`, failures: 0, queueId: result.queueId! }]);
  };
  return { delivered, track };
}
