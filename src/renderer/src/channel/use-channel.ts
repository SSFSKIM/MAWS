// One tab's hold on a project's channel (P5 O8 M7a, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M7a; the
// Decision Log's "M7a Task 1 … settles these points"). The mount opens it (`org.channel.open`) and the unmount closes it
// (`org.channel.close`): main keeps a channel per project while any tab holds it, released 30 s after the last, and lets
// a reloaded page's holds go itself. A change heard before the open's answer is applied over it only when main numbered
// it past the answer (state.ts's `rev`): one told before it describes an older state. `send` speaks in it, and remembers the word for
// "Not sent" (state.ts): the memory is the page's, outliving the tab, so a tab opened again still knows what it sent.
import { useCallback, useEffect, useState } from 'react';
import type { CommandResult, MawsBridge } from '@shared/ipc/schema';
import type { ChannelChanged } from '@shared/ipc/schema/org';
import { ipc } from '../ipc/client';
import { applyChange, held, openedWith, splitLost, trackSent, type ChannelHeld, type SentWord } from './state';

/** The words this page sent, per project, until the log holds them or a tab has said they weren't sent. */
const sentWords = new Map<string, SentWord[]>();
/** For the suites: a page that never sent anything. */
export const forgetSentWords = () => sentWords.clear();

export interface ChannelHold {
  held: ChannelHeld;
  /** This page's words main may still hold or the log will (state.ts's `kept`). */
  sent: SentWord[];
  /** The words main dropped before this tab opened, said "Not sent" for this tab's life. */
  lost: SentWord[];
  /** The open itself failed (main didn't answer it); `retry` asks again. */
  failed: string | null;
  retry(): void;
  send(text: string): Promise<CommandResult<'org.channel.send'>>;
}

/** What the tab draws, for the open it came from (`key`): another project or a retry starts again from opening. */
type Shown = Pick<ChannelHold, 'held' | 'sent' | 'lost' | 'failed'> & { key: string };
const opening = (project: string, key: string): Shown => ({ key, held: held(), sent: sentWords.get(project) ?? [], lost: [], failed: null });

export function useChannel(project: string, client: MawsBridge = ipc): ChannelHold {
  const [attempt, setAttempt] = useState(0);
  const key = `${attempt}:${project}`;
  const [state, setShown] = useState<Shown>(() => opening(project, key));
  const shown = state.key === key ? state : opening(project, key);

  useEffect(() => {
    let mounted = true;
    let current: ChannelHeld = held();
    let lost: SentWord[] = [];
    const early: ChannelChanged[] = [];
    const publish = (next: ChannelHeld) => {
      current = next;
      if (next.phase === 'open') sentWords.set(project, trackSent(sentWords.get(project) ?? [], next));
      setShown({ key, held: next, sent: sentWords.get(project) ?? [], lost, failed: null });
    };
    const off = client.on('org.channel.changed', (change) => {
      if (!mounted || change.project !== project) return;
      if (current.phase === 'opening') early.push(change);
      else publish(applyChange(current, change));
    });
    void client.invoke('org.channel.open', { project }).then((result) => {
      if (!mounted) return;
      if (!result.ok) return setShown({ ...opening(project, key), failed: result.error.message });
      let next = openedWith(result.value);
      for (const change of early.splice(0)) next = applyChange(next, change);
      if (next.phase === 'open') {
        const split = splitLost(sentWords.get(project) ?? [], next);
        sentWords.set(project, split.kept);
        lost = split.lost;
      }
      publish(next);
    });
    return () => {
      mounted = false;
      off();
      void client.invoke('org.channel.close', { project });
    };
  }, [project, client, key]);

  const send = useCallback(
    async (text: string) => {
      const result = await client.invoke('org.channel.send', { project, text });
      if (result.ok && result.value.ok) {
        sentWords.set(project, [...(sentWords.get(project) ?? []), { nonce: result.value.nonce, text, to: null, acked: false }]);
        setShown((s) => ({ ...s, sent: sentWords.get(project) ?? [] }));
      }
      return result;
    },
    [project, client],
  );
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const { held: channel, sent, lost, failed } = shown;
  return { held: channel, sent, lost, failed, retry, send };
}
