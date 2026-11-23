import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useNotices } from '../stores/notices';
import { ExportBody } from './ExportWidget';

const view = { filename: 'export.txt', firstLine: '❯ Reply with exactly OK', text: '\n❯ Reply with exactly OK' };

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  useNotices.setState({ notices: [] });
});

describe('export widget copy', () => {
  // the word cut (P640, P638): Copy shows a check for a moment, the word kept for a screen reader alone; the preview line
  // ends without the line count
  it('shows a check on Copy for a moment once the clipboard took the text', async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    render(<ExportBody view={view} />);
    expect(screen.getByTitle(view.firstLine).textContent).toBe(view.firstLine);
    const copy = screen.getByRole('button', { name: 'Copy' });
    fireEvent.click(copy);
    await waitFor(() => expect(copy.textContent).toBe('✓'));
    expect(screen.getByRole('button', { name: 'Copy' })).toBe(copy);
    const said = screen.getByRole('status');
    expect(said.textContent).toBe('Copied');
    expect(said.className).toContain('sr-only');
    expect(writeText).toHaveBeenCalledWith(view.text);
    await waitFor(() => expect(copy.textContent).toBe('Copy'), { timeout: 3000 });
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
