// P4-AGG M3: Discover's icons (the Discover spec's Decision Log 7(b)): main fetches a directory icon through the catalog
// egress rule, only from its two Anthropic icon routes, caches it beside the catalog and hands the renderer data; any
// other host (Google's favicon service among them) is never asked and answers no icon, so the card draws a monogram.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CATALOG_EGRESS, egressGet, type BaseFetch } from '@shared/net/egress';
import { iconGet, iconsFixtureName } from './fetch';
import { CatalogIcons } from './icons';

const PLUGIN_ICON = 'https://api.anthropic.com/api/directory/plugin-icons/cdec906b4f0651042cc7ecc57e40bfb3a39ced821a7382e32f8223f721fbfa24/256.png';
const SERVER_SVG = 'https://storage.googleapis.com/media-assets-299d7136-cb52-d546-ee02-34bc1307c35f/mcp-directory/icons/pubmed.svg';
const FAVICON = 'https://t0.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://drive.google.com&size=64';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>');

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'maws-agg-icons-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

// The network as the guarded GET reaches it: each URL answered by `respond`, every request recorded.
function network(respond: (url: string) => Response = (url) => new Response(url.endsWith('.svg') ? SVG : PNG, { headers: { 'content-type': url.endsWith('.svg') ? 'image/svg+xml' : 'image/png' } })) {
  const asked: string[] = [];
  const base: BaseFetch = async (url) => {
    asked.push(url);
    return respond(url);
  };
  return { asked, get: iconGet({}, 'MAWS/9', egressGet(CATALOG_EGRESS, base)) };
}

const dataOf = (bytes: Uint8Array, type: string) => `data:${type};base64,${Buffer.from(bytes).toString('base64')}`;

describe('the catalog’s icons', () => {
  it('answers a directory icon as data, fetched once through the catalog rule and then read from the cache', async () => {
    const { asked, get } = network();
    const icons = new CatalogIcons({ dir: join(dir, 'icons'), get });
    expect(await icons.dataUrl(PLUGIN_ICON)).toBe(dataOf(PNG, 'image/png'));
    expect(await icons.dataUrl(SERVER_SVG)).toBe(dataOf(SVG, 'image/svg+xml'));
    expect(asked).toEqual([PLUGIN_ICON, SERVER_SVG]);
    // a new run reads the copies on disk and asks the network for nothing
    const again = network();
    const next = new CatalogIcons({ dir: join(dir, 'icons'), get: again.get });
    expect(await next.dataUrl(PLUGIN_ICON)).toBe(dataOf(PNG, 'image/png'));
    expect(again.asked).toEqual([]);
  });

  it('never asks another host: Google’s favicon service and a vendor’s site answer no icon, without a request', async () => {
    const { asked, get } = network();
    const icons = new CatalogIcons({ dir, get });
    for (const url of [FAVICON, 'https://www.notion.so/images/notion-logo-block-main.svg', 'https://mcp.linear.app/mcp', 'not a url']) expect(await icons.dataUrl(url), url).toBeNull();
    expect(asked).toEqual([]);
  });

  it('asks once for icons asked together, and refuses bytes that are not the image their type names', async () => {
    const { asked, get } = network((url) => new Response(url.includes('pubmed') ? '<html>' : PNG, { headers: { 'content-type': url.includes('pubmed') ? 'image/svg+xml' : 'image/png' } }));
    const icons = new CatalogIcons({ dir, get });
    const [a, b] = await Promise.all([icons.dataUrl(PLUGIN_ICON), icons.dataUrl(PLUGIN_ICON)]);
    expect(a).toBe(b);
    expect(asked).toEqual([PLUGIN_ICON]);
    expect(await icons.dataUrl(SERVER_SVG)).toBeNull();
  });

  it('remembers a failure for five minutes, then asks again', async () => {
    let now = 1_000_000;
    let up = false;
    const { asked, get } = network(() => (up ? new Response(PNG, { headers: { 'content-type': 'image/png' } }) : new Response('no', { status: 503 })));
    const icons = new CatalogIcons({ dir, get, now: () => now });
    expect(await icons.dataUrl(PLUGIN_ICON)).toBeNull();
    up = true;
    expect(await icons.dataUrl(PLUGIN_ICON)).toBeNull();
    expect(asked).toHaveLength(1);
    now += 5 * 60 * 1000;
    expect(await icons.dataUrl(PLUGIN_ICON)).toBe(dataOf(PNG, 'image/png'));
    expect(asked).toHaveLength(2);
  });

  it('refetches a server icon a day old, keeping its copy when that fails; a plugin icon is named by its content and kept', async () => {
    let now = 0;
    let up = true;
    const { asked, get } = network((url) => (up ? new Response(url.endsWith('.svg') ? SVG : PNG, { headers: { 'content-type': url.endsWith('.svg') ? 'image/svg+xml' : 'image/png' } }) : new Response('no', { status: 503 })));
    const icons = new CatalogIcons({ dir, get, now: () => now });
    await icons.dataUrl(PLUGIN_ICON);
    await icons.dataUrl(SERVER_SVG);
    now += 25 * 60 * 60 * 1000;
    up = false;
    expect(await icons.dataUrl(PLUGIN_ICON)).toBe(dataOf(PNG, 'image/png'));
    expect(await icons.dataUrl(SERVER_SVG)).toBe(dataOf(SVG, 'image/svg+xml'));
    expect(asked).toEqual([PLUGIN_ICON, SERVER_SVG, SERVER_SVG]);
  });

  it('caches beside the catalog, one file per icon', async () => {
    const { get } = network();
    await new CatalogIcons({ dir: join(dir, 'icons'), get }).dataUrl(PLUGIN_ICON);
    expect(readdirSync(join(dir, 'icons'))).toEqual([`${createHash('sha256').update(PLUGIN_ICON).digest('hex')}.json`]);
  });
});

