import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NO_ACTIONS, TranscriptProvider, useTranscriptContext, type TranscriptActions } from '../context';
import { Markdown } from './Markdown';

afterEach(cleanup);

function renderWith(markdown: string, live = false) {
  const actions: TranscriptActions = { ...NO_ACTIONS, openExternal: vi.fn(), openFile: vi.fn() };
  function WithActions() {
    const context = useTranscriptContext();
    return (
      <TranscriptProvider value={{ ...context, actions }}>
        <Markdown markdown={markdown} live={live} />
      </TranscriptProvider>
    );
  }
  const view = render(<WithActions />);
  return { actions, container: view.container };
}

describe.each([false, true])('markdown links and images (live: %s)', (live) => {
  it('a web link opens externally through the action, never by navigation', () => {
    const { actions } = renderWith('See [the docs](https://example.com/docs).', live);
    const link = screen.getByRole('link', { name: 'the docs' });
    expect(link.getAttribute('title')).toBe('https://example.com/docs');
    const click = fireEvent.click(link);
    expect(click).toBe(false); // default prevented
    expect(actions.openExternal).toHaveBeenCalledWith('https://example.com/docs');
  });

  it('a scheme-less link is a path chip that opens the file, with a line when the path names one', () => {
    const { actions } = renderWith('Open [x.ts](src/renderer/x.ts) and [y](src/y.ts#L42).', live);
    fireEvent.click(screen.getByRole('button', { name: 'x.ts' }));
    expect(actions.openFile).toHaveBeenCalledWith('src/renderer/x.ts', undefined);
    fireEvent.click(screen.getByRole('button', { name: 'y' }));
    expect(actions.openFile).toHaveBeenCalledWith('src/y.ts', 42);
  });

  it('an image that is not inline data is a chip naming its alt text and source, and loads nothing', () => {
    const { container, actions } = renderWith('![a diagram](https://example.com/d.png) and ![local](./shot.png)', live);
    expect(container.querySelector('img')).toBeNull();
    const chips = [...container.querySelectorAll('[data-chip="image"]')];
    expect(chips.map((chip) => chip.textContent)).toEqual(['a diagram · https://example.com/d.png', 'local · ./shot.png']);
    fireEvent.click(chips[0]);
    expect(actions.openExternal).not.toHaveBeenCalled();
  });

  it('an inline data image renders as an image', () => {
    const { container } = renderWith('![dot](data:image/png;base64,iVBORw0KGgo=)', live);
    expect(container.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,iVBORw0KGgo=');
  });

  it('a link the gates stripped renders as its text', () => {
    const { container } = renderWith('[js](javascript:alert(1)) done', live);
    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toContain('js');
  });
});
