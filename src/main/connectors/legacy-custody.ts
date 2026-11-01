// P5 O4 (docs/doperpowers/plans/2026-10-31-p5-o4-services.md, U7: Interfaces §B, Decision Log D3, D20 and D23): route
// D's grants sealed under Electron's safeStorage (format 1, the Keychain's) survive the move to the machine's key file
// through a one-time adoption. Main, which still has safeStorage, opens each format 1 record once and hands it to the
// machine, which re-seals it under its own key and replaces the file only while it is still the format 1 one nobody
// forgot (`connectors.adoptGrant`, M2). This module is main's half: it reads, never writes or deletes a file.
//
// - `listLegacy` names the format 1 files from their first line alone, with no sealer, so a profile with none never asks
//   the Keychain.
// - `adoptLegacy` is one pass: the sealer's availability once, then a probe, then each record opened and handed to
//   `adopt` (D32). The probe seals a fixed text and opens it again through the same sealer: Electron's sealer works
//   under the profile's one Keychain key, so the probe asks for that key (the launch's one prompt) and no other. A
//   probe that fails stops the pass before any record is opened: OSCryptAsync initialises once, so a denied or
//   unavailable Keychain is not asked again in this launch; the next launch tries again, and a record the owner will
//   not allow stays an unreadable row they can Forget. After a passing probe the key is in hand, so a record that does
//   not open is that file's own damage, wherever it sorts: it is left and the pass goes on. A record that opens to
//   anything but its own version 1 record, or that the machine declines or cannot take, is left too. Records cross as
//   opened; the machine validates them (`invalid`).
// - The log names counts and closed reasons only, never an id's record.
// - P5 O4 M2 (D20, D21): Electron's sealer (format 1, safeStorage's asynchronous API) and the MAWS_E2E custody guard
//   that stands before each of its operations live here, with the one composition of the two (`legacySealer`), since
//   only the adoption still asks the Keychain: the machine's custody (src/services/connectors/custody.ts) never does.
//   This is the one machine-bound file under src/main/connectors/ that imports Electron (eslint.config.js).
//
// Imports nothing from src/services/ (lint rule B): the seam and the record types are @shared/connectors/'s.
import { constants, realpathSync } from 'node:fs';
import { open, readdir, type FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { app, safeStorage } from 'electron';
import type { ConnectorOAuthRecord } from '@shared/connectors/oauth-types';
import { SEALED_FORMAT_V1, type AsyncSafeStorage, type ConnectorOAuthSealer, type E2ECustodyFacts } from '@shared/connectors/sealer';

const SUFFIX = '.sealed';
const FILE_LIMIT_BYTES = 1_048_576; // the store's bound
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEADER = `${SEALED_FORMAT_V1}\n`;
// The probe's round trip: a fixed id and text, never a record's.
export const ADOPTION_PROBE_ID = '00000000-0000-4000-8000-000000000000';
const ADOPTION_PROBE_TEXT = 'maws-connector-oauth adoption probe';

export interface LegacyAdoption {
  adopted: number;
  left: number;
  stopped: boolean; // the sealer failed its probe: every record waits for the next launch
}

export interface AdoptLegacyDeps {
  directory: string;
  sealer: ConnectorOAuthSealer;
  adopt(connectionId: string, record: ConnectorOAuthRecord): Promise<{ adopted: boolean; reason?: string }>;
  log(line: string): void;
}

// Electron's safeStorage through its asynchronous API only, each call after app readiness: the synchronous methods
// can block main's event loop on a keychain prompt. Its files are format 1; it binds no connection id.
export function electronOAuthSealer(safeStorage: AsyncSafeStorage, ready: () => Promise<unknown>): ConnectorOAuthSealer {
  return {
    format: SEALED_FORMAT_V1,
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

const canonical = (path: string): string | null => {
  try {
    return realpathSync.native(path);
  } catch {
    return null;
  }
};

// P3-HD M3c2 (docs/doperpowers/plans/2026-10-17-p3-hd-direct-route.md, Decision Log 28): the sealer itself outside
// MAWS_E2E; under it, one that proves custody before each operation and otherwise fails closed. The E2E launch runs
// Chromium on its mock keychain (src/main/app.ts); the guard proves, at each call, that the switch is present and that
// the app's userData is the scratch profile the harness named (MAWS_USER_DATA) under the OS temporary directory,
// canonically, or answers unavailable without asking safeStorage. A test checking the profile from outside cannot
// protect a decryption of a saved record at startup; this does.
export function guardE2ECustody(sealer: ConnectorOAuthSealer, facts: E2ECustodyFacts): ConnectorOAuthSealer {
  if (!facts.e2e) return sealer;
  const safe = (): boolean => {
    if (!facts.mockKeychain()) return false;
    const named = facts.scratch();
    if (!named) return false;
    const profile = canonical(facts.userData());
    const scratch = canonical(named);
    const tmp = canonical(facts.tmp());
    return profile !== null && tmp !== null && profile === scratch && profile.startsWith(tmp.endsWith(sep) ? tmp : tmp + sep);
  };
  const refuse = () => new Error('E2E custody unproven: safeStorage was not asked');
  return {
    format: sealer.format,
    available: async () => safe() && sealer.available(),
    seal: async (text, id) => {
      if (!safe()) throw refuse();
      return sealer.seal(text, id);
    },
    open: async (sealed, id) => {
      if (!safe()) throw refuse();
      return sealer.open(sealed, id);
    },
  };
}

// The adoption's sealer in production: Electron's, behind the guard. Lazy: nothing asks safeStorage until it is used.
export function legacySealer(): ConnectorOAuthSealer {
  return guardE2ECustody(electronOAuthSealer(safeStorage, () => app.whenReady()), {
    e2e: Boolean(process.env.MAWS_E2E),
    mockKeychain: () => app.commandLine.hasSwitch('use-mock-keychain'),
    userData: () => app.getPath('userData'),
    scratch: () => process.env.MAWS_USER_DATA,
    tmp: tmpdir,
  });
}

// The connection ids whose file's first line is format 1, sorted.
export async function listLegacy(directory: string): Promise<string[]> {
  let names: string[];
  try {
    names = await readdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const ids: string[] = [];
  for (const name of names) {
    const id = name.endsWith(SUFFIX) ? name.slice(0, -SUFFIX.length) : '';
    if (!UUID.test(id)) continue;
    const head = await readPrefix(join(directory, name), Buffer.byteLength(HEADER));
    if (head?.toString('utf8') === HEADER) ids.push(id);
  }
  return ids.sort();
}

export async function adoptLegacy(deps: AdoptLegacyDeps): Promise<LegacyAdoption> {
  const { directory, sealer } = deps;
  const ids = await listLegacy(directory);
  if (ids.length === 0) return { adopted: 0, left: 0, stopped: false };
  const result: LegacyAdoption = { adopted: 0, left: 0, stopped: false };
  const reasons = new Map<string, number>();
  const leave = (reason: string) => {
    result.left += 1;
    reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
  };
  const report = () => {
    const tally = [...reasons].map(([reason, count]) => `${reason} ${count}`).join(', ');
    deps.log(`[connectors] adopted ${result.adopted} of ${ids.length} legacy grants${tally && `; left: ${tally}`}${result.stopped ? '; stopped: the sealer is unavailable or failed its round trip, the next launch tries again' : ''}`);
  };

  if (!(await sealer.available().catch(() => false)) || !(await roundTrips(sealer))) {
    result.left = ids.length;
    result.stopped = true;
    report();
    return result;
  }
  for (const id of ids) {
    const sealed = await readLegacy(join(directory, `${id}${SUFFIX}`));
    if (sealed === 'gone') continue; // forgotten or replaced since the listing: no longer legacy
    if (sealed === 'malformed') {
      leave('malformed');
      continue;
    }
    let text: string;
    try {
      text = (await sealer.open(sealed, id)).text;
    } catch {
      leave('unopened');
      continue;
    }
    const record = legacyRecord(text, id);
    if (record === null) {
      leave('invalid');
      continue;
    }
    try {
      const answer = await deps.adopt(id, record);
      if (answer.adopted) result.adopted += 1;
      else leave(answer.reason ?? 'declined');
    } catch {
      leave('failed');
    }
  }
  report();
  return result;
}

// Whether the sealer opens what it sealed: its key is in hand.
async function roundTrips(sealer: ConnectorOAuthSealer): Promise<boolean> {
  try {
    const sealed = await sealer.seal(ADOPTION_PROBE_TEXT, ADOPTION_PROBE_ID);
    return (await sealer.open(sealed, ADOPTION_PROBE_ID)).text === ADOPTION_PROBE_TEXT;
  } catch {
    return false;
  }
}

// The record as sealed, its version line dropped, when it is a version 1 record of this id; the machine validates the
// rest.
function legacyRecord(text: string, id: string): ConnectorOAuthRecord | null {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return null;
  const { version, ...record } = json as Record<string, unknown>;
  if (version !== 1 || record.connectionId !== id) return null;
  return record as unknown as ConnectorOAuthRecord;
}

// The sealed bytes of a format 1 file; `gone` when it is absent, no longer a regular file or no longer format 1
// (forgotten or adopted since the listing); `malformed` when it still starts with the format 1 line but its envelope is
// not the store's (no body, a line too many, over the store's bound), a file the store lists unreadable as it is.
async function readLegacy(path: string): Promise<Buffer | 'gone' | 'malformed'> {
  const bytes = await readPrefix(path, FILE_LIMIT_BYTES + 1);
  if (bytes === null || !bytes.subarray(0, Buffer.byteLength(HEADER)).equals(Buffer.from(HEADER))) return 'gone';
  if (bytes.length > FILE_LIMIT_BYTES) return 'malformed';
  const [, body, rest] = bytes.toString('utf8').split('\n');
  if (!body || (rest !== undefined && rest !== '')) return 'malformed';
  return Buffer.from(body, 'base64');
}

// At most `limit` bytes from the start of a regular file opened without following a link (or waiting on a FIFO); null
// when there is none or it cannot be read.
async function readPrefix(path: string, limit: number): Promise<Buffer | null> {
  let handle: FileHandle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch {
    return null;
  }
  try {
    if (!(await handle.stat()).isFile()) return null;
    const buffer = Buffer.alloc(limit);
    let filled = 0;
    while (filled < limit) {
      const { bytesRead } = await handle.read(buffer, filled, limit - filled, filled);
      if (bytesRead === 0) break;
      filled += bytesRead;
    }
    return buffer.subarray(0, filled);
  } catch {
    return null;
  } finally {
    await handle.close();
  }
}
