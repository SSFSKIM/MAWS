// `show_pane` (P1 X9; E1 execution document, M1 decisions and residue 10): open a pane for the human through the pane
// bridge. A `file` target is resolved against the engine's working directory and must name an existing file before any
// window is asked, so a window never receives a path that does not exist; a `diff` target is resolved the same way
// when given (a deleted file still has a diff); the other panes' targets pass through as the model gave them. Whether a
// pane exists in this build is the window's to say (its answer is relayed word for word).
import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseToolArguments, TOOL_ERRORS } from '@shared/maws/tools';
import type { PaneBridge } from './panes';
import { defineMawsTool, toolError, toolText, type McpToolDefinition } from './server';

export function showPaneTool(deps: { bridge: PaneBridge }): McpToolDefinition {
  return defineMawsTool('show_pane', async (args, ctx) => {
    const parsed = parseToolArguments('show_pane', args);
    if (!parsed.ok) return toolError(parsed.error);
    const { pane, line } = parsed.data;
    let target = parsed.data.target || null;
    if (pane === 'file') {
      if (target === null) return toolError(TOOL_ERRORS.targetRequired(pane));
      target = resolve(ctx.cwd, target);
      const found = await stat(target).catch(() => null);
      if (!found?.isFile()) return toolError(TOOL_ERRORS.fileNotFound(target));
    } else if (pane === 'diff' && target !== null) {
      target = resolve(ctx.cwd, target);
    }
    const answer = await deps.bridge.request({ requestId: ctx.requestId, pane, target, line: line ?? null }, ctx.signal);
    return 'error' in answer ? toolError(answer.error) : toolText(answer);
  });
}
