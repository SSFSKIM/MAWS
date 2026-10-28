// `<userData>/org/` (P5 O8 M1, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, Interfaces §C): this profile's
// registration in the org, the org chain it holds, and the hub credential. The directory is 0700 and each file 0600,
// checked on every read; a file is written whole at a temporary name, synced and renamed into place, so a crash leaves
// the old file or the new one. A file that doesn't read (absent, malformed, a symlink, another uid's, open to group or
// other) is logged and treated as absent; a directory that fails its checks closes the session (`problem: 'directory'`).
// Nothing here is a key: the device's keys stay in `<userData>/device/` (src/main/device/keys.ts).
//
// `signing.json` (M3, Interfaces §C's addition) is the one file that fails closed rather than reading as absent: once
// registration.json says `signing: true`, a missing or malformed one is the signing store's `damaged`
// (signing-store.ts, its one writer).
//
// The directory is made only by a sign-in that reached its end, so a profile that never signs in has none.
import { constants } from 'node:fs';
import { lstat, mkdir, open, rename, rm, type FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import { isCertificates, isSignedOrgState, type Certificates, type RootTransition, type Signed, type SignedOrgState } from '../../../apps/org-protocol/src/index.ts';

export const ORG_DIR = 'org';
export const REGISTRATION_FILE = 'registration.json';
export const CHAIN_FILE = 'chain.json';
export const ACCESS_FILE = 'access.json';
export const SIGNING_FILE = 'signing.json';

/** The held head's place in the chain, by `stateHash` (base64url): what outlives `chain.json` (held.ts). */
export type Anchor = { genesis: string; version: number; head: string };

export type RegistrationFile = {
  version: 1;
  hub: string;
  org: string;
  member: { id: string; email: string };
  device: string;
  pins: { roots: string[]; recoveryPub: string };
  anchor: Anchor;
  registered: string;
  signedOut: boolean;
  /** M3: set (before) signing.json is first written; from then a missing or malformed signing.json fails closed. */
  signing?: true;
  /** M3: a rekey's promotion under way (step 1 to step 4 of its transaction): the new device's id. */
  rekey?: { device: string };
};

export type ChainFile = {
  version: 1;
  chain: SignedOrgState[];
  transitions: Signed<RootTransition>[];
  accepted: RootTransition[];
  certificates: Certificates;
  highWater: number;
  superseded: SignedOrgState[];
};

/**
 * A signed state kept before it goes anywhere (M3's pending slot): its parent's `stateHash`, and where it may already be,
 * written before each send (`exposed.hub` before the POST, a machine's ref before its `endpoint.state` act).
 */
export type Pending = { signed: SignedOrgState; parent: string; exposed: { hub: boolean; machines: string[] } };
/**
 * A state that ends keys, owed to the machines of the roster at its signing (M3's direct delivery): the signed bytes,
 * the machines still owing an acknowledgement, each machine's cursor on the app's line (`line`: the count of accepted
 * transitions held when it was set), the line each machine's recovery-first probe ran on, and the machines a run can't
 * reach because one state exceeds the bound.
 */
export type Obligation = {
  hash: string;
  signed: SignedOrgState;
  owed: string[];
  known: Record<string, { version: number; line: number }>;
  probed: Record<string, number>;
  tooLarge: string[];
};
/** A discarded proposal: where it may still be held, from its exposure record. */
export type Abandoned = { hash: string; version: number; hub: boolean; machines: string[] };
export type SigningFile = {
  version: 1;
  pending: Pending | null;
  deliveries: Obligation[];
  abandoned: Abandoned[];
  lastAsked: string | null;
  lastNotified: string | null;
};

export type AccessFile =
  | { version: 1; hub: string; kind: 'access'; token: string; expires: string; email: string | null }
  | { version: 1; hub: string; kind: 'standin'; user: string };

const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;

export type DirectoryCheck = { ok: true } | { ok: false; detail: string };

/** Whether `dir` is a private directory of `uid`: no symlink, a directory, owned by `uid`, mode 700 or narrower. */
export async function checkPrivateDirectory(dir: string, uid: number): Promise<DirectoryCheck | null> {
  let stat;
  try {
    stat = await lstat(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    return { ok: false, detail: `${dir} does not read (${(error as Error).message})` };
  }
  if (stat.isSymbolicLink()) return { ok: false, detail: `${dir} is a symlink` };
  if (!stat.isDirectory()) return { ok: false, detail: `${dir} is not a directory` };
  if (stat.uid !== uid) return { ok: false, detail: `${dir} is owned by uid ${stat.uid}` };
  if ((stat.mode & 0o077) !== 0) return { ok: false, detail: `${dir} is mode ${(stat.mode & 0o777).toString(8)}, wider than 700` };
  return { ok: true };
}

export interface OrgFiles {
  readonly dir: string;
  /** null: the directory doesn't exist; else its check. */
  check(): Promise<DirectoryCheck | null>;
  /** Makes the directory (0700), excluded from Time Machine at its creation, best effort; then checks it. */
  ensure(): Promise<DirectoryCheck>;
  read(name: string): Promise<unknown | null>;
  write(name: string, value: unknown): Promise<void>;
  remove(name: string): Promise<void>;
}

export function orgFiles(input: { userData: string; uid?: number; excludeFromBackup?(path: string): Promise<boolean>; log(line: string): void }): OrgFiles {
  const dir = join(input.userData, ORG_DIR);
  const uid = input.uid ?? process.getuid!();
  return {
    dir,
    check: () => checkPrivateDirectory(dir, uid),
    async ensure() {
      const before = await checkPrivateDirectory(dir, uid);
      if (before !== null) return before;
      await mkdir(dir, { recursive: true, mode: DIRECTORY_MODE });
      const made = await checkPrivateDirectory(dir, uid);
      if (made === null) return { ok: false, detail: `${dir} vanished after it was made` };
      if (made.ok && input.excludeFromBackup !== undefined) {
        await input.excludeFromBackup(dir).catch((error: unknown) => input.log(`could not exclude ${dir} from Time Machine: ${(error as Error).message}`));
      }
      return made;
    },
    async read(name) {
      const file = join(dir, name);
      try {
        const text = await readPrivateFile(file, uid);
        return text === null ? null : (JSON.parse(text) as unknown);
      } catch (error) {
        input.log(`${file} does not read, treated as absent: ${(error as Error).message}`);
        return null;
      }
    },
    write: (name, value) => writePrivateFile(dir, name, `${JSON.stringify(value)}\n`),
    remove: (name) => rm(join(dir, name), { force: true }),
  };
}

async function readPrivateFile(file: string, uid: number): Promise<string | null> {
  let handle: FileHandle;
  try {
    handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return null;
    if (code === 'ELOOP') throw new Error('is a symlink', { cause: error });
    throw error;
  }
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error('is not a regular file');
    if (stat.uid !== uid) throw new Error(`is owned by uid ${stat.uid}`);
    if ((stat.mode & 0o077) !== 0) throw new Error(`is mode ${(stat.mode & 0o777).toString(8)}, wider than 600`);
    return await handle.readFile('utf8');
  } finally {
    await handle.close();
  }
}

async function writePrivateFile(dir: string, name: string, text: string): Promise<void> {
  const temp = join(dir, `.${name}-${process.pid}-${crypto.randomUUID()}`);
  const handle = await open(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, FILE_MODE);
  try {
    await handle.writeFile(text);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temp, join(dir, name));
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
  const directory = await open(dir, constants.O_RDONLY);
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

// The shapes, read strictly enough that a field the session relies on is there and of its type.
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === 'string' && value !== '';
const isVersion = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 1;

export function isAnchor(value: unknown): value is Anchor {
  return isObject(value) && isText(value.genesis) && isVersion(value.version) && isText(value.head);
}

export function isRegistrationFile(value: unknown): value is RegistrationFile {
  if (!isObject(value) || value.version !== 1) return false;
  const { hub, org, member, device, pins, anchor, registered, signedOut } = value;
  return (
    isText(hub) &&
    isText(org) &&
    isObject(member) &&
    isText(member.id) &&
    typeof member.email === 'string' &&
    isText(device) &&
    isObject(pins) &&
    Array.isArray(pins.roots) &&
    pins.roots.every(isText) &&
    isText(pins.recoveryPub) &&
    isAnchor(anchor) &&
    isText(registered) &&
    typeof signedOut === 'boolean' &&
    (value.signing === undefined || value.signing === true) &&
    (value.rekey === undefined || (isObject(value.rekey) && isText(value.rekey.device)))
  );
}

/** The shape only: held.ts verifies every state and transition it holds. */
export function isChainFile(value: unknown): value is ChainFile {
  if (!isObject(value) || value.version !== 1) return false;
  const { chain, transitions, accepted, certificates, highWater, superseded } = value;
  return (
    Array.isArray(chain) &&
    chain.length > 0 &&
    chain.every(isSignedOrgState) &&
    Array.isArray(transitions) &&
    Array.isArray(accepted) &&
    isCertificates(certificates) &&
    isVersion(highWater) &&
    Array.isArray(superseded) &&
    superseded.every(isSignedOrgState)
  );
}

export function isAccessFile(value: unknown): value is AccessFile {
  if (!isObject(value) || value.version !== 1 || !isText(value.hub)) return false;
  if (value.kind === 'access') return isText(value.token) && isText(value.expires) && (value.email === null || typeof value.email === 'string');
  return value.kind === 'standin' && isText(value.user);
}

const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0;
const isTexts = (value: unknown): value is string[] => Array.isArray(value) && value.every(isText);
const isInstantOrNull = (value: unknown): value is string | null => value === null || isText(value);
const isRecordOf = <T>(value: unknown, item: (v: unknown) => v is T): value is Record<string, T> => isObject(value) && Object.values(value).every(item);

function isPending(value: unknown): value is Pending {
  if (!isObject(value) || !isSignedOrgState(value.signed) || !isText(value.parent) || !isObject(value.exposed)) return false;
  return typeof value.exposed.hub === 'boolean' && isTexts(value.exposed.machines);
}

function isObligation(value: unknown): value is Obligation {
  if (!isObject(value)) return false;
  const { hash, signed, owed, known, probed, tooLarge } = value;
  const isCursor = (c: unknown): c is { version: number; line: number } => isObject(c) && isVersion(c.version) && isCount(c.line);
  return isText(hash) && isSignedOrgState(signed) && isTexts(owed) && isRecordOf(known, isCursor) && isRecordOf(probed, isCount) && isTexts(tooLarge);
}

function isAbandoned(value: unknown): value is Abandoned {
  return isObject(value) && isText(value.hash) && isVersion(value.version) && typeof value.hub === 'boolean' && isTexts(value.machines);
}

/** The shape only, every field: the signing store refuses to write anything else, and reads anything else as damaged. */
export function isSigningFile(value: unknown): value is SigningFile {
  if (!isObject(value) || value.version !== 1) return false;
  const { pending, deliveries, abandoned, lastAsked, lastNotified } = value;
  return (
    (pending === null || isPending(pending)) &&
    Array.isArray(deliveries) &&
    deliveries.every(isObligation) &&
    Array.isArray(abandoned) &&
    abandoned.every(isAbandoned) &&
    isInstantOrNull(lastAsked) &&
    isInstantOrNull(lastNotified)
  );
}
