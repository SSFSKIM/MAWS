// UX wave U3b, M5 (decision 18, Interfaces §F, acceptance 12): the one answer to "is this a web fetch", over the web
// plugin's recorded calls (Engine facts 11), and the guard that no other place compares a tool's name to `WebFetch`.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { recordedWebFetches, webFetchCases } from '../../../test/support/web-fetch-recorded';
import { isWebFetch, WEB_FETCH_TOOLS, webFetchUrl } from './web-fetch';

describe('a web fetch', () => {
  it('is the engine’s WebFetch and the web plugin’s fetch, by the names the engine sent', () => {
    expect(recordedWebFetches().map((call) => call.toolName)).toEqual(['mcp__web__fetch', 'mcp__web__fetch']);
    for (const [label, call] of webFetchCases()) expect(isWebFetch(call.toolName), label).toBe(true);
    expect(WEB_FETCH_TOOLS).toEqual(['WebFetch', 'mcp__web__fetch']);
  });

  it('is no other tool: not WebSearch, not another of the plugin’s or another server’s tools, not a name that only contains one', () => {
    for (const name of ['WebSearch', 'mcp__web__search', 'mcp__web__read', 'mcp__docs__fetch', 'mcp__web__fetch_page', 'webfetch', 'Fetch', '']) expect(isWebFetch(name), name).toBe(false);
  });

  it('asked for the page its input names, with a prompt or without', () => {
    const [prompted, bare] = recordedWebFetches();
    expect(prompted.input).toEqual({ url: 'https://example.com', prompt: "What is the page's main heading?" });
    expect(bare.input).toEqual({ url: 'https://example.com' });
    for (const [label, call] of webFetchCases()) expect(webFetchUrl(call.input), label).toBe('https://example.com');
    for (const input of [null, undefined, 'https://example.com', {}, { url: 42 }, { query: 'x' }]) expect(webFetchUrl(input)).toBeNull();
  });

  it('carries its result as one string (Engine facts 11)', () => {
    for (const call of recordedWebFetches()) {
      expect(typeof call.result, call.form).toBe('string');
      expect(call.result, call.form).toContain('example.com');
    }
  });
});

// Every place that draws, groups, captions, digests or allows a call asks `isWebFetch`: no source of the renderer, the
// services or the shared code names `WebFetch` as a string or a table's key, but this module and `READ_ONLY_TOOLS`' own
// list. Tests are outside the guard (they name it beside the plugin's fetch on purpose); comments are not code.
const ROOT = resolve(__dirname, '../../..');
const sources = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'node_modules' ? [] : sources(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
const code = (path: string) =>
  readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n');
const NAMED = /(['"`])WebFetch\1|(?:^|[\s{,])WebFetch\s*:/m;

describe('the one place that names WebFetch', () => {
  it('is the helper, and READ_ONLY_TOOLS’ own list', () => {
    const helper = join(ROOT, 'src/shared/engine/web-fetch.ts');
    const readOnly = join(ROOT, 'src/shared/attention/read-only-tools.ts');
    const files = ['src/renderer/src', 'src/services', 'src/shared'].flatMap((dir) => sources(join(ROOT, dir)));
    expect(files).toContain(readOnly);
    const naming = files
      .filter((path) => path !== helper)
      .filter((path) => NAMED.test(path === readOnly ? code(path).replace(/export const READ_ONLY_TOOLS = \[[^\]]*\] as const;/, '') : code(path)))
      .map((path) => relative(ROOT, path));
    expect(naming).toEqual([]);
    expect(NAMED.test(code(helper))).toBe(true);
  });
});
