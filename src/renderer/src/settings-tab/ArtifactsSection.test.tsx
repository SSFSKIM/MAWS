// Settings › Artifacts (P3-D, docs/doperpowers/plans/2026-10-12-p3-d-design-systems.md D9; settings version 14): the
// owner's default design system and each Space's, read from the library's systems and Spaces, each row writing its
// field of `settings.artifacts` through `settings.set`.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { MawsBridge, Settings } from '@shared/ipc/schema';
import { ARTIFACT_KINDS } from '@shared/artifacts/entity';
import type { LibraryRow, LibrarySpace } from '@shared/ipc/schema/library';
import { SETTINGS_DEFAULTS_V18 } from '@shared/settings/defaults';
import { resetLibrary } from '../library/store';
import { useNotices } from '../stores/notices';
import { useSettings } from '../stores/settings';
import { settingsBridge, type SettingsBridge } from '../test-support/settings-bridge';
import { ArtifactsSection } from './ArtifactsSection';
import { useUsage } from '../stores/usage';
import { UsageSnapshotSchema } from '@shared/usage/types';

const MAWS = '6f1c1d2e-0b7a-4c55-9a3e-2f1b0c9d8e71';
const CLASSROOM = '0d9e8f7a-6b5c-4d3e-8f2a-1b0c9d8e7f6a';
const GONE = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const RESEARCH = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const TEACHING = 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e';

// A row as main's index answers it (the client validates answers).
const system = (id: string, title: string): LibraryRow => ({
  id, kind: 'design_system', title, createdBy: { kind: 'human' }, createdAt: 1, updatedAt: 1, lastViewedAt: null, pinned: false, agentEditsAsSuggestions: false,
  revision: 1, lastEditor: { kind: 'human' }, lastEditedAt: 1, sessions: [],
});
const counts = Object.fromEntries(ARTIFACT_KINDS.map((kind) => [kind, kind === 'design_system' ? 2 : 0]));
const space = (id: string, name: string): LibrarySpace => ({ id, name, createdAt: 1, count: 0 });

let b: SettingsBridge;

async function renderSection(artifacts: Settings['artifacts'], spaces: LibrarySpace[] = []) {
  b = settingsBridge({ ...SETTINGS_DEFAULTS_V18, artifacts });
  b.answers['library.list'] = () => ({ rows: [system(MAWS, 'MAWS'), system(CLASSROOM, 'Classroom')], counts });
  b.answers['library.spaces'] = () => ({ spaces });
  window.maws = b.bridge;
  const Bound = () => <ArtifactsSection artifacts={useSettings((s) => s.state!.settings.artifacts)} />;
  const view = render(<Bound />);
  await act(async () => {});
  return view;
}
const settings = () => useSettings.getState().state!.settings.artifacts;

afterEach(() => {
  cleanup();
  resetLibrary();
  useUsage.setState({ snapshot: null });
  useSettings.setState({ state: null });
  useNotices.setState({ notices: [] });
  delete (window as { maws?: MawsBridge }).maws;
});

