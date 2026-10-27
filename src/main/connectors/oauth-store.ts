// P3-HD M3a: the sealed store of MAWS's own OAuth grants (docs/doperpowers/plans/2026-10-17-p3-hd-direct-route.md M3,
// Decision Log 13/18; P3 co-work Decision Log 98 (5), its per-connection refinement by the architect, 2026-10-17).
//
// One file per saved connection, `<directory>/<connectionId>.sealed`: a plain format line, then the base64 of
// safeStorage's ciphertext of one version-1 JSON record. The name is the opaque, stable `connectionId`; the identity
// (exact request URL and configured entry) and every token live only inside the ciphertext, since a request URL's query
// can itself be a secret. Deleting a connection is an unlink, so a record that no longer decrypts (a rotated or denied
// key, a damaged file) is still listed by id and can be forgotten.
//
// - Fails closed: without asynchronous safeStorage, nothing is read or written and nothing is ever stored plain. An
//   empty store is answered without touching safeStorage.
// - Late saves cannot resurrect: `claim` takes a connection's generation synchronously; `remove` advances it before
//   any await. A save encrypts outside any lock, then checks its claim and replaces the file atomically under a short
//   lock that holds only file operations, so a slow keychain answer for one connection never delays another's removal.
//   A re-encryption after a key rotation is dropped if any other commit replaced the record meanwhile (a token
//   rotation is never rolled back to the refresh token it consumed).
// - The directory is owner-only (0700, a wider existing mode tightened); files are written 0600 through
//   ../files/atomic-write.ts (exclusive temporary, fsync, rename).
// - Errors are closed codes with fixed words: no path, platform or safeStorage message.
//
// Orchestration (one record per identity, single-flight refresh, credential epochs) is the provider's (M3c).
import { constants } from 'node:fs';
import { chmod, mkdir, open, readdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import * as z from 'zod';
import { OAuthClientInformationFullSchema, OAuthMetadataSchema, OpenIdProviderDiscoveryMetadataSchema } from '@modelcontextprotocol/sdk/shared/auth.js';
import { atomicWriteFile } from '../files/atomic-write';
import type { ConnectorOAuthGrant, ConnectorOAuthIdentity, ConnectorOAuthRecord } from './oauth-types';

export interface ConnectorOAuthSealer {
  available(): Promise<boolean>;
  seal(text: string): Promise<Buffer>;
  open(sealed: Buffer): Promise<{ text: string; reseal: boolean }>;
}

// Electron's safeStorage's asynchronous API, as far as the sealer calls it (a local interface, so this module stays free
// of Electron; O4 replaces the store's custody).
export interface AsyncSafeStorage {
  isAsyncEncryptionAvailable(): Promise<boolean>;
  encryptStringAsync(plainText: string): Promise<Buffer>;
  decryptStringAsync(encrypted: Buffer): Promise<{ result: string; shouldReEncrypt: boolean }>;
}

// Electron's safeStorage through its asynchronous API only, each call after app readiness: the synchronous methods
// can block main's event loop on a keychain prompt.
export function electronOAuthSealer(
  safeStorage: AsyncSafeStorage,
  ready: () => Promise<unknown>,
): ConnectorOAuthSealer {
  return {
    async available() {
      try {
        await ready();
        return await safeStorage.isAsyncEncryptionAvailable();
      } catch {
        return false;
      }
    },
    async seal(text) {
      await ready();
      return safeStorage.encryptStringAsync(text);
    },
    async open(sealed) {
      await ready();
      const { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(sealed);
      return { text: result, reseal: shouldReEncrypt };
    },
  };
}

// `tooLarge`: a record that could not be read back within the file bound is never written.
export type ConnectorOAuthStoreFailure = 'unavailable' | 'unreadable' | 'io' | 'stale' | 'full' | 'tooLarge';
export class ConnectorOAuthStoreError extends Error {
  constructor(readonly code: ConnectorOAuthStoreFailure) {
    super(`connector OAuth store ${code}`);
    this.name = 'ConnectorOAuthStoreError';
  }
}

// A saved connection as main lists it: no token or client secret, yet main-only all the same, since an identity's
// request URL may carry a configured query secret. An owner-facing answer allowlists its own safe fields.
export type ConnectorOAuthSaved =
  | { state: 'sealed'; connectionId: string; identity: ConnectorOAuthIdentity; issuer: string; resource: string; savedAt: number; expiresAt?: number; refreshable: boolean }
  | { state: 'unreadable'; connectionId: string };

// What `claim` returns and `save` checks at its commit.
export interface ConnectorOAuthClaim {
  readonly connectionId: string;
  readonly generation: number;
}

export interface ConnectorOAuthStore {
  list(): Promise<ConnectorOAuthSaved[]>;
  // P3-HD M3c1: the saved connection ids from the file names alone, never touching safeStorage or reading a file, so
  // a record can be forgotten while nothing decrypts. Nothing about its identity is inferred.
  ids(): Promise<string[]>;
  read(connectionId: string): Promise<ConnectorOAuthRecord | null>;
  claim(connectionId: string): ConnectorOAuthClaim;
  // Replaces the connection's record; `stale` when the claim was overtaken by a removal.
  save(claim: ConnectorOAuthClaim, identity: ConnectorOAuthIdentity, grant: ConnectorOAuthGrant): Promise<ConnectorOAuthRecord>;
  // Forgets the connection; whether a record was there. Later saves under an earlier claim are refused.
  remove(connectionId: string): Promise<boolean>;
}

export const OAUTH_STORE_RECORD_LIMIT = 256;
const FILE_LIMIT_BYTES = 1_048_576;
const FORMAT = 'maws-connector-oauth/1';
const SUFFIX = '.sealed';
const ConnectionId = z.uuid();

const Text = z.string().min(1).max(16_384);
const RecordSchema = z.strictObject({
  version: z.literal(1),
  connectionId: ConnectionId,
  identity: z.strictObject({
    requestUrl: z.string().min(1).max(8_192),
    server: z.string().min(1).max(256),
    scope: z.enum(['user', 'local', 'app']),
    configPath: z.string().min(1).max(4_096),
    entryPath: z.array(z.string().max(4_096)).max(8),
  }),
  issuer: z.string().min(1).max(8_192),
  resource: z.string().min(1).max(8_192),
  redirectUri: z.string().min(1).max(8_192),
  authorizationServer: z.record(z.string(), z.unknown()),
  client: z.record(z.string(), z.unknown()),
  tokens: z.strictObject({
    accessToken: Text,
    refreshToken: Text.optional(),
    tokenType: z.literal('Bearer'),
    grantedScope: z.string().max(8_192).optional(),
    expiresAt: z.number().int().nonnegative().optional(),
    obtainedAt: z.number().int().nonnegative(),
  }),
  savedAt: z.number().int().nonnegative(),
});

function parseRecord(text: string, connectionId: string): ConnectorOAuthRecord | null {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  const parsed = RecordSchema.safeParse(json);
  if (!parsed.success || parsed.data.connectionId !== connectionId) return null;
  const metadata = OAuthMetadataSchema.safeParse(parsed.data.authorizationServer);
  const oidc = metadata.success ? metadata : OpenIdProviderDiscoveryMetadataSchema.safeParse(parsed.data.authorizationServer);
  const client = OAuthClientInformationFullSchema.safeParse(parsed.data.client);
  if (!oidc.success || !client.success) return null;
  const { connectionId: id, identity, issuer, resource, redirectUri, tokens, savedAt } = parsed.data;
  return { connectionId: id, identity, issuer, resource, redirectUri, authorizationServer: oidc.data, client: client.data, tokens, savedAt };
}

export function createConnectorOAuthStore(deps: { directory: string; sealer: ConnectorOAuthSealer; now?: () => number }): ConnectorOAuthStore {
  const { directory, sealer } = deps;
  const now = deps.now ?? Date.now;
  const generations = new Map<string, number>();
  const writes = new Map<string, number>(); // commits per connection, so a re-encryption never replaces a newer save
  let lock: Promise<unknown> = Promise.resolve();
  // file operations only, one at a time
  const locked = <T>(step: () => Promise<T>): Promise<T> => {
    const run = lock.then(step, step);
    lock = run.catch(() => {});
    return run;
  };
  const generationOf = (id: string) => generations.get(id) ?? 0;
  const fileOf = (id: string) => {
    if (!ConnectionId.safeParse(id).success) throw new TypeError('connectionId must be a uuid');
    return join(directory, `${id}${SUFFIX}`);
  };

  async function names(): Promise<string[]> {
    try {
      return (await readdir(directory)).filter((name) => name.endsWith(SUFFIX) && ConnectionId.safeParse(name.slice(0, -SUFFIX.length)).success);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw new ConnectorOAuthStoreError('io');
    }
  }

  // The sealed bytes of one record, or null when there is none.
  async function readSealed(id: string): Promise<Buffer | null> {
    let handle;
    try {
      handle = await open(fileOf(id), constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw new ConnectorOAuthStoreError('unreadable');
    }
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size > FILE_LIMIT_BYTES) throw new ConnectorOAuthStoreError('unreadable');
      const text = await handle.readFile('utf8');
      const [format, body, rest] = text.split('\n');
      if (format !== FORMAT || !body || (rest !== undefined && rest !== '')) throw new ConnectorOAuthStoreError('unreadable');
      return Buffer.from(body, 'base64');
    } catch (error) {
      if (error instanceof ConnectorOAuthStoreError) throw error;
      throw new ConnectorOAuthStoreError('unreadable');
    } finally {
      await handle.close();
    }
  }

  async function requireAvailable(): Promise<void> {
    if (!(await sealer.available())) throw new ConnectorOAuthStoreError('unavailable');
  }

  async function seal(record: ConnectorOAuthRecord): Promise<string> {
    let sealed: Buffer;
    try {
      sealed = await sealer.seal(JSON.stringify({ version: 1, ...record }));
    } catch {
      throw new ConnectorOAuthStoreError('unavailable');
    }
    const text = `${FORMAT}\n${sealed.toString('base64')}\n`;
    if (Buffer.byteLength(text, 'utf8') > FILE_LIMIT_BYTES) throw new ConnectorOAuthStoreError('tooLarge');
    return text;
  }

  async function ensureDirectory(): Promise<void> {
    try {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const info = await stat(directory);
      if ((info.mode & 0o077) !== 0) await chmod(directory, info.mode & 0o700);
    } catch {
      throw new ConnectorOAuthStoreError('io');
    }
  }

  // Under the lock: the file is replaced only while the claim still stands (and, for a re-encryption, while no other
  // commit replaced the record it re-encrypts); a new connection only within the record bound.
  async function commit(claim: ConnectorOAuthClaim, text: string, unchangedSince?: number): Promise<void> {
    const id = claim.connectionId;
    await locked(async () => {
      if (generationOf(id) !== claim.generation) throw new ConnectorOAuthStoreError('stale');
      if (unchangedSince !== undefined && (writes.get(id) ?? 0) !== unchangedSince) throw new ConnectorOAuthStoreError('stale');
      const existing = await names();
      if (existing.length >= OAUTH_STORE_RECORD_LIMIT && !existing.includes(`${id}${SUFFIX}`)) throw new ConnectorOAuthStoreError('full');
      try {
        await atomicWriteFile(fileOf(id), text);
      } catch {
        throw new ConnectorOAuthStoreError('io');
      }
      writes.set(id, (writes.get(id) ?? 0) + 1);
    });
  }

  async function readRecord(id: string): Promise<ConnectorOAuthRecord | null> {
    const claim = { connectionId: id, generation: generationOf(id) };
    const written = writes.get(id) ?? 0;
    const sealed = await readSealed(id);
    if (sealed === null) return null;
    await requireAvailable();
    let opened: { text: string; reseal: boolean };
    try {
      opened = await sealer.open(sealed);
    } catch {
      throw new ConnectorOAuthStoreError('unreadable');
    }
    const record = parseRecord(opened.text, id);
    if (record === null) throw new ConnectorOAuthStoreError('unreadable');
    if (opened.reseal) {
      // the key was rotated: the same record, re-encrypted through the same guarded commit (a removal meanwhile wins)
      await commit(claim, await seal(record), written).catch((error: unknown) => {
        if (!(error instanceof ConnectorOAuthStoreError && error.code === 'stale')) throw error; // stale: a newer save or a removal won
      });
    }
    return record;
  }

  return {
    async list() {
      const found = await names();
      if (found.length === 0) return [];
      await requireAvailable();
      const listed: ConnectorOAuthSaved[] = [];
      for (const name of found) {
        const connectionId = name.slice(0, -SUFFIX.length);
        try {
          const record = await readRecord(connectionId);
          if (record === null) continue;
          const { identity, issuer, resource, savedAt, tokens } = record;
          listed.push({ state: 'sealed', connectionId, identity, issuer, resource, savedAt, ...(tokens.expiresAt !== undefined && { expiresAt: tokens.expiresAt }), refreshable: tokens.refreshToken !== undefined });
        } catch (error) {
          if (!(error instanceof ConnectorOAuthStoreError) || error.code !== 'unreadable') throw error;
          listed.push({ state: 'unreadable', connectionId });
        }
      }
      return listed;
    },
    async ids() {
      return (await names()).map((name) => name.slice(0, -SUFFIX.length));
    },
    async read(connectionId) {
      fileOf(connectionId);
      return readRecord(connectionId);
    },
    claim(connectionId) {
      fileOf(connectionId);
      return { connectionId, generation: generationOf(connectionId) };
    },
    async save(claim, identity, grant) {
      fileOf(claim.connectionId);
      await requireAvailable();
      const record: ConnectorOAuthRecord = { ...grant, connectionId: claim.connectionId, identity: { ...identity, entryPath: [...identity.entryPath] }, savedAt: now() };
      const text = await seal(record);
      await ensureDirectory();
      await commit(claim, text);
      return record;
    },
    async remove(connectionId) {
      const file = fileOf(connectionId);
      generations.set(connectionId, generationOf(connectionId) + 1); // before any await: every earlier claim is now stale
      return locked(async () => {
        try {
          await unlink(file);
          return true;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
          throw new ConnectorOAuthStoreError('io');
        }
      });
    },
  };
}
