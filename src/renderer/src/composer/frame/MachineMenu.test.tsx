// "+ Session"'s machine menu (P5 O7 M4, "The machine menu", A5): beside the project chip of a New chat tab, this Mac by
// default, offering each up RL2 machine (2026-11-06: with or without a project, the local project's checkout there taken
// when it holds one); another machine chosen, one line under the row names where the session runs and on whose inference
// route. No RL2 machine up, no menu.
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
import type { ProjectRecord } from '@shared/ipc/schema';
import type { MachineState } from '@shared/ipc/schema/machines';
import { addressOf } from '@shared/machine/address';
import type { OrgKey } from '@shared/machine/org-key';
import { project } from '../../../../../test/support/builders';
import { OTHER_MACHINE, TEST_MACHINE } from '../../../../../test/support/machine';
import { ipc } from '../../ipc/client';
import { useDialogs } from '../../sessions/dialogs';
import { resetRemoteSpawn, spawnTargetOf, useRemoteSpawn } from '../../sessions/remote-spawn';
import { SETUP_WORDS } from '../../sessions/remote-setup';
import type { MachineRef } from '@shared/machine/ref';
import { useMachines } from '../../stores/machines';
import { MACHINE_WORDS, MachineLine, MachineMenu } from './MachineMenu';

const TAB = addressOf(TEST_MACHINE, 'new-1' as AppSessionId);
const THIRD = 'ThirdMachineRef0000000' as MachineRef;
const KEY = 'repo:github.com/acme/app' as OrgKey;
const up = (ref: MachineRef, name: string, over: Partial<MachineState> = {}): MachineState => ({ ref, name, local: false, state: 'up', since: '2026-10-31T10:00:00Z', generation: 1, carrier: 'relay', ...over });
const theirs = (over: Partial<ProjectRecord> = {}): ProjectRecord => ({ ...project('app', 0), id: addressOf(OTHER_MACHINE, 'app' as ProjectId), directory: '/srv/app', org: { key: KEY, name: 'app', source: 'remote', smnsId: null }, ...over });
const view = (key: string | null = KEY) =>
  render(
    <>
      <MachineMenu appSessionId={TAB} projectKey={key} disabled={null} />
      <MachineLine appSessionId={TAB} projectKey={key} />
    </>,
  );

beforeEach(() => {
  resetRemoteSpawn();
  useMachines.getState().applyRoster([{ ...up(TEST_MACHINE, 'This Mac'), local: true, carrier: undefined }, up(OTHER_MACHINE, 'mini')]);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useMachines.setState({ roster: 'unread', machines: new Map(), loaded: new Set() });
});

