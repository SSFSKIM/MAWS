// `mods.list` and `mods.setSessionOverride` (X20; the P2-C document, §9): one row per built-in mod with the app's switch
// and, without a session, what a new launch in no project would do; with a session, its override, its last applied
// state, whether a lane change is still pending and the style mismatch. P4-R7z (the P4 spec's Decision Log 92): only a
// style declaring the to-human plugin's message tool carries the lane.
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { BUILT_IN_MODS } from '@shared/mods/registry';
import { summary, tempDir } from '../../../test/support/index-fixture';
import { installToHumanPlugin } from '../../../test/support/to-human-plugin';
import { Index } from '../index/index';
import { laneInEffect, modsList, setSessionOverride, styleCarriesNoLane, type ModsDeps } from './mods';
import type { LaunchRecord } from './store';

const AT = '2026-10-09T10:00:00.000Z';
const SUPPLEMENTED = 'external-style-plus-supplement';
const launch = (over: Partial<LaunchRecord>): LaunchRecord => ({
  launchId: 'l1', at: AT, laneOn: true, desired: SUPPLEMENTED, recorded: 'unrecorded', appended: true, snapshotOff: false, offUnavailable: false, applied: SUPPLEMENTED, style: 'to-human', ...over,
});
const MOD = { id: 'maws.to-human', name: BUILT_IN_MODS[0]!.name, description: BUILT_IN_MODS[0]!.description, version: 8 }; // P4-R7z: contract 8

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
  // the to-human plugin's style selected, declaring `declared` (6: its message tool), the plugin enabled beside it
  const style = (declared: number) => installToHumanPlugin(configHome, { declared });

  describe('without a session: what a new launch in no project would do', () => {
    it('the supplement under the plugin’s style, off when the app switch is off', async () => {
      style(6);
      expect(await modsList(deps)).toEqual([{ ...MOD, enabled: true, source: SUPPLEMENTED }]);
      appEnabled = false;
      expect(await modsList(deps)).toEqual([{ ...MOD, enabled: false, source: 'off' }]);
    });

    it('off under any other style, or none: no to-human plugin, no to-human lane', async () => {
      expect(await modsList(deps)).toEqual([{ ...MOD, enabled: true, source: 'off' }]);
      for (const declared of [1, 4, 5]) {
        style(declared);
        expect(await modsList(deps), String(declared)).toEqual([{ ...MOD, enabled: true, source: 'off' }]);
      }
    });
  });

  describe('with a session', () => {
    it('never launched by a decision: its override, and the lane pending at its next launch while it is on', async () => {
      style(6);
      expect(await modsList(deps, a)).toEqual([{ ...MOD, enabled: true, source: SUPPLEMENTED, perSession: 'inherit', pending: 'next-launch' }]);
      setSessionOverride(deps, { appSessionId: a, id: 'maws.to-human', value: 'off' });
      expect(await modsList(deps, a)).toEqual([{ ...MOD, enabled: true, source: 'off', perSession: 'off' }]);
    });

    it('its last applied state; a lane switched since reads pending at the next launch', async () => {
      index.ownerChannel.recordLaunch(a, launch({}));
      expect(await modsList(deps, a)).toEqual([{ ...MOD, enabled: true, source: SUPPLEMENTED, perSession: 'inherit' }]);
      setSessionOverride(deps, { appSessionId: a, id: 'maws.to-human', value: 'off' });
      expect(await modsList(deps, a)).toEqual([{ ...MOD, enabled: true, source: SUPPLEMENTED, perSession: 'off', pending: 'next-launch' }]);
      index.ownerChannel.recordLaunch(a, launch({ launchId: 'l2', laneOn: false, desired: 'off', recorded: 'supplement:3', appended: false, snapshotOff: true, applied: 'off' }));
      expect(await modsList(deps, a)).toEqual([{ ...MOD, enabled: true, source: 'off', perSession: 'off' }]);
    });

    it('a change the last launch could not honour (no flag) reads pending at the next compaction', async () => {
      setSessionOverride(deps, { appSessionId: a, id: 'maws.to-human', value: 'off' });
      index.ownerChannel.recordLaunch(a, launch({ laneOn: false, desired: 'off', recorded: 'supplement:3', appended: false, snapshotOff: false, offUnavailable: true, applied: SUPPLEMENTED }));
      expect(await modsList(deps, a)).toEqual([{ ...MOD, enabled: true, source: SUPPLEMENTED, perSession: 'off', pending: 'next-compaction' }]);
      setSessionOverride(deps, { appSessionId: a, id: 'maws.to-human', value: 'inherit' });
      expect(await modsList(deps, a)).toEqual([{ ...MOD, enabled: true, source: SUPPLEMENTED, perSession: 'inherit' }]);
    });

    it('with the lane on, a text MAWS appended before that the launch could not take out reads pending at the next compaction', async () => {
      // P4-R7z: MAWS's former contract over the plugin's style stays in force until the prompt renders again
      index.ownerChannel.recordLaunch(a, launch({ recorded: 'contract:7', offUnavailable: true, applied: 'maws-contract' }));
      expect(await modsList(deps, a)).toEqual([{ ...MOD, enabled: true, source: 'maws-contract', perSession: 'inherit', pending: 'next-compaction' }]);
      // a later launch with the flag honours it
      index.ownerChannel.recordLaunch(a, launch({ launchId: 'l2', recorded: 'contract:7', snapshotOff: true }));
      expect(await modsList(deps, a)).toEqual([{ ...MOD, enabled: true, source: SUPPLEMENTED, perSession: 'inherit' }]);
    });

    it('a style selected since the last launch, with the lane unchanged, reads nothing pending', async () => {
      index.ownerChannel.recordLaunch(a, launch({ recorded: 'supplement:2', snapshotOff: true }));
      style(4);
      expect(await modsList(deps, a)).toEqual([{ ...MOD, enabled: true, source: SUPPLEMENTED, perSession: 'inherit' }]);
    });

    // P4-R7z: the switch on, but the launch's style declared no plugin message tool: the lane has nothing to carry
    it('a launch with the lane on under a style without the plugin’s tool: off, nothing pending, and the lane not in effect', async () => {
      expect(laneInEffect(true, null)).toBe(true); // no decided launch yet: the switch alone
      index.ownerChannel.recordLaunch(a, launch({ desired: 'off', recorded: 'contract:7', appended: false, snapshotOff: true, applied: 'off', style: 'default' }));
      expect(await modsList(deps, a)).toEqual([{ ...MOD, enabled: true, source: 'off', perSession: 'inherit' }]);
      const row = index.ownerChannel.session(a);
      expect(styleCarriesNoLane(row)).toBe(true);
      expect(laneInEffect(true, row)).toBe(false);
      // switched off and on again since: still the launch's style, still nothing pending
      setSessionOverride(deps, { appSessionId: a, id: 'maws.to-human', value: 'off' });
      expect(await modsList(deps, a)).toEqual([{ ...MOD, enabled: true, source: 'off', perSession: 'off' }]);
      setSessionOverride(deps, { appSessionId: a, id: 'maws.to-human', value: 'inherit' });
      // a launch under the plugin's style carries the lane again
      index.ownerChannel.recordLaunch(a, launch({ launchId: 'l2', recorded: 'none', snapshotOff: true }));
      expect(styleCarriesNoLane(index.ownerChannel.session(a))).toBe(false);
      expect(laneInEffect(true, index.ownerChannel.session(a))).toBe(true);
      expect(laneInEffect(false, index.ownerChannel.session(a))).toBe(false);
      // and a launch with the lane off is no style's doing
      index.ownerChannel.recordLaunch(a, launch({ launchId: 'l3', laneOn: false, desired: 'off', applied: 'off' }));
      expect(styleCarriesNoLane(index.ownerChannel.session(a))).toBe(false);
    });

    it('the mismatch between the resolved and the observed style', async () => {
      index.ownerChannel.recordLaunch(a, launch({ style: 'to-human' }));
      index.ownerChannel.recordObserved(a, 'default', true);
      expect(await modsList(deps, a)).toEqual([{ ...MOD, enabled: true, source: SUPPLEMENTED, perSession: 'inherit', mismatch: { resolved: 'to-human', observed: 'default' } }]);
    });

    it('refuses an override for a session the index has no record of', () => {
      expect(() => setSessionOverride(deps, { appSessionId: 'nobody' as AppSessionId, id: 'maws.to-human', value: 'on' })).toThrow(/unknown app session/);
    });
  });
});
