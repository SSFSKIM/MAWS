// E1 (M3): the window side of `show_pane`'s pane bridge (residue 3: an IPC event, never an X1 event, so a reload or a
// disk replay re-opens nothing). On `maws.pane.show` a window that knows the session opens what `PANES` names and
// answers `maws.pane.answer` with what it opened: the `file` pane as a main tab at the line, any other pane as its panel
// tool with the params residue 10 gives it (Review on the uncommitted changes at the named file, the Terminal as is, a
// sibling's tool with the model's target). A pane whose tool this build has not registered is answered with the host's
// own "not available" text, so the model reads the same words whichever side refused. A window that does not know the
// session leaves it to the one that does; two windows that both know it both open it, and the host keeps the first
// answer. The Terminal (a tool that opens a tab per call, and takes no target) shows the session's existing tab rather
// than a new one: the model asks the human to look there, not for another shell. Every other pane goes through
// `addTool` with its params, so a target always reaches its tool.
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import { tabId } from '@shared/ipc/schema/layout';
import type { MawsPaneAnswerResult, MawsPaneShow } from '@shared/ipc/schema/maws';
import { PANES, type Pane } from '@shared/maws/panes';
import { TOOL_ERRORS } from '@shared/maws/tools';
import { ipc } from '../../../ipc/client';
import { panelHost } from '../../../panel/host';
import type { PanelTool } from '../../../panel/tool';
import { useLayout } from '../../../stores/layout';
import { activeTab, sessionOfTab } from '../../../stores/layout-model';
import { useSessions } from '../../../stores/sessions';
import { normalizeLexically, openFile } from '../../code/open-file';

// What each panel tool is opened with (residue 10).
function paramsOf(pane: Exclude<Pane, 'file'>, target: string | null): Record<string, string> {
  if (pane === 'diff') return { scope: 'uncommitted', ...(target !== null && { path: target }) };
  if (pane === 'terminal') return {};
  return target !== null ? { target } : {};
}

// The session's Terminal tab, selected (the session brought on screen first, as `addTool`'s activation does); null when
// it has none.
function selectTerminal(tool: PanelTool<unknown, unknown>, appSessionId: AppSessionId): string | null {
  const layout = useLayout.getState();
  const existing = layout.panelBySession.get(appSessionId)?.tabs.find((tab) => tab.toolId === tool.id);
  if (!existing) return null;
  if (sessionOfTab(activeTab(layout.main)) !== appSessionId) layout.openSession(appSessionId);
  panelHost.selectTab(existing.id);
  return existing.id;
}

export function showPane({ appSessionId, pane, target, line }: MawsPaneShow): MawsPaneAnswerResult {
  const where = PANES[pane];
  if ('mainTab' in where || pane === 'file') {
    if (target === null) return { ok: false, error: TOOL_ERRORS.targetRequired(pane) }; // the host resolves one for `file`
    openFile(appSessionId, target, line);
    const path = normalizeLexically(target);
    return { ok: true, opened: { kind: 'main-tab', tabId: tabId({ kind: 'file', path, line, appSessionId }), path, line } };
  }
  const tool = panelHost.tools().find((candidate) => candidate.id === where.toolId);
  if (!tool) return { ok: false, error: TOOL_ERRORS.paneUnavailable(pane) };
  const opened = (pane === 'terminal' ? selectTerminal(tool, appSessionId) : null) ?? panelHost.addTool(tool.id, { appSessionId, params: paramsOf(pane, target), activate: true });
  return { ok: true, opened: { kind: 'panel-tool', toolId: tool.id, tabId: opened, title: tool.title } };
}

export function connectPaneShows(client: MawsBridge = ipc): () => void {
  return client.on('maws.pane.show', (request) => {
    if (!useSessions.getState().records.has(request.appSessionId)) return;
    const result = showPane(request);
    void client.invoke('maws.pane.answer', { appSessionId: request.appSessionId, requestId: request.requestId, result }).then((answer) => {
      if (!answer.ok) console.warn(`[maws] show_pane ${request.pane} not answered: ${answer.error.message}`);
    });
  });
}
