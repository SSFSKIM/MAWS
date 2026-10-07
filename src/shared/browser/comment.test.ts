// The pick report's schema and the anchor main builds from it (E4d execution document, Design §6 and §9; X10): `role`
// and `name` only where E4c's `getByRole` will agree, `locator` the css, the box in document pixels, the page URL
// shortened then omitted past X10's cap, and nothing built that X10 or E4c's locator schema would refuse.
import { describe, expect, it } from 'vitest';
import { AnchorSchema } from '../anchor/anchor';
import { anchoredMessage, parseAnchoredText } from '../anchor/message';
import {
  browserElementAnchor,
  CROP_FILES_MAX,
  CROP_MAX_BYTES,
  CROP_MAX_EDGE,
  CROP_RETENTION_MS,
  PickReportSchema,
  PreloadMessageSchema,
} from './comment';
import type { PickReport } from './comment-protocol';
import type { ElementDescription } from './describe';
import { BrowserLocatorSchema } from './locator';

const PAGE = 'http://127.0.0.1:4321/comment.html';
const report = (description: Partial<ElementDescription> = {}, fields: Partial<PickReport> = {}): PickReport => ({
  type: 'picked',
  epoch: 3,
  requestId: null,
  mode: 'click',
  description: { css: '#increment', role: 'button', name: 'Increment', a11y: 'main > region “A form” > button “Increment”', tag: 'button', confident: true, ...description },
  nameOverLong: false,
  rect: { x: 248.4, y: 112.6, width: 96.2, height: 29.5 },
  scroll: { x: 0, y: 200 },
  viewport: { width: 800, height: 600 },
  ...fields,
});
const build = (pick: PickReport, pageUrl = PAGE) => browserElementAnchor({ report: pick, pageUrl, screenshot: null });

describe('browserElementAnchor', () => {
  it('builds E0b’s four targets with the css as the locator, the label, the path and the box', () => {
    expect(browserElementAnchor({ report: report(), pageUrl: PAGE, screenshot: { path: '/u/browser/crops/b_1-2-ab12.png', width: 192, height: 59 } })).toEqual({
      kind: 'browser-element',
      locator: '#increment',
      label: 'button “Increment”',
      pageUrl: PAGE,
      screenshot: { path: '/u/browser/crops/b_1-2-ab12.png', width: 192, height: 59 },
      css: '#increment',
      role: 'button',
      name: 'Increment',
      a11y: 'main > region “A form” > button “Increment”',
      box: { x: 248, y: 313, width: 96, height: 30 },
    });
    const act = build(report({ css: 'body > main > section:nth-of-type(2) > ul > li:nth-of-type(2) > button', name: 'Act', a11y: 'main > list > listitem > button “Act”' }))!;
    expect([act.locator, act.label]).toEqual(['body > main > section:nth-of-type(2) > ul > li:nth-of-type(2) > button', 'button “Act”']);
    expect(build(report({ css: '#name', role: 'textbox', name: 'Name', tag: 'input' }))).toMatchObject({ locator: '#name', label: 'textbox “Name”', role: 'textbox', name: 'Name' });
    expect(build(report({ css: '#\\37  > a', role: 'link', name: 'local link', tag: 'a' }))).toMatchObject({ locator: '#\\37  > a', css: '#\\37  > a', label: 'link “local link”' });
  });

  it('projects to a locator E4c’s schema accepts', () => {
    const { css, role, name } = build(report())!;
    expect(BrowserLocatorSchema.parse({ css, role, name })).toEqual({ css: '#increment', role: 'button', name: 'Increment' });
  });

  it('omits the name when it was cut, empty or doubtful, and the role too when doubtful', () => {
    const cut = build(report({ name: `${'n'.repeat(199)}…` }, { nameOverLong: true }))!;
    expect(cut.name).toBeUndefined();
    expect(cut.role).toBe('button');
    expect(cut.label).toBe(`button “${'n'.repeat(190)}…”`);
    expect(build(report({ role: 'list', name: '', tag: 'ul' }))).toMatchObject({ role: 'list', label: 'list' });
    expect(build(report({ role: 'list', name: '', tag: 'ul' }))!.name).toBeUndefined();
    const hidden = build(report({ confident: false }))!;
    expect([hidden.role, hidden.name, hidden.css, hidden.label]).toEqual([undefined, undefined, '#increment', 'button “Increment”']);
    const plain = build(report({ role: null, name: '', tag: 'div', a11y: '' }))!;
    expect([plain.role, plain.name, plain.a11y, plain.label]).toEqual([undefined, undefined, undefined, 'div']);
  });

  it('builds nothing from a css outside the grammar, a URL that is not http or https, or a field X10 refuses', () => {
    for (const css of ['div, body', 'a[href]', ':has(a)', 'body >> a', 'text=x', ''])
      expect(build(report({ css })), css).toBeNull();
    for (const url of ['file:///etc/hosts', 'javascript:alert(1)', 'about:blank', 'not a url'])
      expect(build(report(), url), url).toBeNull();
    expect(build(report({ role: 'but\nton' }))).toBeNull(); // X10's one-line rule
  });

  it('makes the tag, the name and the path one line before they are used', () => {
    const anchor = build(report({ role: null, name: 'Two\tparts', tag: 'x\ny', a11y: 'region “A”\u0007 > x' }))!;
    expect([anchor.label, anchor.name, anchor.a11y]).toEqual(['x y “Two parts”', 'Two parts', 'region “A” > x']);
  });

  it('shortens a page URL past 2,000 characters to its origin and path, then omits it', () => {
    const long = `https://example.test/search?q=${'x'.repeat(2100)}#frag`;
    expect(build(report(), long)!.pageUrl).toBe('https://example.test/search');
    const path = `https://example.test/${'p'.repeat(2100)}`;
    const anchor = build(report(), path)!;
    expect(anchor.pageUrl).toBeUndefined();
    expect(anchoredMessage({ anchor, text: 'hi', destination: 'main', screenshot: false }).split('\n')[0]).toBe('Comment on "button “Increment”" (element #increment):');
  });

  it('takes the box from the rect and the scroll, in whole document pixels, at least one pixel wide', () => {
    expect(build(report({}, { rect: { x: 10.5, y: 0.4, width: 0.3, height: 0 }, scroll: { x: 100, y: 1500.2 } }))!.box).toEqual({ x: 111, y: 1501, width: 1, height: 1 });
    expect(build(report({}, { mode: 'area', rect: { x: 0, y: 0, width: 640.6, height: 380.4 }, scroll: { x: 0, y: 0 } }))!.box).toEqual({ x: 0, y: 0, width: 641, height: 380 });
  });

  it('round-trips through the agent-facing text', () => {
    const anchor = build(report({ css: '#\\37  > a', role: 'link', name: 'local link', tag: 'a', a11y: 'main > paragraph > link “local link”' }))!;
    expect(AnchorSchema.parse(anchor)).toEqual(anchor);
    expect(parseAnchoredText(anchoredMessage({ anchor, text: 'Where to?', destination: 'thread', screenshot: false }))).toEqual({ anchor, text: 'Where to?', destination: 'thread' });
  });
});

