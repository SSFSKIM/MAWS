import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { MachineState } from '@shared/ipc/schema/machines';
import { addressOf } from '@shared/machine/address';
import type { OrgKey } from '@shared/machine/org-key';
import type { MachineRef } from '@shared/machine/ref';
import { OTHER_MACHINE, TEST_MACHINE } from '../../../../test/support/machine';
import { registerSessionCreator } from '../keymap/actions-runtime';
import { resetRemoteSpawn, spawnTargetOf } from '../sessions/remote-spawn';
import { useLayout } from '../stores/layout';
import { useSessions } from '../stores/sessions';
import type { OrgProjectLocation, RegistryProject } from '../stores/registry';
import { newChatElsewhere, registrySpawnTarget } from './registry-new-chat';

// New chat in a project with no folder on this Mac (docs/doperpowers/plans/2026-11-10-project-registry.md, M11: "+ Session"
// offers the project's locations from the record; review 1, finding 1): a New chat tab with no project here, its machine
// chosen as the project's first location that is there, on a machine up over RL2 where the member may start sessions.
const LOW = 'AaaLowestRefMachine000' as MachineRef; // the lowest ref: the row's primary, its machine off
const SINCE = '2026-11-10T09:00:00.000Z';
const machine = (ref: MachineRef, name: string, over: Partial<MachineState> = {}): MachineState => ({ ref, name, local: false, state: 'up', since: SINCE, generation: 1, carrier: 'direct', ...over });
const location = (ref: MachineRef, pid: string, over: Partial<OrgProjectLocation> = {}): OrgProjectLocation => ({ machine: ref, pid, path: `/srv/${pid}`, key: `folder:${ref}:${pid}` as OrgKey, name: pid, source: 'folder', acts: true, ...over });
const scrape = (locations: OrgProjectLocation[]): RegistryProject => ({ id: '5d8e1c72-4b3a-4f6e-8d9c-0a1b2c3d4e5f', name: 'scrape', hub: true, renamable: true, locations });

afterEach(() => {
  resetRemoteSpawn();
  useSessions.setState({ unstarted: new Map() });
});

describe('a New chat in a project with no folder here', () => {
  it('starts on the first location whose machine is up over RL2, the lowest-ref one being off', () => {
    const machines = new Map([
      [LOW, machine(LOW, 'farm', { state: 'down' })],
      [OTHER_MACHINE, machine(OTHER_MACHINE, 'studio')],
    ]);
    expect(registrySpawnTarget(scrape([location(LOW, 'p-farm'), location(OTHER_MACHINE, 'p-studio')]), machines)).toEqual({ machine: OTHER_MACHINE, name: 'studio', checkout: '/srv/p-studio', key: null, label: 'scrape', registry: '5d8e1c72-4b3a-4f6e-8d9c-0a1b2c3d4e5f' });
  });

  it('passes over a folder that is not there, a machine where the member may not start sessions, and one not reached over RL2; none is null', () => {
    const machines = new Map([
      [LOW, machine(LOW, 'farm', { rights: ['shell'] })],
      [OTHER_MACHINE, machine(OTHER_MACHINE, 'studio')],
      [TEST_MACHINE, machine(TEST_MACHINE, 'profile-b', { carrier: 'socket' })],
    ]);
    expect(registrySpawnTarget(scrape([location(LOW, 'p-farm'), location(OTHER_MACHINE, 'p-studio', { state: 'missing' }), location(TEST_MACHINE, 'p-b')]), machines)).toBeNull();
    expect(registrySpawnTarget(scrape([]), machines)).toBeNull();
  });

  it('opens a New chat tab with no project here, its machine and place already chosen', async () => {
    const tab = addressOf(TEST_MACHINE, 'new-1' as AppSessionId);
    const asked: unknown[] = [];
    const off = registerSessionCreator(async (projectId) => (asked.push(projectId), tab));
    // panel sweep#3: the tab opens already the registry project's, so the layout files it in that project's set
    const opened: unknown[] = [];
    const openTab = vi.spyOn(useLayout.getState(), 'openTab').mockImplementation(() => void opened.push(useSessions.getState().unstarted.get(tab)?.registry));
    try {
      const target = { machine: OTHER_MACHINE, name: 'studio', checkout: '/srv/p-studio', key: null, label: 'scrape', registry: 'project-1' };
      expect(await newChatElsewhere(target)).toBe(tab);
      expect(asked).toEqual([null]);
      expect(spawnTargetOf(tab, null)).toEqual(target);
      expect(useSessions.getState().unstarted.get(tab)).toMatchObject({ projectId: null, registry: 'project-1' }); // the tab's project, for its machine menu
      expect(opened, 'the registry project is the tab’s when it opens').toEqual(['project-1']);
    } finally {
      off();
      openTab.mockRestore();
    }
  });
});
