// R2's proof (the UX wave, U2b: docs/doperpowers/plans/2026-11-15-ux-wave-U2b-to-human-view.md, decisions 3 and 4,
// Interfaces §A; M4's first sequence): a launch's advertisement is reserved in the index before the launch is sent, the
// host accepts it, and the daemon stops before the bind. A new owner service starts on the same index while that launch
// runs: it reads the live statuses once and binds nothing (§A, A4: an unbound reservation is no evidence of what an
// unrecorded launch carried), and publishes `mod`, never `maws`, at every instant from before the stop to after the
// plugins are reported (B12, B13). The cells each case pins are named in it. The installation is a scratch one, with the
// declaration; the cutover's switch is injected on.
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LaunchSpecSchema, type LaunchSpec } from '@shared/engine/launch-spec';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { AppSessionId } from '@shared/graph/ids';
import type { HostDispatch } from '@shared/host/host-supervisor';
import { NATIVE_TO_HUMAN_ENV } from '@shared/owner/contract';
import type { OwnerChannelState } from '@shared/owner/state';
import { SETTINGS_DEFAULTS_V21 } from '@shared/settings/defaults';
import { summary, tempDir } from '../../../test/support/index-fixture';
import { installToHumanPlugin } from '../../../test/support/to-human-plugin';
import { Index } from '../index/index';
import type { HostEvents } from '../sessions/context';
import { ownerChannelLaunch, ownerChannelLaunched } from './launch';
import { startOwnerChannel, type OwnerChannel } from './register';

const AT = '2026-11-16T10:00:00.000Z';

