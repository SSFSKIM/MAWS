// P3-HD M3c2: the production composition of MAWS's own OAuth (./root.ts; docs/doperpowers/plans/2026-10-17-p3-hd-
// direct-route.md, M3 and Decision Log 14, 20, 25 and 28). P5 O4 M2 (docs/doperpowers/plans/2026-10-31-p5-o4-
// services.md, Interfaces §A and §F; D20, D21): over the machine's key file, the directory and the loopback listener
// the spine gives it, with no Electron; the MAWS_E2E custody guard went with Electron's sealer to main's legacy reader
// (src/main/connectors/legacy-custody.test.ts). The root is lazy and opens the browser through the client port.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NO_CLIENT, NO_CLIENT_REASON, type ClientPort } from '@shared/client/port';
import { SEALED_FORMAT_V1 } from '@shared/connectors/sealer';
import { CUSTODY_KEY_FILE, fileKeyCustody } from './custody';
import { openOwnerBrowser, productionConnectorOAuth } from './root';

let root: string;
let directory: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'maws-oauth-root-'));
  directory = join(root, 'connectors', 'oauth');
});
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

const compose = (listen = vi.fn()) => productionConnectorOAuth({
  closeHost: async () => true,
  log: () => {},
  port: { openExternal: vi.fn() },
  custody: fileKeyCustody(directory, { excludeFromBackup: async () => true }),
  directory,
  listen,
});

describe('the production root', () => {
  it('composes lazily: listing an empty store makes no key, no directory and no listener', async () => {
    const listen = vi.fn();
    const provider = compose(listen);
    expect(await provider.saved()).toEqual([]);
    expect(existsSync(directory)).toBe(false);
    expect(listen).not.toHaveBeenCalled();
    provider.stop();
  });

  it("lists a profile's format 1 records as forgettable unreadable rows, without making a key", async () => {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    writeFileSync(join(directory, '33333333-3333-4333-8333-333333333333.sealed'), `${SEALED_FORMAT_V1}\nAAAA\n`, { mode: 0o600 });
    const provider = compose();
    expect(await provider.saved()).toEqual([{ state: 'unreadable', connectionId: '33333333-3333-4333-8333-333333333333' }]); // ids only
    expect(readdirSync(directory)).not.toContain(CUSTODY_KEY_FILE);
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

  it('fails as not opened when no client can take the hand-off', async () => {
    const openExternal = vi.fn<ClientPort['openExternal']>(async () => NO_CLIENT);
    await expect(openOwnerBrowser({ openExternal }, 'https://auth.example.com/authorize', null)).rejects.toThrow(`the authorization URL was not opened: ${NO_CLIENT_REASON}`);
  });
});
