import { describe, expect, it } from 'vitest';
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
import type { ProjectRecord } from '@shared/ipc/schema';
import { addressOf } from '@shared/machine/address';
import { machineKey, type OrgKey } from '@shared/machine/org-key';
import { project, record } from '../../../../test/support/builders';
import { at, OTHER_MACHINE, TEST_MACHINE } from '../../../../test/support/machine';
import { localProjectOfSet, orgIndex, primaryCheckout, reachableCheckouts, sessionSetKey } from './org-projects';

// P5 O6 M5 ("Assembly"): every machine's projects grouped by their org key.
const studio = <T extends string>(id: T): T => addressOf(OTHER_MACHINE, id);
const org = (key: string, name: string): ProjectRecord['org'] => ({ key: key as OrgKey, name, source: 'remote', smnsId: null });
const here = project(at('maws'), 0, { name: 'maws-local', org: org('repo:maws', 'MAWS') });
const there = project(studio('maws-b'), 0, { name: 'maws-b', org: org('repo:maws', 'MAWS (studio)') });
const tmp = project(studio('tmp'), 1, { discovered: true, org: org(`folder:${OTHER_MACHINE}:tmp`, 'tmp') });
const state = (projects: ProjectRecord[], records = [record(at('s'), { projectId: here.id })]) => ({
  projects: new Map(projects.map((p) => [p.id, p])),
  records: new Map(records.map((r) => [r.appId, r])),
});

describe('org projects', () => {
  it('names an org project after this machine’s checkout, lists checkouts only, local first', () => {
    const index = orgIndex([there, here, tmp], TEST_MACHINE);
    expect(index.orgs.get('repo:maws' as OrgKey)).toEqual({
      id: 'repo:maws', name: 'MAWS', kind: 'project', smnsId: null,
      checkouts: [{ machine: TEST_MACHINE, path: here.directory, projectId: here.id }, { machine: OTHER_MACHINE, path: there.directory, projectId: there.id }],
    });
    expect(index.orgs.get(`folder:${OTHER_MACHINE}:tmp` as OrgKey)?.checkouts).toEqual([]); // discovered: no checkout
    expect([...index.listed]).toEqual(['repo:maws']);
    expect(orgIndex([there], TEST_MACHINE).orgs.get('repo:maws' as OrgKey)?.name).toBe('MAWS (studio)'); // else the first machine's
  });

  it('acts on the local checkout when there is one, else another machine’s, reaching only machines that are up', () => {
    const index = orgIndex([there, here], TEST_MACHINE);
    expect(primaryCheckout(index, 'repo:maws' as OrgKey, TEST_MACHINE)?.id).toBe(here.id);
    expect(primaryCheckout(orgIndex([{ ...here, hidden: true }, there], TEST_MACHINE), 'repo:maws' as OrgKey, TEST_MACHINE)?.id).toBe(there.id);
    expect(reachableCheckouts(index, 'repo:maws' as OrgKey, (m) => m === TEST_MACHINE).map((p) => p.id)).toEqual([here.id]);
  });

  it('files a session’s tabs under its row: the org key while listed, else its machine’s row', () => {
    const s = state([here, there, tmp], [record(at('s'), { projectId: here.id }), record(studio('t'), { projectId: tmp.id }), record(studio('h'))]);
    const none = () => undefined;
    expect(sessionSetKey(s, TEST_MACHINE, at('s' as AppSessionId), none)).toBe('repo:maws');
    expect(sessionSetKey(s, TEST_MACHINE, studio('t' as AppSessionId), none)).toBe(machineKey(OTHER_MACHINE)); // a folder nobody opened
    expect(sessionSetKey(s, TEST_MACHINE, studio('h' as AppSessionId), none)).toBe(machineKey(OTHER_MACHINE));
    expect(sessionSetKey(s, TEST_MACHINE, at('new' as AppSessionId), () => here.id)).toBe('repo:maws'); // an unstarted one, by its intent
    expect(sessionSetKey(s, TEST_MACHINE, at('new' as AppSessionId), () => null)).toBeNull();
    expect(sessionSetKey(s, TEST_MACHINE, at('new' as AppSessionId), none)).toBeUndefined();
  });

  it('a set stands for this machine’s checkout of its org project, none for another machine’s only or a machine’s row', () => {
    expect(localProjectOfSet(state([here, there]), 'repo:maws', TEST_MACHINE)?.id).toBe(here.id);
    expect(localProjectOfSet(state([there]), 'repo:maws', TEST_MACHINE)).toBeUndefined();
    expect(localProjectOfSet(state([here]), machineKey(TEST_MACHINE), TEST_MACHINE)).toBeUndefined();
    const fresh = project(at('fresh'), 2); // not derived yet: its set is keyed by its address
    expect(localProjectOfSet(state([fresh]), fresh.id, TEST_MACHINE)?.id).toBe(fresh.id);
    expect(localProjectOfSet(state([fresh]), 'none', TEST_MACHINE)).toBeUndefined();
    expect(localProjectOfSet(state([there]), there.id as ProjectId, TEST_MACHINE)).toBeUndefined();
  });
});
