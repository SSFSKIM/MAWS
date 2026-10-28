// The deployment admin device's files (P5 O13 M2, §F; RL DL28): its keys file, where that file and the org's recovery key
// may be written, and the recovery key itself, which leaves this machine at genesis and is checked back before anything
// is signed.
//
// The keys file is `{device: "<id>", keys: {"<id>.channel": jwk, "<id>.stepUp": jwk}}` (private P-256 JWKs, 0600), the
// staging test device's shape (org-admin.ts) without the recovery key: a file with no `device` names `a1`, as that one
// does. It is read here and nowhere printed, a malformed one included (readJsonFile).
import { execFileSync } from 'node:child_process';
import { createECDH, randomBytes } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { base64urlEncode, generateSigningKey, importSigningKey, type SigningKey } from 'org-protocol';
import { parseJsonFile, readJsonFile } from '../fake-machine/json-file';

/** The admin device: its channel key and its step-up key, which signs the org's states as a root key. */
export type AdminKeys = { id: string; channel: SigningKey; stepUp: SigningKey };

/** The device id a keys file without one names: the staging test device's (org-admin.ts, loadAdminDevice). */
const DEFAULT_ID = 'a1';

/**
 * Where a file may not be: what a sweep deletes (`/tmp`, `/private/tmp`, `$TMPDIR`) and what a sync or a backup carries
 * off the machine (`~/.claude`, `~/Library/Mobile Documents`, `~/.config/claude-secrets`). `tmpRoots` and `home` are
 * the machine's own unless a suite names others.
 */
export type Placement = { home: string; tmpRoots: string[] };

export function machinePlacement(env: Record<string, string | undefined>, home: string): Placement {
  return { home, tmpRoots: ['/tmp', '/private/tmp', ...(env.TMPDIR ? [env.TMPDIR] : [])] };
}

/** The sync and backup scopes under `home`. */
export const syncScopes = (home: string) => [join(home, '.claude'), join(home, 'Library', 'Mobile Documents'), join(home, '.config', 'claude-secrets')];

/** `path` with every symbolic link resolved, the part that does not exist yet appended as named. */
export function realPath(path: string): string {
  const absolute = resolve(path);
  const rest: string[] = [];
  let at = absolute;
  for (;;) {
    try {
      return join(realpathSync(at), ...rest.reverse());
    } catch {
      const parent = dirname(at);
      if (parent === at) return absolute;
      rest.push(basename(at));
      at = parent;
    }
  }
}

const within = (path: string, root: string) => {
  const r = realPath(root);
  return path === r || path.startsWith(r.endsWith(sep) ? r : r + sep);
};

/** The git work tree `path` lies in, or null: the nearest ancestor holding a `.git` (a directory, or a worktree's file). */
function workTreeOf(path: string): string | null {
  for (let at = dirname(path); ; at = dirname(at)) {
    if (existsSync(join(at, '.git'))) return at;
    if (dirname(at) === at) return null;
  }
}

/** Why a keys file may not be written at `path`, or null when it may. */
export function keysPlacementProblem(path: string, placement: Placement): string | null {
  const real = realPath(path);
  const tmp = placement.tmpRoots.find((root) => within(real, root));
  if (tmp) return `${path} is under ${tmp}, which a sweep empties: the admin key must outlive it`;
  const tree = workTreeOf(real);
  if (tree) return `${path} is inside the git work tree ${tree}, where a commit could carry the key`;
  const scope = syncScopes(placement.home).find((root) => within(real, root));
  if (scope) return `${path} is under ${scope}, which is synced or backed up off this machine`;
  return null;
}

/** What the recovery key's destination rule asks of a volume: its identity, and whether it is removable or external. */
export type VolumeCheck = { of: (path: string) => unknown; removable: (path: string) => boolean; required: boolean };

