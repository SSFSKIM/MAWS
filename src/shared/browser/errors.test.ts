import { expect, it } from 'vitest';
import { classifyLoadError, ERR_ABORTED, LOAD_ERROR_KINDS } from './errors';

it("maps Chromium's net errors onto Codex's six states, by name and else by number", () => {
  expect(LOAD_ERROR_KINDS).toEqual(['dns', 'offline', 'refused', 'timeout', 'certificate', 'generic']);
  // by name (Codex's table, main-BvBtZhys.js:90639-90671)
  expect(classifyLoadError(-105, 'ERR_NAME_NOT_RESOLVED')).toBe('dns');
  expect(classifyLoadError(-105, 'DNS_PROBE_POSSIBLE')).toBe('dns');
  expect(classifyLoadError(-106, 'ERR_INTERNET_DISCONNECTED')).toBe('offline');
  expect(classifyLoadError(-102, 'ERR_CONNECTION_REFUSED')).toBe('refused');
  expect(classifyLoadError(-118, 'ERR_CONNECTION_TIMED_OUT')).toBe('timeout');
  expect(classifyLoadError(-7, 'ERR_TIMED_OUT')).toBe('timeout');
  expect(classifyLoadError(-202, 'ERR_CERT_AUTHORITY_INVALID')).toBe('certificate');
  expect(classifyLoadError(-201, 'ERR_CERT_DATE_INVALID')).toBe('certificate');
  expect(classifyLoadError(-324, 'ERR_EMPTY_RESPONSE')).toBe('generic');
  expect(classifyLoadError(-2, 'ERR_FAILED')).toBe('generic');
  // an empty description falls back to the number
  expect(classifyLoadError(-105, '')).toBe('dns');
  expect(classifyLoadError(-106, '')).toBe('offline');
  expect(classifyLoadError(-102, '')).toBe('refused');
  expect(classifyLoadError(-118, '')).toBe('timeout');
  expect(classifyLoadError(-7, '')).toBe('timeout');
  expect(classifyLoadError(-200, '')).toBe('certificate');
  expect(classifyLoadError(-299, '')).toBe('certificate');
  expect(classifyLoadError(-300, '')).toBe('generic');
});

it('answers null for ERR_ABORTED: a replaced navigation, a Stop or a download is never an error to show', () => {
  expect(ERR_ABORTED).toBe(-3);
  expect(classifyLoadError(-3, 'ERR_ABORTED')).toBeNull();
  expect(classifyLoadError(-3, '')).toBeNull();
});
