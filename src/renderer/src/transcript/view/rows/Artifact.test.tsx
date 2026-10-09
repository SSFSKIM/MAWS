// E2 (M5, Design §9): an artifact row on screen. Its heading by state ("Artifact Dashboard · v1", "Updated artifact
// Dashboard · v2", "Registering artifact Dashboard…", "Artifact Dashboard" when the result named no version, "Could not
// register artifact nope: …" without the tool's prefix and hint), one quiet Open that hands the row's session,
// deliverable id and version to `openDeliverable`, and the console chip while the deliverables store holds what that
// version's frame logged.
import type { AppSessionId } from '@shared/graph/ids';
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { loadJournal } from '../../../../../../test/support/fixtures';
import { consoleKey, deliverables, resetDeliverables } from '../../../tools/deliverables/store';
import { useTranscriptStore } from '../../../stores/transcript';
import { journalToEvents } from '../../dev/journal';
import type { Row } from '../../model/rows';
import { renderRow, storeWith } from './test-support';

afterEach(() => {
  cleanup();
  resetDeliverables();
});

type ArtifactRow = Extract<Row, { kind: 'artifact' }>;

const APP = 'app-maws' as AppSessionId;
const ID = '10edca26-3f45-406b-b141-781c4e54fe4b';
const BASE: ArtifactRow = {
  id: 'artifact:t1' as never, turnId: null, at: '2026-10-06T00:00:00.000Z', kind: 'artifact', toolUseId: 't1' as never, action: 'create', artifactId: 'dash', title: 'Dashboard',
  htmlPath: 'dashboard.html', deliverableId: ID, version: 1, error: null, answered: true,
};
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

  it('Open hands the row’s session, deliverable id and version to openDeliverable; a child transcript’s row opens in its parent session', () => {
    const { actions } = renderRow({ ...BASE, action: 'update', version: 2 }, { storeKey: APP });
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(actions.openDeliverable).toHaveBeenCalledExactlyOnceWith(APP, ID, 2);
    cleanup();
    const child = renderRow(BASE, { storeKey: `${APP}:agent-1` });
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(child.actions.openDeliverable).toHaveBeenCalledExactlyOnceWith(APP, ID, 1);
  });

  // P2-E1 (D10): a version a side thread wrote into its parent's artifact opens, and chips, against the parent's record
  it("a row naming the artifact's owner opens the owner's record and reads the owner's console", () => {
    const PARENT = 'app-parent' as AppSessionId;
    const { actions, container } = renderRow({ ...BASE, action: 'update', version: 2, ownerAppSessionId: PARENT }, { storeKey: APP });
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(actions.openDeliverable).toHaveBeenCalledExactlyOnceWith(PARENT, ID, 2);
    act(() => deliverables.setState({ console: new Map([[consoleKey(PARENT, ID, 2), [{ level: 'error', message: 'Uncaught Error: E1_BOOM', line: 3, source: null }]]]) }));
    expect(container.querySelector('[data-console-chip]')!.textContent).toBe('1 console error');
  });

  it('outside a mounted transcript Open is disabled', () => {
    const { actions } = renderRow(BASE);
    const open = screen.getByRole<HTMLButtonElement>('button', { name: 'Open' });
    expect(open.disabled).toBe(true);
    fireEvent.click(open);
    expect(actions.openDeliverable).not.toHaveBeenCalled();
  });

  it('shows the console chip for its own version while the store holds what that frame logged, and drops it when cleared', () => {
    const { container } = renderRow(BASE, { storeKey: APP });
    expect(container.querySelector('[data-console-chip]')).toBeNull();
    act(() => deliverables.setState({ console: new Map([[consoleKey(APP, ID, 2), [{ level: 'error', message: 'other version', line: 1, source: null }]]]) }));
    expect(container.querySelector('[data-console-chip]')).toBeNull();
    act(() => deliverables.setState({ console: new Map([[consoleKey(APP, ID, 1), [{ level: 'error', message: 'Uncaught Error: E2_BOOM', line: 3, source: null }, { level: 'warning', message: 'w', line: null, source: null }]]]) }));
    expect(container.querySelector('[data-console-chip]')!.textContent).toBe('1 console error');
    act(() => deliverables.setState({ console: new Map() }));
    expect(container.querySelector('[data-console-chip]')).toBeNull();
  });
});
