// Mermaid is loaded once, globally, the first time a completed fence is seen; each fence renders as a diagram only
// once its closing fence is present, live block or not (residue *Mermaid*). The plugin module is mocked: mermaid itself
// cannot lay out in happy-dom, and what is under test is which fences reach it. Every case starts from a fresh module
// graph, so the load-once state never leaks between cases.
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const rendered: string[] = [];
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

afterEach(cleanup);

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));
const diagrams = (root: HTMLElement) => root.querySelectorAll('[data-streamdown="mermaid-block"]').length;
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

  it('draws every fence of a completed answer', async () => {
    const Markdown = await freshMarkdown();
    const { container } = render(<Markdown markdown={`${CLOSED}\n\n${CLOSED.replace('A --> B', 'E --> F')}`} live={false} />);
    await waitFor(() => expect(diagrams(container)).toBe(2));
    expect(mermaidCode(container)).toBe(0);
  });
});
