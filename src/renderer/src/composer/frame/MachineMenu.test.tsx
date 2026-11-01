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
import { resetRemoteSpawn, spawnTargetOf } from '../../sessions/remote-spawn';
import { useMachines } from '../../stores/machines';
import { MACHINE_WORDS, MachineLine, MachineMenu } from './MachineMenu';

const TAB = addressOf(TEST_MACHINE, 'new-1' as AppSessionId);
const KEY = 'repo:github.com/acme/app' as OrgKey;
const up = (ref: typeof OTHER_MACHINE, name: string, over: Partial<MachineState> = {}): MachineState => ({ ref, name, local: false, state: 'up', since: '2026-10-31T10:00:00Z', generation: 1, carrier: 'relay', ...over });
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

  it('says when no other machine has the project', async () => {
    vi.spyOn(ipc, 'invoke').mockResolvedValue({ ok: true, value: { projects: [theirs({ org: undefined })], revision: 1 } } as never);
    view();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Machine This Mac' }));
    await waitFor(() => expect(screen.getByText(MACHINE_WORDS.none)).toBeTruthy());
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
