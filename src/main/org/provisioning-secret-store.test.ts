// The provisioning code's destination (P5 O8 M4c, "The destination"; the controller's ruling on Task 3's piece 4): a file
// of main's own, `<profile>/provisioning-secret.json`, beside the settings files and never in them, since an older build
// strict-parses those (O7 M9). Absent reads null; a file this build can't read as one of its own reads damaged, never
// null, and a write refuses it; a write's values are held to their grammar before anything is written.
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProvisioningSecretSchema, type ProvisioningSecret } from '@shared/ipc/schema/org';
import { openProvisioningSecret, PROVISIONING_SECRET_FILE } from './provisioning-secret-store';

const PRODUCTION: ProvisioningSecret = { project: 'maws-example-prod', secret: 'desk-provisioning-v2', account: 'cli-owner@maws-example-prod.iam.gserviceaccount.com' };

let profile: string;
let file: string;
beforeEach(() => {
  profile = mkdtempSync(join(tmpdir(), 'maws-provisioning-secret-'));
  file = join(profile, PROVISIONING_SECRET_FILE);
});
afterEach(() => {
  chmodSync(profile, 0o700);
  if (existsSync(file)) chmodSync(file, 0o600);
  rmSync(profile, { recursive: true, force: true });
});

describe('the destination file', () => {
  it('is provisioning-secret.json; absent, it reads null and nothing is written', () => {
    expect(PROVISIONING_SECRET_FILE).toBe('provisioning-secret.json');
    expect(openProvisioningSecret(file).read()).toEqual({ ok: true, value: null });
    expect(existsSync(file)).toBe(false);
  });

  it('writes {version: 1, provisioningSecret} owner-only, reads it back, and clears it to null', () => {
    const store = openProvisioningSecret(file);
    expect(store.write(PRODUCTION)).toEqual({ ok: true, value: PRODUCTION });
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ version: 1, provisioningSecret: PRODUCTION });
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(store.read()).toEqual({ ok: true, value: PRODUCTION });
    expect(openProvisioningSecret(file).read()).toEqual({ ok: true, value: PRODUCTION }); // a relaunch reads it
    expect(store.write(null)).toEqual({ ok: true, value: null });
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ version: 1, provisioningSecret: null });
    expect(store.read()).toEqual({ ok: true, value: null });
  });

  it('creates the profile directory when it is missing', () => {
    const nested = join(profile, 'later', PROVISIONING_SECRET_FILE);
    expect(openProvisioningSecret(nested).write(PRODUCTION)).toEqual({ ok: true, value: PRODUCTION });
    expect(openProvisioningSecret(nested).read()).toEqual({ ok: true, value: PRODUCTION });
  });

  it('refuses values out of their grammar before anything is written, an absent file staying absent and a set one unchanged', () => {
    const store = openProvisioningSecret(file);
    const bad = [{ ...PRODUCTION, project: 'Not A Project' }, { ...PRODUCTION, secret: '-flag' }, { ...PRODUCTION, account: 'owner' }, { ...PRODUCTION, extra: 1 }];
    for (const value of bad) expect(store.write(value as ProvisioningSecret)).toMatchObject({ ok: false, reason: 'invalid' });
    expect(existsSync(file)).toBe(false);
    store.write(PRODUCTION);
    const before = readFileSync(file, 'utf8');
    for (const value of bad) expect(store.write(value as ProvisioningSecret)).toMatchObject({ ok: false, reason: 'invalid' });
    expect(readFileSync(file, 'utf8')).toBe(before);
  });

  it('reads a file it cannot own as damaged, never null, and refuses to write over it', () => {
    const damaged = ['not json', JSON.stringify({ version: 2, provisioningSecret: null }), JSON.stringify({ version: 1, provisioningSecret: { ...PRODUCTION, project: 'X' } }), JSON.stringify({ version: 1 }), JSON.stringify({ version: 1, provisioningSecret: null, more: true }), '[]'];
    for (const text of damaged) {
      writeFileSync(file, text);
      const store = openProvisioningSecret(file);
      const reading = store.read();
      expect(reading, text).toMatchObject({ ok: false, damaged: expect.stringContaining(PROVISIONING_SECRET_FILE) });
      expect(store.write(PRODUCTION), text).toMatchObject({ ok: false, reason: 'damaged' });
      expect(store.write(null), text).toMatchObject({ ok: false, reason: 'damaged' });
      expect(readFileSync(file, 'utf8'), text).toBe(text);
    }
  });

  it('reads an unreadable file as damaged, and refuses to write over it', () => {
    writeFileSync(file, JSON.stringify({ version: 1, provisioningSecret: PRODUCTION }));
    chmodSync(file, 0o000);
    const store = openProvisioningSecret(file);
    expect(store.read()).toMatchObject({ ok: false, damaged: expect.stringContaining('EACCES') });
    expect(store.write(null)).toMatchObject({ ok: false, reason: 'damaged' });
    chmodSync(file, 0o600);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ version: 1, provisioningSecret: PRODUCTION });
  });

  it("answers a write the disk refuses as io, the file's last value standing", () => {
    const store = openProvisioningSecret(file);
    store.write(PRODUCTION);
    chmodSync(profile, 0o500); // no new entries: the atomic write's temporary can't be made
    expect(store.write(null)).toMatchObject({ ok: false, reason: 'io' });
    chmodSync(profile, 0o700);
    expect(store.read()).toEqual({ ok: true, value: PRODUCTION });
  });

  it('reads a fresh file each time: a value another writer left is what it answers', () => {
    const store = openProvisioningSecret(file);
    expect(store.read()).toEqual({ ok: true, value: null });
    mkdirSync(profile, { recursive: true });
    writeFileSync(file, JSON.stringify({ version: 1, provisioningSecret: PRODUCTION }));
    expect(store.read()).toEqual({ ok: true, value: PRODUCTION });
  });

  it('reset removes the file, the one way out of a damaged one: then it reads unset and takes a write', () => {
    const store = openProvisioningSecret(file);
    writeFileSync(file, '{"version": 2}');
    expect(store.read()).toMatchObject({ ok: false });
    expect(store.reset()).toEqual({ ok: true });
    expect(existsSync(file)).toBe(false);
    expect(store.read()).toEqual({ ok: true, value: null });
    expect(store.write(PRODUCTION)).toEqual({ ok: true, value: PRODUCTION });
    // a set one too, and an absent one is already reset
    expect(store.reset()).toEqual({ ok: true });
    expect(store.reset()).toEqual({ ok: true });
    expect(store.read()).toEqual({ ok: true, value: null });
  });

  it('reset answers io when the file can\'t be removed, and the file stands', () => {
    const store = openProvisioningSecret(file);
    store.write(PRODUCTION);
    chmodSync(profile, 0o500);
    expect(store.reset()).toMatchObject({ ok: false, reason: 'io' });
    chmodSync(profile, 0o700);
    expect(store.read()).toEqual({ ok: true, value: PRODUCTION });
  });
});

