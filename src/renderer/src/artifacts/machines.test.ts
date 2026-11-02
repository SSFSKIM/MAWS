// P5 O7 M5a (docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, M5, "Which machine an artifact is on"): the
// renderer's one answer to which machine an artifact is on. The rows and records a machine answers put their artifacts
// on it; an artifact-keyed command whose input names no machine goes to the artifact's; a local answer takes an id back
// to this Mac (the later answer wins); a caller's explicit machine, and a machine the input's addresses name, still win.
import { afterEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { CommandName } from '@shared/ipc/schema';
import { addressOf } from '@shared/machine/address';
import type { MachineRef } from '@shared/machine/ref';
import { fakeClient } from '../../../../test/support/fake-client';
import { OTHER_MACHINE, TEST_MACHINE } from '../../../../test/support/machine';
import { createClient } from '../ipc/client';
import { preloadOf } from '../test-support/preload-of';
import { artifactId, artifactRow, countsOf, libraryRow } from '../test-support/remote-artifacts';
import { artifactMachineOf, recordArtifactMachine, resetArtifactMachines } from './machines';

const id = artifactId;
const counts = countsOf([]);
const artifact = (n: number) => artifactRow(n);

// Main answers by the machine a command went to: OTHER_MACHINE's library holds artifact 1, this Mac's artifact 2.
function client() {
  const fake = fakeClient({
    'library.list': (_input: unknown, machine: MachineRef | undefined) => ({ rows: machine === OTHER_MACHINE ? [libraryRow(1)] : [libraryRow(2)], counts }),
    'artifacts.list': (_input: unknown, machine: MachineRef | undefined) => ({ artifacts: machine === OTHER_MACHINE ? [artifact(3)] : [] }),
    'artifacts.get': (input: { artifactId: string }) => ({ artifact: artifact(Number(input.artifactId.slice(-1))) }),
    'library.get': (input: { artifactId: string }) => ({ row: libraryRow(Number(input.artifactId.slice(-1))) }),
    'artifacts.duplicate': () => ({ artifact: artifact(4) }),
    'artifacts.versions': { versions: [] },
    'artifacts.copyAsset': { assetId: '00000000-0000-4000-8000-0000000000aa', ref: 'assets/a.png' },
    'library.saveAs': { saved: false },
    'remote.openCopy': { opened: true, message: null },
  } as never);
  return { fake, ipc: createClient(() => preloadOf(fake)) };
}
const sentTo = (fake: ReturnType<typeof fakeClient>, name: CommandName) => fake.machines(name).at(-1);

afterEach(() => resetArtifactMachines());

describe('the renderer’s artifact table', () => {
  it('puts the artifacts a machine lists on that machine, and sends every artifact-keyed command for them there', async () => {
    const { fake, ipc } = client();
    await ipc.invoke('library.list', { filter: {} }, { machine: OTHER_MACHINE });
    expect(artifactMachineOf(id(1))).toBe(OTHER_MACHINE);
    await ipc.invoke('artifacts.versions', { artifactId: id(1) });
    expect(sentTo(fake, 'artifacts.versions')).toBe(OTHER_MACHINE);
    // main answers Save As here for any machine, told which one (its allow-list)
    await ipc.invoke('library.saveAs', { artifactId: id(1), source: { content: {} } });
    expect(sentTo(fake, 'library.saveAs')).toBe(OTHER_MACHINE);
  });

  it('never holds this Mac’s ids: its artifacts go to this Mac', async () => {
    const { fake, ipc } = client();
    await ipc.invoke('library.list', { filter: {} });
    expect(artifactMachineOf(id(2))).toBeNull();
    await ipc.invoke('artifacts.versions', { artifactId: id(2) });
    expect(sentTo(fake, 'artifacts.versions')).toBe(TEST_MACHINE);
  });

  it('keeps the later answer for an id two machines answered', async () => {
    const { fake, ipc } = client();
    recordArtifactMachine(id(2), OTHER_MACHINE, TEST_MACHINE);
    await ipc.invoke('library.list', { filter: {} }); // this Mac lists artifact 2 after
    expect(artifactMachineOf(id(2))).toBeNull();
    await ipc.invoke('artifacts.versions', { artifactId: id(2) });
    expect(sentTo(fake, 'artifacts.versions')).toBe(TEST_MACHINE);
  });

  it('fills from a session’s listing routed by its address, a read record and what a write made', async () => {
    const { ipc } = client();
    await ipc.invoke('artifacts.list', { filter: { appSessionId: addressOf(OTHER_MACHINE, 'app-r') as AppSessionId } });
    expect(artifactMachineOf(id(3))).toBe(OTHER_MACHINE);
    await ipc.invoke('artifacts.get', { artifactId: id(5) }, { machine: OTHER_MACHINE });
    await ipc.invoke('library.get', { artifactId: id(6) }, { machine: OTHER_MACHINE });
    await ipc.invoke('artifacts.duplicate', { artifactId: id(3) });
    expect([5, 6, 4].map((n) => artifactMachineOf(id(n)))).toEqual([OTHER_MACHINE, OTHER_MACHINE, OTHER_MACHINE]);
  });

  it('lets an explicit machine win over the table', async () => {
    const { fake, ipc } = client();
    recordArtifactMachine(id(1), OTHER_MACHINE, TEST_MACHINE);
    await ipc.invoke('artifacts.versions', { artifactId: id(1) }, { machine: TEST_MACHINE });
    expect(sentTo(fake, 'artifacts.versions')).toBe(TEST_MACHINE);
  });

  it('sends an asset copy to the machine of the artifact it writes', async () => {
    const { fake, ipc } = client();
    recordArtifactMachine(id(1), OTHER_MACHINE, TEST_MACHINE);
    await ipc.invoke('artifacts.copyAsset', { from: id(1), ref: 'assets/a.png', to: id(1) });
    expect(sentTo(fake, 'artifacts.copyAsset')).toBe(OTHER_MACHINE);
  });

  it('leaves remote.openCopy on this app: its source names the artifact, the command names the machine', async () => {
    const { fake, ipc } = client();
    recordArtifactMachine(id(1), OTHER_MACHINE, TEST_MACHINE);
    await ipc.invoke('remote.openCopy', { machine: OTHER_MACHINE, source: { artifactId: id(1) } });
    expect(sentTo(fake, 'remote.openCopy')).toBe(TEST_MACHINE);
  });
});
