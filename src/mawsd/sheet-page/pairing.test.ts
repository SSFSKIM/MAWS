// Pairing (docs/doperpowers/plans/2026-11-24-question-sheet-c4-local-page.md, §K; T8 to T10, T28): the code, the
// browsers' file and the server's proof, over a scratch file and an injected clock.
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BROWSERS_MAX, CODE_ALPHABET, createPairing, labelOf, PROOF_KEY_LABEL, PROOF_MAC_LABEL, type Pairing } from './pairing';
import { SHEET_PAGE_TIMING } from './timing';

const CHROME_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

let scratch: string;
let file: string;
let clock: number;
let logs: string[];
let failWrites: boolean;

const make = (): Pairing =>
  createPairing({
    file,
    now: () => clock,
    random: randomBytes,
    log: (line) => void logs.push(line),
    timing: SHEET_PAGE_TIMING,
    write: (path, text) => {
      if (failWrites) throw Object.assign(new Error('no space left on device'), { code: 'ENOSPC' });
      writeFileSync(path, text, { mode: 0o600 });
    },
  });

// a code exchanged at once, with the minute's count moved past
function paired(pairing: Pairing, userAgent = CHROME_MAC): { id: string; credential: string } {
  const { code } = pairing.mint();
  const answer = pairing.exchange(code, userAgent);
  if (!answer.ok) throw new Error(`the exchange failed: ${answer.why}`);
  clock += MINUTE / 10 + 1; // ten a minute
  return answer;
}

const ORIGIN = 'http://sheet.localhost:47590';
const macOf = (credential: string, id: string, nonce: string, origin = ORIGIN) => {
  const key = createHmac('sha256', Buffer.from(credential, 'base64url')).update(PROOF_KEY_LABEL).digest();
  return createHmac('sha256', key).update(`${PROOF_MAC_LABEL}\n${origin}\n${id}\n${nonce}`).digest('base64url');
};
const nonce = () => randomBytes(32).toString('base64url');

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'maws-sheet-pairing-'));
  file = join(scratch, 'sheet-page.json');
  clock = Date.parse('2026-11-24T10:00:00.000Z');
  logs = [];
  failWrites = false;
});
afterEach(() => rmSync(scratch, { recursive: true, force: true }));

