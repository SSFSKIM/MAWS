// P3-HD M3a: the sealed OAuth store (src/main/connectors/oauth-store.ts). Scratch directories and an injected sealer
// stand in for userData and Electron's safeStorage; no keychain is touched. A second store over the same directory is
// the relaunch.
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createConnectorOAuthStore, electronOAuthSealer, type ConnectorOAuthSealer } from './oauth-store';
import type { ConnectorOAuthGrant, ConnectorOAuthIdentity } from './oauth-types';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const ACCESS = 'at-secret-5a1e';
const REFRESH = 'rt-secret-77c0';
const CLIENT_SECRET = 'cs-secret-91d2';

const identity = (patch: Partial<ConnectorOAuthIdentity> = {}): ConnectorOAuthIdentity => ({
  requestUrl: 'https://mcp.example.com/mcp?tenant=7', server: 'metrics', scope: 'user', configPath: '/home/o/.claude.json', entryPath: ['mcpServers', 'metrics'], ...patch,
});
const grant = (patch: Partial<ConnectorOAuthGrant> = {}): ConnectorOAuthGrant => ({
  issuer: 'https://auth.example.com',
  resource: 'https://mcp.example.com',
  redirectUri: 'http://127.0.0.1:53100/callback',
  authorizationServer: {
    issuer: 'https://auth.example.com', authorization_endpoint: 'https://auth.example.com/authorize', token_endpoint: 'https://auth.example.com/token',
    registration_endpoint: 'https://auth.example.com/register', revocation_endpoint: 'https://auth.example.com/revoke', response_types_supported: ['code'],
    code_challenge_methods_supported: ['S256'], grant_types_supported: ['authorization_code', 'refresh_token'], token_endpoint_auth_methods_supported: ['none'],
  },
  client: { client_id: 'client-1', client_secret: CLIENT_SECRET, client_secret_expires_at: 0, redirect_uris: ['http://127.0.0.1:53100/callback'], token_endpoint_auth_method: 'none' },
  tokens: { accessToken: ACCESS, refreshToken: REFRESH, tokenType: 'Bearer', grantedScope: 'metrics:read', expiresAt: 1_700_000_060_000, obtainedAt: 1_700_000_000_000 },
  ...patch,
});

// A reversible stand-in for safeStorage: the bytes on disk are not the plaintext. `gate` holds the next seal until released.
class FakeSealer implements ConnectorOAuthSealer {
  isAvailable = true;
  failOpen = false;
  reseal = false;
  seals = 0;
  opens = 0;
  private held: Promise<void>[] = [];
  holdNextSeal(): () => void {
    let release!: () => void;
    this.held.push(new Promise<void>((resolve) => { release = resolve; }));
    return release;
  }
  async available() { return this.isAvailable; }
  async seal(text: string) {
    this.seals += 1;
    const gate = this.held.shift();
    if (gate) await gate;
    if (!this.isAvailable) throw new Error('keychain denied');
    return Buffer.from(Buffer.from(text, 'utf8').map((byte) => byte ^ 0x5a));
  }
  async open(sealed: Buffer) {
    this.opens += 1;
    if (this.failOpen) throw new Error('decrypt failed');
    return { text: Buffer.from(sealed.map((byte) => byte ^ 0x5a)).toString('utf8'), reseal: this.reseal };
  }
}

let root: string;
let dir: string;
let sealer: FakeSealer;
const store = () => createConnectorOAuthStore({ directory: dir, sealer, now: () => 1_700_000_100_000 });
const mode = (path: string) => statSync(path).mode & 0o777;
const sealedFiles = () => readdirSync(dir).filter((name) => name.endsWith('.sealed'));

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'maws-oauth-store-'));
  dir = join(root, 'connectors', 'oauth');
  sealer = new FakeSealer();
});
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

