// Export and Save a copy (the P3-L execution document, M5b; Decision Log 14): the formats offered are those main's
// exporter registry serves for the kind (asked once per kind); an export writes through A's `artifacts.export` and is
// saved where the owner chooses (`library.saveAs` of that export); a File artifact's copy is its stored file saved the
// same way; the outcome is a toast, a cancelled dialog says nothing.
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useNotices } from '../stores/notices';
import { fail, installFakeMain, ok } from '../test-support/code';
import { exportArtifact, resetExportFormats, saveArtifactCopy, useExportFormats } from './export';

const A = '00000000-0000-4000-8000-000000000001';
const toasts = () => useNotices.getState().notices.filter((n) => n.kind === 'toast').map((n) => [n.level, n.text]);

beforeEach(() => {
  resetExportFormats();
  useNotices.setState({ notices: [] });
});

describe('the export formats', () => {
  it('are the registry’s for the kind, asked once per kind', async () => {
    const main = installFakeMain((name, input) => (name === 'library.exportFormats' ? ok({ formats: input.kind === 'html' ? ['pdf', 'png'] : [] }) : fail('no')));
    const first = renderHook(() => useExportFormats('html'));
    await waitFor(() => expect(first.result.current).toEqual(['pdf', 'png']));
    const again = renderHook(() => useExportFormats('html'));
    expect(again.result.current).toEqual(['pdf', 'png']);
    const file = renderHook(() => useExportFormats('file'));
    await waitFor(() => expect(main.callsOf('library.exportFormats')).toEqual([{ kind: 'html' }, { kind: 'file' }]));
    expect(file.result.current).toEqual([]);
  });

  it('are none while main cannot say, and asked again next time', async () => {
    let answer = fail('main is busy');
    const main = installFakeMain(() => answer);
    const first = renderHook(() => useExportFormats('html'));
    await waitFor(() => expect(main.calls).toHaveLength(1));
    expect(first.result.current).toEqual([]);
    answer = ok({ formats: ['pdf'] });
    const second = renderHook(() => useExportFormats('html'));
    await waitFor(() => expect(second.result.current).toEqual(['pdf']));
  });
});

describe('exporting', () => {
  it('exports the version asked and saves that export where the owner chooses', async () => {
    const main = installFakeMain((name) => (name === 'artifacts.export' ? ok({ path: '/store/x/exports/7-pdf.pdf', revision: 7 }) : ok({ saved: true, path: '/Users/me/Downloads/Plan.pdf' })));
    await act(() => exportArtifact(A, 'pdf', 3));
    expect(main.calls).toEqual([
      { name: 'artifacts.export', input: { artifactId: A, format: 'pdf', versionId: 3 } },
      { name: 'library.saveAs', input: { artifactId: A, source: { export: { revision: 7, format: 'pdf' } } } },
    ]);
    expect(toasts()).toEqual([['info', 'Saved to /Users/me/Downloads/Plan.pdf']]);
  });

  it('the live revision when no version is named; a refused export is told and nothing is saved; a cancelled save says nothing', async () => {
    const refused = installFakeMain(() => ({ ok: false, error: { code: 'invalid_input', message: 'MAWS cannot export a file artifact as pdf yet', issues: { reason: 'exportUnavailable', data: {} } } }));
    await act(() => exportArtifact(A, 'pdf'));
    expect(refused.calls).toEqual([{ name: 'artifacts.export', input: { artifactId: A, format: 'pdf' } }]);
    expect(toasts()).toEqual([['warning', 'Couldn’t export: MAWS cannot export a file artifact as pdf yet']]);

    useNotices.setState({ notices: [] });
    installFakeMain((name) => (name === 'artifacts.export' ? ok({ path: '/p', revision: 2 }) : ok({ saved: false })));
    await act(() => exportArtifact(A, 'png'));
    expect(toasts()).toEqual([]);
  });

  it('saves a copy of the stored file, at a revision when one is named', async () => {
    const main = installFakeMain(() => ok({ saved: true, path: '/Users/me/Downloads/budget.csv' }));
    await act(() => saveArtifactCopy(A, 4));
    await act(() => saveArtifactCopy(A));
    expect(main.callsOf('library.saveAs')).toEqual([
      { artifactId: A, source: { content: { revision: 4 } } },
      { artifactId: A, source: { content: {} } },
    ]);
    expect(toasts()).toEqual([
      ['info', 'Saved to /Users/me/Downloads/budget.csv'],
      ['info', 'Saved to /Users/me/Downloads/budget.csv'],
    ]);
  });
});
