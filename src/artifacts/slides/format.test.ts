// P3-C M1: the kind's format reference is the table the loader enforces, and its examples are what the serializer writes.
import { describe, expect, it } from 'vitest';
import format from '../types/presentation/format.md?raw';
import { CSS_GRAMMAR } from './css';
import { parseDeckJson, serializeDeckJson } from './deck';
import { loadSlide } from './parse';
import { serializeSlide } from './serialize';

const section = (heading: string) => format.split(/^#+ /m).find((s) => s.startsWith(`${heading}\n`)) ?? '';
const fences = (text: string, lang: string) => [...text.matchAll(new RegExp('^```' + lang + '\\n([\\s\\S]*?)\\n```$', 'gm'))].map((m) => m[1]!);

describe('format.md (the presentation format reference)', () => {
  it('keeps the kind’s four sections, written', () => {
    expect(format.split('\n').filter((l) => l.startsWith('## '))).toEqual(['## Structure', '## Elements and attributes', '## Limits', '## Examples']);
    expect(format).not.toMatch(/Not yet written/);
  });

  it('states the CSS css.ts enforces, line for line', () => {
    const [block] = fences(section('Supported CSS'), '');
    expect(block?.split('\n')).toEqual([...CSS_GRAMMAR]);
  });

  it('shows slides the loader takes as they are written: no slide held, no warning, already canonical', () => {
    const slides = fences(section('Examples'), 'html');
    expect(slides.length).toBeGreaterThanOrEqual(3);
    for (const html of slides) {
      const loaded = loadSlide(html);
      expect(loaded.ok, html.slice(0, 40)).toBe(true);
      if (!loaded.ok) continue;
      expect(loaded.diagnostics.filter((d) => d.severity === 'warning')).toEqual([]);
      expect(serializeSlide(loaded.slide)).toBe(`${html}\n`);
    }
  });

  it('shows an index the loader takes as it is written', () => {
    const [json] = fences(section('Examples'), 'json');
    const parsed = parseDeckJson(json!);
    expect(parsed.ok && parsed.diagnostics).toEqual([]);
    if (parsed.ok) expect(serializeDeckJson(parsed.deck)).toBe(`${json}\n`);
  });
});