describe('ConnectorOAuthStore', () => {
  it.each(['user', 'app'] as const)('a saved %s grant reads back whole after a relaunch, sealed on disk, owner-only', async (scope) => {
    const origin = identity(scope === 'app' ? { scope, configPath: '/app/settings.json', entryPath: ['engine', 'mcpServers', 'name=metrics'] } : {});
    const first = store();
    const saved = await first.save(first.claim(A), origin, grant());
    expect(saved).toMatchObject({ connectionId: A, savedAt: 1_700_000_100_000 });

    const relaunched = store();
    expect(await relaunched.read(A)).toEqual({ ...grant(), connectionId: A, identity: origin, savedAt: 1_700_000_100_000 });
    expect(sealedFiles()).toEqual([`${A}.sealed`]);
    const onDisk = readFileSync(join(dir, `${A}.sealed`), 'utf8');
    for (const secret of [ACCESS, REFRESH, CLIENT_SECRET, 'tenant=7', '.claude.json']) expect(onDisk).not.toContain(secret);
    expect(mode(dir)).toBe(0o700);
    expect(mode(join(dir, `${A}.sealed`))).toBe(0o600);
  });

  it('tightens a wider existing directory before writing into it', async () => {
    mkdirSync(dir, { recursive: true });
    chmodSync(dir, 0o755);
    const s = store();
    await s.save(s.claim(A), identity(), grant());
    expect(mode(dir)).toBe(0o700);
  });

  it('lists saved identities without any secret, and keeps exact identities apart', async () => {
    const s = store();
    await s.save(s.claim(A), identity(), grant());
    await s.save(s.claim(B), identity({ requestUrl: 'https://mcp.example.com/mcp?tenant=7/' }), grant({ tokens: { accessToken: 'x', tokenType: 'Bearer', obtainedAt: 1 } }));
    const listed = await store().list();
    expect(listed).toHaveLength(2);
    expect(listed).toContainEqual({ state: 'sealed', connectionId: A, identity: identity(), issuer: 'https://auth.example.com', resource: 'https://mcp.example.com', savedAt: 1_700_000_100_000, expiresAt: 1_700_000_060_000, refreshable: true });
    expect(listed).toContainEqual(expect.objectContaining({ connectionId: B, refreshable: false, identity: identity({ requestUrl: 'https://mcp.example.com/mcp?tenant=7/' }) }));
    for (const secret of [ACCESS, REFRESH, CLIENT_SECRET]) expect(JSON.stringify(listed)).not.toContain(secret);
  });

  it('an empty store lists nothing without touching safeStorage', async () => {
    const opened = vi.spyOn(sealer, 'available');
    expect(await store().list()).toEqual([]);
    expect(await store().read(A)).toBeNull();
    expect(opened).not.toHaveBeenCalled();
  });

  it('fails closed when safeStorage is unavailable: no save, no read, never plaintext', async () => {
    sealer.isAvailable = false;
    const s = store();
    await expect(s.save(s.claim(A), identity(), grant())).rejects.toMatchObject({ code: 'unavailable' });
    expect(() => readdirSync(dir)).toThrow(); // nothing was created
    sealer.isAvailable = true;
    await s.save(s.claim(A), identity(), grant());
    sealer.isAvailable = false;
    await expect(store().list()).rejects.toMatchObject({ code: 'unavailable' });
    await expect(store().read(A)).rejects.toMatchObject({ code: 'unavailable' });
  });

  it('a record that does not decrypt or does not validate is unreadable, listed by id and still removable', async () => {
    const s = store();
    await s.save(s.claim(A), identity(), grant());
    sealer.failOpen = true;
    await expect(store().read(A)).rejects.toMatchObject({ code: 'unreadable' });
    expect(await store().list()).toEqual([{ state: 'unreadable', connectionId: A }]);
    expect(await store().remove(A)).toBe(true);
    expect(sealedFiles()).toEqual([]);

    sealer.failOpen = false;
    mkdirSync(dir, { recursive: true });
    const forged = Buffer.from(Buffer.from(JSON.stringify({ version: 1, connectionId: B, identity: identity() }), 'utf8').map((byte) => byte ^ 0x5a));
    writeFileSync(join(dir, `${B}.sealed`), `maws-connector-oauth/1\n${forged.toString('base64')}\n`, { mode: 0o600 });
    await expect(store().read(B)).rejects.toMatchObject({ code: 'unreadable' });
  });

  // P3-HD M3c1: the opaque inventory, for forgetting a record while safeStorage is unavailable
  it('inventories saved connection ids from the file names alone, without the sealer, and each is removable', async () => {
    const s = store();
    await s.save(s.claim(A), identity(), grant());
    await s.save(s.claim(B), identity({ server: 'other' }), grant());
    writeFileSync(join(dir, 'not-a-uuid.sealed'), 'x');
    writeFileSync(join(dir, `${A}.sealed.tmp`), 'x');
    sealer.isAvailable = false;
    const touched = [vi.spyOn(sealer, 'available'), vi.spyOn(sealer, 'open'), vi.spyOn(sealer, 'seal')];
    const relaunched = store();
    expect((await relaunched.ids()).sort()).toEqual([A, B]);
    expect(await relaunched.remove(A)).toBe(true);
    expect(await relaunched.ids()).toEqual([B]);
    for (const spy of touched) expect(spy).not.toHaveBeenCalled();
    expect(await store().ids()).toEqual([B]);
    rmSync(dir, { recursive: true, force: true });
    expect(await store().ids()).toEqual([]);
  });

  it('a record whose sealed id differs from its file name is unreadable', async () => {
    const s = store();
    await s.save(s.claim(A), identity(), grant());
    const text = readFileSync(join(dir, `${A}.sealed`));
    writeFileSync(join(dir, `${B}.sealed`), text, { mode: 0o600 });
    await expect(store().read(B)).rejects.toMatchObject({ code: 'unreadable' });
  });

  it('an over-long file is unreadable without being decrypted', async () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${A}.sealed`), `maws-connector-oauth/1\n${'A'.repeat(1_100_000)}\n`, { mode: 0o600 });
    await expect(store().read(A)).rejects.toMatchObject({ code: 'unreadable' });
    expect(sealer.opens).toBe(0);
  });

  it('a save still encrypting when its connection is removed never lands (no resurrection)', async () => {
    const s = store();
    const claim = s.claim(A);
    const release = sealer.holdNextSeal();
    const late = s.save(claim, identity(), grant());
    const removed = s.remove(A); // Disconnect while the save waits on safeStorage
    release();
    await expect(late).rejects.toMatchObject({ code: 'stale' });
    expect(await removed).toBe(false);
    expect(sealedFiles()).toEqual([]);
    expect(await store().read(A)).toBeNull();
  });

  it('a late rotation save after removal of the saved grant does not restore it', async () => {
    const s = store();
    await s.save(s.claim(A), identity(), grant());
    const refreshClaim = s.claim(A);
    const release = sealer.holdNextSeal();
    const rotation = s.save(refreshClaim, identity(), grant({ tokens: { accessToken: 'at-2', refreshToken: 'rt-2', tokenType: 'Bearer', obtainedAt: 2 } }));
    expect(await s.remove(A)).toBe(true);
    release();
    await expect(rotation).rejects.toMatchObject({ code: 'stale' });
    expect(await store().read(A)).toBeNull();
  });

  it('an encryption wait for one connection does not hold back removing another', async () => {
    const s = store();
    await s.save(s.claim(B), identity({ server: 'other' }), grant());
    const release = sealer.holdNextSeal();
    const pending = s.save(s.claim(A), identity(), grant());
    expect(await s.remove(B)).toBe(true); // resolves while A's seal is still held
    release();
    await pending;
    expect(sealedFiles()).toEqual([`${A}.sealed`]);
  });

  it('a fresh claim after removal saves normally; concurrent saves of different connections both land', async () => {
    const s = store();
    await s.save(s.claim(A), identity(), grant());
    await s.remove(A);
    await Promise.all([s.save(s.claim(A), identity(), grant()), s.save(s.claim(B), identity({ server: 'b' }), grant())]);
    expect(sealedFiles().sort()).toEqual([`${A}.sealed`, `${B}.sealed`]);
  });

  it('a key-rotation answer re-encrypts the record in place', async () => {
    const s = store();
    await s.save(s.claim(A), identity(), grant());
    const sealsBefore = sealer.seals;
    sealer.reseal = true;
    expect(await store().read(A)).toMatchObject({ connectionId: A });
    expect(sealer.seals).toBe(sealsBefore + 1);
    sealer.reseal = false;
    expect(await store().read(A)).toMatchObject({ connectionId: A, tokens: { accessToken: ACCESS } });
  });

  it('a re-encryption never overwrites a rotation saved while it was encrypting', async () => {
    const s = store();
    await s.save(s.claim(A), identity(), grant());
    const sealsBefore = sealer.seals;
    sealer.reseal = true;
    const release = sealer.holdNextSeal(); // the read's re-encryption waits on safeStorage
    const reading = s.read(A);
    await vi.waitFor(() => expect(sealer.seals).toBe(sealsBefore + 1));
    sealer.reseal = false;
    const rotation = s.save(s.claim(A), identity(), grant({ tokens: { accessToken: 'at-2', refreshToken: 'rt-2', tokenType: 'Bearer', obtainedAt: 2 } }));
    await rotation; // committed while the re-encryption still waits
    release();
    await reading;
    expect(await store().read(A)).toMatchObject({ tokens: { accessToken: 'at-2', refreshToken: 'rt-2' } });
  });

  it('a record too large to read back is refused before it replaces the saved one', async () => {
    const s = store();
    await s.save(s.claim(A), identity(), grant());
    const huge = grant({ authorizationServer: { ...grant().authorizationServer, padding: 'p'.repeat(900_000) } });
    await expect(s.save(s.claim(A), identity(), huge)).rejects.toMatchObject({ code: 'tooLarge' });
    expect(await store().read(A)).toMatchObject({ tokens: { accessToken: ACCESS } });
  });

  it('a re-encryption that cannot be written fails the read with its closed code', async () => {
    const s = store();
    await s.save(s.claim(A), identity(), grant());
    sealer.reseal = true;
    chmodSync(dir, 0o500); // no temporary file can be created: the commit fails as io, not stale
    try {
      await expect(store().read(A)).rejects.toMatchObject({ code: 'io' });
    } finally {
      chmodSync(dir, 0o700);
    }
  });

  it('bounds the number of saved connections', async () => {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    for (let i = 0; i < 256; i += 1) writeFileSync(join(dir, `${i.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000.sealed`), 'x', { mode: 0o600 });
    const s = store();
    await expect(s.save(s.claim(A), identity(), grant())).rejects.toMatchObject({ code: 'full' });
  });

  it('refuses a malformed connection id rather than naming a path with it', async () => {
    const s = store();
    expect(() => s.claim('../escape')).toThrow();
    await expect(s.read('../escape')).rejects.toThrow();
  });

  it('store errors carry fixed words, never a path or a platform message', async () => {
    sealer.isAvailable = false;
    const s = store();
    const error = await s.save(s.claim(A), identity(), grant()).then(() => { throw new Error('saved'); }, (e: unknown) => e as Error);
    expect(error.message).not.toContain(root);
    expect(error.message).not.toContain('keychain');
  });
});

describe('electronOAuthSealer', () => {
  it('uses only the asynchronous safeStorage API, after app readiness', async () => {
    const order: string[] = [];
    let ready!: () => void;
    const readiness = new Promise<void>((resolve) => { ready = resolve; });
    // only the asynchronous methods exist: a synchronous call would throw
    const safeStorage = {
      isAsyncEncryptionAvailable: async () => { order.push('available'); return true; },
      encryptStringAsync: async (text: string) => { order.push('encrypt'); return Buffer.from(`enc:${text}`); },
      decryptStringAsync: async (data: Buffer) => { order.push('decrypt'); return { result: data.toString().slice(4), shouldReEncrypt: true }; },
    };
    const adapter = electronOAuthSealer(safeStorage, async () => { order.push('wait'); await readiness; order.push('ready'); });
    const availability = adapter.available();
    await Promise.resolve();
    expect(order).toEqual(['wait']);
    ready();
    expect(await availability).toBe(true);
    expect(await adapter.open(await adapter.seal('hello'))).toEqual({ text: 'hello', reseal: true });
    expect(order).toEqual(['wait', 'ready', 'available', 'wait', 'ready', 'encrypt', 'wait', 'ready', 'decrypt']);
  });

  it('a rejected availability check reads as unavailable', async () => {
    const adapter = electronOAuthSealer({
      isAsyncEncryptionAvailable: async () => { throw new Error('no'); },
      encryptStringAsync: async () => Buffer.alloc(0),
      decryptStringAsync: async () => ({ result: '', shouldReEncrypt: false }),
    }, async () => {});
    expect(await adapter.available()).toBe(false);
  });
});
