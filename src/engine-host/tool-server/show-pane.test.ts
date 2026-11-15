import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId, RequestId, ToolUseId } from '@shared/graph/ids';
import { TOOL_ERRORS } from '@shared/maws/tools';
import type { MawsPaneAnswerResult } from '@shared/ipc/schema/maws';
import { PaneBridge, type PaneShowRequest } from './panes';
import type { McpToolContext, McpToolResult } from './server';
import { showPaneTool } from './show-pane';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'maws-show-pane-'));
  writeFileSync(join(root, 'a.ts'), 'export {};\n');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const ctx = (): McpToolContext => ({ appSessionId: 'app-1' as AppSessionId, cwd: root, toolUseId: 'toolu_01' as ToolUseId, requestId: 'r1' as RequestId, signal: new AbortController().signal, fromSubagent: false });
const text = (result: McpToolResult) => (result.content[0] as { text: string }).text; // E2: content widened to image blocks

// A bridge whose windows answer every request at once with `answer`, recording what they were asked.
function windows(answer: (request: PaneShowRequest) => MawsPaneAnswerResult) {
  const asked: PaneShowRequest[] = [];
  const bridge: PaneBridge = new PaneBridge({
    show: (request) => {
      asked.push(request);
      queueMicrotask(() => bridge.answer(request.requestId, answer(request)));
    },
  });
  return { bridge, asked };
}

describe('show_pane (G5, host half)', () => {
  it('asks the windows and answers what was opened', async () => {
    const { bridge, asked } = windows(() => ({ ok: true, opened: { kind: 'panel-tool', toolId: 'terminal', tabId: 'terminal:1', title: 'Terminal' } }));
    const result = await showPaneTool({ bridge }).call({ pane: 'terminal' }, ctx());
    expect(asked).toEqual([{ requestId: 'r1', pane: 'terminal', target: null, line: null }]);
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(text(result))).toEqual({ status: 'shown', pane: 'terminal', opened: { kind: 'panel-tool', toolId: 'terminal', tabId: 'terminal:1', title: 'Terminal' } });
  });

  it('resolves a file against the working directory, requires that it exists, and passes the line', async () => {
    const { bridge, asked } = windows((r) => ({ ok: true, opened: { kind: 'main-tab', tabId: `file:${r.target}`, path: r.target!, line: r.line } }));
    const result = await showPaneTool({ bridge }).call({ pane: 'file', target: 'a.ts', line: 3 }, ctx());
    expect(asked).toEqual([{ requestId: 'r1', pane: 'file', target: join(root, 'a.ts'), line: 3 }]);
    expect(JSON.parse(text(result)).opened).toEqual({ kind: 'main-tab', tabId: `file:${join(root, 'a.ts')}`, path: join(root, 'a.ts'), line: 3 });
  });

  it('refuses a file pane without a target or with a missing file, without asking any window', async () => {
    const { bridge, asked } = windows(() => ({ ok: false, error: 'unreachable' }));
    expect(await showPaneTool({ bridge }).call({ pane: 'file' }, ctx())).toEqual({ content: [{ type: 'text', text: TOOL_ERRORS.targetRequired('file') }], isError: true });
    expect(text(await showPaneTool({ bridge }).call({ pane: 'file', target: 'gone.ts' }, ctx()))).toBe(TOOL_ERRORS.fileNotFound(join(root, 'gone.ts')));
    expect(asked).toEqual([]);
  });

  it('resolves a diff target without requiring it to exist (a deleted file has a diff), and passes the others through', async () => {
    const { bridge, asked } = windows(() => ({ ok: false, error: TOOL_ERRORS.paneUnavailable('tasks') }));
    await showPaneTool({ bridge }).call({ pane: 'diff', target: 'removed.ts' }, ctx());
    await showPaneTool({ bridge }).call({ pane: 'diff' }, ctx());
    const unavailable = await showPaneTool({ bridge }).call({ pane: 'tasks', target: 'release' }, ctx());
    await showPaneTool({ bridge }).call({ pane: 'browser', target: 'https://example.com/a' }, ctx());
    expect(asked.map((r) => [r.pane, r.target])).toEqual([['diff', join(root, 'removed.ts')], ['diff', null], ['tasks', 'release'], ['browser', 'https://example.com/a']]);
    expect(unavailable).toEqual({ content: [{ type: 'text', text: 'show_pane: the tasks pane is not available in this build of MAWS' }], isError: true });
  });

  // UX wave U6d (O-44): the agent opens no artifact by itself. A call that names the pane is answered with the sentence
  // that teaches the link, whatever else it holds, and no window is asked; `at` is a key no pane takes, and no request
  // to a window carries it
  it('refuses the artifact pane with the sentence, asking no window, and sends no at', async () => {
    const { bridge, asked } = windows(() => ({ ok: true, opened: { kind: 'panel-tool', toolId: 'artifacts', tabId: 'artifacts:1', title: 'Artifacts' } }));
    const id = '00000000-0000-4000-8000-000000000001';
    for (const args of [{ pane: 'artifact', target: id, at: { tab: 't2', block: 'b7' } }, { pane: 'artifact', target: id }, { pane: 'artifact' }, { pane: 'artifact', target: id, line: 2 }]) {
      expect(await showPaneTool({ bridge }).call(args, ctx()), JSON.stringify(args)).toEqual({ content: [{ type: 'text', text: TOOL_ERRORS.artifactPaneRetired }], isError: true });
    }
    expect(text(await showPaneTool({ bridge }).call({ pane: 'artifact' }, ctx()))).toBe('show_pane: MAWS no longer opens an artifact for the user. Name it in your message as a Markdown link, [its title](maws-artifact:<artifactId>), and the user opens it with a click.');
    const refused = await showPaneTool({ bridge }).call({ pane: 'terminal', at: { slide: 's1' } }, ctx());
    expect(refused.isError).toBe(true);
    expect(text(refused)).toMatch(/^show_pane: invalid arguments: .*"at"/);
    expect(asked).toEqual([]);
    await showPaneTool({ bridge }).call({ pane: 'tasks', target: 'release' }, ctx());
    expect(asked).toEqual([{ requestId: 'r1', pane: 'tasks', target: 'release', line: null }]);
  });

  it('names an unknown pane with the known ones, asking no window', async () => {
    const { bridge, asked } = windows(() => ({ ok: false, error: 'unreachable' }));
    const result = await showPaneTool({ bridge }).call({ pane: 'nope' }, ctx());
    expect(result).toEqual({ content: [{ type: 'text', text: 'show_pane: unknown pane "nope"; known panes: diff, file, terminal, tasks, browser, source-control' }], isError: true });
    expect(asked).toEqual([]);
  });
});
