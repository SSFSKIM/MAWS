import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import type { ArtifactVersion } from '@shared/artifacts/version';
import { HistoryRail } from './HistoryRail';

const versions: ArtifactVersion[] = [
  { id: 7, seq: 12, at: 1_000, actor: { kind: 'human' }, kind: 'named', label: 'Draft', assetRefs: [] },
  { id: 9, seq: 18, at: 2_000, actor: { kind: 'human' }, kind: 'named', label: 'Final', assetRefs: [] },
  { id: 11, seq: 20, at: 3_000, actor: { kind: 'human' }, kind: 'named', label: 'Published', assetRefs: [] },
];
afterEach(cleanup);

it('exports the card’s version without selecting it, even while other versions are compared', async () => {
  const user = userEvent.setup();
  const select = vi.fn();
  const exported: number[] = [];
  render(<HistoryRail
    controller={{ select, save: vi.fn(), now: () => 2_000 }}
    snapshot={{ versions, selected: [9, 11], loading: false, status: null, error: null }}
    saving={false} onSaving={() => {}} onClose={() => {}}
    versionExports={(versionId) => [{ id: 'pdf', label: 'PDF', onSelect: () => exported.push(versionId) }]}
  />);
  await user.click(screen.getByRole('button', { name: 'Export version Draft' }));
  await user.click(screen.getByRole('menuitem', { name: 'PDF' }));
  expect(exported).toEqual([7]);
  expect(select).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Export version Final' }));
  await user.click(screen.getByRole('menuitem', { name: 'PDF' }));
  expect(exported).toEqual([7, 9]);
});

it('opens grouped formats without exporting, and binds nested choices to the history card', async () => {
  const user = userEvent.setup();
  const parentSelect = vi.fn();
  const select = vi.fn();
  const exported: Array<[number, string]> = [];
  render(<HistoryRail
    controller={{ select, save: vi.fn(), now: () => 2_000 }}
    snapshot={{ versions, selected: [9], loading: false, status: null, error: null }}
    saving={false} onSaving={() => {}} onClose={() => {}}
    versionExports={(versionId) => [{ id: 'powerpoint', label: 'PowerPoint', onSelect: parentSelect, children: [
      { id: 'basic', label: 'Basic fonts', onSelect: () => exported.push([versionId, 'basic']) },
      { id: 'named', label: 'Fonts by name', description: 'Requires the same fonts to be installed.', onSelect: () => exported.push([versionId, 'named']) },
    ] }]}
  />);
  await user.click(screen.getByRole('button', { name: 'Export version Draft' }));
  await user.click(screen.getByRole('menuitem', { name: 'PowerPoint' }));
  expect(parentSelect).not.toHaveBeenCalled();
  expect(exported).toEqual([]);
  // No layout in happy-dom: moving the pointer into a submenu trips Radix's pointer-grace geometry.
  fireEvent.click(await screen.findByRole('menuitem', { name: /Fonts by name/ }));
  expect(exported).toEqual([[7, 'named']]);
  expect(select).not.toHaveBeenCalled();
});
