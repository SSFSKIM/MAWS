// The spine's idle reading (P5 O3-C, docs/doperpowers/plans/2026-10-28-p5-o3-c-spine-library.md, Interfaces §F; D18):
// e2e:daemon-idle-spine's subject, composed here under plain Node over a small fixture. It composes the spine alone with
// stand-in ports, says so, and on its trigger stops the root, collects when the runtime lets it, and says so; a timer
// keeps its process alive until `dispose`.
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tempDir } from '../../test/support/index-fixture';
import { writeSpineFixture, type SpineFixtureCounts } from '../../test/support/spine-fixture';
import { idleReading } from './idle-reading';
import { Index } from './index/index';

const SMALL: SpineFixtureCounts = { sessions: 40, projects: 4, attention: 8, pending: 3, library: 10, drafts: 4, history: 12 };
const BUILD = '0.0.0+idle-reading-test';
const KEEP_ALIVE_MS = 1 << 30;

describe('the spine idle reading', () => {
  let dir: ReturnType<typeof tempDir>;
  let profile: string;
  let lines: string[];
  const log = (line: string) => void lines.push(line);

  beforeEach(async () => {
    dir = tempDir('maws-idle-reading-');
    profile = join(dir.path, 'ud');
    mkdirSync(join(dir.path, 'home'));
    // the reading takes process.env as the engine's environment: a scratch home, never the owner's
    vi.stubEnv('HOME', join(dir.path, 'home'));
    vi.stubEnv('CLAUDE_CONFIG_DIR', join(dir.path, 'home', '.claude'));
    await writeSpineFixture({ profile, folders: join(dir.path, 'projects'), counts: SMALL });
    lines = [];
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    dir.dispose();
  });

  it("composes the spine alone over the profile, naming what it read, and holds the profile's spine.lock", async () => {
    let release: (() => void) | undefined;
    const reading = await idleReading({ profile, build: BUILD, log, onRelease: (trigger) => (release = trigger) });
    expect(lines).toEqual([`spine idle: composed: ${SMALL.sessions} sessions in ${SMALL.projects} projects`]);
    expect(JSON.parse(readFileSync(join(profile, 'spine.lock'), 'utf8'))).toMatchObject({ pid: process.pid, buildId: BUILD });
    release!();
    await reading.released;
    reading.dispose();
  });

  it('on its trigger stops the root, collects twice when the runtime exposes gc, and says it released', async () => {
    const gc = vi.fn();
    vi.stubGlobal('gc', gc);
    const close = vi.spyOn(Index.prototype, 'close');
    let release: (() => void) | undefined;
    const reading = await idleReading({ profile, build: BUILD, log, onRelease: (trigger) => (release = trigger) });
    expect(close).not.toHaveBeenCalled();
    release!();
    await reading.released;
    expect(close).toHaveBeenCalledOnce(); // the root's stop closed the index
    expect(gc).toHaveBeenCalledTimes(2);
    expect(lines.slice(1)).toEqual(['spine idle: released (gc: true)']);
    release!(); // a second trigger does nothing
    expect(close).toHaveBeenCalledOnce();
    reading.dispose();
  });

  it('says no collection ran when the runtime exposes none', async () => {
    vi.stubGlobal('gc', undefined);
    let release: (() => void) | undefined;
    const reading = await idleReading({ profile, build: BUILD, log, onRelease: (trigger) => (release = trigger) });
    release!();
    await reading.released;
    expect(lines.slice(1)).toEqual(['spine idle: released (gc: false)']);
    reading.dispose();
  });

  it('keeps its process alive with a timer from composing until dispose, through the release', async () => {
    const intervals = vi.spyOn(globalThis, 'setInterval');
    const cleared = vi.spyOn(globalThis, 'clearInterval');
    let release: (() => void) | undefined;
    const reading = await idleReading({ profile, build: BUILD, log, onRelease: (trigger) => (release = trigger) });
    const keepAlive = intervals.mock.results[intervals.mock.calls.findIndex(([, ms]) => ms === KEEP_ALIVE_MS)]?.value as unknown;
    expect(keepAlive).toBeDefined();
    release!();
    await reading.released;
    expect(cleared).not.toHaveBeenCalledWith(keepAlive);
    reading.dispose();
    expect(cleared).toHaveBeenCalledWith(keepAlive);
  });

  it('is released by SIGUSR2 unless the caller passes its own trigger', async () => {
    const listening = process.listenerCount('SIGUSR2');
    const reading = await idleReading({ profile, build: BUILD, log });
    expect(process.listenerCount('SIGUSR2')).toBe(listening + 1);
    process.emit('SIGUSR2', 'SIGUSR2');
    await reading.released;
    expect(lines.at(-1)).toMatch(/^spine idle: released \(gc: (true|false)\)$/);
    reading.dispose();
    expect(process.listenerCount('SIGUSR2')).toBe(listening);
  });
});
