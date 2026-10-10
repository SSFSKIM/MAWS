// The card's replies the engine took (P2-F L121; X22's delivered rule): Desktop's "Sent to Claude" on a reply's row. A
// sent or steered reply is watched under the uuid the seam answered; a queued one under the uuid the host mints when it
// submits the entry (`QueueEntry.messageUuid`, set at `submitting`, read from the queue store the card's transcript keeps
// attached). Each is delivered when `waitForHumanPromptDelivery` says so, never at the host's own write; the watch ends
// with the card. The card knows only what it sent: a reopened card, or a prompt sent elsewhere, carries no mark.
import { useEffect, useState } from 'react';
import type { AppSessionId, MessageUuid } from '@shared/graph/ids';
import { waitForHumanPromptDelivery } from '../../composer/submit/human-prompt-delivery';
import type { HumanPromptResult } from '../../composer/submit/send-human-prompt';
import { useQueueStore } from '../../stores/queue';

const NONE: ReadonlySet<MessageUuid> = new Set();

export function useDeliveredReplies(child: AppSessionId): { delivered: ReadonlySet<MessageUuid>; track(result: HumanPromptResult): void } {
  const [queued, setQueued] = useState<readonly string[]>([]);
  const [watching, setWatching] = useState<readonly MessageUuid[]>([]);
  const [delivered, setDelivered] = useState<ReadonlySet<MessageUuid>>(NONE);

  // a queued reply's uuid, once the host has minted it
  useEffect(() => {
    if (queued.length === 0) return;
    const check = () => {
      const minted = (useQueueStore.getState().bySession.get(child)?.entries ?? []).filter((e) => e.messageUuid !== null && queued.includes(e.queueId));
      if (minted.length === 0) return;
      setQueued((ids) => ids.filter((id) => !minted.some((e) => e.queueId === id)));
      setWatching((uuids) => [...uuids, ...minted.map((e) => e.messageUuid!)]);
    };
    check();
    return useQueueStore.subscribe(check);
  }, [child, queued]);

  useEffect(() => {
    if (watching.length === 0) return;
    const watch = new AbortController();
    for (const uuid of watching)
      waitForHumanPromptDelivery(child, uuid, { signal: watch.signal }).then(
        () => {
          setWatching((uuids) => uuids.filter((u) => u !== uuid));
          setDelivered((set) => new Set(set).add(uuid));
        },
        () => {}, // aborted with the card, or the events read failed: no mark
      );
    return () => watch.abort();
  }, [child, watching]);

  const track = (result: HumanPromptResult) => {
    if (result.messageUuid !== undefined) setWatching((uuids) => [...uuids, result.messageUuid!]);
    else if (result.disposition === 'queued' && result.queueId !== undefined) setQueued((ids) => [...ids, result.queueId!]);
  };
  return { delivered, track };
}
