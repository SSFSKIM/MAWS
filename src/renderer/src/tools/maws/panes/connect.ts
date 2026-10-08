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
// E2 (E2 execution document, Design §4 "show_pane 'deliverable'"; Decision Log 13): the `deliverable` pane resolves its
// target through main first, so the answer waits on that read (the bridge allows 8 s; a read takes milliseconds). A
// record that exists opens the Deliverables tool on it; a target no record answers to is the model's error to read
// (`deliverableNotFound`), never "shown" over a list; no target opens the list.
//
// E4a (E4a execution document, Interfaces "The renderer"; Decision Log 7): the `browser` pane checks its target as main
// will (`validateBrowserUrl`), so a refused address answers `navigationRefused` before anything opens; otherwise the
// Browser tool opens with the parsed URL, the session and the request's own id (main makes one tab of a request two
// windows both handle).
import * as z from 'zod';
import { validateBrowserUrl } from '@shared/browser/url'; // E4a
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import { tabId } from '@shared/ipc/schema/layout';
import type { MawsPaneAnswerResult, MawsPaneShow } from '@shared/ipc/schema/maws';
import { PANES, type Pane } from '@shared/maws/panes';
import { TOOL_ERRORS } from '@shared/maws/tools';
import { ipc } from '../../../ipc/client';
import { panelHost, shownSession } from '../../../panel/host';
import type { PanelTool } from '../../../panel/tool';
import { useLayout } from '../../../stores/layout';
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
  if (shownSession(layout.main) !== appSessionId) layout.openSession(appSessionId);
  panelHost.selectTab(existing.id);
  return existing.id;
}

export function showPane({ appSessionId, requestId, pane, target, line }: MawsPaneShow, client: MawsBridge = ipc): MawsPaneAnswerResult | Promise<MawsPaneAnswerResult> {
  const where = PANES[pane];
  if ('mainTab' in where || pane === 'file') {
    if (target === null) return { ok: false, error: TOOL_ERRORS.targetRequired(pane) }; // the host resolves one for `file`
    openFile(appSessionId, target, line);
    const path = normalizeLexically(target);
    return { ok: true, opened: { kind: 'main-tab', tabId: tabId({ kind: 'file', path, line, appSessionId }), path, line } };
  }
  const tool = panelHost.tools().find((candidate) => candidate.id === where.toolId);
  if (!tool) return { ok: false, error: TOOL_ERRORS.paneUnavailable(pane) };
  if (pane === 'deliverable') return showDeliverable(tool, appSessionId, target, client); // E2
  if (pane === 'browser') return showBrowser(tool, appSessionId, requestId, target); // E4a
  const opened = (pane === 'terminal' ? selectTerminal(tool, appSessionId) : null) ?? panelHost.addTool(tool.id, { appSessionId, params: paramsOf(pane, target), activate: true });
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

// E2 start: the `deliverable` pane. The target is the record's id (what `send_file` and `artifact_create` answer as the
// deliverable id); an artifact's own short id (`dash`) is also found, through the session's list, since the model holds
// both and either names one record (an artifact id may itself be shaped like a uuid, so a record id read as absent
// falls through to the search).
async function deliverableOf(client: MawsBridge, appSessionId: AppSessionId, target: string): Promise<{ id: string | null } | { error: string }> {
  if (z.uuid().safeParse(target).success) {
    const found = await client.invoke('deliverables.get', { appSessionId, id: target });
    if (!found.ok) return { error: found.error.message };
    if (found.value.record) return { id: found.value.record.id };
  }
  const listed = await client.invoke('deliverables.list', { appSessionId });
  if (!listed.ok) return { error: listed.error.message };
  return { id: listed.value.records.find((record) => record.kind === 'artifact' && record.artifactId === target)?.id ?? null };
}

async function showDeliverable(tool: PanelTool<unknown, unknown>, appSessionId: AppSessionId, target: string | null, client: MawsBridge): Promise<MawsPaneAnswerResult> {
  const open = (params: Record<string, string>): MawsPaneAnswerResult => {
    const opened = panelHost.addTool(tool.id, { appSessionId, params, activate: true });
    return { ok: true, opened: { kind: 'panel-tool', toolId: tool.id, tabId: opened, title: tool.title } };
  };
  if (target === null) return open({});
  const found = await deliverableOf(client, appSessionId, target);
  if ('error' in found) return { ok: false, error: TOOL_ERRORS.deliverableUnreadable(target, found.error) };
  if (found.id === null) return { ok: false, error: TOOL_ERRORS.deliverableNotFound(target) };
  return open({ target: found.id, appSessionId }); // the session named, so a pinned tab showing another one follows it
}
// E2 end

// E4a start: the `browser` pane.
function showBrowser(tool: PanelTool<unknown, unknown>, appSessionId: AppSessionId, requestId: string, target: string | null): MawsPaneAnswerResult {
  let url: string | null = null;
  if (target !== null) {
    const checked = validateBrowserUrl(target);
    if (!checked.ok) return { ok: false, error: TOOL_ERRORS.navigationRefused(target) };
    url = checked.url;
  }
  const params = { ...(url !== null && { target: url }), appSessionId, requestId };
  const opened = panelHost.addTool(tool.id, { appSessionId, params, activate: true });
  return { ok: true, opened: { kind: 'panel-tool', toolId: tool.id, tabId: opened, title: tool.title } };
}
// E4a end
