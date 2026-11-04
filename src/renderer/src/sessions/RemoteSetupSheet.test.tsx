// The remote setup's sheet (P5 O7 M9, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, "Remote setup"): a
// machine with no registered checkout of the org project asks which of its folders holds it (the other checkouts' paths
// first, a private folder opened only when asked), reads that folder's trust there, shows the machine's trust card when it
// isn't trusted, registers the folder (the owners' act), and the New chat tab then starts there on that checkout, the
// trust accepted with it. A machine refusing an untrusted checkout at Send offers the same card.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { PreloadBridge, ProjectRecord } from '@shared/ipc/schema';
import { addressOf } from '@shared/machine/address';
import type { OrgKey } from '@shared/machine/org-key';
import type { TrustState } from '@shared/sessions/trust';
import { project } from '../../../../test/support/builders';
import { fakeClient, type FakeClient } from '../../../../test/support/fake-client';
import { OTHER_MACHINE, TEST_MACHINE } from '../../../../test/support/machine';
import { closeDialog, openDialog, useDialogs } from './dialogs';
import { resetRemoteSpawn, spawnTargetOf } from './remote-spawn';
import { SETUP_WORDS } from './remote-setup';
import { SessionDialogs } from './SessionDialogs';

const TAB = addressOf(TEST_MACHINE, 'new-1' as AppSessionId);
const KEY = 'repo:github.com/acme/app' as OrgKey;
const HOME = '/Users/mini';
const APP = `${HOME}/Developer/GitHub/app`;
const entry = (path: string, isProtected = false) => ({ name: path.slice(path.lastIndexOf('/') + 1), path, protected: isProtected });
const HOME_PAGE = { entries: [entry(`${HOME}/Developer`), entry(`${HOME}/Documents`, true)], cursor: null };
const trustOf = (over: Partial<TrustState> = {}): TrustState => ({ directory: APP, trustKey: APP, keyKind: 'repo', configPath: `${HOME}/.claude.json`, trusted: false, source: null, isHome: false, found: [], ...over });
const registered = (directory: string): { project: ProjectRecord; location: { kind: 'directory'; path: string } } => ({
  project: { ...project('app', 0), directory }, // main's answer: a bare id, the page's client lifts it to the machine's address
  location: { kind: 'directory', path: directory },
});

let fake: FakeClient;
const install = (answers: Parameters<typeof fakeClient>[0] = {}) => {
  fake = fakeClient(answers);
  window.maws = fake.client as unknown as PreloadBridge;
};
const openFolderSetup = () =>
  act(() => openDialog({ kind: 'remoteSetup', request: { kind: 'folder', tab: TAB, machine: OTHER_MACHINE, name: 'mini', key: KEY, home: HOME, first: HOME_PAGE, suggestions: [APP] } }));
const folders = () => within(screen.getByRole('list', { name: 'Folders on mini' }));

beforeEach(() => {
  resetRemoteSpawn();
  render(<SessionDialogs />);
});
afterEach(() => {
  act(() => closeDialog());
  cleanup();
  delete (window as { maws?: PreloadBridge }).maws;
});

