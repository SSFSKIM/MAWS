// The development org session (P5 O7 M1, "The development source"): honoured only unpackaged, signed in from a valid
// directory, and signed out with a log line for a chain that doesn't verify, a head that doesn't list this profile's key,
// and a stand-in user on a hub that isn't the local one. The profile's keys load with `excludeFromBackup` injected, so no
// tmutil runs.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateSigningKey, keyId, type SignedOrgState } from 'org-protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { IDENTITY_HEADER } from '../../../apps/desk-hub/local/standin';
import { genesis, memberId, newDevice, successor, type TestDevice } from '../../../test/endpoint/org-fixtures';
import { loadDeviceKeys } from '../device/keys';
import { createDevOrgSession, STANDIN_HEADER } from './dev-session';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const scratch = (name: string) => {
  const dir = mkdtempSync(join(tmpdir(), `maws-dev-org-${name}-`));
  dirs.push(dir);
  return dir;
};
const loadKeys: typeof loadDeviceKeys = (profile) => loadDeviceKeys(profile, { excludeFromBackup: async () => true });

async function setup(options: { listKey?: 'mine' | 'other'; hub?: { url: string; standinUser?: string } | null; pinRecovery?: 'right' | 'wrong' } = {}) {
  const userData = scratch('profile');
  const dir = scratch('org');
  const keys = await loadKeys(userData);
  const A = memberId();
  const mine: TestDevice = { device: { id: 'mac1', class: 'native-mac', keyStorage: 'software', channelPub: keys.channel.pub, stepUpPub: keys.stepUp.pub }, channel: keys.channel, stepUp: keys.stepUp };
  const root = options.listKey === 'other' ? await newDevice('mac1') : mine;
  const recovery = await generateSigningKey();
  const s1 = await genesis('org-dev', A, root, recovery);
  const chain: SignedOrgState[] = [s1, await successor(s1, [root], () => {})];
  writeFileSync(
    join(dir, 'session.json'),
    JSON.stringify({
      version: 1,
      org: 'org-dev',
      member: A,
      device: 'mac1',
      pins: { roots: [await keyId(root.stepUp.pub)], recoveryPub: options.pinRecovery === 'wrong' ? (await generateSigningKey()).pub : recovery.pub },
      hub: options.hub === undefined ? { url: 'http://127.0.0.1:8787', standinUser: 'owner@example.com' } : options.hub,
    }),
  );
  writeFileSync(join(dir, 'chain.json'), JSON.stringify({ chain, transitions: [] }));
  const logs: string[] = [];
  const made = (packaged = false) =>
    createDevOrgSession({ dir, userData, packaged, build: 'dev', stepUp: () => ({ sign: async () => ({ ok: false, reason: 'cancelled' }) }), loadKeys, log: (l) => void logs.push(l) });
  return { made, logs, keys, A };
}

describe('the development org session', () => {
  it('uses the local hub’s stand-in header', () => {
    expect(STANDIN_HEADER).toBe(IDENTITY_HEADER);
  });

  it('is ignored in a packaged build, with one log line', async () => {
    const s = await setup();
    const session = s.made(true);
    await session.loaded;
    expect(session.current()).toBeNull();
    expect(s.logs).toEqual(['[dev-org] MAWS_DEV_ORG is ignored in a packaged build']);
  });

  it('returns signed out at once and signs in from a valid directory, telling its listeners', async () => {
    const s = await setup();
    const session = s.made();
    expect(session.current()).toBeNull();
    let told = 0;
    session.onChanged(() => void (told += 1));
    await session.loaded;
    expect(told).toBe(1);
    const signedIn = session.current()!;
    expect(signedIn.identity).toMatchObject({ org: 'org-dev', member: s.A, device: 'mac1', clientClass: 'native-mac', build: 'dev', capabilities: [] });
    expect(await keyId(signedIn.identity.channelKey.pub)).toBe(await keyId(s.keys.channel.pub));
    expect(signedIn.view.head().state.version).toBe(2);
    expect(signedIn.hub!.url).toBe('http://127.0.0.1:8787');
    expect(await signedIn.hub!.headers()).toEqual({ [IDENTITY_HEADER]: 'owner@example.com' });
  });

  it('stays signed out, saying why, for a chain that doesn’t verify', async () => {
    const s = await setup({ pinRecovery: 'wrong' });
    const session = s.made();
    await session.loaded;
    expect(session.current()).toBeNull();
    expect(s.logs.at(-1)).toMatch(/signed out: the chain does not verify/);
  });

  it('stays signed out, saying why, for a head that doesn’t list this profile’s key', async () => {
    const s = await setup({ listKey: 'other' });
    const session = s.made();
    await session.loaded;
    expect(session.current()).toBeNull();
    expect(s.logs.at(-1)).toMatch(/signed out: the head doesn't list device mac1/);
  });

  it('stays signed out, saying why, for a stand-in user on a hub that isn’t the local one', async () => {
    const s = await setup({ hub: { url: 'https://hub.example.com', standinUser: 'owner@example.com' } });
    const session = s.made();
    await session.loaded;
    expect(session.current()).toBeNull();
    expect(s.logs.at(-1)).toMatch(/signed out: a stand-in user is named for https:\/\/hub.example.com/);
  });
});