describe('Settings › Artifacts', () => {
  it('suggests the routed Claude name without saving it, and commits an explicit export name once', async () => {
    useUsage.setState({ snapshot: UsageSnapshotSchema.parse({
      available: true, dataDir: '/usage', readAt: '2026-10-23T12:00:00Z', error: null, drainTarget: 'routed', drainTargetIsManual: false, pinsFor: {}, gateway: null, codex: null, activity: null,
      accounts: [{ uuid: 'routed', email: 'not-the-author@example.test', displayName: 'Kim Min', planLabel: null, rateLimitTier: null, needsReauthentication: false, lastSeenActive: null, pinnedSessionCount: 0, credentialOwnership: null, windows: { fiveHour: null, sevenDay: null, scoped: [] } }],
    }) });
    await renderSection(SETTINGS_DEFAULTS_V18.artifacts);
    const field = screen.getByRole('textbox', { name: 'Export author name' });
    expect((field as HTMLInputElement).value).toBe('');
    expect((field as HTMLInputElement).placeholder).toBe('Kim Min');
    expect(b.sets).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Use Kim Min' }));
    await act(async () => {});
    expect(b.sets).toEqual([{ artifacts: { exportAuthorName: 'Kim Min' } }]);
    expect((field as HTMLInputElement).value).toBe('Kim Min');
    fireEvent.change(field, { target: { value: '  K. Min  ' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    fireEvent.blur(field);
    await act(async () => {});
    expect(b.sets.at(-1)).toEqual({ artifacts: { exportAuthorName: 'K. Min' } });
    expect(b.sets).toHaveLength(2);
    fireEvent.change(field, { target: { value: '' } });
    fireEvent.blur(field);
    await act(async () => {});
    expect(b.sets.at(-1)).toEqual({ artifacts: { exportAuthorName: null } });
  });

  it('shows the neutral fallback without an account and preserves a saved name', async () => {
    await renderSection({ ...SETTINGS_DEFAULTS_V18.artifacts, exportAuthorName: 'Lee Sun' });
    const field = screen.getByRole('textbox', { name: 'Export author name' }) as HTMLInputElement;
    expect(field.value).toBe('Lee Sun');
    expect(screen.getByRole('group', { name: 'Export author name' }).textContent).toContain('Comment author');
    expect(screen.queryByRole('button', { name: /^Use / })).toBeNull();
    expect(b.sets).toEqual([]);
  });

  it('lists the house system and the library’s systems, and writes the owner’s default alone', async () => {
    await renderSection({ defaultDesignSystem: null, spaceDesignSystems: {}, commentsView: 'expand' /* P4-B1 */ });
    const select = screen.getByRole('combobox', { name: 'Default design system' }) as HTMLSelectElement;
    expect([...select.options].map((o) => o.text)).toEqual(['House system', 'Classroom', 'MAWS']);
    expect(select.value).toBe('');
    expect(b.calls.find((c) => c.name === 'library.list')?.input).toEqual({ filter: { kind: 'design_system' } });
    fireEvent.change(select, { target: { value: CLASSROOM } });
    await act(async () => {});
    expect(b.sets).toEqual([{ artifacts: { defaultDesignSystem: CLASSROOM } }]);
    expect(settings()).toEqual({ defaultDesignSystem: CLASSROOM, spaceDesignSystems: {}, commentsView: 'expand' /* P4-B1 */ });
    fireEvent.change(select, { target: { value: '' } });
    await act(async () => {});
    expect(b.sets.at(-1)).toEqual({ artifacts: { defaultDesignSystem: null } });
  });

  it('keeps showing a saved system the library no longer has, marked', async () => {
    await renderSection({ defaultDesignSystem: GONE, spaceDesignSystems: {}, commentsView: 'expand' /* P4-B1 */ });
    const select = screen.getByRole('combobox', { name: 'Default design system' }) as HTMLSelectElement;
    expect(select.value).toBe(GONE);
    expect(select.selectedOptions[0]!.text).toBe('A deleted system · the house system applies');
  });

  it('marks a Space’s deleted default with the next link of the chain, not the house, while the owner’s default is live', async () => {
    await renderSection({ defaultDesignSystem: CLASSROOM, spaceDesignSystems: { [TEACHING]: GONE }, commentsView: 'expand' /* P4-B1 */ }, [space(TEACHING, 'Teaching')]);
    const teaching = screen.getByRole('combobox', { name: 'Design system for Teaching' }) as HTMLSelectElement;
    expect(teaching.value).toBe(GONE);
    expect(teaching.selectedOptions[0]!.text).toBe('A deleted system · the next default applies');
    expect((screen.getByRole('combobox', { name: 'Default design system' }) as HTMLSelectElement).value).toBe(CLASSROOM);
  });

  it('sets and clears a Space’s default, writing the Spaces’ record whole', async () => {
    await renderSection({ defaultDesignSystem: null, spaceDesignSystems: { [TEACHING]: CLASSROOM }, commentsView: 'expand' /* P4-B1 */ }, [space(TEACHING, 'Teaching'), space(RESEARCH, 'Research')]);
    const row = screen.getByRole('group', { name: 'By Space' });
    expect(within(row).getAllByRole('combobox').map((s) => s.getAttribute('aria-label'))).toEqual(['Design system for Research', 'Design system for Teaching']);
    const research = within(row).getByRole('combobox', { name: 'Design system for Research' }) as HTMLSelectElement;
    expect([...research.options].map((o) => o.text)).toEqual(['Use my default', 'Classroom', 'MAWS']);
    fireEvent.change(research, { target: { value: MAWS } });
    await act(async () => {});
    expect(b.sets.at(-1)).toEqual({ artifacts: { spaceDesignSystems: { [TEACHING]: CLASSROOM, [RESEARCH]: MAWS } } });
    fireEvent.change(within(row).getByRole('combobox', { name: 'Design system for Teaching' }), { target: { value: '' } });
    await act(async () => {});
    expect(settings().spaceDesignSystems).toEqual({ [RESEARCH]: MAWS });
  });

  it('says a Space can have its own default when there is none', async () => {
    await renderSection({ defaultDesignSystem: null, spaceDesignSystems: {}, commentsView: 'expand' /* P4-B1 */ });
    expect(screen.getByRole('group', { name: 'By Space' }).textContent).toContain('No Spaces yet. A Space can have its own default design system.');
  });
});