/**
 * Why the recovery key may not be written at `path` (RL DL28: never on the admin key's disk, never in a sync or backup
 * scope; the owner's medium, 2026-10-28: a removable volume mounted at genesis), or null. The volume rules hold only
 * against a deployment, since the suites' destination stands for a volume no test mounts: there the destination must be
 * on another volume than the keys and on removable or external media (an internal disk's second volume is neither).
 */
export function recoveryPlacementProblem(path: string, keysFile: string, placement: Placement, volume: VolumeCheck): string | null {
  const real = realPath(path);
  if (within(real, dirname(realPath(keysFile)))) return `${path} is beside the admin keys: the recovery key never shares their disk`;
  const scope = syncScopes(placement.home).find((root) => within(real, root));
  if (scope) return `${path} is under ${scope}, which is synced or backed up off this machine`;
  if (!volume.required) return null;
  if (volume.of(path) === volume.of(keysFile)) return `${path} is on the same volume as the admin keys: name a path on the removable volume mounted for this step`;
  let removable: boolean;
  try {
    removable = volume.removable(path);
  } catch (error) {
    return `could not tell whether ${path} is on removable media (${error instanceof Error ? error.message : String(error)})`;
  }
  if (!removable) return `${path} is not on removable or external media: name a path on the removable volume (a USB drive, say; not a mounted disk image) mounted for this step`;
  return null;
}

/** `path`, or its nearest ancestor that exists. */
function nearestExisting(path: string): string {
  for (let at = resolve(path); ; at = dirname(at)) {
    if (existsSync(at)) return at;
    if (dirname(at) === at) throw new Error(`no volume holds ${path}`);
  }
}

/** The volume a path is on: the device of its nearest existing ancestor. */
export function volumeOf(path: string): number {
  return statSync(nearestExisting(path)).dev;
}

/**
 * Whether `path` is on removable or external media, as Disk Utility reports its volume (`df` names the device,
 * `diskutil info -plist` describes it): removable, ejectable, or not internal, and not a mounted disk image. Throws when
 * it cannot be told.
 */
export function isRemovableVolume(path: string): boolean {
  const device = execFileSync('df', ['-P', nearestExisting(path)], { encoding: 'utf8' }).trim().split('\n').at(-1)!.split(/\s+/)[0];
  if (!device.startsWith('/dev/')) throw new Error(`${path} is on ${device}, not a disk`);
  const plist = execFileSync('diskutil', ['info', '-plist', device]);
  const info = JSON.parse(execFileSync('plutil', ['-convert', 'json', '-o', '-', '-'], { input: plist, encoding: 'utf8' })) as Record<string, unknown>;
  // A mounted disk image reports itself removable and external, but its file sits on whatever disk holds it.
  if (info.BusProtocol === 'Disk Image') return false;
  return info.RemovableMediaOrExternalDevice === true || info.RemovableMedia === true || info.Ejectable === true || info.Internal === false;
}

/** Writes `text` to a new file at `path`, 0600; an existing file is never written over (EEXIST). */
export function writeNewFile(path: string, text: string): void {
  const fd = openSync(path, 'wx', 0o600);
  try {
    writeSync(fd, text);
  } finally {
    closeSync(fd);
  }
}

/**
 * A new admin device's keys file at `path`: a fresh id, channel key and step-up key. The file is made empty first (an
 * exclusive create, 0600) and handed to `exclude` (Time Machine's exclusion) before any key is in it; when `exclude`
 * throws, the empty file is removed and no key was ever written. Refuses an existing file.
 */
