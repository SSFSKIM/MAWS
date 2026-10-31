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
//
// Registering afresh is a rekey (P5-O8 M3, "New keys"). The new pair is made in `keys.next.json`, only once the
// exclusion is known to be set, so it always carries the mark; the old device stays signed in while the org approves
// it. Promotion is two renames, `keys.json` to `keys.retired.json` and then `keys.next.json` to `keys.json`, each made
// durable by syncing the directory. The org session records its intent in registration.json before the first rename,
// replays the promotion after a crash (finding the file that holds the new device id), and destroys the retired file
// once the org no longer lists the old keys as current. A device's id is `keyId(channel.pub)`; no file stores it.
import { constants } from 'node:fs';
import { link, lstat, mkdir, open, rename, rm, type FileHandle } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { generateSigningKey, importSigningKey, keyId, type B64, type SigningKey } from '../../../apps/org-protocol/src/index.ts';
import { excludeFromBackup } from '@shared/fs/backup-exclusion';

export type DeviceKeys = {
  keyStorage: 'software';
  /** Signs RL2 handshakes (`openChannel`'s `channelKey`). */
  channel: SigningKey;
  /** Signs an action's step-up, only through step-up.ts. */
  stepUp: SigningKey;
  /** The keys were made after `device/` was excluded from Time Machine, so no backup can hold them. */
  excludedFromBackupAtCreation: boolean;
};

/** `not-excluded`: next keys were asked for where `device/` could not be excluded from Time Machine, so none were made. */
export type DeviceKeysRefusal = 'symlink' | 'owner' | 'not-private' | 'not-a-directory' | 'not-a-file' | 'malformed' | 'not-excluded';

export type DeviceKeysDeps = { uid?: number; now?: () => Date; excludeFromBackup?: (path: string) => Promise<boolean> };

/** The key files of `device/`: the device's own keys, a rekey's next keys, and the keys a rekey retired. */
export type DeviceKeyFile = 'current' | 'next' | 'retired';
/** What a key file holds, by the ids the org state lists it under. */
export type DeviceKeyIds = { device: string; channelPub: B64; stepUpPub: B64 };

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
const FILE_NAMES: Record<DeviceKeyFile, string> = { current: 'keys.json', next: 'keys.next.json', retired: 'keys.retired.json' };

const deviceDirectory = (profile: string) => join(profile, 'device');
const keyFile = (profile: string, which: DeviceKeyFile) => join(deviceDirectory(profile), FILE_NAMES[which]);

// Every read or change of a profile's key files runs in that profile's queue, one at a time, and acts only on what it
// finds once its turn comes. A caller that checks a file and then acts on the check can't be overtaken in between: two
// finishers of one promotion would otherwise retire the keys the other had just installed. Main is one process, and the
// profile's single-instance lock keeps any other process off these files.
const queues = new Map<string, Promise<unknown>>();

function serialized<T>(profile: string, body: () => Promise<T>): Promise<T> {
  const key = resolve(deviceDirectory(profile));
  const run = (queues.get(key) ?? Promise.resolve()).then(body);
  const tail = run.then(
    () => {},
    () => {},
  );
  queues.set(key, tail);
  void tail.then(() => {
    if (queues.get(key) === tail) queues.delete(key);
  });
  return run;
}

/**
 * The device's keys under `profile` (main's userData), made on the first load. A promotion a crash cut off between its
 * renames (no `keys.json`, a `keys.next.json`) is finished rather than a new pair made.
 */
