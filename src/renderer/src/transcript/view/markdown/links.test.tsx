import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { NO_ACTIONS, TranscriptProvider, useTranscriptContext, type TranscriptActions } from '../context';
import { Markdown } from './Markdown';

afterEach(cleanup);

function renderWith(markdown: string, live = false, storeKey?: string) {
  const actions: TranscriptActions = { ...NO_ACTIONS, openExternal: vi.fn(), openFile: vi.fn(), openArtifact: vi.fn(), openArtifactTab: vi.fn() };
  function WithActions() {
    const context = useTranscriptContext();
    return (
      <TranscriptProvider value={{ ...context, actions, ...(storeKey !== undefined && { storeKey }) }}>
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

  // P3-F wave S (F14, the owner's obs 2): an artifact the agent names opens in MAWS with a click
  describe('an artifact link (maws-artifact:<id>)', () => {
    const ARTIFACT = '0b4f3c1e-6a2d-4c8e-9f1a-2b3c4d5e6f70';
    const SESSION = 'app-links' as AppSessionId;

    it('is a chip whose click opens the artifact in the row session’s panel, and whose ⌘-click opens its main tab', () => {
      const { actions } = renderWith(`See [the plan](maws-artifact:${ARTIFACT}).`, live, SESSION);
      const chip = screen.getByRole('button', { name: 'the plan' });
      fireEvent.click(chip);
      expect(actions.openArtifact).toHaveBeenCalledWith(SESSION, ARTIFACT);
      expect(actions.openArtifactTab).not.toHaveBeenCalled();
      fireEvent.click(chip, { metaKey: true });
      expect(actions.openArtifactTab).toHaveBeenCalledWith(ARTIFACT);
      expect(actions.openArtifact).toHaveBeenCalledTimes(1);
    });

    it('in a child’s transcript acts on the parent session, as every row there does', () => {
      const { actions } = renderWith(`[the plan](maws-artifact:${ARTIFACT})`, live, `${SESSION}:agent-1`);
      fireEvent.click(screen.getByRole('button', { name: 'the plan' }));
      expect(actions.openArtifact).toHaveBeenCalledWith(SESSION, ARTIFACT);
    });

    it('outside any session opens the main tab, the one place it can show', () => {
      const { actions } = renderWith(`[the plan](maws-artifact:${ARTIFACT})`, live);
      fireEvent.click(screen.getByRole('button', { name: 'the plan' }));
      expect(actions.openArtifactTab).toHaveBeenCalledWith(ARTIFACT);
      expect(actions.openArtifact).not.toHaveBeenCalled();
    });

    it('reduces the content form (maws-artifact://<id>/<revision>/<path>) and a fragment to the artifact', () => {
      const { actions } = renderWith(`[page](maws-artifact://${ARTIFACT}/live/index.html) and [v2](maws-artifact:${ARTIFACT}#v2)`, live, SESSION);
      fireEvent.click(screen.getByRole('button', { name: 'page' }));
      fireEvent.click(screen.getByRole('button', { name: 'v2' }));
      expect(vi.mocked(actions.openArtifact).mock.calls).toEqual([[SESSION, ARTIFACT], [SESSION, ARTIFACT]]);
    });

    it('that names no artifact id (a handle, a path) is its text', () => {
      const { container } = renderWith('[mine](maws-artifact:launch-notes) and [up](maws-artifact:../x)', live, SESSION);
      expect(container.querySelector('button, a')).toBeNull();
      expect(container.textContent).toContain('mine');
      expect(container.textContent).toContain('up');
    });
  });

  it('a link the gates stripped renders as its text', () => {
    const { container } = renderWith('[js](javascript:alert(1)) done', live);
    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toContain('js');
  });
});
