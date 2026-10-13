import { describe, expect, it } from 'vitest';
import {
  contrastRatio,
  cssNamesOf,
  DECK_KEY,
  generateTokensCss,
  OFFICE_KEY,
  parseTokens,
  serializeTokens,
  TYPE_ROLES,
  validateTokenFile,
  type ColorValue,
  type DimensionValue,
  type ResolvedTokens,
} from '../../design-system';
import { defaultAssetNames, loadDefaultAssets } from './default-assets';
import { DEFAULT_SYSTEMS, defaultSystem, HOUSE_KEY } from './defaults';
import formatReference from './format.md?raw';
import guide from './SKILL.md?raw';

// Every file under defaults/, by a pattern of this test's own (never loaded), so a directory or a file the bundle
// module misses shows up as a difference here.
const ON_DISK = Object.keys(import.meta.glob('./defaults/**/*')).map((key) => key.slice('./defaults/'.length));
const DIRECTORIES = [...new Set(ON_DISK.map((path) => path.split('/')[0]!))].sort();
const isAsset = (path: string) => path.startsWith('assets/');

const tokensOf = (key: string) => {
  const result = validateTokenFile(defaultSystem(key)!.files['tokens.tokens.json']);
  return { ...result, resolved: result.resolved as ResolvedTokens };
};
const colorAt = (resolved: ResolvedTokens, path: string): ColorValue => {
  const token = resolved.tokens.get(path);
  if (token?.type !== 'color') throw new Error(`${path} is not a resolved colour`);
  return token.value;
};

