// Pairing (docs/doperpowers/plans/2026-11-24-question-sheet-c4-local-page.md, §K; T8 to T10, T28): the one-time code
// `mawsd sheet pair` prints, the credential a browser gets for it, the browsers' file, and the server's proof.
//
// A code is 40 bits, held in memory only, lives five minutes, works once, one at a time; five wrong tries void it, and
// the page server answers at most ten exchanges a minute whatever their source. A credential is 32 random bytes, sent
// back once; `<profile>/mawsd/sheet-page.json` keeps its SHA-256, compared in constant time, and the proof key, an HMAC
// of it under PROOF_KEY_LABEL, which the page derives too. Neither can be sent as the credential. A credential is handed
// out only once the file that knows it was replaced; a revocation is refused in memory at once and is answered saved
// only once the file was replaced (a replace still owed is tried at each tick of the page server's timer). Nothing here
// logs a code, a credential, a hash or a key.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { atomicWriteFileSync } from '@shared/fs/atomic-write';
import type { SheetPageTiming } from './timing';

export const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // 32, no I, L, O, U
export const CODE_TRIES = 5;
export const EXCHANGES_PER_MINUTE = 10;
export const BROWSERS_MAX = 16;
export const PROOF_KEY_LABEL = 'maws.sheet.proof.v1';
export const PROOF_MAC_LABEL = 'maws.sheet.live.v1';

export interface PairedBrowser {
  id: string; // 8 hex
  label: string;
  pairedAt: string;
  lastSeenAt: string;
}

// `daemon.sheetPair`'s answer (its schema: SheetPairAnswerSchema, src/shared/ipc/schema/daemon.ts)
export type SheetPairAnswer = { ok: true; code: string /* XXXX-XXXX */; expiresAt: string; url: string } | { ok: false; why: string };

export type Exchange = { ok: true; id: string; credential: string } | { ok: false; why: 'wrong' | 'expired' | 'none' | 'busy' | 'not-saved'; left?: number };

export interface Pairing {
  mint(): { code: string; expiresAt: string }; // voids the code before it
  exchange(typed: string, userAgent: string): Exchange;
  prove(id: string, nonce: string): string | null; // the MAC of §L for a browser it knows; null for one it does not
  check(credential: string): PairedBrowser | null; // constant time over the kept hashes; touches lastSeenAt by the grain
  list(): PairedBrowser[];
  revoke(id: string | null): { ids: string[]; saved: boolean; why?: string }; // refused in memory at once; saved: the file's replace succeeded; why: the failure's code when it did not
  retry(): boolean; // a replace still owed is tried again; true once none is owed
  onRevoked(listener: (id: string) => void): () => void; // the live connections' end
}

export interface PairingDeps {
  file: string;
  write?(file: string, text: string): void; // a test's replace that fails
  now(): number;
  random(bytes: number): Buffer;
  log(line: string): void;
  timing: SheetPageTiming;
}

interface Kept extends PairedBrowser {
  hash: Buffer; // SHA-256 of the credential's 32 bytes
  proof: Buffer; // HMAC-SHA-256(the credential's 32 bytes, PROOF_KEY_LABEL)
}

const CREDENTIAL = /^[A-Za-z0-9_-]{43}$/;
const MINUTE_MS = 60_000;

