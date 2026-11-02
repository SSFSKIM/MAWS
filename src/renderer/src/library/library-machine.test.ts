// The library per machine (P5 O7 M5a, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, M5, "Which machine an
// artifact is on"; it replaces O6 M4's refusal of another machine's list). A list is read on the machine it is asked of:
// the one a filter's session or project names, else the one the library's machine menu chose, else this Mac; its rows put
// their artifacts on that machine. A machine's `library.changed` and its feed's `artifacts.resync` read again only that
// machine's reads: its lists and Spaces and the rows of its artifacts.
import { afterEach, describe, expect, it } from 'vitest';
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
import type { MachineRef } from '@shared/machine/ref';
import { addressOf } from '@shared/machine/address';
import { fakeClient } from '../../../../test/support/fake-client';
import { at, OTHER_MACHINE, TEST_MACHINE } from '../../../../test/support/machine';
import { artifactMachineOf, resetArtifactMachines } from '../artifacts/machines';
import { createClient } from '../ipc/client';
import { preloadOf } from '../test-support/preload-of';
import { artifactId, countsOf, libraryRow } from '../test-support/remote-artifacts';
import { connectLibrary, library, libraryList, librarySpaces, resetLibrary, watchLibraryList, watchLibraryRow, watchLibrarySpaces } from './store';

const offs: (() => void)[] = [];
afterEach(() => {
  offs.splice(0).forEach((off) => off());
  resetLibrary();
  resetArtifactMachines();
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const ON_OTHER = libraryRow(1, { title: 'On the studio' });
const HERE = libraryRow(2, { title: 'Here' });

// Main answers each machine's library from its own rows.
function setUp() {
  const fake = fakeClient({
    'library.list': (_input: unknown, machine: MachineRef | undefined) => {
      const rows = machine === OTHER_MACHINE ? [ON_OTHER] : [HERE];
      return { rows, counts: countsOf(rows) };
    },
    'library.get': (input: { artifactId: string }) => ({ row: [ON_OTHER, HERE].find((row) => row.id === input.artifactId) ?? null }),
    'library.spaces': (_input: unknown, machine: MachineRef | undefined) => ({ spaces: [{ id: artifactId(machine === OTHER_MACHINE ? 90 : 91), name: `Space on ${machine}`, createdAt: 1, count: 0 }] }),
  } as never);
  const client = createClient(() => preloadOf(fake));
  offs.push(connectLibrary(client));
  return { fake, client };
}

describe('the library on another machine', () => {
  it.each([
    ['session', { appSessionId: addressOf(OTHER_MACHINE, 'session-b' as AppSessionId), lineage: true }],
    ['project', { projectId: addressOf(OTHER_MACHINE, 'project-b' as ProjectId) }],
  ])('reads a list of another machine’s %s on that machine, its rows placed there', async (_, filter) => {
    const { fake, client } = setUp();
    offs.push(watchLibraryList(filter, client));
    await settle();
    expect(fake.machines('library.list')).toEqual([OTHER_MACHINE]);
    expect(libraryList(library.getState(), filter).value?.rows.map((row) => row.title)).toEqual(['On the studio']);
    expect(artifactMachineOf(ON_OTHER.id)).toBe(OTHER_MACHINE);
  });

  it('reads the whole library and its Spaces of the machine asked, apart from this Mac’s', async () => {
    const { fake, client } = setUp();
    offs.push(watchLibraryList({}, client, OTHER_MACHINE), watchLibraryList({}, client), watchLibrarySpaces(client, OTHER_MACHINE), watchLibrarySpaces(client));
    await settle();
    expect(fake.machines('library.list')).toEqual([OTHER_MACHINE, TEST_MACHINE]);
    expect(fake.machines('library.spaces')).toEqual([OTHER_MACHINE, TEST_MACHINE]);
    const state = library.getState();
    expect(libraryList(state, {}, OTHER_MACHINE).value?.rows.map((row) => row.title)).toEqual(['On the studio']);
    expect(libraryList(state, {}).value?.rows.map((row) => row.title)).toEqual(['Here']);
    expect(librarySpaces(state, OTHER_MACHINE).value?.map((space) => space.name)).toEqual([`Space on ${OTHER_MACHINE}`]);
    expect(librarySpaces(state).value?.map((space) => space.name)).toEqual([`Space on ${TEST_MACHINE}`]);
  });

  it('still reads this machine’s project here', async () => {
    const { fake, client } = setUp();
    offs.push(watchLibraryList({ projectId: at('project-a' as ProjectId) }, client));
    await settle();
    expect(fake.machines('library.list')).toEqual([TEST_MACHINE]);
  });
});

describe('a machine’s changes and resyncs', () => {
  async function watching() {
    const setup = setUp();
    const { client } = setup;
    offs.push(watchLibraryList({}, client, OTHER_MACHINE), watchLibraryList({}, client), watchLibrarySpaces(client, OTHER_MACHINE), watchLibrarySpaces(client));
    await settle(); // the lists answered: artifact 1 is the other machine's
    offs.push(watchLibraryRow(ON_OTHER.id, client), watchLibraryRow(HERE.id, client));
    await settle();
    return setup;
  }
  const reads = (fake: ReturnType<typeof fakeClient>) => ({ lists: fake.machines('library.list'), spaces: fake.machines('library.spaces'), rows: fake.machines('library.get') });

  it.each(['library.changed', 'artifacts.resync'] as const)('%s from a machine reads again only that machine’s lists, Spaces and rows', async (event) => {
    const { fake } = await watching();
    const before = reads(fake);
    fake.event(event, event === 'library.changed' ? { revision: 2 } : {}, OTHER_MACHINE);
    await settle();
    const after = reads(fake);
    expect(after.lists.slice(before.lists.length)).toEqual([OTHER_MACHINE]);
    expect(after.spaces.slice(before.spaces.length)).toEqual([OTHER_MACHINE]);
    expect(after.rows.slice(before.rows.length)).toEqual([OTHER_MACHINE]);
  });

  it('this Mac’s change reads again only this Mac’s', async () => {
    const { fake } = await watching();
    const before = reads(fake);
    fake.event('library.changed', { revision: 3 });
    await settle();
    const after = reads(fake);
    expect(after.lists.slice(before.lists.length)).toEqual([TEST_MACHINE]);
    expect(after.spaces.slice(before.spaces.length)).toEqual([TEST_MACHINE]);
    expect(after.rows.slice(before.rows.length)).toEqual([TEST_MACHINE]);
  });
});
