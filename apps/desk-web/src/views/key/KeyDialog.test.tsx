// @vitest-environment happy-dom
// The key dialog. Lock: the tab drops the key at once, and when the device fails to forget the key it kept, the dialog
// says so in whatever state it is in and offers a retry that really removes it. Unlocked: the org key's methods, a
// prompt while there is only one, a method added (confirmed with one the org has) and removed, and a browser holding
// another key told so — by the fingerprints, and by the hub's `not-key-holder` on a change. At a cheap Argon2id cost.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OrgKeysDouble } from '../../../test/double/org-keys';
import { ME } from '../../../test/me';
import { VECTOR_KEY } from '../../../test/vectors';
import { wrappingKeyFromPassphrase } from '../../key/derive';
import { beginUnlock, lock, unlock, useKeyHolder } from '../../key/holder';
import { memoryKeyStore, type KeyStore } from '../../key/org-key';
import { prepareMethod, setUpOrgKey } from '../../key/unlock';
import { KeyDialog } from './KeyDialog';

const device = vi.hoisted(() => ({ store: null as KeyStore | null, opening: null as { started: () => void; gate: Promise<void> } | null, adding: null as Promise<unknown> | null }));
vi.mock('../../key/org-key', async (original) => ({ ...(await original<typeof import('../../key/org-key')>()), idbKeyStore: () => device.store! }));
// The dialog's latest add attempt, to await its end: what it settles to is what it did.
vi.mock('../../key/unlock', async (original) => {
  const actual = await original<typeof import('../../key/unlock')>();
  return { ...actual, addMethod: (...args: Parameters<typeof actual.addMethod>) => (device.adding = actual.addMethod(...args)) };
});
// The key's bytes, opened for a new copy, can be held at the moment they open (the confirmation still running).
vi.mock('../../key/wrap', async (original) => {
  const actual = await original<typeof import('../../key/wrap')>();
  return {
    ...actual,
    unwrapKeyBytes: async (...args: Parameters<typeof actual.unwrapKeyBytes>) => {
      const raw = await actual.unwrapKeyBytes(...args);
      if (device.opening) {
        device.opening.started();
        await device.opening.gate;
      }
      return raw;
    },
  };
});
vi.mock('../../key/derive', async (original) => ({ ...(await original<typeof import('../../key/derive')>()), PASSPHRASE_COST: { t: 1, m: 64, p: 1 } }));

