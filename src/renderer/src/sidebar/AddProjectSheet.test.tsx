// Add project (docs/doperpowers/plans/2026-11-10-project-registry.md, Interfaces §J and §G; design §6), review 1's finding
// 3: the machine the person chose stays the sheet's machine; one that stops being offered after a folder was typed closes
// the sheet's Add with why, and nothing is added on another machine in its place.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PreloadBridge } from '@shared/ipc/schema';
import type { MachineState } from '@shared/ipc/schema/machines';
import { fakeClient, type FakeClient } from '../../../../test/support/fake-client';
import { OTHER_MACHINE, TEST_MACHINE } from '../../../../test/support/machine';
import { closeDialog, openDialog } from '../sessions/dialogs';
import { SessionDialogs } from '../sessions/SessionDialogs';
import { useMachines } from '../stores/machines';
import { REGISTRY } from './registry-copy';

const SINCE = '2026-11-10T09:00:00.000Z';
const HERE: MachineState = { ref: TEST_MACHINE, name: 'macbook', local: true, state: 'up', since: SINCE, generation: 0 };
const studio = (state: MachineState['state']): MachineState => ({ ref: OTHER_MACHINE, name: 'studio', local: false, state, since: SINCE, generation: 1, carrier: 'direct', capabilities: ['rl2.project-acts'] });

let fake: FakeClient;
beforeEach(() => {
  fake = fakeClient({});
  window.maws = fake.client as unknown as PreloadBridge;
  useMachines.getState().applyRoster([HERE, studio('up')]);
  render(<SessionDialogs />);
});
afterEach(() => {
  act(() => closeDialog());
  cleanup();
  useMachines.setState({ roster: 'unread', machines: new Map(), loaded: new Set() });
  delete (window as { maws?: PreloadBridge }).maws;
});

describe('Add project’s machine', () => {
  it('keeps the machine chosen when it goes down after a folder was typed: Add is closed with why, nothing falls back to this Mac', () => {
    act(() => openDialog({ kind: 'addProject', into: null }));
    const sheet = within(screen.getByRole('dialog', { name: REGISTRY.addTitle }));
    fireEvent.click(sheet.getByRole('radio', { name: 'studio' }));
    fireEvent.change(sheet.getByPlaceholderText(REGISTRY.folderPlaceholder), { target: { value: '/srv/scrape' } });
    const add = () => sheet.getByRole('button', { name: REGISTRY.add }) as HTMLButtonElement;
    expect(add().disabled).toBe(false);

    act(() => useMachines.getState().applyRoster([HERE, studio('down')]));
    expect(add().disabled).toBe(true);
    expect(sheet.getByRole('alert').textContent).toBe(REGISTRY.machineGone('studio'));
    expect((sheet.getByRole('radio', { name: REGISTRY.thisMac }) as HTMLInputElement).checked).toBe(false); // not chosen for the person
    expect((sheet.getByPlaceholderText(REGISTRY.folderPlaceholder) as HTMLInputElement).value).toBe('/srv/scrape');
    fireEvent.submit(add().closest('form')!);
    expect(fake.invoked('session.projects.addFolder')).toEqual([]);

    // back up, the same machine is the sheet's again
    act(() => useMachines.getState().applyRoster([HERE, studio('up')]));
    expect(add().disabled).toBe(false);
    expect(sheet.queryByRole('alert')).toBeNull();
  });
});