describe('setting a project up on another machine', () => {
  it('asks for the folder, reads its trust there, shows that machine’s trust card, registers the folder, and starts there trusted', async () => {
    install({ 'machine.folders.list': { entries: [entry(`${APP}/src`)], cursor: null }, 'session.trust.check': trustOf(), 'session.projects.addFolder': registered(APP) });
    openFolderSetup();
    const sheet = screen.getByRole('dialog', { name: 'Set up this project on mini' });
    expect(within(sheet).getByText(SETUP_WORDS.privacy('mini'))).toBeTruthy(); // the warning first
    expect(folders().getAllByRole('button').map((b) => b.textContent)).toEqual(['Developer', 'Documentsprivate']);
    expect((within(sheet).getByRole('button', { name: SETUP_WORDS.use }) as HTMLButtonElement).disabled).toBe(true); // the home is no project
    // the other checkouts' path first
    fireEvent.click(within(within(sheet).getByRole('group', { name: SETUP_WORDS.suggestions })).getByRole('button', { name: '~/Developer/GitHub/app' }));
    await waitFor(() => expect(folders().getAllByRole('button').map((b) => b.textContent)).toEqual(['src']));
    expect(fake.invoked('machine.folders.list')).toEqual([{ path: APP }]);
    expect(fake.machines('machine.folders.list')).toEqual([OTHER_MACHINE]);
    expect(within(sheet).getByText('~/Developer/GitHub/app', { selector: 'span' })).toBeTruthy(); // where the list is
    fireEvent.click(within(sheet).getByRole('button', { name: SETUP_WORDS.use }));
    // the machine's own trust card: no start without trusting, which the machine would refuse
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Trust this folder on mini?' })).toBeTruthy());
    expect(fake.invoked('session.trust.check')).toEqual([{ directory: APP }]);
    expect(fake.invoked('session.projects.addFolder')).toEqual([]); // nothing registered before the card is answered
    expect(screen.getByText(APP)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Start without trusting' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: SETUP_WORDS.trust }));
    await waitFor(() => expect(useDialogs.getState().open).toBeNull());
    expect(fake.invoked('session.projects.addFolder')).toEqual([{ directory: APP }]);
    expect(fake.machines('session.projects.addFolder')).toEqual([OTHER_MACHINE]);
    expect(spawnTargetOf(TAB, KEY)).toEqual({ machine: OTHER_MACHINE, name: 'mini', checkout: APP, key: KEY, trust: 'accepted' });
  });

  it('opens a private folder only when asked, warning first, and reads inside it only while within it', async () => {
    install({ 'machine.folders.list': (input: { path?: string }) => (input.path === undefined ? HOME_PAGE : { entries: [entry(`${input.path}/inner`)], cursor: null }) });
    openFolderSetup();
    fireEvent.click(folders().getByRole('button', { name: /^Documents/ }));
    expect(screen.getByText(SETUP_WORDS.openPrivate('~/Documents', 'mini'))).toBeTruthy();
    expect(fake.invoked('machine.folders.list')).toEqual([]); // nothing read inside before the answer
    fireEvent.click(screen.getByRole('button', { name: SETUP_WORDS.back }));
    expect(fake.invoked('machine.folders.list')).toEqual([]);
    fireEvent.click(folders().getByRole('button', { name: /^Documents/ }));
    fireEvent.click(screen.getByRole('button', { name: SETUP_WORDS.open }));
    await waitFor(() => expect(folders().getAllByRole('button').map((b) => b.textContent)).toEqual(['inner']));
    fireEvent.click(folders().getByRole('button', { name: 'inner' }));
    await waitFor(() => expect(fake.invoked('machine.folders.list')).toHaveLength(2));
    fireEvent.click(screen.getByRole('button', { name: SETUP_WORDS.up }));
    await waitFor(() => expect(screen.getByText('~/Documents', { selector: 'span' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: SETUP_WORDS.up }));
    await waitFor(() => expect(fake.invoked('machine.folders.list')).toHaveLength(4));
    expect(fake.invoked('machine.folders.list')).toEqual([
      { path: `${HOME}/Documents`, open: true },
      { path: `${HOME}/Documents/inner`, open: true },
      { path: `${HOME}/Documents`, open: true },
      {}, // the home again: nothing opened
    ]);
  });

  it('registers a folder the machine already trusts without a card, and says a refusal, staying open', async () => {
    install({ 'machine.folders.list': { entries: [], cursor: null }, 'session.trust.check': trustOf({ trusted: true, source: 'trustKey' }) });
    openFolderSetup();
    fireEvent.click(folders().getByRole('button', { name: 'Developer' }));
    await waitFor(() => expect(screen.getByText(SETUP_WORDS.empty)).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: SETUP_WORDS.use }));
    await waitFor(() => expect(fake.pending('session.projects.addFolder')).toBe(1));
    expect(screen.queryByRole('dialog', { name: 'Trust this folder on mini?' })).toBeNull();
    await act(() => fake.fail('session.projects.addFolder', 'cancelled', 'internal', { refusal: 'step-up-cancelled' }));
    expect(screen.getByRole('alert').textContent).toBe(SETUP_WORDS.cancelled);
    expect(useDialogs.getState().open?.kind).toBe('remoteSetup');
    fireEvent.click(screen.getByRole('button', { name: SETUP_WORDS.use }));
    await waitFor(() => expect(fake.pending('session.projects.addFolder')).toBe(1));
    await act(() => fake.reply('session.projects.addFolder', registered(`${HOME}/Developer`)));
    await waitFor(() => expect(useDialogs.getState().open).toBeNull());
    expect(spawnTargetOf(TAB, KEY)).toEqual({ machine: OTHER_MACHINE, name: 'mini', checkout: `${HOME}/Developer`, key: KEY }); // no trust to carry
  });

  it('applies nothing once cancelled while the trust read is out: no registration starts', async () => {
    install({ 'machine.folders.list': { entries: [], cursor: null } }); // the trust read stays out until answered
    openFolderSetup();
    fireEvent.click(folders().getByRole('button', { name: 'Developer' }));
    await waitFor(() => expect(screen.getByText(SETUP_WORDS.empty)).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: SETUP_WORDS.use }));
    await waitFor(() => expect(fake.pending('session.trust.check')).toBe(1));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(useDialogs.getState().open).toBeNull();
    await act(() => fake.reply('session.trust.check', trustOf({ trusted: true, source: 'trustKey' })));
    expect(fake.invoked('session.projects.addFolder')).toEqual([]);
    expect(spawnTargetOf(TAB, KEY)).toBeNull();
  });

  it('applies nothing once dismissed while the registration is out, and leaves a later dialog open', async () => {
    install({ 'machine.folders.list': { entries: [], cursor: null }, 'session.trust.check': trustOf({ trusted: true, source: 'trustKey' }) });
    openFolderSetup();
    fireEvent.click(folders().getByRole('button', { name: 'Developer' }));
    await waitFor(() => expect(screen.getByText(SETUP_WORDS.empty)).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: SETUP_WORDS.use }));
    await waitFor(() => expect(fake.pending('session.projects.addFolder')).toBe(1));
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Set up this project on mini' }), { key: 'Escape' });
    expect(useDialogs.getState().open).toBeNull();
    act(() => openDialog({ kind: 'hiddenProjects' }));
    await act(() => fake.reply('session.projects.addFolder', registered(`${HOME}/Developer`)));
    expect(spawnTargetOf(TAB, KEY)).toBeNull();
    expect(useDialogs.getState().open).toEqual({ kind: 'hiddenProjects' });
  });

  it('offers the trust card of a registered checkout the machine refused untrusted, and starts once it is accepted', async () => {
    install({ 'session.trust.check': trustOf() });
    const then = vi.fn();
    const target = { machine: OTHER_MACHINE, name: 'mini', checkout: APP, key: KEY };
    act(() => openDialog({ kind: 'remoteSetup', request: { kind: 'trust', tab: TAB, target, then } }));
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Trust this folder on mini?' })).toBeTruthy());
    expect(fake.invoked('session.trust.check')).toEqual([{ directory: APP }]);
    fireEvent.click(screen.getByRole('button', { name: SETUP_WORDS.trustAndStart }));
    await waitFor(() => expect(useDialogs.getState().open).toBeNull());
    expect(spawnTargetOf(TAB, KEY)).toEqual({ ...target, trust: 'accepted' });
    expect(then).toHaveBeenCalledOnce();
    expect(fake.invoked('session.projects.addFolder')).toEqual([]); // registered already
  });
});