// The grammar, held at the schema (src/shared/ipc/schema/org.ts), which every value reaches gcloud's argv through.
describe("the destination's grammar", () => {
  it("accepts production's destination and each grammar's edges", () => {
    expect(ProvisioningSecretSchema.parse(PRODUCTION)).toEqual(PRODUCTION);
    for (const project of ['abcdef', `a${'b'.repeat(28)}c`, 'my-proj-1']) expect(ProvisioningSecretSchema.safeParse({ ...PRODUCTION, project }).success, project).toBe(true);
    for (const secret of ['s', 'S_1', '_x', 'x'.repeat(255)]) expect(ProvisioningSecretSchema.safeParse({ ...PRODUCTION, secret }).success, secret).toBe(true);
    expect(ProvisioningSecretSchema.safeParse({ ...PRODUCTION, account: 'kim.min+ops@example.co.kr' }).success).toBe(true);
  });

  it('refuses a value out of its grammar, one that starts like a flag, and any other field', () => {
    for (const project of ['abcde', `a${'b'.repeat(29)}c`, '1project', 'project-', 'Project1', '-project', 'my_proj1']) expect(ProvisioningSecretSchema.safeParse({ ...PRODUCTION, project }).success, project).toBe(false);
    for (const secret of ['', '-secret', 'a secret', 'a/b', 'x'.repeat(256)]) expect(ProvisioningSecretSchema.safeParse({ ...PRODUCTION, secret }).success, secret).toBe(false);
    for (const account of ['', 'owner', '-x@example.com', 'owner@example', 'owner@-example.com', `${'a'.repeat(250)}@example.com`, 'a b@example.com']) expect(ProvisioningSecretSchema.safeParse({ ...PRODUCTION, account }).success, account).toBe(false);
    expect(ProvisioningSecretSchema.safeParse({ ...PRODUCTION, version: 'latest' }).success).toBe(false);
  });
});
