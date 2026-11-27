// The word cut on the Design System page (docs/doperpowers/specs/2026-11-16-word-cut-design.md, M5 task 4; the rows of
// editors.md whose place is "Design system page"): what the page says at rest, and what waits for the pointer or the
// keyboard on an owner that takes focus, under happy-dom. What is drawn is the pictures'.
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { accessibleDescription } from '../../../renderer/src/test-support/accessible-text';
import { newDoc, type Doc } from '../../yjs';
import complete from '../fixtures/complete.tokens.json';
import { setToken, writeSystem } from '../model';
import { parseTokens, serializeTokens } from '../tokens';
import { DesignSystemPage } from './DesignSystemPage';

const AT = Date.UTC(2026, 9, 13);
const TOKENS = serializeTokens(parseTokens(complete).tokens!);
const law = (donts: string) => `# Harbor

## 0. Stance commitment

Quiet print on warm paper.

## 8. Hard don'ts

${donts}
`;
const CHIP_BAD = '<div style="background:#ff00ff"><span style="color:var(--ds-color-accent-text)">Due Friday</span></div>';
const CHIP_GOOD = '<div><span style="color:var(--ds-color-accent-text)">Due Friday</span></div>';
const DOCUMENT_CSS = '.ds-doc blockquote { border-left: 2px solid var(--ds-color-accent); }\n';
const host = { assetUrl: (id: string, ref: string) => `maws-artifact://${id}/live/${ref}` };

function systemDoc(files: Record<string, string>): Doc {
  const doc = newDoc();
  writeSystem(doc, { 'tokens.tokens.json': TOKENS, ...files }, { route: 'derived', at: AT }, { name: 'Harbor' });
  return doc;
}
const page = (doc: Doc) => render(<DesignSystemPage artifactId="ds1" handle={{ doc }} host={host} />);
const section = (container: HTMLElement, name: string) => container.querySelector<HTMLElement>(`[data-ds-section="${name}"]`)!;

afterEach(cleanup);

describe('a replica with no system (G562)', () => {
  // M5 task 4's review: the page mounts after the replica's first sync, so a system it does not hold yet is no wait to
  // spin for; the page says so at once, settled, and shows the system as soon as one is written
  it('says the design system is empty and what to do, with no spinner, and draws the system once it arrives', async () => {
    const doc = newDoc();
    const { container } = page(doc);
    expect([...container.querySelectorAll('p')].map((p) => p.textContent)).toEqual(['This design system is empty', 'Ask Claude to publish a design system here.']);
    expect(container.querySelector('button'), 'no new control').toBeNull();
    await act(async () => new Promise((r) => setTimeout(r, 550)));
    expect(screen.queryByRole('progressbar'), 'no spinner, however long').toBeNull();
    act(() => writeSystem(doc, { 'tokens.tokens.json': TOKENS, 'DESIGN.md': law('- Nothing louder than the title.') }, { route: 'derived', at: AT }, { name: 'Harbor' }));
    expect(container.querySelector('.dsp-title')!.textContent).toBe('Harbor');
    expect(screen.queryByText('This design system is empty')).toBeNull();
  });
});

describe('the top (G565)', () => {
  it('tokens that do not resolve are one line with their count, opening to each path and its message', () => {
    const doc = systemDoc({ 'DESIGN.md': law('- Nothing louder than the title.') });
    setToken(doc, 'color.extra', { $value: '{color.nowhere}' });
    const { container } = page(doc);
    const fold = container.querySelector<HTMLDetailsElement>('.dsp-problems details')!;
    expect(fold.open).toBe(false);
    expect(fold.querySelector('summary')!.textContent).toBe('1 token doesn’t resolve');
    const items = [...fold.querySelectorAll('li')].map((li) => li.textContent);
    expect(items).toHaveLength(1);
    expect(items[0]).toContain('color.extra');
  });
});

describe('the palette’s contrast (G568)', () => {
  it('each pair reads its name and ratio; the verdict is the pair’s tooltip and description, and a failing pair adds ✕', () => {
    const doc = systemDoc({ 'DESIGN.md': law('- Nothing louder than the title.') });
    setToken(doc, 'color.text.muted', { $value: '#eeeeee' });
    const { container } = page(doc);
    const badges = [...section(container, 'palette').querySelectorAll<HTMLElement>('.dsp-badge')];
    expect(badges).toHaveLength(4);
    const text = badges[0]!;
    expect(text.textContent).toMatch(/^Text on ground\d+\.\d : 1$/);
    expect(text.tabIndex).toBe(0);
    expect(accessibleDescription(text)).toBe('Meets 4.5 : 1');
    const muted = badges[1]!;
    expect(muted.getAttribute('data-passes')).toBe('false');
    expect(muted.textContent).toMatch(/^Muted text on ground\d+\.\d : 1✕$/);
    expect(accessibleDescription(muted)).toBe('Below 4.5 : 1');
  });
});

