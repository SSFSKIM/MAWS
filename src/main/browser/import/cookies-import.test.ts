// The cookies category's plan and its set loop (E4b Design §7; Decision Log 25, 36, 37): decrypt first, classify after;
// the wrong-key verdict is "at least one wrongKey and nothing decrypted", and then nothing is set; a few wrongKey rows
// among decrypted ones are unreadable rows (the key is one key). Plain rows go through cookies.set only, partitioned
// rows through the CHIPS route only.
import { createCipheriv } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { CookiesSetDetails, Session } from 'electron';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildChromeUserData, type ChromeUserData } from '../../../../test/support/chrome-profile';
import { deriveKey, hostHash } from './chrome/crypto';
import { readCookieRows, type ChromeCookieRow } from './chrome/cookies';
import type { PartitionedCookie, PartitionedResult } from './chips-import';
import { importCookies, planCookies } from './cookies-import';

vi.mock('electron', () => ({ WebContentsView: class {} }));

let root: string;
let fixture: ChromeUserData;
let rows: ChromeCookieRow[];
let version: number;
let key: Buffer;
let wrong: Buffer;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'maws-e4b-cookies-import-'));
  fixture = buildChromeUserData(join(root, 'Chrome'));
  key = deriveKey(fixture.password);
  wrong = deriveKey(fixture.wrongPassword);
  const db = new DatabaseSync(fixture.profiles.Default.cookies.file);
  try {
    ({ rows, storeVersion: version } = readCookieRows(db));
  } finally {
    db.close();
  }
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

// A row encrypted under `under` (another installation's key) on its own host.
function encryptedUnder(under: Buffer, name: string, hostKey: string): ChromeCookieRow {
  const cipher = createCipheriv('aes-128-cbc', under, Buffer.alloc(16, 0x20));
  const blob = Buffer.concat([Buffer.from('v10'), cipher.update(Buffer.concat([hostHash(hostKey), Buffer.from('e4b-sentinel-cookie-x')])), cipher.final()]);
  return { ...rows.find((row) => row.name === 'sid')!, name, hostKey, encryptedValue: blob };
}
const plainValue = (name: string): ChromeCookieRow => ({ ...rows.find((row) => row.name === 'probe_session')!, name, value: 'e4b-sentinel-cookie-plain', encryptedValue: new Uint8Array() });

describe('planCookies', () => {
  it('plans the fixture’s five rows as three plain, one partitioned and one SameSite=None-without-Secure skip', () => {
    const plan = planCookies(rows, key, version);
    expect(plan.wrongKey).toBe(false);
    expect(plan.plain.map((cookie) => cookie.details.name).sort()).toEqual(['probe_pref', 'probe_session', 'sid']);
    expect(plan.partitioned.map((cookie) => cookie.cdp.name)).toEqual(['__Host-part']);
    expect(plan.skips).toEqual([{ reason: 'sameSiteNoneInsecure', host: fixture.host }]);
  });

  it('under the wrong key: every row wrongKey, the verdict set, nothing to set', () => {
    const plan = planCookies(rows, wrong, version);
    expect(plan).toMatchObject({ wrongKey: true, plain: [], partitioned: [] });
    expect(plan.skips.map((skip) => skip.reason)).toEqual(Array(5).fill('wrongKey'));
  });

  it('counts a few rows that fail among many decrypted ones as unreadable rows, not a wrong key', () => {
    const plan = planCookies([...rows, encryptedUnder(wrong, 'stray', 'stray.test')], key, version);
    expect(plan.wrongKey).toBe(false);
    expect(plan.plain).toHaveLength(3);
    expect(plan.skips).toContainEqual({ reason: 'corruptRow', host: 'stray.test' });
    expect(plan.skips.some((skip) => skip.reason === 'wrongKey')).toBe(false);
  });

  it('never calls a store of plain values a wrong key: rows with no encrypted value are not attempts', () => {
    const plan = planCookies([plainValue('a'), plainValue('b')], wrong, version);
    expect(plan.wrongKey).toBe(false);
    expect(plan.plain).toHaveLength(2);
  });

  it('sets nothing under the verdict, a plain-value row included, counting it with the rows the key could not open', () => {
    const plan = planCookies([...rows, plainValue('plain')], wrong, version);
    expect(plan).toMatchObject({ wrongKey: true, plain: [], partitioned: [] });
    expect(plan.skips.filter((skip) => skip.reason === 'wrongKey')).toHaveLength(6);
  });
});