describe('the daemon stops between the send and the bind', () => {
  let root: string;
  let configHome: string;
  let dir: ReturnType<typeof tempDir>;
  let index: Index;
  let a: AppSessionId;
  let live: EngineSessionStatus[];
  let listing: Promise<void>;
  let releaseListing: () => void;
  const listeners = new Map<string, ((payload: unknown) => void)[]>();
  const handlers = new Map<string, (input: unknown) => unknown>();
  const emitted: { appSessionId: string; state: OwnerChannelState }[] = [];
  const channels: OwnerChannel[] = [];
  const env = () => ({ HOME: join(root, 'home'), CLAUDE_CONFIG_DIR: configHome });
  const dispatch: HostDispatch = async (_owner, name) => {
    if (name === 'engine.sessions') {
      await listing;
      return { ok: true, value: live };
    }
    return { ok: false, error: { code: 'internal', message: `unexpected ${name}` } };
  };
  const status = (over: Partial<EngineSessionStatus>) => ({ appSessionId: a, launchId: 'l1', launchedAt: AT, process: 'ready', plugins: [], pluginsObservedAt: null, ...over }) as EngineSessionStatus;
  let laneOn: boolean;
  const settings = () => {
    const value = structuredClone(SETTINGS_DEFAULTS_V21);
    value.mods.toHuman.enabled = laneOn;
    return value;
  };
  const newSpec = (): LaunchSpec => LaunchSpecSchema.parse({
    appSessionId: a, cwd: join(root, 'work'), additionalDirectories: [], model: null, effort: null, permissionMode: null, gateway: 'gateway', subagentModel: null,
    resume: null, sessionId: null, trust: null, mcpConfig: null, extraSettings: null, maxBudgetUsd: null, replay: null, inheritGrantsFrom: null,
  });
  const decide = (channel: OwnerChannel) => ownerChannelLaunch({ env: env(), dispatch, sessions: index.sessions, log: () => {}, owner: channel.launches }, newSpec(), { kind: 'new', transcriptOf: null });
  const plugin = (path: string) => [{ name: 'to-human', path, source: 'to-human@doperpowers', version: '0' }];
  const published = () => emitted.filter((e) => e.appSessionId === a).map((e) => e.state.lane.drawnBy);
  const fire = (name: string, payload: unknown) => listeners.get(name)?.forEach((listener) => listener(payload));
  const drawnBy = () => (handlers.get('ownerChannel.state')!({ appSessionId: a }) as OwnerChannelState).lane.drawnBy;

  const start = () => {
    listeners.clear();
    handlers.clear();
    const channel = startOwnerChannel({
      index,
      settings,
      engineEnv: Promise.resolve(env()),
      onEvent: ((name: string, listener: (payload: unknown) => void) => {
        listeners.set(name, [...(listeners.get(name) ?? []), listener]);
        return () => listeners.set(name, (listeners.get(name) ?? []).filter((l) => l !== listener));
      }) as HostEvents,
      register: ((name: string, handler: (input: unknown) => unknown) => void handlers.set(name, handler)) as never,
      log: () => {},
      attention: { setOwnerItems: () => {} },
      dispatch,
      onHostState: () => () => {},
      onStreaming: () => () => {},
      streaming: () => true,
      emit: (_name, payload) => void emitted.push(payload as { appSessionId: string; state: OwnerChannelState }),
      onSettings: () => () => {},
      modRoute: true, // the cutover's switch, injected
    });
    channels.push(channel);
    return channel;
  };

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'maws-owner-restart-')));
    configHome = join(root, 'engine-config');
    mkdirSync(join(root, 'work'), { recursive: true });
    dir = tempDir();
    index = new Index(join(dir.path, 'index.sqlite'));
    a = index.sessions.upsertFromSummary(summary({ directory: join(root, 'work') })).record.appId;
    live = [];
    listing = Promise.resolve();
    emitted.length = 0;
    laneOn = true;
  });
  afterEach(() => {
    channels.splice(0).forEach((channel) => channel.stop());
    index.close();
    dir.dispose();
    rmSync(root, { recursive: true, force: true });
  });

  it('A4, B12, B13, B14 · the unbound reservation’s launch reads as not known: mod before the stop, across the restart and after the plugins report; nothing bound', async () => {
    const installation = installToHumanPlugin(configHome, { declares: true });
    const first = start();
    await first.work.settled();
    const spec: LaunchSpec = LaunchSpecSchema.parse({
      appSessionId: a, cwd: join(root, 'work'), additionalDirectories: [], model: null, effort: null, permissionMode: null, gateway: 'gateway', subagentModel: null,
      resume: null, sessionId: null, trust: null, mcpConfig: null, extraSettings: null, maxBudgetUsd: null, replay: null, inheritGrantsFrom: null,
    });
    const decided = await ownerChannelLaunch({ env: env(), dispatch, sessions: index.sessions, log: () => {}, owner: first.launches }, spec, { kind: 'new', transcriptOf: null });
    expect((decided.spec.extraSettings as { env: Record<string, string> }).env[NATIVE_TO_HUMAN_ENV]).toBe('9');
    expect(index.ownerChannel.session(a)?.advertised).toMatchObject({ launchId: null, number: 9, plugin: true });
    expect(drawnBy()).toBe('maws'); // reserved, not yet sent: the session is at rest

    // the host accepts: the launch's first status reaches the running daemon, which never writes the bind
    fire('session.status', { appSessionId: a, status: status({ process: 'starting' }) });
    expect(drawnBy()).toBe('mod');
    first.stop();

    // a new daemon starts while the launch runs; its read of the live statuses is held open
    live = [status({})];
    listing = new Promise((resolve) => (releaseListing = resolve));
    const second = start();
    expect(drawnBy()).toBe('mod'); // before the read answers: the row's newest launch read as live
    releaseListing();
    await second.work.settled();
    expect(drawnBy()).toBe('mod');
    expect(index.ownerChannel.session(a)?.advertised).toMatchObject({ launchId: null, number: 9 }); // the start binds nothing

    // the plugins report: the declaring installation, read at its reported path
    fire('session.status', { appSessionId: a, status: status({ plugins: [{ name: 'to-human', path: installation, source: 'to-human@doperpowers', version: '0' }], pluginsObservedAt: AT }) });
    expect(drawnBy()).toBe('mod');
    await second.work.settled();
    expect(drawnBy()).toBe('mod');
    expect(emitted.filter((e) => e.appSessionId === a).map((e) => e.state.lane.drawnBy)).not.toContain('maws');

    // a reload to an installation without the declaration: still mod, whatever it declares (B13: not known)
    const older = join(configHome, 'plugins', 'cache', 'doperpowers', 'to-human', '0.8.2');
    mkdirSync(older, { recursive: true });
    fire('session.status', { appSessionId: a, status: status({ plugins: plugin(older), pluginsObservedAt: '2026-11-16T10:05:00.000Z' }) });
    await second.work.settled();
    expect(drawnBy()).toBe('mod');
    // a reload with the mod not loaded: MAWS (B14)
    fire('session.status', { appSessionId: a, status: status({ plugins: [], pluginsObservedAt: '2026-11-16T10:06:00.000Z' }) });
    expect(drawnBy()).toBe('maws');
    expect(emitted.at(-1)).toMatchObject({ appSessionId: a, state: { lane: { drawnBy: 'maws' } } });
  });

  it('A2 · the daemon ends between a relaunch’s reservation and its bind: the running launch still reads its bound 9 across the restart; the next reservation overwrites the leftover', async () => {
    const installation = installToHumanPlugin(configHome, { declares: true });
    const first = start();
    ownerChannelLaunched({ owner: first.launches }, (await decide(first)).record, { launchId: 'l1', at: AT }); // the running launch, at 9, bound
    fire('session.status', { appSessionId: a, status: status({ plugins: plugin(installation), pluginsObservedAt: AT }) });
    await first.work.settled();
    expect(drawnBy()).toBe('mod');
    await decide(first); // a relaunch reserved; the daemon ends before the host answers, and the relaunch never runs
    first.stop();
    live = [status({ plugins: plugin(installation), pluginsObservedAt: AT })];
    listing = new Promise((resolve) => (releaseListing = resolve));
    const second = start();
    expect(drawnBy()).toBe('mod'); // before the read answers
    releaseListing();
    await second.work.settled();
    expect(drawnBy()).toBe('mod'); // the prior, bound to l1: its own 9, the declaring installation loaded (B4)
    expect(index.ownerChannel.session(a)?.advertised).toMatchObject({ launchId: null, prior: { launchId: 'l1', number: 9 } });
    laneOn = false;
    await decide(second); // the next launch's reservation: the leftover replaced, the bound slot kept
    expect(index.ownerChannel.session(a)?.advertised).toEqual({ launchId: null, number: null, plugin: true, at: expect.any(String), prior: { launchId: 'l1', number: 9, plugin: true } });
    expect(drawnBy()).toBe('mod');
    expect(published()).not.toContain('maws');
  });

  it('A4 · an abandoned reservation at 8 is never bound to a later launch at the restart, nor read as its number', async () => {
    const installation = installToHumanPlugin(configHome); // no declaration: a lane-on launch advertises 8
    const first = start();
    await first.work.settled();
    await decide(first); // reserved at 8 and refused: left unbound
    expect(index.ownerChannel.session(a)?.advertised).toMatchObject({ launchId: null, number: 8 });
    // a later lane-off launch whose reservation write fails goes with nothing; the daemon stops before recording it
    laneOn = false;
    const reserve = vi.spyOn(index.ownerChannel, 'reserveLaunch').mockImplementationOnce(() => {
      throw new Error('the index is busy');
    });
    const decided = await decide(first);
    expect(decided.record).toMatchObject({ advertised: null, reserved: false });
    reserve.mockRestore();
    fire('session.status', { appSessionId: a, status: status({ launchId: 'l2', process: 'starting' }) });
    expect(drawnBy()).toBe('mod'); // B12, where the abandoned 8 read MAWS
    first.stop();
    live = [status({ launchId: 'l2', plugins: plugin(installation), pluginsObservedAt: AT })];
    const second = start();
    await second.work.settled();
    expect(index.ownerChannel.session(a)?.advertised).toMatchObject({ launchId: null, number: 8 }); // not bound to l2
    expect(drawnBy()).toBe('mod'); // B13: the loaded mod draws as in a terminal
    expect(published()).not.toContain('maws');
  });

  it('C4 · the start’s read is not applied over a newer event: an exit after the read was sent keeps the session at rest', async () => {
    installToHumanPlugin(configHome, { declares: true });
    const first = start();
    ownerChannelLaunched({ owner: first.launches }, (await decide(first)).record, { launchId: 'l1', at: AT });
    first.stop();
    live = [status({ process: 'ready' })]; // the host's answer, older than the exit below
    listing = new Promise((resolve) => (releaseListing = resolve));
    const second = start();
    fire('session.status', { appSessionId: a, status: status({ process: 'exited' }) });
    expect(drawnBy()).toBe('maws');
    releaseListing();
    await second.work.settled();
    expect(drawnBy()).toBe('maws');
  });

  it('a reservation the host never accepted stays unbound across the restart, and the session reads at rest', async () => {
    installToHumanPlugin(configHome, { declares: true });
    const first = start();
    await ownerChannelLaunch({ env: env(), dispatch, sessions: index.sessions, log: () => {}, owner: first.launches }, LaunchSpecSchema.parse({
      appSessionId: a, cwd: join(root, 'work'), additionalDirectories: [], model: null, effort: null, permissionMode: null, gateway: 'gateway', subagentModel: null,
      resume: null, sessionId: null, trust: null, mcpConfig: null, extraSettings: null, maxBudgetUsd: null, replay: null, inheritGrantsFrom: null,
    }), { kind: 'new', transcriptOf: null });
    first.stop();
    live = []; // the launch never ran
    const second = start();
    await second.work.settled();
    expect(index.ownerChannel.session(a)?.advertised).toMatchObject({ launchId: null, number: 9 });
    expect(drawnBy()).toBe('maws');
  });
});