describe('the machine menu', () => {
  it('reads This Mac, offers the machines with this project’s checkout, and once one is chosen says where it runs', async () => {
    const invoke = vi.spyOn(ipc, 'invoke').mockResolvedValue({ ok: true, value: { projects: [theirs()], revision: 1 } } as never);
    view();
    const user = userEvent.setup();
    const chip = screen.getByRole('button', { name: 'Machine This Mac' });
    expect(screen.queryByText(/^Lane B on /)).toBeNull();
    await user.click(chip);
    const menu = screen.getByRole('dialog', { name: 'Choose a machine' });
    await waitFor(() => expect(within(menu).getAllByRole('menuitemradio').map((item) => [item.firstChild?.textContent, item.getAttribute('aria-checked')])).toEqual([['This Mac', 'true'], ['mini', 'false']]));
    expect(invoke).toHaveBeenCalledWith('session.projects.list', undefined, { machine: OTHER_MACHINE });
    await user.click(within(menu).getByRole('menuitemradio', { name: 'mini' }));
    expect(spawnTargetOf(TAB, KEY)).toEqual({ machine: OTHER_MACHINE, name: 'mini', checkout: '/srv/app', key: KEY });
    expect(screen.getByRole('button', { name: 'Machine mini' })).toBeTruthy();
    expect(screen.getByText('Lane B on mini · mini’s inference route')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Machine mini' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Choose a machine' })).getByRole('menuitemradio', { name: 'This Mac' }));
    expect(spawnTargetOf(TAB, KEY)).toBeNull();
    expect(screen.queryByText(/^Lane B on /)).toBeNull();
  });

  // 2026-11-06 (the owner's ruling: the machine first): the chip opens with no project, and every up RL2 machine is a
  // choice of its own; chosen, its place there is the project chip's to choose
  it('opens with no project chosen and offers every up RL2 machine, reading nothing of them, its place there not chosen yet', async () => {
    const invoke = vi.spyOn(ipc, 'invoke');
    useMachines.getState().applyRoster([{ ...up(TEST_MACHINE, 'This Mac'), local: true, carrier: undefined }, up(OTHER_MACHINE, 'mini'), up(THIRD, 'vm')]);
    view(null);
    const user = userEvent.setup();
    const chip = screen.getByRole<HTMLButtonElement>('button', { name: 'Machine This Mac' });
    expect(chip.disabled).toBe(false);
    await user.click(chip);
    const menu = screen.getByRole('dialog', { name: 'Choose a machine' });
    await waitFor(() => expect(within(menu).getAllByRole('menuitemradio').map((item) => item.firstChild?.textContent)).toEqual(['This Mac', 'mini', 'vm']));
    expect(within(menu).queryByText(MACHINE_WORDS.looking)).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
    await user.click(within(menu).getByRole('menuitemradio', { name: 'vm' }));
    expect(spawnTargetOf(TAB, null)).toEqual({ machine: THIRD, name: 'vm', checkout: null, key: null });
    expect(spawnTargetOf(TAB, KEY), 'a place chosen on the machine stands whatever the local project').toEqual({ machine: THIRD, name: 'vm', checkout: null, key: null });
    expect(screen.getByText('Lane B on vm · vm’s inference route')).toBeTruthy();
  });

  it('falls back to no place on a machine with no checkout of the local project, and greys one where the member can’t start sessions, with why', async () => {
    useMachines.getState().applyRoster([{ ...up(TEST_MACHINE, 'This Mac'), local: true, carrier: undefined }, up(OTHER_MACHINE, 'mini'), up(THIRD, 'vm', { rights: ['shell'] })]);
    vi.spyOn(ipc, 'invoke').mockResolvedValue({ ok: true, value: { projects: [theirs({ org: undefined })], revision: 1 } } as never); // no checkout of this project
    view();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Machine This Mac' }));
    const menu = screen.getByRole('dialog', { name: 'Choose a machine' });
    await waitFor(() => expect(within(menu).getByRole('menuitem', { name: /^vm/ })).toBeTruthy());
    const closed = within(menu).getByRole('menuitem', { name: /^vm/ }) as HTMLButtonElement;
    expect(closed.disabled).toBe(true);
    expect(closed.textContent).toBe(`vm${SETUP_WORDS.noSpawn('vm')}`); // the reason shown, not only a tooltip
    await user.click(within(menu).getByRole('menuitemradio', { name: 'mini' }));
    expect(spawnTargetOf(TAB, KEY)).toEqual({ machine: OTHER_MACHINE, name: 'mini', checkout: null, key: null });
    expect(useDialogs.getState().open).toBeNull(); // no sheet: the project chip offers mini's places
  });

  it('keeps the place and the trust a setup accepted when the same machine is chosen again', async () => {
    vi.spyOn(ipc, 'invoke').mockResolvedValue({ ok: true, value: { projects: [theirs()], revision: 1 } } as never);
    useRemoteSpawn.getState().choose(TAB, { machine: OTHER_MACHINE, name: 'mini', checkout: '/Users/mini/notes', key: null, label: 'notes', trust: 'accepted' });
    view();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Machine mini' }));
    const menu = screen.getByRole('dialog', { name: 'Choose a machine' });
    await user.click(await within(menu).findByRole('menuitemradio', { name: 'mini' }));
    expect(spawnTargetOf(TAB, KEY)).toEqual({ machine: OTHER_MACHINE, name: 'mini', checkout: '/Users/mini/notes', key: null, label: 'notes', trust: 'accepted' });
  });

  it('is closed while the row is, and absent with no RL2 machine up', () => {
    const { unmount } = render(<MachineMenu appSessionId={TAB} projectKey={null} disabled="Starting…" />);
    const chip = screen.getByRole<HTMLButtonElement>('button', { name: 'Machine This Mac' });
    expect(chip.disabled).toBe(true);
    expect(chip.title).toBe('Starting…');
    unmount();
    useMachines.getState().applyRoster([{ ...up(TEST_MACHINE, 'This Mac'), local: true, carrier: undefined }, up(OTHER_MACHINE, 'profile-b', { carrier: 'socket' })]);
    view();
    expect(screen.queryByRole('button', { name: /^Machine / })).toBeNull();
  });
});
