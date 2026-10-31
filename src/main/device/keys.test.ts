// The device's software keys (P5-O10 M9, acceptance 6's device half): a channel key and a step-up key in
// `<profile>/device/keys.json` (0600) inside `<profile>/device/` (0700), refused at load when either is widened, a
// symlink or another uid's, and signing what org-protocol verifies: an RL2 handshake and an RL4 step-up.
import { chmod, lstat, mkdir, mkdtemp, readdir, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  acceptChannel,
  generateSigningKey,
  keyId,
  memoryOrgView,
  openChannel,
  signOrgState,
  signStepUp,
  verifyStepUp,
  type Action,
  type OrgState,
} from '../../../apps/org-protocol/src/index.ts';
import { duplexPair } from '../../../apps/org-protocol/test-support/tamper-relay.ts';
import { excludeFromBackup } from '@shared/fs/backup-exclusion';
import {
  createNextDeviceKeys,
  destroyRetiredDeviceKeys,
  deviceKeyIds,
  DeviceKeysError,
  discardNextDeviceKeys,
  findDeviceKeys,
  loadDeviceKeys,
  promoteNextDeviceKeys,
  type DeviceKeys,
} from './keys';

// The file system as keys.ts sees it, unchanged unless a test sets a hook: `before` may hold a call, `after` sees one
// done (or failed: an open of an absent file is a read too), so two callers acting on the same key files can be
// interleaved deterministically.
type FsOp = 'lstat' | 'open' | 'rename';
const fsHooks = vi.hoisted(() => ({
  before: null as null | ((op: FsOp, path: string, to?: string) => Promise<void>),
  after: null as null | ((op: FsOp, path: string, to?: string) => void),
}));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  const hooked =
    <A extends unknown[], R>(op: FsOp, call: (...args: A) => Promise<R>) =>
    async (...args: A): Promise<R> => {
      const [path, to] = [String(args[0]), op === 'rename' ? String(args[1]) : undefined];
      await fsHooks.before?.(op, path, to);
      try {
        return await call(...args);
      } finally {
        fsHooks.after?.(op, path, to);
      }
    };
  return { ...actual, lstat: hooked('lstat', actual.lstat), open: hooked('open', actual.open), rename: hooked('rename', actual.rename) };
});

let profile: string;
const deviceDir = () => join(profile, 'device');
const keysFile = () => join(deviceDir(), 'keys.json');
const nextFile = () => join(deviceDir(), 'keys.next.json');
const retiredFile = () => join(deviceDir(), 'keys.retired.json');
const exists = (path: string) => lstat(path).then(() => true, () => false);
const mode = async (path: string) => (await lstat(path)).mode & 0o777;

beforeEach(async () => {
  profile = await mkdtemp(join(tmpdir(), 'maws-device-keys-'));
});
afterEach(async () => {
  fsHooks.before = null;
  fsHooks.after = null;
  await rm(profile, { recursive: true, force: true });
});

const refusal = async (load: Promise<unknown>) => {
  const error = await load.then(() => null, (caught: unknown) => caught);
  expect(error).toBeInstanceOf(DeviceKeysError);
  return (error as DeviceKeysError).reason;
};

