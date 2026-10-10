// A debugging tap beside the terminal registry, shared by the `#probe` registry pane and the `#panel` page (the
// registry stays the product's only consumer of what it taps): byte, line-feed and carriage-return counts per pty for
// every `pty.data` event since the page loaded; the host's `pty.list` sampled 10 ms after each answer, latching a pty
// once seen paused (a flood's pauses last 10 to 35 ms on this Mac, which M3's 50 ms sampler could miss, M4) and
// publishing the rows about twice a second; and a Ping button's record of how long each click's event waited for the
// main thread.
import { create } from 'zustand';
import type { PtyInfo } from '@shared/ipc/schema';
import { ipc } from '../../ipc/client';
import { countLineEndings } from './metrics';

export interface StreamCounters {
  bytes: number;
  lineFeeds: number;
  carriageReturns: number;
}

export interface Pings {
  count: number;
  lastMs: number | null; // how long the last click's event waited before its handler ran
  maxMs: number | null;
}

const counters = new Map<string, StreamCounters>();
const pausedSeen = new Set<string>();
export const useSamples = create<{ rows: PtyInfo[]; pings: Pings }>()(() => ({ rows: [], pings: { count: 0, lastMs: null, maxMs: null } }));
let tapping = false;

export function tap(): void {
  if (tapping) return;
  tapping = true;
  ipc.on('pty.data', ({ ptyId, data }) => {
    const counter = counters.get(ptyId) ?? { bytes: 0, lineFeeds: 0, carriageReturns: 0 };
    const endings = countLineEndings(data);
    counter.bytes += data.byteLength;
    counter.lineFeeds += endings.lineFeeds;
    counter.carriageReturns += endings.carriageReturns;
    counters.set(ptyId, counter);
  });
  let samples = 0;
  const sample = () =>
    void ipc.invoke('pty.list', undefined).then((result) => {
      if (result.ok) {
        for (const pty of result.value.ptys) if (pty.paused) pausedSeen.add(pty.ptyId);
        if (samples % 50 === 0) useSamples.setState({ rows: result.value.ptys });
        samples++;
      }
      setTimeout(sample, 10); // one request in flight at a time
    });
  sample();
}

export function countersOf(ptyId: string | null | undefined): StreamCounters | null {
  const counter = ptyId ? counters.get(ptyId) : undefined;
  return counter ? { ...counter } : null;
}

export const wasPausedSeen = (ptyId: string | null | undefined): boolean => !!ptyId && pausedSeen.has(ptyId);

// Starts a new observation for one pty: a test phase that must prove its own pause clears what an earlier phase saw.
export function resetPausedSeen(ptyId: string | null | undefined): void {
  if (ptyId) pausedSeen.delete(ptyId);
}

export function ping(ev: { timeStamp: number }): void {
  const waited = Math.round((performance.now() - ev.timeStamp) * 10) / 10;
  const { pings } = useSamples.getState();
  useSamples.setState({ pings: { count: pings.count + 1, lastMs: waited, maxMs: Math.max(pings.maxMs ?? 0, waited) } });
}

export const counterText = (c: StreamCounters | null) => (c ? `bytes ${c.bytes} · LF ${c.lineFeeds} · CR ${c.carriageReturns}` : 'bytes 0');