describe('PickReportSchema', () => {
  it('admits a report within the caps', () => {
    expect(PickReportSchema.parse(report())).toEqual(report());
    expect(PickReportSchema.safeParse(report({ role: null, name: 'n'.repeat(200), a11y: 'a'.repeat(300) }, { requestId: 'r1', mode: 'area' })).success).toBe(true);
  });

  it('refuses an unknown field, an over-long string and a number that is not finite', () => {
    const bad: unknown[] = [
      { ...report(), url: 'https://x.test/' },
      { ...report(), description: { ...report().description, html: '<b>' } },
      report({ name: 'n'.repeat(201) }),
      report({ a11y: 'a'.repeat(301) }),
      report({ role: 'r'.repeat(65) }),
      report({ role: '' }),
      report({ tag: 't'.repeat(65) }),
      report({ css: 'x'.repeat(2001) }),
      report({}, { epoch: -1 }),
      report({}, { epoch: 1.5 }),
      { ...report(), mode: 'hover' },
      report({}, { rect: { x: Number.NaN, y: 0, width: 1, height: 1 } }),
      report({}, { scroll: { x: Number.POSITIVE_INFINITY, y: 0 } }),
      report({}, { viewport: { width: 0, height: 600 } }),
      report({}, { rect: { x: 0, y: 0, width: -1, height: 1 } }),
    ];
    for (const [index, value] of bad.entries()) expect(PickReportSchema.safeParse(value).success, String(index)).toBe(false);
  });

  it('reads the arm\'s acknowledgement, the epoch alone (Decision Log 34)', () => {
    expect(PreloadMessageSchema.parse({ type: 'armed', epoch: 3 })).toEqual({ type: 'armed', epoch: 3 });
    for (const bad of [{ type: 'armed' }, { type: 'armed', epoch: -1 }, { type: 'armed', epoch: '3' }, { type: 'armed', epoch: 3, requestId: null }])
      expect(PreloadMessageSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
  });

  it('reads a preload message as a pick or a refusal', () => {
    expect(PreloadMessageSchema.parse({ type: 'refused', epoch: 2, requestId: null, reason: 'tooDeep' })).toEqual({ type: 'refused', epoch: 2, requestId: null, reason: 'tooDeep' });
    expect(PreloadMessageSchema.safeParse({ type: 'refused', epoch: 2, requestId: 'r', reason: 'other' }).success).toBe(false);
    expect(PreloadMessageSchema.parse(report()).type).toBe('picked');
  });
});

describe('the crop’s bounds', () => {
  it('are the composer’s image rule and A-34’s byte cap', () => {
    expect([CROP_MAX_EDGE, CROP_MAX_BYTES, CROP_RETENTION_MS, CROP_FILES_MAX]).toEqual([1568, 3.5 * 1024 * 1024, 7 * 86_400_000, 200]);
  });
});
