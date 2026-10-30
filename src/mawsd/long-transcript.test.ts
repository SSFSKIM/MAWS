// The long-transcript window on the daemon shape (docs/doperpowers/plans/2026-10-30-long-transcript-window.md): an app on
// mawsd's engine-host.sock, mawsd's own `[hosts]` link to the engine host, and the engine host's runtime over the real
// socket layer (test/support/mawsd-scene.ts), with every line cap on the way lowered together. One oversized answer used
// to close mawsd's shared link to the engine host and the app's connection with it, failing every request in flight
// and losing events for every session. Here: a long transcript's windowed answer crosses both hops under the cap with
// neither connection closing and a request for another session answered beside it; and an answer forced over the cap
// comes back as its request's error, both connections up and the next request answered. Facts, not timings.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import { eventBytes } from '@shared/graph/history-window';
import type { AppSessionId, EventId, SessionId } from '@shared/graph/ids';
import { FsService } from '../engine-host/fs/service';
import { LONG_DIR, LONG_SESSION, longTranscript } from '../../test/support/long-transcript';
import { MawsdScene } from '../../test/support/mawsd-scene';
import { StoreFixture } from '../../test/support/store-fixture';

// Every reader and writer on the path takes this cap: production's is 64 MiB.
const CAP = 256 * 1024;
vi.mock('@shared/host/socket-protocol', async (original) => ({ ...(await original<typeof import('@shared/host/socket-protocol')>()), LINE_CAP: 256 * 1024 }));

const LONG = 'app-long' as AppSessionId;
const OTHER = 'app-other' as AppSessionId;
const OTHER_SESSION = '33333333-3333-4333-8333-333333333333' as SessionId;

let scene: MawsdScene;
let fixture: StoreFixture;
let fs: FsService;

beforeEach(async () => {
  scene = new MawsdScene();
  fixture = await StoreFixture.create();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
});

afterEach(async () => {
  fs?.stop();
  await scene.dispose();
  await fixture.dispose();
  vi.restoreAllMocks();
});

// The fs service the stand-in engine host answers from: a long session (its whole history well over the cap) and a short one.
async function store(): Promise<FsService> {
  await fixture.addTranscript(LONG_DIR, LONG_SESSION, longTranscript(250));
  await fixture.addTranscript(LONG_DIR, OTHER_SESSION, longTranscript(3));
  fs = new FsService({ paths: fixture.paths, emit: () => true, window: { soft: 16 * 1024, hard: CAP / 4 } });
  await fs.start();
  fs.bind([{ sessionId: LONG_SESSION, appSessionId: LONG }, { sessionId: OTHER_SESSION, appSessionId: OTHER }]);
  return fs;
}

const torn = () => scene.logs.filter((line) => /closed the connection|restarting|disconnected/.test(line));

describe('a long transcript opened on the daemon shape', () => {
  it('crosses both hops under the cap, keeps both connections, and answers another session beside it', async () => {
    const service = await store();
    // `probe.newer` stands for `session.events` (the stand-in's registry passes any command raw, as mawsd relays it)
    scene.engineSpawn = { answers: { 'probe.newer': (input) => service.eventsSnapshot((input as { app: AppSessionId }).app, null, { before: (input as { before?: EventId }).before ?? null }) } };
    await scene.start();
    const app = await scene.app();
    expect(app.welcomed()).toBe(true);

    const [long, other] = await Promise.all([app.request('probe.newer', { app: LONG }, 10_000), app.request('probe.newer', { app: OTHER }, 10_000)]);
    expect(long).toMatchObject({ ok: true });
    expect(other).toMatchObject({ ok: true });
    const page = long.value as { events: SessionEvent[]; earlier?: EventId };
    expect(page.events.length).toBeGreaterThan(0);
    expect(page.earlier).toBeDefined();
    expect(JSON.stringify(long).length).toBeLessThan(CAP);

    // What the old answer would have carried in one line: the whole history, over the cap.
    let whole = page.events.reduce((bytes, event) => bytes + eventBytes(event), 0);
    for (let before = page.earlier; before !== undefined; ) {
      const older = (await app.request('probe.newer', { app: LONG, before }, 10_000)).value as { events: SessionEvent[]; earlier?: EventId };
      whole += older.events.reduce((bytes, event) => bytes + eventBytes(event), 0);
      before = older.earlier;
    }
    expect(whole).toBeGreaterThan(CAP);

    expect(app.closed).toBe(false);
    expect(torn()).toEqual([]);
    expect(scene.lastEngine().supervisor.logs.filter((line) => /EPIPE|closed the connection/.test(line))).toEqual([]);
    expect((await app.request('engine.ping')).t).toBe('res'); // the link still answers
  });

  it('answers a request whose answer would pass the cap with its error, and the next request as usual', async () => {
    scene.engineSpawn = { answers: { 'probe.newer': () => ({ blob: 'x'.repeat(CAP + 1024) }) } };
    await scene.start();
    const app = await scene.app();
    const refused = await app.request('probe.newer', {}, 10_000);
    expect(refused).toMatchObject({ ok: false, error: { code: 'internal', issues: { tooLarge: { cap: CAP } } } });
    expect((refused.error as { issues: { tooLarge: { bytes: number } } }).issues.tooLarge.bytes).toBeGreaterThan(CAP);
    expect(scene.lastEngine().supervisor.logs.some((line) => line.startsWith('refused to write the answer to request'))).toBe(true);
    expect(await app.request('engine.ping')).toMatchObject({ ok: true });
    expect(app.closed).toBe(false);
    expect(torn()).toEqual([]);
  });
});
