import { afterEach, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { EventName, EventPayload } from '@shared/ipc/schema';
import { status } from '../../../test/support/builders';
import { LaunchWatch } from './launch-watch';
import type { Setup } from './setup-steps';

afterEach(() => vi.useRealTimers());
it('bounds a takeover readiness wait even when non-ready statuses keep arriving', async () => {
  vi.useFakeTimers();
  const listeners = new Map<EventName, (payload: never) => void>();
  const setup = {
    watches: new Set<LaunchWatch>(), watchdogMs: 80,
    onEvent: (name: EventName, listener: (payload: never) => void) => {
      listeners.set(name, listener);
      return () => listeners.delete(name);
    },
  } as unknown as Setup;
  const app = 'app' as AppSessionId;
  const watch = new LaunchWatch(setup, app, null, 100);
  const waiting = watch.untilReady();
  const event: EventPayload<'session.status'> = { appSessionId: app, status: status(app, { process: 'initializing' }) };
  await vi.advanceTimersByTimeAsync(40);
  listeners.get('session.status')!(event as never);
  await vi.advanceTimersByTimeAsync(40);
  listeners.get('session.status')!(event as never);
  await vi.advanceTimersByTimeAsync(20);
  await expect(waiting).resolves.toEqual({ kind: 'timeout' });
  watch.dispose();
  expect(listeners.size).toBe(0);
});
