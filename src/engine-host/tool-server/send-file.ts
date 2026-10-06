// `send_file` (P1 X9 and X12; E1 execution document, M1 decisions): each path is resolved against the engine's working
// directory and must name an existing regular file; one that does not refuses the whole call before any record is
// written, so the model gets one error and retries once. Then one X12 record per file (the file referenced in place),
// and the result lists the deliverable ids. The transcript's delivery row is drawn from the call and its answer.
import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import type { DeliverableRecord } from '@shared/maws/deliverable';
import { parseToolArguments, TOOL_ERRORS, type SendFileResult } from '@shared/maws/tools';
import type { DeliverableWriter } from '../deliverables/store';
import { defineMawsTool, toolError, toolText, type McpToolDefinition } from './server';

export function sendFileTool(deps: { deliverables: DeliverableWriter; now?: () => Date; newId?: () => string }): McpToolDefinition {
  return defineMawsTool('send_file', async (args, ctx) => {
    const parsed = parseToolArguments('send_file', args);
    if (!parsed.ok) return toolError(parsed.error);
    const { files, caption } = parsed.data; // `urgency` is the row's (its event carries it), not the record's
    const paths = files.map((file) => resolve(ctx.cwd, file));
    for (const path of paths) {
      const found = await stat(path).catch(() => null);
      if (!found?.isFile()) return toolError(TOOL_ERRORS.notAFile(path));
    }
    const createdAt = (deps.now?.() ?? new Date()).toISOString();
    const records: DeliverableRecord[] = paths.map((path) => ({
      id: deps.newId?.() ?? randomUUID(), appSessionId: ctx.appSessionId, kind: 'file', path, title: basename(path),
      ...(caption !== undefined && { caption }), versions: [{ path, at: createdAt }], ...(ctx.toolUseId !== null && { toolUseId: ctx.toolUseId }), createdAt,
    }));
    for (const record of records) {
      try {
        await deps.deliverables.write(record);
      } catch (error) {
        return toolError(`send_file: ${record.path} was not recorded: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const result: SendFileResult = { status: 'delivered', deliverables: records.map((record) => ({ id: record.id, path: record.path, name: basename(record.path) })) };
    return toolText(result);
  });
}