describe('importCookies', () => {
  function fakeSession(refuse: (details: CookiesSetDetails) => boolean = () => false) {
    const set: CookiesSetDetails[] = [];
    const cookies = {
      set: vi.fn(async (details: CookiesSetDetails) => {
        if (refuse(details)) throw new Error('Failed to set cookie with an invalid domain attribute');
        set.push(details);
      }),
      flushStore: vi.fn(async () => {}),
    };
    return { ses: { cookies } as unknown as Session, cookies, set };
  }
  const chips = (result: Partial<PartitionedResult> = {}) =>
    vi.fn(async ({ cookies }: { cookies: readonly PartitionedCookie[] }) => ({ imported: cookies.length, verified: cookies.length, rejected: [], notVerified: [], cancelled: 0, error: null, ...result }));
  const run = (plan: ReturnType<typeof planCookies>, ses: Session, partitioned = chips(), signal = new AbortController().signal) =>
    importCookies({ plan, ses, partition: 'persist:maws-chrome-Default', signal, progress: () => {}, importPartitioned: partitioned, onSkip: () => {} });

  it('sets the plain rows through cookies.set and the partitioned row through the CHIPS route only, flushing after each', async () => {
    const { ses, cookies, set } = fakeSession();
    const partitioned = chips();
    const block = await run(planCookies(rows, key, version), ses, partitioned);
    expect(set.map((details) => details.name).sort()).toEqual(['probe_pref', 'probe_session', 'sid']);
    expect(set.some((details) => 'partitionKey' in details || details.name === '__Host-part')).toBe(false);
    expect(partitioned.mock.calls[0]![0].cookies.map((cookie) => cookie.cdp.name)).toEqual(['__Host-part']);
    expect(cookies.flushStore).toHaveBeenCalledTimes(2);
    expect(block).toEqual({
      imported: 3,
      partitioned: { imported: 1, verified: 1 },
      skipped: { wrongKey: 0, corruptRow: 0, expired: 0, sameSiteNoneInsecure: 1, rejected: 0, notVerified: 0, cancelled: 0 },
      hosts: { sameSiteNoneInsecure: [fixture.host] },
      keychain: 'allowed',
      error: null,
    });
  });

  it('reports the wrong key with nothing set and no CHIPS route', async () => {
    const { ses, cookies } = fakeSession();
    const partitioned = chips();
    const block = await run(planCookies(rows, wrong, version), ses, partitioned);
    expect(cookies.set).not.toHaveBeenCalled();
    expect(partitioned).not.toHaveBeenCalled();
    expect(block).toMatchObject({ imported: 0, partitioned: { imported: 0, verified: 0 }, keychain: 'wrongKey' });
    expect(block.skipped.wrongKey).toBe(5);
    expect(block.hosts.wrongKey).toEqual([fixture.host, 'example.test', 'embed.test']);
  });

  it('counts a row cookies.set refuses as rejected, and a set partitioned row not confirmed as notVerified (DL36)', async () => {
    const { ses } = fakeSession((details) => details.name === 'sid');
    const block = await run(planCookies(rows, key, version), ses, chips({ verified: 0, notVerified: ['embed.test'] }));
    expect(block).toMatchObject({ imported: 2, partitioned: { imported: 1, verified: 0 } });
    expect(block.skipped).toMatchObject({ rejected: 1, notVerified: 1 });
    expect(block.hosts).toMatchObject({ rejected: ['example.test'], notVerified: ['embed.test'] });
  });

  it('on abort counts every row not yet set as cancelled and skips the CHIPS route', async () => {
    const controller = new AbortController();
    const { ses } = fakeSession(() => {
      controller.abort();
      return false;
    });
    const partitioned = chips();
    const block = await run(planCookies(rows, key, version), ses, partitioned, controller.signal);
    expect(block.imported).toBe(1);
    expect(block.skipped.cancelled).toBe(3); // two plain rows and the partitioned one
    expect(block.hosts.cancelled).toBeUndefined();
    expect(partitioned).not.toHaveBeenCalled();
  });

  it('keeps at most 20 distinct, non-empty hosts per reason', async () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ ...rows.find((row) => row.name === 'probe_none_insecure')!, hostKey: `h${i % 25}.test`, encryptedValue: new Uint8Array(), value: 'v' }));
    const empty = { ...many[0]!, hostKey: '' };
    const block = await run(planCookies([...many, empty], key, version), fakeSession().ses);
    expect(block.skipped.sameSiteNoneInsecure).toBe(31);
    expect(block.hosts.sameSiteNoneInsecure).toHaveLength(20);
    expect(new Set(block.hosts.sameSiteNoneInsecure).size).toBe(20);
  });
});
