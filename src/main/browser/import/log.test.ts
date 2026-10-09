// The import's one logger (E4b Design §16; Decision Log 17): typed events formatted without a value, messages redacted,
// the e2e mirror, and no other console call anywhere under src/main/browser/import/.
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatImportLog, importLog, redactMessage, type ImportLogEvent } from './log';

const IMPORT_ID = '0b6f5a5e-8a4c-4c1e-9d55-3b7e2f0a9c11';
const SECRET = 'e4b-sentinel-cookie-0123456789abcdef';

afterEach(() => vi.restoreAllMocks());

describe('formatImportLog', () => {
  it('formats each kind of event as one line of codes, counts and hosts', () => {
    const lines: [ImportLogEvent, string][] = [
      [{ kind: 'phase', importId: IMPORT_ID, phase: 'cookies', done: 200, total: 5112 }, `[browser-import] ${IMPORT_ID} phase cookies 200/5112`],
      [{ kind: 'skip', category: 'cookies', reason: 'wrongKey', host: 'example.test' }, '[browser-import] cookies skipped wrongKey host=example.test'],
      [{ kind: 'skip', category: 'history', reason: 'hidden' }, '[browser-import] history skipped hidden'],
      [{ kind: 'keychain', outcome: 'denied', exitCode: 51 }, '[browser-import] keychain denied exit=51'],
      [{ kind: 'keychain', outcome: 'allowed' }, '[browser-import] keychain allowed'],
      [{ kind: 'extension', id: 'a'.repeat(32), status: 'loaded', background: 'failed' }, `[browser-import] extension ${'a'.repeat(32)} loaded background=failed`],
      [{ kind: 'error', where: 'staging', code: 'EBUSY', message: 'copy failed' }, '[browser-import] error staging EBUSY: copy failed'],
      [{ kind: 'popupRefused', id: 'a'.repeat(32), reason: 'scheme', scheme: 'chrome-extension:' }, `[browser-import] popup ${'a'.repeat(32)} refused scheme scheme=chrome-extension:`], // cua #90
    ];
    for (const [event, line] of lines) expect(formatImportLog(event)).toBe(line);
  });

  it('cannot print a value through a field meant for a code, a host or an id', () => {
    const events: ImportLogEvent[] = [
      { kind: 'skip', category: 'cookies', reason: `wrongKey ${SECRET}` as 'wrongKey', host: `example.test/${SECRET}` },
      { kind: 'extension', id: SECRET, status: 'loaded' },
      { kind: 'error', where: `x ${SECRET}`, code: `E ${SECRET}`, message: `failed https://example.test/${SECRET}?value=${SECRET}` },
      { kind: 'phase', importId: SECRET, phase: 'history', done: 1, total: 2 },
      { kind: 'popupRefused', id: SECRET, reason: `scheme ${SECRET}` as 'scheme', scheme: `https://example.test/${SECRET}` }, // cua #90
    ];
    for (const event of events) {
      const line = formatImportLog(event);
      expect(line, line).not.toContain('sentinel');
      expect(line.split('\n')).toHaveLength(1);
    }
  });
});

describe('redactMessage', () => {
  it('turns anything that parses as a URL into its host', () => {
    expect(redactMessage(`could not load https://example.test:8443/${SECRET}?q=1#x, then http://127.0.0.1/${SECRET}`)).toBe('could not load example.test:8443, then 127.0.0.1');
    expect(redactMessage(`refused chrome-extension://${'a'.repeat(32)}/sw.js`)).toBe(`refused ${'a'.repeat(32)}`);
  });

  it('keeps no part of a URL without a host', () => {
    expect(redactMessage(`opened file:///Users/someone/${SECRET}.txt and data:text/plain,${SECRET} and javascript:alert(1)`)).toBe('opened <file: URL> and <data: URL> and <javascript: URL>');
  });

  it('strips value= and password= fragments and keeps one line of at most 200 characters', () => {
    expect(redactMessage(`set failed: value=${SECRET}; password=${SECRET}&Value=${SECRET}`)).toBe('set failed: value=<redacted>; password=<redacted>&Value=<redacted>');
    expect(redactMessage('first line\n  second line')).toBe('first line second line');
    expect(redactMessage('x'.repeat(500))).toHaveLength(200);
  });

  it('leaves times, codes and hosts given as words alone', () => {
    expect(redactMessage('EBUSY at 10:00:05 host=example.test:443')).toBe('EBUSY at 10:00:05 host=example.test:443');
  });
});

describe('importLog', () => {
  it('writes one formatted line through the console', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    importLog({ kind: 'keychain', outcome: 'missing', exitCode: 44 }, {});
    importLog({ kind: 'error', where: 'profiles', code: 'invalid' }, {});
    expect(info.mock.calls).toEqual([['[browser-import] keychain missing exit=44']]);
    expect(warn.mock.calls).toEqual([['[browser-import] error profiles invalid']]);
  });

  it('mirrors each line to MAWS_E2E_IMPORT_LOG under e2e only', () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const dir = mkdtempSync(join(tmpdir(), 'maws-e4b-log-'));
    try {
      const file = join(dir, 'import.log');
      importLog({ kind: 'skip', category: 'history', reason: 'hidden', host: 'example.test' }, { MAWS_E2E_IMPORT_LOG: file });
      expect(() => readFileSync(file)).toThrow();
      importLog({ kind: 'skip', category: 'history', reason: 'hidden', host: 'example.test' }, { MAWS_E2E: '1', MAWS_E2E_IMPORT_LOG: file });
      importLog({ kind: 'keychain', outcome: 'allowed' }, { MAWS_E2E: '1', MAWS_E2E_IMPORT_LOG: file });
      expect(readFileSync(file, 'utf8')).toBe('[browser-import] history skipped hidden host=example.test\n[browser-import] keychain allowed\n');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the logging discipline', () => {
  it('has no console call under src/main/browser/import/ but log.ts (the lint rule’s pin)', () => {
    const root = __dirname;
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) walk(join(dir, entry.name));
        else if (/\.tsx?$/.test(entry.name)) files.push(join(dir, entry.name));
      }
    };
    walk(root);
    expect(files.length).toBeGreaterThan(1);
    const offenders = files.filter((file) => relative(root, file) !== 'log.ts' && /\bconsole\s*[.[]/.test(readFileSync(file, 'utf8')));
    expect(offenders.map((file) => relative(root, file))).toEqual([]);
  });
});