describe('the device keys on disk', () => {
  it('are made on first load: a 0700 directory, a 0600 file, two P-256 keys stored as software keys', async () => {
    const keys = await loadDeviceKeys(profile);
    expect(await mode(deviceDir())).toBe(0o700);
    expect(await mode(keysFile())).toBe(0o600);
    expect(keys.keyStorage).toBe('software');
    expect(keys.channel.pub).not.toBe(keys.stepUp.pub);
    const stored = JSON.parse(await readFile(keysFile(), 'utf8')) as Record<string, unknown>;
    expect(stored).toMatchObject({ version: 1, keyStorage: 'software', channel: { pub: keys.channel.pub }, stepUp: { pub: keys.stepUp.pub } });
  });

  it('are the same keys on every later load', async () => {
    const first = await loadDeviceKeys(profile);
    const second = await loadDeviceKeys(profile);
    expect([second.channel.pub, second.stepUp.pub]).toEqual([first.channel.pub, first.stepUp.pub]);
  });

  it('are one pair when two first loads race', async () => {
    const [a, b] = await Promise.all([loadDeviceKeys(profile), loadDeviceKeys(profile)]);
    expect([a.channel.pub, a.stepUp.pub]).toEqual([b.channel.pub, b.stepUp.pub]);
    const stored = JSON.parse(await readFile(keysFile(), 'utf8')) as { channel: { pub: string } };
    expect(stored.channel.pub).toBe(a.channel.pub);
  });

  it('hand main private keys it cannot export', async () => {
    const keys = await loadDeviceKeys(profile);
    expect(keys.channel.privateKey.extractable).toBe(false);
    expect(keys.stepUp.privateKey.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('jwk', keys.stepUp.privateKey)).rejects.toThrow();
  });

  it('are refused when the file is widened, and the file is left as it was', async () => {
    await loadDeviceKeys(profile);
    const before = await readFile(keysFile(), 'utf8');
    await chmod(keysFile(), 0o644);
    expect(await refusal(loadDeviceKeys(profile))).toBe('not-private');
    expect(await readFile(keysFile(), 'utf8')).toBe(before);
  });

  it('are refused when the directory is widened', async () => {
    await loadDeviceKeys(profile);
    await chmod(deviceDir(), 0o755);
    expect(await refusal(loadDeviceKeys(profile))).toBe('not-private');
  });

  it('are refused, not made, in a directory that already exists widened', async () => {
    await mkdir(deviceDir(), { mode: 0o755 });
    await chmod(deviceDir(), 0o755);
    expect(await refusal(loadDeviceKeys(profile))).toBe('not-private');
    await expect(lstat(keysFile())).rejects.toThrow();
  });

  it('are refused through a symlinked file', async () => {
    await loadDeviceKeys(profile);
    const elsewhere = join(profile, 'elsewhere.json');
    await writeFile(elsewhere, await readFile(keysFile()), { mode: 0o600 });
    await rm(keysFile());
    await symlink(elsewhere, keysFile());
    expect(await refusal(loadDeviceKeys(profile))).toBe('symlink');
  });

  it('are refused through a symlinked directory', async () => {
    const real = join(profile, 'real-device');
    await mkdir(real, { mode: 0o700 });
    await symlink(real, deviceDir());
    expect(await refusal(loadDeviceKeys(profile))).toBe('symlink');
  });

  it('are refused when another uid owns them', async () => {
    await loadDeviceKeys(profile);
    const uid = process.getuid!() + 1;
    expect(await refusal(loadDeviceKeys(profile, { uid }))).toBe('owner');
  });

  it('are refused, not replaced, when the file is not a key file', async () => {
    await loadDeviceKeys(profile);
    await writeFile(keysFile(), '{"version":1}', { mode: 0o600 });
    expect(await refusal(loadDeviceKeys(profile))).toBe('malformed');
    expect(await readFile(keysFile(), 'utf8')).toBe('{"version":1}');
  });

  it('are refused when a stored public key is not its private key’s', async () => {
    await loadDeviceKeys(profile);
    const stored = JSON.parse(await readFile(keysFile(), 'utf8')) as { stepUp: { pub: string } };
    stored.stepUp.pub = (await generateSigningKey()).pub;
    await writeFile(keysFile(), JSON.stringify(stored), { mode: 0o600 });
    expect(await refusal(loadDeviceKeys(profile))).toBe('malformed');
  });
});

