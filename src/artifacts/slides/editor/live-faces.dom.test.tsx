// P3-C final fix wave B, finding B6 (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D6, D8): two decks drawn
// in one window (a panel beside a main tab), each with its own upload of a family both call `Brand`, each draw their own:
// the live editor declares a deck's uploaded faces under private names (as the history preview does, faces.ts) and its
// canvases draw them by those names, as the element is written and as it changes.
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { newDoc, transact, type Doc } from '../../yjs';
import * as Y from '../../yjs/slides';
import { LORA_FILES, loraFace } from '../export/faces.test-support';
import { importSlide, setStyle, writeDeckKeys } from '../model';
import { loadSlide } from '../parse';
import { DeckEditor } from './DeckEditor';
import { DeckSession } from './session';

function deck(src: string): Doc {
  const doc = newDoc();
  const l = loadSlide(`<section id="a"><h2 id="t" style="font-family:Brand, sans-serif">Title</h2></section>`);
  if (!l.ok) throw new Error('fixture');
  transact(doc, () => {
    writeDeckKeys(doc, { v: 4, title: 'Q3', order: ['a'] });
    importSlide(doc, l.slide, 'a0');
    Y.setDeckEntry(doc, 'faces', 'brand', { family: 'Brand', src });
  });
  return doc;
}

afterEach(cleanup);

/** Every @font-face the window's deck styles declare: family → the sources it loads. */
function declared(): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const style of document.querySelectorAll('style[data-deck-faces]')) {
    for (const m of (style.textContent ?? '').matchAll(/@font-face\s*\{\s*font-family:\s*"([^"]+)";\s*src:\s*url\("([^"]+)"\)/g)) {
      const srcs = out.get(m[1]!.toLowerCase()) ?? new Set<string>();
      srcs.add(m[2]!);
      out.set(m[1]!.toLowerCase(), srcs);
    }
  }
  return out;
}
const firstFamily = (n: HTMLElement) => n.style.getPropertyValue('font-family').split(',')[0]!.trim().replace(/^["']|["']$/g, '').toLowerCase();

describe('live faces per deck (B6)', () => {
  it('two decks with their own Brand uploads each draw their own, in the stage and the filmstrip', () => {
    const a = deck('assets/brand-a.woff2');
    const b = deck('assets/brand-b.woff2');
    const one = render(<DeckEditor session={new DeckSession(a)} assetUrl={(ref) => `maws-artifact://A/live/${ref}`} system={null} readOnly={false} />);
    const two = render(<DeckEditor session={new DeckSession(b)} assetUrl={(ref) => `maws-artifact://B/live/${ref}`} system={null} readOnly={false} />);
    const faces = declared();
    for (const srcs of faces.values()) expect(srcs.size).toBe(1); // no family two decks compete for
    for (const [container, url] of [
      [one.container, 'maws-artifact://A/live/assets/brand-a.woff2'],
      [two.container, 'maws-artifact://B/live/assets/brand-b.woff2'],
    ] as const) {
      const drawn = [...container.querySelectorAll<HTMLElement>('.maws-slide [data-eid="t"]')];
      expect(drawn.length).toBeGreaterThanOrEqual(2); // the stage and the thumbnail
      for (const n of drawn) expect([...(faces.get(firstFamily(n)) ?? [])]).toEqual([url]);
    }
  });

  it('a family written later draws by the deck’s private name too; the model keeps the authored one', () => {
    const a = deck('assets/brand-a.woff2');
    const { container } = render(<DeckEditor session={new DeckSession(a)} assetUrl={(ref) => `maws-artifact://A/live/${ref}`} system={null} readOnly={false} />);
    act(() => setStyle(a, 'a', 't', { 'font-family': 'Georgia, serif' }));
    act(() => setStyle(a, 'a', 't', { 'font-family': '"Brand", serif' }));
    const faces = declared();
    for (const n of container.querySelectorAll<HTMLElement>('.maws-slide [data-eid="t"]')) expect([...(faces.get(firstFamily(n)) ?? [])]).toEqual(['maws-artifact://A/live/assets/brand-a.woff2']);
    expect(Y.elementScalars(a, 'a', 't')['style:font-family']).toBe('"Brand", serif');
  });

  // P4-B2 D19 (docs/doperpowers/plans/2026-10-21-p4-b2-slides-boards.md): a Google Fonts face the host saved in the deck
  it('a fetched Google Fonts face draws from every file the deck saved, each with its weight and style, by the deck’s private name', () => {
    const doc = deck('assets/brand-a.woff2');
    transact(doc, () => Y.setDeckEntry(doc, 'faces', 'lora', loraFace() as Y.Json));
    setStyle(doc, 'a', 't', { 'font-family': 'Lora, serif' });
    const { container } = render(<DeckEditor session={new DeckSession(doc)} assetUrl={(ref) => `maws-artifact://A/live/${ref}`} system={null} readOnly={false} />);
    const urls = LORA_FILES.map((file) => `maws-artifact://A/live/${file.src}`);
    const drawn = [...container.querySelectorAll<HTMLElement>('.maws-slide [data-eid="t"]')];
    expect(drawn.length).toBeGreaterThanOrEqual(2);
    for (const n of drawn) expect([...(declared().get(firstFamily(n)) ?? [])].sort()).toEqual([...urls].sort());
    const alias = firstFamily(drawn[0]!);
    const css = [...document.querySelectorAll('style[data-deck-faces]')].map((style) => style.textContent).join('\n');
    for (const [k, file] of LORA_FILES.entries()) expect(css).toContain(`src: url("${urls[k]}"); font-weight: ${file.weight}; font-style: ${file.style};`);
    expect(alias).toMatch(/^deck-face-/);
  });
});
