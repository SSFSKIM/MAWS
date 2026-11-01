// P3-HD M3a: the sealed store of MAWS's own OAuth grants (docs/doperpowers/plans/2026-10-17-p3-hd-direct-route.md M3,
// Decision Log 13/18; P3 co-work Decision Log 98 (5), its per-connection refinement by the architect, 2026-10-17).
//
// One file per saved connection, `<directory>/<connectionId>.sealed`: a plain format line, then the base64 of the
// sealer's ciphertext of one version-1 JSON record. The name is the opaque, stable `connectionId`; the identity (exact
// request URL and configured entry) and every token live only inside the ciphertext, since a request URL's query can
// itself be a secret. Deleting a connection is an unlink, so a record that no longer decrypts (a rotated or denied key,
// a damaged file) is still listed by id and can be forgotten.
//
// The format line is the sealer's own (P5 O4 M1, docs/doperpowers/plans/2026-10-31-p5-o4-services.md, Interfaces §A
// and D21): Electron's safeStorage wrote `maws-connector-oauth/1`, the machine's key file writes `/2`. A file whose line
// is not this store's sealer's is unreadable in the same sense, read without asking the sealer: listed by id, failed
// closed on by the provider, forgotten by `remove`. P5 O4 M2 (Interfaces §C, D23): a format 1 file is replaced in place
// by the one-time adoption (`adoptSealed`), only while it is still that format 1 file nobody forgot or saved over.
//
// - Fails closed: without the sealer, nothing is read or written and nothing is ever stored plain. A store with no record
//   of its own sealer's format (empty, or only other sealers' files) is listed without touching the sealer.
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
import { atomicWriteFile } from '@shared/fs/atomic-write';
import type { ConnectorOAuthGrant, ConnectorOAuthIdentity, ConnectorOAuthRecord } from '@shared/connectors/oauth-types';
import type { ConnectorOAuthSealer } from '@shared/connectors/sealer';
import { ConnectorOAuthRecordJsonSchema } from '@shared/ipc/schema/connectors';

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
  // P5 O4 M2 (D23): a record as this store would keep it, or null (its schema, its id, the SDK's metadata and client).
  recordOf(value: unknown, connectionId: string): ConnectorOAuthRecord | null;
  // The file text this store's sealer makes of `record` (`unavailable`, `tooLarge`), outside any lock.
  sealText(record: ConnectorOAuthRecord): Promise<string>;
  // The adoption's commit, under the write lock: `text` replaces the id's file only while the claim stands, no commit
  // was made for the id in this process, and the file's first line is still `from` (`present`: another line; `absent`:
  // no file; `stale`: a removal or a save since the claim).
  adoptSealed(claim: ConnectorOAuthClaim, text: string, from: string): Promise<'adopted' | 'present' | 'absent' | 'stale'>;
}

export const OAUTH_STORE_RECORD_LIMIT = 256;
const FILE_LIMIT_BYTES = 1_048_576;
const HEADER_LIMIT_BYTES = 64; // past either format line
const SUFFIX = '.sealed';
const ConnectionId = z.uuid();

// The record as the adoption hands it across (P5 O4 M2) with its version: one schema, so the two never drift.
const RecordSchema = ConnectorOAuthRecordJsonSchema.extend({ version: z.literal(1) });

function parseRecord(text: string, connectionId: string): ConnectorOAuthRecord | null {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  return validRecord(json, connectionId);
}

function validRecord(json: unknown, connectionId: string): ConnectorOAuthRecord | null {
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
      if (format !== sealer.format || !body || (rest !== undefined && rest !== '')) throw new ConnectorOAuthStoreError('unreadable');
      return Buffer.from(body, 'base64');
    } catch (error) {
      if (error instanceof ConnectorOAuthStoreError) throw error;
      throw new ConnectorOAuthStoreError('unreadable');
    } finally {
      await handle.close();
    }
  }

  // A file's first line as the format reads it, without a sealer; null when there is no regular file to read.
  async function firstLine(path: string): Promise<string | null> {
    let handle;
    try {
      handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw new ConnectorOAuthStoreError('io');
    }
    try {
      const info = await handle.stat();
      if (!info.isFile()) return '';
      const buffer = Buffer.alloc(HEADER_LIMIT_BYTES);
      const { bytesRead } = await handle.read(buffer, 0, HEADER_LIMIT_BYTES, 0);
      return buffer.subarray(0, bytesRead).toString('utf8').split('\n')[0]!;
    } catch {
      throw new ConnectorOAuthStoreError('io');
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
      sealed = await sealer.seal(JSON.stringify({ version: 1, ...record }), record.connectionId);
    } catch {
      throw new ConnectorOAuthStoreError('unavailable');
    }
    const text = `${sealer.format}\n${sealed.toString('base64')}\n`;
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

  // What a record's file held when it was read, with the claim and commit count taken before the read, so a
  // re-encryption of it never replaces a newer commit.
  interface SealedRead { claim: ConnectorOAuthClaim; written: number; sealed: Buffer }

  async function readSealedRecord(id: string): Promise<SealedRead | null> {
    const claim = { connectionId: id, generation: generationOf(id) };
    const written = writes.get(id) ?? 0;
    const sealed = await readSealed(id);
    return sealed === null ? null : { claim, written, sealed };
  }

  async function readRecord(id: string): Promise<ConnectorOAuthRecord | null> {
    const read = await readSealedRecord(id);
    if (read === null) return null;
    await requireAvailable();
    return openRecord(id, read);
  }

  async function openRecord(id: string, { claim, written, sealed }: SealedRead): Promise<ConnectorOAuthRecord> {
    let opened: { text: string; reseal: boolean };
    try {
      opened = await sealer.open(sealed, id);
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
      // Every file's format line first: only a record of this sealer's own format asks it for availability, so
      // another sealer's files are listed by id with no sealer at all.
      const reads: { connectionId: string; read: SealedRead | 'unreadable' }[] = [];
      for (const name of await names()) {
        const connectionId = name.slice(0, -SUFFIX.length);
        try {
          const read = await readSealedRecord(connectionId);
          if (read !== null) reads.push({ connectionId, read });
        } catch (error) {
          if (!(error instanceof ConnectorOAuthStoreError) || error.code !== 'unreadable') throw error;
          reads.push({ connectionId, read: 'unreadable' });
        }
      }
      if (reads.some(({ read }) => read !== 'unreadable')) await requireAvailable();
      const listed: ConnectorOAuthSaved[] = [];
      for (const { connectionId, read } of reads) {
        try {
          if (read === 'unreadable') throw new ConnectorOAuthStoreError('unreadable');
          const { identity, issuer, resource, savedAt, tokens } = await openRecord(connectionId, read);
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
    recordOf(value, connectionId) {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
      return validRecord({ ...value, version: 1 }, connectionId);
    },
    async sealText(record) {
      fileOf(record.connectionId);
      return seal(record);
    },
    async adoptSealed(claim, text, from) {
      const id = claim.connectionId;
      fileOf(id);
      return locked(async () => {
        if (generationOf(id) !== claim.generation || (writes.get(id) ?? 0) !== 0) return 'stale';
        const head = await firstLine(fileOf(id));
        if (head === null) return 'absent';
        if (head !== from) return 'present';
        try {
          await atomicWriteFile(fileOf(id), text);
        } catch {
          throw new ConnectorOAuthStoreError('io');
        }
        writes.set(id, (writes.get(id) ?? 0) + 1);
        return 'adopted';
      });
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
