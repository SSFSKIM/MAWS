// @vitest-environment happy-dom
// A derivation the form started cannot undo a Lock pressed while it ran — whether the form is still there or not.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ME } from '../../../test/me';
import { VECTOR_KEY } from '../../../test/vectors';
import { lock, useKeyHolder } from '../../key/holder';
import { memoryKeyStore, type KeyStore } from '../../key/org-key';
import { UnlockForm } from './UnlockForm';

const device = vi.hoisted(() => ({ store: null as KeyStore | null, derive: null as ((raw: Uint8Array) => void) | null }));
vi.mock('../../key/org-key', async (original) => ({ ...(await original<typeof import('../../key/org-key')>()), idbKeyStore: () => device.store! }));
// The derivation itself (seconds of Argon2id, or a passkey prompt) is held open until the test ends it.
vi.mock('../../key/unlock', async (original) => ({
  ...(await original<typeof import('../../key/unlock')>()),
  deriveOrgKey: () => new Promise<Uint8Array>((resolve) => (device.derive = resolve)),
}));

beforeEach(() => {
  device.store = memoryKeyStore();
  device.derive = null;
  useKeyHolder.setState({ state: 'locked', key: null, kept: null, fingerprint: null, forgetError: null });
});
afterEach(cleanup);

async function startPassphraseUnlock(keep: boolean) {
  if (keep) fireEvent.click(screen.getByLabelText(/Keep unlocked on this device/));
  fireEvent.change(screen.getByLabelText(/your passphrase/), { target: { value: 'correct horse battery staple' } });
  fireEvent.submit(screen.getByRole('form', { name: 'Passphrase' }));
  await vi.waitFor(() => expect(device.derive).not.toBeNull());
}

describe('UnlockForm', () => {
  it('a derivation that ends after Lock, its form still open, leaves the browser locked and the device empty', async () => {
    render(<UnlockForm me={ME} />);
    await startPassphraseUnlock(true);
    await act(() => lock(ME.org.id));
    const raw = Uint8Array.from(VECTOR_KEY);
    await act(async () => device.derive!(raw));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(useKeyHolder.getState()).toMatchObject({ state: 'locked', key: null });
    expect(await device.store!.load(ME.org.id)).toBeNull();
    expect(raw.every((b) => b === 0)).toBe(true);
  });

  it('a derivation that ends after its form is gone and Lock was pressed leaves the browser locked', async () => {
    const { unmount } = render(<UnlockForm me={ME} />);
    await startPassphraseUnlock(true);
    unmount();
    await lock(ME.org.id);
    device.derive!(Uint8Array.from(VECTOR_KEY));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(useKeyHolder.getState()).toMatchObject({ state: 'locked', key: null });
    expect(await device.store!.load(ME.org.id)).toBeNull();
  });

  it('with no Lock meanwhile, the derivation unlocks', async () => {
    render(<UnlockForm me={ME} />);
    await startPassphraseUnlock(false);
    await act(async () => device.derive!(Uint8Array.from(VECTOR_KEY)));
    await vi.waitFor(() => expect(useKeyHolder.getState().state).toBe('unlocked'));
  });
});
