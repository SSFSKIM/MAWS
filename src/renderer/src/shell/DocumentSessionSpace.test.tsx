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
