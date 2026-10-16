// @vitest-environment happy-dom
// The unlock form: an unlock the form started cannot undo a Lock pressed while it ran — whether the form is still there
// or not; an org with no key is set up here, and a setup another browser beat is told so and offered the unlock; a
// first setup prompts for a second method.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrgKey } from 'desk-hub/protocol';
import { OrgKeysDouble } from '../../../test/double/org-keys';
import { ME } from '../../../test/me';
import { VECTOR_KEY } from '../../../test/vectors';
import { holdKeyBytes } from '../../key/derive';
import { lock, useKeyHolder } from '../../key/holder';
import { memoryKeyStore, type KeyStore } from '../../key/org-key';
import { importWrappingKey } from '../../key/wrap';
import { useSecondMethodPrompt } from './second-method';
import { UnlockForm } from './UnlockForm';

const device = vi.hoisted(() => ({ store: null as KeyStore | null, opened: null as ((key: OrgKey) => void) | null, preparing: null as Promise<void> | null }));
vi.mock('../../key/org-key', async (original) => ({ ...(await original<typeof import('../../key/org-key')>()), idbKeyStore: () => device.store! }));
// The method's work (seconds of Argon2id, or a passkey prompt) is held open until the test ends it; a new method's
// wrapping key comes without one.
vi.mock('../../key/unlock', async (original) => ({
  ...(await original<typeof import('../../key/unlock')>()),
  unlockOrgKey: () => new Promise<OrgKey>((resolve) => (device.opened = resolve)),
  prepareMethod: async () => {
    await device.preparing;
    return { method: 'passphrase', credential: null, kdf: { name: 'test' }, wrapping: await importWrappingKey(new Uint8Array(32)) };
  },
}));