describe('the device keys and Time Machine', () => {
  /** Records each exclusion asked for, and whether the key file was there when it was asked. */
  const recorder = () => {
    const calls: { path: string; keyFileExisted: boolean }[] = [];
    const excludeFromBackup = async (path: string) => {
      calls.push({ path, keyFileExisted: await lstat(keysFile()).then(() => true, () => false) });
      return true;
    };
    return { calls, excludeFromBackup };
  };

  it('are kept out of it: the first load excludes the device directory before the key file is written into it', async () => {
    const { calls, excludeFromBackup } = recorder();
    await loadDeviceKeys(profile, { excludeFromBackup });
    expect(calls).toEqual([{ path: deviceDir(), keyFileExisted: false }]);
    expect(await mode(keysFile())).toBe(0o600);
  });

  it('are kept out of it on every later load, so a key file written before the exclusion existed gets it too', async () => {
    await loadDeviceKeys(profile, { excludeFromBackup: async () => true });
    const { calls, excludeFromBackup } = recorder();
    await loadDeviceKeys(profile, { excludeFromBackup });
    expect(calls).toEqual([{ path: deviceDir(), keyFileExisted: true }]);
  });

  it('are still made and loaded when the exclusion fails, which is logged in one line', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const keys = await loadDeviceKeys(profile, { excludeFromBackup: async () => Promise.reject(new Error('tmutil exited 22')) });
      const stored = JSON.parse(await readFile(keysFile(), 'utf8')) as { channel: { pub: string } };
      expect(stored.channel.pub).toBe(keys.channel.pub);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]![0])).toContain(deviceDir());
      expect(String(warn.mock.calls[0]![0])).toContain('tmutil exited 22');
    } finally {
      warn.mockRestore();
    }
  });

  // O8 reads the mark: a key that may already sit in a backup must be registered afresh before it can be an org root.
  const storedMark = async () => (JSON.parse(await readFile(keysFile(), 'utf8')) as Record<string, unknown>).excludedFromBackupAtCreation;

  it('made with the exclusion in place carry the mark that they never were eligible', async () => {
    const keys = await loadDeviceKeys(profile, { excludeFromBackup: async () => true });
    expect(keys.excludedFromBackupAtCreation).toBe(true);
    expect(await storedMark()).toBe(true);
    expect((await loadDeviceKeys(profile, { excludeFromBackup: async () => true })).excludedFromBackupAtCreation).toBe(true);
  });

  it('written before the exclusion existed get it applied but never the mark', async () => {
    await loadDeviceKeys(profile, { excludeFromBackup: async () => true });
    const older = JSON.parse(await readFile(keysFile(), 'utf8')) as Record<string, unknown>;
    delete older.excludedFromBackupAtCreation;
    await writeFile(keysFile(), JSON.stringify(older), { mode: 0o600 });
    const before = await readFile(keysFile(), 'utf8');
    const { calls, excludeFromBackup } = recorder();
    const keys = await loadDeviceKeys(profile, { excludeFromBackup });
    expect(calls).toEqual([{ path: deviceDir(), keyFileExisted: true }]);
    expect(keys.excludedFromBackupAtCreation).toBe(false);
    expect(await readFile(keysFile(), 'utf8')).toBe(before);
  });

  it('made when the exclusion failed carry no mark, and a later exclusion does not add it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const keys = await loadDeviceKeys(profile, { excludeFromBackup: async () => Promise.reject(new Error('timed out')) });
      expect(keys.excludedFromBackupAtCreation).toBe(false);
      expect(await storedMark()).toBeUndefined();
      expect((await loadDeviceKeys(profile, { excludeFromBackup: async () => true })).excludedFromBackupAtCreation).toBe(false);
      expect(await storedMark()).toBeUndefined();
    } finally {
      warn.mockRestore();
    }
  });

  it.runIf(process.platform === 'darwin')('carry no mark when the path excluded is shaped like a script, which osascript takes as data', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const keys = await loadDeviceKeys(profile, { excludeFromBackup: () => excludeFromBackup('-efunction run(){return true;}let device=1;0/device') });
      expect(keys.excludedFromBackupAtCreation).toBe(false);
      expect(await storedMark()).toBeUndefined();
    } finally {
      warn.mockRestore();
    }
  });

  it('made where there is no Time Machine to exclude them from carry no mark', async () => {
    const keys = await loadDeviceKeys(profile, { excludeFromBackup: async () => false });
    expect(keys.excludedFromBackupAtCreation).toBe(false);
    expect(await storedMark()).toBeUndefined();
  });

  it('are not touched when the directory is refused', async () => {
    await mkdir(deviceDir(), { mode: 0o755 });
    await chmod(deviceDir(), 0o755);
    const { calls, excludeFromBackup } = recorder();
    expect(await refusal(loadDeviceKeys(profile, { excludeFromBackup }))).toBe('not-private');
    expect(calls).toEqual([]);
  });
});

