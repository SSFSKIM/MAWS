// P5 O4 (docs/doperpowers/plans/2026-10-31-p5-o4-services.md, U7: Interfaces §B, Decision Log D3, D20 and D23): route
// D's grants sealed under Electron's safeStorage (format 1, the Keychain's) survive the move to the machine's key file
// through a one-time adoption. Main, which still has safeStorage, opens each format 1 record once and hands it to the
// machine, which re-seals it under its own key and replaces the file only while it is still the format 1 one nobody
// forgot (`connectors.adoptGrant`, M2). This module is main's half: it reads, never writes or deletes a file.
//
// - `listLegacy` names the format 1 files from their first line alone, with no sealer, so a profile with none never asks
//   the Keychain.
// - `adoptLegacy` is one pass: the sealer's availability once, then each record opened and handed to `adopt`. The pass
//   stops at the first record the sealer cannot open while none has opened yet: Electron's OSCryptAsync initialises
//   once, so a denied or unavailable Keychain is not asked again in this launch; the next launch tries again, and a
//   record the owner will not allow stays an unreadable row they can Forget. Once one record has opened the profile's
//   one Keychain key is in hand, so a later failure is that record's own damage: it is left and the pass goes on, and
//   one damaged file never holds back the records after it. A record that opens to anything but its own version 1
//   record, or that the machine declines or cannot take, is left too. Records cross as opened; the machine validates
//   them (`invalid`).
// - The log names counts and closed reasons only, never an id's record.
//
// Imports nothing from src/services/ (lint rule B): the seam and the record types are @shared/connectors/'s. M2 brings
// the Electron sealer and the MAWS_E2E custody guard here.
import { constants } from 'node:fs';
import { open, readdir, type FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import type { ConnectorOAuthRecord } from '@shared/connectors/oauth-types';
import { SEALED_FORMAT_V1, type ConnectorOAuthSealer } from '@shared/connectors/sealer';

const SUFFIX = '.sealed';
const FILE_LIMIT_BYTES = 1_048_576; // the store's bound
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEADER = `${SEALED_FORMAT_V1}\n`;

export interface LegacyAdoption {
  adopted: number;
  left: number;
  stopped: boolean; // the sealer opened no record and could not open one: the rest wait for the next launch
}

export interface AdoptLegacyDeps {
  directory: string;
  sealer: ConnectorOAuthSealer;
  adopt(connectionId: string, record: ConnectorOAuthRecord): Promise<{ adopted: boolean; reason?: string }>;
  log(line: string): void;
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
    deps.log(`[connectors] adopted ${result.adopted} of ${ids.length} legacy grants${tally && `; left: ${tally}`}${result.stopped ? '; stopped: the sealer could not open a record, the next launch tries again' : ''}`);
  };

  if (!(await sealer.available().catch(() => false))) {
    result.left = ids.length;
    result.stopped = true;
    report();
    return result;
  }
  let opened = false;
  for (const [index, id] of ids.entries()) {
    const sealed = await readLegacy(join(directory, `${id}${SUFFIX}`));
    if (sealed === null) continue; // forgotten or replaced since the listing: no longer legacy
    let text: string;
    try {
      text = (await sealer.open(sealed, id)).text;
      opened = true;
    } catch {
      if (opened) {
        leave('unopened');
        continue;
      }
      result.left += ids.length - index;
      result.stopped = true;
      break;
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

// The sealed bytes of a format 1 file, or null when it is gone or no longer format 1 (adopted meanwhile). A file that is
// not a regular one, over the store's bound or malformed is null too: the store lists it unreadable as it is.
async function readLegacy(path: string): Promise<Buffer | null> {
  const bytes = await readPrefix(path, FILE_LIMIT_BYTES + 1);
  if (bytes === null || bytes.length > FILE_LIMIT_BYTES) return null;
  const [format, body, rest] = bytes.toString('utf8').split('\n');
  if (format !== SEALED_FORMAT_V1 || !body || (rest !== undefined && rest !== '')) return null;
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