let hub: OrgKeysDouble;
beforeEach(() => {
  device.store = memoryKeyStore();
  device.opening = null;
  device.adding = null;
  hub = new OrgKeysDouble();
  vi.stubGlobal('fetch', hub.fetch(ME.member));
  useKeyHolder.setState({ state: 'loading', key: null, kept: null, fingerprint: null, forgetError: null });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const withQueries = (children: ReactNode) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;
const FIRST = 'correct horse battery staple';
const SECOND = 'tr0ub4dor and three more words';

/** First setup with a passphrase, the key held for this tab. */
async function setUp() {
  const held = await setUpOrgKey(ME.org.id, await prepareMethod(ME.org.id, { kind: 'passphrase', passphrase: FIRST }), 'First passphrase', () => true);
  await beginUnlock(ME.org.id).finish(held, 'session');
}

describe('KeyDialog', () => {
  it('reports a key the device failed to forget, while locked, and its retry forgets it', async () => {
    const inner = memoryKeyStore();
    let failing = true;
    device.store = { ...inner, forget: (org) => (failing ? Promise.reject(new Error('IndexedDB is unavailable')) : inner.forget(org)) };
    await unlock(ME.org.id, Uint8Array.from(VECTOR_KEY), 'device');
    render(withQueries(<KeyDialog me={ME} onClose={() => {}} />));

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

  it("prompts for a second method while there is one; one added, confirmed with the org's, ends the prompt", async () => {
    await setUp();
    render(withQueries(<KeyDialog me={ME} onClose={() => {}} />));
    await screen.findByTestId('one-method');
    expect(screen.queryByRole('button', { name: /Remove/ })).toBeNull(); // the only method is never removed

    fireEvent.click(screen.getByRole('button', { name: 'Add a method' }));
    const add = screen.getByTestId('add-method');
    fireEvent.change(within(add).getByLabelText(/Or a passphrase/), { target: { value: SECOND } });
    fireEvent.change(within(add).getByLabelText(/The passphrase again/), { target: { value: SECOND } });
    fireEvent.submit(within(add).getByRole('form', { name: 'New passphrase' }));
    // Then a method the org has.
    fireEvent.change(await within(add).findByLabelText(/passphrase/), { target: { value: FIRST } });
    fireEvent.submit(within(add).getByRole('form', { name: 'Passphrase' }));

    await waitFor(() => expect(screen.queryByTestId('add-method')).toBeNull());
    await waitFor(() => expect(screen.queryByTestId('one-method')).toBeNull());
    expect(hub.keys.map((k) => k.method)).toEqual(['passphrase', 'passphrase']);
    expect(screen.getAllByRole('button', { name: /^Remove / })).toHaveLength(2);
  });

  it('a Lock while the confirmation opens the key stops the copy from going out', async () => {
    await setUp();
    render(withQueries(<KeyDialog me={ME} onClose={() => {}} />));
    fireEvent.click(await screen.findByRole('button', { name: 'Add a method' }));
    const add = screen.getByTestId('add-method');
    fireEvent.change(within(add).getByLabelText(/Or a passphrase/), { target: { value: SECOND } });
    fireEvent.change(within(add).getByLabelText(/The passphrase again/), { target: { value: SECOND } });
    fireEvent.submit(within(add).getByRole('form', { name: 'New passphrase' }));
    const confirm = await within(add).findByRole('form', { name: 'Passphrase' });

    let release!: () => void;
    const opened = new Promise<void>((started) => (device.opening = { started, gate: new Promise<void>((resolve) => (release = resolve)) }));
    fireEvent.change(within(confirm).getByLabelText(/passphrase/), { target: { value: FIRST } });
    fireEvent.submit(confirm);
    await opened;
    await act(() => lock(ME.org.id));
    await act(async () => release());
    // The attempt ends refused for the Lock, before anything is posted.
    await expect(device.adding).rejects.toMatchObject({ reason: 'locked' });
    expect(useKeyHolder.getState().state).toBe('locked');
    expect(hub.keys).toHaveLength(1);
  });

  it('says a wrong confirmation is wrong, and adds nothing', async () => {
    await setUp();
    render(withQueries(<KeyDialog me={ME} onClose={() => {}} />));
    fireEvent.click(await screen.findByRole('button', { name: 'Add a method' }));
    const add = screen.getByTestId('add-method');
    fireEvent.change(within(add).getByLabelText(/Or a passphrase/), { target: { value: SECOND } });
    fireEvent.change(within(add).getByLabelText(/The passphrase again/), { target: { value: SECOND } });
    fireEvent.submit(within(add).getByRole('form', { name: 'New passphrase' }));
    fireEvent.change(await within(add).findByLabelText(/passphrase/), { target: { value: SECOND } });
    fireEvent.submit(within(add).getByRole('form', { name: 'Passphrase' }));
    expect((await within(add).findByTestId('key-error')).textContent).toBe("That passphrase doesn't open the org key.");
    expect(hub.keys).toHaveLength(1);
  });

  it("tells a browser holding another key so, and the hub's refusal of its removal", async () => {
    await setUp();
    const { addMethod } = await import('../../key/unlock');
    await addMethod(ME.org.id, hub.list(), await prepareMethod(ME.org.id, { kind: 'passphrase', passphrase: SECOND }), 'Second passphrase', { kind: 'passphrase', passphrase: FIRST }, useKeyHolder.getState().key!, () => true);
    await unlock(ME.org.id, crypto.getRandomValues(new Uint8Array(32)), 'session'); // another key, held here
    render(withQueries(<KeyDialog me={ME} onClose={() => {}} />));

    expect((await screen.findByTestId('other-key')).textContent).toContain("This browser holds another key than the org's");
    fireEvent.click(screen.getByRole('button', { name: 'Remove Second passphrase' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect((await screen.findByTestId('key-error')).textContent).toBe("This browser's key isn't the org's, so the hub refused the change. Lock it, and unlock with one of the org's methods.");
    expect(hub.keys).toHaveLength(2);
  });

  it("removes a method with the held key's proof", async () => {
    await setUp();
    const { addMethod } = await import('../../key/unlock');
    await addMethod(ME.org.id, hub.list(), await prepareMethod(ME.org.id, { kind: 'passphrase', passphrase: SECOND }), 'Second passphrase', { kind: 'passphrase', passphrase: FIRST }, useKeyHolder.getState().key!, () => true);
    render(withQueries(<KeyDialog me={ME} onClose={() => {}} />));
    fireEvent.click(await screen.findByRole('button', { name: 'Remove First passphrase' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(hub.keys.map((k) => k.label)).toEqual(['Second passphrase']));
    await screen.findByTestId('one-method');
  });

  it('shows the passphrase work of a derivation made while it is open, without being opened again', async () => {
    await setUp();
    render(withQueries(<KeyDialog me={ME} onClose={() => {}} />));
    expect((await screen.findByTestId('passphrase-work')).textContent).toContain('0 MiB'); // setUp's, at the suite's cost
    // A passphrase method being added derives anew, here at another cost, while nothing the dialog reads changes.
    await act(() => wrappingKeyFromPassphrase(SECOND, ME.org.id, { t: 1, m: 2048, p: 1 }));
    expect(screen.getByTestId('passphrase-work').textContent).toContain('2 MiB');
  });
});
