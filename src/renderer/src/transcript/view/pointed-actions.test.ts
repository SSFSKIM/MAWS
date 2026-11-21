// The word cut ("What the cut builds"; T18, T75, T84, T101, T106): an action every row repeats is drawn on the pointed
// row and on keyboard focus within it, and always where nothing can point (a phone's desk). happy-dom matches no media
// query, so the stylesheet is read: each such action is hidden at rest and named again under `(hover: none)`.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(__dirname, 'transcript.css'), 'utf8');
const noHover = [...css.matchAll(/@media \(hover: none\) \{([^}]*)\}/g)].map((match) => match[1]).join('\n');
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selectors, body]) => ({ selectors: selectors!, body: body! }));

const ACTIONS = [
  '.transcript-copy-glyph[data-on-hover]', // T18 (task 1)
  '.transcript-peer-reply[data-on-hover]', // T75
  '.transcript-listing-entry [data-on-hover]', // T84
  '.transcript-delivery-file [data-on-hover]', // T101
  '.transcript-browser-action [data-on-hover]', // T106
];

describe('actions drawn on the pointed row', () => {
  it.each(ACTIONS)('%s is hidden at rest and drawn always where nothing points', (selector) => {
    expect(rules.some((rule) => !rule.selectors.includes('@media') && rule.selectors.includes(selector) && /opacity: 0\b/.test(rule.body))).toBe(true);
    expect(noHover).toContain(selector);
  });
});