export async function loadDeviceKeys(profile: string, deps: DeviceKeysDeps = {}): Promise<DeviceKeys> {
  const uid = deps.uid ?? process.getuid!();
  const dir = await privateDeviceDirectory(profile, uid);
  const excluded = await (deps.excludeFromBackup ?? excludeFromBackup)(dir).catch((error: unknown) => {
    console.warn(`[device-keys] could not exclude ${dir} from Time Machine: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  });
  return serialized(profile, async () => {
    const file = keyFile(profile, 'current');
    const existing = await readPrivateFile(file, uid);
    if (existing !== null) return fromFile(existing, file);
    if (await present(keyFile(profile, 'next'))) await renameDurably(dir, keyFile(profile, 'next'), file);
    else await createKeysFile(dir, file, (deps.now ?? (() => new Date()))(), excluded);
    // Whichever first load linked its file into place (another process's, should one get past the profile lock), every
    // load reads that one.
    const created = await readPrivateFile(file, uid);
    if (created === null) throw new DeviceKeysError('malformed', file, 'vanished after it was written');
    return fromFile(created, file);
  });
}

/**
 * A rekey's new keys, in `device/keys.next.json`, made only after `device/` is excluded from Time Machine, so they always
 * carry `excludedFromBackupAtCreation`. A failed exclusion, or none possible here, refuses `not-excluded` and writes
 * nothing. Next keys an earlier attempt left are replaced: nothing promotes them before the org session records their
 * id, and it records it only after this returns.
 */
export async function createNextDeviceKeys(profile: string, deps: DeviceKeysDeps = {}): Promise<DeviceKeys> {
  const uid = deps.uid ?? process.getuid!();
  const dir = await privateDeviceDirectory(profile, uid);
  let excluded: boolean;
  try {
    excluded = await (deps.excludeFromBackup ?? excludeFromBackup)(dir);
  } catch (error) {
    throw new DeviceKeysError('not-excluded', dir, `could not be excluded from Time Machine: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!excluded) throw new DeviceKeysError('not-excluded', dir, 'has no Time Machine exclusion on this system');
  const file = keyFile(profile, 'next');
  const temp = await writeTempKeysFile(dir, (deps.now ?? (() => new Date()))(), true);
  return serialized(profile, async () => {
    try {
      await rename(temp, file);
    } finally {
      await rm(temp, { force: true });
    }
    await syncDirectory(dir);
    const created = await readPrivateFile(file, uid);
    if (created === null) throw new DeviceKeysError('malformed', file, 'vanished after it was written');
    return fromFile(created, file);
  });
}

/** Deletes a rekey's next keys: an attempt that ended before the org session recorded their id. */
export function discardNextDeviceKeys(profile: string, deps: Pick<DeviceKeysDeps, 'uid'> = {}): Promise<void> {
  const uid = deps.uid ?? process.getuid!();
  return serialized(profile, () => removeDurably(profile, 'next', uid));
}

/**
 * Promotes a rekey's next keys: `keys.json` becomes `keys.retired.json`, then `keys.next.json` becomes `keys.json`, the
 * directory synced after each. It completes whatever a crash left undone, and once both renames are done it only syncs
 * the directory (a rename a crashed run made may not be durable yet), so the org session's replay calls it as its
 * forward path does, once `findDeviceKeys` has placed the new id, and writes registration.json only after it returns. A
 * retired file an earlier rekey left is replaced, its keys destroyed early: a destruction only narrows what can sign.
 */
export function promoteNextDeviceKeys(profile: string, deps: Pick<DeviceKeysDeps, 'uid'> = {}): Promise<void> {
  const uid = deps.uid ?? process.getuid!();
  return serialized(profile, async () => {
    const dir = await privateDeviceDirectory(profile, uid);
    if (!(await present(keyFile(profile, 'next')))) return syncDirectory(dir);
    if (await present(keyFile(profile, 'current'))) await renameDurably(dir, keyFile(profile, 'current'), keyFile(profile, 'retired'));
    await renameDurably(dir, keyFile(profile, 'next'), keyFile(profile, 'current'));
  });
}

/** Deletes the keys a rekey retired, once the org state no longer lists them as current. */
export function destroyRetiredDeviceKeys(profile: string, deps: Pick<DeviceKeysDeps, 'uid'> = {}): Promise<void> {
  const uid = deps.uid ?? process.getuid!();
  return serialized(profile, () => removeDurably(profile, 'retired', uid));
}

/** The ids of the keys `which` holds, read and checked as a load reads them; null when there is no such file. */
export function deviceKeyIds(profile: string, which: DeviceKeyFile, deps: Pick<DeviceKeysDeps, 'uid'> = {}): Promise<DeviceKeyIds | null> {
  const uid = deps.uid ?? process.getuid!();
  return serialized(profile, () => readKeyIds(profile, which, uid));
}

/** Which of `keys.json` and `keys.next.json` holds the device `device`, read in one turn: the rekey replay's question. */
export function findDeviceKeys(profile: string, device: string, deps: Pick<DeviceKeysDeps, 'uid'> = {}): Promise<'current' | 'next' | null> {
  const uid = deps.uid ?? process.getuid!();
  return serialized(profile, async () => {
    for (const which of ['current', 'next'] as const) {
      if ((await readKeyIds(profile, which, uid))?.device === device) return which;
    }
    return null;
  });
}

async function readKeyIds(profile: string, which: DeviceKeyFile, uid: number): Promise<DeviceKeyIds | null> {
  if (!(await present(deviceDirectory(profile)))) return null;
  await assertPrivateDirectory(deviceDirectory(profile), uid);
  const file = keyFile(profile, which);
  const text = await readPrivateFile(file, uid);
  if (text === null) return null;
  const keys = await fromFile(text, file);
  return { device: await keyId(keys.channel.pub), channelPub: keys.channel.pub, stepUpPub: keys.stepUp.pub };
}

/** `<profile>/device/`, made if absent, and refused unless it is a private directory of this uid's. */
async function privateDeviceDirectory(profile: string, uid: number): Promise<string> {
  const dir = deviceDirectory(profile);
  await mkdir(dir, { recursive: true, mode: DIRECTORY_MODE });
  await assertPrivateDirectory(dir, uid);
  return dir;
}

async function removeDurably(profile: string, which: DeviceKeyFile, uid: number): Promise<void> {
  if (!(await present(deviceDirectory(profile)))) return;
  await assertPrivateDirectory(deviceDirectory(profile), uid);
  await rm(keyFile(profile, which), { force: true });
  await syncDirectory(deviceDirectory(profile));
}

/** Renames within `dir` and syncs it, so the rename survives a crash before anything that follows it is written. */
async function renameDurably(dir: string, from: string, to: string): Promise<void> {
  await rename(from, to);
  await syncDirectory(dir);
}

async function syncDirectory(dir: string): Promise<void> {
  const directory = await open(dir, constants.O_RDONLY);
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

/** Whether anything is at `path`, a symlink included (never followed). */
const present = (path: string) =>
  lstat(path).then(
    () => true,
    (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return false;
      throw error;
    },
  );

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
  const temp = await writeTempKeysFile(dir, now, excluded);
  try {
    await link(temp, file); // fails when another first load got there first: its keys stand
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  } finally {
    await rm(temp, { force: true });
  }
  await syncDirectory(dir);
}

/** A new key file, written and synced at a temporary name in `dir`; the caller moves it into place and removes the name. */
async function writeTempKeysFile(dir: string, now: Date, excluded: boolean): Promise<string> {
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
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  } finally {
    await handle.close();
  }
  return temp;
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
