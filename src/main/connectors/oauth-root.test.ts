// P3-HD M3c2: the production composition of MAWS's own OAuth (./oauth-root.ts; docs/doperpowers/plans/2026-10-17-p3-hd-
// direct-route.md, M3 and Decision Log 14, 20, 25 and 28). The E2E custody guard stands before every real safeStorage
// operation: under MAWS_E2E, the mock keychain switch and the scratch profile under the OS temporary directory are
// proven at each call, or the sealer is unavailable without asking safeStorage. Outside E2E it is the real sealer.
// The root itself is lazy (nothing touches safeStorage until a demand) and opens the browser through the one
// scheme-checked `openExternalUrl`. Electron is doubled; no real crypto, keychain or browser is reached.
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientPort } from '@shared/client/port';
import type { ConnectorOAuthSealer } from './oauth-store';

const electron = vi.hoisted(() => ({
  userData: '',
  safeStorage: { isAsyncEncryptionAvailable: vi.fn(async () => true), encryptStringAsync: vi.fn(async (text: string) => Buffer.from(text)), decryptStringAsync: vi.fn(async (sealed: Buffer) => ({ result: sealed.toString(), shouldReEncrypt: false })) },
  hasSwitch: vi.fn(() => true),
}));
vi.mock('electron', () => ({
  app: { getPath: () => electron.userData, whenReady: async () => {}, commandLine: { hasSwitch: electron.hasSwitch } },
  safeStorage: electron.safeStorage,
}));

const { guardE2ECustody, openOwnerBrowser, productionConnectorOAuth } = await import('./oauth-root');

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'maws-oauth-root-'));
  electron.hasSwitch.mockReturnValue(true);
  for (const fn of Object.values(electron.safeStorage)) fn.mockClear();
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

function spySealer() {
  const calls: string[] = [];
  const sealer: ConnectorOAuthSealer = {
    available: async () => (calls.push('available'), true),
    seal: async (text) => (calls.push('seal'), Buffer.from(text)),
    open: async (sealed) => (calls.push('open'), { text: sealed.toString(), reseal: false }),
  };
  return { sealer, calls };
}
const facts = (over: Partial<Parameters<typeof guardE2ECustody>[1]> = {}): Parameters<typeof guardE2ECustody>[1] => ({
  e2e: true, mockKeychain: () => true, userData: () => join(root, 'profile'), scratch: () => join(root, 'profile'), tmp: () => tmpdir(), ...over,
});

describe('the E2E custody guard', () => {
  beforeEach(() => mkdirSync(join(root, 'profile')));

  it('outside E2E is the real sealer itself', () => {
    const { sealer } = spySealer();
    expect(guardE2ECustody(sealer, facts({ e2e: false }))).toBe(sealer);
  });

  it('passes through on the mock keychain with the scratch profile, compared canonically', async () => {
    symlinkSync(join(root, 'profile'), join(root, 'link'));
    const { sealer, calls } = spySealer();
    const guarded = guardE2ECustody(sealer, facts({ scratch: () => join(root, 'link') }));
    expect(await guarded.available()).toBe(true);
    expect((await guarded.open(await guarded.seal('x'))).text).toBe('x');
    expect(calls).toEqual(['available', 'seal', 'open']);
  });

  it.each([
    ['the mock keychain switch is absent', { mockKeychain: () => false }],
    ['no scratch profile was named', { scratch: () => undefined }],
    ['the profile is not the scratch one', { scratch: () => root }],
    ['the profile is outside the OS temporary directory', { tmp: () => join(root, 'profile', 'elsewhere') }],
    ['the profile cannot be resolved', { userData: () => join(root, 'missing'), scratch: () => join(root, 'missing') }],
  ])('fails closed, never reaching safeStorage, when %s', async (_why, over) => {
    const { sealer, calls } = spySealer();
    const guarded = guardE2ECustody(sealer, facts(over));
    expect(await guarded.available()).toBe(false);
    await expect(guarded.seal('x')).rejects.toThrow();
    await expect(guarded.open(Buffer.from('x'))).rejects.toThrow();
    expect(calls).toEqual([]);
  });

  it('proves custody at every call, not once', async () => {
    let mock = true;
    const { sealer, calls } = spySealer();
    const guarded = guardE2ECustody(sealer, facts({ mockKeychain: () => mock }));
    expect(await guarded.available()).toBe(true);
    mock = false;
    await expect(guarded.open(Buffer.from('x'))).rejects.toThrow();
    expect(calls).toEqual(['available']);
  });
});

describe('the production root', () => {
  it('composes lazily: a provider whose listing of an empty store touches no safeStorage', async () => {
    electron.userData = join(root, 'userData');
    const provider = productionConnectorOAuth({ closeHost: async () => true, log: () => {}, port: { openExternal: vi.fn() } });
    expect(await provider.saved()).toEqual([]);
    for (const fn of Object.values(electron.safeStorage)) expect(fn).not.toHaveBeenCalled();
    provider.stop();
  });

  it('under MAWS_E2E with a non-scratch profile, the real safeStorage is never asked', async () => {
    vi.stubEnv('MAWS_E2E', '1');
    vi.stubEnv('MAWS_USER_DATA', join(root, 'other'));
    electron.userData = join(root, 'userData');
    mkdirSync(join(electron.userData, 'connectors', 'oauth'), { recursive: true });
    const { writeFileSync } = await import('node:fs');
    writeFileSync(join(electron.userData, 'connectors', 'oauth', '33333333-3333-4333-8333-333333333333.sealed'), 'maws-connector-oauth/1\nAAAA\n');
    const provider = productionConnectorOAuth({ closeHost: async () => true, log: () => {}, port: { openExternal: vi.fn() } });
    expect(await provider.saved()).toEqual([{ state: 'unreadable', connectionId: '33333333-3333-4333-8333-333333333333' }]); // ids only: forgettable
    for (const fn of Object.values(electron.safeStorage)) expect(fn).not.toHaveBeenCalled();
    provider.stop();
  });

  it('opens the owner’s browser through the client port, and fails with its reason when the port did not open it', async () => {
    const openExternal = vi.fn<ClientPort['openExternal']>(async () => ({ opened: true }));
    const asker = { id: 'page:1.1', onGone: () => () => {} } as never;
    await openOwnerBrowser({ openExternal }, 'http://127.0.0.1:4000/authorize?state=s', asker);
    expect(openExternal).toHaveBeenCalledExactlyOnceWith(asker, { url: 'http://127.0.0.1:4000/authorize?state=s' });
    openExternal.mockResolvedValueOnce({ opened: false, reason: 'only http, https and mailto links open outside MAWS' });
    await expect(openOwnerBrowser({ openExternal }, 'file:///etc/passwd', asker)).rejects.toThrow('the authorization URL was not opened: only http, https and mailto links open outside MAWS');
  });
});
