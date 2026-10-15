// D14 (M4): the Design System page over a real replica through the binding module, under happy-dom and the React
// Compiler as the app builds it. The six sections render from a fixture system; an edit in the palette, the type scale
// or the measures writes the token, and the previews follow in the same frame; the check lists the fixture's
// violations; the canon frames carry their policy and load assets through the host.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { applyV1, diffV1, newDoc, stateVector, type Doc } from '../../yjs';
import { validateCanon, type HtmlParser } from '../canon';
import complete from '../fixtures/complete.tokens.json';
import { readSystem, setToken, writeSystem } from '../model';
import { byIdentity } from '../roles';
import { parseTokens, serializeTokens } from '../tokens';
import { DesignSystemPage } from './DesignSystemPage';
import { CommitField } from './fields';
import { rewriteHtmlAssets } from './frame';

const AT = Date.UTC(2026, 9, 13);
const LAW = `# Harbor

## 0. Stance commitment

persona: quiet-editorial

Quiet print on warm paper.

## 1. Palette
Accent once per view.
## 2. Typography
Display for titles.
## 3. Canvas
Flat.
## 4. Layout
Two columns.
## 5. Component canon
- layouts/title.html, components/chip.html, components/document.css
## 6. Voice
Plain.
## 7. Motion
None.
## 8. Hard don'ts

- No colour that is not a token. [check: literal-color]
- No gradients. [check: no-gradient]
- Nothing louder than the title.
`;
const FILES = {
  'DESIGN.md': LAW,
  'tokens.tokens.json': serializeTokens(parseTokens(complete).tokens!),
  'layouts/title.html': '<section id="title" style="background:var(--ds-color-bg)"><h1 data-ph="title" style="color:var(--ds-color-text)">Lab safety</h1><img src="assets/logo.png" alt=""></section>',
  'components/chip.html': '<div style="background:#ff00ff"><span style="color:var(--ds-color-accent-text)">Due Friday</span></div>',
  'components/document.css': '@font-face { font-family: "Iowan Old Style"; src: url("assets/iowan.woff2"); }\n.ds-doc blockquote { border-left: 2px solid var(--ds-color-accent); }\n',
};
const host = { assetUrl: (id: string, ref: string) => `maws-artifact://${id}/live/${ref}` };

function systemDoc(): Doc {
  const doc = newDoc();
  writeSystem(doc, FILES, { route: 'derived', at: AT }, { name: 'Harbor' });
  return doc;
}
const token = (doc: Doc, path: string) => readSystem(doc).tokens.tokens.get(path);
const scopeStyles = () => [...document.head.querySelectorAll('style[data-ds-scope-style]')].map((s) => s.textContent ?? '').join('\n');
function edit(label: string, text: string) {
  const input = screen.getByLabelText(label) as HTMLInputElement;
  act(() => {
    fireEvent.change(input, { target: { value: text } });
    fireEvent.blur(input);
  });
  return input;
}

afterEach(() => cleanup());

