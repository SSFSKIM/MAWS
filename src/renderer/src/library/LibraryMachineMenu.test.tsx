// The library's machine menu (P5 O7 M5a, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, M5, "Which machine an
// artifact is on"; the composer's MachineMenu pattern): the Artifacts tab lists one machine's library at a time, this Mac
// by default, or an RL2 machine that is up, chosen by name. Its rows and Spaces are that machine's (`library.list` and
// `library.spaces` asked of it), and its artifacts open there; what would act on this Mac's library (Make something new,
// New Space, a Space's menu) is not offered for another machine's.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { LibraryRow, LibrarySpace } from '@shared/ipc/schema/library';
import type { MachineState } from '@shared/ipc/schema/machines';
import type { MachineRef } from '@shared/machine/ref';
import { OTHER_MACHINE, TEST_MACHINE } from '../../../../test/support/machine';
import { artifactMachineOf, resetArtifactMachines } from '../artifacts/machines';
import { useMachines } from '../stores/machines';
import { installFakeMain, ok } from '../test-support/code';
import { artifactId, countsOf, libraryRow } from '../test-support/remote-artifacts';
import { resetShellStores } from '../test-support/shell-stores';
import { Library } from './Library';
import { connectLibrary, resetLibrary } from './store';
import { resetLibraryView } from './view';

const DOWN_MACHINE = 'DownMachineRef00000000' as MachineRef;
const HERE: LibraryRow[] = [libraryRow(1, { title: 'Notes on this Mac' })];
const STUDIO: LibraryRow[] = [libraryRow(2, { title: 'Deck on the studio', kind: 'presentation', space: { id: artifactId(80), name: 'Studio work' } })];
const SPACES: Record<string, LibrarySpace[]> = {
  [TEST_MACHINE]: [{ id: artifactId(81), name: 'Home', createdAt: 1, count: 0 }],
  [OTHER_MACHINE]: [{ id: artifactId(80), name: 'Studio work', createdAt: 1, count: 1 }],
};

let main: ReturnType<typeof installFakeMain>;
const sentTo = (name: 'library.list' | 'library.spaces') => main.calls.flatMap((call, i) => (call.name === name ? [machines[i]] : []));
let machines: (MachineRef | undefined)[];
let studioDown = false;
const offs: (() => void)[] = [];

const offsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')!;
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: (function (this: HTMLElement) { return this.hasAttribute('data-library-scroller') ? 4000 : 0; }) });
});
afterAll(() => Object.defineProperty(HTMLElement.prototype, 'offsetHeight', offsetHeight));

const roster = (...others: Pick<MachineState, 'ref' | 'name' | 'state' | 'carrier'>[]) =>
  act(() => useMachines.getState().applyRoster([
    { ref: TEST_MACHINE, name: 'This Mac', local: true, state: 'up', since: '2026-11-01T00:00:00.000Z', generation: 0 },
    ...others.map((machine) => ({ local: false, since: '2026-11-01T00:00:00.000Z', generation: 1, ...machine })),
  ]));

beforeEach(() => {
  resetShellStores();
  resetLibrary();
  resetLibraryView();
  resetArtifactMachines();
  machines = [];
  studioDown = false;
  main = installFakeMain((name, _input, target) => {
    const machine = (typeof target === 'object' && target !== null ? (target as { machine: MachineRef }).machine : target) ?? TEST_MACHINE;
    machines.push(machine);
    if (name === 'library.list') {
      if (machine === OTHER_MACHINE && studioDown) return { ok: false, error: { code: 'host_unavailable', message: 'studio is offline' } };
      const rows = machine === OTHER_MACHINE ? STUDIO : HERE;
      return ok({ rows, counts: countsOf(rows) });
    }
    if (name === 'library.spaces') return ok({ spaces: SPACES[machine] ?? [] });
    if (name === 'library.exportFormats') return ok({ formats: [] });
    if (name === 'artifacts.update') {
      const { sessions: _s, lastEditor: _e, lastEditedAt: _t, space: _p, ...artifact } = STUDIO[0]!;
      void [_s, _e, _t, _p];
      return ok({ artifact });
    }
    return new Promise(() => {});
  });
  offs.push(connectLibrary());
});
afterEach(() => {
  cleanup();
  offs.splice(0).forEach((off) => off());
  useMachines.setState({ roster: 'unread', machines: new Map(), loaded: new Set() });
  delete (window as { maws?: unknown }).maws;
});

const menu = () => screen.queryByRole('button', { name: /^Library on / });

