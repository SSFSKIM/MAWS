// `daemon.e2eSeam` (M5b fix round 2; D11): the e2e's seams that live with the spine, which runs in `mawsd` on the daemon
// shape: the scenario's manual clock and the library's held refreshes. Refused unless `mawsd` was started under
// MAWS_E2E=1 (its own reading at start; daemon.test.ts holds the daemon to it).
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BrowserFeed, BrowserFrame, BrowserInventory } from '@shared/browser/screencast';
import { E2E_BROWSER_VIEW_MS, e2eResources, runE2eBrowserView, runE2eSeam, writeE2eResources } from './e2e-seam';

const seams = globalThis as { __maws_scenario?: { advanceTo(ms: number): void; now(): number }; __maws_library?: { holdRefreshes(): Promise<void> } };
afterEach(() => {
  delete seams.__maws_scenario;
  delete seams.__maws_library;
});

describe('daemon.e2eSeam', () => {
  it('plays the scenario to a time and holds the library’s refreshes, under MAWS_E2E=1', async () => {
    const advanceTo = vi.fn();
    let held = false;
    seams.__maws_scenario = { advanceTo, now: () => 0 };
    seams.__maws_library = { holdRefreshes: async () => void (held = true) };
    await runE2eSeam({ seam: 'scenario.advanceTo', ms: 3000 }, true);
    expect(advanceTo).toHaveBeenCalledWith(3000);
    await runE2eSeam({ seam: 'library.holdRefreshes' }, true);
    expect(held).toBe(true);
  });

  it('says what is missing: no scenario clock, no library seam', async () => {
    await expect(runE2eSeam({ seam: 'scenario.advanceTo', ms: 1 }, true)).rejects.toThrow('no scenario clock: mawsd is not in launch mode scenario with MAWS_SCENARIO_CLOCK=manual');
    await expect(runE2eSeam({ seam: 'library.holdRefreshes' }, true)).rejects.toThrow('no library seam: the spine’s library is not running');
  });

  it('is refused outside the e2e', async () => {
    const advanceTo = vi.fn();
    seams.__maws_scenario = { advanceTo, now: () => 0 };
    await expect(runE2eSeam({ seam: 'scenario.advanceTo', ms: 1 }, false)).rejects.toThrow('daemon.e2eSeam is refused: mawsd was not started under MAWS_E2E=1');
    expect(advanceTo).not.toHaveBeenCalled();
  });
});

