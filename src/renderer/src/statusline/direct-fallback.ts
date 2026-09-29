// The direct session's usage windows (D-19's engine fallback; §5.5): a session launched direct never passes through
// ClaudeUsage's relay, so its windows come from the engine's own `get_usage`, read every 60 s while its status line
// is on screen and the page is visible, and after each turn ends. `rate_limits` (pinned binary: `{ five_hour,
// seven_day, model_scoped[] }`, each `{ utilization, resets_at }`; null when plan limits do not apply) maps to the
// same window shape ClaudeUsage's files give.
import { useEffect, useState } from 'react';
import * as z from 'zod';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { AppSessionId } from '@shared/graph/ids';
import type { GetUsageResponse } from '@shared/wire/control';
import type { UsageWindow } from '@shared/usage/types';
import { ipc } from '../ipc/client';
import { useUsage, type Windows } from '../stores/usage';

export const DIRECT_POLL_MS = 60_000;

const EngineWindowSchema = z.looseObject({ utilization: z.number().nullable(), resets_at: z.string().nullable() });
const RateLimitsSchema = z.looseObject({
  five_hour: EngineWindowSchema.nullable().optional(),
  seven_day: EngineWindowSchema.nullable().optional(),
  model_scoped: z.array(z.looseObject({ display_name: z.string(), utilization: z.number().nullable(), resets_at: z.string().nullable() })).optional(),
});

const toWindow = (w: { utilization: number | null; resets_at: string | null } | null | undefined, readAt: string): UsageWindow | null =>
  w && w.utilization !== null && w.resets_at !== null ? { percent: w.utilization, resetsAt: w.resets_at, recordedAt: readAt } : null;

export function windowsFromGetUsage(response: GetUsageResponse, readAt: string): Windows | null {
  const parsed = RateLimitsSchema.safeParse(response.rate_limits);
  if (response.rate_limits === null || !parsed.success) return null;
  const limits = parsed.data;
  return {
    fiveHour: toWindow(limits.five_hour, readAt),
    sevenDay: toWindow(limits.seven_day, readAt),
    scoped: (limits.model_scoped ?? []).flatMap((m) => {
      const window = toWindow(m, readAt);
      return window ? [{ model: m.display_name, window }] : [];
    }),
  };
}

// Polls while mounted (the status line is mounted exactly while its session's tab is shown in a pane) for a direct
// session with a ready process, and reads once more whenever a turn ends; a failed read leaves the last reading.
export function useDirectFallback(appSessionId: AppSessionId, status: EngineSessionStatus | null): void {
  const polling = status !== null && status.gateway.mode === 'direct' && status.process === 'ready';
  const turnOpen = status !== null && status.turn !== null;
  const [turnsEnded, setTurnsEnded] = useState(0);
  const [wasOpen, setWasOpen] = useState(turnOpen);
  if (wasOpen !== turnOpen) {
    setWasOpen(turnOpen);
    if (!turnOpen) setTurnsEnded((n) => n + 1);
  }
  useEffect(() => {
    if (!polling) return;
    let live = true;
    const read = async () => {
      if (document.visibilityState !== 'visible') return;
      const result = await ipc.invoke('session.getUsage', { appSessionId });
      if (!live) return;
      if (!result.ok) return void console.warn('[usage] session.getUsage failed', result.error);
      const readAt = new Date().toISOString();
      useUsage.getState().setDirect(appSessionId, { windows: windowsFromGetUsage(result.value, readAt), readAt });
    };
    void read();
    const timer = setInterval(() => void read(), DIRECT_POLL_MS);
    const onVisible = () => void read();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      live = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [polling, appSessionId, turnsEnded]); // a turn's end restarts the cycle with a read
}