describe('the code (T8)', () => {
  it('is eight characters of the 32-letter alphabet, shown as XXXX-XXXX, and lives five minutes', () => {
    expect(CODE_ALPHABET).toHaveLength(32);
    expect(CODE_ALPHABET).not.toMatch(/[ILOU]/);
    const { code, expiresAt } = make().mint();
    expect(code).toMatch(new RegExp(`^[${CODE_ALPHABET}]{4}-[${CODE_ALPHABET}]{4}$`));
    expect(Date.parse(expiresAt) - clock).toBe(5 * MINUTE);
  });

  it('works once, read without its dash and without regard to case', () => {
    const pairing = make();
    const { code } = pairing.mint();
    expect(pairing.exchange(code.replace('-', '').toLowerCase(), CHROME_MAC)).toMatchObject({ ok: true });
    expect(pairing.exchange(code, CHROME_MAC)).toEqual({ ok: false, why: 'none' });
  });

  it('is voided by a second mint', () => {
    const pairing = make();
    const first = pairing.mint().code;
    const second = pairing.mint().code;
    expect(pairing.exchange(first, CHROME_MAC)).toMatchObject({ ok: false, why: 'wrong' });
    expect(pairing.exchange(second, CHROME_MAC)).toMatchObject({ ok: true });
  });

  it('is refused after five minutes', () => {
    const pairing = make();
    const { code } = pairing.mint();
    clock += 5 * MINUTE;
    expect(pairing.exchange(code, CHROME_MAC)).toEqual({ ok: false, why: 'expired' });
    expect(pairing.exchange(code, CHROME_MAC)).toEqual({ ok: false, why: 'none' });
  });

  it('is voided by the fifth wrong try, each telling how many are left', () => {
    const pairing = make();
    const { code } = pairing.mint();
    const wrong = code.startsWith('0') ? '1111-1111' : '0000-0000';
    expect([1, 2, 3, 4, 5].map(() => pairing.exchange(wrong, CHROME_MAC))).toEqual([4, 3, 2, 1, 0].map((left) => ({ ok: false, why: 'wrong', left })));
    expect(pairing.exchange(code, CHROME_MAC)).toEqual({ ok: false, why: 'none' });
  });

  it('answers busy past ten exchanges a minute, whatever their source, and takes no try for it', () => {
    const pairing = make();
    const { code } = pairing.mint();
    const wrong = code.startsWith('0') ? '1111-1111' : '0000-0000';
    for (let i = 0; i < 4; i++) pairing.exchange(wrong, CHROME_MAC);
    for (let i = 0; i < 6; i++) pairing.exchange('', CHROME_MAC); // malformed: wrong too, until the code is void
    expect(pairing.exchange(code, CHROME_MAC)).toEqual({ ok: false, why: 'busy' });
    const again = pairing.mint().code;
    expect(pairing.exchange(again, CHROME_MAC)).toEqual({ ok: false, why: 'busy' });
    clock += MINUTE;
    expect(pairing.exchange(again, CHROME_MAC)).toMatchObject({ ok: true });
  });

  it('reads a code with characters outside its alphabet, or of another length, as a wrong try', () => {
    const pairing = make();
    pairing.mint();
    expect(pairing.exchange('ÄÄÄÄ-ÄÄÄÄ', CHROME_MAC)).toEqual({ ok: false, why: 'wrong', left: 4 });
    expect(pairing.exchange('ÄÄÄÄ', CHROME_MAC)).toEqual({ ok: false, why: 'wrong', left: 3 });
    expect(pairing.exchange('IIII-LLLL', CHROME_MAC)).toEqual({ ok: false, why: 'wrong', left: 2 });
    expect(pairing.exchange('\u0000'.repeat(8), CHROME_MAC)).toEqual({ ok: false, why: 'wrong', left: 1 });
  });

  it('is written to no log line and no file', () => {
    const pairing = make();
    const { code } = pairing.mint();
    const { credential } = paired(pairing);
    pairing.exchange(code, CHROME_MAC);
    const text = readFileSync(file, 'utf8');
    for (const secret of [code, code.replace('-', ''), credential]) {
      expect(text).not.toContain(secret);
      expect(logs.join('\n')).not.toContain(secret);
    }
  });
});

