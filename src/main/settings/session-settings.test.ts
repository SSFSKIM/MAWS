// The settings C10's session service consults (C11 execution document, M1 refresh task "feed C10's settings seam"): a
// change in the settings store reaches the next `session.create` (its intent's route) and the next launch's
// `subagentModel`, with no restart. Over C10's real service (its test harness: the real index, intent store and a fake
// engine host) and C11's real settings store on a temporary file.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionHarness } from '../../../test/support/session-harness';
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

  it('maps the four fields C10 reads and nothing else', () => { // W3: the auto fallback
    const dir = mkdtempSync(join(tmpdir(), 'maws-c11-session-settings-'));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const store = openSettingsStore(join(dir, 'settings.json'));
    store.update({ gateway: { relayUnreachable: 'wait', offerDirect: false }, engine: { subagentModel: 'haiku', memoryBudgetMiB: 4096 } });
    expect(sessionSettingsOf(store.settings)).toEqual({ gateway: { defaultRoute: 'gateway', relayUnreachable: 'wait' }, engine: { subagentModel: 'haiku' }, permissions: { autoFallback: 'acceptEdits' } });
  });
});
