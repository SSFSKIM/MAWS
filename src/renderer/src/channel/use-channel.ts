// One tab's hold on a project's channel (P5 O8 M7a, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M7a; the
// Decision Log's "M7a Task 1 … settles these points"). The mount opens it (`org.channel.open`) and the unmount closes it
// (`org.channel.close`): main keeps a channel per project while any tab holds it, released 30 s after the last, and lets
// a reloaded page's holds go itself. A change heard before the open's answer is applied over it only when main numbered
// it past the answer (state.ts's `rev`): one told before it describes an older state. `send` speaks in it; the word
// comes back in main's pending, its state main's.
import { useCallback, useEffect, useState } from 'react';
import type { CommandResult, MawsBridge } from '@shared/ipc/schema';
import type { ChannelChanged } from '@shared/ipc/schema/org';
import { ipc } from '../ipc/client';
import { applyChange, held, openedWith, type ChannelHeld } from './state';

export interface ChannelHold {
  held: ChannelHeld;
  /** The open itself failed (main didn't answer it); `retry` asks again. */
  failed: string | null;
  retry(): void;
  send(text: string): Promise<CommandResult<'org.channel.send'>>;
}

/** What the tab draws, for the open it came from (`key`): another project or a retry starts again from opening. */
type Shown = Pick<ChannelHold, 'held' | 'failed'> & { key: string };
const opening = (key: string): Shown => ({ key, held: held(), failed: null });

export function useChannel(project: string, client: MawsBridge = ipc): ChannelHold {
  const [attempt, setAttempt] = useState(0);
  const key = `${attempt}:${project}`;
  const [state, setShown] = useState<Shown>(() => opening(key));
  const shown = state.key === key ? state : opening(key);

  useEffect(() => {
    let mounted = true;
    let current: ChannelHeld = held();
    const early: ChannelChanged[] = [];
    const publish = (next: ChannelHeld) => {
      current = next;
      setShown({ key, held: next, failed: null });
    };
    const off = client.on('org.channel.changed', (change) => {
      if (!mounted || change.project !== project) return;
      if (current.phase === 'opening') early.push(change);
      else publish(applyChange(current, change));
    });
    void client.invoke('org.channel.open', { project }).then((result) => {
      if (!mounted) return;
      if (!result.ok) return setShown({ ...opening(key), failed: result.error.message });
      let next = openedWith(result.value);
      for (const change of early.splice(0)) next = applyChange(next, change);
      publish(next);
    });
    return () => {
      mounted = false;
      off();
      void client.invoke('org.channel.close', { project });
    };
  }, [project, client, key]);

  const send = useCallback((text: string) => client.invoke('org.channel.send', { project, text }), [project, client]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const { held: channel, failed } = shown;
  return { held: channel, failed, retry, send };
}
