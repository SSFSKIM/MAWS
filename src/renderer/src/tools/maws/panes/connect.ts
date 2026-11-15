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
//
// UX wave U6d (O-44; Interfaces §D): the agent opens no artifact by itself. A request for the `artifact` pane, from an
// engine host of any build (an older one on this Mac outlives an update of the app), is refused with the host's own
// sentence as the function's first statement: nothing is looked up, opened or awaited, whatever the target and `at`.
//
// E4a (E4a execution document, Interfaces "The renderer"; Decision Log 7): the `browser` pane checks its target as main
// will (`validateBrowserUrl`), so a refused address answers `navigationRefused` before anything opens; otherwise main
// opens the parsed URL with the request's own id (main makes one tab of a request two windows both handle). U12a: the
// window makes that open itself, asking main to reload a page already open, and opens the Browser tool on its answer.
//
// UX wave U7b (its execution document, Interfaces §F, "Not the person's act"; M6, decision 5): what an agent shows is not
// the person's act, so it closes neither a page nor the Settings dialog, and what it brings to the front is in front of
// the strip behind them. The calls that reach the layout store run inside `quietly`; every `addTool` says `asked`, which
// the host keeps across its own deferral, and the one made after an await (the browser's open) carries it across its
// own, where no `quietly` scope reaches.
import { validateBrowserUrl } from '@shared/browser/url'; // E4a
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import { tabId } from '@shared/ipc/schema/layout';
import type { MawsPaneAnswerResult, MawsPaneShow } from '@shared/ipc/schema/maws';
import { PANES, type Pane } from '@shared/maws/panes';
import { TOOL_ERRORS } from '@shared/maws/tools';
import { ipc } from '../../../ipc/client';
import { machineFor } from '../../../ipc/machine';
import { panelHost, shownSession } from '../../../panel/host';
import type { PanelTool } from '../../../panel/tool';
import { quietly, useLayout } from '../../../stores/layout';
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
  if (shownSession(layout.main) !== appSessionId) quietly(() => layout.openSession(appSessionId));
  panelHost.selectTab(existing.id);
  return existing.id;
}

export function showPane({ appSessionId, requestId, pane, target, line }: MawsPaneShow, client: MawsBridge = ipc): MawsPaneAnswerResult | Promise<MawsPaneAnswerResult> {
  if (pane === 'artifact') return { ok: false, error: TOOL_ERRORS.artifactPaneRetired }; // U6d: before any tool is looked up
  const where = PANES[pane];
  if ('mainTab' in where || pane === 'file') {
    if (target === null) return { ok: false, error: TOOL_ERRORS.targetRequired(pane) }; // the host resolves one for `file`
    quietly(() => openFile(appSessionId, target, line));
    const path = normalizeLexically(target);
    return { ok: true, opened: { kind: 'main-tab', tabId: tabId({ kind: 'file', path, line, appSessionId, machine: machineFor(appSessionId) }), path, line } };
  }
  const tool = panelHost.tools().find((candidate) => candidate.id === where.toolId);
  if (!tool) return { ok: false, error: TOOL_ERRORS.paneUnavailable(pane) };
  if (pane === 'browser') return showBrowser(tool, appSessionId, requestId, target, client); // E4a; U12a: client
  const opened = (pane === 'terminal' ? selectTerminal(tool, appSessionId) : null) ?? panelHost.addTool(tool.id, { appSessionId, params: paramsOf(pane, target), activate: true, asked: 'agent' });
  return { ok: true, opened: { kind: 'panel-tool', toolId: tool.id, tabId: opened, title: tool.title } };
}

export function connectPaneShows(client: MawsBridge = ipc): () => void {
  return client.on('maws.pane.show', (request) => {
    if (!useSessions.getState().records.has(request.appSessionId)) return;
    void Promise.resolve(showPane(request, client))
      .then((result) => client.invoke('maws.pane.answer', { appSessionId: request.appSessionId, requestId: request.requestId, result }))
      .then((answer) => {
        if (!answer.ok) console.warn(`[maws] show_pane ${request.pane} not answered: ${answer.error.message}`);
      });
  });
}

// E4a start: the `browser` pane. U12a (M1; Interfaces §B): a target is opened by the window itself, through main's
// `browser.tabs.open` with `reload` and the request's own id, before the Browser tool opens, so the panel mounts on the
// tab main has just selected and the answer carries main's `page`. While main has not answered nothing is opened and
// nothing answered (the bridge's own 8 s stand). An open main refuses is a refusal, and nothing opens (ruling R9). With
// no target the tool opens on the session's own state, as before, and the answer has no `page`.
async function showBrowser(tool: PanelTool<unknown, unknown>, appSessionId: AppSessionId, requestId: string, target: string | null, client: MawsBridge): Promise<MawsPaneAnswerResult> {
  const openTool = () => {
    const tabId = panelHost.addTool(tool.id, { appSessionId, params: { appSessionId }, activate: true, asked: 'agent' });
    return { kind: 'panel-tool' as const, toolId: tool.id, tabId, title: tool.title };
  };
  if (target === null) return { ok: true, opened: openTool() };
  const checked = validateBrowserUrl(target);
  if (!checked.ok) return { ok: false, error: TOOL_ERRORS.navigationRefused(target) };
  const open = await client.invoke('browser.tabs.open', { appSessionId, url: checked.url, select: true, reuse: 'url', reload: true, requestId });
  if (!open.ok) return { ok: false, error: TOOL_ERRORS.browserOpenFailed(target, open.error.message) };
  const { page } = open.value;
  return { ok: true, opened: openTool(), ...(page !== undefined && { page }) };
}
// E4a end
