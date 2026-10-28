// The device's software keys (P5-O10 M9, acceptance 6's device half): a channel key and a step-up key in
// `<profile>/device/keys.json` (0600) inside `<profile>/device/` (0700), refused at load when either is widened, a
// symlink or another uid's, and signing what org-protocol verifies: an RL2 handshake and an RL4 step-up.
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
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
import { excludeFromBackup } from './backup-exclusion';
import { DeviceKeysError, loadDeviceKeys, type DeviceKeys } from './keys';

let profile: string;
const deviceDir = () => join(profile, 'device');
const keysFile = () => join(deviceDir(), 'keys.json');
const mode = async (path: string) => (await lstat(path)).mode & 0o777;

beforeEach(async () => {
  profile = await mkdtemp(join(tmpdir(), 'maws-device-keys-'));
});
afterEach(async () => {
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