export function createPairing(deps: PairingDeps): Pairing {
  const { file, now, random, log, timing } = deps;
  const write = deps.write ?? atomicWriteFileSync;
  let browsers: Kept[] = readKept(file, log);
  let code: { value: string; expiresAt: number; left: number } | null = null;
  let exchanges: number[] = []; // the times of this minute's exchanges
  let owed = false; // a revocation's replace that failed
  let failure = ''; // the last failed replace's error code (never its message, which names the file)
  const revokedListeners = new Set<(id: string) => void>();

  const alive = (browser: Kept) => now() - Date.parse(browser.lastSeenAt) < timing.credentialIdleMs;
  const shown = ({ id, label, pairedAt, lastSeenAt }: Kept): PairedBrowser => ({ id, label, pairedAt, lastSeenAt });

  // The whole of what memory holds, by replace; true when it was written (and nothing is owed any more)
  const save = (): boolean => {
    browsers = browsers.filter(alive);
    const text = JSON.stringify({ v: 1, browsers: browsers.map((browser) => ({ ...shown(browser), hash: browser.hash.toString('hex'), proof: browser.proof.toString('hex') })) });
    try {
      write(file, `${text}\n`);
      owed = false;
      return true;
    } catch (error) {
      failure = (error as NodeJS.ErrnoException).code ?? 'an error';
      log(`the browsers’ file could not be replaced: ${messageOf(error)}`);
      return false;
    }
  };

  const freshId = (): string => {
    for (;;) {
      const id = random(4).toString('hex');
      if (!browsers.some((browser) => browser.id === id)) return id;
    }
  };

  return {
    mint() {
      const bytes = random(5); // 40 bits, five to a character
      let bits = 0n;
      for (const byte of bytes) bits = (bits << 8n) | BigInt(byte);
      let value = '';
      for (let i = 0; i < 8; i++) value += CODE_ALPHABET[Number((bits >> BigInt(35 - 5 * i)) & 31n)];
      code = { value, expiresAt: now() + timing.codeTtlMs, left: CODE_TRIES };
      return { code: `${value.slice(0, 4)}-${value.slice(4)}`, expiresAt: new Date(code.expiresAt).toISOString() };
    },

    exchange(typed, userAgent) {
      const at = now();
      exchanges = exchanges.filter((time) => at - time < MINUTE_MS);
      if (exchanges.length >= EXCHANGES_PER_MINUTE) return { ok: false, why: 'busy' };
      exchanges.push(at);
      if (code === null) return { ok: false, why: 'none' };
      if (at >= code.expiresAt) {
        code = null;
        return { ok: false, why: 'expired' };
      }
      const read = typed.replace(/-/g, '').toUpperCase();
      if (read.length !== code.value.length || !timingSafeEqual(Buffer.from(read), Buffer.from(code.value))) {
        code.left -= 1;
        const left = code.left;
        if (left === 0) code = null;
        return { ok: false, why: 'wrong', left };
      }
      const bytes = random(32);
      const stamp = new Date(at).toISOString();
      const before = browsers;
      const id = freshId();
      const added: Kept = { id, label: labelOf(userAgent), pairedAt: stamp, lastSeenAt: stamp, hash: sha256(bytes), proof: proofKey(bytes) };
      browsers = [...browsers.filter(alive), added];
      if (browsers.length > BROWSERS_MAX) {
        const oldest = browsers.reduce((a, b) => (Date.parse(b.lastSeenAt) < Date.parse(a.lastSeenAt) ? b : a));
        browsers = browsers.filter((browser) => browser !== oldest);
        log(`browser ${oldest.id} dropped: ${BROWSERS_MAX} are kept, and it was seen longest ago`);
      }
      if (!save()) {
        browsers = before;
        return { ok: false, why: 'not-saved' }; // no credential was handed out; the code stays live
      }
      code = null;
      log(`browser ${id} paired (${added.label})`);
      return { ok: true, id, credential: bytes.toString('base64url') };
    },

    prove(id, nonce) {
      const browser = browsers.find((kept) => kept.id === id);
      if (browser === undefined || !alive(browser)) return null;
      return createHmac('sha256', browser.proof).update(`${PROOF_MAC_LABEL}\n${id}\n${nonce}`).digest('base64url');
    },

    check(credential) {
      if (!CREDENTIAL.test(credential)) return null;
      const presented = sha256(Buffer.from(credential, 'base64url'));
      let found: Kept | null = null;
      for (const browser of browsers) if (timingSafeEqual(browser.hash, presented)) found = browser; // every hash compared
      if (found === null || !alive(found)) return null;
      const at = now();
      if (at - Date.parse(found.lastSeenAt) >= timing.lastSeenGrainMs) {
        found.lastSeenAt = new Date(at).toISOString();
        if (!save()) log(`browser ${found.id}’s last seen time was not written`);
      }
      return shown(found);
    },

    list: () => browsers.filter(alive).map(shown),

    revoke(id) {
      const gone = browsers.filter((browser) => id === null || browser.id === id);
      if (gone.length === 0) return { ids: [], saved: true };
      browsers = browsers.filter((browser) => !gone.includes(browser));
      for (const browser of gone) for (const listener of [...revokedListeners]) listener(browser.id);
      const saved = save();
      if (!saved) owed = true;
      log(`${gone.length === 1 ? `browser ${gone[0]!.id}` : `${gone.length} browsers`} unpaired${saved ? '' : ', not yet saved'}`);
      return { ids: gone.map((browser) => browser.id), saved, ...(!saved && { why: failure }) };
    },

    retry() {
      if (owed) save();
      return !owed;
    },

    onRevoked(listener) {
      revokedListeners.add(listener);
      return () => void revokedListeners.delete(listener);
    },
  };
}

