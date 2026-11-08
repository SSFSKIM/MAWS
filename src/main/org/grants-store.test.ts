// The grants store (P5 O8 M4b, grants-store.ts): grants.json's one writer, over a commit queue. It reads a missing file
// as fresh only before the registration's `grants` flag; the flag is written before the file's first write; a missing or
// malformed file after it is `damaged`, and every update is refused; an unchanged update writes nothing; a failed write is
// read back rather than trusted.
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { generateSigningKey, keyId, signRecord, SIGNING_DOMAINS, type Grant, type Signed } from '../../../apps/org-protocol/src/index.ts';
import { GRANTS_FILE, isGrantsFile, orgFiles, type GrantsFile, type OrgFiles } from './files';
import { createGrantsStore, GrantsDamaged, issuedFor } from './grants-store';

const BEA = '0123456789abcdef0123456789abcdef';
const profiles: string[] = [];
afterEach(async () => {
  await Promise.all(profiles.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function profile() {
  const dir = await mkdtemp(join(tmpdir(), 'maws-grants-'));
  profiles.push(dir);
  const files = orgFiles({ userData: dir, log: () => {} });
  await files.ensure();
  const order: string[] = [];
  const registration: { grants?: true } = {};
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
    createGrantsStore({
      files: recorded,
      commit: <T>(body: () => Promise<T>) => {
        const turn = commits.then(body);
        commits = turn.catch(() => {});
        return turn;
      },
      registration: () => registration,
      markRegistration: async () => {
        await recorded.write('registration.json', { grants: true });
        registration.grants = true;
      },
    });
  const path = join(dir, 'org', GRANTS_FILE);
  return { dir, path, order, registration, open, failing: (on: boolean) => void (failWrites = on), disk: () => JSON.parse(readFileSync(path, 'utf8')) as GrantsFile };
}

async function grant(machine: string, member: string, version: number): Promise<Signed<Grant>> {
  const key = await generateSigningKey();
  const body: Grant = { org: 'org-grants', machine, machineKey: await keyId(key.pub), member, rights: ['spawn'], version, issued: '2026-11-08T12:00:00.000Z' };
  return signRecord(SIGNING_DOMAINS.grant, body, key.privateKey, key.pub);
}

const keep = (signed: Signed<Grant>) => (file: GrantsFile) => {
  file.issued = [...file.issued.filter((i) => i.signed.body.machine !== signed.body.machine || i.signed.body.member !== signed.body.member), { signed, delivered: 'pending' as const, headVersion: 7 }];
  return { next: file, value: true };
};

describe('the grants store', () => {
  it('reads a missing file as fresh before the flag, marks the registration before the first write, and fails closed after it', async () => {
    const p = await profile();
    const store = await p.open();
    expect(store.get()).toEqual({ version: 1, issued: [] });
    const g = await grant('mref-grants-00001', BEA, 1);
    expect(await store.update(keep(g))).toBe(true);
    expect(p.order).toEqual(['registration.json', GRANTS_FILE]);
    expect(p.registration.grants).toBe(true);
    expect(isGrantsFile(p.disk())).toBe(true);
    expect(isGrantsFile({ ...p.disk(), issued: p.disk().issued.map((i) => ({ ...i, delivered: 'sending' })) })).toBe(true); // the write-ahead's
    expect(issuedFor(p.disk(), 'mref-grants-00001', BEA)).toEqual({ signed: g, delivered: 'pending', headVersion: 7 });

    // Removed after its first write: damaged, not fresh, and nothing is written.
    rmSync(p.path);
    const again = await p.open();
    expect(again.get()).toBe('damaged');
    await expect(again.update(keep(await grant('mref-grants-00001', BEA, 2)))).rejects.toBeInstanceOf(GrantsDamaged);
    expect(p.order).toEqual(['registration.json', GRANTS_FILE]);

    // Malformed: damaged too, whatever it holds.
    // An issued grant without the version of the head it was verified under is no issued grant.
    const headless = { signed: await grant('mref-grants-00001', BEA, 3), delivered: 'pending' };
    const unknownState = { signed: await grant('mref-grants-00001', BEA, 3), delivered: 'sent', headVersion: 7 };
    for (const text of [JSON.stringify({ version: 1, issued: [unknownState] }), '{', JSON.stringify({ version: 1, issued: [{ signed: { body: {} }, delivered: 'pending' }] }), JSON.stringify({ version: 2, issued: [] }), JSON.stringify({ version: 1, issued: [headless] })]) {
      writeFileSync(p.path, text, { mode: 0o600 });
      expect((await p.open()).get()).toBe('damaged');
    }
  });

  it('holds one grant per machine and member: a file with two for the same pair is damaged', async () => {
    const p = await profile();
    const store = await p.open();
    await store.update(keep(await grant('mref-grants-00001', BEA, 1)));
    const two = { version: 1, issued: [...p.disk().issued, { signed: await grant('mref-grants-00001', BEA, 2), delivered: 'done', headVersion: 7 }] };
    writeFileSync(p.path, JSON.stringify(two), { mode: 0o600 });
    expect((await p.open()).get()).toBe('damaged');
  });

  it('decides a first write again after the mark, and writes nothing for an update that changes nothing', async () => {
    const p = await profile();
    const store = await p.open();
    let live = true;
    const g = await grant('mref-grants-00001', BEA, 1);
    const guarded = (file: GrantsFile) => {
      const value = live;
      if (live) live = false; // the check turns false while the mark is written
      return value ? keep(g)(file) : { next: file, value: false };
    };
    expect(await store.update(guarded)).toBe(false);
    // Marked, so the file is written whatever the second run decided: a marked profile without it would read damaged.
    expect(p.order).toEqual(['registration.json', GRANTS_FILE]);
    expect(p.disk()).toEqual({ version: 1, issued: [] });
    expect(await store.update((file) => ({ next: file, value: 'same' }))).toBe('same');
    expect(p.order).toHaveLength(2);
  });

  it('reads a failed write back rather than trusting it', async () => {
    const p = await profile();
    const store = await p.open();
    await store.update(keep(await grant('mref-grants-00001', BEA, 1)));
    p.failing(true);
    await expect(store.update(keep(await grant('mref-grants-00001', BEA, 2)))).rejects.toThrow('disk full');
    // What reads back is the file before the failed write.
    expect(store.get()).toEqual(p.disk());
    const held = store.get();
    if (held === 'damaged') throw new Error('damaged');
    expect(held.issued[0].signed.body.version).toBe(1);
  });
});
