// `mods.list` and `mods.setSessionOverride` (X20; the P2-C document, §9): one row per built-in mod with the app's switch
// and, without a session, what a new launch in no project would do; with a session, its override, its last applied
// state, whether a lane change is still pending and the style mismatch.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { BUILT_IN_MODS } from '@shared/mods/registry';
import { summary, tempDir } from '../../../test/support/index-fixture';
import { Index } from '../index/index';
import { modsList, setSessionOverride, type ModsDeps } from './mods';
import type { LaunchRecord } from './store';

const AT = '2026-10-09T10:00:00.000Z';
const launch = (over: Partial<LaunchRecord>): LaunchRecord => ({
  launchId: 'l1', at: AT, laneOn: true, desired: 'maws-contract', recorded: 'unrecorded', appended: true, snapshotOff: false, applied: 'maws-contract', style: 'default', ...over,
});
const MOD = { id: 'maws.to-human', name: BUILT_IN_MODS[0]!.name, description: BUILT_IN_MODS[0]!.description, version: 1 };

describe('mods.list and mods.setSessionOverride', () => {
  let root: string;
  let configHome: string;
  let dir: ReturnType<typeof tempDir>;
  let index: Index;
  let appEnabled: boolean;
  let deps: ModsDeps;
  let a: AppSessionId;
  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'maws-mods-')));
    configHome = join(root, 'config');
    mkdirSync(configHome, { recursive: true });
    dir = tempDir();
    index = new Index(join(dir.path, 'index.sqlite'));
    a = index.sessions.upsertFromSummary(summary({ directory: join(root, 'work') })).record.appId;
    appEnabled = true;
    deps = { store: index.ownerChannel, sessions: index.sessions, appEnabled: () => appEnabled, configHome: async () => configHome, managedSettingsPath: join(root, 'managed.json') };
  });
  afterEach(() => {
    index.close();
    dir.dispose();
    rmSync(root, { recursive: true, force: true });
  });
  const put = (path: string, content: string | object) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, typeof content === 'string' ? content : JSON.stringify(content));
  };

  describe('without a session: what a new launch in no project would do', () => {
    it('the contract by default, off when the app switch is off', async () => {
      expect(await modsList(deps)).toEqual([{ ...MOD, enabled: true, source: 'maws-contract' }]);
      appEnabled = false;
      expect(await modsList(deps)).toEqual([{ ...MOD, enabled: false, source: 'off' }]);
    });

    it('the external style when the user settings select a compatible one', async () => {
      put(join(configHome, 'output-styles/report.md'), '---\nname: report\nmaws-to-human-contract: 1\n---\n');
      put(join(configHome, 'settings.json'), { outputStyle: 'report' });
      expect(await modsList(deps)).toEqual([{ ...MOD, enabled: true, source: 'external-compatible-style' }]);
    });
  });

  describe('with a session', () => {
    it('never launched by a decision: its override, and the contract pending at its next launch while the lane is on', async () => {
      expect(await modsList(deps, a)).toEqual([{ ...MOD, enabled: true, source: 'maws-contract', perSession: 'inherit', pending: 'next-launch' }]);
      setSessionOverride(deps, { appSessionId: a, id: 'maws.to-human', value: 'off' });
      expect(await modsList(deps, a)).toEqual([{ ...MOD, enabled: true, source: 'off', perSession: 'off' }]);
    });

    it('its last applied state; a lane switched since reads pending at the next launch', async () => {
      index.ownerChannel.recordLaunch(a, launch({}));
      expect(await modsList(deps, a)).toEqual([{ ...MOD, enabled: true, source: 'maws-contract', perSession: 'inherit' }]);
      setSessionOverride(deps, { appSessionId: a, id: 'maws.to-human', value: 'off' });
      expect(await modsList(deps, a)).toEqual([{ ...MOD, enabled: true, source: 'maws-contract', perSession: 'off', pending: 'next-launch' }]);
      index.ownerChannel.recordLaunch(a, launch({ launchId: 'l2', laneOn: false, desired: 'off', recorded: 'contract:1', appended: false, snapshotOff: true, applied: 'off' }));
      expect(await modsList(deps, a)).toEqual([{ ...MOD, enabled: true, source: 'off', perSession: 'off' }]);
    });

    it('a change the last launch could not honour (no flag) reads pending at the next compaction', async () => {
      setSessionOverride(deps, { appSessionId: a, id: 'maws.to-human', value: 'off' });
      index.ownerChannel.recordLaunch(a, launch({ laneOn: false, desired: 'off', recorded: 'contract:1', appended: false, snapshotOff: false, applied: 'maws-contract' }));
      expect(await modsList(deps, a)).toEqual([{ ...MOD, enabled: true, source: 'maws-contract', perSession: 'off', pending: 'next-compaction' }]);
      setSessionOverride(deps, { appSessionId: a, id: 'maws.to-human', value: 'inherit' });
      expect(await modsList(deps, a)).toEqual([{ ...MOD, enabled: true, source: 'maws-contract', perSession: 'inherit' }]);
    });

    it('the mismatch between the resolved and the observed style', async () => {
      index.ownerChannel.recordLaunch(a, launch({ style: 'report', desired: 'external-compatible-style', applied: 'external-compatible-style', appended: false }));
      index.ownerChannel.recordObserved(a, 'default', true);
      expect(await modsList(deps, a)).toEqual([{ ...MOD, enabled: true, source: 'external-compatible-style', perSession: 'inherit', mismatch: { resolved: 'report', observed: 'default' } }]);
    });

    it('refuses an override for a session the index has no record of', () => {
      expect(() => setSessionOverride(deps, { appSessionId: 'nobody' as AppSessionId, id: 'maws.to-human', value: 'on' })).toThrow(/unknown app session/);
    });
  });
});
