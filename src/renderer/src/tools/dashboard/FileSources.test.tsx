import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setDataset, type FileDatasetDescriptor } from '@artifacts/dashboard/datasets';
import { newDoc, type Doc } from '@artifacts/yjs';
import { FileSources } from './FileSources';
import type { DatasetFileApi } from './file-source-api';

let doc: Doc;
const descriptor: FileDatasetDescriptor = {
  title: 'Project tasks', source: { kind: 'file', name: 'tasks.csv', ref: 'assets/tasks.csv', format: 'csv', sha256: 'a'.repeat(64), size: 12 },
  columns: [{ name: 'count', type: 'number' }], rows: 1, updated: { at: 1, by: { kind: 'human' } }, state: { status: 'ok', at: 1 },
};
const status = (state: 'current' | 'changed' | 'unavailable') => ({ revision: 4, files: [{ id: 'tasks', ref: descriptor.source.ref, state }] });
beforeEach(() => {
  vi.useFakeTimers();
  doc = newDoc();
  setDataset(doc, 'tasks', descriptor);
});
afterEach(() => { cleanup(); doc.destroy(); vi.useRealTimers(); });

function api() {
  return { check: vi.fn<DatasetFileApi['check']>().mockResolvedValue(status('current')), reread: vi.fn<DatasetFileApi['reread']>().mockResolvedValue({ revision: 5, versionId: 1 }) };
}

describe('local source status lifetime', () => {
  it('notices a file changing while the dashboard stays open, but stops checking while hidden or previewing', async () => {
    const source = api();
    const view = render(<FileSources doc={doc} shown api={source} />);
    await act(async () => {});
    expect(screen.queryByRole('status')).toBeNull();
    source.check.mockResolvedValue(status('changed'));
    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(screen.getByRole('button', { name: 'Reread Project tasks' })).toBeTruthy();
    expect(source.check).toHaveBeenCalledTimes(2);
    view.rerender(<FileSources doc={doc} shown={false} api={source} />);
    await act(async () => vi.advanceTimersByTimeAsync(20_000));
    expect(screen.queryByRole('status')).toBeNull();
    expect(source.check).toHaveBeenCalledTimes(2);
    view.rerender(<FileSources doc={doc} shown api={source} />);
    await act(async () => {});
    expect(source.check).toHaveBeenCalledTimes(3);
  });

  it('keeps a failed reread visible, leaves the last good descriptor intact, and permits retry', async () => {
    const source = api();
    source.check.mockResolvedValue(status('changed'));
    source.reread.mockRejectedValueOnce(new Error('the file has an invalid row key'));
    render(<FileSources doc={doc} shown api={source} />);
    await act(async () => {});
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Reread Project tasks' })));
    expect(screen.getByRole('status').textContent).toContain('Not reread: the file has an invalid row key');
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Reread Project tasks' }).disabled).toBe(false);
    expect(doc.get('datasets').getAttr('tasks')).toMatchObject({ source: descriptor.source, updated: descriptor.updated });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Reread Project tasks' })));
    expect(source.reread).toHaveBeenCalledTimes(2);
  });

  it('does not attach an older check to a replaced snapshot', async () => {
    const source = api();
    source.check.mockResolvedValue(status('changed'));
    render(<FileSources doc={doc} shown api={source} />);
    await act(async () => {});
    expect(screen.getByRole('button', { name: 'Reread Project tasks' })).toBeTruthy();
    act(() => setDataset(doc, 'tasks', { ...descriptor, source: { ...descriptor.source, ref: 'assets/new.csv' }, updated: { at: 2, by: { kind: 'human' } } }));
    await act(async () => {});
    expect(screen.queryByRole('button', { name: 'Reread Project tasks' })).toBeNull();
  });
});
