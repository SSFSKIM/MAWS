// "+ Session"'s machine menu (P5 O7 M4, "The machine menu", A5): beside the project chip of a New chat tab, this Mac by
// default, offering each up RL2 machine whose projects hold a checkout of the same org project; another machine chosen,
// one line under the row names where the session runs and on whose inference route. No RL2 machine up, no menu.
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

  it('says when no other machine can start the project', async () => {
    // P5 O7 M9: a machine without its checkout is offered to set it up (below); one whose projects can't be read is not
    vi.spyOn(ipc, 'invoke').mockResolvedValue({ ok: false, error: { code: 'host_unavailable', message: 'unreachable' } } as never);
    view();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Machine This Mac' }));
    await waitFor(() => expect(screen.getByText(MACHINE_WORDS.none)).toBeTruthy());
  });

  // P5 O7 M9 ("Remote setup"): a machine without a checkout of the project is offered to set it up there, to its owners;
  // anyone else sees why not, never a dead control
  it('offers a machine with no checkout to set the project up there, and names why a machine it can’t set up isn’t offered', async () => {
    useMachines.getState().applyRoster([{ ...up(TEST_MACHINE, 'This Mac'), local: true, carrier: undefined }, up(OTHER_MACHINE, 'mini'), up(THIRD, 'vm')]);
    const page = { entries: [{ name: 'Developer', path: '/Users/mini/Developer', protected: false }], cursor: null };
    vi.spyOn(ipc, 'invoke').mockImplementation((async (name: string, _input: unknown, opts?: { machine?: string }) => {
      if (name === 'session.projects.list') return { ok: true, value: { projects: [theirs({ org: undefined })], revision: 1 } }; // no checkout of this project
      if (name === 'machine.folders.list' && opts?.machine === OTHER_MACHINE) return { ok: true, value: page };
      if (name === 'machine.folders.list') return { ok: false, error: { code: 'internal', message: 'refused owners-only', issues: { refusal: 'owners-only' } } };
      return { ok: false, error: { code: 'internal', message: `unexpected ${name}` } };
    }) as never);
    view();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Machine This Mac' }));
    const menu = screen.getByRole('dialog', { name: 'Choose a machine' });
    await waitFor(() => expect(within(menu).getByRole('menuitem', { name: /^mini/ })).toBeTruthy());
    expect(within(menu).getByRole('menuitem', { name: /^mini/ }).textContent).toBe(`mini${SETUP_WORDS.setUp}`);
    const closed = within(menu).getByRole('menuitem', { name: /^vm/ }) as HTMLButtonElement;
    expect(closed.disabled).toBe(true);
    expect(closed.textContent).toBe(`vm${SETUP_WORDS.notOwner('vm')}`); // the reason shown, not only a tooltip
    await user.click(within(menu).getByRole('menuitem', { name: /^mini/ }));
    expect(useDialogs.getState().open).toEqual({
      kind: 'remoteSetup',
      request: { kind: 'folder', tab: TAB, machine: OTHER_MACHINE, name: 'mini', key: KEY, home: '/Users/mini', first: page, suggestions: [] },
    });
    expect(spawnTargetOf(TAB, KEY)).toBeNull(); // chosen only once it is set up
    useDialogs.setState({ open: null });
  });

  it('keeps the trust a setup accepted when the same machine and checkout is chosen again', async () => {
    vi.spyOn(ipc, 'invoke').mockResolvedValue({ ok: true, value: { projects: [theirs()], revision: 1 } } as never);
    useRemoteSpawn.getState().choose(TAB, { machine: OTHER_MACHINE, name: 'mini', checkout: '/srv/app', key: KEY, trust: 'accepted' });
    view();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Machine mini' }));
    const menu = screen.getByRole('dialog', { name: 'Choose a machine' });
    await user.click(await within(menu).findByRole('menuitemradio', { name: 'mini' }));
    expect(spawnTargetOf(TAB, KEY)).toEqual({ machine: OTHER_MACHINE, name: 'mini', checkout: '/srv/app', key: KEY, trust: 'accepted' });
  });

  it('is closed until a project is chosen, and absent with no RL2 machine up', () => {
    const { unmount } = view(null);
    const chip = screen.getByRole<HTMLButtonElement>('button', { name: 'Machine This Mac' });
    expect(chip.disabled).toBe(true);
    expect(chip.title).toBe(MACHINE_WORDS.noProject);
    unmount();
    useMachines.getState().applyRoster([{ ...up(TEST_MACHINE, 'This Mac'), local: true, carrier: undefined }, up(OTHER_MACHINE, 'profile-b', { carrier: 'socket' })]);
    view();
    expect(screen.queryByRole('button', { name: /^Machine / })).toBeNull();
  });
});
