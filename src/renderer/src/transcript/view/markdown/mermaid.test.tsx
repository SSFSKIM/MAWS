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
          if (source.includes('BROKEN')) throw new Error('Parse error on line 2');
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

  it('keeps a fence mermaid rejected as its code, with one muted line saying the diagram could not be drawn', async () => {
    const Markdown = await freshMarkdown();
    const { container } = render(<Markdown markdown={CLOSED.replace('A --> B', 'BROKEN -->')} live={false} />);
    await waitFor(() => expect(container.querySelector('.transcript-mermaid-failed')?.textContent).toBe('Diagram could not be drawn'));
    expect(diagrams(container)).toBe(0);
    expect(mermaidCode(container)).toBe(1);
    expect(container.textContent).not.toContain('Mermaid Error');
  });

  // Debt wave 4: completeness is per fence, from the parser (remark), not a line scan of the whole text.
  it('sees a closed fence inside a blockquote or a list item as CommonMark does: loads the module and draws it', async () => {
    const Markdown = await freshMarkdown();
    const quoted = 'Note:\n\n> ```mermaid\n> flowchart LR\n>   Q --> R\n> ```\n\nAfter';
    const { container } = render(<Markdown markdown={quoted} live={false} />);
    await waitFor(() => expect(loaded).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(diagrams(container)).toBe(1));
    const listed = render(<Markdown markdown={'Steps:\n\n1. Draw:\n\n   ```mermaid\n   flowchart LR\n     L --> M\n   ```\n2. Done'} live={false} />);
    await waitFor(() => expect(diagrams(listed.container)).toBe(1));
    expect(rendered.some((source) => source.includes('Q --> R'))).toBe(true);
    expect(rendered.some((source) => source.includes('L --> M'))).toBe(true);
  });

  it('keeps a quoted fence that the blockquote ended before it closed as code', async () => {
    const Markdown = await freshMarkdown();
    const first = render(<Markdown markdown={CLOSED} live={false} />);
    await waitFor(() => expect(diagrams(first.container)).toBe(1));
    const { container } = render(<Markdown markdown={'> ```mermaid\n> flowchart LR\n>   S --> T\n\nOutside the quote'} live={false} />);
    await settle();
    expect(diagrams(container)).toBe(0);
    expect(mermaidCode(container)).toBe(1);
    expect(rendered.some((source) => source.includes('S --> T'))).toBe(false);
  });

  it('answers two identical fences apart: the closed one draws while its unterminated twin stays code', async () => {
    const Markdown = await freshMarkdown();
    const { container } = render(<Markdown markdown={`${CLOSED}\n\n${OPEN.replace('C --> D', 'A --> B')}`} live={false} />);
    await waitFor(() => expect(diagrams(container)).toBe(1));
    expect(mermaidCode(container)).toBe(1);
  });

  it('draws every fence of a completed answer', async () => {
    const Markdown = await freshMarkdown();
    const { container } = render(<Markdown markdown={`${CLOSED}\n\n${CLOSED.replace('A --> B', 'E --> F')}`} live={false} />);
    await waitFor(() => expect(diagrams(container)).toBe(2));
    expect(mermaidCode(container)).toBe(0);
  });
});