describe('the library’s machine menu', () => {
  it('is not offered while the app reaches no other machine over RL2', async () => {
    roster({ ref: OTHER_MACHINE, name: 'studio', state: 'up', carrier: 'socket' });
    render(<Library />);
    await screen.findByRole('article', { name: 'Notes on this Mac' });
    expect(menu()).toBeNull();
  });

  it('offers this Mac and each RL2 machine that is up, and lists the one chosen: its rows, its Spaces, opened there', async () => {
    const user = userEvent.setup();
    roster({ ref: OTHER_MACHINE, name: 'studio', state: 'up', carrier: 'direct' }, { ref: DOWN_MACHINE, name: 'mini', state: 'down', carrier: 'relay' });
    render(<Library />);
    await screen.findByRole('article', { name: 'Notes on this Mac' });
    expect(menu()?.textContent).toContain('This Mac');
    await user.click(menu()!);
    const items = screen.getAllByRole('menuitemradio').map((item) => [item.textContent, item.getAttribute('aria-checked')]);
    expect(items).toEqual([['This Mac', 'true'], ['studio', 'false']]);
    await user.click(screen.getByRole('menuitemradio', { name: 'studio' }));
    await screen.findByRole('article', { name: 'Deck on the studio' });
    expect(screen.queryByRole('article', { name: 'Notes on this Mac' })).toBeNull();
    expect(menu()?.textContent).toContain('studio');
    expect(sentTo('library.list').at(-1)).toBe(OTHER_MACHINE);
    expect(sentTo('library.spaces')).toContain(OTHER_MACHINE);
    expect(artifactMachineOf(STUDIO[0]!.id)).toBe(OTHER_MACHINE);
    // what would act on this Mac's library is not offered for the studio's
    expect(screen.queryByRole('heading', { name: 'Make something new' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'New Space' })).toBeNull();
  });

  it('goes back to this Mac’s library, Make something new with it', async () => {
    const user = userEvent.setup();
    roster({ ref: OTHER_MACHINE, name: 'studio', state: 'up', carrier: 'relay' });
    render(<Library />);
    await user.click(await waitFor(() => menu()!));
    await user.click(screen.getByRole('menuitemradio', { name: 'studio' }));
    await screen.findByRole('article', { name: 'Deck on the studio' });
    await user.click(menu()!);
    await user.click(screen.getByRole('menuitemradio', { name: 'This Mac' }));
    await screen.findByRole('article', { name: 'Notes on this Mac' });
    expect(screen.getByRole('heading', { name: 'Make something new' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'New Space' })).toBeTruthy();
  });

  it('a row of the studio’s library moves between the studio’s Spaces, on the studio, and makes no Space here', async () => {
    const user = userEvent.setup();
    roster({ ref: OTHER_MACHINE, name: 'studio', state: 'up', carrier: 'direct' });
    render(<Library />);
    await user.click(await waitFor(() => menu()!));
    await user.click(screen.getByRole('menuitemradio', { name: 'studio' }));
    const article = await screen.findByRole('article', { name: 'Deck on the studio' });
    await user.click(within(article).getByRole('button', { name: 'Actions for Deck on the studio' }));
    await user.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Move to Space' }));
    const spaces = (await screen.findAllByRole('menuitemradio')).map((item) => item.textContent?.replace('●', ''));
    expect(spaces).toContain('Studio work');
    expect(spaces).not.toContain('Home');
    expect(screen.queryByRole('menuitem', { name: 'New Space…' })).toBeNull();
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'General' }));
    await waitFor(() => expect(main.callsOf('artifacts.update')).toEqual([{ artifactId: STUDIO[0]!.id, spaceId: null }]));
    const update = main.calls.findIndex((call) => call.name === 'artifacts.update');
    expect(machines[update]).toBe(OTHER_MACHINE);
  });

  // fix wave 1 (the task review): the list kept while the next is read is the same machine's, never another's
  it('a machine whose list fails shows the failure, never this Mac’s rows as its own', async () => {
    const user = userEvent.setup();
    studioDown = true;
    roster({ ref: OTHER_MACHINE, name: 'studio', state: 'up', carrier: 'direct' });
    render(<Library />);
    await screen.findByRole('article', { name: 'Notes on this Mac' });
    await user.click(menu()!);
    await user.click(screen.getByRole('menuitemradio', { name: 'studio' }));
    await screen.findByText(/studio is offline/);
    expect(menu()?.textContent).toContain('studio');
    expect(screen.queryByRole('article', { name: 'Notes on this Mac' })).toBeNull();
  });
});
