// P5 O6 M4 (the task review): the library is this machine's while artifacts carry no machine (O7), so a list asked about
// another machine's session or project is not read there, whose rows would then open as this machine's artifacts.
import { afterEach, expect, it } from 'vitest';
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
import { addressOf } from '@shared/machine/address';
import { fakeClient } from '../../../../test/support/fake-client';
import { at, OTHER_MACHINE } from '../../../../test/support/machine';
import { createClient } from '../ipc/client';
import { preloadOf } from '../test-support/preload-of';
import { LIBRARY_COPY } from './copy';
import { library, libraryList, resetLibrary, watchLibraryList } from './store';

afterEach(() => resetLibrary());

it.each([
  ['project', { projectId: addressOf(OTHER_MACHINE, 'project-b' as ProjectId) }],
  ['session', { appSessionId: addressOf(OTHER_MACHINE, 'session-b' as AppSessionId), lineage: true }],
])('lists nothing for another machine’s %s, and says why', async (_, filter) => {
  const fake = fakeClient();
  const release = watchLibraryList(filter, createClient(() => preloadOf(fake)));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(fake.invoked('library.list')).toEqual([]);
  expect(libraryList(library.getState(), filter)).toMatchObject({ status: 'error', error: LIBRARY_COPY.otherMachine });
  release();
});

it('still lists this machine’s project', () => {
  const fake = fakeClient();
  const release = watchLibraryList({ projectId: at('project-a' as ProjectId) }, createClient(() => preloadOf(fake)));
  expect(fake.invoked('library.list')).toHaveLength(1);
  release();
});
