// The signing store (P5 O8 M3, signing-store.ts): signing.json's one writer, over a commit queue. It reads a missing
// file as fresh only before the registration's `signing` flag; the flag is written before the file's first write; a
// missing or malformed file after it is `damaged` until `reset`; an unchanged update writes nothing; a failed write is
// read back rather than trusted; and exposure grows only the slot that holds the state it names.
import { readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { generateSigningKey, keyId, signOrgState, type OrgState, type SignedOrgState } from '../../../apps/org-protocol/src/index.ts';
import { orgFiles, SIGNING_FILE, type OrgFiles, type SigningFile } from './files';
import { createSigningStore, emptySigningFile, SigningDamaged, withExposure } from './signing-store';

const profiles: string[] = [];
afterEach(async () => {
  await Promise.all(profiles.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function profile() {
  const dir = await mkdtemp(join(tmpdir(), 'maws-signing-'));
  profiles.push(dir);
  const files = orgFiles({ userData: dir, log: () => {} });
  await files.ensure();
  const order: string[] = [];
  const registration: { signing?: true } = {};
  let failWrites = false;
  const recorded: OrgFiles = {
    ...files,
    write: async (name, value) => {
      if (failWrites) throw new Error('disk full');
      order.push(name);
      return files.write(name, value);
    },
  };
  let commits: Promise<unknown> = Promise.resolve();
  const open = () =>
    createSigningStore({
      files: recorded,
      commit: <T>(body: () => Promise<T>) => {
        const turn = commits.then(body);
        commits = turn.catch(() => {});
        return turn;
      },
      registration: () => registration,
      markRegistration: async () => {
        await recorded.write('registration.json', { signing: true });
        registration.signing = true;
      },
    });
  const path = join(dir, 'org', SIGNING_FILE);
  return { dir, path, order, registration, open, failing: (on: boolean) => void (failWrites = on), disk: () => JSON.parse(readFileSync(path, 'utf8')) as SigningFile };
}

const asked = (at: string) => (file: SigningFile) => ((file.lastAsked = at), { next: file, value: undefined });

describe('the signing store', () => {
  it('reads a profile that never wrote one as a fresh file, and writes the registration flag before its first write', async () => {
    const p = await profile();
    const store = await p.open();
    expect(store.get()).toEqual(emptySigningFile());
    expect(p.order).toEqual([]);
    await store.update(asked('2026-10-28T12:00:00.000Z'));
    expect(p.order).toEqual(['registration.json', SIGNING_FILE]);
    expect(p.disk().lastAsked).toBe('2026-10-28T12:00:00.000Z');
    await store.update(asked('2026-10-29T12:00:00.000Z'));
    expect(p.order).toEqual(['registration.json', SIGNING_FILE, SIGNING_FILE]);
  });

  it('writes nothing for an update that changes nothing', async () => {
    const p = await profile();
    const store = await p.open();
    expect(await store.update((file) => ({ next: file, value: 7 }))).toBe(7);
    expect(p.order).toEqual([]);
  });

  it('fails closed after its first write: missing or malformed is `damaged`, refused every update, until reset', async () => {
    const p = await profile();
    await (await p.open()).update(asked('2026-10-28T12:00:00.000Z'));

    await rm(p.path);
    const missing = await p.open();
    expect(missing.get()).toBe('damaged');
    await expect(missing.update(asked('2026-10-29T12:00:00.000Z'))).rejects.toBeInstanceOf(SigningDamaged);

    writeFileSync(p.path, '[]', { mode: 0o600 });
    const malformed = await p.open();
    expect(malformed.get()).toBe('damaged');

    await malformed.reset();
    expect(malformed.get()).toEqual(emptySigningFile());
    expect(p.disk()).toEqual(emptySigningFile());
    expect((await p.open()).get()).toEqual(emptySigningFile());
  });

  it('refuses to write a file that would not read back, writing nothing', async () => {
    const p = await profile();
    const store = await p.open();
    await expect(store.update((file) => ({ next: { ...file, lastAsked: 7 } as unknown as SigningFile, value: undefined }))).rejects.toThrow(TypeError);
    expect(p.order).toEqual([]);
    expect(store.get()).toEqual(emptySigningFile());
  });

  it('after a failed write holds what reads back from disk, never what it meant to write', async () => {
    const p = await profile();
    const store = await p.open();
    await store.update(asked('2026-10-28T12:00:00.000Z'));
    p.failing(true);
    await expect(store.update(asked('2026-10-29T12:00:00.000Z'))).rejects.toThrow('disk full');
    expect(store.get()).toMatchObject({ lastAsked: '2026-10-28T12:00:00.000Z' });
  });
});

describe('exposure', () => {
  async function signed(version: number): Promise<SignedOrgState> {
    const key = await generateSigningKey();
    const recovery = await generateSigningKey();
    const state: OrgState = {
      org: 'org-exposure',
      version,
      prev: null,
      issued: '2026-10-28T12:00:00.000Z',
      root: { keys: [await keyId(key.pub)], recoveryPub: recovery.pub },
      members: [],
      machines: [],
      machineNames: [],
      retired: [],
      revoked: [],
      delegations: [],
      projects: [],
    };
    return signOrgState(state, [key]);
  }

  it('grows only the slot holding the state it names: the hub once, each machine once', async () => {
    const mine = await signed(2);
    const other = await signed(3);
    const file: SigningFile = { ...emptySigningFile(), pending: { signed: mine, parent: 'p', exposed: { hub: false, machines: [] } } };
    withExposure(file, other, { hub: true });
    expect(file.pending!.exposed).toEqual({ hub: false, machines: [] });
    withExposure(file, mine, { hub: true });
    withExposure(file, mine, { machine: 'm-one' });
    withExposure(file, mine, { machine: 'm-one' });
    expect(file.pending!.exposed).toEqual({ hub: true, machines: ['m-one'] });
    expect(withExposure(emptySigningFile(), mine, { hub: true }).pending).toBeNull();
  });
});
