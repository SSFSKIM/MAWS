// E2 (M5, Design §9): an artifact row on screen. Its heading by state ("Artifact Dashboard · v1", "Updated artifact
// Dashboard · v2", "Registering artifact Dashboard…", "Artifact Dashboard" when the result named no version, "Could not
// register artifact nope: …" without the tool's prefix and hint), one quiet Open that hands the row's session,
// deliverable id (the artifact's) and version to `openArtifact`, and the console chip while the console store holds
// what that version's frame logged (P3-L M6b: the revision a viewer placed at the row's version).
import type { AppSessionId } from '@shared/graph/ids';
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_ACTS_CAPABILITY } from '@shared/ipc/remote-unavailable';
import type { MachineState } from '@shared/ipc/schema/machines';
import { addressOf } from '@shared/machine/address';
import type { MachineRef } from '@shared/machine/ref';
import { remoteRow } from '../../../../../../test/support/builders';
import { OTHER_MACHINE, TEST_MACHINE } from '../../../../../../test/support/machine';
import { artifactMachineOf, resetArtifactMachines } from '../../../artifacts/machines';
import { connectLibrary, resetLibrary } from '../../../library/store';
import { resetRemoteLaneBStore } from '../../../lane-b/remote-session';
import { useMachines } from '../../../stores/machines';
import { useSessions } from '../../../stores/sessions';
import { deferred, installFakeMain, ok } from '../../../test-support/code';
import { loadJournal } from '../../../../../../test/support/fixtures';
import { applyArtifactConsole, noteArtifactVersions, resetArtifactConsole } from '../../../tools/artifacts/viewers/console';
import { useTranscriptStore } from '../../../stores/transcript';
import { journalToEvents } from '../../dev/journal';
import type { Row } from '../../model/rows';
import { renderRow, spyActions, storeWith } from './test-support';

afterEach(() => {
  cleanup();
  resetArtifactConsole();
});

type ArtifactRow = Extract<Row, { kind: 'artifact' }>;

const APP = 'app-maws' as AppSessionId;
const ID = '10edca26-3f45-406b-b141-781c4e54fe4b';
const BASE: ArtifactRow = {
  id: 'artifact:t1' as never, turnId: null, at: '2026-10-06T00:00:00.000Z', kind: 'artifact', toolUseId: 't1' as never, action: 'create', artifactId: 'dash', title: 'Dashboard',
  htmlPath: 'dashboard.html', deliverableId: ID, version: 1, error: null, answered: true,
};
const placed = (...seqs: number[]) => seqs.map((seq) => ({ seq, kind: 'auto' as const }));
const heading = (container: HTMLElement) => container.querySelector('[data-artifact-heading]')!.textContent;