describe('the credential and the browsers’ file (T9, T10)', () => {
  it('is 32 random bytes in base64url; the file holds its SHA-256 and the proof key and never it, at mode 0600', () => {
    const pairing = make();
    const { id, credential } = paired(pairing);
    expect(credential).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(credential, 'base64url')).toHaveLength(32);
    expect(id).toMatch(/^[0-9a-f]{8}$/);
    const kept = JSON.parse(readFileSync(file, 'utf8')) as { v: number; browsers: Record<string, string>[] };
    expect(kept.v).toBe(1);
    expect(kept.browsers).toHaveLength(1);
    const bytes = Buffer.from(credential, 'base64url');
    expect(kept.browsers[0]).toEqual({
      id,
      label: 'Chrome on macOS',
      hash: createHash('sha256').update(bytes).digest('hex'),
      proof: createHmac('sha256', bytes).update(PROOF_KEY_LABEL).digest('hex'),
      pairedAt: new Date(clock - MINUTE / 10 - 1).toISOString(),
      lastSeenAt: new Date(clock - MINUTE / 10 - 1).toISOString(),
    });
    expect(readFileSync(file, 'utf8')).not.toContain(credential);
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it('is checked against the kept hashes; an unknown or malformed one is refused', () => {
    const pairing = make();
    const { id, credential } = paired(pairing);
    expect(pairing.check(credential)).toMatchObject({ id, label: 'Chrome on macOS' });
    expect(pairing.check(randomBytes(32).toString('base64url'))).toBeNull();
    expect(pairing.check('short')).toBeNull();
    // what the file keeps cannot be sent as the credential
    const kept = JSON.parse(readFileSync(file, 'utf8')) as { browsers: { hash: string; proof: string }[] };
    expect(pairing.check(Buffer.from(kept.browsers[0]!.hash, 'hex').toString('base64url'))).toBeNull();
    expect(pairing.check(Buffer.from(kept.browsers[0]!.proof, 'hex').toString('base64url'))).toBeNull();
  });

  it('survives a restart (a second Pairing over the same file)', () => {
    const { id, credential } = paired(make());
    expect(make().check(credential)).toMatchObject({ id });
  });

  it('touches lastSeenAt at most once an hour, and a failed touch is only logged', () => {
    const pairing = make();
    const { credential } = paired(pairing);
    const first = pairing.list().browsers[0]!.lastSeenAt;
    clock += 30 * MINUTE;
    pairing.check(credential);
    expect(pairing.list().browsers[0]!.lastSeenAt).toBe(first);
    clock += 31 * MINUTE;
    pairing.check(credential);
    expect(pairing.list().browsers[0]!.lastSeenAt).toBe(new Date(clock).toISOString());
    expect(make().list().browsers[0]!.lastSeenAt).toBe(new Date(clock).toISOString());
    failWrites = true;
    clock += 2 * 60 * MINUTE;
    expect(pairing.check(credential)).not.toBeNull();
    expect(logs.some((line) => /last seen/.test(line))).toBe(true);
  });

  it('is refused once unused for 90 days', () => {
    const pairing = make();
    const { id, credential } = paired(pairing);
    clock += 90 * DAY;
    expect(pairing.check(credential)).toBeNull();
    expect(pairing.prove(id, nonce(), ORIGIN)).toBeNull();
    expect(pairing.list()).toEqual({ browsers: [] });
  });

  it('keeps at most 16 browsers: a seventeenth drops the one seen longest ago, and says so once the file was replaced', () => {
    const pairing = make();
    const revoked: string[] = [];
    pairing.onRevoked((id) => void revoked.push(id));
    const browsers = Array.from({ length: BROWSERS_MAX }, () => paired(pairing));
    clock += 2 * 60 * MINUTE;
    for (const browser of browsers.slice(1)) pairing.check(browser.credential); // all but the first seen again
    failWrites = true;
    const { code } = pairing.mint();
    expect(pairing.exchange(code, CHROME_MAC)).toEqual({ ok: false, why: 'not-saved' });
    expect(revoked).toEqual([]); // nothing dropped while the pairing is not saved
    expect(pairing.check(browsers[0]!.credential)).not.toBeNull();
    failWrites = false;
    clock += MINUTE;
    expect(pairing.exchange(code, CHROME_MAC)).toMatchObject({ ok: true });
    expect(revoked).toEqual([browsers[0]!.id]);
    expect(pairing.list().browsers).toHaveLength(BROWSERS_MAX);
    expect(pairing.check(browsers[0]!.credential)).toBeNull();
    expect(pairing.check(browsers[1]!.credential)).not.toBeNull();
  });

  it('tells whether a browser is still paired, and counts a live connection’s presence as use', () => {
    const pairing = make();
    const { id } = paired(pairing);
    expect(pairing.seen(id)).toBe(true);
    clock += 2 * 60 * MINUTE;
    expect(pairing.seen(id)).toBe(true);
    expect(pairing.list().browsers[0]!.lastSeenAt).toBe(new Date(clock).toISOString());
    clock += 90 * DAY;
    expect(pairing.seen(id)).toBe(false);
    expect(pairing.seen('0badc0de')).toBe(false);
  });

  it('reads a file that does not parse, or whose v is not 1, as no browsers', () => {
    writeFileSync(file, '{ not json');
    expect(make().list()).toEqual({ browsers: [] }); // read as no browsers, no failure surfaced
    writeFileSync(file, JSON.stringify({ v: 2, browsers: [] }));
    expect(make().list()).toEqual({ browsers: [] }); // read as no browsers, no failure surfaced
    expect(logs.filter((line) => line === 'the browsers’ file does not parse: read as no browsers')).toHaveLength(2);
    expect(logs.join('\n')).not.toMatch(/JSON|token|position|version 2/i); // a fixed sentence, not the parser's words
  });

  it('surfaces a file it could not read, other than a missing one: by its error’s code, paired with nobody, written over by nothing, and read again at the next use', () => {
    const { id, credential } = paired(make());
    const kept = readFileSync(file, 'utf8');
    rmSync(file);
    mkdirSync(file); // read fails EISDIR
    const pairing = make();
    expect(pairing.list()).toEqual({ browsers: [], why: 'EISDIR' });
    expect(pairing.revoke(null)).toEqual({ ids: [], saved: false, why: 'EISDIR', unread: true }); // never answered saved
    expect(pairing.revoke(id)).toEqual({ ids: [], saved: false, why: 'EISDIR', unread: true });
    expect(pairing.count()).toBeNull();
    expect(pairing.check(credential)).toBeNull();
    const { code } = pairing.mint();
    expect(pairing.exchange(code, CHROME_MAC)).toEqual({ ok: false, why: 'not-saved' });
    expect(statSync(file).isDirectory()).toBe(true);
    expect(logs.some((line) => line.includes('EISDIR'))).toBe(true);
    expect(logs.join('\n')).not.toContain(scratch); // the error's code, never the path

    rmSync(file, { recursive: true });
    writeFileSync(file, kept);
    expect(pairing.count()).toBeNull(); // the count reads no file
    expect(pairing.list().browsers.map((browser) => browser.id)).toEqual([id]);
    expect(pairing.count()).toBe(1);
    expect(pairing.check(credential)).toMatchObject({ id });
    clock += MINUTE;
    expect(pairing.exchange(code, CHROME_MAC)).toMatchObject({ ok: true }); // the code stayed live
  });

  it('reads an unreadable file again for a proof, so a live hello heals with nothing else in between', () => {
    const { id, credential } = paired(make());
    const kept = readFileSync(file, 'utf8');
    rmSync(file);
    mkdirSync(file);
    const pairing = make();
    expect(pairing.prove(id, nonce(), ORIGIN)).toBeNull();
    rmSync(file, { recursive: true });
    writeFileSync(file, kept);
    const once = nonce();
    expect(pairing.prove(id, once, ORIGIN)).toBe(macOf(credential, id, once));
  });

  it('labels a browser from a fixed set of words, so nothing a requester wrote reaches a terminal', () => {
    expect(labelOf(CHROME_MAC)).toBe('Chrome on macOS');
    expect(labelOf('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15')).toBe('Safari on macOS');
    expect(labelOf('Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0')).toBe('Firefox on Linux');
    expect(labelOf('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0')).toBe('Edge on Windows');
    expect(labelOf('\u001b[31mevil\u001b[0m')).toBe('A browser');
  });
});

describe('a revocation’s two moments (T10)', () => {
  it('refuses at once, tells its listeners, and is answered saved once the file was replaced', () => {
    const pairing = make();
    const { id, credential } = paired(pairing);
    const revoked: string[] = [];
    pairing.onRevoked((gone) => void revoked.push(gone));
    expect(pairing.revoke(id)).toEqual({ ids: [id], saved: true });
    expect(revoked).toEqual([id]);
    expect(pairing.check(credential)).toBeNull();
    expect(make().check(credential)).toBeNull();
  });

  it('with the replace failing: refused now, answered not saved, paired again after a restart until a retry succeeds', () => {
    const pairing = make();
    const { id, credential } = paired(pairing);
    failWrites = true;
    expect(pairing.revoke(id)).toEqual({ ids: [id], saved: false, why: 'ENOSPC' });
    expect(pairing.check(credential)).toBeNull();
    expect(make().check(credential)).toMatchObject({ id }); // what a restart is
    expect(pairing.retry()).toBe(false);
    failWrites = false;
    expect(pairing.retry()).toBe(true);
    expect(make().check(credential)).toBeNull();
  });

  it('never answers saved while a replace is owed: a repeat of the same id, or --all over an empty memory, tries it again', () => {
    const pairing = make();
    const { id, credential } = paired(pairing);
    failWrites = true;
    expect(pairing.revoke(id)).toEqual({ ids: [id], saved: false, why: 'ENOSPC' });
    expect(pairing.revoke(id)).toEqual({ ids: [], saved: false, why: 'ENOSPC' });
    expect(pairing.revoke(null)).toEqual({ ids: [], saved: false, why: 'ENOSPC' });
    expect(make().check(credential)).not.toBeNull(); // the file still holds it
    failWrites = false;
    expect(pairing.revoke(id)).toEqual({ ids: [], saved: true });
    expect(make().check(credential)).toBeNull();
  });

  it('revokes every browser with null; an unknown id revokes nothing', () => {
    const pairing = make();
    paired(pairing);
    paired(pairing);
    expect(pairing.revoke('00000000')).toEqual({ ids: [], saved: true });
    expect(pairing.revoke(null).ids).toHaveLength(2);
    expect(pairing.list()).toEqual({ browsers: [] });
  });

  it('hands out a credential only once the file was replaced: a failed replace answers not-saved and leaves the code live', () => {
    const pairing = make();
    const { code } = pairing.mint();
    failWrites = true;
    expect(pairing.exchange(code, CHROME_MAC)).toEqual({ ok: false, why: 'not-saved' });
    expect(pairing.list()).toEqual({ browsers: [] });
    failWrites = false;
    expect(pairing.exchange(code, CHROME_MAC)).toMatchObject({ ok: true });
  });

  it('replaces the file by default (a read-only directory fails the replace)', () => {
    const pairing = createPairing({ file, now: () => clock, random: randomBytes, log: (line) => void logs.push(line), timing: SHEET_PAGE_TIMING });
    paired(pairing);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    if (process.getuid?.() === 0) return; // root writes through a read-only mode
    chmodSync(scratch, 0o500);
    try {
      expect(pairing.revoke(null).saved).toBe(false);
    } finally {
      chmodSync(scratch, 0o700);
    }
  });
});

describe('the server’s proof (T28)', () => {
  it('is the MAC over the label, the origin, the id and the nonce, under the key both sides derive from the credential', () => {
    const pairing = make();
    const { id, credential } = paired(pairing);
    const once = nonce();
    expect(pairing.prove(id, once, ORIGIN)).toBe(macOf(credential, id, once));
    expect(make().prove(id, once, ORIGIN)).toBe(macOf(credential, id, once)); // kept beside the hash
  });

  it('differs for the origin of another port, so a daemon serving one port proves nothing to a tab of another', () => {
    const pairing = make();
    const { id, credential } = paired(pairing);
    const once = nonce();
    expect(pairing.prove(id, once, 'http://sheet.localhost:47591')).toBe(macOf(credential, id, once, 'http://sheet.localhost:47591'));
    expect(pairing.prove(id, once, 'http://sheet.localhost:47591')).not.toBe(pairing.prove(id, once, ORIGIN));
  });

  it('differs for two nonces, and for one nonce under two browsers', () => {
    const pairing = make();
    const a = paired(pairing);
    const b = paired(pairing);
    const once = nonce();
    expect(pairing.prove(a.id, once, ORIGIN)).not.toBe(pairing.prove(a.id, nonce(), ORIGIN));
    expect(pairing.prove(a.id, once, ORIGIN)).not.toBe(pairing.prove(b.id, once, ORIGIN));
  });

  it('is null for a browser it does not know', () => {
    expect(make().prove('0badc0de', nonce(), ORIGIN)).toBeNull();
  });
});
