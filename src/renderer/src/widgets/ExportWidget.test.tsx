import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useNotices } from '../stores/notices';
import { ExportBody } from './ExportWidget';

const view = { filename: 'export.txt', firstLine: '❯ Reply with exactly OK', lines: 5, text: '\n❯ Reply with exactly OK' };

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  useNotices.setState({ notices: [] });
});

describe('export widget copy', () => {
  it('says Copied once the clipboard took the text', async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    render(<ExportBody view={view} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Copied'));
    expect(writeText).toHaveBeenCalledWith(view.text);
  });

  it('warns with the reason when the clipboard refuses the text, and never claims it was copied', async () => {
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: vi.fn(async () => Promise.reject(new Error('Document is not focused.'))) } });
    render(<ExportBody view={view} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(useNotices.getState().notices).toHaveLength(1));
    expect(useNotices.getState().notices[0]).toMatchObject({ kind: 'toast', level: 'warning', text: 'The export was not copied · Document is not focused.' });
    expect(screen.queryByRole('status')).toBeNull();
  });
});
