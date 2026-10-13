// The editor's theme (D3 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md; the ledger's X28 names): no literal
// colour in the editor's stylesheets; the page reads only the design system's names, each falling back to an app
// token; with no `--ds-*` defined every computed colour of a rendered document is an app token's, and a design
// system's value, once defined, wins over it.
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AUTHOR_COLORS } from '@shared/artifacts/actor';
import tokensCss from '../../../renderer/src/styles/tokens.css?raw';
import chromeCss from './chrome.css?raw';
import { DocumentEditor } from './DocumentEditor';
import themeCss from './theme.css?raw';
import type { DocumentHandle } from './host-types';
import { memoryEditorHost, openMemoryHandle, whenSynced } from './memory-host';
import { World, doc, para, ticks, until } from './test-world';

// The X28 row's CSS names (docs/doperpowers/plans/2026-10-12-p3-interface-ledger.md).
const DS_NAMES = new Set([
  ...['bg', 'bg-raised', 'text', 'text-muted', 'accent', 'accent-text', 'border', 'status-ok', 'status-warn', 'status-error', 'status-info'].map((n) => `--ds-color-${n}`),
  ...['display', 'body', 'mono'].map((n) => `--ds-font-${n}`),
  ...['title', 'subtitle', 'h1', 'h2', 'h3', 'body', 'caption', 'quote'].flatMap((role) => ['size', 'line', 'weight'].map((p) => `--ds-type-${role}-${p}`)),
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => `--ds-space-${n}`),
  ...['sm', 'md', 'lg', 'full'].map((n) => `--ds-radius-${n}`),
  ...['sm', 'md', 'lg'].map((n) => `--ds-shadow-${n}`),
  // the page size D's generator derives from `$extensions["dev.maws.page"]` (X28, D's M4), document medium only
  ...['width', 'height', 'margin'].map((n) => `--ds-page-${n}`),
]);
const LITERAL = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(|(?<![\w-])(?:black|white|red|green|blue|gr[ae]y|yellow|orange|purple|pink|silver|navy|teal|maroon|olive|lime|aqua|fuchsia|gold|brown|cyan|magenta|violet|indigo|crimson|coral|salmon|tomato)(?![\w-])/i;

const declarations = (css: string) =>
  [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].flatMap(([, selector, body]) =>
    body
      .split(';')
      .map((d) => d.trim())
      .filter(Boolean)
      .map((d) => ({ selector: selector.trim(), property: d.slice(0, d.indexOf(':')).trim(), value: d.slice(d.indexOf(':') + 1).trim() })),
  );
const appTokens = new Set([...tokensCss.matchAll(/(--[a-z0-9-]+)\s*:/g)].map(([, name]) => name));
// The custom properties a value reads outside a `--ds-*` fallback: a `var(--ds-…, fallback)` is skipped whole, any
// other `var()` is a read (and its own fallback is scanned in turn).
function readsOutsideDsFallbacks(value: string): string[] {
  const names: string[] = [];
  for (let i = value.indexOf('var('); i >= 0; i = value.indexOf('var(', i)) {
    const name = /^var\(\s*(--[\w-]+)/.exec(value.slice(i))![1];
    if (!name.startsWith('--ds-')) {
      names.push(name);
      i += 4;
      continue;
    }
    let depth = 0;
    for (i += 3; i < value.length; i += 1) {
      if (value[i] === '(') depth += 1;
      else if (value[i] === ')' && --depth === 0) break;
    }
  }
  return names;
}

describe('the stylesheets', () => {
  it('hold no literal colour', () => {
    for (const [name, css] of [
      ['theme.css', themeCss],
      ['chrome.css', chromeCss],
    ]) {
      for (const d of declarations(css)) expect(d.value, `${name} ${d.selector} { ${d.property}: ${d.value} }`).not.toMatch(LITERAL);
    }
  });

  it('read on the page only the ledger’s --ds-* names, each with a fallback to an app token', () => {
    for (const { selector, property, value } of declarations(themeCss)) {
      const where = `${selector} { ${property}: ${value} }`;
      for (const [, name, fallback] of value.matchAll(/var\((--ds-[a-z0-9-]+)\s*(?:,\s*((?:[^()]|\([^()]*(?:\([^()]*\))*[^()]*\))*))?\)/g)) {
        expect(DS_NAMES, where).toContain(name);
        expect(fallback, `${where}: ${name} has no fallback`).toBeTruthy();
        for (const [, token] of (fallback ?? '').matchAll(/var\((--[a-z0-9-]+)/g)) expect(appTokens, where).toContain(token);
      }
      // every value on the page, of any property (colour, font, size, line, spacing, radius, shadow), is a design-system
      // token's: an app token is read only as a fallback (the highlighter's dark colour aside, which is its output)
      const bare = readsOutsideDsFallbacks(value).filter((name) => name !== '--shiki-dark');
      expect(bare, `${where}: reads ${bare.join(', ')} outside a --ds-* fallback`).toEqual([]);
    }
  });
});

describe('the author colours', () => {
  it('are app tokens defined for both themes, one per AUTHOR_COLORS entry', () => {
    const [light, dark] = tokensCss.split('[data-theme="dark"]');
    for (const color of AUTHOR_COLORS) {
      expect(light).toMatch(new RegExp(`${color}:\\s*[^;]+;`));
      expect(dark).toMatch(new RegExp(`${color}:\\s*[^;]+;`));
    }
  });
});

describe('the rendered page without a design system', () => {
  let handle: DocumentHandle | null = null;
  let world: World | null = null;
  beforeAll(() => {
    const style = document.createElement('style');
    style.textContent = `${tokensCss}\n${themeCss}\n${chromeCss}`;
    document.head.append(style);
  });
  afterEach(() => {
    cleanup();
    handle?.close();
    world?.destroy();
  });

  async function mountEveryKind(): Promise<HTMLElement> {
    world = new World(
      doc(
        { type: 'heading', attrs: { id: 'h1', level: 1 }, content: [{ type: 'text', text: 'Title' }] },
        { type: 'paragraph', attrs: { id: 'p1' }, content: [{ type: 'text', text: 'link', marks: [{ type: 'link', attrs: { href: 'https://example.com' } }] }, { type: 'text', text: ' and ' }, { type: 'text', text: 'code', marks: [{ type: 'code' }] }, { type: 'date', attrs: { iso: '2026-10-13' } }] },
        { type: 'blockquote', attrs: { id: 'q1' }, content: [para('p2', 'Quoted')] },
        { type: 'codeBlock', attrs: { id: 'c1', language: null }, content: [{ type: 'text', text: 'plain code' }] },
        { type: 'table', attrs: { id: 't1' }, content: [{ type: 'tableRow', attrs: { id: 'r1' }, content: [{ type: 'tableHeader', attrs: { id: 'th' }, content: [para('p3', 'Head')] }] }, { type: 'tableRow', attrs: { id: 'r2' }, content: [{ type: 'tableCell', attrs: { id: 'td' }, content: [para('p4', 'Cell')] }] }] },
        ...['note', 'tip', 'warn', 'danger'].map((tone, i) => ({ type: 'callout', attrs: { id: `k${i}`, tone }, content: [para(`pk${i}`, tone)] })),
        { type: 'horizontalRule', attrs: { id: 'hr' } },
        { type: 'pending', attrs: { id: 'pe', intent: 'Next' } },
      ),
    );
    handle = openMemoryHandle(world.host, { log: () => {} });
    await whenSynced(handle);
    const host = memoryEditorHost({ actor: { kind: 'human' }, name: 'Owner', color: '--author-1' });
    const { container } = render(<DocumentEditor artifactId="doc1" handle={handle} host={host} renderDiagram={async () => '<svg></svg>'} />);
    await until(() => container.querySelector('.ds-doc table') !== null, 'the page');
    return container;
  }

  // Each app colour token as this engine computes it.
  function tokenColours(): Set<string> {
    const probe = document.body.appendChild(document.createElement('div'));
    const colours = new Set<string>();
    for (const token of appTokens) {
      probe.style.color = `var(${token})`;
      colours.add(getComputedStyle(probe).color);
    }
    probe.remove();
    return colours;
  }

  it('computes every colour of every element to an app token’s', async () => {
    const container = await mountEveryKind();
    const allowed = tokenColours();
    const elements = [...container.querySelectorAll<HTMLElement>('.doc-editor, .doc-editor *')];
    expect(elements.length).toBeGreaterThan(50);
    let checked = 0;
    for (const el of elements) {
      const style = getComputedStyle(el);
      for (const property of ['color', 'background-color', 'border-left-color', 'outline-color']) {
        const value = style.getPropertyValue(property);
        if (!value || value === 'none' || value === 'transparent' || /^rgba\(0, 0, 0, 0\)$/.test(value) || /currentcolor|initial|inherit/i.test(value)) continue;
        checked += 1;
        expect(allowed, `${el.tagName.toLowerCase()}.${el.className} ${property}: ${value}`).toContain(value);
      }
    }
    expect(checked).toBeGreaterThan(50);
  });

  it('takes the design system’s value once its scope defines it', async () => {
    const container = await mountEveryKind();
    const page = container.querySelector<HTMLElement>('.ds-doc')!;
    expect(getComputedStyle(page).color).toBe(getComputedStyle(document.body.appendChild(Object.assign(document.createElement('i'), { style: 'color: var(--fg)' }))).color);
    // what D's DesignSystemScope does: a stylesheet defining the system's names on the scope
    const scope = document.head.appendChild(document.createElement('style'));
    scope.textContent = '.ds-doc { --ds-color-text: #123456; --ds-color-accent: #654321; }';
    expect(getComputedStyle(page).color).toBe('#123456');
    expect(getComputedStyle(container.querySelector('.ds-doc h1')!).color).toBe('#123456');
    expect(getComputedStyle(container.querySelector('.ds-doc a')!).color).toBe('#654321');
    scope.remove();
  });

  // M8 (Decision Log 23, X28's page names): the page is the system's page wide, Letter without one, and its margin
  // pads the text (never more than the column allows, so a narrow panel keeps a readable measure).
  it('is the system’s page wide with its margin, Letter and 1in without one', async () => {
    const container = await mountEveryKind();
    const page = container.querySelector<HTMLElement>('.ds-doc-page')!;
    // a length as this engine computes it
    const computed = (property: 'maxWidth', value: string) => {
      const probe = document.body.appendChild(document.createElement('div'));
      probe.style[property] = value;
      const out = getComputedStyle(probe)[property];
      probe.remove();
      return out;
    };
    expect(getComputedStyle(page).maxWidth).toBe(computed('maxWidth', '8.5in'));
    // happy-dom computes no `min()` with container units: the declaration is read instead
    expect(declarations(themeCss).filter((d) => d.selector === '.ds-doc-page' && d.property.startsWith('padding')).map((d) => `${d.property}: ${d.value}`)).toEqual(['padding: min(var(--ds-page-margin, 1in), 12cqi)']);
    const scope = document.head.appendChild(document.createElement('style'));
    scope.textContent = '.ds-doc { --ds-page-width: 210mm; --ds-page-margin: 20mm; }';
    expect(getComputedStyle(page).maxWidth).toBe(computed('maxWidth', '210mm'));
    expect(getComputedStyle(page).maxWidth).not.toBe(computed('maxWidth', '8.5in'));
    scope.remove();
  });

  // Decision Log 22 (2), M8's: code takes shiki's dark colours on a dark ground, the page's own (the system's
  // `--ds-color-bg`), never because the app is dark; without a system the ground is the app's, so it follows the app.
  it('colours code by the page’s ground, not the app’s theme', async () => {
    world = new World(doc({ type: 'codeBlock', attrs: { id: 'c1', language: 'js' }, content: [{ type: 'text', text: 'const x = 1;' }] }));
    handle = openMemoryHandle(world.host, { log: () => {} });
    await whenSynced(handle);
    const host = memoryEditorHost({ actor: { kind: 'human' }, name: 'Owner', color: '--author-1' });
    const { container } = render(<DocumentEditor artifactId="doc1" handle={handle} host={host} />);
    await until(() => container.querySelectorAll('.doc-code-token').length > 1, 'the highlighted code');
    const page = container.querySelector<HTMLElement>('.ds-doc')!;
    expect(page.dataset.ground).toBe('light');
    // the dark colours are picked by the page's ground alone (happy-dom does not weigh `!important` against an inline
    // style, so the rule is read here and its effect in the product build's e2e)
    const rules = declarations(themeCss).filter((d) => d.value.includes('--shiki-dark'));
    expect(rules.map((d) => `${d.selector} { ${d.property}: ${d.value} }`)).toEqual(['.ds-doc[data-ground="dark"] .doc-code-token { color: var(--shiki-dark) !important }']);
    // the app goes dark under a light system: the ground stays light
    const system = document.head.appendChild(document.createElement('style'));
    system.textContent = '.ds-doc { --ds-color-bg: #ffffff; }';
    document.documentElement.dataset.theme = 'dark';
    try {
      await ticks(3);
      expect(page.dataset.ground).toBe('light');
      // a dark system: the ground is dark, whatever the app's theme
      system.textContent = '.ds-doc { --ds-color-bg: #1f1e1b; }';
      await until(() => page.dataset.ground === 'dark', 'the dark ground read');
      delete document.documentElement.dataset.theme;
      await ticks(3);
      expect(page.dataset.ground).toBe('dark');
      // no system: the app's ground (here the light app's)
      system.remove();
      await until(() => page.dataset.ground === 'light', 'the app’s ground again');
    } finally {
      system.remove();
      delete document.documentElement.dataset.theme;
    }
  });

  it('takes its code type from the design system too, the app’s code size only a fallback', async () => {
    const container = await mountEveryKind();
    const code = container.querySelector<HTMLElement>('.ds-doc pre')!;
    const field = container.querySelector<HTMLElement>('.ds-doc .doc-atom-field input')!;
    const appCode = getComputedStyle(document.body.appendChild(Object.assign(document.createElement('i'), { style: 'font-size: var(--text-code)' }))).fontSize;
    expect(getComputedStyle(code).fontSize).toBe(appCode);
    const scope = document.head.appendChild(document.createElement('style'));
    scope.textContent = '.ds-doc { --ds-type-caption-size: 17px; --ds-font-mono: SystemMono; }';
    for (const el of [code, field]) {
      expect(getComputedStyle(el).fontSize).toBe('17px');
      expect(getComputedStyle(el).fontFamily).toBe('SystemMono');
    }
    scope.remove();
  });
});
