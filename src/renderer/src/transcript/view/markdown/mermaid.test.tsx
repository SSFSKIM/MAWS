// Mermaid is loaded once, globally, the first time a completed fence is seen; each fence renders as a diagram only
// once its closing fence is present, live block or not (residue *Mermaid*). The plugin module is mocked: mermaid itself
// cannot lay out in happy-dom, and what is under test is which fences reach it. Every case starts from a fresh module
// graph, so the load-once state never leaks between cases.
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const rendered: string[] = [];
// While set, mermaid's layout waits for the test to release it.
let gate: PromiseWithResolvers<void> | null = null;
// Called once per fresh plugins module when it loads mermaid (vi.resetModules leaves mocked modules cached, so the
// factory itself runs once; plugin creation is the per-graph signal).
const loaded = vi.fn();
vi.mock('@streamdown/mermaid', () => {
  return {
    createMermaidPlugin: () => (loaded(), {
      name: 'mermaid',
      type: 'diagram',
      language: 'mermaid',
      getMermaid: () => ({
        initialize: () => {},
        render: async (_id: string, source: string) => {
          rendered.push(source);
          await gate?.promise;
          return { svg: '<svg data-fake-diagram="true"></svg>' };
        },
      }),
    }),
  };
});

async function freshMarkdown() {
  vi.resetModules();
  loaded.mockClear();
  rendered.length = 0;
  return (await import('./Markdown')).Markdown;
}

// Streamdown lays a diagram out once its block has been in view for 300 ms (an IntersectionObserver, which happy-dom
// never fires): every block is in view here.
class InView {
  constructor(private readonly callback: (entries: { isIntersecting: boolean; target: Element }[], observer: InView) => void) {}
  observe(target: Element) {
    this.callback([{ isIntersecting: true, target }], this);
  }
  takeRecords = () => [];
  unobserve() {}
  disconnect() {}
}
beforeEach(() => vi.stubGlobal('IntersectionObserver', InView));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));
// Drawn diagrams, and the mermaid fences showing as code (a closed fence's diagram draws hidden until its SVG is in).
const diagrams = (root: HTMLElement) => root.querySelectorAll('.transcript-mermaid[data-drawn] [data-streamdown="mermaid-block"]').length;
const mermaidCode = (root: HTMLElement) => root.querySelectorAll('[data-streamdown="code-block"][data-language="mermaid"]').length;

const CLOSED = 'Plan:\n\n```mermaid\nflowchart LR\n  A --> B\n```\n\nNext';
const OPEN = 'Plan:\n\n```mermaid\nflowchart LR\n  C --> D';

describe('mermaid fences', () => {
  it('shows an unterminated fence as code and loads nothing while no fence has closed', async () => {
    const Markdown = await freshMarkdown();
    const { container } = render(<Markdown markdown={OPEN} live />);
    await settle();
    expect(loaded).not.toHaveBeenCalled();
    expect(diagrams(container)).toBe(0);
    expect(mermaidCode(container)).toBe(1);
  });

  it('loads the module for a closed fence inside a still-live answer and draws that fence', async () => {
    const Markdown = await freshMarkdown();
    const { container } = render(<Markdown markdown={CLOSED} live />);
    await waitFor(() => expect(loaded).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(diagrams(container)).toBe(1));
    expect(mermaidCode(container)).toBe(0);
  });

  it('keeps an unterminated live fence as code after another diagram has loaded the module', async () => {
    const Markdown = await freshMarkdown();
    const first = render(<Markdown markdown={CLOSED} live={false} />);
    await waitFor(() => expect(diagrams(first.container)).toBe(1));
    const { container } = render(<Markdown markdown={OPEN} live />);
    await settle();
    expect(diagrams(container)).toBe(0);
    expect(mermaidCode(container)).toBe(1);
    expect(rendered.some((source) => source.includes('C --> D'))).toBe(false);
  });

  it('in one live answer, draws the closed fence and keeps the trailing open fence as code', async () => {
    const Markdown = await freshMarkdown();
    const { container } = render(<Markdown markdown={`${CLOSED}\n\n${OPEN}`} live />);
    await waitFor(() => expect(diagrams(container)).toBe(1));
    expect(mermaidCode(container)).toBe(1);
    expect(loaded).toHaveBeenCalledTimes(1);
  });

  it('keeps a fence that never closed as code in a completed block too', async () => {
    const Markdown = await freshMarkdown();
    const first = render(<Markdown markdown={CLOSED} live={false} />);
    await waitFor(() => expect(diagrams(first.container)).toBe(1));
    const { container } = render(<Markdown markdown={`${CLOSED.replace('A --> B', 'X --> Y')}\n\n${OPEN}`} live={false} />);
    await waitFor(() => expect(diagrams(container)).toBe(1));
    expect(mermaidCode(container)).toBe(1);
    expect(rendered.some((source) => source.includes('C --> D'))).toBe(false);
  });

  it('shows a closed fence as its code until mermaid has drawn it, never an empty frame', async () => {
    const Markdown = await freshMarkdown();
    gate = Promise.withResolvers<void>();
    const { container } = render(<Markdown markdown={CLOSED} live={false} />);
    await waitFor(() => expect(rendered).toHaveLength(1)); // mermaid is laying it out
    expect(diagrams(container)).toBe(0);
    expect(mermaidCode(container)).toBe(1);
    expect(container.querySelector('.transcript-mermaid:not([data-drawn]) > .transcript-mermaid-diagram')).not.toBeNull(); // hidden (transcript.css)
    gate.resolve();
    gate = null;
    await waitFor(() => expect(diagrams(container)).toBe(1));
    expect(mermaidCode(container)).toBe(0);
  });

  it('draws every fence of a completed answer', async () => {
    const Markdown = await freshMarkdown();
    const { container } = render(<Markdown markdown={`${CLOSED}\n\n${CLOSED.replace('A --> B', 'E --> F')}`} live={false} />);
    await waitFor(() => expect(diagrams(container)).toBe(2));
    expect(mermaidCode(container)).toBe(0);
  });
});