let hub: OrgKeysDouble;
beforeEach(() => {
  device.store = memoryKeyStore();
  device.opened = null;
  device.preparing = null;
  hub = new OrgKeysDouble();
  vi.stubGlobal('fetch', hub.fetch(ME.member));
  useKeyHolder.setState({ state: 'locked', key: null, kept: null, fingerprint: null, forgetError: null });
  useSecondMethodPrompt.setState({ due: false });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const withQueries = (children: ReactNode) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;
const PASSPHRASE = 'correct horse battery staple';

/** The org's key set up by another browser: a passphrase copy at the double. */
async function setUpElsewhere() {
  const { setUpOrgKey } = await vi.importActual<typeof import('../../key/unlock')>('../../key/unlock');
  await setUpOrgKey('elsewhere', { method: 'passphrase', credential: null, kdf: { name: 'test' }, wrapping: await importWrappingKey(new Uint8Array(32)) }, 'elsewhere', () => true);
}

async function startPassphraseUnlock(keep: boolean) {
  if (keep) fireEvent.click(await screen.findByLabelText(/Keep unlocked on this device/));
  fireEvent.change(await screen.findByLabelText(/passphrase/), { target: { value: PASSPHRASE } });
  fireEvent.submit(screen.getByRole('form', { name: 'Passphrase' }));
  await vi.waitFor(() => expect(device.opened).not.toBeNull());
}

describe('UnlockForm', () => {
  it('an unlock that ends after Lock, its form still open, leaves the browser locked and the device empty', async () => {
    await setUpElsewhere();
    render(withQueries(<UnlockForm me={ME} />));
    await startPassphraseUnlock(true);
    await act(() => lock(ME.org.id));
    await act(async () => device.opened!(await holdKeyBytes(Uint8Array.from(VECTOR_KEY))));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(useKeyHolder.getState()).toMatchObject({ state: 'locked', key: null });
    expect(await device.store!.load(ME.org.id)).toBeNull();
  });

  it('an unlock that ends after its form is gone and Lock was pressed leaves the browser locked', async () => {
    await setUpElsewhere();
    const { unmount } = render(withQueries(<UnlockForm me={ME} />));
    await startPassphraseUnlock(true);
    unmount();
    await lock(ME.org.id);
    device.opened!(await holdKeyBytes(Uint8Array.from(VECTOR_KEY)));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(useKeyHolder.getState()).toMatchObject({ state: 'locked', key: null });
    expect(await device.store!.load(ME.org.id)).toBeNull();
  });

  it('with no Lock meanwhile, the unlock holds the opened key', async () => {
    await setUpElsewhere();
    render(withQueries(<UnlockForm me={ME} />));
    await startPassphraseUnlock(false);
    const opened = await holdKeyBytes(Uint8Array.from(VECTOR_KEY));
    await act(async () => device.opened!(opened));
    await vi.waitFor(() => expect(useKeyHolder.getState()).toMatchObject({ state: 'unlocked', key: opened }));
  });

  it('freezes where the key is kept while an unlock runs: the choice made when it began is the one kept', async () => {
    await setUpElsewhere();
    render(withQueries(<UnlockForm me={ME} />));
    await startPassphraseUnlock(true);
    const keep = screen.getByLabelText(/Keep unlocked on this device/) as HTMLInputElement;
    expect(keep.disabled).toBe(true);
    await act(async () => device.opened!(await holdKeyBytes(Uint8Array.from(VECTOR_KEY))));
    await vi.waitFor(() => expect(useKeyHolder.getState()).toMatchObject({ state: 'unlocked', kept: 'device' }));
    expect(await device.store!.load(ME.org.id)).not.toBeNull();
  });

  it('starts with "Keep unlocked on this device" ticked in the installed app, and unticked in a browser tab', async () => {
    await setUpElsewhere();
    const tab = render(withQueries(<UnlockForm me={ME} />));
    expect(((await screen.findByLabelText(/Keep unlocked on this device/)) as HTMLInputElement).checked).toBe(false);
    tab.unmount();
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(display-mode: standalone)', addEventListener() {}, removeEventListener() {} }));
    render(withQueries(<UnlockForm me={ME} />));
    expect(((await screen.findByLabelText(/Keep unlocked on this device/)) as HTMLInputElement).checked).toBe(true);
  });

  it('freezes where the key is kept while a first setup runs', async () => {
    let release!: () => void;
    device.preparing = new Promise<void>((resolve) => (release = resolve));
    render(withQueries(<UnlockForm me={ME} />));
    const keep = (await screen.findByLabelText(/Keep unlocked on this device/)) as HTMLInputElement;
    fireEvent.click(keep);
    fireEvent.change(await screen.findByLabelText(/Or a passphrase/), { target: { value: PASSPHRASE } });
    fireEvent.change(screen.getByLabelText(/The passphrase again/), { target: { value: PASSPHRASE } });
    fireEvent.submit(screen.getByRole('form', { name: 'New passphrase' }));
    await vi.waitFor(() => expect(keep.disabled).toBe(true));
    await act(async () => release());
    await vi.waitFor(() => expect(useKeyHolder.getState()).toMatchObject({ state: 'unlocked', kept: 'device' }));
    expect(keep.disabled).toBe(false);
  });

  it("sets up an org with no key, and prompts for a second method", async () => {
    render(withQueries(<UnlockForm me={ME} />));
    fireEvent.change(await screen.findByLabelText(/Or a passphrase/), { target: { value: PASSPHRASE } });
    fireEvent.change(screen.getByLabelText(/The passphrase again/), { target: { value: PASSPHRASE } });
    fireEvent.submit(screen.getByRole('form', { name: 'New passphrase' }));
    await vi.waitFor(() => expect(useKeyHolder.getState().state).toBe('unlocked'));
    expect(hub.keys).toHaveLength(1);
    expect(useSecondMethodPrompt.getState().due).toBe(true);
  });

  it('refuses a setup typed differently twice', async () => {
    render(withQueries(<UnlockForm me={ME} />));
    fireEvent.change(await screen.findByLabelText(/Or a passphrase/), { target: { value: PASSPHRASE } });
    fireEvent.change(screen.getByLabelText(/The passphrase again/), { target: { value: `${PASSPHRASE}!` } });
    fireEvent.submit(screen.getByRole('form', { name: 'New passphrase' }));
    expect((await screen.findByRole('alert')).textContent).toBe('The two passphrases differ.');
    expect(hub.keys).toHaveLength(0);
  });

  it('a setup another browser beat is told so, and the form turns to unlocking', async () => {
    render(withQueries(<UnlockForm me={ME} />));
    await screen.findByTestId('set-up');
    await setUpElsewhere(); // after this form read the org's methods
    fireEvent.change(screen.getByLabelText(/Or a passphrase/), { target: { value: PASSPHRASE } });
    fireEvent.change(screen.getByLabelText(/The passphrase again/), { target: { value: PASSPHRASE } });
    fireEvent.submit(screen.getByRole('form', { name: 'New passphrase' }));
    expect((await screen.findByTestId('key-error')).textContent).toBe('A key was already set up for this org elsewhere. Unlock with one of its methods.');
    await screen.findByRole('form', { name: 'Passphrase' });
    expect(useKeyHolder.getState().state).toBe('locked');
    expect(hub.keys).toHaveLength(1);
  });
});
