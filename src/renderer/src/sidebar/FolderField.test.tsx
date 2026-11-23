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
});
