// The manifest and the icons are served past Access (an Access bypass at DC3's M5, so iOS can fetch them for the home
// screen): they must stay static and carry nothing of an org — no name, id, member, email, or hub address. These
// cases fail if either ever does.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const PUBLIC = join(import.meta.dirname, '..', '..', 'public');
const MANIFEST = join(PUBLIC, 'manifest.webmanifest');
const ICONS = join(PUBLIC, 'icons');

/** What would name an org, a member, or a hub in a text. */
const ORG_SPECIFIC: Array<[string, RegExp]> = [
  ['an email address', /[\w.+-]+@[\w-]+\.[\w.-]+/],
  ['an absolute URL', /\b(?:https?|wss?):\/\//],
  ['a uuid', /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i],
  ['a member id (32 hex)', /\b[0-9a-f]{32}\b/i],
  ['a template placeholder', /\{\{|\$\{|%[A-Z_]+%/],
];

function orgSpecific(text: string): string[] {
  return ORG_SPECIFIC.filter(([, pattern]) => pattern.test(text)).map(([what]) => what);
}

describe('the files served past Access', () => {
  it('the manifest is the static one, with nothing of an org in it', () => {
    const text = readFileSync(MANIFEST, 'utf8');
    expect(orgSpecific(text)).toEqual([]);
    const manifest = JSON.parse(text) as Record<string, unknown>;
    expect(Object.keys(manifest).sort()).toEqual(['background_color', 'description', 'display', 'icons', 'id', 'name', 'scope', 'short_name', 'start_url', 'theme_color']);
    expect(manifest).toMatchObject({ id: '/', name: 'Desk', short_name: 'Desk', start_url: '/', scope: '/', display: 'standalone' });
    for (const icon of manifest.icons as Array<{ src: string }>) expect(icon.src).toMatch(/^\/icons\/[\w.-]+\.png$/);
  });

  it('the icons are static images, carrying no text of an org', () => {
    const files = readdirSync(ICONS);
    expect(files.sort()).toEqual(['apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'icon.svg']);
    // The SVG namespace is the one URL an SVG must carry.
    expect(orgSpecific(readFileSync(join(ICONS, 'icon.svg'), 'utf8').replace('xmlns="http://www.w3.org/2000/svg"', ''))).toEqual([]);
    for (const png of files.filter((f) => f.endsWith('.png'))) {
      const bytes = readFileSync(join(ICONS, png));
      // A PNG's text lives in tEXt, zTXt, and iTXt chunks; these carry none.
      const chunks: string[] = [];
      for (let at = 8; at + 8 <= bytes.length; ) {
        const length = bytes.readUInt32BE(at);
        chunks.push(bytes.toString('latin1', at + 4, at + 8));
        at += 12 + length;
      }
      expect(chunks[0], png).toBe('IHDR');
      expect(chunks.filter((c) => ['tEXt', 'zTXt', 'iTXt', 'eXIf'].includes(c)), png).toEqual([]);
    }
  });

  it('would catch what an org would put there', () => {
    expect(orgSpecific('{"name": "Desk · owner@example.com"}')).toEqual(['an email address']);
    expect(orgSpecific('"start_url": "https://desk.example.com/"')).toEqual(['an absolute URL']);
    expect(orgSpecific('"id": "4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c"')).toEqual(['a member id (32 hex)']);
  });
});
