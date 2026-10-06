import { describe, expect, it } from 'vitest';
import { displayUrl, hostOf, isSearchUrlTemplate, resolveAddress, validateBrowserUrl } from './url';

const SEARCH = 'https://www.google.com/search?q=%s';

describe('validateBrowserUrl (main checks every URL before a view sees it)', () => {
  it('admits http and https, answering the parsed URL', () => {
    expect(validateBrowserUrl('http://localhost:3000/x')).toEqual({ ok: true, url: 'http://localhost:3000/x' });
    expect(validateBrowserUrl('https://a.b/c?d#e')).toEqual({ ok: true, url: 'https://a.b/c?d#e' });
    expect(validateBrowserUrl('HTTPS://Example.COM')).toEqual({ ok: true, url: 'https://example.com/' });
  });

  it('refuses every other scheme by name, about:blank included (main’s own empty document is never a command)', () => {
    expect(validateBrowserUrl('file:///etc/hosts')).toEqual({ ok: false, scheme: 'file:' });
    expect(validateBrowserUrl('maws-deliverable://x/y/1')).toEqual({ ok: false, scheme: 'maws-deliverable:' });
    expect(validateBrowserUrl('javascript:1')).toEqual({ ok: false, scheme: 'javascript:' });
    expect(validateBrowserUrl('data:,x')).toEqual({ ok: false, scheme: 'data:' });
    expect(validateBrowserUrl('about:blank')).toEqual({ ok: false, scheme: 'about:' });
    expect(validateBrowserUrl('chrome://settings')).toEqual({ ok: false, scheme: 'chrome:' });
    expect(validateBrowserUrl('ftp://x')).toEqual({ ok: false, scheme: 'ftp:' });
    expect(validateBrowserUrl('blob:https://a.b/1')).toEqual({ ok: false, scheme: 'blob:' });
  });

  it('refuses a string that is not a URL, with no scheme to name', () => {
    expect(validateBrowserUrl('not a url')).toEqual({ ok: false, scheme: '' });
    expect(validateBrowserUrl('http://')).toEqual({ ok: false, scheme: '' });
    expect(validateBrowserUrl('')).toEqual({ ok: false, scheme: '' });
  });
});

