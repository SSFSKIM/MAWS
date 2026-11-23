// The folder field's browser on another machine (the project registry's Add project and Locate…): the machine's folders
// are read under a quiet spinner (the word cut, N175), which a refused read takes down for its words.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { PreloadBridge } from '@shared/ipc/schema';
import { fakeClient } from '../../../../test/support/fake-client';
import { OTHER_MACHINE } from '../../../../test/support/machine';
import { SETUP_WORDS } from '../sessions/remote-setup';
import { FolderField } from './FolderField';
import { REGISTRY } from './registry-copy';

afterEach(() => {
  cleanup();
  delete (window as { maws?: PreloadBridge }).maws;
});

describe('browsing another machine’s folders', () => {
  it('reads them under a quiet spinner, and a refused read leaves its words with no spinner', async () => {
    const fake = fakeClient({});
    window.maws = fake.client as unknown as PreloadBridge;
    render(<FolderField machine={OTHER_MACHINE} name="mini" local={false} value="" onChange={() => {}} />);
    fireEvent.click(screen.getByText(REGISTRY.browse)); // the button sits in the field's label, which names it
    expect(await screen.findByRole('progressbar', { name: SETUP_WORDS.loading }, { timeout: 2000 })).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Folders on mini' }).textContent).toBe('');
    await act(() => fake.fail('machine.folders.list', 'not allowed'));
    await waitFor(() => expect(screen.queryByRole('progressbar')).toBeNull());
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  // N175 (the word cut's fix wave for M4): every read after the first page, entering a folder, going up and loading more,
  // is the quiet spinner beside the folder shown, the page shown staying under it
  it('reads a folder entered, the way up and the next page under the quiet spinner beside the folder shown', async () => {
    const fake = fakeClient({});
    window.maws = fake.client as unknown as PreloadBridge;
    render(<FolderField machine={OTHER_MACHINE} name="mini" local={false} value="" onChange={() => {}} />);
    fireEvent.click(screen.getByText(REGISTRY.browse));
    await act(() => fake.reply('machine.folders.list', { entries: [{ name: 'work', path: '/home/ada/work', protected: false }], cursor: null }));
    const list = screen.getByRole('list', { name: 'Folders on mini' });
    const head = () => list.previousElementSibling as HTMLElement;
    const spinning = () => head().querySelector('[role="progressbar"]') !== null;
    const settled = async () => {
      await waitFor(() => expect(spinning()).toBe(false));
    };
    expect(spinning()).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'work' }));
    await waitFor(() => expect(spinning()).toBe(true), { timeout: 2000 });
    expect(list.textContent).toContain('work'); // the page shown stays while the next is read
    await act(() => fake.reply('machine.folders.list', { entries: [{ name: 'alpha', path: '/home/ada/work/alpha', protected: false }], cursor: 'next' }));
    await settled();
    fireEvent.click(screen.getByRole('button', { name: SETUP_WORDS.more }));
    await waitFor(() => expect(spinning()).toBe(true), { timeout: 2000 });
    await act(() => fake.reply('machine.folders.list', { entries: [{ name: 'beta', path: '/home/ada/work/beta', protected: false }], cursor: null }));
    await settled();
    fireEvent.click(screen.getByRole('button', { name: SETUP_WORDS.up }));
    await waitFor(() => expect(spinning()).toBe(true), { timeout: 2000 });
    await act(() => fake.reply('machine.folders.list', { entries: [{ name: 'work', path: '/home/ada/work', protected: false }], cursor: null }));
    await settled();
  });
});
