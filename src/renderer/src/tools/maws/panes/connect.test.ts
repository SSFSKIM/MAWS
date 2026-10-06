// E1 (M3): the window side of the pane bridge (residue 3). On `maws.pane.show` a window that knows the session opens
// what `PANES` names (a main tab for `file`, else the panel tool) and answers `maws.pane.answer` with what it opened; a
// pane whose tool this build lacks is answered with the host's own "not available" text; a session this window does not
// know is left to the window that does.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId, RequestId } from '@shared/graph/ids';
import { tabId } from '@shared/ipc/schema/layout';
import { TOOL_ERRORS } from '@shared/maws/tools';
import { fakeClient, type FakeClient } from '../../../../../../test/support/fake-client';
import { registerPanelTool } from '../../../panel/host';
import { useLayout } from '../../../stores/layout';
import { activeTab } from '../../../stores/layout-model';
import { A, B, panelOf, probeTool, resetPanelStores } from '../../../test-support/panel';
import { connectPaneShows } from './connect';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const show = (fake: FakeClient, over: Record<string, unknown>) => fake.event('maws.pane.show', { appSessionId: A, requestId: 'r1' as RequestId, pane: 'terminal', target: null, line: null, ...over });

let fake: FakeClient;
let disconnect: () => void;
beforeEach(() => {
  resetPanelStores();
  fake = fakeClient({ 'maws.pane.answer': { outcome: 'delivered' } });
  disconnect = connectPaneShows(fake.client);
});
afterEach(() => disconnect());

describe('the pane bridge, window side (E1)', () => {
  it('file: a main tab at the line, answered main-tab with its tab id', async () => {
    show(fake, { pane: 'file', target: '/repo/src/a.ts', line: 3 });
    await settle();
    const tab = activeTab(useLayout.getState().main);
    expect(tab).toMatchObject({ kind: 'file', path: '/repo/src/a.ts', line: 3, appSessionId: A });
    expect(fake.invoked('maws.pane.answer')).toEqual([
      { appSessionId: A, requestId: 'r1', result: { ok: true, opened: { kind: 'main-tab', tabId: tabId({ kind: 'file', path: '/repo/src/a.ts', line: 3, appSessionId: A }), path: '/repo/src/a.ts', line: 3 } } },
    ]);
  });

  it('terminal: a Terminal tab in the session’s panel, answered panel-tool with its tab and title; a second show selects the same tab', async () => {
    const { tool, probe } = probeTool('terminal', { title: 'Terminal' });
    registerPanelTool(tool);
    show(fake, {});
    await settle();
    const [opened] = panelOf(A)!.tabs;
    expect(opened!.toolId).toBe('terminal');
    expect(panelOf(A)!.activeTabId).toBe(opened!.id);
    expect(probe.created.map((init) => init.params)).toEqual([{}]);
    expect(fake.invoked('maws.pane.answer')).toEqual([{ appSessionId: A, requestId: 'r1', result: { ok: true, opened: { kind: 'panel-tool', toolId: 'terminal', tabId: opened!.id, title: 'Terminal' } } }]);
    show(fake, { requestId: 'r2' });
    await settle();
    expect(panelOf(A)!.tabs).toHaveLength(1);
    expect(fake.invoked('maws.pane.answer')[1]).toEqual({ appSessionId: A, requestId: 'r2', result: { ok: true, opened: { kind: 'panel-tool', toolId: 'terminal', tabId: opened!.id, title: 'Terminal' } } });
  });

  it('diff: Review on the uncommitted changes, at the file when the model named one', async () => {
    const { tool, probe } = probeTool('review', { title: 'Review', multiInstance: false });
    registerPanelTool(tool);
    show(fake, { pane: 'diff', target: '/repo/src/a.ts' });
    await settle();
    expect(probe.created.map((init) => init.params)).toEqual([{ scope: 'uncommitted', path: '/repo/src/a.ts' }]);
  });

  it('deliverable with no deliverables tool registered: the host’s "not available in this build" text, nothing opened', async () => {
    show(fake, { pane: 'deliverable', target: 'none' });
    await settle();
    expect(panelOf(A)?.tabs ?? []).toEqual([]);
    expect(fake.invoked('maws.pane.answer')).toEqual([{ appSessionId: A, requestId: 'r1', result: { ok: false, error: TOOL_ERRORS.paneUnavailable('deliverable') } }]);
  });

  it('a sibling’s tool, once registered, receives the target', async () => {
    const { tool, probe } = probeTool('browser', { title: 'Browser' });
    registerPanelTool(tool);
    show(fake, { pane: 'browser', target: 'https://example.com' });
    await settle();
    expect(probe.created.map((init) => init.params)).toEqual([{ target: 'https://example.com' }]);
  });

  it('a multi-instance sibling tool shown twice with distinct targets receives both (only the Terminal reuses its tab)', async () => {
    const { tool, probe } = probeTool('browser', { title: 'Browser', multiInstance: true });
    registerPanelTool(tool);
    show(fake, { pane: 'browser', target: 'https://a.example' });
    show(fake, { pane: 'browser', target: 'https://b.example', requestId: 'r2' });
    await settle();
    expect(probe.created.map((init) => init.params)).toEqual([{ target: 'https://a.example' }, { target: 'https://b.example' }]);
    const tabs = panelOf(A)!.tabs.map((tab) => tab.id);
    expect(fake.invoked('maws.pane.answer').map((answer) => (answer as { result: { opened: { tabId: string } } }).result.opened.tabId)).toEqual(tabs);
  });

  it('a session this window does not know: nothing opened, no answer', async () => {
    const { tool } = probeTool('terminal', { title: 'Terminal' });
    registerPanelTool(tool);
    show(fake, { appSessionId: 'app-elsewhere' as AppSessionId });
    await settle();
    expect(panelOf('app-elsewhere' as AppSessionId)).toBeUndefined();
    expect(panelOf(B)).toBeUndefined();
    expect(fake.invoked('maws.pane.answer')).toEqual([]);
  });
});
