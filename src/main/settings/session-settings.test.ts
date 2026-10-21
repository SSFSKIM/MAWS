// The settings C10's session service consults (C11 execution document, M1 refresh task "feed C10's settings seam"): a
// change in the settings store reaches the next `session.create` (its intent's route) and the next launch's
// `subagentModel`, with no restart. Over C10's real service (its test harness: the real index, intent store and a fake
// engine host) and C11's real settings store on a temporary file.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionHarness } from '../../../test/support/session-harness';
import { sessionIdFor, summary } from '../../../test/support/index-fixture'; // P4-A2
import { T0 } from '../../../test/support/builders'; // P4-A2
import { userScopeProfile, type LaunchProfile } from '@shared/engine/launch-profile'; // P4-A2
import { sessionSettingsOf } from './session-settings';
import { openSettingsStore } from './store';

vi.mock('electron', () => {
  throw new Error('the session settings must not load Electron');
});

describe('the session service reads the settings store', () => {
  const cleanups: (() => void)[] = [];
  afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

  async function setup() {
    const dir = mkdtempSync(join(tmpdir(), 'maws-c11-session-settings-'));
    const store = openSettingsStore(join(dir, 'settings.json'));
    const h = await new SessionHarness({ settings: () => sessionSettingsOf(store.settings) }).start();
    cleanups.push(() => {
      h.dispose();
      rmSync(dir, { recursive: true, force: true });
    });
    h.trustDirectory(h.work);
    const create = async () => (await h.service.create({ projectId: null, location: { kind: 'directory', path: h.work } })).intent;
    return { store, h, create };
  }

  it('a default-route change reaches the next session.create, and the one before keeps its route', async () => {
    const { store, create } = await setup();
    const before = await create();
    expect(before.gateway).toBe('gateway');
    store.update({ gateway: { defaultRoute: 'direct' } });
    expect((await create()).gateway).toBe('direct');
    expect(before.gateway).toBe('gateway');
  });

  it("a subagent-model change reaches the next launch's subagentModel", async () => {
    const { store, h, create } = await setup();
    store.update({ engine: { subagentModel: 'sonnet' } });
    const { appSessionId } = await create();
    expect(await h.service.startSession(appSessionId, { message: null, options: {} })).toMatchObject({ status: 'starting' });
    await h.settled(appSessionId);
    expect(h.host.launches.map((spec) => spec.subagentModel)).toEqual(['sonnet']);
  });

  // P4-A2 (the launch profile, settings v17): a profile is no start option (the in-flight join rule, src/main/sessions/
  // inflight.ts, never sees it); a launch reads the setting when it builds its spec. An acquisition joins a launch in
  // flight whatever the setting says, a change never touches a live session, and the session's next launch takes it.
  it('a launch-profile change reaches the next launch alone: a launch in flight keeps the profile it read and is joined, a live session is never relaunched for it', async () => {
    const { store, h } = await setup();
    const P1: LaunchProfile = { plugins: { off: ['ptc@ptc-tool'] }, outputStyle: 'user', hooks: 'user' };
    const P2: LaunchProfile = { plugins: { off: [] }, outputStyle: 'maws', hooks: 'none' };
    const record = h.index.sessions.upsertFromSummary(summary({ sessionId: sessionIdFor(0xa2f01), directory: h.work })).record;
    const launches = () => h.host.launches.filter((spec) => spec.appSessionId === record.appId);
    store.update({ engine: { launchProfile: P1 } });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    h.host.script = () => ({ onReady: () => gate });
    const first = h.service.acquire(record.appId, 'read');
    await h.until(() => launches().length === 1);
    store.update({ engine: { launchProfile: P2 } }); // while the launch is in flight, its spec already built
    const second = h.service.acquire(record.appId, 'send');
    release();
    expect(await first).toMatchObject({ status: 'ready', launched: true, joined: false });
    expect(await second).toMatchObject({ status: 'ready', launched: true, joined: true });
    expect(launches().map((spec) => spec.extraSettings)).toEqual([{ enabledPlugins: { 'ptc@ptc-tool': false } }]);
    // live: nothing relaunches it for the change
    expect(await h.service.acquire(record.appId, 'read')).toMatchObject({ status: 'ready', launched: false });
    expect(launches()).toHaveLength(1);
    // its next launch takes the current setting
    h.host.script = () => ({});
    const live = h.host.table.get(record.appId)!;
    h.host.table.set(record.appId, { ...live, process: 'exited', exit: { code: null, signal: null, reason: 'stop', at: T0, release: null } });
    expect(await h.service.acquire(record.appId, 'read')).toMatchObject({ status: 'ready', launched: true });
    expect(launches().map((spec) => spec.extraSettings)).toEqual([{ enabledPlugins: { 'ptc@ptc-tool': false } }, { outputStyle: 'default', disableAllHooks: true }]);
  });

  it('maps the six fields C10 reads and nothing else', () => { // W3: the auto fallback; P4-R8: the app MCP servers; P4-A2: the launch profile
    const dir = mkdtempSync(join(tmpdir(), 'maws-c11-session-settings-'));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const store = openSettingsStore(join(dir, 'settings.json'));
    expect(sessionSettingsOf(store.settings).engine.launchProfile).toEqual(userScopeProfile()); // P4-A2: the default
    const launchProfile: LaunchProfile = { plugins: { off: ['cua@cua'] }, outputStyle: 'maws', hooks: 'user' };
    store.update({ gateway: { relayUnreachable: 'wait', offerDirect: false }, engine: { subagentModel: 'haiku', memoryBudgetMiB: 4096, mcpServers: [{ name: 'notion', type: 'http', url: 'https://mcp.notion.com/mcp' }], launchProfile } });
    expect(sessionSettingsOf(store.settings)).toEqual({ gateway: { defaultRoute: 'gateway', relayUnreachable: 'wait' }, engine: { subagentModel: 'haiku', mcpServers: [{ name: 'notion', type: 'http', url: 'https://mcp.notion.com/mcp' }], launchProfile }, permissions: { autoFallback: 'acceptEdits' } });
  });
});
