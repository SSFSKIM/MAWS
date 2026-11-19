// "Open in" in the window (UX wave U6b-4a, docs/doperpowers/plans/2026-11-18-ux-wave-U6b-4a-open-in.md, decision 4): the
// rows main found, in groups; a choice asks main with the session and, from a file's bar, the path and the line; an open
// that did not happen is a notice with main's sentence; a session on another machine has the item disabled, saying where
// its folder is. Invented paths.
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DropdownMenu } from 'radix-ui';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { OpenInApp } from '@shared/ipc/schema/layout';
import { addressOf, bareOf } from '@shared/machine/address';
import { at, OTHER_MACHINE } from '../../../../test/support/machine';
import { useMachines } from '../stores/machines';
import { useNotices } from '../stores/notices';
import { fail, installFakeMain, ok } from '../test-support/code';
import { openInGroups, useOpenInApps } from './apps';
import { OPEN_IN_COPY } from './copy';
import { OpenInButton, OpenInSubmenu } from './OpenInMenu';

const S = at('session-1') as AppSessionId;
const R = addressOf(OTHER_MACHINE, 'session-2') as AppSessionId;
const APPS: OpenInApp[] = [
  { id: 'vscode', name: 'VS Code' },
  { id: 'zed', name: 'Zed' },
  { id: 'terminal', name: 'Terminal' },
  { id: 'ghostty', name: 'Ghostty' },
  { id: 'finder', name: 'Finder' },
];

let answer: () => ReturnType<typeof ok>;
let main: ReturnType<typeof installFakeMain>;
const notices = () => useNotices.getState().notices.map(({ level, text }) => ({ level, text }));

beforeEach(() => {
  useOpenInApps.setState({ apps: null });
  useNotices.setState({ notices: [] });
  answer = () => ok({ opened: true });
  main = installFakeMain(async (name) => {
    if (name === 'layout.openInApps') return ok({ apps: APPS });
    if (name === 'layout.openIn') return answer();
    return fail(`unexpected ${name}`);
  });
});
afterEach(() => useMachines.setState({ machines: new Map() }));

function SessionMenu({ appSessionId }: { appSessionId: AppSessionId }) {
  return (
    <DropdownMenu.Root open>
      <DropdownMenu.Trigger>More</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content>
          <OpenInSubmenu appSessionId={appSessionId} menu="dropdown" />
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

async function openSubmenu(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
  const trigger = await screen.findByRole('menuitem', { name: OPEN_IN_COPY.label });
  act(() => trigger.focus());
  await user.keyboard('{ArrowRight}');
  return (await screen.findByRole('menuitem', { name: 'VS Code' })).closest<HTMLElement>('[role="menu"]')!;
}

describe('the rows', () => {
  it('fall in three groups, editors, terminals and Finder, each in main’s order', () => {
    expect(openInGroups(APPS).map((group) => group.map((app) => app.id))).toEqual([['vscode', 'zed'], ['terminal', 'ghostty'], ['finder']]);
    expect(openInGroups([{ id: 'terminal', name: 'Terminal' }, { id: 'finder', name: 'Finder' }]).length).toBe(2);
  });
});

describe('a session’s menu', () => {
  it('lists the apps main found and hands the working folder to the one chosen', async () => {
    const user = userEvent.setup();
    render(<SessionMenu appSessionId={S} />);
    const menu = await openSubmenu(user);
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['VS Code', 'Zed', 'Terminal', 'Ghostty', 'Finder']);
    expect(within(menu).getAllByRole('separator')).toHaveLength(2);
    await user.click(within(menu).getByRole('menuitem', { name: 'Zed' }));
    await waitFor(() => expect(main.callsOf('layout.openIn')).toEqual([{ appSessionId: bareOf(S), app: 'zed' }]));
    expect(notices()).toEqual([]);
  });

  it('says main’s sentence when nothing was opened', async () => {
    const user = userEvent.setup();
    answer = () => ok({ opened: false, message: 'Nothing was opened: this folder is not one this session works in' });
    render(<SessionMenu appSessionId={S} />);
    await user.click(within(await openSubmenu(user)).getByRole('menuitem', { name: 'Finder' }));
    await waitFor(() => expect(notices()).toEqual([{ level: 'warning', text: 'Nothing was opened: this folder is not one this session works in' }]));
  });

  it('is one disabled item for a session on another machine, saying where its folder is, and asks main nothing', async () => {
    useMachines.setState({ machines: new Map([[OTHER_MACHINE, { name: 'Studio' } as never]]) });
    render(<SessionMenu appSessionId={R} />);
    const item = await screen.findByRole('menuitem', { name: OPEN_IN_COPY.elsewhere('Studio') });
    expect(item.getAttribute('aria-disabled')).toBe('true');
    expect(screen.queryByRole('menuitem', { name: OPEN_IN_COPY.label })).toBeNull();
    expect(main.callsOf('layout.openInApps')).toEqual([]);
  });
});

describe('a file’s bar', () => {
  it('hands the file at the line shown, read when the row is chosen', async () => {
    const user = userEvent.setup();
    let line: number | null = 4;
    render(<OpenInButton appSessionId={S} path="/work/app/src/main.ts" line={() => line} />);
    await user.click(screen.getByRole('button', { name: OPEN_IN_COPY.label }));
    const vscode = await screen.findByRole('menuitem', { name: 'VS Code' });
    line = 40;
    await user.click(vscode);
    await waitFor(() => expect(main.callsOf('layout.openIn')).toEqual([{ appSessionId: bareOf(S), app: 'vscode', path: '/work/app/src/main.ts', line: 40 }]));
  });

  it('sends no line when the view has none', async () => {
    const user = userEvent.setup();
    render(<OpenInButton appSessionId={S} path="/work/app/notes.md" line={() => null} />);
    await user.click(screen.getByRole('button', { name: OPEN_IN_COPY.label }));
    await user.click(await screen.findByRole('menuitem', { name: 'Terminal' }));
    await waitFor(() => expect(main.callsOf('layout.openIn')).toEqual([{ appSessionId: bareOf(S), app: 'terminal', path: '/work/app/notes.md' }]));
  });

  it('is drawn disabled for a session on another machine', () => {
    useMachines.setState({ machines: new Map([[OTHER_MACHINE, { name: 'Studio' } as never]]) });
    render(<OpenInButton appSessionId={R} path="/work/app/notes.md" line={() => null} />);
    expect((screen.getByRole('button', { name: OPEN_IN_COPY.elsewhere('Studio') }) as HTMLButtonElement).disabled).toBe(true);
  });
});
