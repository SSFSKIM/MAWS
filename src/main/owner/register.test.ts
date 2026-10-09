// Main's wiring of the owner channel's launch half: `mods.*` registered over the index with the app's switch from
// settings, the config home from the engine's environment, and the host's event batches feeding the mismatch check.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId } from '@shared/graph/ids';
import { SETTINGS_DEFAULTS_V12 } from '@shared/settings/defaults';
import type { Settings } from '@shared/ipc/schema/settings';
import { summary, tempDir } from '../../../test/support/index-fixture';
import { Index } from '../index/index';
import type { HostEvents } from '../sessions/context';
import { startOwnerChannel } from './register';

describe('startOwnerChannel', () => {
  let root: string;
  let dir: ReturnType<typeof tempDir>;
  let index: Index;
  let settings: Settings;
  let a: AppSessionId;
  const handlers = new Map<string, (input: unknown) => unknown>();
  const listeners = new Map<string, (payload: unknown) => void>();
  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'maws-owner-register-')));
    dir = tempDir();
    index = new Index(join(dir.path, 'index.sqlite'));
    a = index.sessions.upsertFromSummary(summary({ directory: root })).record.appId;
    settings = structuredClone(SETTINGS_DEFAULTS_V12);
    handlers.clear();
    listeners.clear();
  });
  afterEach(() => {
    index.close();
    dir.dispose();
    rmSync(root, { recursive: true, force: true });
  });
  const start = () =>
    startOwnerChannel({
      index,
      settings: () => settings,
      engineEnv: Promise.resolve({ HOME: join(root, 'home'), CLAUDE_CONFIG_DIR: join(root, 'engine-config') }),
      onEvent: ((name: string, listener: (payload: unknown) => void) => {
        listeners.set(name, listener);
        return () => {};
      }) as HostEvents,
      register: ((name: string, handler: (input: unknown) => unknown) => void handlers.set(name, handler)) as never,
      log: () => {},
    });

  it('registers mods.list and mods.setSessionOverride over the index, the app switch read from settings at each call', async () => {
    start();
    expect([...handlers.keys()].sort()).toEqual(['mods.list', 'mods.setSessionOverride']);
    expect(await handlers.get('mods.list')!({})).toMatchObject([{ id: 'maws.to-human', enabled: true, source: 'maws-contract' }]);
    settings = { ...settings, mods: { toHuman: { enabled: false } } };
    expect(await handlers.get('mods.list')!({})).toMatchObject([{ enabled: false, source: 'off' }]);
    handlers.get('mods.setSessionOverride')!({ appSessionId: a, id: 'maws.to-human', value: 'on' });
    expect(await handlers.get('mods.list')!({ appSessionId: a })).toMatchObject([{ enabled: false, perSession: 'on', source: 'maws-contract', pending: 'next-launch' }]);
  });

  it('reads the user style from the engine’s config home', async () => {
    mkdirSync(join(root, 'engine-config', 'output-styles'), { recursive: true });
    writeFileSync(join(root, 'engine-config', 'output-styles', 'report.md'), '---\nname: report\nmaws-to-human-contract: 1\n---\n');
    writeFileSync(join(root, 'engine-config', 'settings.json'), JSON.stringify({ outputStyle: 'report' }));
    start();
    expect(await handlers.get('mods.list')!({})).toMatchObject([{ source: 'external-compatible-style' }]);
  });

  it('feeds the host’s event batches to the launches’ mismatch check', () => {
    const launches = start();
    launches.launched(
      { appSessionId: a, kind: 'new', laneOn: true, override: 'inherit', desired: 'maws-contract', recorded: 'unrecorded', appended: true, snapshotOff: false, offUnavailable: false, applied: 'maws-contract', style: 'default', decidedBy: 'default', styleUnresolved: null },
      { launchId: 'l1', at: 't' },
    );
    const init = { id: 'e1', sessionId: 's', at: 't', seq: 1, agentId: null, parentToolUseId: null, kind: 'session.init', outputStyle: 'Explanatory' } as unknown as SessionEvent;
    listeners.get('session.eventBatch')!({ appSessionId: a, events: [init] });
    expect(index.ownerChannel.session(a)).toMatchObject({ style: 'default', observedStyle: 'Explanatory', styleMismatch: true });
  });
});
