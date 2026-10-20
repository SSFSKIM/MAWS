import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { NO_ACTIONS, setHostActions, TranscriptProvider, useTranscriptContext, type TranscriptActions } from '../context';
import { DEFAULT_ACTIONS } from '../default-actions';
import { Markdown } from './Markdown';

afterEach(cleanup);

function renderWith(markdown: string, live = false, storeKey?: string, opts: { tab?: boolean } = {}) {
  const actions: TranscriptActions = { ...NO_ACTIONS, openExternal: vi.fn(), openFile: vi.fn(), openArtifact: vi.fn(), ...(opts.tab !== false && { openArtifactTab: vi.fn() }) };
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

    it('reduces the content form (maws-artifact://<id>/<revision>/<path>) to the artifact, its page path naming no place', () => {
      const { actions } = renderWith(`[page](maws-artifact://${ARTIFACT}/live/index.html#top)`, live, SESSION);
      fireEvent.click(screen.getByRole('button', { name: 'page' }));
      expect(vi.mocked(actions.openArtifact).mock.calls).toEqual([[SESSION, ARTIFACT]]);
    });

    // P4-B4 (the link grammar): a fragment names the place the artifact opens at, a click and a ⌘-click alike; a part
    // the grammar cannot read is dropped and the link still opens the artifact
    it('opens the artifact at the place its fragment names, in the panel and in the main tab', () => {
      const links: Array<[string, string, object | undefined]> = [
        ['block', '#block=b7', { block: 'b7' }],
        ['tab', '#tab=t2', { tab: 't2' }],
        ['slide', '#slide=s-1_x', { slide: 's-1_x' }],
        ['version', '#v3', { version: 3 }],
        ['all', '#v2&tab=t1#block=b9', { version: 2, tab: 't1', block: 'b9' }],
        ['junk', '#zoom=4&block=', undefined],
      ];
      const { container, actions } = renderWith(links.map(([name, fragment]) => `[${name}](maws-artifact:${ARTIFACT}${fragment})`).join(' '), live, SESSION);
      for (const [name, , at] of links) {
        const chip = screen.getByRole('button', { name });
        fireEvent.click(chip);
        fireEvent.click(chip, { metaKey: true });
        expect(vi.mocked(actions.openArtifact).mock.calls.at(-1), name).toEqual(at ? [SESSION, ARTIFACT, undefined, at] : [SESSION, ARTIFACT]);
        expect(vi.mocked(actions.openArtifactTab!).mock.calls.at(-1), name).toEqual(at ? [ARTIFACT, at] : [ARTIFACT]);
      }
      // the chip carries the place as the grammar writes it, for a surface that takes the click before it
      expect([...container.querySelectorAll<HTMLElement>('[data-chip="artifact"]')].map((chip) => chip.dataset.artifactAt)).toEqual(['#block=b7', '#tab=t2', '#slide=s-1_x', '#v3', '#v2#tab=t1#block=b9', undefined]);
    });

    // P3-F wave S (F14 review 2): where nothing can open it (the desk's actions, a mount with no main tab to give), the
    // link is its text, as before the scheme was kept
    it('with no openArtifactTab action is its text, never a chip that does nothing', () => {
      const { container, actions } = renderWith(`See [the plan](maws-artifact:${ARTIFACT}).`, live, SESSION, { tab: false });
      expect(container.querySelector('button, a')).toBeNull();
      expect(actions.openArtifact).not.toHaveBeenCalled();
      expect(container.textContent).toContain('See the plan.');
    });

    it('outside any Transcript, opens the main tab through the host’s actions (the Side tool, the ask sheet, a preview)', () => {
      const openArtifactTab = vi.fn();
      setHostActions({ ...DEFAULT_ACTIONS, openArtifactTab });
      try {
        render(<Markdown markdown={`[the plan](maws-artifact:${ARTIFACT})`} live={live} />);
        fireEvent.click(screen.getByRole('button', { name: 'the plan' }));
        expect(openArtifactTab).toHaveBeenCalledWith(ARTIFACT);
      } finally {
        setHostActions(DEFAULT_ACTIONS);
      }
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
