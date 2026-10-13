// The library's actions (the P3-L execution document, M3): each a write through A's `artifacts.*` and `spaces.*`, whose
// answer carries the store's refusal read by `artifactRefusalOf`; the library changes only when main's index does (no
// optimistic edit); opening an artifact reveals the main area and opens, or activates, its one tab.
import { beforeEach, describe, expect, it } from 'vitest';
import { LAYOUT_DEFAULTS } from '@shared/ipc/schema/layout';
import { useLayout } from '../stores/layout';
import { activeTab, allTabs } from '../stores/layout-model';
import { fail, installFakeMain, ok } from '../test-support/code';
import { resetShellStores } from '../test-support/shell-stores';
import {
  createArtifact, createSpace, deleteArtifact, deleteSpace, duplicateArtifact, linkSpaceDirectory, markArtifactViewed, moveArtifactToSpace, openArtifactTab,
  renameArtifact, renameSpace, setArtifactPinned,
} from './actions';

const A = '00000000-0000-4000-8000-000000000001';
const S = '00000000-0000-4000-8000-000000000101';
const artifact = { id: A, kind: 'document', title: 'Notes', createdBy: { kind: 'human' }, createdAt: 1, updatedAt: 1, lastViewedAt: null, pinned: false, agentEditsAsSuggestions: false, revision: 0 };
const space = { id: S, name: 'Research', createdAt: 1 };

beforeEach(() => resetShellStores());

describe('the library’s writes', () => {
  it('each asks its command and answers its value', async () => {
    const main = installFakeMain((name) => (name.startsWith('spaces.') && name !== 'spaces.delete' ? ok({ space }) : name === 'artifacts.delete' || name === 'artifacts.markViewed' || name === 'spaces.delete' ? ok() : ok({ artifact })));
    expect(await createArtifact({ kind: 'document', title: 'Untitled document', spaceId: S })).toEqual({ ok: true, value: artifact });
    await renameArtifact(A, 'Notes');
    await setArtifactPinned(A, true);
    await moveArtifactToSpace(A, null);
    await duplicateArtifact(A);
    await deleteArtifact(A);
    await markArtifactViewed(A);
    expect(await createSpace('Research', '/repo')).toEqual({ ok: true, value: space });
    await renameSpace(S, 'Reading');
    await linkSpaceDirectory(S, null);
    await deleteSpace(S);
    expect(main.calls).toEqual([
      { name: 'artifacts.create', input: { kind: 'document', title: 'Untitled document', spaceId: S } },
      { name: 'artifacts.update', input: { artifactId: A, title: 'Notes' } },
      { name: 'artifacts.update', input: { artifactId: A, pinned: true } },
      { name: 'artifacts.update', input: { artifactId: A, spaceId: null } },
      { name: 'artifacts.duplicate', input: { artifactId: A } },
      { name: 'artifacts.delete', input: { artifactId: A } },
      { name: 'artifacts.markViewed', input: { artifactId: A } },
      { name: 'spaces.create', input: { name: 'Research', linkedDir: '/repo' } },
      { name: 'spaces.update', input: { spaceId: S, name: 'Reading' } },
      { name: 'spaces.update', input: { spaceId: S, linkedDir: null } },
      { name: 'spaces.delete', input: { spaceId: S } },
    ]);
  });

  it('a refusal the store names comes back read; any other failure comes back with no refusal', async () => {
    installFakeMain((name) =>
      name === 'artifacts.delete'
        ? { ok: false, error: { code: 'invalid_input', message: 'in use', issues: { reason: 'designSystemInUse', data: { artifactIds: [A] } } } }
        : fail('host unavailable'),
    );
    const refused = await deleteArtifact(A);
    expect(refused).toMatchObject({ ok: false, refusal: { reason: 'designSystemInUse', data: { artifactIds: [A] } }, error: { message: 'in use' } });
    expect(await renameArtifact(A, 'x')).toMatchObject({ ok: false, refusal: null, error: { message: 'host unavailable' } });
  });
});

describe('opening an artifact', () => {
  it('opens its one tab in the current set, docking a maximized panel first; opening it again activates it', () => {
    useLayout.setState({ regions: { ...LAYOUT_DEFAULTS.regions, panel: { ...LAYOUT_DEFAULTS.regions.panel, maximized: true } } });
    openArtifactTab(A);
    expect(useLayout.getState().regions.panel.maximized).toBe(false);
    expect(activeTab(useLayout.getState().main)).toEqual({ id: `artifact:${A}`, kind: 'artifact', artifactId: A, pinned: false });
    useLayout.getState().openTab({ kind: 'diagnostics' });
    openArtifactTab(A);
    expect(activeTab(useLayout.getState().main)?.id).toBe(`artifact:${A}`);
    expect(allTabs(useLayout.getState().main).filter((t) => t.kind === 'artifact')).toHaveLength(1);
  });
});