// P5 O17 M8 (Decisions, e2e:daemon-idle): what an idle `mawsd` holds, read from outside by the e2e (SIGUSR2 under
// MAWS_E2E=1, src/mawsd/index.ts): its active resources and the modules it has loaded, so the scene can say no session
// listener, no deferred chunk and no new timer
describe('the e2e resource report', () => {
  it('names the active resources, a timer among them while one is armed, and the loaded modules by file name', () => {
    const before = e2eResources();
    expect(before.modules.length).toBeGreaterThan(0);
    expect(before.modules.every((name) => !name.includes('/'))).toBe(true);
    const timer = setTimeout(() => {}, 60_000);
    try {
      const armed = e2eResources();
      expect(armed.resources.filter((kind) => kind === 'Timeout').length).toBe(before.resources.filter((kind) => kind === 'Timeout').length + 1);
    } finally {
      clearTimeout(timer);
    }
  });

  it('is written whole to its file, replacing the last', () => {
    const dir = mkdtempSync(join(tmpdir(), 'maws-e2e-res-'));
    try {
      const file = join(dir, 'e2e-resources.json');
      writeFileSync(file, 'stale');
      writeE2eResources(file);
      const read = JSON.parse(readFileSync(file, 'utf8')) as ReturnType<typeof e2eResources> & { at: string };
      expect(read).toMatchObject({ resources: expect.any(Array), modules: expect.any(Array), at: expect.any(String), browser: null });
      writeE2eResources(file, { broker: null, sockets: {}, holds: [] }); // P5 O17 M8: the daemon's browser facts beside them
      expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({ browser: { broker: null, sockets: {}, holds: [] } });
      expect(readdirSync(dir)).toEqual(['e2e-resources.json']); // no temp file left beside it
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// P5 O17 M9b fix wave: a viewer of mawsd's real feed (DaemonServices.browser), as the endpoint's would be, for the e2e
describe('daemon.e2eBrowserView', () => {
  const TAB = 'b_000000000001';
  const ready = (epoch = 'e.1', tabs = [TAB]): BrowserInventory => ({ epoch, tabs: tabs.map((tabId) => ({ tabId, title: tabId, url: 'about:blank', control: 'agent' as const })), selected: null, state: 'ready' });
  const frameOf = (seq: number): BrowserFrame => ({ epoch: 'e.1', tabId: TAB, seq, capturedAt: seq, width: 640, height: 400, viewport: { width: 1280, height: 800 }, jpeg: new Uint8Array(seq + 1) });
  function fakeFeed(readings: BrowserInventory[]) {
    const acks: number[] = [];
    const opens: unknown[] = [];
    let sink: Parameters<BrowserFeed['open']>[1] | null = null;
    let closed = false;
    let watching: ((inventory: BrowserInventory) => void) | null = null;
    const feed: BrowserFeed = {
      inventory: () => readings.at(-1)!,
      watchInventory(_appSessionId, changed) {
        watching = changed;
        changed(readings[0]!); // the current reading at once, as the route's
        return () => void (watching = null);
      },
      async open(input, given) {
        opens.push(input);
        sink = given;
        return { ack: (seq) => void acks.push(seq), input: async () => {}, close: () => void (closed = true) };
      },
    };
    return { feed, acks, opens, sink: () => sink!, closed: () => closed, tell: (inventory: BrowserInventory) => watching?.(inventory), watching: () => watching !== null };
  }

  it('waits for a ready inventory with a tab, opens it read-only, acks each frame but the last, and answers what it saw', async () => {
    const t = fakeFeed([{ epoch: 'e.1', tabs: [], selected: null, state: 'ready' }]);
    const viewing = runE2eBrowserView({ appSessionId: 'app-1', frames: 2 }, true, t.feed);
    t.tell(ready());
    await vi.waitFor(() => expect(t.opens).toEqual([{ appSessionId: 'app-1', epoch: 'e.1', tabId: TAB, control: false }]));
    expect(t.watching(), 'the watch ends once a tab is listed').toBe(false);
    t.sink().frame(frameOf(1));
    t.sink().frame(frameOf(2));
    expect(await viewing).toEqual({ tabs: [TAB], tabId: TAB, frames: [{ seq: 1, width: 640, height: 400, bytes: 2 }, { seq: 2, width: 640, height: 400, bytes: 3 }] });
    expect(t.acks).toEqual([1]);
    expect(t.closed()).toBe(true);
  });

  it('fails with the subscription’s end, and is refused unless mawsd runs under MAWS_E2E=1', async () => {
    const t = fakeFeed([ready()]);
    const viewing = runE2eBrowserView({ appSessionId: 'app-1', frames: 1 }, true, t.feed);
    await vi.waitFor(() => expect(t.opens).toHaveLength(1));
    t.sink().closed('tab_closed');
    await expect(viewing).rejects.toThrow(/tab_closed/);
    await expect(runE2eBrowserView({ appSessionId: 'app-1', frames: 1 }, false, t.feed)).rejects.toThrow(/MAWS_E2E=1/);
  });

  it('answers within its bound when no tab is listed', async () => {
    vi.useFakeTimers();
    try {
      const t = fakeFeed([{ epoch: 'e.1', tabs: [], selected: null, state: 'unavailable', reason: 'nothing' }]);
      const viewing = runE2eBrowserView({ appSessionId: 'app-1', frames: 1 }, true, t.feed);
      const failed = expect(viewing).rejects.toThrow(/no tab .* within/);
      await vi.advanceTimersByTimeAsync(E2E_BROWSER_VIEW_MS);
      await failed;
      expect(t.watching()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