describe('the icons’ fetch in each environment', () => {
  it('reads the fixture directory’s icons/ under MAWS_CATALOG_FIXTURES (a missing file is no icon), never the network', async () => {
    mkdirSync(join(dir, 'icons'));
    writeFileSync(join(dir, 'icons', iconsFixtureName(PLUGIN_ICON)), PNG);
    const get = iconGet({ MAWS_CATALOG_FIXTURES: dir }, 'MAWS');
    expect(await get(PLUGIN_ICON)).toEqual({ contentType: 'image/png', bytes: PNG });
    expect(await get(SERVER_SVG)).toBeNull();
    expect(iconsFixtureName(SERVER_SVG)).toMatch(/^[0-9a-f]{64}\.svg$/);
  });

  it('answers no icon under MAWS_E2E=1 without fixtures', async () => {
    expect(await iconGet({ MAWS_E2E: '1' }, 'MAWS')(PLUGIN_ICON)).toBeNull();
    expect(existsSync(join(dir, 'icons'))).toBe(false);
  });

  it('fetches under MAWS_E2E=1 only for the live smoke (MAWS_CATALOG_LIVE=1), through the catalog rule', async () => {
    const asked: string[] = [];
    const get = egressGet(CATALOG_EGRESS, async (url) => {
      asked.push(url);
      return new Response(PNG, { headers: { 'content-type': 'image/png' } });
    });
    expect(await iconGet({ MAWS_E2E: '1' }, 'MAWS', get)(PLUGIN_ICON)).toBeNull();
    expect(asked).toEqual([]);
    expect(await iconGet({ MAWS_E2E: '1', MAWS_CATALOG_LIVE: '1' }, 'MAWS', get)(PLUGIN_ICON)).toEqual({ contentType: 'image/png', bytes: PNG });
    await expect(iconGet({ MAWS_E2E: '1', MAWS_CATALOG_LIVE: '1' }, 'MAWS', get)(FAVICON)).rejects.toThrow('does not admit'); // still the rule's routes alone
    expect(asked).toEqual([PLUGIN_ICON]);
  });
});
