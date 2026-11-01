// "+ Session" on another machine (P5 O7 M4, "The machine menu" A5, "`session.spawn`"; the M4b report's order): which
// machines the menu offers for a project, the machine chosen per New chat tab, and the spawn itself: its fields, the tab
// moving to the new session's address, the local intent discarded, refusals in words, and with attachments no brief,
// the composer's document handed to the new session's composer, which uploads and sends once.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
import type { ProjectRecord } from '@shared/ipc/schema';
import { tabId } from '@shared/ipc/schema/layout';
import type { MachineState } from '@shared/ipc/schema/machines';
import { addressOf } from '@shared/machine/address';
import type { MachineRef } from '@shared/machine/ref';
import type { OrgKey } from '@shared/machine/org-key';
import type { Draft } from '@shared/ipc/schema/session';
import { project } from '../../../../test/support/builders';
import { fakeClient } from '../../../../test/support/fake-client';
import { OTHER_MACHINE, TEST_MACHINE } from '../../../../test/support/machine';
import { attachmentsOf, docOf, paragraph, textNode, type Attachment } from '../composer/editor/doc';
import { serializeDraft } from '../composer/editor/serialize';
import { rememberingRemoteDrafts, resetRemoteDrafts } from '../composer/editor/drafts';
import { useLayout } from '../stores/layout';
import { useMachines } from '../stores/machines';
import { readCandidates, resetRemoteSpawn, spawnErrorWords, spawnOnMachine, SPAWN_WORDS, spawnTargetOf, takeFirstSend, useRemoteSpawn, type SpawnTarget } from './remote-spawn';

const THIRD = 'ThirdMachineRef0000000' as MachineRef;
const LOCAL_TAB = addressOf(TEST_MACHINE, 'new-1' as AppSessionId);
const KEY = 'repo:github.com/acme/app' as OrgKey;
const org = { key: KEY, name: 'app', source: 'remote' as const, smnsId: null };
const machine = (ref: MachineRef, name: string, over: Partial<MachineState> = {}): MachineState => ({ ref, name, local: false, state: 'up', since: '2026-10-31T10:00:00Z', generation: 1, carrier: 'relay', ...over });
const remoteProject = (ref: MachineRef, id: string, over: Partial<ProjectRecord> = {}): ProjectRecord => ({ ...project(id, 0), id: addressOf(ref, id as ProjectId), directory: `/srv/${id}`, org, ...over });
const target: SpawnTarget = { machine: OTHER_MACHINE, name: 'mini', checkout: '/srv/app', key: KEY };

beforeEach(() => {
  resetRemoteSpawn();
  resetRemoteDrafts();
});
afterEach(() => useMachines.setState({ roster: 'unread', machines: new Map(), loaded: new Set() }));

describe('the machines the menu offers', () => {
  it('asks each up RL2 machine for its projects and offers those with a checkout of the same org project, by name', async () => {
    useMachines.getState().applyRoster([
      { ...machine(TEST_MACHINE, 'This Mac'), local: true, carrier: undefined },
      machine(OTHER_MACHINE, 'mini'),
      machine(THIRD, 'vm', { carrier: 'direct' }),
      machine('DownMachineRef00000000' as MachineRef, 'away', { state: 'down' }),
      machine('SocketMachineRef000000' as MachineRef, 'profile-b', { carrier: 'socket' }),
    ]);
    const fake = fakeClient({
      'session.projects.list': (_input: unknown, on: MachineRef) =>
        on === OTHER_MACHINE
          ? { projects: [remoteProject(OTHER_MACHINE, 'app'), remoteProject(OTHER_MACHINE, 'other', { org: { ...org, key: 'repo:x' as OrgKey } })], revision: 1 }
          : { projects: [remoteProject(THIRD, 'app', { discovered: true })], revision: 1 }, // discovered: no checkout
    });
    await expect(readCandidates(KEY, fake.client)).resolves.toEqual([{ machine: OTHER_MACHINE, name: 'mini', checkout: '/srv/app', key: KEY }]);
    expect(fake.machines('session.projects.list').sort()).toEqual([OTHER_MACHINE, THIRD].sort());
  });

  it('offers a machine whose read fails nothing, and the others still', async () => {
    useMachines.getState().applyRoster([machine(OTHER_MACHINE, 'mini'), machine(THIRD, 'vm')]);
    const fake = fakeClient();
    const read = readCandidates(KEY, fake.client);
    await fake.fail('session.projects.list', 'unreachable', 'host_unavailable');
    await fake.reply('session.projects.list', { projects: [remoteProject(THIRD, 'app')], revision: 1 });
    await expect(read).resolves.toEqual([{ machine: THIRD, name: 'vm', checkout: '/srv/app', key: KEY }]);
  });
});