export async function writeAdminKeys(path: string, exclude: (path: string) => Promise<void>): Promise<AdminKeys> {
  const id = `deployment-admin-${randomBytes(6).toString('hex')}`;
  const channel = await generateSigningKey(true);
  const stepUp = await generateSigningKey(true);
  const jwk = async (key: SigningKey) => (await crypto.subtle.exportKey('jwk', key.privateKey)) as JsonWebKey;
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeNewFile(path, '');
  try {
    await exclude(path);
  } catch (error) {
    rmSync(path, { force: true });
    throw error;
  }
  writeFileSync(path, `${JSON.stringify({ device: id, keys: { [`${id}.channel`]: await jwk(channel), [`${id}.stepUp`]: await jwk(stepUp) } })}\n`, { flag: 'r+' });
  return { id, channel: await importSigningKey(await jwk(channel)), stepUp: await importSigningKey(await jwk(stepUp)) };
}

/** The admin device in a keys file. */
export async function readAdminKeys(path: string): Promise<AdminKeys> {
  const file = readJsonFile<{ device?: unknown; keys?: Record<string, JsonWebKey> } | null>(path, "the admin device's keys") ?? {};
  const id = file.device === undefined ? DEFAULT_ID : file.device;
  if (typeof id !== 'string' || id === '') throw new Error(`${path} names no device`);
  const jwk = (name: string) => {
    const key = file.keys?.[name];
    if (!key) throw new Error(`${path} holds no "${name}" key`);
    return key;
  };
  return { id, channel: await importSigningKey(jwk(`${id}.channel`)), stepUp: await importSigningKey(jwk(`${id}.stepUp`)) };
}

// ---- The org's recovery key -------------------------------------------------------------------------------------

/** A recovery key as genesis makes it: its public point and its private JWK, which only its destination keeps. */
export type RecoveryKey = { pub: string; jwk: JsonWebKey };

export async function newRecoveryKey(): Promise<RecoveryKey> {
  const key = await generateSigningKey(true);
  return { pub: key.pub, jwk: (await crypto.subtle.exportKey('jwk', key.privateKey)) as JsonWebKey };
}

/** The public point a private scalar (base64url, 32 bytes) makes, or null when it is not one. */
export function pointOf(d: string): string | null {
  try {
    const scalar = Buffer.from(d, 'base64url');
    if (scalar.length !== 32 || scalar.toString('base64url') !== d) return null;
    const ecdh = createECDH('prime256v1');
    ecdh.setPrivateKey(scalar);
    return base64urlEncode(new Uint8Array(ecdh.getPublicKey()));
  } catch {
    return null;
  }
}

/** The recovery key file: `{org, hub, recoveryPub, key}`, `key` the private JWK. */
export const recoveryFileText = (key: RecoveryKey, org: string, hub: string) => `${JSON.stringify({ org, hub, recoveryPub: key.pub, key: key.jwk })}\n`;

/**
 * Whether the recovery key file's text holds the private half of `recoveryPub`: its scalar makes that point, and so do
 * its stated coordinates. A file that does not parse, or holds another key, is not it.
 */
export function holdsRecoveryKey(text: string, path: string, recoveryPub: string): boolean {
  let file: { key?: JsonWebKey } | null;
  try {
    file = parseJsonFile<{ key?: JsonWebKey } | null>(text, path, 'a recovery key');
  } catch {
    return false;
  }
  const key = file?.key;
  if (typeof key?.d !== 'string' || typeof key.x !== 'string' || typeof key.y !== 'string') return false;
  const stated = base64urlEncode(Uint8Array.from([4, ...Buffer.from(key.x, 'base64url'), ...Buffer.from(key.y, 'base64url')]));
  return pointOf(key.d) === recoveryPub && stated === recoveryPub;
}

/** The private scalar as the owner writes it down: base64url in groups of four. */
export const paperText = (key: RecoveryKey) => (key.jwk.d as string).match(/.{1,4}/g)!.join(' ');

/** Whether what the owner typed back is the private scalar of `recoveryPub` (spaces ignored). */
export const typedBackMatches = (typed: string, recoveryPub: string) => pointOf(typed.replace(/\s+/g, '')) === recoveryPub;

/** `path`'s text, as the read-back reads it. */
export const readText = (path: string) => readFileSync(path, 'utf8');
