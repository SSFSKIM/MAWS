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
// E2 (E2 execution document, Design §4 "show_pane 'deliverable'"; Decision Log 13; P3-L M6b: the `artifact` pane and
// the Artifacts tool): the `artifact` pane resolves its target through the engine host's store first, so the answer
// waits on that read (the bridge allows 8 s; a read takes milliseconds). An artifact that exists opens the Artifacts
// tool on it; a target no artifact answers to is the model's error to read (`artifactNotFound`), never "shown" over a
// list; no target opens the list.
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
import { artifactScopeOf, type LineageSource } from '@shared/maws/artifact-scope'; // P2-F L122
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
  if (pane === 'artifact') return showArtifact(tool, appSessionId, target, client); // E2; P3-L M6b
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

// E2 start: the `artifact` pane (P3-L M6b; E2's `deliverable` pane before the cutover). The target is the artifact's id
// (what `send_file` and `artifact_create` answer as the deliverable id; a pre-P3 record's id is its artifact's), or the
// handle the agent named it by (`dash`), since the model holds both; an id that names no artifact falls through to the
// handles (a handle may itself be shaped like a uuid). P2-F L122: a handle resolves over the session's ancestor chain
// as its artifact tools resolve it (`ancestorsOf`), the nearest session that made an artifact of that handle holding it.
async function artifactIn(client: MawsBridge, owner: AppSessionId, target: string): Promise<{ id: string | null } | { error: string }> {
  const listed = await client.invoke('artifacts.list', { filter: { appSessionId: owner } });
  if (!listed.ok) return { error: listed.error.message };
  const own = listed.value.artifacts.find((artifact) => artifact.handle === target && artifact.createdBy.kind === 'session' && artifact.createdBy.appSessionId === owner);
  return { id: own?.id ?? null };
}

// The session's ancestors as main's index walks them for the artifact tools: this window's records first, and an
// ancestor they lack (an archived thread: the window's feed lists unarchived sessions only) read through `session.get`,
// which reads the whole index. An ancestor neither holds (or a read that fails) ends the chain there, as in main.
async function ancestorsOf(client: MawsBridge, appSessionId: AppSessionId): Promise<AppSessionId[]> {
  const records = useSessions.getState().records;
  const read = new Map<AppSessionId, ReturnType<LineageSource['get']>>();
  const source: LineageSource = { get: (id) => records.get(id) ?? read.get(id) };
  const lineage = records.get(appSessionId)?.lineage ?? null;
  for (;;) {
    const chain = artifactScopeOf(source, lineage);
    const unread = chain.find((id) => !records.has(id) && !read.has(id));
    if (unread === undefined) return chain;
    const found = await client.invoke('session.get', { appSessionId: unread });
    read.set(unread, found.ok ? found.value : null);
  }
}

// The artifact the target names, by its id, else by a handle the session or the nearest ancestor holds; null when none.
async function artifactOf(client: MawsBridge, appSessionId: AppSessionId, target: string): Promise<{ id: string } | null | { error: string }> {
  if (z.uuid().safeParse(target).success) {
    const found = await client.invoke('artifacts.get', { artifactId: target.toLowerCase() });
    if (!found.ok) return { error: found.error.message };
    if (found.value.artifact) return { id: found.value.artifact.id };
  }
  for (const owner of [appSessionId, ...(await ancestorsOf(client, appSessionId))]) {
    const found = await artifactIn(client, owner, target);
    if ('error' in found) return found;
    if (found.id !== null) return { id: found.id };
  }
  return null;
}

async function showArtifact(tool: PanelTool<unknown, unknown>, appSessionId: AppSessionId, target: string | null, client: MawsBridge): Promise<MawsPaneAnswerResult> {
  const open = (params: Record<string, string>): MawsPaneAnswerResult => {
    const opened = panelHost.addTool(tool.id, { appSessionId, params, activate: true });
    return { ok: true, opened: { kind: 'panel-tool', toolId: tool.id, tabId: opened, title: tool.title } };
  };
  if (target === null) return open({});
  const found = await artifactOf(client, appSessionId, target);
  if (found === null) return { ok: false, error: TOOL_ERRORS.artifactNotFound(target) };
  if ('error' in found) return { ok: false, error: TOOL_ERRORS.artifactUnreadable(target, found.error) };
  return open({ target: found.id });
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