describe('the artifact row', () => {
  it('p1-maws-artifacts: the create and the update read their headings, the refused update its error, and only a registered version offers Open', async () => {
    const store = await storeWith(journalToEvents(loadJournal('pass3', 'p1-maws-artifacts')));
    useTranscriptStore.getState().expandAll(store.key);
    const rows = store.rows().filter((row): row is ArtifactRow => row.kind === 'artifact');
    const read = rows.map((row) => {
      const view = renderRow(row, { storeKey: APP });
      const shown = [heading(view.container), [...view.container.querySelectorAll('button')].map((button) => button.textContent)];
      view.unmount();
      return shown;
    });
    expect(read).toEqual([
      ['Artifact Dashboard · v1', ['Open']],
      ['Updated artifact Dashboard · v2', ['Open']],
      ['Could not register artifact nope: no artifact "nope" in this session', []],
    ]);
  });

  it('reads Registering until the result, by title, else by the artifact’s id, with no Open', () => {
    const pending = renderRow({ ...BASE, deliverableId: null, version: null, answered: false }, { storeKey: APP });
    expect(heading(pending.container)).toBe('Registering artifact Dashboard…');
    expect(pending.container.querySelectorAll('button')).toHaveLength(0);
    pending.unmount();
    const untitled = renderRow({ ...BASE, action: 'update', title: null, deliverableId: null, version: null, answered: false }, { storeKey: APP });
    expect(heading(untitled.container)).toBe('Registering artifact dash…');
  });

  it('a result that names no version reads a neutral heading without a version, and offers no Open', () => {
    const created = renderRow({ ...BASE, deliverableId: null, version: null }, { storeKey: APP });
    expect(heading(created.container)).toBe('Artifact Dashboard');
    expect(created.container.querySelectorAll('button')).toHaveLength(0);
    created.unmount();
    const updated = renderRow({ ...BASE, action: 'update', title: null, deliverableId: null, version: null }, { storeKey: APP });
    expect(heading(updated.container)).toBe('Updated artifact dash');
  });

  it('a refusal reads without the tool’s prefix or its hint to the model', () => {
    const refused = (action: ArtifactRow['action'], error: string) => {
      const view = renderRow({ ...BASE, action, artifactId: 'x', title: null, deliverableId: null, version: null, error }, { storeKey: APP });
      const shown = heading(view.container);
      view.unmount();
      return shown;
    };
    expect(refused('create', 'artifact_create: an artifact "x" already exists in this session; use artifact_update')).toBe('Could not register artifact x: an artifact "x" already exists in this session');
    expect(refused('update', 'artifact_update: no artifact "x" in this session; use artifact_create')).toBe('Could not register artifact x: no artifact "x" in this session');
    expect(refused('create', 'artifact_create: x.html is not a file')).toBe('Could not register artifact x: x.html is not a file');
  });

  it('Open hands the row’s session, artifact id and version to openArtifact; a child transcript’s row opens in its parent session', () => {
    const { actions } = renderRow({ ...BASE, action: 'update', version: 2 }, { storeKey: APP });
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(actions.openArtifact).toHaveBeenCalledExactlyOnceWith(APP, ID, { version: 2 });
    cleanup();
    const child = renderRow(BASE, { storeKey: `${APP}:agent-1` });
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(child.actions.openArtifact).toHaveBeenCalledExactlyOnceWith(APP, ID, { version: 1 });
  });

  // P2-E1 (D10): a version a side thread wrote into its parent's artifact opens in the parent's panel; its console is the
  // artifact's, whichever session's row names it
  it("a row naming the artifact's owner opens it in the owner's session and reads the artifact's console", () => {
    const PARENT = 'app-parent' as AppSessionId;
    const { actions, container } = renderRow({ ...BASE, action: 'update', version: 2, ownerAppSessionId: PARENT }, { storeKey: APP });
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(actions.openArtifact).toHaveBeenCalledExactlyOnceWith(PARENT, ID, { version: 2 });
    act(() => {
      noteArtifactVersions(ID, placed(3, 8));
      applyArtifactConsole({ artifactId: ID, revision: 8, level: 'error', message: 'Uncaught Error: E1_BOOM', line: 3, source: null });
    });
    expect(container.querySelector('[data-console-chip]')!.textContent).toBe('1 console error');
  });

  // P3-L M6b fix wave 2: a row whose call's answer named its revision opens that revision, and its chip reads that
  // revision's console, whatever place thinning has moved it to
  it('opens by the revision its call wrote when the row has one, and reads that revision’s console', () => {
    const { actions, container } = renderRow({ ...BASE, version: 2, revision: 9 }, { storeKey: APP });
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(actions.openArtifact).toHaveBeenCalledExactlyOnceWith(APP, ID, { revision: 9 });
    act(() => {
      noteArtifactVersions(ID, placed(9)); // thinned: v1 gone, the publish now the first place
      applyArtifactConsole({ artifactId: ID, revision: 9, level: 'error', message: 'Uncaught Error: REV_9', line: 1, source: null });
    });
    expect(container.querySelector('[data-console-chip]')!.textContent).toBe('1 console error');
  });

  it('outside a mounted transcript Open is disabled', () => {
    const { actions } = renderRow(BASE);
    const open = screen.getByRole<HTMLButtonElement>('button', { name: 'Open' });
    expect(open.disabled).toBe(true);
    fireEvent.click(open);
    expect(actions.openArtifact).not.toHaveBeenCalled();
  });

  // P3-L M6b: the row names its version by its place; a viewer that read the versions placed each revision, and the
  // chip reads the console of the revision at the row's place (v1 here is revision 5, never revision 1)
  it('shows the console chip for its own version while the store holds what that frame logged, and drops it when cleared', () => {
    const { container } = renderRow(BASE, { storeKey: APP });
    act(() => applyArtifactConsole({ artifactId: ID, revision: 5, level: 'error', message: 'Uncaught Error: E2_BOOM', line: 3, source: null }));
    expect(container.querySelector('[data-console-chip]')).toBeNull(); // no viewer has placed the versions yet
    act(() => noteArtifactVersions(ID, placed(5, 9)));
    expect(container.querySelector('[data-console-chip]')!.textContent).toBe('1 console error');
    act(() => applyArtifactConsole({ artifactId: ID, revision: 1, level: 'error', message: 'revision 1 is not v1', line: 1, source: null }));
    act(() => applyArtifactConsole({ artifactId: ID, revision: 9, level: 'error', message: 'other version', line: 1, source: null }));
    expect(container.querySelector('[data-console-chip]')!.textContent).toBe('1 console error');
    act(() => resetArtifactConsole());
    expect(container.querySelector('[data-console-chip]')).toBeNull();
  });

  // M6b fix wave 1 (Decision Log 39c): a row from before P3 names X12's version number, found on the imported version
  // that keeps it, wherever the history before it thinned
  it('reads the console of the imported version its X12 number names', () => {
    const { container } = renderRow({ ...BASE, version: 3 }, { storeKey: APP });
    act(() => {
      noteArtifactVersions(ID, [{ seq: 5, kind: 'import', label: 'v1' }, { seq: 14, kind: 'import', label: 'v3' }, { seq: 20, kind: 'auto' }]);
      applyArtifactConsole({ artifactId: ID, revision: 14, level: 'error', message: 'Uncaught Error: X12_V3', line: 1, source: null });
    });
    expect(container.querySelector('[data-console-chip]')!.textContent).toBe('1 console error');
  });
});