describe('what the device keys sign', () => {
  const ORG = 'org-device-keys';
  const MEMBER = '0123456789abcdef0123456789abcdef';
  const REF = 'mref-test-0000001';

  /** A genesis state listing this device (as its member's only device, the org's admin) and one machine. */
  async function orgWith(keys: DeviceKeys) {
    const machineKey = await generateSigningKey();
    const recovery = await generateSigningKey();
    const state: OrgState = {
      org: ORG,
      version: 1,
      prev: null,
      issued: new Date().toISOString(),
      root: { keys: [await keyId(keys.stepUp.pub)], recoveryPub: recovery.pub },
      members: [{ id: MEMBER, email: 'owner@example.com', role: 'admin', devices: [{ id: 'dev-mac', class: 'native-mac', keyStorage: keys.keyStorage, channelPub: keys.channel.pub, stepUpPub: keys.stepUp.pub }] }],
      machines: [{ name: 'mini', ref: REF, pub: machineKey.pub, owners: [MEMBER] }],
      machineNames: [{ name: 'mini', ref: REF }],
      retired: [],
      revoked: [],
      delegations: [],
      projects: [],
    };
    return { head: await signOrgState(state, [keys.stepUp]), machineKey };
  }

  it('an RL2 handshake the endpoint verifies, with the channel key loaded from disk', async () => {
    await loadDeviceKeys(profile);
    const keys = await loadDeviceKeys(profile);
    const { head, machineKey } = await orgWith(keys);
    const [deviceEnd, endpointEnd] = duplexPair();
    const accepting = acceptChannel(endpointEnd, { ref: REF, key: machineKey, build: 'endpoint-test', capabilities: [] }, memoryOrgView({ chain: [head] })).then(async (accepted) => {
      await accepted.channel.send({ t: 'caps', member: accepted.peer.member });
      return accepted;
    });
    const identity = { org: ORG, member: MEMBER, device: 'dev-mac', clientClass: 'native-mac' as const, channelKey: keys.channel, build: 'maws-test', capabilities: [] };
    const [accepted, channel] = await Promise.all([accepting, openChannel(deviceEnd, identity, memoryOrgView({ chain: [head] }), { machine: REF })]);
    expect(accepted.peer).toMatchObject({ member: MEMBER, device: 'dev-mac' });
    channel.close('done');
  });

  it('an RL4 step-up that verifies under the stepUpPub the org state lists', async () => {
    const keys = await loadDeviceKeys(profile);
    const created = new Date().toISOString();
    const action: Action = { v: 1, org: ORG, machine: REF, device: 'dev-mac', opId: 'op-0123456789abcdef', opCreated: created, action: 'sminos.spawn', args: { checkout: '/w' }, nonce: 'AAAAAAAAAAAAAAAAAAAAAA', created };
    expect(await verifyStepUp(await signStepUp(action, keys.stepUp), keys.stepUp.pub)).toEqual({ ok: true });
    expect(await verifyStepUp(await signStepUp(action, keys.channel), keys.stepUp.pub)).toEqual({ ok: false, code: 'bad-signature' });
  });
});