describe('the canon (G575, G577)', () => {
  it('an empty canon says “None yet”', () => {
    const { container } = page(systemDoc({ 'DESIGN.md': law('- Nothing louder than the title.') }));
    expect(section(container, 'canon').querySelector('p')!.textContent).toBe('None yet');
  });

  it('the document styles preview is captioned by its file alone', () => {
    const { container } = page(systemDoc({ 'DESIGN.md': law('- Nothing louder than the title.'), 'components/document.css': DOCUMENT_CSS }));
    expect(section(container, 'canon').querySelector('figcaption')!.textContent).toBe('components/document.css');
  });
});

describe('the law (G579)', () => {
  it('a system without law says “No law yet” and no more', () => {
    const { container } = page(systemDoc({}));
    expect(section(container, 'law').querySelector('.dsp-muted')!.textContent).toBe('No law yet');
  });
});

describe('the check (G584 to G587)', () => {
  it('a canon that keeps every rule is a muted ✓ and the count, its sentence its name and tooltip', () => {
    const { container } = page(systemDoc({ 'DESIGN.md': law('- No colour that is not a token. [check: literal-color]\n- No gradients. [check: no-gradient]'), 'components/chip.html': CHIP_GOOD }));
    const check = section(container, 'check');
    const passed = within(check).getByRole('img', { name: 'The canon keeps every checked rule (2).' });
    expect(passed.textContent).toBe('✓ 2');
    expect(passed.tabIndex).toBe(0);
    expect(check.textContent).not.toContain('keeps every checked rule');
  });

  it('a violation ends with the law’s words; its tag is their tooltip and description, not their text', () => {
    const { container } = page(systemDoc({ 'DESIGN.md': law('- No colour that is not a token. [check: literal-color]'), 'components/chip.html': CHIP_BAD }));
    const violation = section(container, 'check').querySelector<HTMLElement>('.dsp-violation')!;
    const words = violation.querySelector<HTMLElement>('[data-dont-words]')!;
    expect(words.textContent).toBe('No colour that is not a token.');
    expect(words.tabIndex).toBe(0);
    expect(accessibleDescription(words)).toBe('[check: literal-color]');
    expect(violation.textContent).not.toContain('[check:');
  });

  it('the ✓ count’s and a violation’s tooltips open below their owners, off the heading and the message above them', () => {
    const side = () => document.querySelector('[data-radix-popper-content-wrapper] [data-side]')?.getAttribute('data-side');
    const passing = page(systemDoc({ 'DESIGN.md': law('- No colour that is not a token. [check: literal-color]'), 'components/chip.html': CHIP_GOOD }));
    act(() => within(section(passing.container, 'check')).getByRole('img', { name: 'The canon keeps every checked rule (1).' }).focus());
    expect(screen.getByRole('tooltip').textContent).toBe('The canon keeps every checked rule (1).');
    expect(side()).toBe('bottom');
    cleanup();
    const failing = page(systemDoc({ 'DESIGN.md': law('- No colour that is not a token. [check: literal-color]'), 'components/chip.html': CHIP_BAD }));
    act(() => section(failing.container, 'check').querySelector<HTMLElement>('[data-dont-words]')!.focus());
    expect(screen.getByRole('tooltip').textContent).toBe('[check: literal-color]');
    expect(side()).toBe('bottom');
  });

  it('one “By hand” list holds the don’ts no rule checks and those whose tag MAWS cannot run, by their words alone', () => {
    const donts = ['- Nothing louder than the title.', '- No sparkle. [check: sparkle]', '- No colour that is not a token. [check: literal-color] [check: shimmer]'].join('\n');
    const { container } = page(systemDoc({ 'DESIGN.md': law(donts), 'components/chip.html': CHIP_GOOD }));
    const check = section(container, 'check');
    expect([...check.querySelectorAll('h3')].map((h) => h.textContent)).toEqual(['By hand']);
    const list = within(check).getByRole('list', { name: 'By hand' });
    expect([...list.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['Nothing louder than the title.', 'No sparkle.', 'No colour that is not a token.']);
    expect(check.textContent).not.toContain('MAWS does not know');
    expect(check.textContent).not.toContain('Tags MAWS cannot run');
  });
});
