// The hand-off to ClaudeUsage's own panel (C11 M5; W6: from the usage popover): `openClaudeUsage` activates ClaudeUsage
// and toasts the instruction, then `Waiting for ClaudeUsage…` shows until ClaudeUsage's next rewrite reaches C7's
// reader, at most 60 s from the latest hand-off (each one names a new thing to wait for, so it restarts the wait).
// W6 route executor: while ClaudeUsage's control route answers, the panel hand-off opens ClaudeUsage's panel itself
// (`POST /claudeusage/panel`), with no instruction to show; the wait is the same.
import { useEffect, useState } from 'react';
import type { ClaudeUsageOpenIntent } from '@shared/ipc/schema';
import { openClaudeUsage } from '../gateway/actions';
import { ipc } from '../ipc/client';
import { openClaudeUsagePanel } from './controls';

export const HAND_OFF_WAIT_MS = 60_000;

export function useHandOff(): { waiting: boolean; handOff(intent: ClaudeUsageOpenIntent): void } {
  const [handOffs, setHandOffs] = useState(0); // the hand-offs that opened ClaudeUsage; each restarts the wait
  const [settled, setSettled] = useState(0); // the last of them whose wait ended
  const waiting = handOffs > settled;
  useEffect(() => {
    if (handOffs === 0) return;
    const done = () => setSettled(handOffs);
    const off = ipc.on('settings.usageChanged', done);
    const timer = setTimeout(done, HAND_OFF_WAIT_MS);
    return () => {
      off();
      clearTimeout(timer);
    };
  }, [handOffs]);
  const handOff = (intent: ClaudeUsageOpenIntent) => {
    void (async () => {
      // W6 route executor: ClaudeUsage's own panel through its control route when that answers, else the activation
      const opened = (intent.intent === 'panel' && (await openClaudeUsagePanel())) || (await openClaudeUsage(intent))?.opened === true;
      if (opened) setHandOffs((n) => n + 1);
    })();
  };
  return { waiting, handOff };
}
