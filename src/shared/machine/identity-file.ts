// The machine's identity file (P5 OX2, Decision Logs 21, 22 and 27; docs/doperpowers/plans/2026-10-27-p5-o6-machine-dimension.md,
// M1): `<profile>/machine.json`, holding the `MachineRef` the profile minted at its first run. `<profile>` is the
// profile's root (the app's userData), never O2's `mawsd/` directory inside it. No Electron here: the app's main and O2's
// `mawsd` read and mint through this one module, so whichever runs first in a profile mints, and O3's data-directory
// migration moves the file with the index.
//
// Published once and never replaced: the complete JSON goes to a same-directory temporary file (0600, fsynced), which is
// then linked to machine.json. The link fails with EEXIST when an identity already exists, so a reader never sees a
// partial file, a run that loses the race reads the winner's file, and no lock is shared. A crash before the link leaves
// only a stray temporary file, which a later start deletes once it is a minute old (a fresher one may be a racing
// minter's). A file that exists and does not hold a valid ref is refused, naming its path: re-minting would silently
// re-address everything persisted under the old ref. Nothing rewrites the file.
//
// P5 O2 M5 (docs/doperpowers/plans/2026-10-27-p5-o2-mawsd.md; RL5 and the remote layer's Decision Log 25): a machine that
// enrolls through a devcloud delegation mints its ref with the delegation's id as a prefix, `<prefix>_<22 base64url>`
// (55 characters, inside RL5's 64). An unprefixed ref is 22 characters, so it can never take a delegation's shape. The
// prefix is refused unless it is 32 lower-case hex digits, and ignored when the file already exists.
import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import { join } from 'node:path';
import * as z from 'zod';
import { MachineRefSchema, type MachineRef } from './ref';

export const IDENTITY_FILE = 'machine.json';

// Version 1 is what this module writes. A later version's file is read for its ref alone, so a build that predates it
// keeps the profile's identity instead of refusing to start.
const IdentityFileSchema = z.object({ version: z.number().int().positive(), ref: MachineRefSchema, mintedAt: z.string() });

// `machine.json.<pid>.<random>`, the minter's temporary files.
const TEMPORARY = /^machine\.json\.\d+\.[A-Za-z0-9_-]+$/;
const STRAY_AFTER_MS = 60_000;
const DELEGATION_PREFIX = /^[0-9a-f]{32}$/; // P5 O2 M5

// null when absent; throws naming the path on a malformed file.
export function readMachineRef(profileDir: string): MachineRef | null {
  const path = join(profileDir, IDENTITY_FILE);
  let text: string;
  try {
    text = fs.readFileSync(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`${path} is not a machine identity: it does not parse as JSON. Refusing to start, since minting a new one would re-address everything kept under the old ref.`);
  }
  const parsed = IdentityFileSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`${path} is not a machine identity: ${z.prettifyError(parsed.error)}. Refusing to start, since minting a new one would re-address everything kept under the old ref.`);
  }
  return parsed.data.ref;
}

// The profile's ref, minted and published by link when it has none (P5 O2 M5: with `prefix` when it is minted here).
export function readOrMintMachineRef(profileDir: string, options: { prefix?: string } = {}): MachineRef {
  const { prefix } = options;
  if (prefix !== undefined && !DELEGATION_PREFIX.test(prefix)) throw new Error(`a machine ref's prefix is a delegation id, 32 lower-case hex digits; refusing ${JSON.stringify(prefix)}`);
  fs.mkdirSync(profileDir, { recursive: true });
  removeStrayTemporaries(profileDir);
  const existing = readMachineRef(profileDir);
  if (existing) return existing;

  const random = randomBytes(16).toString('base64url');
  const ref = MachineRefSchema.parse(prefix === undefined ? random : `${prefix}_${random}`);
  const temporary = join(profileDir, `${IDENTITY_FILE}.${process.pid}.${randomBytes(6).toString('base64url')}`);
  const content = Buffer.from(`${JSON.stringify({ version: 1, ref, mintedAt: new Date().toISOString() })}\n`);
  const fd = fs.openSync(temporary, 'wx', 0o600);
  try {
    try {
      // writeSync may write less than it was given: loop until the whole identity is on disk, so a short write never
      // publishes a truncated file that every later start would refuse.
      for (let written = 0; written < content.length; ) written += fs.writeSync(fd, content, written, content.length - written);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    try {
      fs.linkSync(temporary, join(profileDir, IDENTITY_FILE));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  } finally {
    fs.rmSync(temporary, { force: true }); // whether the write, the link or nothing failed
  }
  const published = readMachineRef(profileDir);
  if (!published) throw new Error(`${join(profileDir, IDENTITY_FILE)} vanished right after it was published.`);
  return published;
}

function removeStrayTemporaries(profileDir: string): void {
  const now = Date.now();
  for (const name of fs.readdirSync(profileDir)) {
    if (!TEMPORARY.test(name)) continue;
    const path = join(profileDir, name);
    try {
      if (now - fs.statSync(path).mtimeMs > STRAY_AFTER_MS) fs.rmSync(path, { force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; // another start removed it first
    }
  }
}
