// UX wave U6b-4b (docs/doperpowers/plans/2026-11-18-ux-wave-U6b-4b-links.md, R3, N3.8 and N3.9): a web call's receipt
// opens its address as a Markdown link does: through the opener, with the row's session and ⌘, so a loopback address
// of a session on this Mac opens in its in-app browser and one of another machine's session is forwarded or refused.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { MachineState } from '@shared/ipc/schema/machines';
import { addressOf, bareOf } from '@shared/machine/address';
import { OTHER_MACHINE } from '../../../../../../test/support/machine';
import { registerPanelTool } from '../../../panel/host';
import { useMachines } from '../../../stores/machines';
import { useNotices } from '../../../stores/notices';
import { browserTab, T1 } from '../../../test-support/browser';
import { installFakeMain, ok } from '../../../test-support/code';
import { A, panelOf, resetPanelStores } from '../../../test-support/panel';
import { browserTool } from '../../../tools/browser/BrowserTool';
import { BROWSER_COPY } from '../../../tools/browser/copy';
import { resetForwards } from '../../../tools/browser/forward';
import { openWebLink } from '../../../tools/browser/local-link';
import type { CellDetail } from '../../model/rows';
import { NO_ACTIONS, TranscriptProvider, useTranscriptContext, type TranscriptActions } from '../context';
import { WebDetail } from './WebDetail';

type Web = Extract<CellDetail, { kind: 'web' }>;
const R = addressOf(OTHER_MACHINE, 'session-r' as AppSessionId);
const web = (url: string): Web => ({ kind: 'web', url, query: null, output: 'fetched', truncated: null });

// The receipt inside a mounted transcript whose store key is `storeKey`, with `openExternal` as the mount's opener.
function renderReceipt(url: string, storeKey: string, openExternal: TranscriptActions['openExternal']) {
  function Mounted() {
    const context = useTranscriptContext();
    return (
      <TranscriptProvider value={{ ...context, storeKey, actions: { ...NO_ACTIONS, openExternal } }}>
        <WebDetail detail={web(url)} />
      </TranscriptProvider>
    );
  }
  render(<Mounted />);
  return screen.getByRole('button', { name: url });
}

afterEach(cleanup);

describe('a web call’s receipt', () => {
  it('passes the row’s session to the opener, and ⌘ as a Markdown link does', () => {
    const openExternal = vi.fn();
    const address = renderReceipt('http://localhost:3000/', R, openExternal);
    fireEvent.click(address);
    fireEvent.click(address, { metaKey: true });
    expect(openExternal.mock.calls).toEqual([['http://localhost:3000/', R], ['http://localhost:3000/', R, { external: true }]]);
  });

  it('in a child agent’s transcript passes the parent session, as every row there does', () => {
    const openExternal = vi.fn();
    fireEvent.click(renderReceipt('http://localhost:3000/', `${R}:agent-1`, openExternal));
    expect(openExternal.mock.calls).toEqual([['http://localhost:3000/', R]]);
  });
});

describe('a web call’s receipt through the window’s opener', () => {
  let main: ReturnType<typeof installFakeMain>;
  const browserTabs = (id: AppSessionId) => (panelOf(id)?.tabs ?? []).filter((t) => t.toolId === browserTool.id);
  const toasts = () => useNotices.getState().notices.map((n) => n.text);

  beforeEach(() => {
    resetPanelStores();
    useNotices.setState({ notices: [] });
    useMachines.setState({ machines: new Map([[OTHER_MACHINE, { name: 'mini' } as MachineState]]) });
    registerPanelTool(browserTool);
    main = installFakeMain((name, input) => {
      if (name === 'browser.tabs.open') return ok({ tab: browserTab(T1, input.appSessionId as AppSessionId, { url: input.url as string }), reused: false });
      if (name === 'remote.forward.open') return ok({ localPort: 54321 });
      return ok();
    });
  });
  afterEach(() => {
    resetForwards();
    useMachines.setState({ machines: new Map() });
    delete (window as { maws?: unknown }).maws;
  });

  // N3.8
  it('of a session on another machine forwards its loopback address, and this Mac’s browsers open it nowhere', () => {
    fireEvent.click(renderReceipt('http://localhost:3000/', R, openWebLink));
    expect(main.callsOf('remote.forward.open')).toEqual([{ machine: OTHER_MACHINE, port: 3000 }]);
    expect(main.callsOf('layout.openExternal')).toEqual([]);
    expect(browserTabs(R)).toHaveLength(1);
  });

  it('of a session on another machine refuses a loopback address that cannot be forwarded, with the line', () => {
    fireEvent.click(renderReceipt('http://app.localhost:3000/', R, openWebLink));
    expect(main.calls).toEqual([]);
    expect(browserTabs(R)).toEqual([]);
    expect(toasts()).toEqual([BROWSER_COPY.forwarded.refused('mini')]);
  });

  // N3.9
  it('of a session on this Mac opens its loopback address in the in-app browser, and with ⌘ in the system browser', () => {
    const address = renderReceipt('http://localhost:5173/', A, openWebLink);
    fireEvent.click(address);
    expect(main.callsOf('browser.tabs.open')).toEqual([{ appSessionId: bareOf(A), url: 'http://localhost:5173/', select: true, reuse: 'url' }]);
    expect(main.callsOf('layout.openExternal')).toEqual([]);
    fireEvent.click(address, { metaKey: true });
    expect(main.callsOf('layout.openExternal')).toEqual([{ url: 'http://localhost:5173/' }]);
    expect(main.callsOf('browser.tabs.open')).toHaveLength(1);
    expect(browserTabs(A)).toHaveLength(1);
  });
});