// A rekey (P5-O8 M3, "New keys"): a device whose key file lacks the backup mark, or one the org removed, makes a second
// pair, registers it beside the old device, then promotes it in one transaction that the org session records in
// registration.json and replays after a crash. These are its file primitives. No test here runs the real exclusion.
describe('the next keys (a rekey)', () => {
  const excluded = { excludeFromBackup: async () => true };
  const deviceOf = async (keys: DeviceKeys) => keyId(keys.channel.pub);
  const pubs = (keys: DeviceKeys) => [keys.channel.pub, keys.stepUp.pub];

  it('are made beside the current keys, in a 0600 keys.next.json, only once device/ is excluded, so they carry the mark', async () => {
    const current = await loadDeviceKeys(profile, excluded);
    const before = await readFile(keysFile(), 'utf8');
    const calls: { path: string; nextExisted: boolean }[] = [];
    const next = await createNextDeviceKeys(profile, {
      excludeFromBackup: async (path) => {
        calls.push({ path, nextExisted: await exists(nextFile()) });
        return true;
      },
    });
    expect(calls).toEqual([{ path: deviceDir(), nextExisted: false }]);
    expect(await mode(nextFile())).toBe(0o600);
    expect(next.excludedFromBackupAtCreation).toBe(true);
    const stored = JSON.parse(await readFile(nextFile(), 'utf8')) as Record<string, unknown>;
    expect(stored).toMatchObject({ version: 1, keyStorage: 'software', channel: { pub: next.channel.pub }, stepUp: { pub: next.stepUp.pub }, excludedFromBackupAtCreation: true });
    expect(pubs(next)).not.toEqual(pubs(current));
    expect(await readFile(keysFile(), 'utf8')).toBe(before);
    expect(next.stepUp.privateKey.extractable).toBe(false);
  });

  it('are refused, with nothing written, when the exclusion fails or there is no Time Machine to exclude them from', async () => {
    await loadDeviceKeys(profile, excluded);
    for (const excludeFromBackup of [async () => Promise.reject(new Error('timed out')), async () => false]) {
      expect(await refusal(createNextDeviceKeys(profile, { excludeFromBackup }))).toBe('not-excluded');
      expect(await readdir(deviceDir())).toEqual(['keys.json']);
    }
  });

  it('are refused in a widened directory, before anything is excluded or written', async () => {
    await loadDeviceKeys(profile, excluded);
    await chmod(deviceDir(), 0o755);
    const calls: string[] = [];
    const excludeFromBackup = async (path: string) => {
      calls.push(path);
      return true;
    };
    expect(await refusal(createNextDeviceKeys(profile, { excludeFromBackup }))).toBe('not-private');
    expect(calls).toEqual([]);
    expect(await exists(nextFile())).toBe(false);
  });

  it('replace next keys an earlier attempt left behind, which were never promoted', async () => {
    await loadDeviceKeys(profile, excluded);
    const first = await createNextDeviceKeys(profile, excluded);
    const second = await createNextDeviceKeys(profile, excluded);
    expect(pubs(second)).not.toEqual(pubs(first));
    expect(await findDeviceKeys(profile, await deviceOf(second))).toBe('next');
    expect(await findDeviceKeys(profile, await deviceOf(first))).toBeNull();
    expect((await readdir(deviceDir())).sort()).toEqual(['keys.json', 'keys.next.json']);
  });

  it('are deleted by a cancel before the promotion, and the current keys stand', async () => {
    const current = await loadDeviceKeys(profile, excluded);
    await createNextDeviceKeys(profile, excluded);
    await discardNextDeviceKeys(profile);
    expect(await readdir(deviceDir())).toEqual(['keys.json']);
    expect(pubs(await loadDeviceKeys(profile, excluded))).toEqual(pubs(current));
    await discardNextDeviceKeys(profile); // nothing left to delete
  });

  it('are promoted: keys.json becomes keys.retired.json, keys.next.json becomes keys.json, and a load gives the new keys', async () => {
    const old = await loadDeviceKeys(profile, excluded);
    const next = await createNextDeviceKeys(profile, excluded);
    await promoteNextDeviceKeys(profile);
    expect((await readdir(deviceDir())).sort()).toEqual(['keys.json', 'keys.retired.json']);
    const loaded = await loadDeviceKeys(profile, excluded);
    expect(pubs(loaded)).toEqual(pubs(next));
    expect(loaded.excludedFromBackupAtCreation).toBe(true);
    expect(await deviceKeyIds(profile, 'retired')).toEqual({ device: await deviceOf(old), channelPub: old.channel.pub, stepUpPub: old.stepUp.pub });
    expect(await mode(retiredFile())).toBe(0o600);
  });

  it('are promoted from wherever a crash cut the promotion off, and a finished one is left as it is', async () => {
    const old = await loadDeviceKeys(profile, excluded);
    const next = await createNextDeviceKeys(profile, excluded);
    await rename(keysFile(), retiredFile()); // the first rename done, the second not
    await promoteNextDeviceKeys(profile);
    expect(pubs(await loadDeviceKeys(profile, excluded))).toEqual(pubs(next));
    expect((await deviceKeyIds(profile, 'retired'))?.device).toBe(await deviceOf(old));
    const settled = [await readFile(keysFile(), 'utf8'), await readFile(retiredFile(), 'utf8')];
    await promoteNextDeviceKeys(profile); // both renames done
    expect([await readFile(keysFile(), 'utf8'), await readFile(retiredFile(), 'utf8')]).toEqual(settled);
    expect((await readdir(deviceDir())).sort()).toEqual(['keys.json', 'keys.retired.json']);
  });

  it('are found by device id in keys.json or keys.next.json at each boundary of the promotion', async () => {
    const old = await deviceOf(await loadDeviceKeys(profile, excluded));
    expect(await findDeviceKeys(profile, old)).toBe('current');
    const next = await deviceOf(await createNextDeviceKeys(profile, excluded));
    expect([await findDeviceKeys(profile, old), await findDeviceKeys(profile, next)]).toEqual(['current', 'next']);
    await rename(keysFile(), retiredFile());
    expect([await findDeviceKeys(profile, old), await findDeviceKeys(profile, next)]).toEqual([null, 'next']);
    await promoteNextDeviceKeys(profile);
    expect([await findDeviceKeys(profile, old), await findDeviceKeys(profile, next)]).toEqual([null, 'current']);
  });

  it('are found nowhere when they were lost before the first rename, so the old registration stands', async () => {
    const old = await deviceOf(await loadDeviceKeys(profile, excluded));
    const next = await deviceOf(await createNextDeviceKeys(profile, excluded));
    await rm(nextFile());
    expect([await findDeviceKeys(profile, old), await findDeviceKeys(profile, next)]).toEqual(['current', null]);
  });

  it('are found nowhere in a profile that has no device directory', async () => {
    expect(await findDeviceKeys(profile, 'AAAAAAAAAAAAAAAAAAAAAA')).toBeNull();
    expect(await deviceKeyIds(profile, 'retired')).toBeNull();
  });

  it('are refused, not read, through a symlinked keys.next.json', async () => {
    await loadDeviceKeys(profile, excluded);
    await createNextDeviceKeys(profile, excluded);
    const elsewhere = join(profile, 'elsewhere.json');
    await rename(nextFile(), elsewhere);
    await symlink(elsewhere, nextFile());
    expect(await refusal(findDeviceKeys(profile, 'AAAAAAAAAAAAAAAAAAAAAA'))).toBe('symlink');
  });

  it('finish a promotion a crash cut off when the keys are next loaded, rather than making a third pair', async () => {
    await loadDeviceKeys(profile, excluded);
    const next = await createNextDeviceKeys(profile, excluded);
    await rename(keysFile(), retiredFile());
    expect(pubs(await loadDeviceKeys(profile, excluded))).toEqual(pubs(next));
    expect((await readdir(deviceDir())).sort()).toEqual(['keys.json', 'keys.retired.json']);
  });

  /** Resolves at `fire()`, or after a moment when nothing fires: the other caller is waiting its turn and can't. */
  const signal = () => {
    let fire = () => {};
    const fired = new Promise<void>((resolve) => (fire = resolve));
    return { fire, wait: () => Promise.race([fired, new Promise<void>((resolve) => setTimeout(resolve, 100))]) };
  };

  /** Holds the first check of keys.json until a rename puts a file there: the checker is overtaken between its check and its act. */
  const overtakeTheFirstCheckOfKeysJson = () => {
    const installed = signal();
    let held = false;
    fsHooks.after = (op, _path, to) => {
      if (op === 'rename' && to === keysFile()) installed.fire();
    };
    fsHooks.before = async (op, path) => {
      if (op !== 'lstat' || path !== keysFile() || held) return;
      held = true;
      await installed.wait();
    };
  };

  it('are promoted once when two promotions start together after the first rename, the new keys current and the old retired', async () => {
    const old = await loadDeviceKeys(profile, excluded);
    const next = await createNextDeviceKeys(profile, excluded);
    await rename(keysFile(), retiredFile());
    overtakeTheFirstCheckOfKeysJson();
    await Promise.all([promoteNextDeviceKeys(profile), promoteNextDeviceKeys(profile)]);
    expect((await readdir(deviceDir())).sort()).toEqual(['keys.json', 'keys.retired.json']);
    expect((await deviceKeyIds(profile, 'current'))?.device).toBe(await deviceOf(next));
    expect((await deviceKeyIds(profile, 'retired'))?.device).toBe(await deviceOf(old));
  });

  it('are promoted once when a promotion and a load that finishes it start together, the load given the new keys', async () => {
    const old = await loadDeviceKeys(profile, excluded);
    const next = await createNextDeviceKeys(profile, excluded);
    await rename(keysFile(), retiredFile());
    overtakeTheFirstCheckOfKeysJson();
    const [, loaded] = await Promise.all([promoteNextDeviceKeys(profile), loadDeviceKeys(profile, excluded)]);
    expect(pubs(loaded)).toEqual(pubs(next));
    expect((await readdir(deviceDir())).sort()).toEqual(['keys.json', 'keys.retired.json']);
    expect((await deviceKeyIds(profile, 'current'))?.device).toBe(await deviceOf(next));
    expect((await deviceKeyIds(profile, 'retired'))?.device).toBe(await deviceOf(old));
  });

  it('are found in one reading while a promotion moves them: never missed between keys.json and keys.next.json', async () => {
    await loadDeviceKeys(profile, excluded);
    const next = await deviceOf(await createNextDeviceKeys(profile, excluded));
    await rename(keysFile(), retiredFile());
    // The promotion's last rename waits until keys.json has been read; the read of keys.next.json waits for that rename.
    const currentRead = signal();
    const installed = signal();
    fsHooks.before = async (op, path, to) => {
      if (op === 'rename' && to === keysFile()) await currentRead.wait();
      if (op === 'open' && path === nextFile()) await installed.wait();
    };
    fsHooks.after = (op, path, to) => {
      if (op === 'open' && path === keysFile()) currentRead.fire();
      if (op === 'rename' && to === keysFile()) installed.fire();
    };
    const [found] = await Promise.all([findDeviceKeys(profile, next), promoteNextDeviceKeys(profile)]);
    expect(found).not.toBeNull();
  });

  it('replace a retired file an earlier rekey left, destroying its keys early', async () => {
    await loadDeviceKeys(profile, excluded);
    await createNextDeviceKeys(profile, excluded);
    await promoteNextDeviceKeys(profile);
    const middle = await loadDeviceKeys(profile, excluded);
    await createNextDeviceKeys(profile, excluded);
    await promoteNextDeviceKeys(profile);
    expect((await deviceKeyIds(profile, 'retired'))?.device).toBe(await deviceOf(middle));
    expect((await readdir(deviceDir())).sort()).toEqual(['keys.json', 'keys.retired.json']);
  });

  it('leave a retired file that destruction deletes, the current keys untouched', async () => {
    await loadDeviceKeys(profile, excluded);
    const next = await createNextDeviceKeys(profile, excluded);
    await promoteNextDeviceKeys(profile);
    await destroyRetiredDeviceKeys(profile);
    expect(await readdir(deviceDir())).toEqual(['keys.json']);
    expect(await deviceKeyIds(profile, 'retired')).toBeNull();
    expect(pubs(await loadDeviceKeys(profile, excluded))).toEqual(pubs(next));
    await destroyRetiredDeviceKeys(profile); // nothing left to delete
  });
});