describe('resolveAddress (what the address field does with typed text)', () => {
  it('prefixes a bare host with https, and localhost or a loopback address with http', () => {
    expect(resolveAddress('wikipedia.org', SEARCH)).toEqual({ kind: 'url', url: 'https://wikipedia.org/' });
    expect(resolveAddress('en.wikipedia.org/wiki/Electron?x=1#h', SEARCH)).toEqual({ kind: 'url', url: 'https://en.wikipedia.org/wiki/Electron?x=1#h' });
    expect(resolveAddress('example.com:8443', SEARCH)).toEqual({ kind: 'url', url: 'https://example.com:8443/' });
    expect(resolveAddress('localhost:3000', SEARCH)).toEqual({ kind: 'url', url: 'http://localhost:3000/' });
    expect(resolveAddress('localhost', SEARCH)).toEqual({ kind: 'url', url: 'http://localhost/' });
    expect(resolveAddress('127.0.0.1:8080/p', SEARCH)).toEqual({ kind: 'url', url: 'http://127.0.0.1:8080/p' });
    expect(resolveAddress('[::1]:4', SEARCH)).toEqual({ kind: 'url', url: 'http://[::1]:4/' });
    expect(resolveAddress('192.168.1.20', SEARCH)).toEqual({ kind: 'url', url: 'https://192.168.1.20/' });
    expect(resolveAddress('  wikipedia.org  ', SEARCH)).toEqual({ kind: 'url', url: 'https://wikipedia.org/' });
  });

  it('keeps an http or https URL as typed', () => {
    expect(resolveAddress('https://x.y', SEARCH)).toEqual({ kind: 'url', url: 'https://x.y/' });
    expect(resolveAddress('http://e4a.invalid/', SEARCH)).toEqual({ kind: 'url', url: 'http://e4a.invalid/' });
  });

  it('searches text with a space, text with no dot, and a dotted number that is no address', () => {
    expect(resolveAddress('what is 2+2', SEARCH)).toEqual({ kind: 'search', url: 'https://www.google.com/search?q=what%20is%202%2B2', query: 'what is 2+2' });
    expect(resolveAddress('hello', SEARCH)).toEqual({ kind: 'search', url: 'https://www.google.com/search?q=hello', query: 'hello' });
    expect(resolveAddress('1.5', SEARCH)).toMatchObject({ kind: 'search', query: '1.5' });
    expect(resolveAddress('note: buy milk', SEARCH)).toMatchObject({ kind: 'search', query: 'note: buy milk' });
    expect(resolveAddress('a & b', 'https://duckduckgo.com/?q=%s&ia=web')).toEqual({ kind: 'search', url: 'https://duckduckgo.com/?q=a%20%26%20b&ia=web', query: 'a & b' });
  });

  it('refuses any other scheme by name, so the field shows the banner without asking main', () => {
    expect(resolveAddress('file:///x', SEARCH)).toEqual({ kind: 'refused', scheme: 'file:' });
    expect(resolveAddress('file:///etc/hosts', SEARCH)).toEqual({ kind: 'refused', scheme: 'file:' });
    expect(resolveAddress('maws-deliverable://x', SEARCH)).toEqual({ kind: 'refused', scheme: 'maws-deliverable:' });
    expect(resolveAddress('javascript:1', SEARCH)).toEqual({ kind: 'refused', scheme: 'javascript:' });
    expect(resolveAddress('JavaScript:alert(1)', SEARCH)).toEqual({ kind: 'refused', scheme: 'javascript:' });
    expect(resolveAddress('about:blank', SEARCH)).toEqual({ kind: 'refused', scheme: 'about:' });
    expect(resolveAddress('data:text/html,x', SEARCH)).toEqual({ kind: 'refused', scheme: 'data:' });
    expect(resolveAddress('mailto:e4a@example.test', SEARCH)).toEqual({ kind: 'refused', scheme: 'mailto:' });
  });
});

describe('displayUrl and hostOf', () => {
  it('splits a URL into its scheme, its host and the rest, without credentials', () => {
    expect(displayUrl('https://user:secret@en.wikipedia.org/wiki/X?y=1#z')).toEqual({ scheme: 'https:', host: 'en.wikipedia.org', rest: '/wiki/X?y=1#z' });
    expect(displayUrl('http://localhost:3000/')).toEqual({ scheme: 'http:', host: 'localhost:3000', rest: '' });
    expect(displayUrl('https://example.com/a/')).toEqual({ scheme: 'https:', host: 'example.com', rest: '/a/' });
  });

  it('shows nothing of a URL that is not http or https', () => {
    expect(displayUrl('about:blank')).toEqual({ scheme: 'about:', host: '', rest: '' });
    expect(displayUrl('javascript:alert(1)')).toEqual({ scheme: 'javascript:', host: '', rest: '' });
    expect(displayUrl('')).toEqual({ scheme: '', host: '', rest: '' });
  });

  it('names a URL’s host, else the URL itself (Codex’s rule)', () => {
    expect(hostOf('http://127.0.0.1:1/')).toBe('127.0.0.1');
    expect(hostOf('https://e4a.invalid/x')).toBe('e4a.invalid');
    expect(hostOf('nonsense')).toBe('nonsense');
  });
});

it('isSearchUrlTemplate: an http or https URL carrying %s', () => {
  expect(isSearchUrlTemplate(SEARCH)).toBe(true);
  expect(isSearchUrlTemplate('https://duckduckgo.com/?q=%s')).toBe(true);
  expect(isSearchUrlTemplate('https://www.google.com/search?q=')).toBe(false);
  expect(isSearchUrlTemplate('ftp://x/%s')).toBe(false);
  expect(isSearchUrlTemplate('%s')).toBe(false);
});