const sha256 = (bytes: Buffer): Buffer => createHash('sha256').update(bytes).digest();
const proofKey = (bytes: Buffer): Buffer => createHmac('sha256', bytes).update(PROOF_KEY_LABEL).digest();
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

const HEX_ID = /^[0-9a-f]{8}$/;
const HEX_32 = /^[0-9a-f]{64}$/;
const isStamp = (value: unknown): value is string => typeof value === 'string' && !Number.isNaN(Date.parse(value));

// The browsers' file; one that does not parse, or whose v is not 1, is read as no browsers and replaced at the next write
function readKept(file: string, log: (line: string) => void): Kept[] {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') log(`the browsers’ file could not be read (${messageOf(error)}): read as no browsers`);
    return [];
  }
  try {
    const parsed = JSON.parse(text) as { v?: unknown; browsers?: unknown };
    if (parsed.v !== 1 || !Array.isArray(parsed.browsers)) throw new Error(`version ${String(parsed.v)}`);
    return parsed.browsers.map((entry: Record<string, unknown>) => {
      const { id, label, hash, proof, pairedAt, lastSeenAt } = entry;
      if (typeof id !== 'string' || !HEX_ID.test(id) || typeof label !== 'string' || typeof hash !== 'string' || !HEX_32.test(hash) || typeof proof !== 'string' || !HEX_32.test(proof) || !isStamp(pairedAt) || !isStamp(lastSeenAt)) {
        throw new Error('an entry of another shape');
      }
      return { id, label: LABELS.has(label) ? label : 'A browser', pairedAt, lastSeenAt, hash: Buffer.from(hash, 'hex'), proof: Buffer.from(proof, 'hex') };
    });
  } catch (error) {
    log(`the browsers’ file does not parse (${messageOf(error)}): read as no browsers`);
    return [];
  }
}

// A browser's family and system, read from its user agent, as words of a fixed set (nothing a requester wrote reaches a
// terminal through `mawsd sheet browsers`)
const FAMILIES: readonly [RegExp, string][] = [[/\bEdg(e|A|iOS)?\//, 'Edge'], [/\bOPR\//, 'Opera'], [/\b(Firefox|FxiOS)\//, 'Firefox'], [/\b(Chrome|CriOS)\//, 'Chrome'], [/\bVersion\/[\d.]+.*\bSafari\//, 'Safari']];
const SYSTEMS: readonly [RegExp, string][] = [[/\b(iPhone|iPad|iPod)\b/, 'iOS'], [/\bAndroid\b/, 'Android'], [/\bCrOS\b/, 'ChromeOS'], [/\b(Macintosh|Mac OS X)\b/, 'macOS'], [/\bWindows\b/, 'Windows'], [/\bLinux\b/, 'Linux']];
const LABELS: ReadonlySet<string> = new Set(['A browser', ...SYSTEMS.map(([, system]) => `A browser on ${system}`), ...FAMILIES.flatMap(([, family]) => [family, ...SYSTEMS.map(([, system]) => `${family} on ${system}`)])]);

export function labelOf(userAgent: string): string {
  const family = FAMILIES.find(([pattern]) => pattern.test(userAgent))?.[1];
  const system = SYSTEMS.find(([pattern]) => pattern.test(userAgent))?.[1];
  if (family && system) return `${family} on ${system}`;
  return family ?? (system ? `A browser on ${system}` : 'A browser');
}
