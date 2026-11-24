// The sheet's Markdown and its link policy (the composite's §8.2, third rule; the C3 plan's §G, "Markdown"): a web link
// goes to the host, a path link naming one of the question's own references opens it in the card, and every other link
// does nothing, the app's own link handling included.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NO_ACTIONS, setHostActions, type TranscriptActions } from '../transcript/view/context';
import { SheetMarkdown, sheetLinkAction } from './SheetMarkdown';
import { fixtureHost } from './test-support/fixture-host';
import { IMAGE_REFERENCE, TEXT_REFERENCE } from './test-support/references';

const REFERENCES = [TEXT_REFERENCE, IMAGE_REFERENCE];

describe('sheetLinkAction', () => {
  it.each([
    ['https://example.com/a', { kind: 'open', url: 'https://example.com/a' }],
    ['HTTP://example.com/', { kind: 'open', url: 'HTTP://example.com/' }],
    ['src/auth.ts', { kind: 'reference', reference: TEXT_REFERENCE }],
    ['src/auth.ts#L41', { kind: 'reference', reference: TEXT_REFERENCE }],
    ['src/auth.ts:41', { kind: 'reference', reference: TEXT_REFERENCE }],
    ['maws-path:src/auth.ts', { kind: 'reference', reference: TEXT_REFERENCE }],
    ['/work/harbour/docs/berth.png', { kind: 'reference', reference: IMAGE_REFERENCE }],
    ['maws-path:/work/harbour/docs/berth.png', { kind: 'reference', reference: IMAGE_REFERENCE }],
    ['src/other.ts', null],
    ['maws-path:src/other.ts', null],
    ['mailto:someone@example.com', null],
    ['maws-artifact:5f0c7a52-0000-4000-8000-000000000001', null],
    ['maws-image:docs/berth.png', null],
    ['file:///work/harbour/src/auth.ts', null],
    ['javascript:alert(1)', null],
    ['', null],
  ])('%s', (url, action) => {
    expect(sheetLinkAction(url, REFERENCES)).toEqual(action);
  });
});

describe('SheetMarkdown', () => {
  const app: TranscriptActions = { ...NO_ACTIONS, openExternal: vi.fn(), openFile: vi.fn(), openArtifact: vi.fn(), openArtifactTab: vi.fn(), showOpenArtifactTab: vi.fn(() => false) };
  beforeEach(() => setHostActions(app)); // the app's own actions, which no sheet link may reach
  afterEach(() => {
    cleanup();
    setHostActions(NO_ACTIONS);
    vi.clearAllMocks();
  });

  const draw = (markdown: string) => {
    const host = fixtureHost();
    const onReference = vi.fn();
    render(<SheetMarkdown markdown={markdown} references={REFERENCES} host={host} onReference={onReference} />);
    return { host, onReference };
  };
  const nothingOfTheApp = () => {
    for (const action of [app.openExternal, app.openFile, app.openArtifact, app.openArtifactTab, app.showOpenArtifactTab]) expect(action).not.toHaveBeenCalled();
  };

  it('sends a web link to the host and nowhere else', () => {
    const { host, onReference } = draw('See [the docs](https://example.com/docs).');
    fireEvent.click(screen.getByRole('link', { name: 'the docs' }));
    expect(host.links).toEqual(['https://example.com/docs']);
    expect(onReference).not.toHaveBeenCalled();
    nothingOfTheApp();
  });

  it("opens a path link naming one of the question's references in the card", () => {
    const { host, onReference } = draw('Read [the auth module](src/auth.ts#L41).');
    fireEvent.click(screen.getByText('the auth module'));
    expect(onReference).toHaveBeenCalledWith(TEXT_REFERENCE);
    expect(host.links).toEqual([]);
    nothingOfTheApp();
  });

  it('does nothing for a path to another file, a mailto: link or an artifact link', () => {
    const { host, onReference } = draw('[other](src/other.ts) [mail](mailto:someone@example.com) [deck](maws-artifact:5f0c7a52-0000-4000-8000-000000000001)');
    for (const name of ['other', 'mail', 'deck']) fireEvent.click(screen.getByText(name));
    expect(host.links).toEqual([]);
    expect(onReference).not.toHaveBeenCalled();
    nothingOfTheApp();
  });

  it('gives a refused link no destination a middle click, a menu or a drag could follow; an allowed one keeps its own', () => {
    render(<SheetMarkdown markdown={'[site](https://example.com/a) [ref](src/auth.ts) [other](src/other.ts) [mail](mailto:someone@example.com) [deck](maws-artifact:5f0c7a52-0000-4000-8000-000000000001) ![shot](https://example.com/x.png)'} references={REFERENCES} host={fixtureHost()} onReference={() => {}} />);
    expect([...document.querySelectorAll('[href]')].map((element) => element.getAttribute('href'))).toEqual(['https://example.com/a']);
    for (const name of ['other', 'mail', 'deck']) expect(screen.getByText(name).closest('[href]')).toBeNull();
  });

  it("decodes a path once, the same way for the policy and the drawn link", () => {
    const spaced = { ...TEXT_REFERENCE, path: 'docs/my notes.md', abs: '/work/harbour/docs/my notes.md' };
    const percent = { ...TEXT_REFERENCE, path: 'docs/100%25.md', abs: '/work/harbour/docs/100%25.md' };
    expect(sheetLinkAction('docs/my%20notes.md', [spaced])).toEqual({ kind: 'reference', reference: spaced });
    const onReference = vi.fn();
    render(<SheetMarkdown markdown={'[mine](docs/100%2525.md)'} references={[percent]} host={fixtureHost()} onReference={onReference} />);
    fireEvent.click(screen.getByText('mine'));
    expect(onReference).toHaveBeenCalledWith(percent); // `%2525` decoded once names the file `100%25.md`
  });

  it('draws the Markdown without raw HTML', () => {
    const { container } = render(<SheetMarkdown markdown={'<b>bold</b> and **strong**'} references={[]} host={fixtureHost()} onReference={() => {}} />);
    expect(container.querySelector('b')).toBeNull();
    expect(container.textContent).toContain('<b>bold</b>'); // a tag is its literal text
    expect(screen.getByText('strong')).toBeTruthy();
  });
});
