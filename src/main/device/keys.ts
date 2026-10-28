// The device's software keys (P5-O10 M9; the remote layer's §5.1 for an unsigned build): a channel key, which signs RL2
// handshakes and routine actions, and a step-up key, which signs execution-grade actions once the person has confirmed
// them (step-up.ts). Both are P-256, kept as private JWKs in `<profile>/device/keys.json` (0600) inside
// `<profile>/device/` (0700), and recorded in the org state as `keyStorage: 'software'`. They live in main and never
// reach the renderer: main imports them non-extractable, so even the key objects it holds cannot give the bytes back.
//
// A load refuses, and never repairs, a key file or directory that is a symlink, another uid's, or open to group or
// other: a widened key may have been read, and a replaced one would leave the org state listing keys this device no
// longer holds. A file that is not a key file is refused too, and left for the person to look at. The first load writes
// the file at a temporary name and links it into place, so two first loads at once keep one pair.
//
// The keys stay out of Time Machine: once the device is an org root, the org's recovery key is its backup (the remote
// layer's Decision Log 28), so a root key must not be backed up a second time. Every load excludes `device/` itself, a
// sticky exclusion that covers whatever is linked into it; it comes before a first load writes the key file, so that
// file is never eligible, and on later loads it reaches a file written before the exclusion existed. A failed exclusion
// is logged and the load goes on: the device keeps its keys, and the next load asks again. A file made after its
// exclusion was set says so (`excludedFromBackupAtCreation: true`), and nothing adds that mark later: a key made before
// the exclusion, or while it failed, may already sit in a backup, and O8 has it registered afresh before it can be a root.
import { constants } from 'node:fs';
import { link, lstat, mkdir, open, rm, type FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import { generateSigningKey, importSigningKey, type B64, type SigningKey } from '../../../apps/org-protocol/src/index.ts';
import { excludeFromBackup } from './backup-exclusion';

export type DeviceKeys = {
  keyStorage: 'software';
  /** Signs RL2 handshakes (`openChannel`'s `channelKey`). */
  channel: SigningKey;
  /** Signs an action's step-up, only through step-up.ts. */
  stepUp: SigningKey;
  /** The keys were made after `device/` was excluded from Time Machine, so no backup can hold them. */
  excludedFromBackupAtCreation: boolean;
};

export type DeviceKeysRefusal = 'symlink' | 'owner' | 'not-private' | 'not-a-directory' | 'not-a-file' | 'malformed';

export class DeviceKeysError extends Error {
  readonly reason: DeviceKeysRefusal;
  readonly path: string;

  constructor(reason: DeviceKeysRefusal, path: string, detail: string) {
    super(`device keys: ${path} ${detail}`);
    this.name = 'DeviceKeysError';
    this.reason = reason;
    this.path = path;
  }
}

type KeyRecord = { jwk: JsonWebKey; pub: B64; created: string };
/** `excludedFromBackupAtCreation` is written only as `true`; a file without it (older, or made while the exclusion failed) has no claim. */
type KeysFile = { version: 1; keyStorage: 'software'; channel: KeyRecord; stepUp: KeyRecord; excludedFromBackupAtCreation?: true };

const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;

/** The device's keys under `profile` (main's userData), made on the first load. */
export async function loadDeviceKeys(
  profile: string,
  deps: { uid?: number; now?: () => Date; excludeFromBackup?: (path: string) => Promise<boolean> } = {},
): Promise<DeviceKeys> {
  const uid = deps.uid ?? process.getuid!();
  const dir = join(profile, 'device');
  await mkdir(dir, { recursive: true, mode: DIRECTORY_MODE });
  await assertPrivateDirectory(dir, uid);
  const excluded = await (deps.excludeFromBackup ?? excludeFromBackup)(dir).catch((error: unknown) => {
    console.warn(`[device-keys] could not exclude ${dir} from Time Machine: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  });
  const file = join(dir, 'keys.json');
  const existing = await readPrivateFile(file, uid);
  if (existing !== null) return fromFile(existing, file);
  await createKeysFile(dir, file, (deps.now ?? (() => new Date()))(), excluded);
  // Whichever first load linked its file into place, every load reads that one.
  const created = await readPrivateFile(file, uid);
  if (created === null) throw new DeviceKeysError('malformed', file, 'vanished after it was written');
  return fromFile(created, file);
}

async function assertPrivateDirectory(dir: string, uid: number): Promise<void> {
  const stat = await lstat(dir);
  if (stat.isSymbolicLink()) throw new DeviceKeysError('symlink', dir, 'is a symlink');
  if (!stat.isDirectory()) throw new DeviceKeysError('not-a-directory', dir, 'is not a directory');
  if (stat.uid !== uid) throw new DeviceKeysError('owner', dir, `is owned by uid ${stat.uid}`);
  if ((stat.mode & 0o077) !== 0) throw new DeviceKeysError('not-private', dir, `is mode ${(stat.mode & 0o777).toString(8)}, wider than 700`);
}

/** The file's text, checked on the descriptor it is read from (no symlink followed); null when there is none. */
async function readPrivateFile(file: string, uid: number): Promise<string | null> {
  let handle: FileHandle;
  try {
    handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return null;
    if (code === 'ELOOP') throw new DeviceKeysError('symlink', file, 'is a symlink');
    throw error;
  }
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new DeviceKeysError('not-a-file', file, 'is not a regular file');
    if (stat.uid !== uid) throw new DeviceKeysError('owner', file, `is owned by uid ${stat.uid}`);
    if ((stat.mode & 0o077) !== 0) throw new DeviceKeysError('not-private', file, `is mode ${(stat.mode & 0o777).toString(8)}, wider than 600`);
    return await handle.readFile('utf8');
  } finally {
    await handle.close();
  }
}

async function createKeysFile(dir: string, file: string, now: Date, excluded: boolean): Promise<void> {
  const record = async (): Promise<KeyRecord> => {
    const key = await generateSigningKey(true);
    return { jwk: await crypto.subtle.exportKey('jwk', key.privateKey), pub: key.pub, created: now.toISOString() };
  };
  const contents: KeysFile = {
    version: 1,
    keyStorage: 'software',
    channel: await record(),
    stepUp: await record(),
    ...(excluded ? { excludedFromBackupAtCreation: true as const } : {}),
  };
  const temp = join(dir, `.keys-${process.pid}-${crypto.randomUUID()}.json`);
  const handle = await open(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, FILE_MODE);
  try {
    await handle.writeFile(`${JSON.stringify(contents)}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await link(temp, file); // fails when another first load got there first: its keys stand
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  } finally {
    await rm(temp, { force: true });
  }
  const directory = await open(dir, constants.O_RDONLY);
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

async function fromFile(text: string, file: string): Promise<DeviceKeys> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new DeviceKeysError('malformed', file, 'is not JSON');
  }
  const value = parsed as Partial<KeysFile> | null;
  if (typeof value !== 'object' || value === null || value.version !== 1 || value.keyStorage !== 'software') {
    throw new DeviceKeysError('malformed', file, 'is not a version 1 software key file');
  }
  return {
    keyStorage: 'software',
    channel: await keyOf(value.channel, 'channel', file),
    stepUp: await keyOf(value.stepUp, 'stepUp', file),
    excludedFromBackupAtCreation: value.excludedFromBackupAtCreation === true,
  };
}

async function keyOf(record: KeyRecord | undefined, name: string, file: string): Promise<SigningKey> {
  let key: SigningKey;
  try {
    key = await importSigningKey(record!.jwk);
  } catch {
    throw new DeviceKeysError('malformed', file, `holds no private P-256 key for ${name}`);
  }
  if (key.pub !== record!.pub) throw new DeviceKeysError('malformed', file, `holds a ${name} public key that is not its private key's`);
  return key;
}