describe('the bundled default design systems', () => {
  it('enumerates every directory under defaults/ as one system, the house among them', () => {
    expect(DEFAULT_SYSTEMS.map((s) => s.key)).toEqual(DIRECTORIES);
    expect(DIRECTORIES.length).toBeGreaterThan(0);
    expect(defaultSystem(HOUSE_KEY)?.key).toBe(HOUSE_KEY);
    expect(defaultSystem('no-such-system')).toBeUndefined();
  });

  it('carries every text file of a directory by its path inside it, and leaves the assets to default-assets', () => {
    for (const system of DEFAULT_SYSTEMS) {
      const inDirectory = ON_DISK.filter((p) => p.startsWith(`${system.key}/`)).map((p) => p.slice(system.key.length + 1));
      expect(Object.keys(system.files).sort(), system.key).toEqual(inDirectory.filter((p) => !isAsset(p)).sort());
      expect(defaultAssetNames(system.key).map((n) => `assets/${n}`).sort(), system.key).toEqual(inDirectory.filter(isAsset).sort());
      expect(system.files['DESIGN.md'], system.key).toBeTruthy();
      expect(system.files['tokens.tokens.json'], system.key).toBeTruthy();
    }
  });

  it('names each system by its law’s title', () => {
    for (const system of DEFAULT_SYSTEMS) {
      expect(system.files['DESIGN.md']!.split('\n')[0], system.key).toBe(`# ${system.name}`);
      expect(system.name.length, system.key).toBeGreaterThan(0);
    }
  });

  describe.each(DIRECTORIES)('%s', (key) => {
    const system = defaultSystem(key)!;
    const canon = Object.entries(system.files).filter(([path]) => path.startsWith('layouts/') || path.startsWith('components/'));

    it('has a token file that validates with no problem and is already in canonical form', () => {
      const result = validateTokenFile(system.files['tokens.tokens.json']);
      expect(result.problems).toEqual([]);
      expect(serializeTokens(parseTokens(system.files['tokens.tokens.json']).tokens!)).toBe(system.files['tokens.tokens.json']);
    });

    it('sets its page as US Letter with a margin (Decision Log 6) and a deck size on every type role (D2)', () => {
      const { tokens } = tokensOf(key);
      const page = tokens!.groups.get('')!.$extensions!['dev.maws.page'] as { size: unknown; margin: DimensionValue };
      expect(page.size).toBe('letter');
      expect(page.margin.unit).toBe('px');
      expect(page.margin.value).toBeGreaterThan(0);
      for (const role of TYPE_ROLES) {
        const token = tokens!.tokens.get(`type.${role}`)!;
        const deck = token.$extensions?.[DECK_KEY] as { fontSize: DimensionValue } | undefined;
        const documentSize = (token.$value as { fontSize: DimensionValue }).fontSize;
        expect(deck?.fontSize.value, role).toBeGreaterThan(documentSize.value);
      }
    });

    it('names its Office faces, Latin and East Asian, for headings and body', () => {
      const { tokens } = tokensOf(key);
      const office = tokens!.groups.get('')!.$extensions![OFFICE_KEY] as { fonts: Record<'major' | 'minor', { latin?: string; ea?: string }> };
      for (const set of ['major', 'minor'] as const) {
        expect(office.fonts[set].latin, set).toBeTruthy();
        expect(office.fonts[set].ea, set).toBeTruthy();
      }
    });

    it('meets the contrast floor: body text 4.5 : 1 on both grounds, large text and controls 3 : 1', () => {
      const { resolved } = tokensOf(key);
      const at = (path: string) => colorAt(resolved, path);
      const floor: [string, string, number][] = [
        ['color.text.$root', 'color.bg.$root', 4.5],
        ['color.text.$root', 'color.bg.raised', 4.5],
        ['color.text.muted', 'color.bg.$root', 4.5],
        ['color.text.muted', 'color.bg.raised', 4.5],
        ['color.accent.$root', 'color.bg.$root', 3],
        ['color.accent.text', 'color.accent.$root', 3],
        ...(['ok', 'warn', 'error', 'info'] as const).map((s): [string, string, number] => [`color.status.${s}`, 'color.bg.$root', 3]),
      ];
      for (const [fg, bg, min] of floor) expect(contrastRatio(at(fg), at(bg)), `${fg} on ${bg}`).toBeGreaterThanOrEqual(min);
    });

    it('has three to six layouts, each one section named as its file, and its document stylesheet', () => {
      const layouts = canon.filter(([path]) => path.startsWith('layouts/'));
      expect(layouts.length).toBeGreaterThanOrEqual(3);
      expect(layouts.length).toBeLessThanOrEqual(6);
      for (const [path, html] of layouts) {
        const id = path.slice('layouts/'.length, -'.html'.length);
        expect(html.trim(), path).toMatch(new RegExp(`^<section id="${id}"[^>]*>[\\s\\S]*</section>$`));
        expect(html.match(/<section\b/g), path).toHaveLength(1);
        expect(html, path).toMatch(/data-ph="[\w-]+"/);
      }
      expect(system.files['components/document.css']).toMatch(/\.ds-doc\b/);
      expect(canon.filter(([path]) => /^components\/.+\.html$/.test(path)).length).toBeGreaterThanOrEqual(2);
    });

    it('reads in its canon only the --ds-* names its own tokens.css defines', () => {
      const { tokens } = tokensOf(key);
      const defined = new Set([...generateTokensCss(tokens!).matchAll(/^ {2}(--ds-[\w-]+):/gm)].map((m) => m[1]));
      // The names a system must define (the ledger's) are all there, so a role read in the canon is a defined one.
      for (const token of tokensOf(key).resolved.tokens.values()) for (const name of cssNamesOf(token.path, token.type)) expect(defined).toContain(name);
      for (const [path, text] of canon) {
        for (const [, name] of text.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/var\((--[\w-]+)/g)) expect(defined, `${path}: ${name}`).toContain(name);
      }
    });

    it('refers from its canon to no asset it does not bundle', () => {
      const assets = new Set(defaultAssetNames(key));
      for (const [path, text] of canon) {
        for (const [, ref] of text.matchAll(/(?:url\(\s*["']?|src=")([^"')\s]+)/g)) {
          expect(ref, path).toMatch(/^assets\//);
          expect(assets, `${path}: ${ref}`).toContain(ref!.slice('assets/'.length));
        }
      }
    });
  });

  it('loads a system’s assets as bytes, on demand', async () => {
    for (const key of DIRECTORIES) {
      const assets = await loadDefaultAssets(key);
      expect(assets.map((a) => a.name).sort()).toEqual([...defaultAssetNames(key)].sort());
    }
    const official = await loadDefaultAssets('official');
    const fonts = official.filter((a) => a.name.endsWith('.woff2'));
    expect(fonts.map((a) => a.name).sort()).toEqual(['NotoSerifKR-Bold-full.woff2', 'NotoSerifKR-Regular-full.woff2']);
    for (const font of fonts) {
      expect(font.mime).toBe('font/woff2');
      expect(new TextDecoder().decode(font.bytes.subarray(0, 4))).toBe('wOF2');
      expect(font.bytes.length).toBeGreaterThan(1_000_000);
    }
    const licence = official.find((a) => a.name === 'OFL.txt')!;
    expect(licence.mime).toBe('text/plain');
    expect(new TextDecoder().decode(licence.bytes)).toMatch(/SIL OPEN FONT LICENSE Version 1\.1/);
    await expect(loadDefaultAssets('no-such-system')).resolves.toEqual([]);
  });
});

describe('the design system’s format reference', () => {
  const blocks = [...formatReference.matchAll(/^```json\n([\s\S]*?)^```$/gm)].map((m) => m[1]!);

  it('gives at least one whole token file as an example, and every one validates', () => {
    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) expect(validateTokenFile(block).problems).toEqual([]);
  });

  it('is written in full beside the guide, which names the routes and the write order', () => {
    expect(formatReference).not.toMatch(/Not yet written/);
    expect(guide).not.toMatch(/Not yet written/);
    for (const phrase of ['designer', 'adopted from', 'artifact_create', 'DESIGN.md', 'tokens.tokens.json', 'artifact_publish', 'hard don']) expect(guide).toContain(phrase);
  });

  it('states D12’s limits and the check tags', () => {
    for (const phrase of ['512 tokens', '64 tokens per group', '256 KB', '64 canon files', '64 KB']) expect(formatReference).toContain(phrase);
    for (const tag of ['literal-color', 'font-family', 'no-gradient', 'no-shadow', 'accent-max', 'radius-max', 'type-scale', 'max-words', 'contrast']) {
      expect(formatReference).toContain(tag);
    }
  });
});
