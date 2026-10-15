// @vitest-environment happy-dom
// The key dialog's Lock: the tab drops the key at once, and when the device fails to forget the key it kept, the
// dialog says so in whatever state it is in and offers a retry that really removes it.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ME } from '../../../test/me';
import { VECTOR_KEY } from '../../../test/vectors';
import { unlock, useKeyHolder } from '../../key/holder';
import { memoryKeyStore, type KeyStore } from '../../key/org-key';
import { KeyDialog } from './KeyDialog';

const device = vi.hoisted(() => ({ store: null as KeyStore | null }));
vi.mock('../../key/org-key', async (original) => ({ ...(await original<typeof import('../../key/org-key')>()), idbKeyStore: () => device.store! }));

beforeEach(() => useKeyHolder.setState({ state: 'loading', key: null, kept: null, fingerprint: null, forgetError: null }));
afterEach(cleanup);

describe('KeyDialog', () => {
  it('reports a key the device failed to forget, while locked, and its retry forgets it', async () => {
    const inner = memoryKeyStore();
    let failing = true;
    device.store = { ...inner, forget: (org) => (failing ? Promise.reject(new Error('IndexedDB is unavailable')) : inner.forget(org)) };
    await unlock(ME.org.id, Uint8Array.from(VECTOR_KEY), 'device');
    render(<KeyDialog me={ME} onClose={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: 'Lock' }));
    const alert = await screen.findByTestId('forget-failed');
    expect(alert.textContent).toContain('IndexedDB is unavailable');
    expect(useKeyHolder.getState()).toMatchObject({ state: 'locked', key: null });
    expect(screen.getByTestId('unlock')).toBeTruthy(); // the dialog is in its locked state, and still says it
    expect(await inner.load(ME.org.id)).not.toBeNull();

    failing = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.queryByTestId('forget-failed')).toBeNull());
    expect(await inner.load(ME.org.id)).toBeNull();
  });
});