// UX wave U10b (M5; docs/doperpowers/plans/2026-11-15-ux-wave-U10b-artifacts.md §C.4): an `artifact_delete` call's row.
// What it shows is read from the library of the session's machine: "Deleted <title>" with Undo while it does not list
// the artifact (Undo disabled until that read has answered), "Restored <title>" with Open while it does. Undo is disabled
// while it runs, and a second press sends nothing; an Undo that ended without its effect, and the reason Undo is
// disabled on another machine, are a line of the row. A refusal reads in the person's words.
describe('the row of an agent’s delete', () => {
  const DRAFT = '6b0f6b2e-1d7a-4c35-9a59-2f1c0c4f7a11';
  const R = addressOf(OTHER_MACHINE, 'app-r' as AppSessionId);
  const DELETED: ArtifactRow = { ...BASE, action: 'delete', artifactId: DRAFT, title: 'Draft plan', htmlPath: '', deliverableId: null, version: null };
  const MINI: MachineState = { ref: OTHER_MACHINE, name: 'mini', local: false, state: 'up', since: '2026-11-15T09:00:00.000Z', generation: 1, carrier: 'relay' };
  let listed: boolean;
  let reads: (MachineRef | undefined)[];
  let main: ReturnType<typeof installFakeMain>;
  let offLibrary: () => void;
  beforeEach(() => {
    resetLibrary();
    resetArtifactMachines();
    resetRemoteLaneBStore();
    listed = false;
    reads = [];
    main = installFakeMain((name, _input, machine) => {
      if (name !== 'library.get') return new Promise(() => {});
      reads.push(machine);
      return ok({ row: listed ? ({ id: DRAFT, kind: 'document', title: 'Draft plan' } as never) : null });
    });
    offLibrary = connectLibrary();
  });
  afterEach(() => {
    cleanup();
    offLibrary();
    useSessions.setState({ listed: new Map(), listedMachines: new Set() });
    useMachines.getState().applyRoster([]);
    delete (window as { maws?: unknown }).maws;
  });
  const withUndo = (undo: (appSessionId: AppSessionId, artifactId: string) => Promise<string | null>) => ({ ...spyActions(), undeleteArtifact: vi.fn(undo) });
  const undoButton = () => screen.getByRole<HTMLButtonElement>('button', { name: 'Undo' });
  const line = (container: HTMLElement) => container.querySelector('[data-artifact-line]')?.textContent ?? null;
  const libraryChanged = async () => act(async () => main.emit('library.changed', { revision: 2 }));

  it('reads "Deleting <reference>…" until the answer, with no control', () => {
    const { container } = renderRow({ ...DELETED, artifactId: 'draft-plan', title: null, answered: false }, { storeKey: APP, actions: withUndo(async () => null) });
    expect(heading(container)).toBe('Deleting draft-plan…');
    expect(container.querySelectorAll('button')).toHaveLength(0);
  });

  it('"Deleted <title>" with Undo disabled until the library has answered; Undo held open is disabled and a second press sends nothing; then "Restored <title>" with Open', async () => {
    const asked = deferred<string | null>();
    const actions = withUndo(() => asked.promise);
    const { container } = renderRow(DELETED, { storeKey: APP, actions });
    expect(heading(container)).toBe('Deleted Draft plan');
    expect(undoButton().disabled).toBe(true); // the library has not answered yet
    await act(async () => {});
    expect(reads).toEqual([TEST_MACHINE]); // this Mac's library: the session is this Mac's
    expect(undoButton().disabled).toBe(false);
    fireEvent.click(undoButton());
    fireEvent.click(undoButton());
    expect(actions.undeleteArtifact).toHaveBeenCalledExactlyOnceWith(APP, DRAFT);
    expect(undoButton().disabled).toBe(true);
    await act(async () => asked.resolve(null));
    listed = true;
    await libraryChanged();
    expect(heading(container)).toBe('Restored Draft plan');
    expect(container.querySelector('[data-artifact-state]')!.getAttribute('data-artifact-state')).toBe('restored');
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(actions.openArtifact).toHaveBeenCalledExactlyOnceWith(APP, DRAFT);
    listed = false; // deleted again elsewhere: read, not remembered
    await libraryChanged();
    expect(heading(container)).toBe('Deleted Draft plan');
  });

  it('an Undo that ends without its effect leaves its sentence as a line of the row, and Undo enabled again', async () => {
    const actions = withUndo(async () => 'Not restored: this artifact was deleted in the Library, not by an agent');
    const { container } = renderRow(DELETED, { storeKey: APP, actions });
    await act(async () => {});
    await act(async () => fireEvent.click(undoButton()));
    expect(line(container)).toBe('Not restored: this artifact was deleted in the Library, not by an agent');
    expect(container.querySelector('[data-artifact-line]')!.getAttribute('data-tone')).toBe('danger');
    expect(heading(container)).toBe('Deleted Draft plan');
    expect(undoButton().disabled).toBe(false);
  });

  it('a session on another machine reads that machine’s library, also for an artifact the window never listed, and routes Undo by the session', async () => {
    useMachines.getState().applyRoster([{ ...MINI, capabilities: [SESSION_ACTS_CAPABILITY, 'rl2.artifact-undelete'], owner: true }]);
    useSessions.setState({ listed: new Map([[R, { ...remoteRow(OTHER_MACHINE, 'app-r'), appId: R }]]), listedMachines: new Set([OTHER_MACHINE]) });
    expect(artifactMachineOf(DRAFT)).toBeNull();
    const actions = withUndo(async () => null);
    const { container } = renderRow(DELETED, { storeKey: R, actions });
    await act(async () => {});
    expect(artifactMachineOf(DRAFT)).toBe(OTHER_MACHINE);
    expect(reads).toEqual([OTHER_MACHINE]);
    expect(line(container)).toBeNull();
    fireEvent.click(undoButton());
    expect(actions.undeleteArtifact).toHaveBeenCalledExactlyOnceWith(R, DRAFT);
  });

  it('on another machine Undo is disabled with its sentence as a line: offline, a build without the capability, a member who does not own it', async () => {
    useSessions.setState({ listed: new Map([[R, { ...remoteRow(OTHER_MACHINE, 'app-r'), appId: R }]]), listedMachines: new Set([OTHER_MACHINE]) });
    const cases: [Partial<MachineState>, string][] = [
      [{ state: 'down', generation: 0, since: new Date().toISOString(), owner: true }, 'Restore is unavailable while mini is offline.'],
      [{ capabilities: [SESSION_ACTS_CAPABILITY], owner: true }, 'Can’t restore on mini yet. Update MAWS on mini and try again.'],
      [{ capabilities: [SESSION_ACTS_CAPABILITY, 'rl2.artifact-undelete'], owner: false }, 'Only mini’s owners can restore an artifact there.'],
    ];
    for (const [standing, sentence] of cases) {
      useMachines.getState().applyRoster([{ ...MINI, ...standing }]);
      const actions = withUndo(async () => null);
      const view = renderRow(DELETED, { storeKey: R, actions });
      await act(async () => {});
      expect(line(view.container)).toBe(sentence);
      expect(view.container.querySelector('[data-artifact-line]')!.getAttribute('data-tone')).toBe('muted');
      expect(undoButton().disabled).toBe(true);
      fireEvent.click(undoButton());
      expect(actions.undeleteArtifact).not.toHaveBeenCalled();
      view.unmount();
    }
  });

  it('a refusal reads in the person’s words, with neither the tool’s name nor "the user", and no control', () => {
    const { container } = renderRow({ ...DELETED, title: null, artifactId: 'budget', error: 'artifact_delete: the user has edited "Budget"; ask them to delete it in the Library {"reason":"invalid","why":"edited"}', why: 'edited' }, { storeKey: APP, actions: withUndo(async () => null) });
    expect(heading(container)).toBe('Could not delete budget: you have edited it. Delete it from the Library if you no longer need it.');
    expect(container.querySelector('[data-artifact-state]')!.getAttribute('data-artifact-state')).toBe('error');
    expect(container.querySelectorAll('button')).toHaveLength(0);
  });

  it('where the host offers no Undo (the desk) it draws the heading alone and reads nothing', async () => {
    const { container } = renderRow(DELETED, { storeKey: APP });
    await act(async () => {});
    expect(heading(container)).toBe('Deleted Draft plan');
    expect(container.querySelectorAll('button')).toHaveLength(0);
    expect(reads).toEqual([]);
  });
});
