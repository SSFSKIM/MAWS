// The Chrome import's one logger (E4b Design §16; Decision Log 17): nothing logs a value. Callers hand a typed event and
// this file formats it, so no cookie value, password, key, URL path, title or extension datum can reach a line: codes
// and reasons are reduced to word characters, hosts to host characters, ids to their pattern, and a free-text message
// goes through `redactMessage`. This is the only console call site under src/main/browser/import/ (the ESLint rule in
// eslint.config.js forbids the others; log.test.ts pins it). Under MAWS_E2E=1 with MAWS_E2E_IMPORT_LOG set, every line
// is also appended to that file, the e2e's fallback when main's own streams are not readable.
import { appendFileSync } from 'node:fs';
import type { CookieSkipReason, HistorySkipReason, ImportedExtension, ImportPhase, KeychainOutcome } from '@shared/browser/import';

// The extension skips the report counts (Design §10).
type ExtensionSkipReason = Extract<ImportedExtension['status'], 'copyFailed' | 'loadFailed'>;

export type ImportLogEvent =
  | { kind: 'phase'; importId: string; phase: ImportPhase; done: number; total: number }
  | { kind: 'skip'; category: 'history' | 'cookies' | 'extensions'; reason: CookieSkipReason | HistorySkipReason | ExtensionSkipReason; host?: string | null }
  | { kind: 'keychain'; outcome: KeychainOutcome | 'cancelled'; exitCode?: number | null }
  | { kind: 'extension'; id: string; status: ImportedExtension['status']; background?: ImportedExtension['background'] }
  | { kind: 'error'; where: string; code: string; message?: string };

const MESSAGE_MAX = 200;
// A code, a reason or a place is an identifier (`wrongKey`, `EBUSY`, `SQLITE_CORRUPT`); anything else prints as invalid.
const word = (text: string) => (/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(text) ? text : '<invalid>');
const host = (text: string) => (/^[\w.:[\]-]{1,255}$/.test(text) ? text : '<invalid>');
const id = (text: string) => (/^[a-p]{32}$/.test(text) || /^[0-9a-f-]{36}$/.test(text) ? text : '<invalid>');
const count = (n: number) => (Number.isSafeInteger(n) ? String(n) : '?');

export function formatImportLog(event: ImportLogEvent): string {
  const line = (() => {
    switch (event.kind) {
      case 'phase':
        return `${id(event.importId)} phase ${word(event.phase)} ${count(event.done)}/${count(event.total)}`;
      case 'skip':
        return `${word(event.category)} skipped ${word(event.reason)}${event.host ? ` host=${host(event.host)}` : ''}`;
      case 'keychain':
        return `keychain ${word(event.outcome)}${typeof event.exitCode === 'number' ? ` exit=${count(event.exitCode)}` : ''}`;
      case 'extension':
        return `extension ${id(event.id)} ${word(event.status)}${event.background ? ` background=${word(event.background)}` : ''}`;
      case 'error':
        return `error ${word(event.where)} ${word(event.code)}${event.message ? `: ${redactMessage(event.message)}` : ''}`;
    }
  })();
  return `[browser-import] ${line}`;
}

export function importLog(event: ImportLogEvent, env: NodeJS.ProcessEnv = process.env): void {
  const line = formatImportLog(event);
  if (event.kind === 'error') console.warn(line);
  else console.info(line);
  if (env.MAWS_E2E === '1' && env.MAWS_E2E_IMPORT_LOG) {
    try {
      appendFileSync(env.MAWS_E2E_IMPORT_LOG, `${line}\n`);
    } catch {
      // the mirror is a test aid; a failed append never fails the import
    }
  }
}

// An error's code as the report and the log keep it: an identifier (`EBUSY`, `indexUnavailable`), never its message.
export function errorCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(code) ? code : 'unexpected';
}

// Hierarchical URLs (`scheme://…`) and the opaque schemes a page or a store may carry. A bare `host:port` or a time is
// not matched, so `example.test:443` and `10:00:05` stay as they are.
const URL_LIKE = /\b(?:[a-z][a-z0-9+.-]*:\/\/|(?:data|javascript|mailto|blob|about|file):)[^\s'"<>]*/gi;

// A message made safe to log or to hand the renderer: a URL becomes its host (or `<scheme: URL>` without one), `value=`
// and `password=` fragments are cut, whitespace is folded into one line, and the result is at most 200 characters.
export function redactMessage(text: string): string {
  return text
    .replace(URL_LIKE, (match) => {
      const trailing = /[.,;:!?]*$/.exec(match)![0]; // the sentence's punctuation, not the URL's
      try {
        const url = new URL(match.slice(0, match.length - trailing.length));
        return `${url.host || `<${url.protocol} URL>`}${trailing}`;
      } catch {
        return `<URL>${trailing}`;
      }
    })
    .replace(/\b(value|password)=[^\s&;,]*/gi, '$1=<redacted>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MESSAGE_MAX);
}