describe('the machine chosen for a New chat tab', () => {
  it('is this Mac until another is chosen, and only for the project it was chosen with', () => {
    expect(spawnTargetOf(LOCAL_TAB, KEY)).toBeNull();
    useRemoteSpawn.getState().choose(LOCAL_TAB, target);
    expect(spawnTargetOf(LOCAL_TAB, KEY)).toEqual(target);
    expect(spawnTargetOf(LOCAL_TAB, 'repo:another')).toBeNull(); // the project changed: this Mac again
    useRemoteSpawn.getState().choose(LOCAL_TAB, null);
    expect(spawnTargetOf(LOCAL_TAB, KEY)).toBeNull();
  });
});

describe('a spawn on another machine', () => {
  const NEW = addressOf(OTHER_MACHINE, 'spawned-1' as AppSessionId);
  const ok = { status: 'ok', appSessionId: NEW }; // as the client lifts it
  const opened = () => useLayout.setState({ main: { ...useLayout.getState().main } }); // the layout as the app holds it
  const tabOpen = (id: AppSessionId) => JSON.stringify(useLayout.getState().main).includes(tabId({ kind: 'session', appSessionId: id }));
  beforeEach(() => {
    useLayout.getState().openTab({ kind: 'session', appSessionId: LOCAL_TAB });
    opened();
  });
  afterEach(() => useLayout.getState().closeTab(tabId({ kind: 'session', appSessionId: NEW })));

  const spawnOf = (doc = docOf([paragraph(textNode('fix the build'))]), over: Partial<Parameters<typeof spawnOnMachine>[0]> = {}) => {
    const fake = fakeClient({ 'session.spawn': ok, 'session.intent.discard': { leftover: null } });
    const s = serializeDraft(doc, { sessionId: null, cwd: '' });
    const run = spawnOnMachine({ from: LOCAL_TAB, target, s, doc, intent: { model: 'opus', effort: 'high', location: { kind: 'directory', path: '/work/app' } }, mode: 'acceptEdits', ...over }, fake.client);
    return { fake, run };
  };

  it('sends the text as the brief with the composer’s mode and model, to the machine, then moves the tab there and drops the local intent', async () => {
    const { fake, run } = spawnOf();
    await expect(run).resolves.toBeNull();
    expect(fake.invoked('session.spawn')).toEqual([{ checkout: '/srv/app', permission_mode: 'acceptEdits', model: 'opus', effort: 'high', brief: 'fix the build' }]);
    expect(fake.machines('session.spawn')).toEqual([OTHER_MACHINE]);
    expect(tabOpen(NEW)).toBe(true);
    expect(tabOpen(LOCAL_TAB)).toBe(false);
    expect(fake.invoked('session.intent.discard')).toEqual([{ appSessionId: LOCAL_TAB }]);
    expect(takeFirstSend(NEW)).toBe(false); // the brief was the first message
  });

  it('names the worktree a Worktree box asked for', async () => {
    const { fake, run } = spawnOf(undefined, { intent: { model: null, effort: null, location: { kind: 'newWorktree', repoRoot: '/work/app', name: 'app-1a2b', branch: { kind: 'new', name: 'worktree-app-1a2b', base: 'HEAD' } } } });
    await run;
    expect(fake.invoked('session.spawn')).toEqual([{ checkout: '/srv/app', permission_mode: 'acceptEdits', worktree: 'app-1a2b', brief: 'fix the build' }]);
  });

  it('with attachments sends no brief, moves the tab, and hands the whole document to the new session’s composer to upload and send once', async () => {
    const pdf: Attachment = { id: 'a1', kind: 'document', name: 'spec.pdf', mediaType: 'application/pdf', bytes: 3, data: 'JVBE', persisted: true };
    const doc = docOf([paragraph(textNode('read this'))], [pdf]);
    const { fake, run } = spawnOf(doc);
    await expect(run).resolves.toBeNull();
    expect(fake.invoked('session.spawn')).toEqual([{ checkout: '/srv/app', permission_mode: 'acceptEdits', model: 'opus', effort: 'high' }]);
    expect(tabOpen(NEW)).toBe(true);
    const handed = await rememberingRemoteDrafts({ load: async (): Promise<Draft | null> => null, save: () => {} }, NEW, () => true).load();
    expect(attachmentsOf(handed!.doc as never)).toEqual([pdf]); // whole, however large: the draft's byte budget is not applied
    expect(takeFirstSend(NEW)).toBe(true);
    expect(takeFirstSend(NEW)).toBe(false); // once
  });

  it('says each refusal in words a person can act on, and leaves the tab where it was', async () => {
    const answers: [unknown, string][] = [
      [{ status: 'refused', reason: 'untrusted' }, SPAWN_WORDS.untrusted('mini')],
      [{ status: 'refused', reason: 'unknown-checkout' }, SPAWN_WORDS.unknownCheckout('mini')],
      [{ status: 'refused', reason: 'worktree-exists' }, SPAWN_WORDS.worktreeExists('mini')],
      [{ status: 'refused', reason: 'the launch profile is missing' }, 'Not started on mini: the launch profile is missing'],
    ];
    for (const [value, words] of answers) {
      const fake = fakeClient({ 'session.spawn': value });
      const doc = docOf([paragraph(textNode('go'))]);
      await expect(spawnOnMachine({ from: LOCAL_TAB, target, s: serializeDraft(doc, { sessionId: null, cwd: '' }), doc, intent: { model: null, effort: null, location: null }, mode: 'default' }, fake.client), words).resolves.toBe(words);
      expect(tabOpen(LOCAL_TAB)).toBe(true);
      expect(fake.invoked('session.intent.discard')).toEqual([]);
    }
    const fake = fakeClient();
    const doc = docOf([paragraph(textNode('go'))]);
    const run = spawnOnMachine({ from: LOCAL_TAB, target, s: serializeDraft(doc, { sessionId: null, cwd: '' }), doc, intent: { model: null, effort: null, location: null }, mode: 'default' }, fake.client);
    await Promise.resolve();
    await fake.fail('session.spawn', 'Not sent: mini is offline', 'host_unavailable');
    await expect(run).resolves.toBe('Not sent: mini is offline'); // main's own words pass through
    expect(tabOpen(LOCAL_TAB)).toBe(true);
  });

  it('words the machine’s and the link’s refusals', () => {
    const refusal = (code: string) => ({ code: 'internal' as const, message: `session.spawn: refused ${code} by machine mini`, issues: { refusal: code } });
    expect(spawnErrorWords(refusal('step-up-cancelled'), 'mini')).toBe(SPAWN_WORDS.cancelled);
    expect(spawnErrorWords(refusal('grade'), 'mini')).toBe(SPAWN_WORDS.grade('mini'));
    expect(spawnErrorWords(refusal('ceiling'), 'mini')).toBe(SPAWN_WORDS.ceiling('mini'));
    expect(spawnErrorWords(refusal('unknown-checkout'), 'mini')).toBe(SPAWN_WORDS.unknownCheckout('mini'));
    expect(spawnErrorWords(refusal('not-offered'), 'mini')).toBe(SPAWN_WORDS.notOffered('mini'));
    expect(spawnErrorWords(refusal('malformed'), 'mini')).toBe(SPAWN_WORDS.malformed('mini'));
    expect(spawnErrorWords({ code: 'timeout', message: 'mini took the request but hasn’t confirmed it' }, 'mini')).toBe('mini took the request but hasn’t confirmed it');
  });
});
