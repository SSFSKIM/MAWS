// `daemon.e2eSeam` (M5b fix round 2; docs/doperpowers/plans/2026-10-29-p5-o3-d-cutover.md, D11): the end-to-end seams
// that live where the spine runs, read from `mawsd`'s own globals on the daemon shape as main's `app.evaluate` reads them
// in process on the embedded one: the scenario's manual clock (src/services/sessions/stub-source.ts) and the library's
// held refreshes (src/services/library/index.ts). Main relays to it under MAWS_E2E=1 (src/main/sessions/daemon-e2e-seams.ts),
// so a spec's seam reads the same on both shapes. Refused unless `mawsd` was started under MAWS_E2E=1: `allowed` is
// mawsd's own reading of its environment at its start (daemon.ts), never anything a request carries.
import { randomUUID } from 'node:crypto';
import { renameSync, writeFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { Module } from 'node:module';
import { basename } from 'node:path';
import type { AppSessionId, RequestId } from '@shared/graph/ids';
import type { BrowserFeed, BrowserInventory, BrowserSubscription } from '@shared/browser/screencast';
import type { CommandInput, CommandOutput } from '@shared/ipc/schema';
import type { MawsArtifactCapture, MawsArtifactCapturedResult } from '@shared/ipc/schema/maws';

type Seams = { __maws_scenario?: { advanceTo(ms: number): void }; __maws_library?: { holdRefreshes(): Promise<void> } };

export async function runE2eSeam(input: CommandInput<'daemon.e2eSeam'>, allowed: boolean): Promise<void> {
  if (!allowed) throw new Error('daemon.e2eSeam is refused: mawsd was not started under MAWS_E2E=1');
  const seams = globalThis as Seams;
  if (input.seam === 'scenario.advanceTo') {
    if (!seams.__maws_scenario) throw new Error('no scenario clock: mawsd is not in launch mode scenario with MAWS_SCENARIO_CLOCK=manual');
    return seams.__maws_scenario.advanceTo(input.ms);
  }
  if (!seams.__maws_library) throw new Error('no library seam: the spine’s library is not running');
  await seams.__maws_library.holdRefreshes();
}

// P5 O5 M4 (docs/doperpowers/plans/2026-10-31-p5-o5-chromium.md, Interfaces §K): `daemon.e2eRender`, a capture through
// the render seam fed as the engine host's `maws.artifact.capture` would be, its PNG written to `to` for the e2e to read.
// Refused unless `mawsd` runs under MAWS_E2E=1, as the seams above.
export async function runE2eRender(input: CommandInput<'daemon.e2eRender'>, allowed: boolean, capture: (request: MawsArtifactCapture) => Promise<MawsArtifactCapturedResult>): Promise<void> {
  if (!allowed) throw new Error('daemon.e2eRender is refused: mawsd was not started under MAWS_E2E=1');
  const { artifactId, revision, width, height, to } = input;
  const result = await capture({ appSessionId: 'e2e-render' as AppSessionId, requestId: `e2e-render-${randomUUID()}` as RequestId, artifactId, revision, width, height });
  if (!result.ok) throw new Error(`the capture failed: ${result.error}`);
  await writeFile(to, Buffer.from(result.png, 'base64'));
}

// P5 O17 M9b fix wave (docs/doperpowers/plans/2026-11-01-p5-o17-browser.md, M9): `daemon.e2eBrowserView`, a viewer of
// `mawsd`'s own feed (DaemonServices.browser), read as the endpoint's viewers read it, so an e2e proves a tab engine's
// whole way (the app's, in `relay`: the inventory asked of it, its answer, its frames) with no remote device. It waits
// for the first ready inventory that lists a tab, opens that tab (the selection, else the first) read-only, takes
// `frames` frames acknowledging each but the last, closes, and answers what it saw; within E2E_BROWSER_VIEW_MS, under the
// host request's 10 s. Refused unless `mawsd` runs under MAWS_E2E=1, as the seams above.
export const E2E_BROWSER_VIEW_MS = 8_000;
export async function runE2eBrowserView(input: CommandInput<'daemon.e2eBrowserView'>, allowed: boolean, feed: BrowserFeed): Promise<CommandOutput<'daemon.e2eBrowserView'>> {
  if (!allowed) throw new Error('daemon.e2eBrowserView is refused: mawsd was not started under MAWS_E2E=1');
  const appSessionId = input.appSessionId as AppSessionId;
  const until = Date.now() + E2E_BROWSER_VIEW_MS;
  const bounded = <T>(what: string, run: (done: (value: T) => void, fail: (error: Error) => void) => () => void): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      let settled = false;
      let cleanup: (() => void) | null = null;
      const settle = (finish: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        queueMicrotask(() => cleanup?.()); // a reading told at once ends the watch after it was made
        finish();
      };
      const timer = setTimeout(() => settle(() => reject(new Error(`${what} within ${E2E_BROWSER_VIEW_MS / 1000} s`))), Math.max(0, until - Date.now()));
      cleanup = run((value) => settle(() => resolve(value)), (error) => settle(() => reject(error)));
      if (settled) cleanup();
    });
  const inventory = await bounded<BrowserInventory>(`no tab in the agent’s browser inventory of ${appSessionId}`, (done) =>
    feed.watchInventory(appSessionId, (reading) => void (reading.state === 'ready' && reading.tabs.length > 0 && done(reading))),
  );
  const tabId = inventory.selected ?? inventory.tabs[0]!.tabId;
  const frames: CommandOutput<'daemon.e2eBrowserView'>['frames'] = [];
  let subscription: BrowserSubscription | null = null;
  let unacked: number | null = null; // a frame before the open's answer: acknowledged at it
  let over = false; // the view is done: an open answered after it is closed at once
  await bounded<void>(`${input.frames} frames of ${tabId}`, (done, fail) => {
    feed.open({ appSessionId, epoch: inventory.epoch, tabId, control: false }, {
      frame(frame) {
        frames.push({ seq: frame.seq, width: frame.width, height: frame.height, bytes: frame.jpeg.byteLength });
        if (frames.length >= input.frames) return done();
        if (subscription) subscription.ack(frame.seq);
        else unacked = frame.seq;
      },
      closed: (reason) => fail(new Error(`the subscription to ${tabId} closed: ${reason}`)),
    }).then(
      (opened) => {
        if (over) return opened.close();
        subscription = opened;
        if (unacked !== null) opened.ack(unacked);
      },
      (error: unknown) => fail(error instanceof Error ? error : new Error(String(error))),
    );
    return () => {};
  }).finally(() => {
    over = true;
    (subscription as BrowserSubscription | null)?.close();
  });
  return { tabs: inventory.tabs.map((tab) => tab.tabId), tabId, frames };
}

// P5 O17 M8 (docs/doperpowers/plans/2026-11-01-p5-o17-browser.md, M8, e2e:daemon-idle): what `mawsd` holds, read from
// outside by the e2e at a moment it chooses (SIGUSR2 under MAWS_E2E=1, ./index.ts): Node's active resources (a `Timeout`
// per armed timer, a `PipeServerWrap` per listener) and the modules loaded so far, by file name (a deferred chunk's file
// is its module's name and a hash: `cua-broker-…js`, `browser-feed-…js`). Nothing reads it in a run that is not an e2e.
export function e2eResources(): { resources: string[]; modules: string[] } {
  const cache = (Module as unknown as { _cache?: Record<string, unknown> })._cache ?? {}; // require.cache
  return { resources: process.getActiveResourcesInfo(), modules: Object.keys(cache).map((path) => basename(path)) };
}

// The report, written whole (a temp file renamed over the last), with the daemon's browser facts when it runs (its
// e2eBrowser(), read here at the signal and never before; null otherwise)
export function writeE2eResources(file: string, browser: unknown = null): void {
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify({ at: new Date().toISOString(), ...e2eResources(), browser }));
  renameSync(temp, file);
}
