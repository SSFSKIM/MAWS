// The word cut in the version history rail and Show editors (docs/doperpowers/specs/2026-11-16-word-cut-design.md, M5
// task 2; editors.md G359 to G361, G371, G373, G374): the list's and the editors' waits are quiet spinners, an empty
// list says so in a few words, and the Save version form's placeholders are short. The rail and the popover drawn
// alone, over a snapshot the test holds.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ArtifactVersion } from '@shared/artifacts/version';
import type { HistorySnapshot } from './controller';
import { HistoryRail } from './HistoryRail';
import { ShowEditorsMenu } from './ShowEditors';

afterEach(cleanup);

const named: ArtifactVersion = { id: 7, seq: 12, at: 1_000, actor: { kind: 'human' }, kind: 'named', label: 'Draft', assetRefs: [] };
const auto: ArtifactVersion = { id: 8, seq: 13, at: 2_000, actor: { kind: 'human' }, kind: 'auto', assetRefs: [] };
type Shown = Pick<HistorySnapshot, 'versions' | 'selected' | 'loading' | 'status' | 'error'>;
const snapshot = (over: Partial<Shown> = {}): Shown => ({ versions: [named, auto], selected: [], loading: false, status: null, error: null, ...over });
function rail(shown: Shown, saving = false) {
  return render(<HistoryRail controller={{ select: vi.fn(), save: vi.fn(async () => true), now: () => 3_000 }} snapshot={shown} saving={saving} onSaving={() => {}} onClose={() => {}} />);
}
const list = () => screen.getByRole('complementary', { name: 'Version history' }).querySelector<HTMLElement>('.doc-rail-body')!;
const spinner = async (name: string) => {
  const give = Date.now() + 2_000;
  while (!screen.queryByRole('progressbar', { name })) {
    if (Date.now() > give) throw new Error(`no spinner named ${name}`);
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
  }
};

describe('the version history rail', () => {
  it('shows the list’s wait as a quiet spinner and no words', async () => {
    rail(snapshot({ versions: null }));
    expect(list().textContent).toBe('');
    await spinner('Loading versions…');
    expect(list().textContent).toBe('');
  });

  it('draws no spinner under a failed read, whose error the status line says', async () => {
    rail(snapshot({ versions: null, error: 'The host is unavailable' }));
    expect(screen.getByRole('status').textContent).toBe('The host is unavailable');
    await act(() => new Promise((resolve) => setTimeout(resolve, 600)));
    expect(within(list()).queryByRole('progressbar')).toBeNull();
  });

  it('says an empty list in a few words, with Named only or without', () => {
    rail(snapshot({ versions: [] }));
    expect(list().textContent).toBe('No versions');
    act(() => void fireEvent.click(screen.getByRole('checkbox', { name: 'Named only' })));
    expect(list().textContent).toBe('No named versions');
  });

  it('shows a version’s wait as a quiet spinner in the status line', async () => {
    rail(snapshot({ loading: true }));
    const status = screen.getByRole('status');
    expect(status.textContent).toBe('');
    await spinner('Loading the version…');
    expect(status.textContent).toBe('');
  });

  it('asks Save version for a name and a note in short placeholders', () => {
    rail(snapshot(), true);
    expect(screen.getByRole('textbox', { name: 'Version name' }).getAttribute('placeholder')).toBe('Name');
    expect(screen.getByRole('textbox', { name: 'What changed' }).getAttribute('placeholder')).toBe('Note (optional)');
  });
});

describe('Show editors', () => {
  const open = { x: 40, y: 20, from: 1, to: 5, asked: true, error: null };
  it('heads its list Editors, waits for it with a quiet spinner and says an empty one in a few words', async () => {
    const view = render(<ShowEditorsMenu open={{ ...open, editors: null }} onShow={() => {}} onClose={() => {}} />);
    const popover = screen.getByRole('dialog', { name: 'Editors' });
    expect(popover.querySelector('.doc-editors-title')!.textContent).toBe('Editors');
    expect(popover.querySelector('.doc-editors-empty')!.textContent).toBe('');
    await spinner('Reading the history…');
    view.rerender(<ShowEditorsMenu open={{ ...open, editors: [] }} onShow={() => {}} onClose={() => {}} />);
    expect(screen.getByRole('dialog', { name: 'Editors' }).querySelector('.doc-editors-empty')!.textContent).toBe('No edits recorded');
  });
});
