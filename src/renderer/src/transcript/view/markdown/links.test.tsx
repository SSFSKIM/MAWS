import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { NO_ACTIONS, setHostActions, TranscriptProvider, turnFileLinks, useTranscriptContext, type TranscriptActions } from '../context';
import { DEFAULT_ACTIONS } from '../default-actions';
import { ARTIFACT_LINK_TITLE, openArtifactMention } from './Link';
import { Markdown } from './Markdown';

afterEach(cleanup);

function renderWith(markdown: string, live = false, storeKey?: string, opts: { tab?: boolean; shown?: boolean } = {}) {
  const actions: TranscriptActions = {
    ...NO_ACTIONS, openExternal: vi.fn(), openFile: vi.fn(), openArtifact: vi.fn(), ...(opts.tab !== false && { openArtifactTab: vi.fn() }),
    ...(opts.shown !== undefined && { showOpenArtifactTab: vi.fn(() => opts.shown!) }),
  };
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
    expect(actions.openExternal).toHaveBeenCalledWith('https://example.com/docs', null);
  });

  // P5 O7 M3: the row's session goes with the link, so a loopback link of another machine's session opens forwarded
  it('a web link in a session’s transcript carries that session', () => {
    const { actions } = renderWith('Running at [localhost:5173](http://localhost:5173/).', live, 'OtherMachineRef0000000/session-r');
    fireEvent.click(screen.getByRole('link', { name: 'localhost:5173' }));
    expect(actions.openExternal).toHaveBeenCalledWith('http://localhost:5173/', 'OtherMachineRef0000000/session-r');
  });

  // UX wave U6b-4b (R3, decision 13): ⌘ reaches the opener as a third argument, so a loopback link of a session on this
  // Mac can open in the system browser; a plain click passes none, as before
  it('a ⌘-click on a web link asks the opener for the system browser; a plain click asks nothing more', () => {
    const session = 'TestMachineRef00000000/app-web';
    const { actions } = renderWith('Running at [localhost:5173](http://localhost:5173/).', live, session);
    const link = screen.getByRole('link', { name: 'localhost:5173' });
    fireEvent.click(link, { metaKey: true });
    fireEvent.click(link);
    expect(vi.mocked(actions.openExternal).mock.calls).toEqual([['http://localhost:5173/', session, { external: true }], ['http://localhost:5173/', session]]);
  });

  // N3.6: a Markdown surface outside any transcript has no session; its link reaches the host's opener as today
  it('outside any Transcript, a loopback link reaches the host’s openExternal with no session, ⌘ or not', () => {
    const openExternal = vi.fn();
    setHostActions({ ...DEFAULT_ACTIONS, openExternal });
    try {
      render(<Markdown markdown="Running at [the app](http://localhost:5173/)." live={live} />);
      const link = screen.getByRole('link', { name: 'the app' });
      fireEvent.click(link);
      fireEvent.click(link, { metaKey: true });
      expect(openExternal.mock.calls).toEqual([['http://localhost:5173/', null], ['http://localhost:5173/', null, { external: true }]]);
    } finally {
      setHostActions(DEFAULT_ACTIONS);
    }
  });

  it('a scheme-less link is a path chip that opens the file, with a line when the path names one', () => {
    const { actions } = renderWith('Open [x.ts](src/renderer/x.ts) and [y](src/y.ts#L42).', live);
    fireEvent.click(screen.getByRole('button', { name: 'x.ts' }));
    expect(actions.openFile).toHaveBeenCalledWith('src/renderer/x.ts', undefined, null, { main: false });
    fireEvent.click(screen.getByRole('button', { name: 'y' }));
    expect(actions.openFile).toHaveBeenCalledWith('src/y.ts', 42, null, { main: false });
  });

  // UX wave U6b-1 (L3): a click opens the file beside the chat, a ⌘-click in the main area
  it('a ⌘-click on a path chip asks for the main area', () => {
    const { actions } = renderWith('Open [x.ts](src/renderer/x.ts#L3).', live);
    fireEvent.click(screen.getByRole('button', { name: 'x.ts' }), { metaKey: true });
    expect(actions.openFile).toHaveBeenCalledExactlyOnceWith('src/renderer/x.ts', 3, null, { main: true });
  });

  // UX wave U6b-4b (R1, L1): where the window turned the form on, an inline `file:` link with an empty host is the path
  // link of its rest: the same line, the same session, and ⌘ for the main area; a `file:` link with a host is its text
  it('a file: link with no host is the path link of its path, with its line; ⌘-click asks for the main area', () => {
    turnFileLinks(true);
    try {
      const { actions } = renderWith('Open [x.ts](file:///work/x.ts#L12), [y](FILE:///work/y.ts:7) and [h](file://host/work/h.ts).', live, 'app-local-session');
      const link = screen.getByRole('button', { name: 'x.ts' });
      expect([link.dataset.chip, link.getAttribute('title')]).toEqual(['path', '/work/x.ts']);
      fireEvent.click(link);
      fireEvent.click(screen.getByRole('button', { name: 'y' }), { metaKey: true });
      expect(vi.mocked(actions.openFile).mock.calls).toEqual([['/work/x.ts', 12, 'app-local-session', { main: false }], ['/work/y.ts', 7, 'app-local-session', { main: true }]]);
      expect(screen.queryByRole('button', { name: 'h' })).toBeNull();
      expect(screen.getByText('h').closest('[data-chip], a')).toBeNull();
    } finally {
      turnFileLinks(false);
    }
  });

  // UX wave U6d: a path link takes the mention's element and look (its text in the monospace font, by its data-chip),
  // its title its path, and the keyboard's Enter and Space; its click is today's openFile, beside the chat (no ⌘: UX wave U6b-1)
  it('a path link is link text too: a focusable span with the role of a button, opened by Enter and Space', () => {
    const { actions } = renderWith('Open [x.ts](src/renderer/x.ts#L7).', live);
    const link = screen.getByRole('button', { name: 'x.ts' });
    expect([link.tagName, link.className, link.getAttribute('tabindex'), link.getAttribute('title'), link.dataset.chip]).toEqual(['SPAN', 'transcript-inline-link', '0', 'src/renderer/x.ts', 'path']);
    fireEvent.keyDown(link, { key: 'Enter' });
    fireEvent.keyDown(link, { key: ' ' });
    fireEvent.keyDown(link, { key: ' ', repeat: true });
    expect(vi.mocked(actions.openFile).mock.calls).toEqual([['src/renderer/x.ts', 7, null, { main: false }], ['src/renderer/x.ts', 7, null, { main: false }]]);
  });

  it('an image that is not inline data is a chip naming its alt text and source, and loads nothing', () => {
    const { container, actions } = renderWith('![a diagram](https://example.com/d.png) and ![local](./shot.png)', live);
    expect(container.querySelector('img')).toBeNull();
    const chips = [...container.querySelectorAll('[data-chip="image"]')];
    expect(chips.map((chip) => chip.textContent)).toEqual(['a diagram · https://example.com/d.png', 'local · ./shot.png']);
    expect(chips.map((chip) => [chip.className, chip.getAttribute('role')]), 'the image chip keeps its box and opens nothing (U6d)').toEqual([['transcript-chip', null], ['transcript-chip', null]]);
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

    // UX wave U6d (O-44; the owner's card C4): the mention reads as link text, not a box: an inline span with the role of
    // a button, so a long title wraps with the prose (a <button> is an inline-block box)
    it('is link text: a focusable span with the role of a button, the inline link class and the one tooltip', () => {
      renderWith(`See [the plan](maws-artifact:${ARTIFACT}#block=b7).`, live, SESSION);
      const link = screen.getByRole('button', { name: 'the plan' });
      expect([link.tagName, link.className, link.getAttribute('tabindex'), link.getAttribute('title'), link.getAttribute('aria-label')]).toEqual(['SPAN', 'transcript-inline-link', '0', ARTIFACT_LINK_TITLE, null]);
      expect(link.dataset).toMatchObject({ chip: 'artifact', artifactId: ARTIFACT, artifactAt: '#block=b7' });
      expect(ARTIFACT_LINK_TITLE).toBe('⌘-click opens it in a tab'); // the word cut (N125): the shortcut alone
    });

    // decision 8: Enter and Space are a click on the link, so whatever handles the click handles the key; a held key opens
    // once; ⌘Enter is a ⌘-click
    it('opens on Enter and on Space as a click does, once for a held key, and in its main tab on ⌘Enter', () => {
      const { actions } = renderWith(`See [the plan](maws-artifact:${ARTIFACT}).`, live, SESSION);
      const link = screen.getByRole('button', { name: 'the plan' });
      link.focus();
      expect(fireEvent.keyDown(link, { key: 'Enter' }), 'Enter: default prevented').toBe(false);
      expect(fireEvent.keyDown(link, { key: ' ' }), 'Space: default prevented, so the transcript does not scroll').toBe(false);
      expect(vi.mocked(actions.openArtifact).mock.calls).toEqual([[SESSION, ARTIFACT], [SESSION, ARTIFACT]]);
      expect(fireEvent.keyDown(link, { key: 'Enter', repeat: true }), 'a repeat: default prevented').toBe(false);
      expect(fireEvent.keyDown(link, { key: ' ', repeat: true })).toBe(false);
      expect(actions.openArtifact).toHaveBeenCalledTimes(2);
      fireEvent.keyDown(link, { key: 'Enter', metaKey: true });
      expect(vi.mocked(actions.openArtifactTab!).mock.calls).toEqual([[ARTIFACT]]);
      expect(fireEvent.keyDown(link, { key: 'a' }), 'another key is left alone').toBe(true);
      expect(actions.openArtifact).toHaveBeenCalledTimes(2);
    });

    // decision 8, first clause (the adversarial review's first finding): the keymap's dispatcher listens on the window in
    // the capture phase and prevents the default of a key it ran a binding for, without stopping it; the link then
    // leaves the key alone, so an app chord on Enter or Space does not also open the focused link
    it('leaves alone a key an earlier listener consumed, and opens on the same key once none does', () => {
      const { actions } = renderWith(`See [the plan](maws-artifact:${ARTIFACT}).`, live, SESSION);
      const link = screen.getByRole('button', { name: 'the plan' });
      const clicks = vi.fn();
      link.addEventListener('click', clicks);
      const consume = (event: KeyboardEvent) => event.preventDefault();
      window.addEventListener('keydown', consume, true);
      try {
        for (const key of [{ key: 'Enter' }, { key: ' ' }, { key: 'Enter', metaKey: true }]) fireEvent.keyDown(link, key);
        expect(clicks).not.toHaveBeenCalled();
        expect(actions.openArtifact).not.toHaveBeenCalled();
        expect(actions.openArtifactTab).not.toHaveBeenCalled();
      } finally {
        window.removeEventListener('keydown', consume, true);
      }
      for (const key of [{ key: 'Enter' }, { key: ' ' }, { key: 'Enter', metaKey: true }]) fireEvent.keyDown(link, key);
      expect(clicks).toHaveBeenCalledTimes(3);
      expect(actions.openArtifact).toHaveBeenCalledTimes(2);
      expect(actions.openArtifactTab).toHaveBeenCalledTimes(1);
    });

    // decision 12: a click that ends a selection touching the link opens nothing; a plain click, and the keyboard
    // whatever is selected, open
    it('opens nothing on a click that ends a selection in its text; a plain click and the keyboard open', () => {
      const { actions } = renderWith(`See [the long plan](maws-artifact:${ARTIFACT}).`, live, SESSION);
      const link = screen.getByRole('button', { name: 'the long plan' });
      const selection = document.getSelection()!;
      const range = document.createRange();
      range.setStart(link.firstChild!, 2);
      range.setEnd(link.firstChild!, 6);
      selection.removeAllRanges();
      selection.addRange(range);
      try {
        expect(selection.isCollapsed).toBe(false);
        fireEvent.click(link, { detail: 1 });
        expect(actions.openArtifact, 'the click that ends a drag').not.toHaveBeenCalled();
        fireEvent.keyDown(link, { key: 'Enter' });
        expect(actions.openArtifact, 'the keyboard').toHaveBeenCalledTimes(1);
        // a selection elsewhere in the page does not hold the link's click
        const other = document.body.appendChild(document.createElement('p'));
        other.textContent = 'words elsewhere';
        const elsewhere = document.createRange();
        elsewhere.selectNodeContents(other);
        selection.removeAllRanges();
        selection.addRange(elsewhere);
        fireEvent.click(link, { detail: 1 });
        other.remove();
        expect(actions.openArtifact, 'a selection elsewhere').toHaveBeenCalledTimes(2);
        selection.removeAllRanges();
        fireEvent.click(link, { detail: 1 });
        expect(actions.openArtifact, 'a plain click').toHaveBeenCalledTimes(3);
      } finally {
        selection.removeAllRanges();
      }
    });

    // card C5 ("Show that tab"): the main tab that already shows the artifact comes forward, and nothing opens beside
    // the chat; with none, the panel opens as before. ⌘-click is unchanged.
    it('shows the main tab that already holds the artifact, at the place the link names, and else opens it in the panel', () => {
      const shown = renderWith(`[the plan](maws-artifact:${ARTIFACT}) [the block](maws-artifact:${ARTIFACT}#block=b7)`, live, SESSION, { shown: true });
      fireEvent.click(screen.getByRole('button', { name: 'the plan' }));
      fireEvent.click(screen.getByRole('button', { name: 'the block' }));
      expect(vi.mocked(shown.actions.showOpenArtifactTab!).mock.calls).toEqual([[SESSION, ARTIFACT], [SESSION, ARTIFACT, { block: 'b7' }]]);
      expect(shown.actions.openArtifact).not.toHaveBeenCalled();
      expect(shown.actions.openArtifactTab).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'the plan' }), { metaKey: true });
      expect(vi.mocked(shown.actions.openArtifactTab!).mock.calls).toEqual([[ARTIFACT]]);
      expect(shown.actions.showOpenArtifactTab).toHaveBeenCalledTimes(2);
      cleanup();

      const none = renderWith(`[the block](maws-artifact:${ARTIFACT}#block=b7)`, live, SESSION, { shown: false });
      fireEvent.click(screen.getByRole('button', { name: 'the block' }));
      expect(vi.mocked(none.actions.openArtifact).mock.calls).toEqual([[SESSION, ARTIFACT, undefined, { block: 'b7' }]]);
    });

    // P3-F wave S (F14 review 2): where nothing can open it (the desk's actions, a mount with no main tab to give), the
    // link is its text, as before the scheme was kept
    it('with no openArtifactTab action is its text, never a chip that does nothing', () => {
      const { container, actions } = renderWith(`See [the plan](maws-artifact:${ARTIFACT}).`, live, SESSION, { tab: false });
      expect(container.querySelector('button, a, [role="button"]')).toBeNull();
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
      expect(container.querySelector('button, a, [role="button"]')).toBeNull();
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

// UX wave U6d (Interfaces §F): the one rule both click sites call, the transcript's link and a mod surface's capture
describe('openArtifactMention', () => {
  const ARTIFACT = '0b4f3c1e-6a2d-4c8e-9f1a-2b3c4d5e6f70';
  const SESSION = 'app-links' as AppSessionId;
  const REMOTE = 'OtherMachineRef0000000/session-r' as AppSessionId;
  const actionsWith = (shown: boolean | undefined) => ({
    ...NO_ACTIONS, openArtifact: vi.fn(), openArtifactTab: vi.fn(), ...(shown !== undefined && { showOpenArtifactTab: vi.fn(() => shown) }),
  });

  it('with no session opens the main tab, ⌘ or not, and asks nothing of an open tab', () => {
    const actions = actionsWith(true);
    openArtifactMention(actions, null, { artifactId: ARTIFACT }, false);
    openArtifactMention(actions, null, { artifactId: ARTIFACT, at: { tab: 't2' } }, true);
    expect(actions.openArtifactTab.mock.calls).toEqual([[ARTIFACT], [ARTIFACT, { tab: 't2' }]]);
    expect(actions.showOpenArtifactTab).not.toHaveBeenCalled();
    expect(actions.openArtifact).not.toHaveBeenCalled();
  });

  it('with ⌘ opens the main tab, on the session’s machine when its id is an address', () => {
    const actions = actionsWith(false);
    openArtifactMention(actions, SESSION, { artifactId: ARTIFACT }, true);
    openArtifactMention(actions, REMOTE, { artifactId: ARTIFACT, at: { slide: 's1' } }, true);
    expect(actions.openArtifactTab.mock.calls).toEqual([[ARTIFACT], [ARTIFACT, { slide: 's1' }, 'OtherMachineRef0000000']]);
    expect(actions.showOpenArtifactTab).not.toHaveBeenCalled();
  });

  it('without ⌘ shows the open main tab when there is one, else opens beside the chat; a mount without the action opens beside the chat', () => {
    const shown = actionsWith(true);
    openArtifactMention(shown, REMOTE, { artifactId: ARTIFACT, at: { block: 'b7' } }, false);
    expect(vi.mocked(shown.showOpenArtifactTab!).mock.calls).toEqual([[REMOTE, ARTIFACT, { block: 'b7' }]]);
    expect(shown.openArtifact).not.toHaveBeenCalled();
    for (const actions of [actionsWith(false), actionsWith(undefined)]) {
      openArtifactMention(actions, SESSION, { artifactId: ARTIFACT }, false);
      openArtifactMention(actions, SESSION, { artifactId: ARTIFACT, at: { version: 2 } }, false);
      expect(actions.openArtifact.mock.calls).toEqual([[SESSION, ARTIFACT], [SESSION, ARTIFACT, undefined, { version: 2 }]]);
      expect(actions.openArtifactTab).not.toHaveBeenCalled();
    }
  });
});
