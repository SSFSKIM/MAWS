import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { resetShellStores } from '../test-support/shell-stores';
import { mainShowing, ref } from '../test-support/panel';
import { useLayout } from '../stores/layout';
import { floatPanel, useFloatingCard } from './floating';
import { DocumentSessionSpace } from './DocumentSessionSpace';

let width = 1200;
let resize: () => void;
beforeEach(() => {
  resetShellStores();
  useFloatingCard.setState({ closed: false, column: null, columnDrag: null });
  const session = 'a' as AppSessionId;
  const document = ref('artifacts:document');
  useLayout.setState({
    main: mainShowing(session),
    panelBySession: new Map([[session, { tabs: [document], activeTabId: document.id }]]),
  });
  floatPanel();
  width = 1200;
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => width);
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resize = callback; }
    observe() {} disconnect() {}
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('keeps a document reading column beside the session, clamps a resize, and releases it at narrow widths or close', () => {
  render(<DocumentSessionSpace surface="panel" enabled><p>Next steps</p></DocumentSessionSpace>);
  const column = () => document.querySelector<HTMLElement>('[data-document-session-column]');
  expect(column()?.style.width).toBe('420px');
  expect(useFloatingCard.getState().column?.element).toBe(column());
  const content = screen.getByText('Next steps');
  act(() => { const drag = useFloatingCard.getState().startColumnDrag(); drag.width(900); });
  expect(column()?.style.width).toBe('600px');
  act(() => { width = 800; resize(); });
  expect(column()).toBeNull();
  expect(useFloatingCard.getState().column).toBeNull();
  expect(screen.getByText('Next steps')).toBe(content);
  act(() => { width = 1200; resize(); });
  expect(column()).not.toBeNull();
  act(() => useFloatingCard.getState().setClosed(true));
  expect(column()).toBeNull();
});

// UX wave U10b (O-43, B6): under the bar a scrolling document keeps the bar's published height and its margin at the end
// of its scroll (the editor's page reads `--float-bar-room`), only while the bar floats over this surface.
it('gives the page the bar’s height and margin at the end of its scroll while the bar floats over its surface', () => {
  render(<DocumentSessionSpace surface="panel" enabled><p>Next steps</p></DocumentSessionSpace>);
  const room = () => screen.getByText('Next steps').parentElement!.parentElement!.style.getPropertyValue('--float-bar-room');
  const bar = { left: 900, top: 640, width: 484, height: 60 };
  act(() => useFloatingCard.setState({ closed: false, hidden: false, rect: { left: 1004, top: 300, width: 420, height: 420 }, host: 'panel' }));
  expect(room(), 'the open card: no room').toBe('');
  act(() => useFloatingCard.setState({ closed: true, hidden: false, rect: bar, host: 'panel' }));
  expect(room()).toBe('76px');
  act(() => useFloatingCard.setState({ rect: bar, host: 'split' }));
  expect(room(), 'the bar over the other surface').toBe('');
  act(() => useFloatingCard.setState({ closed: true, hidden: true, rect: null, host: null }));
  expect(room(), 'hidden: nothing floats').toBe('');
});