describe('the Design System page (D14)', () => {
  it('renders all six sections from a fixture system', () => {
    const doc = systemDoc();
    const view = render(<DesignSystemPage artifactId="ds1" handle={{ doc }} host={host} />);
    expect([...view.container.querySelectorAll('[data-ds-section]')].map((s) => s.getAttribute('data-ds-section'))).toEqual(['palette', 'type', 'measures', 'canon', 'law', 'check']);
    expect(view.container.querySelector('.dsp-title')!.textContent).toBe('Harbor');
    expect(view.container.querySelectorAll('[data-ds-section="palette"] .dsp-swatch')).toHaveLength(12); // the 11 colour roles and the fixture's highlight
    expect(view.container.querySelectorAll('.dsp-type-row')).toHaveLength(8);
    expect(view.container.querySelectorAll('.dsp-ruler')).toHaveLength(8);
    expect(view.container.querySelectorAll('[data-ds-section="canon"] iframe')).toHaveLength(3);
    expect(view.container.querySelector('[data-ds-section="law"]')!.textContent).toContain('Quiet print on warm paper.');
    expect(view.container.querySelectorAll('.dsp-badge')).toHaveLength(4);
  });

  it('writes the accent from its hex field and its colour picker, and the swatch’s scope restyles at once', () => {
    const doc = systemDoc();
    const view = render(<DesignSystemPage artifactId="ds1" handle={{ doc }} host={host} />);
    const chip = view.container.querySelector('[data-token="color.accent"] .dsp-chip') as HTMLElement;
    expect(chip.closest('[data-ds-scope]')).not.toBeNull();
    expect(scopeStyles()).toContain('--ds-color-accent: #c9663f');
    edit('--ds-color-accent hex', '#123456');
    expect(token(doc, 'color.accent.$root')!.$value).toMatchObject({ colorSpace: 'srgb', hex: '#123456' });
    expect(scopeStyles()).toContain('--ds-color-accent: #123456');
    expect(getComputedStyle(chip).backgroundColor || getComputedStyle(chip).background).toContain('#123456');
    act(() => {
      fireEvent.change(screen.getByLabelText('--ds-color-accent colour'), { target: { value: '#abcdef' } });
    });
    expect(token(doc, 'color.accent.$root')!.$value).toMatchObject({ hex: '#abcdef' });
    expect((screen.getByLabelText('--ds-color-accent hex') as HTMLInputElement).value).toBe('#abcdef');
  });

  it('keeps a value that does not read, says why, and writes nothing', () => {
    const doc = systemDoc();
    render(<DesignSystemPage artifactId="ds1" handle={{ doc }} host={host} />);
    const before = stateVector(doc);
    const input = edit('--ds-color-accent hex', 'teal-ish');
    expect(input.value).toBe('teal-ish');
    expect(screen.getByRole('alert').textContent).toContain('not a hex colour');
    edit('space.3 value', '12em');
    expect(stateVector(doc)).toEqual(before);
  });

  it('writes the type scale for the document and the deck, and a space', () => {
    const doc = systemDoc();
    render(<DesignSystemPage artifactId="ds1" handle={{ doc }} host={host} />);
    edit('h1 size', '30px');
    edit('h1 line', '1.25');
    edit('h1 weight', '650');
    expect(token(doc, 'type.h1')!.$value).toMatchObject({ fontSize: { value: 30, unit: 'px' }, lineHeight: 1.25, fontWeight: 650 });
    edit('h1 deck size', '72px');
    expect(token(doc, 'type.h1')!.$extensions?.['dev.maws.deck']).toMatchObject({ fontSize: { value: 72, unit: 'px' } });
    expect(scopeStyles()).toContain('--ds-type-h1-size: 72px'); // the deck scope
    expect(scopeStyles()).toContain('--ds-type-h1-size: 30px'); // the document scope
    edit('space.3 value', '14px');
    expect(token(doc, 'space.3')!.$value).toEqual({ value: 14, unit: 'px' });
  });

  it('follows an edit made on another replica', () => {
    const doc = systemDoc();
    const other = newDoc();
    applyV1(other, diffV1(doc));
    render(<DesignSystemPage artifactId="ds1" handle={{ doc }} host={host} />);
    setToken(other, 'color.accent.$root', { $value: '#0055aa' });
    act(() => applyV1(doc, diffV1(other, stateVector(doc))));
    expect((screen.getByLabelText('--ds-color-accent hex') as HTMLInputElement).value).toBe('#0055aa');
    expect(scopeStyles()).toContain('--ds-color-accent: #0055aa');
  });

  it('lists the check’s violations, the don’ts to judge by hand, and brings the check into view on request', () => {
    const doc = systemDoc();
    const view = render(<DesignSystemPage artifactId="ds1" handle={{ doc }} host={host} />);
    const check = view.container.querySelector('[data-ds-section="check"]') as HTMLElement;
    const violations = [...check.querySelectorAll('.dsp-violation')].map((li) => li.textContent);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('components/chip.html');
    expect(violations[0]).toContain('#ff00ff');
    expect(check.querySelector('[aria-label="To judge by hand"]')!.textContent).toContain('Nothing louder than the title.');
    view.rerender(<DesignSystemPage artifactId="ds1" handle={{ doc }} host={host} revealCheck={1} />);
    expect(document.activeElement).toBe(check);
  });

  it('renders canon in sandboxed frames whose policy loads only the system’s assets, each asset through the host', () => {
    const doc = systemDoc();
    const view = render(<DesignSystemPage artifactId="ds1" handle={{ doc }} host={host} />);
    const frames = [...view.container.querySelectorAll('[data-ds-section="canon"] iframe')] as HTMLIFrameElement[];
    for (const frame of frames) {
      expect(frame.getAttribute('sandbox')).toBe('');
      const source = frame.getAttribute('srcdoc')!;
      expect(source).toContain(`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src maws-artifact:; font-src maws-artifact:">`);
      expect(source).not.toMatch(/["(]assets\//);
    }
    const [title, , documentFrame] = frames.map((frame) => frame.getAttribute('srcdoc')!);
    expect(title).toContain('src="maws-artifact://ds1/live/assets/logo.png"');
    expect(title).toContain('--ds-type-title-size: 96px'); // a layout is a slide: the deck scale
    expect(documentFrame).toMatch(/url\("maws-artifact\\3a \/\/ds1\/live\/assets\/iowan\.woff2"\)/);
    expect(documentFrame).toContain('class="ds-doc"');
  });

  it('shows the values read-only when asked', () => {
    const doc = systemDoc();
    const view = render(<DesignSystemPage artifactId="ds1" handle={{ doc }} host={host} readOnly />);
    const inputs = [...view.container.querySelectorAll('input')];
    expect(inputs.length).toBeGreaterThan(0);
    expect(inputs.every((input) => input.disabled)).toBe(true);
  });
});

describe('fix wave 1', () => {
  it('I1: a valid edit is written as it is typed, so a body removed without a blur loses nothing', () => {
    let persisted = '#c9663f';
    const shown = render(<CommitField label="Accent hex" value={persisted} commit={(text) => ((persisted = text), null)} />);
    act(() => {
      fireEvent.change(shown.getByLabelText('Accent hex'), { target: { value: '#123456' } });
    });
    shown.unmount();
    expect(persisted).toBe('#123456');
  });

  it('I1: on the page, a typed hex lands in the doc before any blur, and the field keeps what was typed until it is left', () => {
    const doc = systemDoc();
    const view = render(<DesignSystemPage artifactId="ds1" handle={{ doc }} host={host} />);
    const input = screen.getByLabelText('--ds-color-accent hex') as HTMLInputElement;
    act(() => {
      fireEvent.change(input, { target: { value: '#12345' } }); // does not read yet: shown as invalid, not written
    });
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(token(doc, 'color.accent.$root')!.$value).toMatchObject({ hex: '#c9663f' });
    act(() => {
      fireEvent.change(input, { target: { value: '#123456' } });
    });
    expect(token(doc, 'color.accent.$root')!.$value).toMatchObject({ hex: '#123456' });
    act(() => {
      fireEvent.change(screen.getByLabelText('h1 size'), { target: { value: '30' } });
    });
    expect((screen.getByLabelText('h1 size') as HTMLInputElement).value).toBe('30'); // as typed, not the stored 30px
    expect(token(doc, 'type.h1')!.$value).toMatchObject({ fontSize: { value: 30, unit: 'px' } });
    act(() => {
      fireEvent.blur(screen.getByLabelText('h1 size'));
    });
    expect((screen.getByLabelText('h1 size') as HTMLInputElement).value).toBe('30px');
    view.unmount();
    expect(token(doc, 'color.accent.$root')!.$value).toMatchObject({ hex: '#123456' });
  });

  it('I6: canon’s SVG references keep their fragments and load through the host, presentation attributes included', () => {
    const toUrl = (ref: string) => `maws-artifact://ds/live/${ref}`;
    const html = rewriteHtmlAssets('<svg><use href="assets/symbols.svg#mark"></use><rect fill="url(assets/paint.svg#grad)" mask="url(#local)"></rect></svg>', toUrl);
    expect(html).toContain('href="maws-artifact://ds/live/assets/symbols.svg#mark"');
    expect(html).toMatch(/fill="url\(&quot;maws-artifact\\3a \/\/ds\/live\/assets\/paint\.svg#grad&quot;\)"/);
    expect(html).toContain('mask="url(#local)"');
  });
});

describe('a system with no law (D12: a Claude import)', () => {
  function lawless(): Doc {
    const doc = newDoc();
    writeSystem(doc, { 'tokens.tokens.json': FILES['tokens.tokens.json'] }, { route: 'imported', at: AT }, { name: 'Imported' });
    return doc;
  }

  it('offers "Ask the agent to adopt it", which asks once per press', () => {
    const asked: number[] = [];
    render(<DesignSystemPage artifactId="ds1" handle={{ doc: lawless() }} host={host} askAdopt={{ onAsk: () => asked.push(1), unavailable: null }} />);
    expect(screen.getByText(/No law yet/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Ask the agent to adopt it' }));
    expect(asked).toEqual([1]);
  });

  it('says why it cannot ask when no session is there to take it', () => {
    render(<DesignSystemPage artifactId="ds1" handle={{ doc: lawless() }} host={host} askAdopt={{ onAsk: () => {}, unavailable: 'Open a session to ask the agent.' }} />);
    const button = screen.getByRole('button', { name: 'Ask the agent to adopt it' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByText('Open a session to ask the agent.')).toBeTruthy();
  });

  it('shows no action without a route to the agent, nor when the system has a law', () => {
    const view = render(<DesignSystemPage artifactId="ds1" handle={{ doc: lawless() }} host={host} />);
    expect(screen.queryByRole('button', { name: 'Ask the agent to adopt it' })).toBeNull();
    view.unmount();
    render(<DesignSystemPage artifactId="ds1" handle={{ doc: systemDoc() }} host={host} askAdopt={{ onAsk: () => {}, unavailable: null }} />);
    expect(screen.queryByRole('button', { name: 'Ask the agent to adopt it' })).toBeNull();
  });
});

describe('whole-branch review: edits of what the page shows', () => {
  function docWith(files: Record<string, string>): Doc {
    const doc = newDoc();
    writeSystem(doc, { ...FILES, ...files }, { route: 'derived', at: AT }, { name: 'Harbor' });
    return doc;
  }
  const raw = () => structuredClone(complete) as unknown as Record<string, Record<string, unknown>>;
  const held = (doc: Doc, path: string) => byIdentity(readSystem(doc).tokens.tokens, path);

  it('C3: an inherited role is written as a local token of its effective type, and the group it extends keeps its value', () => {
    const file = raw();
    file.palette = file.color!;
    file.color = { $extends: '{palette}' };
    file.typeBase = file.type!;
    file.type = { $extends: '{typeBase}' };
    const doc = docWith({ 'tokens.tokens.json': JSON.stringify(file) });
    render(<DesignSystemPage artifactId="ds1" handle={{ doc }} host={host} />);
    edit('--ds-color-accent hex', '#123456');
    edit('h1 size', '30px');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(held(doc, 'color.accent')).toMatchObject({ $type: 'color', $value: { hex: '#123456' } });
    expect(held(doc, 'palette.accent')!.$value).toMatchObject({ hex: '#c9663f' });
    expect(held(doc, 'type.h1')).toMatchObject({ $type: 'typography', $value: { fontFamily: '{font.display}', fontSize: { value: 30, unit: 'px' }, lineHeight: 1.2 } });
    expect(scopeStyles()).toContain('--ds-color-accent: #123456');
    expect(scopeStyles()).toContain('--ds-type-h1-size: 30px');
  });

  it('C4: a literal replacing an alias that took its type from its target keeps that type', () => {
    const file = raw();
    for (const group of [file.color!, file.space!]) {
      const type = group.$type;
      delete group.$type;
      const typeAll = (node: Record<string, unknown>) => {
        if ('$value' in node) node.$type = type;
        else for (const [key, child] of Object.entries(node)) if ((key === '$root' || !key.startsWith('$')) && child && typeof child === 'object') typeAll(child as Record<string, unknown>);
      };
      typeAll(group);
    }
    file.color!.accent = { ...(file.color!.accent as object), text: { $value: '{color.bg.raised}' } };
    file.space!['3'] = { $value: '{space.2}' };
    const doc = docWith({ 'tokens.tokens.json': JSON.stringify(file) });
    render(<DesignSystemPage artifactId="ds1" handle={{ doc }} host={host} />);
    edit('--ds-color-accent-text hex', '#112233');
    edit('space.3 value', '14px');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(held(doc, 'color.accent.text')).toMatchObject({ $type: 'color', $value: { hex: '#112233' } });
    expect(held(doc, 'space.3')).toEqual({ $type: 'dimension', $value: { value: 14, unit: 'px' } });
  });

  it('C6: the check lists the canon’s file problems beside the law’s results', () => {
    const broken = '<section id="one"></section><section id="two"></section>';
    const clean = '<div><span style="color:var(--ds-color-accent-text)">Due Friday</span></div>';
    const doc = docWith({ 'layouts/broken.html': broken, 'components/chip.html': clean }); // stored as a host without a parser does
    const view = render(<DesignSystemPage artifactId="ds1" handle={{ doc }} host={host} />);
    const check = view.container.querySelector('[data-ds-section="check"]') as HTMLElement;
    const problems = validateCanon(readSystem(doc).files, new DOMParser() as unknown as HtmlParser, readSystem(doc).tokens);
    expect(problems.length).toBeGreaterThan(0);
    const listed = [...check.querySelectorAll('[aria-label="File problems"] li')].map((li) => li.textContent);
    expect(listed).toEqual(problems.map((p) => `${p.path} ${p.message}`));
    expect(check.textContent).not.toContain('keeps every checked rule');
    expect(check.querySelector('.dsp-summary')!.textContent).toContain(`${problems.length} file ${problems.length === 1 ? 'problem' : 'problems'}`);
  });
});
